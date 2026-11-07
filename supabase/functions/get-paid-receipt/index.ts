import {
  createAdminClient,
  handleOptions,
  hasPublicApiKey,
  jsonResponse,
  sha256,
} from "../_shared/http.ts";

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!hasPublicApiKey(request)) {
    return jsonResponse({ error: "Invalid public API key." }, 401);
  }

  let input: unknown;
  try {
    input = await request.json();
  } catch {
    return jsonResponse({ error: "Invalid JSON request." }, 400);
  }
  if (!input || typeof input !== "object" || Array.isArray(input)) {
    return jsonResponse({ error: "Receipt details are required." }, 400);
  }
  const value = input as Record<string, unknown>;
  if (typeof value.orderId !== "string" || typeof value.receiptToken !== "string") {
    return jsonResponse({ error: "Receipt access details are required." }, 400);
  }

  const admin = createAdminClient();
  const { data: order, error } = await admin
    .from("orders")
    .select(
      "id,payment_status,customer,delivery_method,delivery_label,delivery_details,items,subtotal_cents,delivery_cents,total_cents,currency,pf_payment_id,paid_at,receipt_token_hash",
    )
    .eq("id", value.orderId)
    .maybeSingle();
  if (error) {
    console.error("Could not load paid order.", error.message);
    return jsonResponse({ error: "Could not check payment status. Please retry." }, 500);
  }
  if (!order || order.payment_status !== "paid" || !order.paid_at) {
    return jsonResponse({ error: "Payment has not been verified yet." }, 409);
  }
  if (await sha256(value.receiptToken) !== order.receipt_token_hash) {
    return jsonResponse({ error: "Receipt access could not be verified." }, 403);
  }

  return jsonResponse({
    receipt: {
      orderId: order.id,
      status: "PAID",
      paidAt: order.paid_at,
      paymentReference: order.pf_payment_id,
      customer: order.customer,
      deliveryMethod: order.delivery_method,
      deliveryLabel: order.delivery_label,
      deliveryDetails: order.delivery_details,
      items: order.items,
      subtotalCents: order.subtotal_cents,
      deliveryCents: order.delivery_cents,
      totalCents: order.total_cents,
      currency: order.currency,
    },
  });
});
