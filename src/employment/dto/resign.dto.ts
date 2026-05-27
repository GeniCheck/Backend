import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { IsDateString, IsOptional, IsString, IsUUID } from 'class-validator';

export class ResignDto {
  @ApiProperty({ description: '퇴사 처리할 지원자 ID' })
  @IsUUID()
  applicantId: string;

  @ApiProperty({ description: '퇴사일 (ISO 8601)', example: '2026-05-26' })
  @IsDateString()
  resignationDate: string;

  @ApiPropertyOptional({ description: '퇴사 사유' })
  @IsOptional()
  @IsString()
  reason?: string;
}
