import { ApiPropertyOptional } from '@nestjs/swagger';
import { DeclarationStatus, EmploymentStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import { IsEnum, IsInt, IsOptional, IsString, Max, MaxLength, Min } from 'class-validator';

export class ListEmployeesQueryDto {
  @ApiPropertyOptional({ enum: EmploymentStatus, description: '재직 상태' })
  @IsOptional()
  @IsEnum(EmploymentStatus)
  status?: EmploymentStatus;

  @ApiPropertyOptional({ enum: DeclarationStatus, description: '자기선언 진행 상태' })
  @IsOptional()
  @IsEnum(DeclarationStatus)
  declarationStatus?: DeclarationStatus;

  @ApiPropertyOptional({ description: '이름·부서·직급 검색어' })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  keyword?: string;

  @ApiPropertyOptional({ default: 1, minimum: 1 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  page?: number;

  @ApiPropertyOptional({ default: 20, minimum: 1, maximum: 100 })
  @IsOptional()
  @Type(() => Number)
  @IsInt()
  @Min(1)
  @Max(100)
  size?: number;
}
