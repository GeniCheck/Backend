import { CompetencyKey } from '@prisma/client';

/** 대표가 입력하는 공통 역량 6개 (응답 순서 = 이 배열 순서) */
export const COMMON_COMPETENCIES: { key: CompetencyKey; name: string }[] = [
  { key: 'TRUST', name: '신뢰' },
  { key: 'DILIGENCE', name: '성실성' },
  { key: 'RESPONSIBILITY', name: '책임감' },
  { key: 'COLLABORATION', name: '협업' },
  { key: 'COMMUNICATION', name: '의사소통' },
  { key: 'GROWTH_POTENTIAL', name: '성장 가능성' },
];

/** 대표 검증 완료 후 직원 의견 마감: 완료일 기준 KST 7일 뒤 23:59:59 */
export const OPINION_DUE_DAYS = 7;

/** 결과 확인 링크는 의견 마감 후에도 30일간 결과 열람용으로 유지 */
export const RESULT_LINK_EXTRA_DAYS = 30;

/** 결과 메일 발송 여부를 남기는 감사 로그 action (metadata.sent: boolean) */
export const RESULT_NOTIFIED_ACTION = 'EVALUATION_RESULT_NOTIFIED';

/** 직원 의견 최대 글자 수 */
export const OPINION_MAX_LENGTH = 1000;

/** 점수 차이 = 대표 점수 - 자기 점수. 둘 중 하나라도 없으면 null */
export function scoreGap(selfScore: number | null, ceoScore: number | null): number | null {
  return selfScore == null || ceoScore == null ? null : ceoScore - selfScore;
}
