import { ApiProperty } from '@nestjs/swagger';
import { StrictBoolean } from '../../core/decorators/strict-boolean.decorator';

/** 직원 동의. 동의 여부는 진짜 boolean만 허용 ("false" 문자열이 동의로 바뀌지 않도록) */
export class AgreeReferralConsentDto {
  @ApiProperty({ example: true, description: '추천 게시물 공개 동의 (false면 403 CONSENT_NOT_GIVEN)' })
  @StrictBoolean()
  recommendationAgreed!: boolean;

  @ApiProperty({ example: true, description: '이력서 공개 동의 (false면 403 CONSENT_NOT_GIVEN)' })
  @StrictBoolean()
  resumeDisclosureAgreed!: boolean;

  @ApiProperty({ example: true, description: '최종 확인 (false면 422 INVALID_CONSENT)' })
  @StrictBoolean()
  finalConfirmation!: boolean;
}

/** 직원 동의 철회 */
export class WithdrawReferralConsentDto {
  @ApiProperty({ example: true, description: '철회 최종 확인 (false면 422 INVALID_CONSENT)' })
  @StrictBoolean()
  finalConfirmation!: boolean;
}
