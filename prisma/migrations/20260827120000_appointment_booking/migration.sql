CREATE TYPE "AppointmentFlowStep" AS ENUM ('AWAITING_NAME', 'AWAITING_AGE', 'AWAITING_ID_LAST4', 'AWAITING_SLOT');

ALTER TABLE "Message" ADD COLUMN "replyId" TEXT;

CREATE TABLE "Patient" (
  "id" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "name" TEXT NOT NULL,
  "age" INTEGER NOT NULL,
  "idLast4" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "Patient_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentFlow" (
  "id" TEXT NOT NULL,
  "conversationId" TEXT NOT NULL,
  "step" "AppointmentFlowStep" NOT NULL,
  "name" TEXT,
  "age" INTEGER,
  "idLast4" TEXT,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMP(3) NOT NULL,
  CONSTRAINT "AppointmentFlow_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "AppointmentSlot" (
  "id" TEXT NOT NULL,
  "startsAt" TIMESTAMP(3) NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "AppointmentSlot_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "Appointment" (
  "id" TEXT NOT NULL,
  "reference" TEXT NOT NULL,
  "slotId" TEXT NOT NULL,
  "patientId" TEXT NOT NULL,
  "contactId" TEXT NOT NULL,
  "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "Appointment_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Patient_contactId_key" ON "Patient"("contactId");
CREATE UNIQUE INDEX "AppointmentFlow_conversationId_key" ON "AppointmentFlow"("conversationId");
CREATE UNIQUE INDEX "AppointmentSlot_startsAt_key" ON "AppointmentSlot"("startsAt");
CREATE INDEX "AppointmentSlot_startsAt_idx" ON "AppointmentSlot"("startsAt");
CREATE UNIQUE INDEX "Appointment_reference_key" ON "Appointment"("reference");
CREATE UNIQUE INDEX "Appointment_slotId_key" ON "Appointment"("slotId");
CREATE INDEX "Appointment_patientId_idx" ON "Appointment"("patientId");
CREATE INDEX "Appointment_contactId_idx" ON "Appointment"("contactId");

ALTER TABLE "Patient" ADD CONSTRAINT "Patient_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "AppointmentFlow" ADD CONSTRAINT "AppointmentFlow_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_slotId_fkey" FOREIGN KEY ("slotId") REFERENCES "AppointmentSlot"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_patientId_fkey" FOREIGN KEY ("patientId") REFERENCES "Patient"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Appointment" ADD CONSTRAINT "Appointment_contactId_fkey" FOREIGN KEY ("contactId") REFERENCES "Contact"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
