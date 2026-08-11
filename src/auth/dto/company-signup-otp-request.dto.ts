import { ApiProperty } from '@nestjs/swagger';
import { IsNotEmpty, IsString, Matches } from 'class-validator';

export class CompanySignupOtpRequestDto {
  @ApiProperty({
    example: '010-1234-5678',
    description: '기업 대표 전화번호 (형식: 010-0000-0000)',
  })
  @IsString()
  @Matches(/^01[016789]-\d{3,4}-\d{4}$/, {
    message: '전화번호는 010-0000-0000 형식이어야 합니다.',
  })
  phone!: string;

  @ApiProperty({ example: '홍길동', description: '대표자 성명' })
  @IsString()
  @IsNotEmpty({ message: '대표자 성명을 입력해주세요.' })
  representativeName!: string;

  @ApiProperty({
    example: '123-45-67890',
    description: '사업자등록번호 (형식: 000-00-00000)',
  })
  @IsString()
  @Matches(/^\d{3}-\d{2}-\d{5}$/, {
    message: '사업자등록번호는 000-00-00000 형식이어야 합니다.',
  })
  businessNumber!: string;
}
