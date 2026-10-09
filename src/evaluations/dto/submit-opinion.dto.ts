import { ApiProperty } from '@nestjs/swagger';
import { IsString } from 'class-validator';

export class SubmitOpinionDto {
  // 빈 값·1000자 초과는 서비스에서 trim 후 422 INVALID_OPINION으로 판정
  @ApiProperty({
    example: '대표 검증 결과 중 협업 점수에 대해 보완 설명을 제출합니다.',
    description: '평가 결과에 대한 의견 (앞뒤 공백 제거 후 1~1000자, 1회만 제출)',
  })
  @IsString()
  content!: string;
}
