import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class ResendOtpDto {
  @ApiProperty({ description: '로그인/승인 1단계에서 발급된 임시 토큰' })
  @IsString()
  @IsNotEmpty({ message: '임시 토큰을 입력해주세요.' })
  tempToken!: string;
}
