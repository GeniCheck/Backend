-- CreateTable
CREATE TABLE "consents" (
    "id" TEXT NOT NULL,
    "applicantId" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "step1" BOOLEAN NOT NULL DEFAULT false,
    "step1AgreedAt" TIMESTAMP(3),
    "step2" BOOLEAN NOT NULL DEFAULT false,
    "step2AgreedAt" TIMESTAMP(3),
    "agreedTerms" BOOLEAN NOT NULL DEFAULT false,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "consents_pkey" PRIMARY KEY ("id")
);

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_applicantId_fkey" FOREIGN KEY ("applicantId") REFERENCES "applicants"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "consents" ADD CONSTRAINT "consents_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE CASCADE ON UPDATE CASCADE;
