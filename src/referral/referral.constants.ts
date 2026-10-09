/** 동의 요청 링크 유효 기간 (일) */
export const CONSENT_EXPIRES_IN_DAYS = { min: 1, max: 30, default: 7 } as const;

/** 같은 직원에게 24시간 안에 보낼 수 있는 동의 요청 횟수 */
export const CONSENT_REQUEST_LIMIT = { count: 3, windowMs: 24 * 60 * 60 * 1000 } as const;

/**
 * 동의 후 철회 링크 유효 기간 (일).
 * 동의 요청 링크는 기본 7일이지만, 동의 후에도 같은 링크로 언제든 철회할 수 있어야 하므로
 * 동의 시점에 링크 만료를 이 기간으로 늘린다. 게시물 최대 공개 기간(6개월)보다 충분히 길게 둔다.
 * TODO(법무): 철회 가능 기간 확정 후 조정
 */
export const WITHDRAWAL_LINK_VALID_DAYS = 365;

/** 게시물 공개 기간 선택지 (개월) */
export const PUBLISH_MONTHS_OPTIONS = [3, 6] as const;

/** 동의 화면에 보여 줄 추천 게시 목적 */
export const REFERRAL_PURPOSE =
  '퇴사 후 재취업을 돕기 위해 GeniCheck 가입 기업들이 볼 수 있는 인재 추천 게시판에 추천 게시물을 올립니다.';

export const DAY_MS = 24 * 60 * 60 * 1000;
