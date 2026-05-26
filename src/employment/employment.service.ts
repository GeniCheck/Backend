import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { LinkService } from '../link/link.service';
import { ResignDto } from './dto/resign.dto';

@Injectable()
export class EmploymentService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly linkService: LinkService,
  ) {}

  async resign(dto: ResignDto, companyId: string): Promise<unknown> {
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: dto.applicantId },
    });
    if (!applicant) {
      throw new NotFoundException('지원자를 찾을 수 없습니다.');
    }

    const existing = await this.prisma.employment.findFirst({
      where: { applicantId: dto.applicantId, companyId },
    });
    if (existing) {
      throw new BadRequestException('이미 퇴사 등록된 직원입니다.');
    }

    const employment = await this.prisma.employment.create({
      data: {
        applicantId: dto.applicantId,
        companyId,
        resignationDate: new Date(dto.resignationDate),
        reason: dto.reason,
        status: 'resigned',
      },
    });

    const expiresAt = new Date();
    expiresAt.setDate(expiresAt.getDate() + 7);

    const token = await this.linkService.generateToken(employment.id);

    await this.prisma.evaluationLink.create({
      data: {
        employmentId: employment.id,
        token,
        expiresAt,
      },
    });

    // TODO: 직원 이메일로 평가 링크 발송 (applicant.email, token) — EmailService export 후 연동 예정

    return {
      employmentId: employment.id,
      resignationDate: employment.resignationDate,
      linkExpiredAt: expiresAt,
    };
  }
}
