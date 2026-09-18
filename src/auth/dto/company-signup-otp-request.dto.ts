import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty } from 'class-validator';

export class CompanySignupOtpRequestDto {
  [key: string]: unknown;

  @ApiProperty({ example: 'ceo@company.com', description: '기업 대표 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;
}
