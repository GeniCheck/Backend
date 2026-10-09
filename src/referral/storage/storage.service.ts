import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { GetObjectCommand, HeadObjectCommand, PutObjectCommand, S3Client } from '@aws-sdk/client-s3';
import { getSignedUrl } from '@aws-sdk/s3-request-presigner';

export interface StoredObjectInfo {
  contentLength: number | null;
  contentType: string | null;
}

/**
 * S3 호환 객체 스토리지 (인재 추천 이력서).
 * TODO: AWS S3 / OCI Object Storage 중 어느 쪽을 쓸지 팀 확인 필요.
 * 배포 서버가 OCI라 OCI Object Storage(S3 호환 API)일 수 있어 endpoint를 환경변수로 받는다.
 * STORAGE_ENDPOINT를 비우면 AWS S3 기본 엔드포인트를 쓴다.
 */
@Injectable()
export class StorageService {
  private readonly logger = new Logger(StorageService.name);
  private readonly client: S3Client;
  private readonly bucket: string;

  constructor(private readonly configService: ConfigService) {
    const endpoint = this.configService.get<string>('STORAGE_ENDPOINT')?.trim();
    const accessKeyId = this.configService.get<string>('STORAGE_ACCESS_KEY')?.trim();
    const secretAccessKey = this.configService.get<string>('STORAGE_SECRET_KEY')?.trim();

    this.bucket = this.configService.get<string>('STORAGE_BUCKET')?.trim() ?? '';
    this.client = new S3Client({
      region: this.configService.get<string>('STORAGE_REGION')?.trim() || 'ap-northeast-2',
      endpoint: endpoint || undefined,
      forcePathStyle: this.configService.get<string>('STORAGE_FORCE_PATH_STYLE') === 'true',
      // 키를 비우면 SDK 기본 자격 증명 체인(IAM 역할 등)을 사용
      credentials: accessKeyId && secretAccessKey ? { accessKeyId, secretAccessKey } : undefined,
    });
  }

  /** 버킷이 설정돼 있어야 업로드 URL을 발급할 수 있다 */
  isConfigured(): boolean {
    return this.bucket.length > 0;
  }

  /**
   * 업로드용 presigned PUT URL.
   * Content-Type·Content-Length를 서명에 포함해, 발급 때 신고한 것과 다른 파일은 업로드할 수 없게 한다.
   */
  async presignPut(
    objectKey: string,
    contentType: string,
    contentLength: number,
    expiresInSeconds: number,
  ): Promise<string> {
    return getSignedUrl(
      this.client,
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: objectKey,
        ContentType: contentType,
        ContentLength: contentLength,
      }),
      { expiresIn: expiresInSeconds, signableHeaders: new Set(['content-type', 'content-length']) },
    );
  }

  /** 다운로드용 presigned GET URL */
  async presignGet(objectKey: string, expiresInSeconds: number): Promise<string> {
    return getSignedUrl(this.client, new GetObjectCommand({ Bucket: this.bucket, Key: objectKey }), {
      expiresIn: expiresInSeconds,
    });
  }

  /** 객체가 있으면 크기·타입, 없으면 null. NotFound 외의 오류(권한·네트워크 등)는 그대로 던진다 */
  async headObject(objectKey: string): Promise<StoredObjectInfo | null> {
    try {
      const result = await this.client.send(new HeadObjectCommand({ Bucket: this.bucket, Key: objectKey }));
      return { contentLength: result.ContentLength ?? null, contentType: result.ContentType ?? null };
    } catch (error) {
      if (isNotFound(error)) {
        return null;
      }
      this.logger.error(`스토리지 객체 조회 실패: ${objectKey}`, error instanceof Error ? error.stack : String(error));
      throw error;
    }
  }
}

function isNotFound(error: unknown): boolean {
  const e = error as { name?: string; $metadata?: { httpStatusCode?: number } } | null;
  return e?.name === 'NotFound' || e?.name === 'NoSuchKey' || e?.$metadata?.httpStatusCode === 404;
}
