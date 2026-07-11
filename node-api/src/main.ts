import "reflect-metadata";
import cors from "@fastify/cors";
import { NestFactory } from "@nestjs/core";
import { FastifyAdapter, NestFastifyApplication } from "@nestjs/platform-fastify";
import { AppModule } from "./modules/app.module";

async function bootstrap() {
  const port = Number(process.env.NODE_API_PORT ?? 8787);
  const corsOrigin = process.env.CORS_ORIGIN ?? "*";

  const app = await NestFactory.create<NestFastifyApplication>(AppModule, new FastifyAdapter(), {
    logger: ["log", "error", "warn"],
  });

  await app.register(cors, {
    origin: corsOrigin,
    methods: ["GET", "POST", "OPTIONS"],
    allowedHeaders: ["content-type", "x-jwt-token"],
  });

  await app.listen(port, "127.0.0.1");
  console.log(`NestJS Fastify API listening on http://127.0.0.1:${port}`);
}

bootstrap().catch((error) => {
  console.error(error);
  process.exit(1);
});
