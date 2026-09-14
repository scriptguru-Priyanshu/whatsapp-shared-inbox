ALTER TABLE "User" ADD COLUMN "role" TEXT NOT NULL DEFAULT 'AGENT';
ALTER TABLE "User" ADD COLUMN "active" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Conversation" ADD COLUMN "assigneeId" TEXT;
CREATE INDEX "Conversation_assigneeId_idx" ON "Conversation"("assigneeId");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_assigneeId_fkey" FOREIGN KEY ("assigneeId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
