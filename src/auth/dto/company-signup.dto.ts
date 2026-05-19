import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MinLength,
} from 'class-validator';

export class CompanySignupDto {
  @ApiProperty({ example: 'hr@company.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsString()
  @MinLength(8)
  password!: string;

  @ApiProperty({ example: '제니체크 주식회사' })
  @IsString()
  @IsNotEmpty()
  companyName!: string;

  @ApiProperty({
    example: '123-45-67890',
    description: '사업자등록번호 (10자리, 하이픈 포함 가능)',
  })
  @IsString()
  @Matches(/^\d{3}-?\d{2}-?\d{5}$/, {
    message: '사업자등록번호 형식이 올바르지 않습니다.',
  })
  businessNumber!: string;
}
