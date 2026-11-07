import {
  createAdminClient,
  handleOptions,
  hasPublicApiKey,
  jsonResponse,
  safeText,
  sha256,
} from "../_shared/http.ts";
import {
  addPayFastSignature,
  payFastBaseUrl,
  type PayFastFields,
} from "../_shared/payfast.ts";

const products: Record<string, { name: string; label: string; priceCents: number }> = {
  spray50ml: { name: "Eyelid Spray", label: "50ml", priceCents: 6000 },
  care30ml: { name: "Therapeutic Oil", label: "30ml", priceCents: 6000 },
  "setGift box": {
    name: "Premium Eye Lid Care set",
    label: "Gift box",
    priceCents: 15000,
  },
};

const deliveryOptions = {
  courier: { label: "The Courier Guy · Locker-to-Door", feeCents: 12000 },
  pudo: { label: "PUDO · Locker-to-Locker", feeCents: 8000 },
} as const;

function randomToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  return btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function deliveryDetailsFor(
  method: keyof typeof deliveryOptions,
  value: unknown,
): { details: Record<string, string>; summary: string } | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const input = value as Record<string, unknown>;

  if (method === "courier") {
    const address = safeText(input.address, 120);
    const suburb = safeText(input.suburb, 80);
    const city = safeText(input.city, 80);
    const province = safeText(input.province, 80);
    const postalCode = safeText(input.postalCode, 16);
    if (!address || !suburb || !city || !province || !postalCode) return null;
    const details = { address, suburb, city, province, postalCode };
    return {
      details,
      summary: Object.values(details).join(", "),
    };
  }

  const locker = safeText(input.locker, 120);
  const city = safeText(input.city, 80);
  if (!locker || !city) return null;
  const details = { locker, city };
  return {
    details,
    summary: `${details.locker}, ${details.city}`,
  };
}

function centsAsAmount(cents: number): string {
  return (cents / 100).toFixed(2);
}

Deno.serve(async (request) => {
  const optionsResponse = handleOptions(request);
  if (optionsResponse) return optionsResponse;
  if (request.method !== "POST") {
    return jsonResponse({ error: "Method not allowed." }, 405);
  }
  if (!hasPublicApiKey(request)) {
    return jsonResponse({ error: "Invalid public API key." }, 401);
  }

  let input: Record<string, unknown>;
  try {
    const parsed: unknown = await request.json();
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
      return jsonResponse({ error: "Invalid order details." }, 400);
    }
    input = parsed as Record<string, unknown>;
  } catch {
    return jsonResponse({ error: "Invalid JSON request." }, 400);
  }

  const merchantId = Deno.env.get("PAYFAST_MERCHANT_ID");
  const merchantKey = Deno.env.get("PAYFAST_MERCHANT_KEY");
  const passphrase = Deno.env.get("PAYFAST_PASSPHRASE") ?? "";
  const supabaseUrl = Deno.env.get("SUPABASE_URL");
  const siteUrl = Deno.env.get("SITE_URL")?.replace(/\/+$/, "");
  if (!merchantId || !merchantKey || !supabaseUrl || !siteUrl) {
    return jsonResponse({ error: "Payment service is not configured." }, 503);
  }

  const customerInput = input.customer;
  if (!customerInput || typeof customerInput !== "object" || Array.isArray(customerInput)) {
    return jsonResponse({ error: "Customer details are required." }, 400);
  }
  const customerData = customerInput as Record<string, unknown>;
  const customer = {
    firstName: safeText(customerData.firstName, 80),
    surname: safeText(customerData.surname, 80),
    email: safeText(customerData.email, 254)?.toLowerCase() ?? null,
    phone: safeText(customerData.phone, 32),
  };
  if (
    !customer.firstName ||
    !customer.surname ||
    !customer.email ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(customer.email) ||
    !customer.phone ||
    !/^[+\d][\d\s()+-]{5,31}$/.test(customer.phone)
  ) {
    return jsonResponse({ error: "Enter valid customer details." }, 400);
  }

  const method = input.deliveryMethod;
  if (method !== "courier" && method !== "pudo") {
    return jsonResponse({ error: "Choose a valid delivery method." }, 400);
  }
  const deliveryDetails = deliveryDetailsFor(method, input.deliveryDetails);
  if (!deliveryDetails) {
    return jsonResponse({ error: "Enter complete delivery details." }, 400);
  }

  if (!Array.isArray(input.items) || input.items.length < 1 || input.items.length > 10) {
    return jsonResponse({ error: "The cart must contain between 1 and 10 products." }, 400);
  }
  const quantities = new Map<string, number>();
  for (const item of input.items) {
    if (!item || typeof item !== "object" || Array.isArray(item)) {
      return jsonResponse({ error: "Invalid cart item." }, 400);
    }
    const value = item as Record<string, unknown>;
    const key = safeText(value.k, 40);
    if (
      !key ||
      !products[key] ||
      typeof value.qty !== "number" ||
      !Number.isInteger(value.qty) ||
      value.qty < 1 ||
      value.qty > 30
    ) {
      return jsonResponse({ error: "The cart contains an invalid product or quantity." }, 400);
    }
    quantities.set(key, (quantities.get(key) ?? 0) + value.qty);
  }
  if (Array.from(quantities.values()).some((quantity) => quantity > 30)) {
    return jsonResponse({ error: "A product quantity cannot exceed 30." }, 400);
  }

  const items = Array.from(quantities, ([key, qty]) => ({
    ...products[key],
    key,
    qty,
    lineTotalCents: products[key].priceCents * qty,
  }));
  const subtotalCents = items.reduce((sum, item) => sum + item.lineTotalCents, 0);
  const delivery = deliveryOptions[method];
  const totalCents = subtotalCents + delivery.feeCents;
  const receiptToken = randomToken();
  const receiptTokenHash = await sha256(receiptToken);

  const admin = createAdminClient();
  const { data: order, error: insertError } = await admin
    .from("orders")
    .insert({
      customer,
      delivery_method: method,
      delivery_label: delivery.label,
      delivery_details: deliveryDetails.details,
      items,
      subtotal_cents: subtotalCents,
      delivery_cents: delivery.feeCents,
      total_cents: totalCents,
      receipt_token_hash: receiptTokenHash,
    })
    .select("id")
    .single();
  if (insertError || !order) {
    console.error("Could not save pending order.", insertError?.message);
    return jsonResponse({ error: "Could not create the order. Please try again." }, 500);
  }

  const siteOrigin = siteUrl;
  const fields: PayFastFields = {
    merchant_id: merchantId,
    merchant_key: merchantKey,
    return_url: `${siteOrigin}/payment-return.html?order_id=${encodeURIComponent(order.id)}`,
    cancel_url: `${siteOrigin}/cart.html?payment=cancelled`,
    notify_url: `${supabaseUrl.replace(/\/+$/, "")}/functions/v1/payfast-itn`,
    m_payment_id: order.id,
    amount: centsAsAmount(totalCents),
    item_name: "LidHealth order",
    item_description: items.map((item) => `${item.qty} x ${item.name} ${item.label}`).join(", ").slice(0, 255),
    name_first: customer.firstName,
    name_last: customer.surname,
    email_address: customer.email,
    cell_number: customer.phone,
    custom_str1: delivery.label,
    custom_str2: deliveryDetails.summary.slice(0, 255),
  };
  if (method === "courier") {
    Object.assign(fields, {
      address1: deliveryDetails.details.address,
      address2: deliveryDetails.details.suburb,
      city: deliveryDetails.details.city,
      state: deliveryDetails.details.province,
      country: "South Africa",
      code: deliveryDetails.details.postalCode,
    });
  }

  return jsonResponse({
    orderId: order.id,
    receiptToken,
    paymentUrl: `${payFastBaseUrl()}/eng/process`,
    fields: addPayFastSignature(fields, passphrase),
  });
});
