import { ApiProperty } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import { IsArray, IsEnum, IsInt, IsUUID, Max, Min, ValidateNested } from 'class-validator';

export enum RehireIntent {
  YES = 'YES',
  HOLD = 'HOLD',
  NO = 'NO',
}

export class CeoEvaluationScoreItemDto {
  @ApiProperty({ description: '자기 선언 답변 ID' })
  @IsUUID()
  answerId!: string;

  @ApiProperty({ description: '검증 점수', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  score!: number;
}

export class CeoEvaluationDto {
  @ApiProperty({ type: [CeoEvaluationScoreItemDto], description: '선언별 검증 점수 목록' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => CeoEvaluationScoreItemDto)
  scores!: CeoEvaluationScoreItemDto[];

  @ApiProperty({ enum: RehireIntent, description: '재고용 의향 (YES | HOLD | NO)' })
  @IsEnum(RehireIntent)
  rehireIntent!: RehireIntent;
}
