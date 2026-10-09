import { ApiProperty, ApiPropertyOptional } from '@nestjs/swagger';
import { QuestionType } from '@prisma/client';
import {
  IsArray,
  IsBoolean,
  IsEnum,
  IsInt,
  IsString,
  Min,
  ValidateIf,
} from 'class-validator';

/**
 * 템플릿 질문 1개. 여기서는 형식(타입)만 검사하고(400),
 * 유형별 제약조건(범위·선택지·글자 수·order 중복)은 validateQuestionSet에서 422로 판정한다.
 * 유형과 무관한 필드(예: TEXT 질문의 scoreMin)는 검사하지 않고 저장 시 버린다.
 */
export class QuestionDto {
  @ApiProperty({ example: 1, description: '질문 순서 (1부터, 중복 불가)' })
  @IsInt()
  @Min(1)
  order!: number;

  @ApiProperty({ enum: QuestionType, example: QuestionType.SCORE })
  @IsEnum(QuestionType)
  type!: QuestionType;

  @ApiProperty({ example: '업무 책임감을 평가해 주세요.', description: '질문 문구 (100자 이내)' })
  @IsString()
  text!: string;

  @ApiProperty({ example: true })
  @IsBoolean()
  required!: boolean;

  @ApiPropertyOptional({ example: 1, description: 'SCORE 필수. 1 이상' })
  @ValidateIf((q: QuestionDto) => q.type === QuestionType.SCORE && q.scoreMin != null)
  @IsInt()
  scoreMin?: number;

  @ApiPropertyOptional({ example: 10, description: 'SCORE 필수. scoreMin보다 크고 10 이하' })
  @ValidateIf((q: QuestionDto) => q.type === QuestionType.SCORE && q.scoreMax != null)
  @IsInt()
  scoreMax?: number;

  @ApiPropertyOptional({
    example: ['개인 집중', '팀 협업'],
    description: 'SINGLE_CHOICE 필수. 2개 이상, 빈값·중복 불가',
    type: [String],
  })
  @ValidateIf((q: QuestionDto) => q.type === QuestionType.SINGLE_CHOICE && q.options != null)
  @IsArray()
  @IsString({ each: true })
  options?: string[];

  @ApiPropertyOptional({ example: 500, description: 'TEXT 필수. 1~1000' })
  @ValidateIf((q: QuestionDto) => q.type === QuestionType.TEXT && q.maxLength != null)
  @IsInt()
  maxLength?: number;

  @ApiProperty({ example: true, description: '퇴사 평가 항목으로 사용할지 여부' })
  @IsBoolean()
  evaluationEnabled!: boolean;
}
