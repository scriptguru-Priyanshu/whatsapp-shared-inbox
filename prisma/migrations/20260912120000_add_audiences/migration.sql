CREATE TABLE "Audience" (
  "id" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Audience_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AudienceContact" (
  "audienceId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  CONSTRAINT "AudienceContact_pkey" PRIMARY KEY ("audienceId", "contactId"),
  CONSTRAINT "AudienceContact_audienceId_fkey" FOREIGN KEY ("audienceId") REFERENCES "Audience"("id") ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT "AudienceContact_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE
);

CREATE INDEX "AudienceContact_contactId_idx" ON "AudienceContact"("contactId");
