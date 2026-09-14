CREATE TABLE "HostedSignupRequest" (
  "id" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "pinCiphertext" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "wabaId" TEXT,
  "metaBusinessId" TEXT,
  "errorMessage" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "completedAt" TIMESTAMP(3),
  CONSTRAINT "HostedSignupRequest_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "HostedSignupRequest_status_createdAt_idx" ON "HostedSignupRequest"("status", "createdAt");
