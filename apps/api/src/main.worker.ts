import "reflect-metadata";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";

/**
 * Worker entrypoint STUB: same DI container as the API but no HTTP listener.
 * The queues increment registers BullMQ processors here (outbox relay,
 * escalation scanner, retention purge, AI evaluation) — they will hold Redis
 * connections and keep the event loop alive by themselves.
 */
async function bootstrap(): Promise<void> {
  getEnv(); // fail fast on bad env, same as the HTTP entrypoint
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  new Logger("worker").log("worker up");

  // TODO(queues increment): replace with BullMQ Worker registrations; until
  // then an idle interval keeps the stub process alive for compose parity.
  setInterval(() => {}, 2 ** 31 - 1);
}

void bootstrap();
