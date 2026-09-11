import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { Logger } from 'nestjs-pino';
import { AppModule } from './app.module';
import { APP_OPTIONS, configureApp } from './app-setup';
import { corsOrigins, env } from './config/env';

async function bootstrap(): Promise<void> {
  const config = env();
  const app = await NestFactory.create(AppModule, { ...APP_OPTIONS, bufferLogs: true });

  app.useLogger(app.get(Logger));
  app.enableShutdownHooks();

  app.enableCors({
    origin: corsOrigins(config),
    credentials: true,
    allowedHeaders: ['Authorization', 'Content-Type', 'X-Request-Id', 'X-Onboarding-Token', 'X-Device-Id'],
    exposedHeaders: ['X-Request-Id'],
  });

  // Global prefix, body parsing and bigint serialisation — shared with the e2e suite so the two
  // cannot be configured differently.
  configureApp(app);

  if (config.NODE_ENV !== 'production') {
    const document = SwaggerModule.createDocument(
      app,
      new DocumentBuilder()
        .setTitle('BUILDR API')
        .setDescription('Multi-tenant construction site management')
        .setVersion('1')
        .addBearerAuth()
        .build(),
    );
    SwaggerModule.setup('docs', app, document);
  }

  await app.listen(config.PORT, '0.0.0.0');
}

void bootstrap();
