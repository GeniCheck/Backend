import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class HrRegisterDto {
  @ApiProperty({ example: 'COMP001', description: '가입할 회사 코드' })
  @IsString()
  @IsNotEmpty()
  companyCode!: string;

  @ApiProperty({ example: 'hr.manager@company.com', description: 'HR 로그인 이메일' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(50)
  email!: string;

  @ApiProperty({ example: 'Pass1!', description: 'HR 로그인 비밀번호' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(30)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/)
  password!: string;

  @ApiProperty({ example: '홍길동', description: 'HR 담당자 이름' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
