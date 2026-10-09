const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/**
 * baseDate의 KST 날짜 기준으로 days일 뒤 23:59:59(KST)를 UTC Date로 반환한다.
 * 신규 흐름의 마감은 모두 KST 해당 일 23:59:59다.
 * - 자기평가 마감 = 퇴사일 + 3일
 * - 대표 검증 마감 = 퇴사일 + 15일
 * - 의견 마감 = 대표 검증 완료 + 7일
 *
 * @example
 * endOfDayKstAfter(new Date('2026-04-30'), 3) // 2026-05-03T23:59:59+09:00 (= 2026-05-03T14:59:59.000Z)
 */
export function endOfDayKstAfter(baseDate: Date, days: number): Date {
  // UTC 필드로 읽으면 KST 벽시계 시각이 되도록 9시간을 더한다
  const kst = new Date(baseDate.getTime() + KST_OFFSET_MS);

  // Date.UTC가 월말·연말 넘김을 처리한다
  const endOfDayKstAsUtc = Date.UTC(
    kst.getUTCFullYear(),
    kst.getUTCMonth(),
    kst.getUTCDate() + days,
    23,
    59,
    59,
    0,
  );

  return new Date(endOfDayKstAsUtc - KST_OFFSET_MS);
}
