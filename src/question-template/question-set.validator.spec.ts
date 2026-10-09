import { UnprocessableEntityException } from '@nestjs/common';
import { QuestionDto } from './dto/question.dto';
import { validateQuestionSet } from './question-set.validator';

const score = (over: Partial<QuestionDto> = {}): QuestionDto => ({
  order: 1,
  type: 'SCORE',
  text: '업무 책임감을 평가해 주세요.',
  required: true,
  scoreMin: 1,
  scoreMax: 10,
  evaluationEnabled: true,
  ...over,
});
const choice = (over: Partial<QuestionDto> = {}): QuestionDto => ({
  order: 2,
  type: 'SINGLE_CHOICE',
  text: '선호 업무 방식은 무엇인가요?',
  required: true,
  options: ['개인 집중', '팀 협업'],
  evaluationEnabled: false,
  ...over,
});
const text = (over: Partial<QuestionDto> = {}): QuestionDto => ({
  order: 3,
  type: 'TEXT',
  text: '주요 성과를 작성해 주세요.',
  required: true,
  maxLength: 500,
  evaluationEnabled: true,
  ...over,
});

function expectInvalid(questions: QuestionDto[], field: string) {
  try {
    validateQuestionSet(questions);
    throw new Error('예외가 발생해야 합니다.');
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    const body = (error as UnprocessableEntityException).getResponse() as any;
    expect(body.code).toBe('INVALID_QUESTION_SET');
    expect(body.details.errors.map((e: any) => e.field)).toContain(field);
  }
}

describe('validateQuestionSet', () => {
  it('세 유형이 모두 유효하면 order순으로 정리하고 유형과 무관한 필드는 버린다', () => {
    const result = validateQuestionSet([
      text({ scoreMin: 1, options: ['x', 'y'] }),
      score({ maxLength: 10, text: '  앞뒤 공백  ' }),
      choice({ options: [' 개인 집중 ', '팀 협업'], scoreMax: 5 }),
    ]);

    expect(result.map((q) => q.order)).toEqual([1, 2, 3]);
    expect(result[0]).toEqual({
      order: 1, type: 'SCORE', text: '앞뒤 공백', required: true,
      scoreMin: 1, scoreMax: 10, evaluationEnabled: true,
    });
    expect(result[1]).toEqual({
      order: 2, type: 'SINGLE_CHOICE', text: '선호 업무 방식은 무엇인가요?', required: true,
      options: ['개인 집중', '팀 협업'], evaluationEnabled: false,
    });
    expect(result[2]).toEqual({
      order: 3, type: 'TEXT', text: '주요 성과를 작성해 주세요.', required: true,
      maxLength: 500, evaluationEnabled: true,
    });
  });

  describe('공통', () => {
    it('질문이 없으면 422', () => expectInvalid([], 'questions'));
    it('order 중복이면 422', () => expectInvalid([score({ order: 1 }), text({ order: 1 })], 'order'));
    it('질문 문구가 비면 422', () => expectInvalid([score({ text: '   ' })], 'text'));
    it('질문 문구가 100자를 넘으면 422', () => expectInvalid([score({ text: '가'.repeat(101) })], 'text'));
    it('질문 문구 100자는 허용', () => expect(validateQuestionSet([score({ text: '가'.repeat(100) })])).toHaveLength(1));
  });

  describe('SCORE', () => {
    it('scoreMin/scoreMax 누락이면 422', () => {
      expectInvalid([score({ scoreMin: undefined })], 'scoreMin/scoreMax');
      expectInvalid([score({ scoreMax: undefined })], 'scoreMin/scoreMax');
    });
    it('scoreMin < 1 이면 422', () => expectInvalid([score({ scoreMin: 0 })], 'scoreMin/scoreMax'));
    it('scoreMax > 10 이면 422', () => expectInvalid([score({ scoreMax: 11 })], 'scoreMin/scoreMax'));
    it('scoreMin >= scoreMax 이면 422', () => {
      expectInvalid([score({ scoreMin: 5, scoreMax: 5 })], 'scoreMin/scoreMax');
      expectInvalid([score({ scoreMin: 7, scoreMax: 3 })], 'scoreMin/scoreMax');
    });
  });

  describe('SINGLE_CHOICE', () => {
    it('선택지가 2개 미만이면 422', () => {
      expectInvalid([choice({ options: ['하나'] })], 'options');
      expectInvalid([choice({ options: undefined })], 'options');
    });
    it('빈 선택지가 있으면 422', () => expectInvalid([choice({ options: ['개인 집중', '  '] })], 'options'));
    it('선택지가 중복되면 422 (앞뒤 공백 무시)', () =>
      expectInvalid([choice({ options: ['팀 협업', ' 팀 협업'] })], 'options'));
  });

  describe('TEXT', () => {
    it('maxLength 누락이면 422', () => expectInvalid([text({ maxLength: undefined })], 'maxLength'));
    it('maxLength가 1~1000을 벗어나면 422', () => {
      expectInvalid([text({ maxLength: 0 })], 'maxLength');
      expectInvalid([text({ maxLength: 1001 })], 'maxLength');
    });
    it('maxLength 1과 1000은 허용', () => {
      expect(validateQuestionSet([text({ maxLength: 1 })])[0].maxLength).toBe(1);
      expect(validateQuestionSet([text({ maxLength: 1000 })])[0].maxLength).toBe(1000);
    });
  });

  it('위반이 여러 개면 모두 details.errors에 담는다', () => {
    try {
      validateQuestionSet([score({ scoreMin: 0 }), choice({ options: ['하나'] }), text({ maxLength: 0 })]);
      throw new Error('예외가 발생해야 합니다.');
    } catch (error) {
      const body = (error as UnprocessableEntityException).getResponse() as any;
      expect(body.details.errors).toHaveLength(3);
    }
  });
});
