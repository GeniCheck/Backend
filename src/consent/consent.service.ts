import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateConsentDto, Step2ConsentDto } from './dto';

@Injectable()
export class ConsentService {
  constructor(private readonly prisma: PrismaService) {}

  // ===========================
  // 1단계 동의 생성
  // ===========================
  async createStep1(dto: CreateConsentDto, userId: string): Promise<unknown> {
    if (dto.applicantId !== userId) {
      throw new ForbiddenException('본인의 동의만 생성할 수 있습니다.');
    }

    // 지원자 존재 확인
    const applicant = await this.prisma.applicant.findUnique({
      where: { id: dto.applicantId },
    });
    if (!applicant) {
      throw new NotFoundException('지원자를 찾을 수 없습니다.');
    }

    // 기업 존재 확인
    const company = await this.prisma.company.findUnique({
      where: { id: dto.companyId },
    });
    if (!company) {
      throw new NotFoundException('기업을 찾을 수 없습니다.');
    }

    // 이미 동의 레코드가 존재하는지 확인 (같은 지원자-기업 조합)
    const existing = await this.prisma.consent.findFirst({
      where: {
        applicantId: dto.applicantId,
        companyId: dto.companyId,
      },
      orderBy: { createdAt: 'desc' },
    });
    // 철회된 경우 재동의 허용 — 새 레코드 생성
    // pending 또는 agreed 상태면 중복으로 간주
    if (existing && existing.status !== 'withdrawn') {
      throw new BadRequestException('이미 동의 내역이 존재합니다.');
    }

    if (!dto.agreedTerms) {
      throw new BadRequestException('이용약관에 동의해야 합니다.');
    }

    const consent = await this.prisma.consent.create({
      data: {
        applicantId: dto.applicantId,
        companyId: dto.companyId,
        step1: true,
        step1AgreedAt: new Date(dto.agreedAt),
        agreedTerms: dto.agreedTerms,
        status: 'pending',
      },
    });

    return {
      consentId: consent.id,
      step: 1,
      agreedAt: consent.step1AgreedAt,
      status: consent.status,
    };
  }

  // ===========================
  // 동의 상태 조회
  // ===========================
  async getConsent(id: string, userId: string): Promise<unknown> {
    const consent = await this.prisma.consent.findUnique({
      where: { id },
    });
    if (!consent) {
      throw new NotFoundException('동의 내역을 찾을 수 없습니다.');
    }

    if (consent.applicantId !== userId) {
      throw new ForbiddenException('본인의 동의만 조회할 수 있습니다.');
    }

    return {
      step1: consent.step1,
      step1AgreedAt: consent.step1AgreedAt,
      step2: consent.step2,
      step2AgreedAt: consent.step2AgreedAt,
      status: consent.status,
    };
  }

  // ===========================
  // 2단계 동의 처리
  // ===========================
  async updateStep2(id: string, dto: Step2ConsentDto, userId: string): Promise<unknown> {
    const consent = await this.prisma.consent.findUnique({
      where: { id },
    });
    if (!consent) {
      throw new NotFoundException('동의 내역을 찾을 수 없습니다.');
    }

    if (consent.applicantId !== userId) {
      throw new ForbiddenException('본인의 동의만 수정할 수 있습니다.');
    }

    // 1단계 동의가 완료되지 않은 경우
    if (!consent.step1) {
      throw new BadRequestException('1단계 동의가 완료되지 않았습니다.');
    }

    // 이미 철회된 동의는 수정 불가
    if (consent.status === 'withdrawn') {
      throw new ForbiddenException('철회된 동의는 수정할 수 없습니다.');
    }

    // 이미 2단계 동의가 완료된 경우
    if (consent.step2) {
      throw new BadRequestException('이미 2단계 동의가 완료되었습니다.');
    }

    const now = new Date();
    const updated = await this.prisma.consent.update({
      where: { id },
      data: {
        step2: dto.agreed,
        step2AgreedAt: now,
        status: dto.agreed ? 'agreed' : 'withdrawn',
      },
    });

    return {
      consentId: updated.id,
      step: 2,
      agreedAt: updated.step2AgreedAt,
      status: updated.status,
    };
  }

  // ===========================
  // 동의 철회
  // ===========================
  async withdraw(id: string, userId: string): Promise<unknown> {
    const consent = await this.prisma.consent.findUnique({
      where: { id },
    });
    if (!consent) {
      throw new NotFoundException('동의 내역을 찾을 수 없습니다.');
    }

    if (consent.applicantId !== userId) {
      throw new ForbiddenException('본인의 동의만 철회할 수 있습니다.');
    }

    // 이미 철회된 경우
    if (consent.status === 'withdrawn') {
      throw new BadRequestException('이미 철회된 동의입니다.');
    }

    await this.prisma.consent.update({
      where: { id },
      data: { status: 'withdrawn' },
    });

    return { status: 'withdrawn' };
  }
}
