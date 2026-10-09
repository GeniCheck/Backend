import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { DeclarationQuestionSnapshot, QuestionType } from '@prisma/client';
import { SnapshotOption } from './declaration.constants';
import { AnswerDto } from './dto/submit-declaration.dto';

/** 저장할 답변 (DeclarationResponse) */
export interface NormalizedAnswer {
  snapshotQuestionId: string;
  answerScore: number | null;
  answerOptionId: string | null;
  answerText: string | null;
}

interface AnswerError {
  questionId: string;
  message: string;
}

type AnswerField = 'answerScore' | 'answerOptionId' | 'answerText';

const FIELD_BY_TYPE: Record<QuestionType, AnswerField> = {
  SCORE: 'answerScore',
  SINGLE_CHOICE: 'answerOptionId',
  TEXT: 'answerText',
};

const ANSWER_FIELDS: AnswerField[] = ['answerScore', 'answerOptionId', 'answerText'];

/**
 * 발송 시점의 질문 스냅샷을 기준으로 답변을 검증한다.
 * - 유형과 다른 답변 필드 → 400 INVALID_ANSWER_TYPE (가장 먼저 판정)
 * - 없는 질문·중복 답변·필수 누락·점수 범위·없는 선택지·글자 수 초과 → 422 ANSWER_VALIDATION_FAILED
 * 위반은 모두 모아 details.errors로 돌려준다.
 */
export function validateAnswers(
  snapshots: DeclarationQuestionSnapshot[],
  answers: AnswerDto[],
): NormalizedAnswer[] {
  const snapshotById = new Map(snapshots.map((s) => [s.id, s]));
  const typeErrors: AnswerError[] = [];
  const errors: AnswerError[] = [];
  const answered = new Map<string, NormalizedAnswer>();

  for (const answer of answers) {
    const snapshot = snapshotById.get(answer.questionId);
    if (!snapshot) {
      errors.push({ questionId: answer.questionId, message: '질문지에 없는 질문입니다.' });
      continue;
    }
    if (answered.has(snapshot.id)) {
      errors.push({ questionId: snapshot.id, message: '같은 질문에 답변이 중복됩니다.' });
      continue;
    }

    const expected = FIELD_BY_TYPE[snapshot.type];
    const provided = ANSWER_FIELDS.filter((field) => answer[field] != null);
    const wrong = provided.filter((field) => field !== expected);
    if (wrong.length > 0) {
      typeErrors.push({
        questionId: snapshot.id,
        message: `${snapshot.type} 질문에는 ${expected}만 보낼 수 있습니다. (받은 필드: ${wrong.join(', ')})`,
      });
      continue;
    }

    const normalized = normalizeAnswer(snapshot, answer, errors);
    if (normalized) {
      answered.set(snapshot.id, normalized);
    }
  }

  for (const snapshot of snapshots) {
    if (snapshot.required && !answered.has(snapshot.id) && !hasErrorFor(snapshot.id, errors, typeErrors)) {
      errors.push({ questionId: snapshot.id, message: '필수 질문에 답변하지 않았습니다.' });
    }
  }

  if (typeErrors.length > 0) {
    throw new BadRequestException({
      code: 'INVALID_ANSWER_TYPE',
      message: '질문 유형과 답변 필드가 맞지 않습니다.',
      details: { errors: typeErrors },
    });
  }
  if (errors.length > 0) {
    throw new UnprocessableEntityException({
      code: 'ANSWER_VALIDATION_FAILED',
      message: '답변이 질문 조건을 만족하지 않습니다.',
      details: { errors },
    });
  }

  return [...answered.values()];
}

/** 유효하면 저장 형태로 정리해 반환, 답변이 비어 있으면 null(미응답), 위반이면 errors에 추가하고 null */
function normalizeAnswer(
  snapshot: DeclarationQuestionSnapshot,
  answer: AnswerDto,
  errors: AnswerError[],
): NormalizedAnswer | null {
  const empty = { snapshotQuestionId: snapshot.id, answerScore: null, answerOptionId: null, answerText: null };
  const fail = (message: string) => {
    errors.push({ questionId: snapshot.id, message });
    return null;
  };

  switch (snapshot.type) {
    case QuestionType.SCORE: {
      const score = answer.answerScore;
      if (score == null) return null;
      const min = snapshot.scoreMin ?? 1;
      const max = snapshot.scoreMax ?? 10;
      if (!Number.isInteger(score) || score < min || score > max) {
        return fail(`점수는 ${min}~${max} 사이의 정수여야 합니다.`);
      }
      return { ...empty, answerScore: score };
    }
    case QuestionType.SINGLE_CHOICE: {
      const optionId = answer.answerOptionId;
      if (optionId == null || optionId === '') return null;
      const options = (snapshot.options as SnapshotOption[] | null) ?? [];
      if (!options.some((option) => option.optionId === optionId)) {
        return fail('존재하지 않는 선택지입니다.');
      }
      return { ...empty, answerOptionId: optionId };
    }
    case QuestionType.TEXT: {
      const text = answer.answerText?.trim();
      if (!text) return null;
      if (snapshot.maxLength != null && text.length > snapshot.maxLength) {
        return fail(`답변은 ${snapshot.maxLength}자 이내여야 합니다.`);
      }
      return { ...empty, answerText: text };
    }
  }
}

function hasErrorFor(questionId: string, ...lists: AnswerError[][]): boolean {
  return lists.some((list) => list.some((e) => e.questionId === questionId));
}
