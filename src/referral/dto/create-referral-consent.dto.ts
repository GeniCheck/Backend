import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisplayNameMode } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  ArrayNotEmpty,
  ArrayUnique,
  IsArray,
  IsEnum,
  IsIn,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  Max,
  Min,
} from 'class-validator';
import { CONSENT_EXPIRES_IN_DAYS } from '../referral.constants';

export const CONSENT_CHANNELS = ['EMAIL'] as const;

export class CreateReferralConsentDto {
  @ApiProperty({ example: 'uuid', description: '추천할 퇴사 직원 ID' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ enum: CONSENT_CHANNELS, isArray: true, example: ['EMAIL'], description: '발송 채널 (MVP는 EMAIL만)' })
  @IsArray()
  @ArrayNotEmpty()
  @ArrayUnique()
  @IsIn(CONSENT_CHANNELS, { each: true })
  channels!: (typeof CONSENT_CHANNELS)[number][];

  @ApiProperty({ enum: DisplayNameMode, example: 'REAL_NAME', description: '게시물에 이름을 실명/익명으로 표시' })
  @IsEnum(DisplayNameMode)
  displayNameMode!: DisplayNameMode;

  @ApiPropertyOptional({
    example: CONSENT_EXPIRES_IN_DAYS.default,
    minimum: CONSENT_EXPIRES_IN_DAYS.min,
    maximum: CONSENT_EXPIRES_IN_DAYS.max,
    description: '동의 요청 유효 기간(일), 기본 7',
  })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(CONSENT_EXPIRES_IN_DAYS.min)
  @Max(CONSENT_EXPIRES_IN_DAYS.max)
  expiresInDays?: number;
}
