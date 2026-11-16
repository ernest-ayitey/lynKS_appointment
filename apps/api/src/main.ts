import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// `.env` loading for the app itself is handled by `ConfigModule.forRoot()`
// in AppModule. This file only needs to bootstrap Nest.

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);
  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
