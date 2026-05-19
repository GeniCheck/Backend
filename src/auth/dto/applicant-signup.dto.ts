import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MinLength } from 'class-validator';

export class ApplicantSignupDto {
  @ApiProperty({ example: 'user@example.com', description: '이메일' })
  @IsEmail({}, { message: '올바른 이메일 형식이 아닙니다.' })
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Password1!', description: '비밀번호 (최소 8자)' })
  @IsString()
  @MinLength(8, { message: '비밀번호는 최소 8자 이상이어야 합니다.' })
  password!: string;

  @ApiProperty({ example: '홍길동', description: '이름' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
