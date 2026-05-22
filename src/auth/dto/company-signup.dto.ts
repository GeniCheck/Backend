import { ApiProperty } from '@nestjs/swagger';
import {
  IsEmail,
  IsNotEmpty,
  IsString,
  Matches,
  MaxLength,
  MinLength,
} from 'class-validator';

export class CompanySignupDto {
  @ApiProperty({ example: 'hr@company.com', description: '기업 이메일 (최대 50자)' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  @IsNotEmpty({ message: '이메일을 입력해주세요.' })
  @MaxLength(50, { message: '이메일은 최대 50자까지 입력할 수 있습니다.' })
  @Matches(/^[a-zA-Z0-9._%+\-]+@[a-zA-Z0-9.\-]+\.[a-zA-Z]{2,}$/, {
    message: '이메일은 영문, 숫자만 사용할 수 있습니다.',
  })
  email!: string;

  @ApiProperty({
    example: 'Pass1!',
    description: '비밀번호 (6~10자, 영문 대소문자·숫자·특수문자(!@#$%^&*) 각 1개 이상)',
  })
  @IsString()
  @MinLength(6, { message: '비밀번호는 최소 6자 이상이어야 합니다.' })
  @MaxLength(10, { message: '비밀번호는 최대 10자까지 입력할 수 있습니다.' })
  @Matches(/^[a-zA-Z0-9!@#$%^&*]+$/, {
    message: '비밀번호는 영문, 숫자, 특수문자(!@#$%^&*)만 사용할 수 있습니다.',
  })
  @Matches(/(?=.*[a-z])/, { message: '비밀번호에 소문자를 포함해야 합니다.' })
  @Matches(/(?=.*[A-Z])/, { message: '비밀번호에 대문자를 포함해야 합니다.' })
  @Matches(/(?=.*\d)/, { message: '비밀번호에 숫자를 포함해야 합니다.' })
  @Matches(/(?=.*[!@#$%^&*])/, { message: '비밀번호에 특수문자(!@#$%^&*)를 포함해야 합니다.' })
  password!: string;

  @ApiProperty({ example: '제니체크 주식회사', description: '기업명 (2~50자, 한글·영문·숫자·공백만 허용)' })
  @IsString()
  @IsNotEmpty({ message: '기업명을 입력해주세요.' })
  @MinLength(2, { message: '기업명은 최소 2자 이상이어야 합니다.' })
  @MaxLength(50, { message: '기업명은 최대 50자까지 입력할 수 있습니다.' })
  @Matches(/^[가-힣a-zA-Z0-9\s]+$/, {
    message: '기업명은 한글, 영문, 숫자, 공백만 입력할 수 있습니다.',
  })
  companyName!: string;

  @ApiProperty({
    example: '123-45-67890',
    description: '사업자등록번호 (형식: 000-00-00000)',
  })
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{5}$/, {
    message: '사업자등록번호는 000-00-00000 형식이어야 합니다.',
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
