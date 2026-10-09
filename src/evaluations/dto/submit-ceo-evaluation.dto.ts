import { ApiProperty } from '@nestjs/swagger';
import { CompetencyKey } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';
import { StrictBoolean } from '../../core/decorators/strict-boolean.decorator';

/**
 * 대표 검증은 점수와 재고용 의사(boolean)만 받는다.
 * 서술형(평가 코멘트·재고용 사유 등) 필드는 DTO에 없으므로 보내면 400(forbidNonWhitelisted).
 */
export class CeoEvaluationItemDto {
  @ApiProperty({ example: 'uuid', description: '대표 검증 폼 조회 응답의 questionId' })
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiProperty({ example: 7, minimum: 1, maximum: 10, description: '1~10 정수' })
  @IsNumber()
  ceoScore!: number;
}

export class CompetencyScoreDto {
  @ApiProperty({ enum: CompetencyKey, example: 'TRUST' })
  @IsEnum(CompetencyKey)
  key!: CompetencyKey;

  @ApiProperty({ example: 8, minimum: 1, maximum: 10, description: '1~10 정수' })
  @IsNumber()
  score!: number;
}

export class SubmitCeoEvaluationDto {
  @ApiProperty({ type: [CeoEvaluationItemDto], description: '모든 평가 항목의 대표 점수 (누락·중복 불가)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CeoEvaluationItemDto)
  items!: CeoEvaluationItemDto[];

  @ApiProperty({ type: [CompetencyScoreDto], description: '공통 역량 6개 점수 (누락·중복 불가)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CompetencyScoreDto)
  commonCompetencies!: CompetencyScoreDto[];

  // 레거시의 YES/HOLD/NO 문자열이나 "true" 같은 문자열은 거부하고 진짜 boolean만 허용
  @ApiProperty({ example: true, description: '재고용 의사 (true/false만)' })
  @StrictBoolean()
  rehireIntent!: boolean;
}
