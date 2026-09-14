ALTER TABLE "Message"
ADD COLUMN "templateLanguage" TEXT,
ADD COLUMN "templateComponents" JSONB,
ADD COLUMN "templateParameters" JSONB;
