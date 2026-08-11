-- ==========================================
-- GeniCheck 테스트용 DB 확인 쿼리
-- ==========================================

-- 1. 최신 OTP 코드 확인 (전화번호별)
SELECT 
  phone, 
  code, 
  "isUsed", 
  "failCount",
  "expiresAt",
  "createdAt"
FROM "OtpVerification" 
WHERE phone = '01012345678'  -- 전화번호 입력
ORDER BY "createdAt" DESC 
LIMIT 3;

-- 2. 이메일 인증 코드 확인
SELECT 
  email, 
  code, 
  "isUsed", 
  "expiresAt",
  "createdAt"
FROM "EmailVerification" 
WHERE email = 'applicant@test.com'  -- 이메일 입력
ORDER BY "createdAt" DESC 
LIMIT 3;

-- 3. 모든 지원자 확인
SELECT 
  id, 
  email, 
  name, 
  "isEmailVerified",
  "createdAt"
FROM "Applicant"
ORDER BY "createdAt" DESC;

-- 4. 모든 기업 확인
SELECT 
  id, 
  email, 
  "companyName", 
  "companyCode",
  phone,
  "representativeName",
  "isVerified",
  "isPaid",
  "createdAt"
FROM "Company"
ORDER BY "createdAt" DESC;

-- 5. HR 매니저 확인
SELECT 
  hr.id,
  hr.name,
  hr.phone,
  hr."companyId",
  c."companyName",
  c."companyCode"
FROM "HrManager" hr
LEFT JOIN "Company" c ON hr."companyId" = c.id
ORDER BY hr."createdAt" DESC;

-- 6. Refresh Token 확인 (해시값)
SELECT 
  id, 
  email, 
  LEFT("refreshToken", 30) as "token_preview",
  "updatedAt"
FROM "Applicant"
WHERE "refreshToken" IS NOT NULL;

-- 7. 만료되지 않은 OTP 목록
SELECT 
  phone, 
  code, 
  "isUsed", 
  "failCount",
  "expiresAt",
  NOW() as "current_time",
  ("expiresAt" > NOW()) as "is_valid"
FROM "OtpVerification" 
WHERE "isUsed" = false
ORDER BY "createdAt" DESC;

-- 8. 테스트 데이터 삭제 (조심!)
-- DELETE FROM "OtpVerification" WHERE phone = '01012345678';
-- DELETE FROM "EmailVerification" WHERE email = 'applicant@test.com';
-- DELETE FROM "Applicant" WHERE email = 'applicant@test.com';
-- DELETE FROM "Company" WHERE email = 'company@test.com';

-- 9. 모든 테스트 데이터 초기화 (주의!)
-- TRUNCATE TABLE "OtpVerification" CASCADE;
-- TRUNCATE TABLE "EmailVerification" CASCADE;
-- TRUNCATE TABLE "HrManager" CASCADE;
-- TRUNCATE TABLE "Applicant" CASCADE;
-- TRUNCATE TABLE "Company" CASCADE;
