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
<<<<<<< Updated upstream
=======

  @ApiProperty({
    example: '010-1234-5678',
    description: '기업 대표 전화번호 (형식: 010-0000-0000)',
  })
  @IsString()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/, {
    message: '전화번호는 010-0000-0000 형식이어야 합니다.',
  })
  phone!: string;

  @ApiProperty({ example: '홍길동', description: '대표자 성명' })
  @IsString()
  @IsNotEmpty({ message: '대표자 성명을 입력해주세요.' })
  representativeName!: string;

  @ApiProperty({ example: '20200101', description: '개업일자 (YYYYMMDD 형식)' })
  @IsString()
  @Matches(/^\d{8}$/, { message: '개업일자는 YYYYMMDD 형식이어야 합니다.' })
  startDate!: string;
>>>>>>> Stashed changes
}
