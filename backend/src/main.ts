import 'dotenv/config';
import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { DocumentBuilder, SwaggerModule } from '@nestjs/swagger';
import { cleanupOpenApiDoc } from 'nestjs-zod';
import { AppModule } from './app.module';

async function bootstrap() {
  const app = await NestFactory.create(AppModule);

  const config = new DocumentBuilder()
    .setTitle('Kalamy API')
    .setDescription('Kalamy foundation: Auth + Patient Profile, Assessment, Treatment Plan, Exercise Library, Sessions, Progress, Reports, and Complaints modules')
    .setVersion('0.1.0')
    .addBearerAuth()
    .build();
  const document = SwaggerModule.createDocument(app, config);
  SwaggerModule.setup('api/docs', app, cleanupOpenApiDoc(document));

  const port = process.env.PORT ? Number(process.env.PORT) : 3000;
  await app.listen(port);
}
bootstrap();
