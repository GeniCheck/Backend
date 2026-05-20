import { ApiProperty } from '@nestjs/swagger';
import { IsBoolean, IsNotEmpty, IsString, IsDateString } from 'class-validator';

export class CreateConsentDto {
  @ApiProperty({ example: 'uuid-applicant', description: '지원자 ID' })
  @IsString()
  @IsNotEmpty({ message: '지원자 ID를 입력해주세요.' })
  applicantId!: string;

  @ApiProperty({ example: 'uuid-company', description: '기업 ID' })
  @IsString()
  @IsNotEmpty({ message: '기업 ID를 입력해주세요.' })
  companyId!: string;

  @ApiProperty({ example: '2026-05-20T00:00:00.000Z', description: '동의 일시 (ISO 8601)' })
  @IsDateString({}, { message: '올바른 날짜 형식이 아닙니다.' })
  @IsNotEmpty({ message: '동의 일시를 입력해주세요.' })
  agreedAt!: string;

  @ApiProperty({ example: true, description: '이용약관 동의 여부' })
  @IsBoolean({ message: '이용약관 동의 여부는 boolean이어야 합니다.' })
  agreedTerms!: boolean;
}
