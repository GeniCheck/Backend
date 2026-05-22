-- AlterTable: 기존 행에 임시 기본값으로 컬럼 추가 후 NOT NULL 제약 적용
ALTER TABLE "companies"
  ADD COLUMN "representativeName" TEXT NOT NULL DEFAULT '',
  ADD COLUMN "startDate"          TEXT NOT NULL DEFAULT '';

-- 임시 기본값 제거 (신규 행은 반드시 값을 넣어야 함)
ALTER TABLE "companies"
  ALTER COLUMN "representativeName" DROP DEFAULT,
  ALTER COLUMN "startDate"          DROP DEFAULT;
