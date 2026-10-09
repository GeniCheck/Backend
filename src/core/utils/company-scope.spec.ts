import { ForbiddenException } from '@nestjs/common';
import { resolveCompanyId } from './company-scope';

describe('resolveCompanyId', () => {
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = { hrManager: { findUnique: jest.fn() } };
  });

  it('COMPANY는 sub를 그대로 companyId로 사용하고 DB를 조회하지 않는다', async () => {
    await expect(
      resolveCompanyId({ sub: 'comp-1', role: 'COMPANY' }, prismaMock),
    ).resolves.toBe('comp-1');
    expect(prismaMock.hrManager.findUnique).not.toHaveBeenCalled();
  });

  it('HR_MANAGER는 sub(hrManagerId)로 인사팀장을 조회해 소속 companyId를 반환한다', async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue({ companyId: 'comp-9' });

    await expect(
      resolveCompanyId({ sub: 'hr-1', role: 'HR_MANAGER' }, prismaMock),
    ).resolves.toBe('comp-9');
    expect(prismaMock.hrManager.findUnique).toHaveBeenCalledWith({
      where: { id: 'hr-1' },
      select: { companyId: true },
    });
  });

  it('삭제된 인사팀장이면 403 FORBIDDEN', async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue(null);

    const error = await resolveCompanyId({ sub: 'hr-1', role: 'HR_MANAGER' }, prismaMock).catch(
      (e) => e,
    );
    expect(error).toBeInstanceOf(ForbiddenException);
    expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN' });
  });

  it('그 외 역할(APPLICANT)과 비로그인은 403 FORBIDDEN', async () => {
    for (const user of [{ sub: 'app-1', role: 'APPLICANT' as const }, undefined]) {
      const error = await resolveCompanyId(user, prismaMock).catch((e) => e);
      expect(error).toBeInstanceOf(ForbiddenException);
      expect(error.getResponse()).toMatchObject({ code: 'FORBIDDEN' });
    }
    expect(prismaMock.hrManager.findUnique).not.toHaveBeenCalled();
  });
});
