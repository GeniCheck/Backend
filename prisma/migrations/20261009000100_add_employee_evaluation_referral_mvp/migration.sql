-- CreateEnum
CREATE TYPE "EmploymentStatus" AS ENUM ('EMPLOYED', 'RESIGNED');

-- CreateEnum
CREATE TYPE "DeclarationStatus" AS ENUM ('NOT_SENT', 'SENT', 'SUBMITTED');

-- CreateEnum
CREATE TYPE "TemplateStatus" AS ENUM ('ACTIVE', 'ARCHIVED');

-- CreateEnum
CREATE TYPE "QuestionType" AS ENUM ('SCORE', 'SINGLE_CHOICE', 'TEXT');

-- CreateEnum
CREATE TYPE "EvaluationStatus" AS ENUM ('SELF_PENDING', 'CEO_PENDING', 'SELF_EXPIRED', 'COMPLETED', 'CEO_EXPIRED');

-- CreateEnum
CREATE TYPE "CompetencyKey" AS ENUM ('TRUST', 'DILIGENCE', 'RESPONSIBILITY', 'COLLABORATION', 'COMMUNICATION', 'GROWTH_POTENTIAL');

-- CreateEnum
CREATE TYPE "LinkPurpose" AS ENUM ('DECLARATION', 'SELF_EVALUATION', 'EVALUATION_RESULT', 'REFERRAL_CONSENT');

-- CreateEnum
CREATE TYPE "ReferralConsentStatus" AS ENUM ('PENDING', 'AGREED', 'WITHDRAWN', 'EXPIRED');

-- CreateEnum
CREATE TYPE "ReferralPostStatus" AS ENUM ('PUBLISHED', 'HIDDEN', 'EXPIRED', 'DELETED');

-- CreateEnum
CREATE TYPE "DisplayNameMode" AS ENUM ('REAL_NAME', 'ANONYMOUS');

-- CreateEnum
CREATE TYPE "AuditActorType" AS ENUM ('COMPANY', 'HR_MANAGER', 'EMPLOYEE', 'SYSTEM');

-- CreateTable
CREATE TABLE "employees" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "phone" TEXT,
    "department" TEXT,
    "position" TEXT,
    "employmentStartDate" TIMESTAMP(3) NOT NULL,
    "employmentStatus" "EmploymentStatus" NOT NULL DEFAULT 'EMPLOYED',
    "declarationStatus" "DeclarationStatus" NOT NULL DEFAULT 'NOT_SENT',
    "resignationDate" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "employees_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "question_templates" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "description" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "status" "TemplateStatus" NOT NULL DEFAULT 'ACTIVE',
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "question_templates_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "template_questions" (
    "id" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL DEFAULT true,
    "scoreMin" INTEGER,
    "scoreMax" INTEGER,
    "options" JSONB,
    "maxLength" INTEGER,
    "evaluationEnabled" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "template_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declarations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "templateId" TEXT NOT NULL,
    "templateName" TEXT NOT NULL,
    "templateVersion" INTEGER NOT NULL,
    "status" "DeclarationStatus" NOT NULL DEFAULT 'SENT',
    "sentAt" TIMESTAMP(3) NOT NULL,
    "submittedAt" TIMESTAMP(3),
    "consentEvaluation" BOOLEAN NOT NULL DEFAULT false,
    "consentDataAccess" BOOLEAN NOT NULL DEFAULT false,
    "consentEvidenceRetention" BOOLEAN NOT NULL DEFAULT false,
    "consentVersion" TEXT,
    "consentAgreedAt" TIMESTAMP(3),
    "consentIp" TEXT,
    "consentUserAgent" TEXT,

    CONSTRAINT "declarations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaration_question_snapshots" (
    "id" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "type" "QuestionType" NOT NULL,
    "text" TEXT NOT NULL,
    "required" BOOLEAN NOT NULL,
    "scoreMin" INTEGER,
    "scoreMax" INTEGER,
    "options" JSONB,
    "maxLength" INTEGER,
    "evaluationEnabled" BOOLEAN NOT NULL,

    CONSTRAINT "declaration_question_snapshots_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaration_responses" (
    "id" TEXT NOT NULL,
    "snapshotQuestionId" TEXT NOT NULL,
    "answerScore" INTEGER,
    "answerOptionId" TEXT,
    "answerText" TEXT,

    CONSTRAINT "declaration_responses_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluations" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "declarationId" TEXT NOT NULL,
    "status" "EvaluationStatus" NOT NULL DEFAULT 'SELF_PENDING',
    "resignationDate" TIMESTAMP(3) NOT NULL,
    "selfEvaluationDueAt" TIMESTAMP(3) NOT NULL,
    "ceoEvaluationDueAt" TIMESTAMP(3) NOT NULL,
    "selfSubmittedAt" TIMESTAMP(3),
    "rehireIntent" BOOLEAN,
    "completedAt" TIMESTAMP(3),
    "opinionDueAt" TIMESTAMP(3),
    "resultViewedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluations_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_items" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "snapshotQuestionId" TEXT NOT NULL,
    "order" INTEGER NOT NULL,
    "selfScore" INTEGER,
    "ceoScore" INTEGER,

    CONSTRAINT "evaluation_items_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "competency_scores" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "key" "CompetencyKey" NOT NULL,
    "score" INTEGER NOT NULL,

    CONSTRAINT "competency_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "evaluation_opinions" (
    "id" TEXT NOT NULL,
    "evaluationId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_opinions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "access_links" (
    "id" TEXT NOT NULL,
    "purpose" "LinkPurpose" NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "targetId" TEXT NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "usedAt" TIMESTAMP(3),
    "revokedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "access_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_consents" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "status" "ReferralConsentStatus" NOT NULL DEFAULT 'PENDING',
    "displayNameMode" "DisplayNameMode" NOT NULL,
    "sentAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "agreedAt" TIMESTAMP(3),
    "withdrawnAt" TIMESTAMP(3),
    "agreedIp" TEXT,
    "agreedUserAgent" TEXT,

    CONSTRAINT "referral_consents_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "resume_files" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "objectKey" TEXT NOT NULL,
    "fileName" TEXT NOT NULL,
    "contentType" TEXT NOT NULL,
    "fileSize" INTEGER NOT NULL,
    "uploadedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "resume_files_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "referral_posts" (
    "id" TEXT NOT NULL,
    "companyId" TEXT NOT NULL,
    "employeeId" TEXT NOT NULL,
    "referralConsentId" TEXT NOT NULL,
    "resumeFileId" TEXT,
    "title" TEXT NOT NULL,
    "recommendationReason" TEXT NOT NULL,
    "displayNameMode" "DisplayNameMode" NOT NULL,
    "status" "ReferralPostStatus" NOT NULL DEFAULT 'PUBLISHED',
    "publishedAt" TIMESTAMP(3) NOT NULL,
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "referral_posts_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "audit_logs" (
    "id" TEXT NOT NULL,
    "actorType" "AuditActorType" NOT NULL,
    "actorId" TEXT,
    "action" TEXT NOT NULL,
    "targetType" TEXT NOT NULL,
    "targetId" TEXT,
    "ip" TEXT,
    "userAgent" TEXT,
    "metadata" JSONB,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "audit_logs_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "employees_companyId_email_key" ON "employees"("companyId", "email");

-- CreateIndex
CREATE UNIQUE INDEX "employees_id_companyId_key" ON "employees"("id", "companyId");

-- CreateIndex
CREATE INDEX "question_templates_companyId_idx" ON "question_templates"("companyId");

-- CreateIndex
CREATE UNIQUE INDEX "template_questions_templateId_order_key" ON "template_questions"("templateId", "order");

-- CreateIndex
CREATE INDEX "declarations_companyId_idx" ON "declarations"("companyId");

-- CreateIndex
CREATE INDEX "declarations_employeeId_idx" ON "declarations"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "declaration_question_snapshots_declarationId_order_key" ON "declaration_question_snapshots"("declarationId", "order");

-- CreateIndex
CREATE UNIQUE INDEX "declaration_responses_snapshotQuestionId_key" ON "declaration_responses"("snapshotQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluations_declarationId_key" ON "evaluations"("declarationId");

-- CreateIndex
CREATE INDEX "evaluations_companyId_idx" ON "evaluations"("companyId");

-- CreateIndex
CREATE INDEX "evaluations_employeeId_idx" ON "evaluations"("employeeId");

-- CreateIndex
CREATE INDEX "evaluations_status_selfEvaluationDueAt_idx" ON "evaluations"("status", "selfEvaluationDueAt");

-- CreateIndex
CREATE INDEX "evaluations_status_ceoEvaluationDueAt_idx" ON "evaluations"("status", "ceoEvaluationDueAt");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_items_evaluationId_snapshotQuestionId_key" ON "evaluation_items"("evaluationId", "snapshotQuestionId");

-- CreateIndex
CREATE UNIQUE INDEX "competency_scores_evaluationId_key_key" ON "competency_scores"("evaluationId", "key");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_opinions_evaluationId_key" ON "evaluation_opinions"("evaluationId");

-- CreateIndex
CREATE UNIQUE INDEX "access_links_tokenHash_key" ON "access_links"("tokenHash");

-- CreateIndex
CREATE INDEX "access_links_purpose_targetId_idx" ON "access_links"("purpose", "targetId");

-- CreateIndex
CREATE INDEX "access_links_expiresAt_idx" ON "access_links"("expiresAt");

-- CreateIndex
CREATE INDEX "referral_consents_companyId_idx" ON "referral_consents"("companyId");

-- CreateIndex
CREATE INDEX "referral_consents_employeeId_idx" ON "referral_consents"("employeeId");

-- CreateIndex
CREATE UNIQUE INDEX "resume_files_objectKey_key" ON "resume_files"("objectKey");

-- CreateIndex
CREATE INDEX "resume_files_companyId_idx" ON "resume_files"("companyId");

-- CreateIndex
CREATE INDEX "resume_files_employeeId_idx" ON "resume_files"("employeeId");

-- CreateIndex
CREATE INDEX "referral_posts_companyId_idx" ON "referral_posts"("companyId");

-- CreateIndex
CREATE INDEX "referral_posts_employeeId_idx" ON "referral_posts"("employeeId");

-- CreateIndex
CREATE INDEX "referral_posts_status_expiresAt_idx" ON "referral_posts"("status", "expiresAt");

-- CreateIndex
CREATE INDEX "audit_logs_targetType_targetId_idx" ON "audit_logs"("targetType", "targetId");

-- AddForeignKey
ALTER TABLE "employees" ADD CONSTRAINT "employees_companyId_fkey" FOREIGN KEY ("companyId") REFERENCES "companies"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "template_questions" ADD CONSTRAINT "template_questions_templateId_fkey" FOREIGN KEY ("templateId") REFERENCES "question_templates"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declarations" ADD CONSTRAINT "declarations_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaration_question_snapshots" ADD CONSTRAINT "declaration_question_snapshots_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "declarations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaration_responses" ADD CONSTRAINT "declaration_responses_snapshotQuestionId_fkey" FOREIGN KEY ("snapshotQuestionId") REFERENCES "declaration_question_snapshots"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluations" ADD CONSTRAINT "evaluations_declarationId_fkey" FOREIGN KEY ("declarationId") REFERENCES "declarations"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_items" ADD CONSTRAINT "evaluation_items_snapshotQuestionId_fkey" FOREIGN KEY ("snapshotQuestionId") REFERENCES "declaration_question_snapshots"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "competency_scores" ADD CONSTRAINT "competency_scores_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "evaluation_opinions" ADD CONSTRAINT "evaluation_opinions_evaluationId_fkey" FOREIGN KEY ("evaluationId") REFERENCES "evaluations"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_consents" ADD CONSTRAINT "referral_consents_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "resume_files" ADD CONSTRAINT "resume_files_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_posts" ADD CONSTRAINT "referral_posts_employeeId_companyId_fkey" FOREIGN KEY ("employeeId", "companyId") REFERENCES "employees"("id", "companyId") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_posts" ADD CONSTRAINT "referral_posts_referralConsentId_fkey" FOREIGN KEY ("referralConsentId") REFERENCES "referral_consents"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "referral_posts" ADD CONSTRAINT "referral_posts_resumeFileId_fkey" FOREIGN KEY ("resumeFileId") REFERENCES "resume_files"("id") ON DELETE SET NULL ON UPDATE CASCADE;

