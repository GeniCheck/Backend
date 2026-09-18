-- Phone verification was removed from the authentication model.
ALTER TABLE "companies" DROP COLUMN "phone";

-- HR accounts now authenticate with their own email and password.
ALTER TABLE "hr_managers" ADD COLUMN "email" TEXT;
ALTER TABLE "hr_managers" ADD COLUMN "password" TEXT;
CREATE UNIQUE INDEX "hr_managers_email_key" ON "hr_managers"("email");
DROP INDEX "hr_managers_phone_key";
ALTER TABLE "hr_managers" DROP COLUMN "phone";
ALTER TABLE "otp_verifications" DROP COLUMN "phone";
