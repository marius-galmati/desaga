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
  // Bind all interfaces explicitly: inside a container the service must be
  // reachable on its network IP (e.g. api:3000 from the Next proxy), not just
  // loopback/IPv6. Node's default host can bind IPv6-only on some hosts.
  await app.listen(env.PORT, "0.0.0.0");
  new Logger("bootstrap").log(`boca api listening on 0.0.0.0:${env.PORT}/api`);
}

void bootstrap();
