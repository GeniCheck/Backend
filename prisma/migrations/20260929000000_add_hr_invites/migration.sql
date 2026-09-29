-- HR invites are now tracked in the DB (previously stateless JWT-only,
-- which made it impossible to list pending invites or cancel one).
CREATE TABLE "hr_invites" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "hr_invites_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "hr_invites_token_key" ON "hr_invites"("token");

ALTER TABLE "hr_invites" ADD CONSTRAINT "hr_invites_companyId_fkey"
  FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
