CREATE TABLE "WhatsAppFlow" (
  "id" TEXT NOT NULL, "metaFlowId" TEXT, "name" TEXT NOT NULL,
  "categories" JSONB NOT NULL, "flowJson" JSONB NOT NULL,
  "endpointMode" TEXT NOT NULL DEFAULT 'NONE', "endpointUri" TEXT NOT NULL DEFAULT '',
  "status" TEXT NOT NULL DEFAULT 'LOCAL_DRAFT', "revision" INTEGER NOT NULL DEFAULT 1,
  "syncedRevision" INTEGER, "validationErrors" JSONB NOT NULL DEFAULT '[]',
  "remoteDetails" JSONB NOT NULL DEFAULT '{}', "operationToken" TEXT, "operationUntil" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP, "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "WhatsAppFlow_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppFlow_metaFlowId_key" ON "WhatsAppFlow"("metaFlowId");
CREATE TABLE "WhatsAppFlowSession" (
  "id" TEXT NOT NULL, "tokenHash" TEXT NOT NULL, "flowId" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL, "contactId" TEXT NOT NULL, "expiresAt" TIMESTAMP(3) NOT NULL,
  "selection" JSONB, "result" JSONB, "completedAt" TIMESTAMP(3),
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "WhatsAppFlowSession_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "WhatsAppFlowSession_tokenHash_key" ON "WhatsAppFlowSession"("tokenHash");
CREATE INDEX "WhatsAppFlowSession_expiresAt_idx" ON "WhatsAppFlowSession"("expiresAt");
CREATE INDEX "WhatsAppFlowSession_conversationId_idx" ON "WhatsAppFlowSession"("conversationId");
ALTER TABLE "WhatsAppFlowSession" ADD CONSTRAINT "WhatsAppFlowSession_flowId_fkey" FOREIGN KEY ("flowId") REFERENCES "WhatsAppFlow"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "WhatsAppFlowSession" ADD CONSTRAINT "WhatsAppFlowSession_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "WhatsAppFlowSession" ADD CONSTRAINT "WhatsAppFlowSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
