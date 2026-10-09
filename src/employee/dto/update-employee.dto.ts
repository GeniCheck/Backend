import { ApiHideProperty, ApiPropertyOptional } from '@nestjs/swagger';
import {
  IsDateString,
  IsNotEmpty,
  IsOptional,
  IsString,
  Matches,
  MaxLength,
} from 'class-validator';
import { DATE_ONLY_PATTERN } from './create-employee.dto';

/**
 * 수정 가능한 필드는 name, phone, department, position, employmentStartDate뿐이다.
 * email은 DTO에 없으므로 보내면 400(forbidNonWhitelisted).
 * 재직·선언 상태는 수정 필드가 아니라 차단용으로만 선언한다. 값이 오면 서비스에서
 * 명세의 409 INVALID_STATUS_CHANGE로 거절한다(퇴사 전환은 별도 API).
 */
export class UpdateEmployeeDto {
  @ApiPropertyOptional({ example: '김민준' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  name?: string;

  @ApiPropertyOptional({ example: '010-7777-8888', nullable: true, description: 'null이면 삭제' })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string | null;

  @ApiPropertyOptional({ example: '플랫폼 개발팀', nullable: true, description: 'null이면 삭제' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  department?: string | null;

  @ApiPropertyOptional({ example: '차장', nullable: true, description: 'null이면 삭제' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  position?: string | null;

  @ApiPropertyOptional({ example: '2026-05-09', description: '입사일 (YYYY-MM-DD)' })
  @IsOptional()
  @IsDateString({ strict: true })
  @Matches(DATE_ONLY_PATTERN, { message: 'employmentStartDate는 YYYY-MM-DD 형식이어야 합니다.' })
  employmentStartDate?: string;

  /** 차단용: 값이 오면 409 INVALID_STATUS_CHANGE */
  @ApiHideProperty()
  @IsOptional()
  employmentStatus?: unknown;

  /** 차단용: 값이 오면 409 INVALID_STATUS_CHANGE */
  @ApiHideProperty()
  @IsOptional()
  declarationStatus?: unknown;
}
