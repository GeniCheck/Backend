import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty, IsString, Length, Matches, MaxLength, MinLength } from 'class-validator';
import { PasswordResetRole } from './password-reset-request.dto';

export class PasswordResetConfirmDto {
  @ApiProperty({ example: 'ceo@company.com', description: '본인 로그인 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'COMPANY', enum: ['COMPANY', 'HR_MANAGER'], description: '계정 종류' })
  @IsIn(['COMPANY', 'HR_MANAGER'])
  role!: PasswordResetRole;

  @ApiProperty({ example: '123456', description: '본인 이메일로 받은 재설정 코드 (숫자 6자리)' })
  @IsString()
  @Length(6, 6, { message: '재설정 코드는 6자리여야 합니다.' })
  @Matches(/^\d{6}$/, { message: '재설정 코드는 숫자 6자리여야 합니다.' })
  code!: string;

  @ApiProperty({ example: 'NewPass1!', description: '새 비밀번호' })
  @IsString()
  @IsNotEmpty()
  @MinLength(6)
  @MaxLength(30)
  @Matches(/^(?=.*[a-z])(?=.*[A-Z])(?=.*\d)(?=.*[!@#$%^&*]).+$/)
  newPassword!: string;
}
