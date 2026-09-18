import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class HrLoginDto {
  @ApiProperty({ example: 'hr.manager@company.com', description: 'HR 로그인 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Pass1!', description: 'HR 로그인 비밀번호' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
