import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export class SelfEvaluationScoreItemDto {
  @ApiProperty({ description: '자기 선언 답변 ID' })
  @IsUUID()
  answerId!: string;

  @ApiProperty({ description: '자기 평가 점수', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  score!: number;
}

export class SelfEvaluationDto {
  @ApiProperty({ type: [SelfEvaluationScoreItemDto], description: '선언별 자기 평가 점수 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => SelfEvaluationScoreItemDto)
  scores!: SelfEvaluationScoreItemDto[];
}
