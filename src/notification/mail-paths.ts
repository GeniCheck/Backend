export const DEFAULT_FRONTEND_URL = 'http://localhost:5180';

/** 직원용 1회성 링크의 프론트 경로. 실제 링크는 `${FRONTEND_URL}${경로}/${token}` */
export const MAIL_LINK_PATHS = {
  DECLARATION: '/verification/self-declare',
  SELF_EVALUATION: '/evaluation/self',
  EVALUATION_RESULT: '/evaluation/result',
  // TODO: 프론트 인재 추천 동의 페이지 경로 확정 후 수정
  REFERRAL_CONSENT: '/referral/consent',
} as const;
