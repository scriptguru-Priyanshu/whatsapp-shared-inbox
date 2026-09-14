# Configurable automated conversations

The application stores the complete appointment conversation as editable steps.
The client controls the trigger, questions, validation, slot selection, and
confirmation.

## Built-in trigger

`APPOINTMENT_BOOKED` supplies these fields:

- `patient_name`
- `patient_age`
- `appointment_datetime`
- `booking_reference`
- `client_phone`

From **Conversations**, a client can open the complete conversation and edit any
step.

- A custom message, using tokens such as `{{patient_name}}`; or
- An approved WhatsApp template, mapping each template parameter to a trigger
  field.

Custom messages rely on the 24-hour customer-service window. If a trigger might
fire outside that window, configure an approved template.

## Custom triggers

Clients can create trigger definitions from **Flows → New trigger**. A trigger
has a name and a set of fields that can be inserted into messages or mapped into
template parameters.

Fire a custom trigger from a trusted backend integration:

```http
POST /api/automations/triggers/PAYMENT_RECEIVED/fire
Content-Type: application/json

{
  "conversationId": "conversation_id_here",
  "data": {
    "amount": "₹1,499",
    "receipt_number": "REC-1042"
  }
}
```

Every field defined on the trigger must be supplied. The endpoint runs all
enabled flows associated with that trigger, in creation order.

> The project currently has no tenant/authentication middleware on its API.
> Before exposing custom trigger endpoints publicly, require authentication and
> verify that the caller owns the conversation and trigger.

## Template management

The Templates screen supports:

- Creating and submitting templates to Meta
- Editing supported utility and marketing templates
- Deleting templates through Meta's API
- Synchronizing current approval status

Meta fixes the structure of authentication templates, so the general editor
does not edit those templates. A template referenced by an automation flow must
be removed from that flow before it can be deleted.
