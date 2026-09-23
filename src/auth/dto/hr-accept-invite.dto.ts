import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches, MaxLength, MinLength } from 'class-validator';

export class HrAcceptInviteDto {
  @ApiProperty({ description: '초대 이메일에 포함된 토큰' })
  @IsString()
  @IsNotEmpty()
  token!: string;

  @ApiProperty({ example: 'Pass1!', description: 'HR 본인이 설정할 로그인 비밀번호' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(30)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/)
  password!: string;
}
