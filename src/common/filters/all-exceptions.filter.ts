import {
  ArgumentsHost,
  Catch,
  ExceptionFilter,
  HttpException,
  HttpStatus,
  Logger,
} from '@nestjs/common';
import { Request, Response } from 'express';

interface ErrorResponseBody {
  success: false;
  code: string;
  message: string;
  details: Record<string, unknown>;
}

/**
 * 전역 예외 필터
 * { success: false, code: 'ERROR_CODE', message: '...', details: {...} }
 */
@Catch()
export class AllExceptionsFilter implements ExceptionFilter {
  private readonly logger = new Logger(AllExceptionsFilter.name);

  catch(exception: unknown, host: ArgumentsHost): void {
    const ctx = host.switchToHttp();
    const response = ctx.getResponse<Response>();
    const request = ctx.getRequest<Request>();

    let status = HttpStatus.INTERNAL_SERVER_ERROR;
    let code = 'INTERNAL_SERVER_ERROR';
    let message = '서버 내부 오류가 발생했습니다.';
    let details: Record<string, unknown> = {};

    if (exception instanceof HttpException) {
      status = exception.getStatus();
      const exceptionResponse = exception.getResponse();

      if (typeof exceptionResponse === 'string') {
        message = exceptionResponse;
        code = this.getDefaultCode(status);
      } else if (typeof exceptionResponse === 'object' && exceptionResponse) {
        const res = exceptionResponse as Record<string, unknown>;

        // class-validator 의 ValidationPipe 에러는 message 가 배열인 경우가 있다
        if (Array.isArray(res.message)) {
          message = '유효성 검사에 실패했습니다.';
          code = 'VALIDATION_ERROR';
          details = { errors: res.message };
        } else {
          message = (res.message as string) ?? message;
          code = (res.code as string) ?? this.getDefaultCode(status);
          if (res.details && typeof res.details === 'object') {
            details = res.details as Record<string, unknown>;
          }
        }
      }
    } else if (exception instanceof Error) {
      message = exception.message;
    }

    // 5xx 에러는 로깅
    if (status >= 500) {
      this.logger.error(
        `[${request.method}] ${request.url} -> ${status}`,
        exception instanceof Error ? exception.stack : String(exception),
      );
    }

    const body: ErrorResponseBody = {
      success: false,
      code,
      message,
      details,
    };

    response.status(status).json(body);
  }

  private getDefaultCode(status: number): string {
    switch (status) {
      case HttpStatus.BAD_REQUEST:
        return 'BAD_REQUEST';
      case HttpStatus.UNAUTHORIZED:
        return 'UNAUTHORIZED';
      case HttpStatus.FORBIDDEN:
        return 'FORBIDDEN';
      case HttpStatus.NOT_FOUND:
        return 'NOT_FOUND';
      case HttpStatus.CONFLICT:
        return 'CONFLICT';
      case HttpStatus.UNPROCESSABLE_ENTITY:
        return 'UNPROCESSABLE_ENTITY';
      default:
        return 'INTERNAL_SERVER_ERROR';
    }
  }
}
