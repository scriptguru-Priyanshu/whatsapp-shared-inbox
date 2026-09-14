# WhatsApp Embedded Signup

The admin-only **Settings** page sends customers to Meta's Hosted Embedded Signup (the "Zero integration onboarding" option). Relay does not load the Facebook JavaScript SDK. Completion is delivered asynchronously by webhook.

## Meta configuration

1. In the Meta app dashboard, create a WhatsApp Embedded Signup login configuration.
2. Open **WhatsApp > Quickstart > View onboarding > Zero integration onboarding** and generate/copy the hosted URL.
3. Subscribe the app's WhatsApp Business Account webhooks to `account_update`.
4. Ensure the app has the required Advanced Access permissions before using businesses that are not app testers.
5. Configure the environment:

```env
META_APP_ID=your_meta_app_id
META_APP_SECRET=your_meta_app_secret
META_EMBEDDED_SIGNUP_CONFIG_ID=your_facebook_login_for_business_config_id
META_HOSTED_SIGNUP_URL=https://business.facebook.com/...
META_SYSTEM_TOKEN=your_tech_provider_system_token
META_TOKEN_ENCRYPTION_KEY=a-stable-random-secret-at-least-32-characters
META_GRAPH_API_VERSION=v26.0
```

Never change `META_TOKEN_ENCRYPTION_KEY` after onboarding accounts unless stored tokens are re-encrypted. If omitted, the backend falls back to `META_APP_SECRET`; a separate encryption key is recommended in production.

## Meta-hosted signup completion

Before opening Meta, Relay asks the administrator for a business label and six-digit Cloud API registration PIN. It encrypts the PIN in a single pending signup request. Relay prevents a second signup from starting while one is pending because Meta's webhook does not include a Relay correlation ID.

Relay does not wait for an OAuth code in a redirect URL. On an `account_update` webhook with `event=PARTNER_ADDED`, it captures `waba_info.waba_id` and `waba_info.owner_business_id`. It computes the HMAC-SHA256 `appsecret_proof` from `META_APP_SECRET` and `META_SYSTEM_TOKEN`, then posts `fetch_only=true` to `/{CUSTOMER_BUSINESS_PORTFOLIO_ID}/system_user_access_tokens`. The returned customer business token is encrypted at rest and used to discover phone-number IDs, subscribe the app to the WABA, and call `/{PHONE_NUMBER_ID}/register` with the saved PIN. The temporary PIN is erased after successful registration; it remains encrypted while pending so webhook retries can recover from transient Graph API failures.

After discovering each business phone-number ID, Relay requests:

```text
GET /{PHONE_NUMBER_ID}/whatsapp_business_profile?fields=about,address,description,email,profile_picture_url,websites,vertical
```

The request uses the customer's business token and its `appsecret_proof`. Relay stores the returned `about`, `address`, `description`, `email`, `profile_picture_url`, `websites`, and `vertical` values on the WhatsApp connection record.

The webhook URL is:

```text
https://api.example.com/api/webhooks/whatsapp
```

Configure the same `WHATSAPP_VERIFY_TOKEN` in Meta and Relay. `META_SYSTEM_TOKEN` is server-only. Never expose either it or the fetched customer business tokens to the browser.

## Delivery reliability and errors

After validating Meta's signature, Relay stores each webhook change with a deterministic delivery key and immediately acknowledges the delivery. Duplicate deliveries are ignored after successful processing. Each stored change is processed independently, so one invalid change does not prevent other changes in the same request from completing. Failed changes retain their error message and are retried with exponential backoff up to five attempts; interrupted `PROCESSING` records are also reclaimed by the queue worker.

Hosted Signup validates the event name, WABA ID, customer business portfolio ID, pending request, encrypted PIN, customer token response, phone-number list, profile response, subscription, and registration response. Errors are visible on the corresponding `MetaWebhookEvent` and, when applicable, the pending signup or WhatsApp connection. A pending signup expires after 30 minutes, clears its encrypted PIN, and no longer blocks a new attempt. Successfully registered signups also clear the encrypted PIN.

## Testing two businesses

Sign in as an administrator, open **Settings**, and select **Continue with Meta**. Complete the hosted flow as an administrator of the business. The connection appears after Meta delivers and Relay processes `PARTNER_ADDED`.

The existing inbox still uses the single `WHATSAPP_ACCESS_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, and `WHATSAPP_BUSINESS_ACCOUNT_ID` environment configuration. The new connection records establish multi-account onboarding and storage; routing inbox data and outbound messages by clinic requires a clinic/tenant model and is a separate step.
