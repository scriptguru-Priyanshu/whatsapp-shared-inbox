CREATE TYPE "AutomationActionType" AS ENUM ('MESSAGE', 'TEMPLATE');

CREATE TABLE "AutomationFlow" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "trigger" TEXT NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "actionType" "AutomationActionType" NOT NULL,
    "messageBody" TEXT,
    "templateId" TEXT,
    "parameterMappings" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationFlow_pkey" PRIMARY KEY ("id")
);

CREATE INDEX "AutomationFlow_trigger_enabled_idx" ON "AutomationFlow"("trigger", "enabled");
CREATE INDEX "AutomationFlow_templateId_idx" ON "AutomationFlow"("templateId");

ALTER TABLE "AutomationFlow"
ADD CONSTRAINT "AutomationFlow_templateId_fkey"
FOREIGN KEY ("templateId") REFERENCES "MessageTemplate"("id")
ON DELETE SET NULL ON UPDATE CASCADE;

CREATE TABLE "AutomationTrigger" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "fields" JSONB NOT NULL,
    "system" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "AutomationTrigger_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "AutomationTrigger_key_key" ON "AutomationTrigger"("key");

INSERT INTO "AutomationTrigger" ("id", "key", "name", "description", "fields", "system", "updatedAt")
VALUES ('system_appointment_booked', 'APPOINTMENT_BOOKED', 'Appointment booked',
  'Runs after an appointment is successfully booked.',
  '[{"key":"patient_name","label":"Patient name"},{"key":"patient_age","label":"Patient age"},{"key":"appointment_datetime","label":"Appointment date and time"},{"key":"booking_reference","label":"Booking reference"},{"key":"client_phone","label":"Client phone"}]'::jsonb,
  true, CURRENT_TIMESTAMP);
