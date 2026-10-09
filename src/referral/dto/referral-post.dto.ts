import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { DisplayNameMode } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsIn, IsInt, IsNotEmpty, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';
import { PUBLISH_MONTHS_OPTIONS } from '../referral.constants';

// 추천 사유의 글자 수(200자)·금지 표현은 서비스에서 422 INVALID_RECOMMENDATION_CONTENT로 판정
export class CreateReferralPostDto {
  @ApiProperty({ example: 'uuid', description: '추천할 퇴사 직원 ID (추천 게시 동의 AGREED 필요)' })
  @IsString()
  @IsNotEmpty()
  employeeId!: string;

  @ApiProperty({ example: '함께 일하고 싶은 프론트엔드 개발자', description: '제목 (100자 이내)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title!: string;

  @ApiProperty({ example: '협업과 일정 준수가 뛰어난 인재입니다.', description: '추천 사유 (200자 이내, 금지 표현 불가)' })
  @IsString()
  recommendationReason!: string;

  @ApiPropertyOptional({ example: 'uuid', description: '업로드가 끝난 이력서 ID (presigned-url 발급 → 업로드 후)' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  resumeFileId?: string;

  @ApiProperty({ enum: DisplayNameMode, example: 'REAL_NAME', description: '직원이 익명 공개에만 동의했다면 ANONYMOUS만 가능' })
  @IsEnum(DisplayNameMode)
  displayNameMode!: DisplayNameMode;

  @ApiProperty({ enum: PUBLISH_MONTHS_OPTIONS, example: 3, description: '게시 기간 (3 또는 6개월)' })
  @Type(() => Number)
  @IsIn(PUBLISH_MONTHS_OPTIONS)
  publishMonths!: (typeof PUBLISH_MONTHS_OPTIONS)[number];
}

export class UpdateReferralPostDto {
  @ApiPropertyOptional({ example: '함께 일하고 싶은 프론트엔드 개발자' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  title?: string;

  @ApiPropertyOptional({ example: '협업과 일정 준수가 뛰어나며 인수인계가 성실한 인재입니다.' })
  @IsOptional()
  @IsString()
  recommendationReason?: string;

  @ApiPropertyOptional({ enum: DisplayNameMode })
  @IsOptional()
  @IsEnum(DisplayNameMode)
  displayNameMode?: DisplayNameMode;

  @ApiPropertyOptional({ enum: PUBLISH_MONTHS_OPTIONS, example: 6, description: '3 → 6개월 연장만 가능 (게시 시작일 기준)' })
  @IsOptional()
  @Type(() => Number)
  @IsIn(PUBLISH_MONTHS_OPTIONS)
  publishMonths?: (typeof PUBLISH_MONTHS_OPTIONS)[number];
}

export class ListReferralPostsQueryDto {
  @ApiPropertyOptional({ description: '제목·추천 사유 검색어' })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  keyword?: string;

  @ApiPropertyOptional({ description: '직급 검색어 (예: 과장)' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  position?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
