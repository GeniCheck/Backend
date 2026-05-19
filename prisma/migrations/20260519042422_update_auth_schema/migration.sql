/*
  Warnings:

  - Added the required column `phone` to the `companies` table without a default value. This is not possible if the table is not empty.
  - Made the column `name` on table `hr_managers` required. This step will fail if there are existing NULL values in that column.

*/
-- AlterTable: applicants - add isEmailVerified
ALTER TABLE "applicants" ADD COLUMN "isEmailVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: companies - add isPaid, isVerified
ALTER TABLE "companies"
ADD COLUMN "isPaid"     BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN "isVerified" BOOLEAN NOT NULL DEFAULT false;

-- AlterTable: companies - add phone (nullable first, backfill, then set NOT NULL)
ALTER TABLE "companies" ADD COLUMN "phone" TEXT;
UPDATE "companies" SET "phone" = '000-0000-0000' WHERE "phone" IS NULL;
ALTER TABLE "companies" ALTER COLUMN "phone" SET NOT NULL;

-- AlterTable: hr_managers - make name NOT NULL (backfill NULLs first)
UPDATE "hr_managers" SET "name" = '' WHERE "name" IS NULL;
ALTER TABLE "hr_managers" ALTER COLUMN "name" SET NOT NULL;

-- CreateTable: otp_verifications
CREATE TABLE "otp_verifications" (
    "id"        TEXT NOT NULL,
    "phone"     TEXT NOT NULL,
    "code"      TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "failCount" INTEGER NOT NULL DEFAULT 0,
    "isUsed"    BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "otp_verifications_pkey" PRIMARY KEY ("id")
);
