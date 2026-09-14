ALTER TABLE "MetaWebhookEvent"
  ADD COLUMN "deliveryKey" TEXT,
  ADD COLUMN "attempts" INTEGER NOT NULL DEFAULT 0,
  ADD COLUMN "nextAttemptAt" TIMESTAMP(3);

CREATE UNIQUE INDEX "MetaWebhookEvent_deliveryKey_key" ON "MetaWebhookEvent"("deliveryKey");
CREATE INDEX "MetaWebhookEvent_status_nextAttemptAt_idx" ON "MetaWebhookEvent"("status", "nextAttemptAt");
