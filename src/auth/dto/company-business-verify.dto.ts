import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompanyBusinessVerifyDto {
  @ApiProperty({ example: '123-45-67890', description: '사업자등록번호' })
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{5}$/)
  businessNumber!: string;

  @ApiProperty({ example: '홍길동', description: '대표자 성명' })
  @IsString()
  @IsNotEmpty()
  representativeName!: string;

  @ApiProperty({ example: '20200101', description: '개업일자' })
  @IsString()
  @Matches(/^\d{8}$/)
  startDate!: string;
}
