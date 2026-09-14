# WhatsApp template editor

The editor uses a shared creation validator in `shared/templates.ts`. Both the browser and API build the same Meta payload. `shared/template-send.ts` separately builds delivery components: review handles are never used as delivery media IDs.

## Supported in this application

| Feature | Creation | Delivery |
| --- | --- | --- |
| Standard utility / marketing | Body, optional header, footer, buttons | Named or numbered body values |
| Headers | Text (one variable), JPEG/PNG image, MP4 video, PDF document, location | Header text value, uploaded media ID / HTTPS URL, or coordinates and address |
| Variables | Named or numbered, examples and local body labels | Values with the corresponding Meta parameter names / positions |
| Footer | Optional plain text, up to 60 characters | Included by Meta |
| Buttons | Quick reply, URL, phone, coupon copy code, WhatsApp Flow | Dynamic URL suffixes, coupon codes, Flow token and initial data |
| Flows | Reference by published ID/name, or Flow JSON | Flow action parameters; this is not a visual Flow builder |
| Media carousel | 2–10 matching cards; image/video samples; optional card bodies and up to two buttons | Every approved card's media, body values and URL values |
| Product carousel | Two product cards, matching View product or website buttons | 2–10 catalog products |
| Catalog / multiple products / single product | Dedicated marketing forms and fixed product buttons | Catalog thumbnail, product sections, or catalog/product IDs |
| Limited-time offer | Offer title, optional image/video, website button, optional coupon, no footer | Coupon and future expiration when a countdown is configured |
| Authentication | Copy code, Android one-tap and zero-tap; security text, expiration notice, Android app details | OTP in body and authentication button |
| Management | Edit eligible templates, save/restore a browser-tab draft, sync all pages | Only approved templates are selectable |

The list of language codes is checked against `shared/template-languages.ts`. Text is not automatically translated. The preview is approximate; Meta controls the final message appearance and fixed/localized labels.

GIF headers use Meta's Marketing Messages API rather than this application's Cloud API path. WhatsApp calling buttons and country-specific payment templates require additional account/API setup and are not implemented here. Imported templates with unsupported components are protected from lossy editing and direct users to WhatsApp Manager. This editor does not promise support for every future or account-gated Meta feature.

Templates requiring delivery media or other interactive values are excluded from the existing automation editors, because those editors only map text values. They remain available for manual sending in the inbox. Existing automation records are not rewritten.

## Configuration and upload behavior

Configure `META_APP_ID`, `META_SYSTEM_TOKEN`, `WHATSAPP_BUSINESS_ACCOUNT_ID`, `WHATSAPP_PHONE_NUMBER_ID`, and `META_GRAPH_API_VERSION` on the backend. The system token needs the appropriate business-management and messaging permissions. Catalogs must be connected and published Flows must belong to the account.

* `POST /api/templates/validate`: validate/build a template without submitting it.
* `POST /api/templates/media/example`: multipart `file`; resumable upload, returns a review `handle`.
* `POST /api/templates/media/send`: multipart `file`; phone-number media upload, returns a delivery `mediaId`.
* `POST /api/templates`: submit a new template to Meta and persist the result.
* `PUT /api/templates/:id`: edit content and mark the local result pending review. Name, language and category remain fixed.

The upload endpoints are behind the application's existing authentication middleware. Uploads use temporary files, validate MIME type/signature and per-type size, and delete the temporary file after processing. Image uploads are limited to 5 MB, MP4 to 16 MB, and PDF to 100 MB. Meta remains responsible for media decoding/codec validation. Each backend process permits at most four simultaneous media requests. Normal Meta requests time out after 30 seconds; media transfers after 120 seconds. Requests are not automatically retried, to avoid duplicate submissions or sends.

The Nginx proxy allows 101 MB multipart requests; match that setting in any additional reverse proxy. The backend Dockerfile copies the shared modules. No database migration is required for these template changes.

Meta is authoritative for account eligibility, policy review, edit quotas, category changes and approval. A local validation pass is not an approval. If Meta accepts a creation but a subsequent database write fails, sync templates before retrying the creation.

## Verification

Run `npm run build`, `npm run check:server`, and `npm test`. Tests use a local HTTP server with mocked Meta and Prisma methods; they do not access the configured database or send messages. The test command uses Node's test isolation flag (Node 22.8 or newer).

The automated suite covers creation and delivery payloads, edit round-trips, variable errors, button indexes, carousels, products, offers, authentication, file validation, upload API separation, duplicate creation, incomplete upstream responses and pagination. Chromium checks were performed with intercepted API calls for template creation, file-upload state, drafts and responsive layout.

Before production rollout, use your test WABA to upload real JPEG/PNG, MP4 and PDF samples; obtain approval; and send each relevant template family to a test recipient. Check the status webhooks as well as the synchronous API response. No live Meta submission or delivery was performed during implementation.

## Meta references

Specifications consulted on 2026-09-07:

* [Template fundamentals](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/overview)
* [Template components](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/components)
* [Supported languages](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/supported-languages)
* [Media card carousels](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/media-card-carousel-templates)
* [Product card carousels](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/product-card-carousel-template-messages)
* [Single-product templates](https://developers.facebook.com/documentation/business-messaging/whatsapp/catalogs/spm-template-messages)
* [Limited-time offers](https://developers.facebook.com/documentation/business-messaging/whatsapp/templates/marketing-templates/limited-time-offer-templates)
* [Sending a Flow](https://developers.facebook.com/documentation/business-messaging/whatsapp/flows/guides/sendingaflow)
* [Meta's Cloud API collection](https://www.postman.com/meta/whatsapp-business-platform/documentation/wlk6lh4/whatsapp-cloud-api)
* [Meta's resumable file upload example](https://www.postman.com/meta/whatsapp-business-platform/request/13382743-871ea332-a6a4-4ad0-800a-0be9796b1933)
