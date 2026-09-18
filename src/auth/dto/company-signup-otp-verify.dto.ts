import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompanySignupOtpVerifyDto {
  @ApiProperty({ example: 'ceo@company.com', description: '기업 대표 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: '123456', description: '이메일 인증 코드' })
  @IsString()
  @Matches(/^\d{6}$/)
  otpCode!: string;
}
