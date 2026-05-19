import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Length } from 'class-validator';

export class CompanyOtpVerifyDto {
  @ApiProperty({ description: '로그인 1단계에서 발급된 임시 토큰' })
  @IsString()
  @IsNotEmpty()
  tempToken!: string;

  @ApiProperty({ example: '123456', description: '6자리 OTP 코드' })
  @IsString()
  @Length(6, 6, { message: 'OTP 코드는 6자리여야 합니다.' })
  otpCode!: string;
}
