import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsNotEmpty, IsNumber, IsString, ValidateNested } from 'class-validator';

/**
 * 자기평가는 점수만 받는다. 서술형 필드는 DTO에 없으므로 보내면 400(forbidNonWhitelisted).
 * 숫자가 아니면 400, 1~10 정수가 아니면 서비스에서 422 INVALID_SCORE.
 */
export class SelfEvaluationItemDto {
  @ApiProperty({ example: 'uuid', description: '자기평가 조회 응답의 questionId' })
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiProperty({ example: 8, minimum: 1, maximum: 10, description: '1~10 정수' })
  @IsNumber()
  selfScore!: number;
}

export class SubmitSelfEvaluationDto {
  @ApiProperty({ type: [SelfEvaluationItemDto], description: '모든 평가 항목의 자기점수 (누락·중복 불가)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelfEvaluationItemDto)
  items!: SelfEvaluationItemDto[];
}
