CREATE TABLE "ConversationBlueprint" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "enabled" BOOLEAN NOT NULL DEFAULT true,
    "triggerPhrases" JSONB NOT NULL,
    "steps" JSONB NOT NULL,
    "appointmentConfig" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "ConversationBlueprint_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "BlueprintSession" (
    "id" TEXT NOT NULL,
    "conversationId" TEXT NOT NULL,
    "blueprintId" TEXT NOT NULL,
    "currentStep" INTEGER NOT NULL DEFAULT 0,
    "data" JSONB NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,
    CONSTRAINT "BlueprintSession_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "BlueprintSession_conversationId_key" ON "BlueprintSession"("conversationId");
CREATE INDEX "BlueprintSession_blueprintId_idx" ON "BlueprintSession"("blueprintId");
ALTER TABLE "BlueprintSession" ADD CONSTRAINT "BlueprintSession_conversationId_fkey" FOREIGN KEY ("conversationId") REFERENCES "Conversation"("id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "BlueprintSession" ADD CONSTRAINT "BlueprintSession_blueprintId_fkey" FOREIGN KEY ("blueprintId") REFERENCES "ConversationBlueprint"("id") ON DELETE CASCADE ON UPDATE CASCADE;

INSERT INTO "ConversationBlueprint" ("id", "name", "description", "enabled", "triggerPhrases", "steps", "appointmentConfig", "updatedAt")
VALUES (
  'default_book_appointment',
  'Book appointment',
  'Collect patient details, offer an available slot, create the appointment, and confirm it.',
  true,
  '["book appointment", "book an appointment", "book_appointment"]'::jsonb,
  '[
    {"id":"ask_name","type":"COLLECT_TEXT","label":"Patient name","field":"patient_name","prompt":"Great — let’s book your appointment. What is the patient’s full name?","validation":"NAME","errorMessage":"Please enter a valid full name using letters. Example: Priya Sharma"},
    {"id":"ask_age","type":"COLLECT_NUMBER","label":"Patient age","field":"patient_age","prompt":"Thanks, {{patient_name}}. What is the patient’s age?","min":1,"max":120,"errorMessage":"Please enter an age from 1 to 120 using numbers only."},
    {"id":"ask_id","type":"COLLECT_TEXT","label":"ID last 4 digits","field":"id_last4","prompt":"For this demo, enter only the last 4 digits of the patient’s ID. Do not send the full Aadhaar number.","validation":"REGEX","pattern":"^\\d{4}$","errorMessage":"Please enter exactly 4 digits only. Example: 1234"},
    {"id":"choose_slot","type":"APPOINTMENT_SLOT","label":"Choose appointment slot","prompt":"Select one available appointment slot:","buttonText":"View available slots"},
    {"id":"confirmation","type":"SEND_MESSAGE","label":"Booking confirmation","message":"✅ Appointment booked successfully!\n\nPatient: {{patient_name}}\nDate and time: {{appointment_datetime}}\nBooking reference: {{booking_reference}}\n\nPlease arrive 10 minutes early."}
  ]'::jsonb,
  '{"nameField":"patient_name","ageField":"patient_age","idLast4Field":"id_last4"}'::jsonb,
  CURRENT_TIMESTAMP
);
