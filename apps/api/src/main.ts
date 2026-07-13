import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";

async function bootstrap(): Promise<void> {
  const env = getEnv(); // zod-validated: a bad deploy dies here, before Nest boots
  const app = await NestFactory.create(AppModule);
  // Contract paths are prefix-free ("/auth/login", ...); every HTTP route is
  // served under /api so the reverse proxy can split api/static by prefix.
  app.setGlobalPrefix("api");
  app.enableShutdownHooks();
  await app.listen(env.PORT);
  new Logger("bootstrap").log(`boca api listening on :${env.PORT}/api`);
}

void bootstrap();
