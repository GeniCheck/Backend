-- =====================================================================
-- 인재 추천 게시물 목데이터 10건 (프론트 목록 API 연동 확인용)
--
-- 넣는 데이터
--   - 목데이터 기업 4곳 (이메일 @mock.genicheck.local, 로그인 불가)
--   - 기업별 퇴사 직원 + 추천 게시 동의(AGREED) + 공개 게시물(PUBLISHED) 10건
--   - 2건은 익명(ANONYMOUS) → 목록에서 이름이 "김**"처럼 마스킹되어 보임
--
-- 다시 실행해도 중복되지 않는다: 실행할 때마다 기존 목데이터를 지우고 새로 넣는다.
-- 지울 때는 referral-posts.cleanup.sql 실행.
--
-- 실행 (서버): sudo docker exec -i genicheck-postgres psql -U postgres -d genicheck -v ON_ERROR_STOP=1 < referral-posts.seed.sql
-- =====================================================================

BEGIN;

-- 1) 기존 목데이터 정리 (FK가 Restrict라 게시물 → 동의 → 직원 → 기업 순서)
DELETE FROM referral_posts    WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM referral_consents WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM employees         WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM companies         WHERE email LIKE '%@mock.genicheck.local';

-- 2) 목데이터 기업 (비밀번호는 bcrypt 해시가 아니라 로그인할 수 없음)
INSERT INTO companies (id, email, password, "companyName", "businessNumber", "representativeName", "startDate", "isVerified", "isPaid", "createdAt", "updatedAt")
VALUES
  (gen_random_uuid()::text, 'stone@mock.genicheck.local',   'MOCK-ACCOUNT-NO-LOGIN', 'Stone Corp.',       'MOCK000001', '목데이터', '20200101', false, false, now(), now()),
  (gen_random_uuid()::text, 'techflow@mock.genicheck.local', 'MOCK-ACCOUNT-NO-LOGIN', '테크플로우(주)',     'MOCK000002', '목데이터', '20200101', false, false, now(), now()),
  (gen_random_uuid()::text, 'insight@mock.genicheck.local',  'MOCK-ACCOUNT-NO-LOGIN', '인사이트코퍼레이션', 'MOCK000003', '목데이터', '20200101', false, false, now(), now()),
  (gen_random_uuid()::text, 'growth@mock.genicheck.local',   'MOCK-ACCOUNT-NO-LOGIN', '그로스벤처(주)',     'MOCK000004', '목데이터', '20200101', false, false, now(), now());

-- 3) 직원 → 동의 → 게시물
WITH data (company_email, emp_key, name, department, position, display_mode, publish_months, days_ago, title, reason) AS (
  VALUES
    ('stone@mock.genicheck.local',    'm01', '강태양', '개발팀',     '부장', 'REAL_NAME', 6,  1, '대규모 MSA 전환을 이끈 백엔드 리드',         'Spring Boot 기반 MSA 설계 경험이 많고 납기 준수율 100%를 유지했습니다. 5년간 팀을 이끌며 후배 성장도 도왔습니다.'),
    ('stone@mock.genicheck.local',    'm02', '이서연', '마케팅팀',   '대리', 'REAL_NAME', 3,  2, '데이터로 성과를 내는 퍼포먼스 마케터',       '메타·구글 통합 퍼포먼스 운영으로 ROAS 340%를 달성했습니다. 데이터 기반 의사결정 역량이 뛰어납니다.'),
    ('stone@mock.genicheck.local',    'm03', '박지호', '영업팀',     '사원', 'REAL_NAME', 3,  3, '고객 관계를 꾸준히 넓혀 온 B2B 영업 담당자', 'SaaS 솔루션 B2B 영업에서 분기 목표 110%를 달성했습니다. 고객 관계 관리 능력이 검증된 인재입니다.'),
    ('techflow@mock.genicheck.local', 'm04', '김도현', '디자인팀',   '과장', 'ANONYMOUS', 6,  4, '핀테크 앱 UX를 설계한 프로덕트 디자이너',   '핀테크·커머스 앱 UX 설계 전문가입니다. Figma 디자인 시스템 구축과 사용자 리서치 역량을 갖췄습니다.'),
    ('techflow@mock.genicheck.local', 'm05', '한지우', '개발팀',     '대리', 'REAL_NAME', 3,  6, '사용자 경험에 강한 프론트엔드 개발자',       'React와 TypeScript로 주요 서비스 화면을 개발했고 웹 성능을 40% 개선했습니다. 협업 태도가 훌륭합니다.'),
    ('insight@mock.genicheck.local',  'm06', '최유진', '전략팀',     '대리', 'REAL_NAME', 3,  7, 'KPI 대시보드를 만든 데이터 분석가',         'Python·SQL 기반 데이터 파이프라인과 KPI 대시보드를 구축했습니다. 임원 보고 자료 작성 역량이 뛰어납니다.'),
    ('insight@mock.genicheck.local',  'm07', '오세훈', '재무팀',     '과장', 'REAL_NAME', 6,  9, '꼼꼼한 결산과 예산 관리를 맡아 온 재무 담당자', '월별 결산을 한 번도 지연 없이 마감했고 예산 관리 프로세스를 정비했습니다. 신뢰할 수 있는 동료입니다.'),
    ('growth@mock.genicheck.local',   'm08', '정다인', 'HR팀',       '과장', 'REAL_NAME', 6, 10, '조직 문화를 함께 만든 HR 매니저',           '채용 프로세스와 성과 평가 체계를 정비했고 조직 문화 설계 경험이 풍부합니다. 스타트업부터 중견기업까지 경험했습니다.'),
    ('growth@mock.genicheck.local',   'm09', '윤하늘', '고객성공팀', '사원', 'ANONYMOUS', 3, 12, '고객 만족도를 끌어올린 고객 성공 매니저',   '온보딩 프로그램을 개선해 고객 이탈률을 낮췄습니다. 응대가 친절하고 문제 해결이 빠릅니다.'),
    ('growth@mock.genicheck.local',   'm10', '서민재', '인프라팀',   '차장', 'REAL_NAME', 6, 14, '안정적인 클라우드 인프라를 운영한 엔지니어', 'AWS 기반 인프라를 운영하며 가용성 99.95%를 유지했습니다. 장애 대응과 비용 최적화 경험이 많습니다.')
),
src AS (
  SELECT d.*, c.id AS company_id, gen_random_uuid()::text AS employee_id, gen_random_uuid()::text AS consent_id
  FROM data d
  JOIN companies c ON c.email = d.company_email
),
emp AS (
  INSERT INTO employees (id, "companyId", name, email, department, position, "employmentStartDate", "employmentStatus", "declarationStatus", "resignationDate", "createdAt", "updatedAt")
  SELECT employee_id, company_id, name, emp_key || '@mock.genicheck.local', department, position,
         now() - interval '3 years', 'RESIGNED'::"EmploymentStatus", 'SUBMITTED'::"DeclarationStatus",
         now() - (days_ago + 20) * interval '1 day', now(), now()
  FROM src
  RETURNING id
),
cons AS (
  INSERT INTO referral_consents (id, "companyId", "employeeId", status, "displayNameMode", "sentAt", "expiresAt", "agreedAt")
  SELECT consent_id, company_id, employee_id, 'AGREED'::"ReferralConsentStatus", display_mode::"DisplayNameMode",
         now() - (days_ago + 3) * interval '1 day', now() - (days_ago - 4) * interval '1 day', now() - (days_ago + 1) * interval '1 day'
  FROM src
  WHERE employee_id IN (SELECT id FROM emp)
  RETURNING id
)
INSERT INTO referral_posts (id, "companyId", "employeeId", "referralConsentId", title, "recommendationReason", "displayNameMode", status, "publishedAt", "expiresAt", "createdAt", "updatedAt")
SELECT gen_random_uuid()::text, company_id, employee_id, consent_id, title, reason, display_mode::"DisplayNameMode",
       'PUBLISHED'::"ReferralPostStatus",
       now() - days_ago * interval '1 day',
       now() - days_ago * interval '1 day' + publish_months * interval '1 month',
       now() - days_ago * interval '1 day', now() - days_ago * interval '1 day'
FROM src
WHERE consent_id IN (SELECT id FROM cons);

-- 4) 결과 확인 (10이 나와야 함)
SELECT count(*) AS mock_published_posts
FROM referral_posts p
JOIN companies c ON c.id = p."companyId"
WHERE c.email LIKE '%@mock.genicheck.local' AND p.status = 'PUBLISHED';

COMMIT;
