import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsOptional, IsString, Matches } from 'class-validator';

export class CompanySignupOtpVerifyDto {
  @ApiProperty({ example: 'ceo@company.com', description: '기업 대표 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({
    example: '010-1234-5678',
    description: '기업 대표 전화번호 (형식: 010-0000-0000)',
  })
  @IsString()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/, {
    message: '전화번호는 010-0000-0000 형식이어야 합니다.',
  })
  @IsOptional()
  phone!: string;

  @ApiProperty({ example: '123456', description: 'OTP 코드 (숫자 6자리)' })
  @IsString()
  @Matches(/^\d{6}$/, { message: 'OTP 코드는 숫자 6자리여야 합니다.' })
  otpCode!: string;
}
