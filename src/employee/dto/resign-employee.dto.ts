import { ApiProperty } from '@nestjs/swagger';
import { IsIn, IsNotEmpty, IsString, Matches } from 'class-validator';
import { DATE_ONLY_PATTERN } from './create-employee.dto';

export const SELF_EVALUATION_SEND_CHANNELS = ['EMAIL'] as const;

export class ResignEmployeeDto {
  @ApiProperty({ example: 'uuid', description: '퇴사 처리할 직원 ID' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  // 형식(YYYY-MM-DD)만 여기서 400으로 거르고, 달력에 없는 날짜·입사일 이전은 서비스에서 422로 판정
  @ApiProperty({ example: '2026-04-30', description: '퇴사일 (YYYY-MM-DD, 입사일 이후)' })
  @IsString()
  @Matches(DATE_ONLY_PATTERN, { message: 'resignationDate는 YYYY-MM-DD 형식이어야 합니다.' })
  resignationDate!: string;

  @ApiProperty({ enum: SELF_EVALUATION_SEND_CHANNELS, example: 'EMAIL', description: '자기평가 링크 발송 채널 (MVP는 EMAIL만)' })
  @IsIn(SELF_EVALUATION_SEND_CHANNELS)
  selfEvaluationSendChannel!: (typeof SELF_EVALUATION_SEND_CHANNELS)[number];
}
