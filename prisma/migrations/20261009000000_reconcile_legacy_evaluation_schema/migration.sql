-- 레거시 평가 흐름 스키마 복구
-- schema.prisma에는 있으나 기존 마이그레이션에 누락된 레거시 테이블 5개와 employments 컬럼 4개를 생성한다.
-- 기존 DB에 이미 존재하면 이 파일을 실행하지 말고 'prisma migrate resolve --applied 20261009000000_reconcile_legacy_evaluation_schema' 처리한다.

-- AlterTable
ALTER TABLE "employments" ADD COLUMN     "evaluationCloseAt" TIMESTAMP(3),
ADD COLUMN     "evaluationOpenAt" TIMESTAMP(3),
ADD COLUMN     "rehireIntent" TEXT,
ADD COLUMN     "windowClosed" BOOLEAN NOT NULL DEFAULT false;

-- CreateTable
CREATE TABLE "evaluation_links" (
    "id" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'pending',
    "expiresAt" TIMESTAMP(3) NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "evaluation_links_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaration_questions" (
    "id" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "order" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declaration_questions_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "declaration_answers" (
    "id" TEXT NOT NULL,
    "questionId" TEXT NOT NULL,
    "content" TEXT NOT NULL,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "declaration_answers_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "self_evaluation_scores" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "score" INTEGER NOT NULL,
    "submittedAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "self_evaluation_scores_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ceo_evaluation_scores" (
    "id" TEXT NOT NULL,
    "answerId" TEXT NOT NULL,
    "employmentId" TEXT NOT NULL,
    "score" INTEGER,
    "submittedAt" TIMESTAMP(3),
    "createdAt" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "ceo_evaluation_scores_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_links_employmentId_key" ON "evaluation_links"("employmentId");

-- CreateIndex
CREATE UNIQUE INDEX "evaluation_links_token_key" ON "evaluation_links"("token");

-- CreateIndex
CREATE UNIQUE INDEX "declaration_answers_questionId_key" ON "declaration_answers"("questionId");

-- CreateIndex
CREATE UNIQUE INDEX "self_evaluation_scores_answerId_key" ON "self_evaluation_scores"("answerId");

-- CreateIndex
CREATE UNIQUE INDEX "ceo_evaluation_scores_answerId_key" ON "ceo_evaluation_scores"("answerId");

-- AddForeignKey
ALTER TABLE "evaluation_links" ADD CONSTRAINT "evaluation_links_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaration_questions" ADD CONSTRAINT "declaration_questions_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "declaration_answers" ADD CONSTRAINT "declaration_answers_questionId_fkey" FOREIGN KEY ("questionId") REFERENCES "declaration_questions"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_evaluation_scores" ADD CONSTRAINT "self_evaluation_scores_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "declaration_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "self_evaluation_scores" ADD CONSTRAINT "self_evaluation_scores_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_evaluation_scores" ADD CONSTRAINT "ceo_evaluation_scores_answerId_fkey" FOREIGN KEY ("answerId") REFERENCES "declaration_answers"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ceo_evaluation_scores" ADD CONSTRAINT "ceo_evaluation_scores_employmentId_fkey" FOREIGN KEY ("employmentId") REFERENCES "employments"("id") ON DELETE CASCADE ON UPDATE CASCADE;

