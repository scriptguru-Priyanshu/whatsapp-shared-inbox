ALTER TABLE "WhatsAppConnection"
  ADD COLUMN "profileAbout" TEXT,
  ADD COLUMN "profileAddress" TEXT,
  ADD COLUMN "profileDescription" TEXT,
  ADD COLUMN "profileEmail" TEXT,
  ADD COLUMN "profilePictureUrl" TEXT,
  ADD COLUMN "profileWebsites" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  ADD COLUMN "profileVertical" TEXT;
