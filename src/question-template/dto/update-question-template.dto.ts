import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { TemplateStatus } from '@prisma/client';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsEnum,
  IsInt,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  Min,
  ValidateNested,
} from 'class-validator';
import { QuestionDto } from './question.dto';

export class UpdateQuestionTemplateDto {
  @ApiProperty({ example: 1, description: '수정 기준 버전. 현재 버전과 다르면 409 TEMPLATE_VERSION_CONFLICT' })
  @IsInt()
  @Min(1)
  version!: number;

  @ApiPropertyOptional({ example: '개발직군 입사 자기선언 v2' })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name?: string;

  @ApiPropertyOptional({ example: '개발직군 공통 질문', nullable: true, description: 'null이면 설명 삭제' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string | null;

  @ApiPropertyOptional({ type: [QuestionDto], description: '질문 전체 교체. 내용이 바뀌면 version 1 증가' })
  @IsOptional()
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions?: QuestionDto[];

  @ApiPropertyOptional({ enum: TemplateStatus, description: 'ARCHIVED로 바꾸면 새 직원에게 할당 불가' })
  @IsOptional()
  @IsEnum(TemplateStatus)
  status?: TemplateStatus;
}
