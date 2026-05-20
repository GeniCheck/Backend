import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean } from 'class-validator';

export class Step2ConsentDto {
  @ApiProperty({ example: true, description: '최종 피드백 생성 동의 여부 (true: 동의, false: 거부)' })
  @IsBoolean({ message: '동의 여부는 boolean이어야 합니다.' })
  agreed!: boolean;
}
