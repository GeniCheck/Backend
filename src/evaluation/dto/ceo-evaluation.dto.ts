import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class CeoEvaluationDto {
  @ApiProperty({ description: '검증 점수', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  score: number;
}
