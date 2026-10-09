/** 신규 흐름 평가 점수 범위 (자기평가·대표 검증·공통 역량 공통) */
export const SCORE_MIN = 1;
export const SCORE_MAX = 10;

export function isValidScore(score: unknown): score is number {
  return Number.isInteger(score) && (score as number) >= SCORE_MIN && (score as number) <= SCORE_MAX;
}
