import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString } from 'class-validator';

export class HrLoginDto {
  @ApiProperty({ example: '010-1234-5678', description: 'HR 담당자 전화번호' })
  @IsString()
  @IsNotEmpty()
  phone!: string;

  @ApiProperty({ example: 'COMP001', description: '기업 코드' })
  @IsString()
  @IsNotEmpty()
  companyCode!: string;
}
