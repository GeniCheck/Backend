import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class CompanySignupDto {
  @ApiProperty({ example: 'ceo@company.com', description: '기업 대표 이메일' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(50)
  email!: string;

  @ApiProperty({ example: 'Pass1!', description: '비밀번호' })
  @IsString()
  @MinLength(6)
  @MaxLength(30)
  @Matches(/^[a-zA-Z0-9!@#$%^&*]+$/)
  @Matches(/(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*])/)
  password!: string;

  @ApiProperty({ example: '지니체크 주식회사', description: '기업명' })
  @IsString()
  @IsNotEmpty()
  @MinLength(2)
  @MaxLength(50)
  companyName!: string;

  @ApiProperty({ example: '123-45-67890', description: '사업자등록번호' })
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{5}$/)
  businessNumber!: string;

  @ApiProperty({ example: '홍길동', description: '대표자 성명' })
  @IsString()
  @IsNotEmpty()
  representativeName!: string;

  @ApiProperty({ example: '20200101', description: '개업일자 (YYYYMMDD)' })
  @IsString()
  @Matches(/^\d{8}$/)
  startDate!: string;

  @ApiProperty({ description: '대표 이메일 인증 완료 토큰' })
  @IsString()
  @IsNotEmpty()
  emailVerificationToken!: string;

  @ApiProperty({ description: '사업자 정보 인증 완료 토큰' })
  @IsString()
  @IsNotEmpty()
  businessVerificationToken!: string;
}
