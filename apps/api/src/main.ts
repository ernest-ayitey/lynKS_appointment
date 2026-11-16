import 'reflect-metadata';
import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';

// `.env` loading for the app itself is handled by `ConfigModule.forRoot()`
// in AppModule. This file only needs to bootstrap Nest.

// Origin(s) allowed to call this API from a browser. Defaults to the
// Vite dev server so a fresh local checkout works with no extra
// configuration; set CORS_ORIGIN (comma-separated for several) to
// override for any other environment.
const DEFAULT_CORS_ORIGIN = 'http://localhost:5173';

async function bootstrap(): Promise<void> {
  const app = await NestFactory.create(AppModule);

  app.enableCors({
    origin: (process.env.CORS_ORIGIN ?? DEFAULT_CORS_ORIGIN)
      .split(',')
      .map((origin) => origin.trim())
      .filter((origin) => origin.length > 0),
  });

  const port = process.env.PORT ?? 3000;
  await app.listen(port);
}

bootstrap();
