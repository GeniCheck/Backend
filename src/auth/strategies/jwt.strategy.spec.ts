import { UnauthorizedException } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { JwtStrategy } from './jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

describe('JwtStrategy', () => {
  let strategy: JwtStrategy;
  let prismaMock: any;

  beforeEach(() => {
    prismaMock = {
      applicant: { findUnique: jest.fn() },
      company: { findUnique: jest.fn() },
      hrManager: { findUnique: jest.fn() },
    };

    const configMock = {
      get: jest.fn((key: string) =>
        key === 'JWT_ACCESS_SECRET' ? 'secret' : undefined,
      ),
    } as unknown as ConfigService;

    strategy = new JwtStrategy(configMock, prismaMock as unknown as PrismaService);
  });

  it('rejects a payload missing sub/role', async () => {
    await expect(strategy.validate({} as any)).rejects.toThrow(
      UnauthorizedException,
    );
  });

  it('accepts a valid COMPANY token when the company still exists', async () => {
    prismaMock.company.findUnique.mockResolvedValue({ id: 'comp-1' });

    const result = await strategy.validate({ sub: 'comp-1', role: 'COMPANY' });

    expect(result).toEqual({ sub: 'comp-1', role: 'COMPANY' });
    expect(prismaMock.company.findUnique).toHaveBeenCalledWith({
      where: { id: 'comp-1' },
      select: { id: true },
    });
  });

  it('rejects an HR_MANAGER token once the account has been deleted', async () => {
    prismaMock.hrManager.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'hr-1', role: 'HR_MANAGER' }),
    ).rejects.toThrow('계정을 찾을 수 없습니다. 다시 로그인해주세요.');
  });

  it('rejects an APPLICANT token once the account has been deleted', async () => {
    prismaMock.applicant.findUnique.mockResolvedValue(null);

    await expect(
      strategy.validate({ sub: 'app-1', role: 'APPLICANT' }),
    ).rejects.toThrow(UnauthorizedException);
  });
});
