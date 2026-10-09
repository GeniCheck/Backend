import { INestApplication } from '@nestjs/common';
import { Test } from '@nestjs/testing';
import { JwtAuthGuard } from '../auth/guards/jwt-auth.guard';
import { RolesGuard } from '../core/guards/roles.guard';
import { CeoEvaluationController } from './ceo-evaluation.controller';
import { CeoEvaluationService } from './ceo-evaluation.service';
import { EvaluationResultController } from './evaluation-result.controller';
import { EvaluationResultService } from './evaluation-result.service';
import { ResultLinkController } from './result-link.controller';
import { SelfEvaluationController } from './self-evaluation.controller';
import { SelfEvaluationService } from './self-evaluation.service';

/**
 * 라우트 매칭 테스트: 실제 Nest 앱을 띄워 HTTP로 요청하고 어느 핸들러가 받는지 확인한다.
 * 'evaluations/result/:token'(직원)과 'evaluations/:evaluationId/result'(대표)가 섞이지 않아야 한다.
 */
describe('evaluations 라우트 매칭', () => {
  let app: INestApplication;
  let baseUrl: string;
  const result = { getCompanyResult: jest.fn(), getEmployeeResult: jest.fn(), submitOpinion: jest.fn() };
  const self = { getForm: jest.fn(), submit: jest.fn() };
  const ceo = { getForm: jest.fn(), submit: jest.fn() };
  const TOKEN = 'a'.repeat(64);
  const EVALUATION_ID = '11111111-2222-3333-4444-555555555555';

  beforeAll(async () => {
    const moduleRef = await Test.createTestingModule({
      // 모듈과 같은 등록 순서
      controllers: [SelfEvaluationController, ResultLinkController, CeoEvaluationController, EvaluationResultController],
      providers: [
        { provide: SelfEvaluationService, useValue: self },
        { provide: EvaluationResultService, useValue: result },
        { provide: CeoEvaluationService, useValue: ceo },
      ],
    })
      .overrideGuard(JwtAuthGuard)
      .useValue({ canActivate: (ctx: any) => ((ctx.switchToHttp().getRequest().user = { sub: 'comp-1', role: 'COMPANY' }), true) })
      .overrideGuard(RolesGuard)
      .useValue({ canActivate: () => true })
      .compile();

    app = moduleRef.createNestApplication();
    app.setGlobalPrefix('api/v1');
    await app.listen(0);
    baseUrl = `${await app.getUrl()}/api/v1`.replace('[::1]', 'localhost');
  });

  afterAll(async () => {
    await app.close();
  });

  beforeEach(() => {
    jest.clearAllMocks();
    for (const fn of [...Object.values(result), ...Object.values(self), ...Object.values(ceo)]) {
      fn.mockResolvedValue({ ok: true });
    }
  });

  const request = (method: string, path: string, body?: unknown) =>
    fetch(`${baseUrl}${path}`, {
      method,
      headers: { 'Content-Type': 'application/json' },
      body: body ? JSON.stringify(body) : undefined,
    });

  it('GET /evaluations/result/:token → 직원 결과 조회', async () => {
    const res = await request('GET', `/evaluations/result/${TOKEN}`);
    expect(res.status).toBe(200);
    expect(result.getEmployeeResult).toHaveBeenCalledWith(TOKEN);
    expect(result.getCompanyResult).not.toHaveBeenCalled();
  });

  it('GET /evaluations/:evaluationId/result → 대표 결과 조회', async () => {
    const res = await request('GET', `/evaluations/${EVALUATION_ID}/result`);
    expect(res.status).toBe(200);
    expect(result.getCompanyResult).toHaveBeenCalledWith({ sub: 'comp-1', role: 'COMPANY' }, EVALUATION_ID);
    expect(result.getEmployeeResult).not.toHaveBeenCalled();
  });

  it('POST /evaluations/result/:token/opinion → 의견 제출', async () => {
    const res = await request('POST', `/evaluations/result/${TOKEN}/opinion`, { content: '의견' });
    expect(res.status).toBe(201);
    expect(result.submitOpinion).toHaveBeenCalledWith(TOKEN, expect.objectContaining({ content: '의견' }), expect.any(Object));
  });

  it('토큰이 우연히 "result"여도 직원 라우트로 간다 (등록 순서 확인)', async () => {
    await request('GET', '/evaluations/result/result');
    expect(result.getEmployeeResult).toHaveBeenCalledWith('result');
    expect(result.getCompanyResult).not.toHaveBeenCalled();
  });

  it('기존 자기평가·대표 검증 라우트도 그대로 매칭된다', async () => {
    await request('GET', `/evaluations/self/${TOKEN}`);
    expect(self.getForm).toHaveBeenCalledWith(TOKEN);

    await request('GET', `/evaluations/${EVALUATION_ID}/ceo`);
    expect(ceo.getForm).toHaveBeenCalledWith({ sub: 'comp-1', role: 'COMPANY' }, EVALUATION_ID);

    expect(result.getEmployeeResult).not.toHaveBeenCalled();
    expect(result.getCompanyResult).not.toHaveBeenCalled();
  });
});
