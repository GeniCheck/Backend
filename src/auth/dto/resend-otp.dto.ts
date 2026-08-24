import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({
    example: '010-1234-5678',
    description: '전화번호(하위 호환용, 서버는 tempToken 기준으로 OTP 수신 번호를 결정)',
    required: false,
  })
  @IsString()
  @IsOptional()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/, {
    message: '전화번호는 010-0000-0000 형식이어야 합니다.',
  })
  phone?: string;

  @ApiProperty({ description: '로그인/승인 1단계에서 발급된 임시 토큰' })
  @IsString()
  @IsNotEmpty({ message: '임시 토큰을 입력해주세요.' })
  tempToken!: string;
}
