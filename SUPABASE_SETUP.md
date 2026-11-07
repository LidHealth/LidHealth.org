# Secure PayFast checkout setup

The storefront remains on GitHub Pages. Supabase stores pending orders and verifies PayFast ITN notifications. The browser never decides whether an order is paid. A receipt is returned only after Supabase marks the order paid.

The current setup does not send email automatically. LidHealth must email the customer manually after checking the verified order.

## 1. Create and configure Supabase

1. Create a Supabase project and keep its project reference.
2. In the SQL Editor, run `supabase/migrations/20261031000000_create_orders.sql`.
3. In the Edge Function secrets settings, add:
   - `PAYFAST_MERCHANT_ID`
   - `PAYFAST_MERCHANT_KEY`
   - `PAYFAST_PASSPHRASE` if a PayFast passphrase is configured
   - `PAYFAST_SANDBOX=true` for testing; use `false` only when intentionally switching to live payments
   - `SITE_URL` set to the deployed storefront base URL, with no trailing slash (for example `https://username.github.io/repository`)

   Do not add a service-role key or PayFast passphrase to website files. Supabase provides its project URL and server keys to Edge Functions.
4. Install the Supabase CLI, sign in, and link this folder to the project:

   ```powershell
   supabase login
   supabase link --project-ref YOUR_PROJECT_REF
   supabase functions deploy create-payment
   supabase functions deploy payfast-itn
   supabase functions deploy get-paid-receipt
   ```

   If you use the CLI to apply migrations instead of the SQL Editor, run `supabase db push` after linking.

## 2. Add the public browser settings

In `store-config.js`, set:

- `supabaseUrl` to the project URL from Supabase Project Settings → API.
- `supabaseAnonKey` to the project's public anon API key.

These are public browser settings. Never use the service-role key there.

## 3. Test safely

Keep `PAYFAST_SANDBOX=true`, use sandbox credentials, and test from the deployed HTTPS GitHub Pages URL. `SITE_URL` must match that site, including the repository path for a project page. The payment return page will show a receipt only after the PayFast notification has passed signature, PayFast validation, order ID, payment status, and exact amount checks.

The download includes the verified paid status, payment time and reference, customer details, delivery details, products, and total. Email remains a manual step; no email is sent by this site.

For a quick storefront walkthrough, open `cart.html` directly from the file system or visit the hosted cart with `?test_checkout=1` (for example `https://username.github.io/repository/cart.html?test_checkout=1`). The test panel fills sample details and lets you simulate successful, cancelled, or failed payment without contacting PayFast. A simulated success displays a test receipt and an unsent email preview; both are marked as simulations and are not proof of payment. The test panel is hidden during normal browsing.

## Included functions

- `create-payment` validates product IDs, quantities, delivery fees, and customer details, stores a pending order, and prepares the signed PayFast form.
- `payfast-itn` validates the PayFast signature and server-side validation response before recording payment.
- `get-paid-receipt` releases receipt details only for a verified paid order and its unguessable receipt token.
