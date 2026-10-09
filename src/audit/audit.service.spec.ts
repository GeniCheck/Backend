import { AuditService } from './audit.service';
import { PrismaService } from '../prisma/prisma.service';

describe('AuditService', () => {
  let prismaMock: any;
  let service: AuditService;

  beforeEach(() => {
    prismaMock = { auditLog: { create: jest.fn().mockResolvedValue({}) } };
    service = new AuditService(prismaMock as unknown as PrismaService);
  });

  it('tx 없이 호출하면 PrismaService로 감사 로그를 저장한다', async () => {
    await service.log({
      actorType: 'COMPANY',
      actorId: 'comp-1',
      action: 'EMPLOYEE_CREATED',
      targetType: 'Employee',
      targetId: 'emp-1',
      ip: '127.0.0.1',
      userAgent: 'jest',
      metadata: { email: 'emp@test.com' },
    });

    expect(prismaMock.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'COMPANY',
        actorId: 'comp-1',
        action: 'EMPLOYEE_CREATED',
        targetType: 'Employee',
        targetId: 'emp-1',
        ip: '127.0.0.1',
        userAgent: 'jest',
        metadata: { email: 'emp@test.com' },
      },
    });
  });

  it('tx를 넘기면 해당 트랜잭션으로 저장하고, 생략한 값은 null로 채운다', async () => {
    const tx = { auditLog: { create: jest.fn().mockResolvedValue({}) } };

    await service.log({ actorType: 'SYSTEM', action: 'LINK_EXPIRED', targetType: 'AccessLink' }, tx as any);

    expect(prismaMock.auditLog.create).not.toHaveBeenCalled();
    expect(tx.auditLog.create).toHaveBeenCalledWith({
      data: {
        actorType: 'SYSTEM',
        actorId: null,
        action: 'LINK_EXPIRED',
        targetType: 'AccessLink',
        targetId: null,
        ip: null,
        userAgent: null,
        metadata: undefined,
      },
    });
  });
});
