ALTER TABLE "Conversation" ADD COLUMN "claimedById" TEXT;
CREATE INDEX "Conversation_claimedById_idx" ON "Conversation"("claimedById");
ALTER TABLE "Conversation" ADD CONSTRAINT "Conversation_claimedById_fkey" FOREIGN KEY ("claimedById") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
