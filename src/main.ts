import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import helmet from 'helmet';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

  // nginx 리버스 프록시 뒤에서 실행되므로, X-Forwarded-For를 신뢰해야
  // req.ip가 nginx 내부 IP가 아니라 실제 접속자 IP로 잡힘.
  // 이게 없으면 rate limit(@nestjs/throttler)이 IP별이 아니라 전체 트래픽 합산으로 걸림.
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // 기본 보안 헤더 (CSP는 Swagger UI 인라인 스크립트와 충돌해서 끔 — API 서버라 프론트 XSS 방어는 별도)
  app.use(helmet({ contentSecurityPolicy: false }));

  // 전역 prefix
  app.setGlobalPrefix('api/v1');

  // 전역 ValidationPipe (DTO 유효성 검사)
  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
    }),
  );

  // 전역 인터셉터: 성공 응답 포맷 { success, message, data }
  app.useGlobalInterceptors(
    new ClassSerializerInterceptor(app.get(Reflector)),
    new ResponseInterceptor(),
  );

  // 전역 예외 필터: 에러 응답 포맷 { success, code, message, details }
  app.useGlobalFilters(new AllExceptionsFilter());

  // CORS
  app.enableCors({
    origin: true,
    credentials: true,
  });

  // Swagger 설정
  const swaggerConfig = new DocumentBuilder()
    .setTitle('GeniCheck API')
    .setDescription('GeniCheck Backend API Documentation')
    .setVersion('1.0')
    .addBearerAuth(
      {
        type: 'http',
        scheme: 'bearer',
        bearerFormat: 'JWT',
        in: 'header',
      },
      'access-token',
    )
    .build();

  const document = SwaggerModule.createDocument(app, swaggerConfig);
  SwaggerModule.setup('api/docs', app, document, {
    swaggerOptions: { persistAuthorization: true },
  });

  const port = configService.get<number>('PORT') ?? 3000;
  await app.listen(port);

  // eslint-disable-next-line no-console
  console.log(`🚀 GeniCheck server running on http://localhost:${port}`);
  // eslint-disable-next-line no-console
  console.log(`📘 Swagger docs at http://localhost:${port}/api/docs`);
}

bootstrap();
