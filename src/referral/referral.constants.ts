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

/** 추천 사유 최대 글자 수 */
export const RECOMMENDATION_REASON_MAX_LENGTH = 200;

/**
 * 추천 게시물에 쓸 수 없는 표현 (부정 평가·민감 개인정보).
 * 추천 게시판은 긍정적인 추천만 허용하고, 차별 소지가 있는 개인 정보는 공개하지 않는다.
 * TODO(법무 검토): 금지 표현 목록 확정
 */
export const FORBIDDEN_RECOMMENDATION_WORDS = [
  '해고',
  '징계',
  '비추천',
  '소송',
  '횡령',
  '문제 직원',
  '나이',
  '결혼',
  '임신',
  '출산',
  '종교',
  '장애',
  '병력',
] as const;

/** 게시물 상세의 이력서 다운로드 URL 유효 시간 */
export const RESUME_DOWNLOAD_URL_TTL_SECONDS = 5 * 60;

/** 같은 날짜를 유지하며 개월 수를 더한다. 말일을 넘기면 그 달의 마지막 날로 맞춘다 (1/31 + 1개월 = 2/28) */
export function addMonths(date: Date, months: number): Date {
  const result = new Date(date.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0)).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** 익명 표시: 첫 글자만 남기고 나머지는 * (김민준 → 김**) */
export function maskName(name: string): string {
  const chars = [...name.trim()];
  if (chars.length <= 1) return '*';
  return chars[0] + '*'.repeat(chars.length - 1);
}
