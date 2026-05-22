import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompanyOtpVerifyDto {
  @ApiProperty({ description: '로그인 1단계에서 발급된 임시 토큰' })
  @IsString()
  @IsNotEmpty({ message: '임시 토큰을 입력해주세요.' })
  tempToken!: string;

  @ApiProperty({ example: '123456', description: 'OTP 코드 (숫자 6자리)' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP 코드는 숫자 6자리여야 합니다.' })
  otpCode!: string;
}
