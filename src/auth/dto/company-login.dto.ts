import { ApiProperty } from '@nestjs/swagger';
import { IsEmail, IsNotEmpty, IsString } from 'class-validator';

export class CompanyLoginDto {
  @ApiProperty({ example: 'hr@company.com' })
  @IsEmail()
  @IsNotEmpty()
  email!: string;

  @ApiProperty({ example: 'Password1!' })
  @IsString()
  @IsNotEmpty()
  password!: string;
}
