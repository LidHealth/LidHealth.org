import {
  constantTimeEqual,
  createAdminClient,
  handleOptions,
  jsonResponse,
} from "../_shared/http.ts";
import { payFastBaseUrl, payFastSignature } from "../_shared/payfast.ts";

function amountToCents(value: string | null): number | null {
  if (!value || !/^\d+(?:\.\d{1,2})?$/.test(value)) return null;
  const [whole, fraction = ""] = value.split(".");
  return Number(whole) * 100 + Number(fraction.padEnd(2, "0"));
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;
  if (request.method !== "POST") {
    return new Response("Method not allowed.", { status: 405 });
  }

  const rawBody = await request.text();
  const parameters = new URLSearchParams(rawBody);
  const entries = Array.from(parameters.entries());
  if (
    entries.length === 0 ||
    new Set(entries.map(([key]) => key)).size !== entries.length
  ) {
    return new Response("Invalid notification.", { status: 400 });
  }
  const data = Object.fromEntries(entries);
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID");
  const signature = data.signature;
  if (
    !merchantId ||
    data.merchant_id !== merchantId ||
    !signature ||
    !constantTimeEqual(payFastSignature(entries, passphrase), signature)
  ) {
    return new Response("Invalid signature or merchant.", { status: 400 });
  }

  const orderId = data.m_payment_id;
  const paymentId = data.pf_payment_id;
  const receivedCents = amountToCents(data.amount_gross ?? null);
  if (!orderId || !paymentId || receivedCents === null) {
    return new Response("Missing payment details.", { status: 400 });
  }

  const admin = createAdminClient();
  const { data: order, error: orderError } = await admin
    .from("orders")
    .select("id,payment_status,total_cents,pf_payment_id")
    .eq("id", orderId)
    .maybeSingle();
  if (orderError || !order) {
    console.error("PayFast notification references an unknown order.", orderError?.message);
    return new Response("Unknown order.", { status: 404 });
  }
  if (order.payment_status === "paid") {
    return order.pf_payment_id === paymentId
      ? new Response("OK", { status: 200 })
      : new Response("Conflicting payment reference.", { status: 409 });
  }
  if (receivedCents !== order.total_cents) {
    return new Response("Payment does not match the pending order.", { status: 400 });
  }

  const validationUrl = `${payFastBaseUrl()}/eng/query/validate`;
  const validationResponse = await fetch(validationUrl, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: rawBody,
  });
  if (!validationResponse.ok || (await validationResponse.text()).trim() !== "VALID") {
    return new Response("PayFast validation failed.", { status: 400 });
  }
  if (data.payment_status !== "COMPLETE") {
    return new Response("OK", { status: 200 });
  }

  const { data: updated, error: updateError } = await admin
    .from("orders")
    .update({
      payment_status: "paid",
      pf_payment_id: paymentId,
      paid_at: new Date().toISOString(),
      updated_at: new Date().toISOString(),
    })
    .eq("id", orderId)
    .eq("payment_status", "pending")
    .select("id")
    .maybeSingle();
  if (updateError) {
    console.error("Could not mark verified payment as paid.", updateError.message);
    return new Response("Could not save payment confirmation.", { status: 500 });
  }
  if (!updated) {
    const { data: latest, error: latestError } = await admin
      .from("orders")
      .select("payment_status,pf_payment_id")
      .eq("id", orderId)
      .maybeSingle();
    if (latestError || latest?.payment_status !== "paid" || latest.pf_payment_id !== paymentId) {
      return new Response("Payment status could not be confirmed.", { status: 409 });
    }
  }
  return new Response("OK", { status: 200 });
});
