/** 자기선언 링크 유효 기간: 발송일 기준 KST 7일 뒤 23:59:59 */
export const DECLARATION_LINK_VALID_DAYS = 7;

// TODO(법무): 동의서 문안 확정 시 버전 갱신. 직원이 제출한 consentVersion이 이 값과 같아야 한다.
export const CURRENT_CONSENT_VERSION = '2026-10-01';

/** 자기선언 제출 시 모두 동의해야 하는 항목 */
export const REQUIRED_CONSENTS = ['EVALUATION', 'DATA_ACCESS', 'EVIDENCE_RETENTION'] as const;

/** 스냅샷에 저장되는 단일 선택형 선택지 형식 (Prisma Json에 넣을 수 있도록 type으로 선언) */
export type SnapshotOption = {
  optionId: string;
  label: string;
};
