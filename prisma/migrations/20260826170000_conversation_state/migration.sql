ALTER TABLE "Conversation"
ADD COLUMN "closedAt" TIMESTAMP(3),
ADD COLUMN "unreadCount" INTEGER NOT NULL DEFAULT 0;

CREATE INDEX "Conversation_archivedAt_closedAt_idx" ON "Conversation"("archivedAt", "closedAt");
