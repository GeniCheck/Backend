import { BadRequestException, ValidationPipe } from '@nestjs/common';
import { SubmitCeoEvaluationDto } from './submit-ceo-evaluation.dto';

// src/main.ts의 전역 ValidationPipe와 같은 설정으로 검증한다
const pipe = new ValidationPipe({
  whitelist: true,
  forbidNonWhitelisted: true,
  transform: true,
  transformOptions: { enableImplicitConversion: true },
});

const transform = (body: unknown) =>
  pipe.transform(body, { type: 'body', metatype: SubmitCeoEvaluationDto }) as Promise<SubmitCeoEvaluationDto>;

const valid = () => ({
  items: [{ questionId: 'snap-1', ceoScore: 7 }],
  commonCompetencies: [
    { key: 'TRUST', score: 8 },
    { key: 'DILIGENCE', score: 9 },
    { key: 'RESPONSIBILITY', score: 8 },
    { key: 'COLLABORATION', score: 7 },
    { key: 'COMMUNICATION', score: 7 },
    { key: 'GROWTH_POTENTIAL', score: 9 },
  ],
  rehireIntent: true,
});

describe('SubmitCeoEvaluationDto (법적 안전: 서술형·비boolean 차단)', () => {
  it('정상 body는 통과하고 rehireIntent는 boolean 그대로', async () => {
    await expect(transform(valid())).resolves.toMatchObject({ rehireIntent: true });
    await expect(transform({ ...valid(), rehireIntent: false })).resolves.toMatchObject({ rehireIntent: false });
  });

  // 11
  describe('DTO에 없는 필드(서술형)는 400', () => {
    it('최상위 comment', async () => {
      await expect(transform({ ...valid(), comment: '성실했음' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('재고용 사유 rehireReason', async () => {
      await expect(transform({ ...valid(), rehireReason: '다시 함께하고 싶음' })).rejects.toBeInstanceOf(BadRequestException);
    });
    it('항목 안의 comment', async () => {
      const body = valid();
      (body.items[0] as any).comment = '구체적 근거';
      await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
    });
    it('역량 안의 comment', async () => {
      const body = valid();
      (body.commonCompetencies[0] as any).comment = '신뢰할 만함';
      await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
    });
  });

  // 12
  it.each(['YES', 'HOLD', 'NO', 'true', 'false', 1, 0, null])(
    'rehireIntent %p는 400 (true/false만 허용)',
    async (value) => {
      await expect(transform({ ...valid(), rehireIntent: value })).rejects.toBeInstanceOf(BadRequestException);
    },
  );

  it('rehireIntent 누락은 400', async () => {
    const { rehireIntent: _omit, ...body } = valid();
    await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
  });

  it('점수가 숫자가 아니면 400, 역량 키가 enum이 아니면 400', async () => {
    await expect(transform({ ...valid(), items: [{ questionId: 'snap-1', ceoScore: 'abc' }] })).rejects.toBeInstanceOf(BadRequestException);
    const body = valid();
    (body.commonCompetencies[0] as any).key = 'LEADERSHIP';
    await expect(transform(body)).rejects.toBeInstanceOf(BadRequestException);
  });
});
