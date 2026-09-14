# WhatsApp Onboarding Model for Multiple Clinics

**Audience:** Product and operations team  
**Date:** 7 September 2026  
**Scope:** WhatsApp Business Platform onboarding for independent clinics; not legal advice.

## Executive answer

Do not use one provider-owned WhatsApp number/WABA as the public sender for multiple independent clinics. Our platform may serve many clinics, but each clinic should have its own WhatsApp Business Account (WABA), business identity and phone number, with our system receiving authorized access. Meta's service-provider terms expressly make the provider responsible for creating a WABA for each client.

## Why the shared-number approach does not work

- **Account structure:** Meta's service-provider terms say the provider is responsible for creating a WABA for each client. A pre-created WABA also cannot be assigned to a future client without Meta's written consent.
- **Identity:** WhatsApp requires accurate business-profile details and prohibits impersonating another business or misleading users about the business or affiliation. One sender switching among unrelated clinic identities creates a clear policy and patient-trust risk.
- **Consent:** The sender must have the patient's number and opt-in to receive messages. Consent given to Clinic A should not be treated as consent to messages from Clinic B or a generic platform identity.
- **Privacy and isolation:** Clinic conversations can contain sensitive health information. WhatsApp requires necessary permissions, legal compliance, and prohibits sharing one customer's chat with another. Separate client assets reduce accidental cross-clinic access and support clean offboarding.
- **Operational blast radius:** Quality problems, complaints, policy violations or payment issues on a shared asset can affect every clinic using it. WhatsApp may restrict or remove access for policy violations or poor quality.
- **Ownership and portability:** A client can request control of its WABA, and a service provider must assist with transfer. Separate WABAs make this practical.

## Recommended options

### 1. Embedded Signup — recommended for scale

Add Meta's Embedded Signup to our product. Each clinic signs in with Facebook, selects or creates its own Meta Business Portfolio and WABA, verifies its phone number and grants our app the required permissions. We retain the clinic's WABA ID and phone-number ID and operate as its authorized technology/service provider. This keeps assets client-specific while allowing one SaaS platform to manage many clinics.

Implementation requirements include an appropriate Meta app, business verification where requested, App Review/advanced permissions, secure token handling, webhooks, clinic consent to applicable terms, billing setup, and per-clinic data separation.

### 2. Guided manual onboarding — suitable for local/small clinics

Until Embedded Signup is ready, guide each clinic through:

1. Creating or using its own Meta Business Portfolio.
2. Creating its own WABA and registering a clinic-controlled phone number.
3. Completing business details/verification and accepting Meta/WhatsApp terms.
4. Adding payment details where required.
5. Authorizing our app or an approved provider through Meta's supported asset-sharing/onboarding flow.
6. Recording the clinic's WABA ID and phone-number ID in our tenant configuration.

The clinic should control its phone/SIM, legal identity and primary business assets. Do not ask for passwords or permanent administrator ownership.

### 3. Use a genuine Meta partner/BSP — valid, but verify carefully

A legitimate Solution Partner or Tech Provider can help onboard a clinic and obtain authorized access to the clinic's WABA. Asking for a WABA ID or Business Portfolio ID can be a normal implementation step. However, “send us screenshots and we will get Meta approval” is not, by itself, evidence of an official authorization method.

Before proceeding, require the provider to:

- show its current listing in Meta's official partner directory (or other verifiable Meta-issued status);
- identify the exact Meta flow, permissions and assets being shared;
- use a Meta-hosted login, Embedded Signup or Business Manager partner-access request that the clinic approves while logged in;
- provide a contract covering data processing, security, support, fees, ownership, export and offboarding; and
- confirm that every clinic receives a separate WABA and can regain/transfer control.

Never rely only on a badge, sales claim, screenshot, WABA ID, OTP request or informal “authorization letter.” A screenshot may help a partner open a support ticket, but it does not replace the clinic's consent, Meta permissions, or the required per-client WABA. Never share passwords, OTPs, recovery codes or unrestricted personal-profile access.

## Decision

Adopt a **one-clinic/one-WABA/one-clinic identity** architecture. Use guided manual onboarding for the pilot, then implement Embedded Signup for scale. A verified Meta partner is an acceptable accelerator, not an exception to client-specific WABAs and formal authorization.

## Sources

1. Meta, *Meta Terms for WhatsApp Business* (last modified 15 October 2025): https://www.whatsapp.com/legal/meta-terms-whatsapp-business
2. WhatsApp, *WhatsApp Business Terms for Service Providers* (last modified 12 June 2018): https://www.whatsapp.com/legal/business-terms-for-service-providers
3. WhatsApp, *WhatsApp Business Messaging Policy* (accessed 7 September 2026): https://whatsappbusiness.com/policy/
4. Meta, *Embedded Signup documentation* (official Meta collection hosted in the Postman API Network; accessed 7 September 2026): https://www.postman.com/meta/whatsapp-business-platform/documentation/du6gzjv/embedded-signup
5. Meta, *Find a Partner* (official directory, linked from WhatsApp Business): https://www.facebook.com/business/partner-directory/search

## Evidence note

Meta's current terms permit an authorized service provider to use the APIs on behalf of customers; they do not require the provider to be the public-facing business. The decisive requirement is that the provider create and manage a WABA for each client, preserve client access/portability, and follow authorization and messaging policies. No official Meta source reviewed describes screenshot submission alone as a substitute for these controls.
