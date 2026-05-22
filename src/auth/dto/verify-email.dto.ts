import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString, Length } from 'class-validator';

export class VerifyEmailDto {
  @ApiProperty({ example: 'user@example.com', description: '인증할 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: '482910', description: '이메일로 받은 6자리 인증 코드' })
  @IsString()
  @Length(6, 6, { message: '인증 코드는 6자리여야 합니다.' })
  code!: string;
}
