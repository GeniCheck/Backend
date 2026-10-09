import { BadRequestException, UnprocessableEntityException } from '@nestjs/common';
import { DeclarationQuestionSnapshot } from '@prisma/client';
import { validateAnswers } from './answer.validator';
import { AnswerDto } from './dto/submit-declaration.dto';

const snapshot = (over: Partial<DeclarationQuestionSnapshot>): DeclarationQuestionSnapshot => ({
  id: 'q',
  declarationId: 'decl-1',
  order: 1,
  type: 'SCORE',
  text: '질문',
  required: true,
  scoreMin: null,
  scoreMax: null,
  options: null,
  maxLength: null,
  evaluationEnabled: true,
  ...over,
});

const SCORE = snapshot({ id: 'q-score', order: 1, type: 'SCORE', scoreMin: 1, scoreMax: 10 });
const CHOICE = snapshot({
  id: 'q-choice',
  order: 2,
  type: 'SINGLE_CHOICE',
  options: [
    { optionId: 'opt-a', label: '개인 집중' },
    { optionId: 'opt-b', label: '팀 협업' },
  ],
});
const TEXT = snapshot({ id: 'q-text', order: 3, type: 'TEXT', maxLength: 10 });
const OPTIONAL_TEXT = snapshot({ id: 'q-opt', order: 4, type: 'TEXT', maxLength: 10, required: false });
const ALL = [SCORE, CHOICE, TEXT, OPTIONAL_TEXT];

const valid: AnswerDto[] = [
  { questionId: 'q-score', answerScore: 8 },
  { questionId: 'q-choice', answerOptionId: 'opt-b' },
  { questionId: 'q-text', answerText: '  성과입니다  ' },
];

function expectError(answers: AnswerDto[], type: any, code: string, questionId?: string) {
  try {
    validateAnswers(ALL, answers);
    throw new Error('예외가 발생해야 합니다.');
  } catch (error) {
    expect(error).toBeInstanceOf(type);
    const body = (error as any).getResponse();
    expect(body.code).toBe(code);
    if (questionId) {
      expect(body.details.errors.map((e: any) => e.questionId)).toContain(questionId);
    }
  }
}

describe('validateAnswers', () => {
  it('유형별로 맞는 답변을 저장 형태로 정리하고, 선택 질문 미응답은 저장하지 않는다', () => {
    expect(validateAnswers(ALL, valid)).toEqual([
      { snapshotQuestionId: 'q-score', answerScore: 8, answerOptionId: null, answerText: null },
      { snapshotQuestionId: 'q-choice', answerScore: null, answerOptionId: 'opt-b', answerText: null },
      { snapshotQuestionId: 'q-text', answerScore: null, answerOptionId: null, answerText: '성과입니다' },
    ]);
  });

  describe('400 INVALID_ANSWER_TYPE (유형과 답변 필드 불일치)', () => {
    it('SCORE 질문에 answerText', () =>
      expectError([{ questionId: 'q-score', answerText: '8점' }, ...valid.slice(1)], BadRequestException, 'INVALID_ANSWER_TYPE', 'q-score'));
    it('SINGLE_CHOICE 질문에 answerScore', () =>
      expectError([valid[0], { questionId: 'q-choice', answerScore: 1 }, valid[2]], BadRequestException, 'INVALID_ANSWER_TYPE', 'q-choice'));
    it('TEXT 질문에 answerOptionId', () =>
      expectError([valid[0], valid[1], { questionId: 'q-text', answerOptionId: 'opt-a' }], BadRequestException, 'INVALID_ANSWER_TYPE', 'q-text'));
    it('유형 불일치는 다른 422 위반보다 먼저 판정한다', () =>
      expectError([{ questionId: 'q-score', answerText: 'x' }, { questionId: 'q-choice', answerOptionId: 'nope' }], BadRequestException, 'INVALID_ANSWER_TYPE'));
  });

  describe('422 ANSWER_VALIDATION_FAILED', () => {
    it('필수 질문 누락', () =>
      expectError([valid[0], valid[1]], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-text'));
    it('필수 TEXT에 공백만 입력하면 누락으로 본다', () =>
      expectError([valid[0], valid[1], { questionId: 'q-text', answerText: '   ' }], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-text'));
    it('점수 범위 밖 (0, 11)', () => {
      expectError([{ questionId: 'q-score', answerScore: 0 }, valid[1], valid[2]], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-score');
      expectError([{ questionId: 'q-score', answerScore: 11 }, valid[1], valid[2]], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-score');
    });
    it('정수가 아닌 점수', () =>
      expectError([{ questionId: 'q-score', answerScore: 7.5 }, valid[1], valid[2]], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-score'));
    it('없는 optionId', () =>
      expectError([valid[0], { questionId: 'q-choice', answerOptionId: 'opt-x' }, valid[2]], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-choice'));
    it('maxLength 초과', () =>
      expectError([valid[0], valid[1], { questionId: 'q-text', answerText: '가'.repeat(11) }], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-text'));
    it('질문지에 없는 questionId', () =>
      expectError([...valid, { questionId: 'q-unknown', answerText: 'x' }], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-unknown'));
    it('같은 질문에 중복 답변', () =>
      expectError([...valid, { questionId: 'q-score', answerScore: 5 }], UnprocessableEntityException, 'ANSWER_VALIDATION_FAILED', 'q-score'));
  });
});
