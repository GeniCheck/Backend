import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsNotEmpty,
  IsOptional,
  IsString,
  MaxLength,
  ValidateNested,
} from 'class-validator';
import { QuestionDto } from './question.dto';

export class CreateQuestionTemplateDto {
  @ApiProperty({ example: '개발직군 입사 자기선언', description: '템플릿 이름 (100자 이내)' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name!: string;

  @ApiPropertyOptional({ example: '개발직군 공통 질문', description: '설명 (500자 이내)' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @ApiProperty({ type: [QuestionDto], description: '질문 목록 (1개 이상)' })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => QuestionDto)
  questions!: QuestionDto[];
}
