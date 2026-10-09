import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  GoneException,
  HttpException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { AccessLinkService } from '../access-link/access-link.service';
import { AuditService } from '../audit/audit.service';
import { MailService } from '../notification/mail.service';
import { PrismaService } from '../prisma/prisma.service';
import { CURRENT_CONSENT_VERSION } from './declaration.constants';
import { DeclarationService } from './declaration.service';

// ---------------------------------------------------------------------------
// 테스트용 인메모리 DB: 이 서비스가 쓰는 Prisma 호출 형태만 흉내 낸다 (prisma·tx 공용)
// ---------------------------------------------------------------------------
type Row = Record<string, any>;

function matches(row: Row, where: Row): boolean {
  return Object.entries(where).every(([key, value]) => {
    if (value && typeof value === 'object' && !(value instanceof Date) && 'not' in value) {
      return row[key] !== value.not;
    }
    return row[key] === value;
  });
}

function pick(row: Row | undefined, select?: Row) {
  if (!row) return null;
  if (!select) return { ...row };
  return Object.fromEntries(Object.keys(select).map((key) => [key, row[key]]));
}

function createFakeDb() {
  let seq = 0;
  const newId = (prefix: string) => `${prefix}-${++seq}`;
  const db = {
    companies: [] as Row[],
    employees: [] as Row[],
    templates: [] as Row[],
    templateQuestions: [] as Row[],
    declarations: [] as Row[],
    snapshots: [] as Row[],
    responses: [] as Row[],
    accessLinks: [] as Row[],
    auditLogs: [] as Row[],
  };
  const byOrder = (a: Row, b: Row) => a.order - b.order;
  const snapshotsOf = (declarationId: string) =>
    db.snapshots.filter((s) => s.declarationId === declarationId).sort(byOrder).map((s) => ({ ...s }));
  const updateMany = (rows: Row[]) => async ({ where, data }: any) => {
    const targets = rows.filter((r) => matches(r, where));
    targets.forEach((r) => Object.assign(r, data));
    return { count: targets.length };
  };

  const client: any = {
    hrManager: { findUnique: async () => null },
    company: {
      findUnique: async ({ where, select }: any) => pick(db.companies.find((c) => c.id === where.id), select),
    },
    employee: {
      findUnique: async ({ where, select }: any) => pick(db.employees.find((e) => e.id === where.id), select),
      updateMany: updateMany(db.employees),
      update: async ({ where, data }: any) => Object.assign(db.employees.find((e) => e.id === where.id)!, data),
    },
    questionTemplate: {
      findUnique: async ({ where }: any) => {
        const template = db.templates.find((t) => t.id === where.id);
        if (!template) return null;
        const questions = db.templateQuestions
          .filter((q) => q.templateId === template.id)
          .sort(byOrder)
          .map((q) => ({ ...q }));
        return { ...template, questions };
      },
    },
    declaration: {
      findFirst: async ({ where }: any) => db.declarations.find((d) => matches(d, where)) ?? null,
      create: async ({ data }: any) => {
        const { questions, ...rest } = data;
        const declaration = {
          id: newId('decl'),
          submittedAt: null,
          consentEvaluation: false,
          consentDataAccess: false,
          consentEvidenceRetention: false,
          consentVersion: null,
          consentAgreedAt: null,
          consentIp: null,
          consentUserAgent: null,
          ...rest,
        };
        db.declarations.push(declaration);
        for (const q of questions.create) {
          db.snapshots.push({
            id: newId('snap'),
            declarationId: declaration.id,
            scoreMin: null,
            scoreMax: null,
            options: null,
            maxLength: null,
            ...structuredClone(q),
          });
        }
        return { ...declaration };
      },
      findUnique: async ({ where, include }: any) => {
        const declaration = db.declarations.find((d) => d.id === where.id);
        if (!declaration) return null;
        return {
          ...declaration,
          ...(include?.questions && { questions: snapshotsOf(declaration.id) }),
          ...(include?.employee && { employee: { ...db.employees.find((e) => e.id === declaration.employeeId) } }),
        };
      },
      updateMany: updateMany(db.declarations),
      findMany: async ({ where }: any) =>
        db.declarations
          .filter((d) => matches(d, where))
          .sort((a, b) => b.submittedAt - a.submittedAt)
          .map((d) => ({
            ...d,
            questions: snapshotsOf(d.id).map((s) => ({
              ...s,
              response: db.responses.find((r) => r.snapshotQuestionId === s.id) ?? null,
            })),
          })),
    },
    declarationResponse: {
      createMany: async ({ data }: any) => {
        for (const r of data) {
          if (db.responses.some((x) => x.snapshotQuestionId === r.snapshotQuestionId)) {
            throw new Error('unique constraint (snapshotQuestionId)');
          }
          db.responses.push({ id: newId('resp'), ...r });
        }
        return { count: data.length };
      },
    },
    accessLink: {
      create: async ({ data }: any) => {
        const link = { id: newId('link'), usedAt: null, revokedAt: null, createdAt: new Date(), ...data };
        db.accessLinks.push(link);
        return { ...link };
      },
      findUnique: async ({ where }: any) => {
        const link = db.accessLinks.find((l) => l.tokenHash === where.tokenHash);
        return link ? { ...link } : null;
      },
      updateMany: updateMany(db.accessLinks),
    },
    auditLog: {
      create: async ({ data }: any) => {
        db.auditLogs.push(data);
        return data;
      },
    },
  };
  client.$transaction = async (fn: (tx: any) => unknown) => fn(client);

  return { db, client };
}

// ---------------------------------------------------------------------------

const CEO = { sub: 'comp-1', role: 'COMPANY' as const };
const OTHER_CEO = { sub: 'comp-2', role: 'COMPANY' as const };
const META = { ip: '203.0.113.7', userAgent: 'jest-browser' };

function seed(db: ReturnType<typeof createFakeDb>['db']) {
  db.companies.push({ id: 'comp-1', companyName: '테크플러스 주식회사' }, { id: 'comp-2', companyName: '다른기업' });
  db.employees.push(
    { id: 'emp-1', companyId: 'comp-1', name: '김민준', email: 'minjun@example.com', position: '과장', declarationStatus: 'NOT_SENT' },
    { id: 'emp-other', companyId: 'comp-2', name: '타사직원', email: 'x@other.com', position: null, declarationStatus: 'NOT_SENT' },
  );
  db.templates.push(
    { id: 'tpl-1', companyId: 'comp-1', name: '개발직군 입사 자기선언', version: 2, status: 'ACTIVE' },
    { id: 'tpl-archived', companyId: 'comp-1', name: '보관됨', version: 1, status: 'ARCHIVED' },
    { id: 'tpl-other', companyId: 'comp-2', name: '타사 템플릿', version: 1, status: 'ACTIVE' },
  );
  db.templateQuestions.push(
    { id: 'tq-1', templateId: 'tpl-1', order: 1, type: 'SCORE', text: '업무 책임감을 평가해 주세요.', required: true, scoreMin: 1, scoreMax: 10, options: null, maxLength: null, evaluationEnabled: true },
    { id: 'tq-2', templateId: 'tpl-1', order: 2, type: 'SINGLE_CHOICE', text: '선호 업무 방식은 무엇인가요?', required: true, scoreMin: null, scoreMax: null, options: ['개인 집중', '팀 협업'], maxLength: null, evaluationEnabled: false },
    { id: 'tq-3', templateId: 'tpl-1', order: 3, type: 'TEXT', text: '주요 성과를 작성해 주세요.', required: true, scoreMin: null, scoreMax: null, options: null, maxLength: 500, evaluationEnabled: true },
  );
}

const AGREED = {
  evaluationAgreed: true,
  dataAccessAgreed: true,
  evidenceRetentionAgreed: true,
  consentVersion: CURRENT_CONSENT_VERSION,
};

async function expectCode(
  promise: Promise<unknown>,
  type: new (...args: any[]) => HttpException,
  code: string,
) {
  const error = await promise.then(
    () => {
      throw new Error('예외가 발생해야 합니다.');
    },
    (e) => e,
  );
  expect(error).toBeInstanceOf(type);
  expect((error as HttpException).getResponse()).toMatchObject({ code });
}

describe('DeclarationService', () => {
  let fake: ReturnType<typeof createFakeDb>;
  let accessLinkService: AccessLinkService;
  let mailMock: { sendDeclarationLink: jest.Mock };
  let service: DeclarationService;

  beforeEach(() => {
    fake = createFakeDb();
    seed(fake.db);
    const prisma = fake.client as unknown as PrismaService;
    accessLinkService = new AccessLinkService(prisma);
    mailMock = { sendDeclarationLink: jest.fn().mockResolvedValue(true) };
    service = new DeclarationService(
      prisma,
      accessLinkService,
      mailMock as unknown as MailService,
      new AuditService(prisma),
    );
  });

  /** 발송 후 메일로 나간 토큰을 돌려준다 */
  async function assignAndGetToken() {
    const result = await service.assign(CEO, 'emp-1', { templateId: 'tpl-1', sendChannel: 'EMAIL' });
    const token: string = mailMock.sendDeclarationLink.mock.calls.at(-1)[0].token;
    return { result, token };
  }

  /** 질문지 조회 결과로 유효한 답변을 만든다 */
  function validAnswers(form: Awaited<ReturnType<DeclarationService['getForm']>>) {
    const [score, choice, text] = form.questions as any[];
    return [
      { questionId: score.questionId, answerScore: 8 },
      { questionId: choice.questionId, answerOptionId: choice.options[1].optionId },
      { questionId: text.questionId, answerText: 'React 성능 개선을 진행했습니다.' },
    ];
  }

  describe('발송 → 질문지 조회 → 제출 → 대표 조회 (전체 흐름)', () => {
    it('끝까지 정상 동작한다', async () => {
      // 메일은 트랜잭션 커밋 후에 나가야 한다: 메일 호출 시점에 데이터가 이미 저장돼 있는지 확인
      mailMock.sendDeclarationLink.mockImplementation(async () => {
        expect(fake.db.declarations).toHaveLength(1);
        expect(fake.db.accessLinks).toHaveLength(1);
        return true;
      });

      // 1) 발송
      const { result, token } = await assignAndGetToken();
      expect(result).toMatchObject({
        templateId: 'tpl-1',
        templateVersion: 2,
        questionCount: 3,
        status: 'SENT',
        linkSent: true,
      });
      expect(result.linkExpiresAt.toISOString()).toMatch(/T14:59:59\.000Z$/); // KST 23:59:59
      expect(fake.db.employees[0].declarationStatus).toBe('SENT');
      expect(mailMock.sendDeclarationLink).toHaveBeenCalledWith(
        expect.objectContaining({ to: 'minjun@example.com', employeeName: '김민준', companyName: '테크플러스 주식회사' }),
      );
      // 링크에는 원문 토큰이 아니라 해시만 저장
      expect(fake.db.accessLinks[0]).toMatchObject({ purpose: 'DECLARATION', targetId: result.declarationId });
      expect(fake.db.accessLinks[0].tokenHash).not.toBe(token);

      // 2) 직원 질문지 조회 (링크 소비 안 함)
      const form = await service.getForm(token);
      expect(form).toMatchObject({
        declarationId: result.declarationId,
        templateName: '개발직군 입사 자기선언',
        templateVersion: 2,
        employee: { name: '김민준', companyName: '테크플러스 주식회사', position: '과장' },
        status: 'SENT',
        requiredConsents: ['EVALUATION', 'DATA_ACCESS', 'EVIDENCE_RETENTION'],
        consentVersion: CURRENT_CONSENT_VERSION,
      });
      const choice = form.questions[1] as any;
      expect(choice.options).toEqual([
        { optionId: expect.stringMatching(/^[0-9a-f-]{36}$/), label: '개인 집중' },
        { optionId: expect.stringMatching(/^[0-9a-f-]{36}$/), label: '팀 협업' },
      ]);
      expect(fake.db.accessLinks[0].usedAt).toBeNull();

      // 3) 제출
      const submitted = await service.submit(token, { answers: validAnswers(form), consents: AGREED }, META);
      expect(submitted).toMatchObject({ declarationId: result.declarationId, status: 'SUBMITTED', linkConsumed: true });

      const declaration = fake.db.declarations[0];
      expect(declaration).toMatchObject({
        status: 'SUBMITTED',
        consentEvaluation: true,
        consentDataAccess: true,
        consentEvidenceRetention: true,
        consentVersion: CURRENT_CONSENT_VERSION,
        consentIp: META.ip,
        consentUserAgent: META.userAgent,
      });
      expect(declaration.consentAgreedAt).toBeInstanceOf(Date);
      expect(fake.db.responses).toHaveLength(3);
      expect(fake.db.employees[0].declarationStatus).toBe('SUBMITTED');
      expect(fake.db.accessLinks[0].usedAt).toBeInstanceOf(Date);
      expect(fake.db.auditLogs.map((log) => log.action)).toEqual(['DECLARATION_SENT', 'DECLARATION_SUBMITTED']);

      // 4) 대표 조회
      const view = await service.getEmployeeDeclarations(CEO, 'emp-1');
      expect(view.employeeId).toBe('emp-1');
      expect(view.declarations).toHaveLength(1);
      expect(view.declarations[0].items).toEqual([
        expect.objectContaining({ type: 'SCORE', question: '업무 책임감을 평가해 주세요.', answerScore: 8, evaluationEnabled: true }),
        expect.objectContaining({ type: 'SINGLE_CHOICE', answerOption: { optionId: choice.options[1].optionId, label: '팀 협업' } }),
        expect.objectContaining({ type: 'TEXT', answerText: 'React 성능 개선을 진행했습니다.' }),
      ]);
      expect(view.declarations[0].consents).toMatchObject({
        evaluationAgreed: true,
        dataAccessAgreed: true,
        evidenceRetentionAgreed: true,
        consentVersion: CURRENT_CONSENT_VERSION,
        agreedAt: expect.any(Date),
      });
    });

    it('제출 후 재제출과 재조회는 409 ALREADY_SUBMITTED', async () => {
      const { token } = await assignAndGetToken();
      const form = await service.getForm(token);
      await service.submit(token, { answers: validAnswers(form), consents: AGREED }, META);

      await expectCode(
        service.submit(token, { answers: validAnswers(form), consents: AGREED }, META),
        ConflictException,
        'ALREADY_SUBMITTED',
      );
      await expectCode(service.getForm(token), ConflictException, 'ALREADY_SUBMITTED');
      expect(fake.db.responses).toHaveLength(3);
    });

    it('만료된 링크는 조회·제출 모두 410 LINK_EXPIRED', async () => {
      const { token } = await assignAndGetToken();
      const form = await service.getForm(token);
      fake.db.accessLinks[0].expiresAt = new Date(Date.now() - 1000);

      await expectCode(service.getForm(token), GoneException, 'LINK_EXPIRED');
      await expectCode(
        service.submit(token, { answers: validAnswers(form), consents: AGREED }, META),
        GoneException,
        'LINK_EXPIRED',
      );
      expect(fake.db.declarations[0].status).toBe('SENT');
    });

    it('자기선언용이 아닌 토큰은 403 INVALID_LINK_PURPOSE', async () => {
      const { result } = await assignAndGetToken();
      const otherToken = await accessLinkService.issue(
        'SELF_EVALUATION',
        result.declarationId,
        new Date(Date.now() + 60_000),
        fake.client,
      );

      await expectCode(service.getForm(otherToken), ForbiddenException, 'INVALID_LINK_PURPOSE');
    });

    it.each([
      ['evaluationAgreed', { ...AGREED, evaluationAgreed: false }],
      ['dataAccessAgreed', { ...AGREED, dataAccessAgreed: false }],
      ['evidenceRetentionAgreed', { ...AGREED, evidenceRetentionAgreed: false }],
      ['consentVersion 불일치', { ...AGREED, consentVersion: '2025-01-01' }],
    ])('동의 누락(%s)이면 403 CONSENT_NOT_GIVEN이고 아무것도 저장하지 않는다', async (_label, consents) => {
      const { token } = await assignAndGetToken();
      const form = await service.getForm(token);

      await expectCode(
        service.submit(token, { answers: validAnswers(form), consents }, META),
        ForbiddenException,
        'CONSENT_NOT_GIVEN',
      );
      expect(fake.db.declarations[0].status).toBe('SENT');
      expect(fake.db.responses).toHaveLength(0);
      expect(fake.db.accessLinks[0].usedAt).toBeNull();
    });

    it('답변 오류(400·422)면 저장하지 않고 링크도 그대로 쓸 수 있다', async () => {
      const { token } = await assignAndGetToken();
      const form = await service.getForm(token);
      const answers = validAnswers(form);

      await expectCode(
        service.submit(token, { answers: [{ ...answers[0], answerScore: undefined, answerText: '8' }, ...answers.slice(1)], consents: AGREED }, META),
        BadRequestException,
        'INVALID_ANSWER_TYPE',
      );
      await expectCode(
        service.submit(token, { answers: [{ ...answers[0], answerScore: 11 }, ...answers.slice(1)], consents: AGREED }, META),
        UnprocessableEntityException,
        'ANSWER_VALIDATION_FAILED',
      );
      expect(fake.db.responses).toHaveLength(0);

      await expect(service.submit(token, { answers, consents: AGREED }, META)).resolves.toMatchObject({ status: 'SUBMITTED' });
    });

    it('발송 후 템플릿을 수정해도 발송된 질문지(스냅샷)는 그대로다', async () => {
      const { token } = await assignAndGetToken();

      // 템플릿 수정: 질문 문구 변경 + 질문 삭제 + 선택지 변경 + version 증가
      fake.db.templates[0].version = 3;
      fake.db.templateQuestions[0].text = '바뀐 질문';
      fake.db.templateQuestions[1].options = ['완전히 다른 선택지', '또 다른 선택지'];
      fake.db.templateQuestions.splice(2, 1);

      const form = await service.getForm(token);
      expect(form.templateVersion).toBe(2);
      expect(form.questions).toHaveLength(3);
      expect(form.questions.map((q) => q.text)).toEqual([
        '업무 책임감을 평가해 주세요.',
        '선호 업무 방식은 무엇인가요?',
        '주요 성과를 작성해 주세요.',
      ]);
      expect((form.questions[1] as any).options.map((o: any) => o.label)).toEqual(['개인 집중', '팀 협업']);

      await expect(service.submit(token, { answers: validAnswers(form), consents: AGREED }, META)).resolves.toMatchObject({
        status: 'SUBMITTED',
      });
    });

    it('메일 발송이 실패해도 질문지·링크 데이터는 유지되고 linkSent=false로 알린다', async () => {
      mailMock.sendDeclarationLink.mockResolvedValue(false);

      const { result, token } = await assignAndGetToken();

      expect(result.linkSent).toBe(false);
      expect(fake.db.declarations).toHaveLength(1);
      expect(fake.db.snapshots).toHaveLength(3);
      expect(fake.db.accessLinks).toHaveLength(1);
      expect(fake.db.employees[0].declarationStatus).toBe('SENT');
      // 링크 자체는 유효하므로 재발송 기능이 생기기 전에도 토큰으로 조회 가능
      await expect(service.getForm(token)).resolves.toMatchObject({ status: 'SENT' });
    });
  });

  describe('assign 오류', () => {
    const dto = (templateId: string) => ({ templateId, sendChannel: 'EMAIL' as const });

    it('직원 또는 템플릿이 없으면 404 EMPLOYEE_OR_TEMPLATE_NOT_FOUND', async () => {
      await expectCode(service.assign(CEO, 'nope', dto('tpl-1')), NotFoundException, 'EMPLOYEE_OR_TEMPLATE_NOT_FOUND');
      await expectCode(service.assign(CEO, 'emp-1', dto('nope')), NotFoundException, 'EMPLOYEE_OR_TEMPLATE_NOT_FOUND');
    });

    it('다른 기업의 직원·템플릿이면 403 FORBIDDEN', async () => {
      await expectCode(service.assign(CEO, 'emp-other', dto('tpl-1')), ForbiddenException, 'FORBIDDEN');
      await expectCode(service.assign(CEO, 'emp-1', dto('tpl-other')), ForbiddenException, 'FORBIDDEN');
      await expectCode(service.assign(OTHER_CEO, 'emp-1', dto('tpl-1')), ForbiddenException, 'FORBIDDEN');
    });

    it('보관된 템플릿이면 422 TEMPLATE_NOT_ACTIVE', async () => {
      await expectCode(service.assign(CEO, 'emp-1', dto('tpl-archived')), UnprocessableEntityException, 'TEMPLATE_NOT_ACTIVE');
    });

    it('제출 전 질문지가 있으면 409 ACTIVE_DECLARATION_EXISTS', async () => {
      await service.assign(CEO, 'emp-1', dto('tpl-1'));
      await expectCode(service.assign(CEO, 'emp-1', dto('tpl-1')), ConflictException, 'ACTIVE_DECLARATION_EXISTS');
      expect(fake.db.declarations).toHaveLength(1);
    });

    it('동시 발송으로 직원 상태가 먼저 SENT가 되면 409이고 질문지를 만들지 않는다', async () => {
      fake.db.employees[0].declarationStatus = 'SENT';

      await expectCode(service.assign(CEO, 'emp-1', dto('tpl-1')), ConflictException, 'ACTIVE_DECLARATION_EXISTS');
      expect(fake.db.declarations).toHaveLength(0);
      expect(mailMock.sendDeclarationLink).not.toHaveBeenCalled();
    });
  });

  describe('getEmployeeDeclarations 오류', () => {
    it('제출된 자기선언이 없으면 404 DECLARATION_NOT_FOUND (발송만 된 상태 포함)', async () => {
      await expectCode(service.getEmployeeDeclarations(CEO, 'emp-1'), NotFoundException, 'DECLARATION_NOT_FOUND');
      await service.assign(CEO, 'emp-1', { templateId: 'tpl-1', sendChannel: 'EMAIL' });
      await expectCode(service.getEmployeeDeclarations(CEO, 'emp-1'), NotFoundException, 'DECLARATION_NOT_FOUND');
    });

    it('다른 기업 직원은 403, 없는 직원은 404 EMPLOYEE_NOT_FOUND', async () => {
      await expectCode(service.getEmployeeDeclarations(CEO, 'emp-other'), ForbiddenException, 'FORBIDDEN');
      await expectCode(service.getEmployeeDeclarations(CEO, 'nope'), NotFoundException, 'EMPLOYEE_NOT_FOUND');
    });
  });
});
