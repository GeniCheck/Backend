import { ExecutionContext, ForbiddenException } from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { RolesGuard } from './roles.guard';
import { Roles } from '../decorators/roles.decorator';

class TestController {
  @Roles('COMPANY')
  companyOnly() {}

  @Roles('COMPANY', 'HR_MANAGER')
  shared() {}

  open() {}
}

@Roles('COMPANY')
class CompanyController {
  list() {}
}

function contextOf(controller: any, handler: () => void, user?: any): ExecutionContext {
  return {
    getHandler: () => handler,
    getClass: () => controller,
    switchToHttp: () => ({ getRequest: () => ({ user }) }),
  } as unknown as ExecutionContext;
}

describe('RolesGuard', () => {
  const guard = new RolesGuard(new Reflector());
  const company = { sub: 'comp-1', role: 'COMPANY' };
  const hr = { sub: 'hr-1', role: 'HR_MANAGER' };
  const applicant = { sub: 'app-1', role: 'APPLICANT' };

  function expectForbidden(context: ExecutionContext) {
    try {
      guard.canActivate(context);
      throw new Error('예외가 발생해야 합니다.');
    } catch (error) {
      expect(error).toBeInstanceOf(ForbiddenException);
      expect((error as ForbiddenException).getResponse()).toMatchObject({ code: 'FORBIDDEN' });
    }
  }

  it('@Roles가 없으면 통과한다', () => {
    expect(guard.canActivate(contextOf(TestController, TestController.prototype.open, hr))).toBe(true);
  });

  it('대표 전용 API는 COMPANY만 통과한다', () => {
    const handler = TestController.prototype.companyOnly;

    expect(guard.canActivate(contextOf(TestController, handler, company))).toBe(true);
    expectForbidden(contextOf(TestController, handler, hr));
    expectForbidden(contextOf(TestController, handler, applicant));
  });

  it('공용 API는 COMPANY와 HR_MANAGER가 통과하고 그 외 역할은 403', () => {
    const handler = TestController.prototype.shared;

    expect(guard.canActivate(contextOf(TestController, handler, company))).toBe(true);
    expect(guard.canActivate(contextOf(TestController, handler, hr))).toBe(true);
    expectForbidden(contextOf(TestController, handler, applicant));
  });

  it('로그인 사용자가 없으면 403', () => {
    expectForbidden(contextOf(TestController, TestController.prototype.companyOnly, undefined));
  });

  it('컨트롤러에 붙인 @Roles도 적용된다', () => {
    const handler = CompanyController.prototype.list;

    expect(guard.canActivate(contextOf(CompanyController, handler, company))).toBe(true);
    expectForbidden(contextOf(CompanyController, handler, hr));
  });
});
