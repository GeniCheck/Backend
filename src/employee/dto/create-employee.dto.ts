import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Transform } from 'class-transformer';
import {
  IsDateString,
  IsEmail,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';

export const DATE_ONLY_PATTERN = /^\d{4}-\d{2}-\d{2}$/;

export class CreateEmployeeDto {
  @ApiProperty({ example: '김민준' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name!: string;

  @ApiProperty({ example: 'minjun@example.com', description: '소문자·공백 제거 후 저장, 기업 내 중복 불가' })
  // 형식 검사 전에 정규화해야 앞뒤 공백이 있는 이메일도 통과한다
  @Transform(({ value }) => (typeof value === 'string' ? value.trim().toLowerCase() : value))
  @IsEmail()
  @MaxLength(100)
  email!: string;

  @ApiPropertyOptional({ example: '010-5555-6666' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @ApiPropertyOptional({ example: '프론트엔드 개발팀' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string;

  @ApiPropertyOptional({ example: '과장' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  position?: string;

  @ApiProperty({ example: '2026-05-09', description: '입사일 (YYYY-MM-DD)' })
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN, { message: 'employmentStartDate는 YYYY-MM-DD 형식이어야 합니다.' })
  employmentStartDate!: string;
}
