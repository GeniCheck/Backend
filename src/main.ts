import { NestFactory, Reflector } from '@nestjs/core';
import { ValidationPipe, ClassSerializerInterceptor } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { AppModule } from './app.module';
import { ResponseInterceptor } from './common/interceptors/response.interceptor';
import { AllExceptionsFilter } from './common/filters/all-exceptions.filter';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);
  const configService = app.get(ConfigService);

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
