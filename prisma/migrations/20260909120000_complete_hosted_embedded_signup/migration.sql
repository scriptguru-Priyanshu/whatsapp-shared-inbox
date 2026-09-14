ALTER TABLE "WhatsAppConnection"
  ADD COLUMN "metaBusinessName" TEXT,
  ADD COLUMN "wabaName" TEXT,
  ADD COLUMN "tokenIssuedAt" TIMESTAMP(3),
  ADD COLUMN "tokenExpiresAt" TIMESTAMP(3),
  ALTER COLUMN "tokenCiphertext" DROP NOT NULL;

CREATE TABLE "MetaWebhookEvent" (
  "id" TEXT NOT NULL,
  "object" TEXT,
  "entryId" TEXT,
  "field" TEXT NOT NULL,
  "event" TEXT,
  "wabaId" TEXT,
  "phoneNumberId" TEXT,
  "payload" JSONB NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'RECEIVED',
  "errorMessage" TEXT,
  "receivedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "processedAt" TIMESTAMP(3),
  CONSTRAINT "MetaWebhookEvent_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "MetaWebhookEvent_field_receivedAt_idx" ON "MetaWebhookEvent"("field", "receivedAt");
CREATE INDEX "MetaWebhookEvent_event_receivedAt_idx" ON "MetaWebhookEvent"("event", "receivedAt");
CREATE INDEX "MetaWebhookEvent_wabaId_idx" ON "MetaWebhookEvent"("wabaId");
CREATE INDEX "MetaWebhookEvent_phoneNumberId_idx" ON "MetaWebhookEvent"("phoneNumberId");
CREATE INDEX "MetaWebhookEvent_status_idx" ON "MetaWebhookEvent"("status");
