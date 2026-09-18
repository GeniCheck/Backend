-- Allow OTP records to target either an existing SMS phone number or an email address.
ALTER TABLE "otp_verifications"
  ALTER COLUMN "phone" DROP NOT NULL,
  ADD COLUMN "email" TEXT;