import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
  IsNotEmpty,
  IsNumber,
  IsOptional,
  IsString,
  ValidateNested,
} from 'class-validator';

/**
 * 질문 유형에 맞는 필드 하나만 보낸다. SCORE → answerScore, SINGLE_CHOICE → answerOptionId, TEXT → answerText
 * 유형과 다른 필드는 400 INVALID_ANSWER_TYPE, 범위·선택지·글자 수 위반은 422 ANSWER_VALIDATION_FAILED (서비스에서 판정)
 */
export class AnswerDto {
  @ApiProperty({ example: 'uuid', description: '질문지 조회 응답의 questionId' })
  @IsString()
  @IsNotEmpty()
  questionId!: string;

  @ApiPropertyOptional({ example: 8, description: 'SCORE: scoreMin~scoreMax 정수' })
  @IsOptional()
  @IsNumber()
  answerScore?: number;

  @ApiPropertyOptional({ example: 'uuid', description: 'SINGLE_CHOICE: 선택지의 optionId' })
  @IsOptional()
  @IsString()
  answerOptionId?: string;

  @ApiPropertyOptional({ example: 'React 성능 개선을 진행했습니다.', description: 'TEXT: maxLength 이내' })
  @IsOptional()
  @IsString()
  answerText?: string;
}

export class DeclarationConsentsDto {
  @ApiProperty({ example: true, description: '평가 활용 동의' })
  @IsBoolean()
  evaluationAgreed!: boolean;

  @ApiProperty({ example: true, description: '정보 열람 동의' })
  @IsBoolean()
  dataAccessAgreed!: boolean;

  @ApiProperty({ example: true, description: '증빙 보관 동의' })
  @IsBoolean()
  evidenceRetentionAgreed!: boolean;

  @ApiProperty({ example: '2026-10-01', description: '질문지 조회 응답의 consentVersion' })
  @IsString()
  @IsNotEmpty()
  consentVersion!: string;
}

export class SubmitDeclarationDto {
  @ApiProperty({ type: [AnswerDto] })
  @IsArray()
  @ValidateNested({ each: true })
  @Type(() => AnswerDto)
  answers!: AnswerDto[];

  @ApiProperty({ type: DeclarationConsentsDto })
  @ValidateNested()
  @Type(() => DeclarationConsentsDto)
  consents!: DeclarationConsentsDto;
}
