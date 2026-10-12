-- =====================================================================
-- 인재 추천 목데이터 삭제 (referral-posts.seed.sql로 넣은 것만)
-- 이메일이 @mock.genicheck.local인 목데이터 기업과 그 직원·동의·게시물만 지운다. 실제 데이터는 건드리지 않는다.
--
-- 실행 (서버): sudo docker exec -i genicheck-postgres psql -U postgres -d genicheck -v ON_ERROR_STOP=1 < referral-posts.cleanup.sql
-- =====================================================================

BEGIN;

DELETE FROM referral_posts    WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM referral_consents WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM employees         WHERE "companyId" IN (SELECT id FROM companies WHERE email LIKE '%@mock.genicheck.local');
DELETE FROM companies         WHERE email LIKE '%@mock.genicheck.local';

-- 남은 목데이터 확인 (0이 나와야 함)
SELECT count(*) AS remaining_mock_companies FROM companies WHERE email LIKE '%@mock.genicheck.local';

COMMIT;
