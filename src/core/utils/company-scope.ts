import { ForbiddenException } from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { JwtPayload } from '../../auth/strategies/jwt.strategy';
import { PrismaService } from '../../prisma/prisma.service';

/**
 * 로그인 사용자의 소속 기업 ID(companyId)를 구한다.
 *
 * JWT의 sub는 역할마다 가리키는 대상이 다르다.
 * - COMPANY    : sub = companyId (대표 계정이 곧 기업)
 * - HR_MANAGER : sub = hrManagerId (인사팀장 개인 계정)
 * sub를 그대로 companyId로 쓰면 인사팀장 요청에서 hrManagerId로 기업 데이터를 조회하게 되어
 * 결과가 비거나 권한 검사가 틀어진다. 그래서 기업 범위가 필요한 신규 API는
 * sub를 직접 쓰지 말고 반드시 이 함수로 companyId를 구한다.
 */
export async function resolveCompanyId(
  user: JwtPayload | undefined,
  prisma: PrismaService | Prisma.TransactionClient,
): Promise<string> {
  switch (user?.role) {
    case 'COMPANY':
      return user.sub;
    case 'HR_MANAGER': {
      // 읽기만 한다. 삭제된 인사팀장이면 기업 범위를 줄 수 없음
      const hrManager = await prisma.hrManager.findUnique({
        where: { id: user.sub },
        select: { companyId: true },
      });
      if (!hrManager) {
        throw forbidden();
      }
      return hrManager.companyId;
    }
    default:
      throw forbidden();
  }
}

function forbidden(): ForbiddenException {
  return new ForbiddenException({
    code: 'FORBIDDEN',
    message: '기업 정보에 접근할 권한이 없습니다.',
  });
}
