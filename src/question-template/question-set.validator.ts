import { UnprocessableEntityException } from '@nestjs/common';
import { QuestionType } from '@prisma/client';
import { QuestionDto } from './dto/question.dto';

export const QUESTION_TEXT_MAX_LENGTH = 100;
export const SCORE_RANGE = { min: 1, max: 10 } as const;
export const TEXT_MAX_LENGTH_RANGE = { min: 1, max: 1000 } as const;
export const SINGLE_CHOICE_MIN_OPTIONS = 2;

/** 검증을 통과해 저장 가능한 형태로 정리된 질문 (유형과 무관한 필드는 제거) */
export interface NormalizedQuestion {
  order: number;
  type: QuestionType;
  text: string;
  required: boolean;
  scoreMin?: number;
  scoreMax?: number;
  options?: string[];
  maxLength?: number;
  evaluationEnabled: boolean;
}

interface QuestionSetError {
  order: number | null;
  field: string;
  message: string;
}

/**
 * 질문 유형별 제약조건을 검사하고 정리된 질문 목록(order순)을 반환한다.
 * 위반이 하나라도 있으면 전체 목록을 details.errors에 담아 422 INVALID_QUESTION_SET을 던진다.
 */
export function validateQuestionSet(questions: QuestionDto[]): NormalizedQuestion[] {
  const errors: QuestionSetError[] = [];

  if (!questions || questions.length === 0) {
    errors.push({ order: null, field: 'questions', message: '질문은 1개 이상이어야 합니다.' });
  }

  const seenOrders = new Set<number>();
  const normalized: NormalizedQuestion[] = [];

  for (const q of questions ?? []) {
    const add = (field: string, message: string) => errors.push({ order: q.order, field, message });

    if (seenOrders.has(q.order)) {
      add('order', '질문 순서가 중복됩니다.');
    }
    seenOrders.add(q.order);

    const text = q.text.trim();
    if (!text) {
      add('text', '질문 문구를 입력해 주세요.');
    } else if (text.length > QUESTION_TEXT_MAX_LENGTH) {
      add('text', `질문 문구는 ${QUESTION_TEXT_MAX_LENGTH}자 이내여야 합니다.`);
    }

    const base = {
      order: q.order,
      type: q.type,
      text,
      required: q.required,
      evaluationEnabled: q.evaluationEnabled,
    };

    switch (q.type) {
      case QuestionType.SCORE: {
        const { scoreMin, scoreMax } = q;
        if (scoreMin == null || scoreMax == null) {
          add('scoreMin/scoreMax', '점수형 질문은 scoreMin과 scoreMax가 필요합니다.');
        } else if (
          scoreMin < SCORE_RANGE.min ||
          scoreMax > SCORE_RANGE.max ||
          scoreMin >= scoreMax
        ) {
          add(
            'scoreMin/scoreMax',
            `점수 범위는 ${SCORE_RANGE.min} ≤ scoreMin < scoreMax ≤ ${SCORE_RANGE.max}여야 합니다.`,
          );
        }
        normalized.push({ ...base, scoreMin: scoreMin ?? undefined, scoreMax: scoreMax ?? undefined });
        break;
      }
      case QuestionType.SINGLE_CHOICE: {
        const options = (q.options ?? []).map((option) => option.trim());
        if (options.length < SINGLE_CHOICE_MIN_OPTIONS) {
          add('options', `선택형 질문은 선택지가 ${SINGLE_CHOICE_MIN_OPTIONS}개 이상이어야 합니다.`);
        } else if (options.some((option) => !option)) {
          add('options', '빈 선택지는 사용할 수 없습니다.');
        } else if (new Set(options).size !== options.length) {
          add('options', '선택지가 중복됩니다.');
        }
        normalized.push({ ...base, options });
        break;
      }
      case QuestionType.TEXT: {
        const { maxLength } = q;
        if (maxLength == null) {
          add('maxLength', '서술형 질문은 maxLength가 필요합니다.');
        } else if (maxLength < TEXT_MAX_LENGTH_RANGE.min || maxLength > TEXT_MAX_LENGTH_RANGE.max) {
          add(
            'maxLength',
            `maxLength는 ${TEXT_MAX_LENGTH_RANGE.min}~${TEXT_MAX_LENGTH_RANGE.max}여야 합니다.`,
          );
        }
        normalized.push({ ...base, maxLength: maxLength ?? undefined });
        break;
      }
    }
  }

  if (errors.length > 0) {
    throw new UnprocessableEntityException({
      code: 'INVALID_QUESTION_SET',
      message: '질문 구성이 유형별 제약조건을 만족하지 않습니다.',
      details: { errors },
    });
  }

  return normalized.sort((a, b) => a.order - b.order);
}
