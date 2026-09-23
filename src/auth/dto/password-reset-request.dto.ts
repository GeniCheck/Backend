import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsIn, IsNotEmpty } from 'class-validator';

export type PasswordResetRole = 'COMPANY' | 'HR_MANAGER';

export class PasswordResetRequestDto {
  @ApiProperty({ example: 'ceo@company.com', description: '본인 로그인 이메일' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'COMPANY', enum: ['COMPANY', 'HR_MANAGER'], description: '계정 종류' })
  @IsIn(['COMPANY', 'HR_MANAGER'])
  role!: PasswordResetRole;
}
