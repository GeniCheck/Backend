-- Disambiguate concurrent OTPs that target the same email for different flows
-- (e.g. CEO login OTP and HR login OTP both target the company's email).
-- Without this, requesting one invalidates the other via the "unused OTP" cleanup.
ALTER TABLE "otp_verifications"
  ADD COLUMN "purpose" TEXT;
