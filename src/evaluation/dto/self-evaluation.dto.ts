import { ApiProperty } from '@nestjs/swagger';
import { IsInt, Max, Min } from 'class-validator';

export class SelfEvaluationDto {
  @ApiProperty({ description: '자기 평가 점수', minimum: 1, maximum: 10 })
  @IsInt()
  @Min(1)
  @Max(10)
  score: number;
}
