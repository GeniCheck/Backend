import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, MaxLength } from 'class-validator';

export class HrInviteDto {
  @ApiProperty({ example: 'hr.manager@company.com', description: 'HR 담당자 이메일 (초대 메일 수신 + 향후 로그인 아이디)' })
  @IsEmail()
  @IsNotEmpty()
  @MaxLength(50)
  email!: string;

  @ApiProperty({ example: '홍길동', description: 'HR 담당자 이름' })
  @IsString()
  @IsNotEmpty()
  name!: string;
}
