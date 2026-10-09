import {
  ForbiddenException,
  HttpException,
  HttpStatus,
  Injectable,
  NotFoundException,
  ServiceUnavailableException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { ResumeFile } from '@prisma/client';
import { randomUUID } from 'crypto';
import { AuditService } from '../audit/audit.service';
import { JwtPayload } from '../auth/strategies/jwt.strategy';
import { resolveCompanyId } from '../core/utils/company-scope';
import { PrismaService } from '../prisma/prisma.service';
import { CreateResumeUploadUrlDto } from './dto/create-resume-upload-url.dto';
import { StorageService } from './storage/storage.service';

/** 허용 이력서 형식: Content-Type → 허용 확장자 */
export const RESUME_CONTENT_TYPES: Record<string, string> = {
  'application/pdf': '.pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document': '.docx',
};
export const RESUME_MAX_BYTES = 10 * 1024 * 1024;
export const RESUME_UPLOAD_URL_TTL_SECONDS = 10 * 60;

/**
 * 인재 추천 이력서 업로드.
 * 파일 원문은 객체 스토리지에만 있고 DB에는 객체 키와 메타데이터만 저장한다.
 * 업로드 URL 발급 시점에는 uploadedAt=null(미확인)이며, 게시물에 붙일 때 confirmUploaded로 실제 업로드를 확인한다.
 */
@Injectable()
export class ResumeService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly storage: StorageService,
    private readonly auditService: AuditService,
  ) {}

  /** 대표: 이력서 업로드용 presigned PUT URL 발급 */
  async createUploadUrl(user: JwtPayload, dto: CreateResumeUploadUrlDto) {
    const companyId = await resolveCompanyId(user, this.prisma);

    const employee = await this.prisma.employee.findUnique({
      where: { id: dto.employeeId },
      select: { id: true, companyId: true },
    });
    if (!employee) {
      throw new NotFoundException({ code: 'EMPLOYEE_NOT_FOUND', message: '직원을 찾을 수 없습니다.' });
    }
    if (employee.companyId !== companyId) {
      throw new ForbiddenException({ code: 'FORBIDDEN', message: '다른 기업의 직원 이력서는 올릴 수 없습니다.' });
    }

    const agreed = await this.prisma.referralConsent.findFirst({
      where: { employeeId: employee.id, status: 'AGREED' },
      select: { id: true },
    });
    if (!agreed) {
      throw new ForbiddenException({
        code: 'CONSENT_NOT_GIVEN',
        message: '직원이 추천 게시·이력서 공개에 동의한 경우에만 업로드할 수 있습니다.',
      });
    }

    const contentType = dto.contentType.trim().toLowerCase();
    const fileName = sanitizeFileName(dto.fileName);
    const expectedExtension = RESUME_CONTENT_TYPES[contentType];
    if (!expectedExtension || !fileName.toLowerCase().endsWith(expectedExtension)) {
      throw new HttpException(
        {
          code: 'UNSUPPORTED_FILE_TYPE',
          message: 'PDF(.pdf) 또는 Word(.docx) 파일만 올릴 수 있습니다.',
          details: { allowed: Object.keys(RESUME_CONTENT_TYPES) },
        },
        HttpStatus.UNSUPPORTED_MEDIA_TYPE,
      );
    }
    if (dto.fileSize > RESUME_MAX_BYTES) {
      throw new HttpException(
        {
          code: 'FILE_TOO_LARGE',
          message: '이력서는 10MB 이하만 올릴 수 있습니다.',
          details: { maxBytes: RESUME_MAX_BYTES },
        },
        HttpStatus.PAYLOAD_TOO_LARGE,
      );
    }
    if (!this.storage.isConfigured()) {
      // 버킷이 없으면 쓸 수 없는 URL과 메타데이터만 남으므로 저장 전에 막는다
      throw new ServiceUnavailableException({
        code: 'STORAGE_NOT_CONFIGURED',
        message: '파일 저장소가 설정되지 않았습니다.',
      });
    }

    const objectKey = `referral-resumes/${companyId}/${randomUUID()}/${fileName}`;

    // DB 저장 먼저, 스토리지 호출(presign)은 그 다음
    const resumeFile = await this.prisma.resumeFile.create({
      data: {
        companyId,
        employeeId: employee.id,
        objectKey,
        fileName,
        contentType,
        fileSize: dto.fileSize,
      },
    });

    const uploadUrl = await this.storage.presignPut(
      objectKey,
      contentType,
      dto.fileSize,
      RESUME_UPLOAD_URL_TTL_SECONDS,
    );
    const expiresAt = new Date(Date.now() + RESUME_UPLOAD_URL_TTL_SECONDS * 1000);

    await this.auditService.log({
      actorType: 'COMPANY',
      actorId: user.sub,
      action: 'RESUME_UPLOAD_URL_ISSUED',
      targetType: 'ResumeFile',
      targetId: resumeFile.id,
      metadata: { employeeId: employee.id, contentType, fileSize: dto.fileSize },
    });

    return { resumeFileId: resumeFile.id, uploadUrl, objectKey, expiresAt };
  }

  /**
   * 게시물 작성 전에 이력서가 실제로 업로드됐는지 확인한다 (#18에서 사용).
   * - 없거나 다른 기업·직원의 파일 → 404 RESUME_NOT_FOUND
   * - 이미 확인된 파일 → 그대로 반환
   * - 스토리지에 객체가 없으면 422 RESUME_NOT_UPLOADED, 크기·타입이 신고 값과 다르면 422 RESUME_MISMATCH
   */
  async confirmUploaded(resumeFileId: string, companyId: string, employeeId: string): Promise<ResumeFile> {
    const resumeFile = await this.prisma.resumeFile.findUnique({ where: { id: resumeFileId } });
    if (!resumeFile || resumeFile.companyId !== companyId || resumeFile.employeeId !== employeeId) {
      throw new NotFoundException({ code: 'RESUME_NOT_FOUND', message: '이력서 파일을 찾을 수 없습니다.' });
    }
    if (resumeFile.uploadedAt) {
      return resumeFile;
    }

    const stored = await this.storage.headObject(resumeFile.objectKey);
    if (!stored) {
      throw new UnprocessableEntityException({
        code: 'RESUME_NOT_UPLOADED',
        message: '이력서 파일이 아직 업로드되지 않았습니다.',
      });
    }
    const storedType = stored.contentType?.split(';')[0].trim().toLowerCase() ?? null;
    if (stored.contentLength !== resumeFile.fileSize || storedType !== resumeFile.contentType) {
      throw new UnprocessableEntityException({
        code: 'RESUME_MISMATCH',
        message: '업로드된 파일이 신고한 크기·형식과 다릅니다.',
        details: {
          expected: { fileSize: resumeFile.fileSize, contentType: resumeFile.contentType },
          actual: { fileSize: stored.contentLength, contentType: storedType },
        },
      });
    }

    const uploadedAt = new Date();
    await this.prisma.resumeFile.updateMany({
      where: { id: resumeFile.id, uploadedAt: null },
      data: { uploadedAt },
    });
    return { ...resumeFile, uploadedAt };
  }
}

/** 경로 문자(/ \ ..)와 제어 문자를 없애 객체 키·다운로드 이름에 안전한 파일 이름으로 만든다 */
export function sanitizeFileName(fileName: string): string {
  const base = fileName.split(/[\\/]/).pop() ?? '';
  const cleaned = base
    .replace(/[\u0000-\u001f\u007f]/g, '')
    .replace(/\.{2,}/g, '.')
    .replace(/^\.+/, '')
    .trim();
  return cleaned.slice(-200) || 'resume';
}
