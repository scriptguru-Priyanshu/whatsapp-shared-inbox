# WhatsApp Business Platform Messaging Guide

**Scope:** WhatsApp Business Platform (Cloud API)  
**Audience:** Product, engineering, operations, support, and compliance teams  
**Last reviewed:** 31 August 2026  
**Status:** Operational guidance; pricing and policy must be rechecked before launch

> This document covers the WhatsApp Business Platform/API, not only the free
> WhatsApp Business mobile application. It summarizes Meta's documentation for
> product implementation and is not legal advice.

## 1. Executive summary

The rules for outbound WhatsApp messaging can be reduced to five controls:

1. Obtain valid opt-in before the business initiates messages or calls.
2. Respect opt-outs, blocks, and category-specific communication preferences.
3. When the customer has messaged within the previous 24 hours, the business may
   send free-form service replies and approved templates.
4. Outside that 24-hour window, the business may send only an approved message
   template.
5. Template approval is not permission to spam. Every message must still comply
   with consent, content, commerce, privacy, and local-law requirements.

WhatsApp charges primarily per delivered message. The price depends on the
recipient's market, message category, and applicable volume tier. Meta rates and
rules change; use the live rate card for cost calculations.

## 2. Core messaging decision

Before sending any outbound message, apply this decision table:

| Condition | Permitted message |
| --- | --- |
| The user sent a message in the last 24 hours | Free-form service reply or approved template |
| More than 24 hours have passed since the user's last message | Approved template only |
| The business is starting the conversation | Approved template only |
| The user has not provided valid opt-in | Do not initiate contact |
| The user opted out or requested no further contact | Do not send; suppress immediately |

The 24-hour customer-service window begins or resets whenever the user sends the
business a message. Store the user's latest inbound-message timestamp in the
application database and calculate the window server-side.

## 3. Message categories

Meta recognizes four message categories. Meta can reclassify a submitted
template if its content does not match the selected category.

### 3.1 Service

Service messages are free-form responses to a customer while the 24-hour
customer-service window is open. They may be sent by a person or by automation.

Typical uses:

- Answering product or account questions
- Troubleshooting and customer support
- Asking for information needed to resolve a request
- Sending relevant text, media, locations, contacts, or interactive messages
- Providing an escalation from a chatbot to a human or another support channel

Outside the customer-service window, free-form service messages are not allowed;
an approved template must be used.

Meta currently describes service messages as free. Because pricing can change,
the application must not permanently hard-code a zero service-message rate.

### 3.2 Utility

Utility templates are non-promotional messages tied to a specific user action,
transaction, account, request, or critical event.

Appropriate examples:

- Order confirmation, shipping, or delivery update
- Appointment confirmation or reminder
- Payment receipt or failed-payment notice
- Requested account statement
- Booking or flight-status update
- Critical safety or service alert

Example:

```text
Hello {{1}}, order {{2}} has shipped and is expected on {{3}}.
Track it here: {{4}}
```

Utility content should be factual and specific. Adding a discount, product
recommendation, upgrade, or sales call to action can cause the whole template to
be treated as marketing.

### 3.3 Authentication

Authentication templates deliver one-time passcodes used to verify identity.

Typical uses:

- Login verification
- Registration verification
- Account recovery
- Transaction confirmation

Authentication templates use Meta's prescribed format and can include supported
features such as copy-code buttons, expiration notices, and Android one-tap
autofill. Do not place unrelated notifications or promotions in authentication
templates.

### 3.4 Marketing

Marketing includes promotional, persuasive, re-engagement, or broadly
informational content that is not clearly a utility or authentication message.

Examples:

- Offers, coupons, and sales
- New-product announcements
- Product recommendations
- Abandoned-cart reminders
- Back-in-stock alerts
- Upgrade or renewal campaigns with a sales purpose
- Event promotions
- Re-engagement messages
- Promotional surveys

Example:

```text
Hi {{1}}, your saved items are still available. Complete your order today and
receive {{2}} off: {{3}}
```

Mixed-purpose templates are normally treated as marketing. Keep transactional
and promotional content in separate messages.

## 4. The 24-hour customer-service window

The window is based on the latest message sent by the user, not the latest
message sent by the business.

Example timeline:

```text
10:00 Monday   User sends a question
10:00 Monday   24-hour window opens
15:00 Monday   Business sends a free-form reply; expiry does not change
09:00 Tuesday  User replies; window resets to 09:00 Wednesday
09:01 Wednesday Free-form reply is no longer allowed; use a template
```

During the window, the business can use supported message types relevant to the
conversation. Automation is allowed, but Meta requires a clear and direct path
to escalation, such as a human agent, telephone, email, web support, support
form, or physical location.

## 5. Opt-in and opt-out requirements

### 5.1 Required opt-in

Before initiating contact, the business must have both:

- The person's mobile number; and
- Permission confirming that the person wants to receive subsequent WhatsApp
  messages or calls from the named business.

Consent should state:

- The business name
- That communication will occur through WhatsApp
- The expected categories of communication
- How the person can opt out

Recommended example:

```text
I agree to receive order updates and occasional offers from Acme Store on
WhatsApp. Reply STOP at any time to opt out.
```

Consent may be collected through a website, application, checkout, physical
store, QR code, recorded phone flow, or user-initiated WhatsApp interaction,
subject to applicable law.

Keep an auditable consent record containing:

- Normalized phone number
- Consent wording and version
- Timestamp and source
- Categories authorized
- Calling consent, if applicable
- Relevant audit evidence such as form submission or event identifier
- Opt-out timestamp and scope

Do not use purchased or scraped contact lists. Do not treat a previous purchase,
an existing customer relationship, or possession of a phone number as automatic
WhatsApp consent.

### 5.2 Opt-out handling

Honor requests made on or off WhatsApp to stop, unsubscribe, block, or discontinue
communications. Support both:

- Global opt-out from all WhatsApp messaging
- Category-level opt-out, such as marketing only

Process opt-outs before campaign sends and maintain a centralized suppression
list. Common keywords such as `STOP`, `UNSUBSCRIBE`, and their local-language
equivalents should trigger an immediate, idempotent suppression workflow.

## 6. Template structure and lifecycle

Templates are created for a WhatsApp Business Account and submitted to Meta for
review. A template normally has:

- Name and language
- Category
- Optional header
- Required body
- Optional footer
- Optional buttons

Supported components can include text, image, video, document, location,
quick-reply buttons, URL and telephone actions, authentication actions, catalog
actions, and WhatsApp Flows. Availability and component limits depend on the
current API version and template type.

Variables use numbered placeholders:

```text
Hello {{1}}, your appointment at {{2}} is confirmed for {{3}}.
```

Supply realistic sample values during review:

```text
{{1}} = Priya
{{2}} = City Dental Clinic
{{3}} = 2 September at 3:00 PM
```

### 6.1 Submission checklist

- Select the category that matches the message's actual purpose.
- Give variables enough surrounding context.
- Supply a sample for every variable and media component.
- Use valid, trustworthy URLs.
- Keep grammar, formatting, and call to action clear.
- Do not place promotional language in utility or authentication templates.
- Do not request prohibited sensitive data.
- Confirm that the message complies with policies in every destination market.

### 6.2 Common rejection or reclassification causes

- Incorrect category
- Vague content or variables without context
- Excessive variables relative to fixed text
- Missing or unrealistic sample values
- Invalid variable placement
- Broken, shortened, or suspicious links
- Misleading claims or spam-like formatting
- Prohibited goods, services, or sensitive-data requests
- Multiple near-identical templates intended to avoid enforcement

Meta may approve, reject, reclassify, pause, or disable a template at any time.
An approval should therefore be treated as revocable state, not a permanent
property.

## 7. Pricing model

WhatsApp Business Platform pricing is generally per delivered message. Meta
determines the charge using:

- The recipient's market
- Message category
- Applicable volume tier
- Whether a customer-service or free-entry-point window applies
- Current rate-card rules

Messages that fail before delivery are generally not billed as delivered
messages. Provider fees may follow different rules.

| Message type | General Meta treatment |
| --- | --- |
| Marketing template | Charged per delivered message |
| Authentication template | Charged per delivered message |
| Utility template outside the service window | Charged per delivered message |
| Utility template sent in response during the service window | Currently free under Meta's published pricing |
| Service message during the 24-hour window | Currently free under Meta's published pricing |
| Qualifying free-entry-point message | Free during the applicable 72-hour window |

### 7.1 Free-entry-point window

When a customer starts a conversation through a qualifying Click-to-WhatsApp ad
or Facebook Page call-to-action button, a 72-hour free-entry-point window may
apply. Meta currently states that messages across categories are free during
that window. Preserve the referral data needed to establish eligibility.

### 7.2 Volume tiers

Meta offers volume tiers for utility and authentication messages. Discounts are
typically progressive: a tier's price applies to messages inside that tier, not
retroactively to all messages sent in the month.

### 7.3 Total platform cost

Budget for more than Meta's rate:

- Meta message fees
- Business Solution Provider or SaaS charges
- Per-message provider markup, if applicable
- Agent/inbox seats
- Automation and AI costs
- Click-to-WhatsApp advertising spend
- Taxes such as GST

Retrieve current rates from Meta's live rate card or pricing calculator. Do not
copy a historical India or international rate into permanent application logic.

## 8. Messaging and throughput limits

### 8.1 Business-initiated messaging limit

This limit controls how many unique users a registered business phone number may
initiate conversations with during a rolling 24-hour period. Common tiers have
included:

- 250 unique users
- 2,000 unique users
- 10,000 unique users
- 100,000 unique users
- Unlimited

The current starting tier and upgrade path depend on Meta's rollout, business
verification, phone-number status, message quality, and usage. Read the current
limit from WhatsApp Manager or the supported API field; do not infer it from an
old tier table.

This is a unique-recipient limit, not a raw-message limit. User-initiated service
conversations are treated differently from business-initiated outreach.

### 8.2 API throughput

Cloud API has account/phone-number throughput controls, plus a lower pair rate
for repeated messages to the same recipient. Eligible numbers may receive higher
throughput automatically. Template management and other Graph API endpoints
have separate limits.

Implementation requirements:

- Queue outbound messages.
- Rate-limit by phone-number ID and recipient.
- Use idempotency in campaign and retry jobs.
- Honor API retry guidance and `Retry-After` when provided.
- Apply exponential backoff with jitter for retryable failures.
- Do not retry permanent policy, template, or recipient errors indefinitely.

## 9. Supported message experiences

During an open service window, supported API versions can provide:

- Text
- Images
- Audio and voice messages
- Video
- Documents
- Stickers
- Locations
- Contacts
- Reactions
- Reply buttons
- List messages
- Product and multi-product messages
- Catalog experiences
- WhatsApp Flows
- Approved templates

Outside the window, outbound content must be represented by an approved template.
A template may include an approved media header.

Validate current API documentation for MIME type, file size, text length, media
caption, button count, and template-component limits. These constraints can vary
by API version and should be configuration, not scattered constants.

## 10. Prohibited and regulated content

WhatsApp prohibits illegal, deceptive, exploitative, offensive, or unsafe
activity. Restricted areas include, among others:

- Firearms
- Alcohol and tobacco
- Illegal, recreational, and prescription drugs in prohibited contexts
- Medical and healthcare products
- Hazardous goods
- Endangered wildlife
- Body parts or fluids
- Prohibited currency, ICO, and binary-option activity
- Real-money gambling, except limited approved uses and countries
- Adult products and services
- Dating services
- Multi-level marketing
- Payday loans, paycheck advances, peer-to-peer lending, debt collection, and
  bail bonds
- Fraudulent, misleading, or exploitative business models

Additional requirements:

- Do not impersonate another organization.
- Do not spam, deceive, or surprise recipients.
- Do not request full payment-card numbers, full financial-account numbers,
  government ID numbers, or comparable sensitive identifiers in chat.
- Do not share one customer's conversation or information with another customer.
- Do not send sexually explicit material or nudity.
- Apply local age, geographic, licensing, and regulatory gates.
- Do not assume that permission to discuss a regulated product also permits it
  to be sold through WhatsApp commerce features.

Meta prohibits use by political parties, politicians, political candidates, and
political campaigns. Government and public-safety uses have additional access
restrictions and may require a Solution Provider.

## 11. Quality, enforcement, and account health

Users can block, report, or provide negative feedback about business messages.
Meta uses these signals to determine phone-number and template quality.

Possible consequences include:

- Template pausing or disabling
- Template reclassification
- Reduced messaging capacity
- Restrictions on the WhatsApp Business Account
- Account suspension or termination

Monitor at least:

- Delivery, read, and failure rates
- Opt-out rate
- Block and complaint indicators when available
- Template quality and status changes
- Phone-number quality
- Messaging-limit status
- Campaign frequency per recipient

Stop or reduce campaigns when quality declines. Waiting for an account-level
restriction is not an acceptable control strategy.

## 12. Recommended application controls

Minimum recipient record:

```text
phone_number
whatsapp_user_id
last_user_message_at
global_opt_out_at
utility_opt_in_at
marketing_opt_in_at
calling_opt_in_at
consent_source
consent_version
locale
country_or_pricing_market
```

Minimum template record:

```text
meta_template_id
name
language
submitted_category
approved_category
status
quality_rating
components_version
last_synced_at
```

Pre-send policy logic:

```text
1. Confirm the recipient is not globally suppressed.
2. Confirm consent covers the intended message category.
3. Determine whether the 24-hour service window is open.
4. If closed, require an active approved template.
5. Confirm the approved category matches the use case.
6. Check regulated-content, age, country, and licensing rules.
7. Check phone-number/template health and messaging capacity.
8. Calculate or estimate cost using the current rate table.
9. Send through a rate-limited, idempotent queue.
10. Record message ID, consent evidence, category, delivery status, and charge.
```

Recommended message states:

```text
queued -> accepted -> sent -> delivered -> read
                         \-> failed
```

Billing estimates should be reconciled against delivered-message webhooks and
provider invoices, rather than the number of API requests.

## 13. Launch checklist

### Business and account

- [ ] Business information and support contacts are accurate.
- [ ] WhatsApp Business Account and phone number are correctly configured.
- [ ] Payment method and billing alerts are configured.
- [ ] Current messaging limit and number quality are visible to operations.

### Consent and privacy

- [ ] Opt-in copy names the business and WhatsApp channel.
- [ ] Consent records are auditable.
- [ ] Marketing and calling consent are separately controllable.
- [ ] Global and category opt-outs are enforced before sending.
- [ ] Privacy notice and data-retention policy cover WhatsApp data.
- [ ] Sensitive data is not requested in chat.

### Templates and content

- [ ] Each business-initiated use case has an approved template.
- [ ] Utility templates contain no promotional content.
- [ ] Samples, variables, links, languages, and fallbacks are tested.
- [ ] Template status is synchronized regularly from Meta.
- [ ] Prohibited and regulated-content checks are documented.

### Engineering and operations

- [ ] The service-window timestamp is derived from inbound webhooks.
- [ ] Webhook authenticity and duplicate delivery are handled.
- [ ] Sending is queued and rate-limited.
- [ ] Retries distinguish transient from permanent failures.
- [ ] Delivery statuses and estimated costs are stored.
- [ ] Human escalation is available for automated support.
- [ ] Quality and opt-out alerts have named owners.

## 14. Official references

Use these pages as the source of truth when this guide and Meta's current rules
differ:

- [WhatsApp Business Platform pricing](https://whatsappbusiness.com/products/platform-pricing/)
- [WhatsApp Business Messaging Policy](https://whatsappbusiness.com/policy/)
- [Meta Terms for WhatsApp Business](https://www.whatsapp.com/legal/meta-terms-whatsapp-business)
- [Meta WhatsApp Business Platform API collection](https://www.postman.com/meta/whatsapp-business-platform/overview)
- [Meta Blueprint: message templates](https://www.facebookblueprint.com/student/path/253055-message-templates)
- [Meta for Developers: WhatsApp documentation](https://developers.facebook.com/docs/whatsapp/)

## 15. Review schedule

Review this document:

- Before production launch
- Before entering a new recipient market
- Before supporting a regulated industry
- After upgrading the Graph API version
- Whenever Meta announces a pricing or policy change
- At least once per quarter

The compliance owner should record the review date, relevant Meta announcement,
and any required product or billing changes.
