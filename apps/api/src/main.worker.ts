import "reflect-metadata";
import { EVAL_QUEUE_NAME } from "@boca/config";
import { Logger } from "@nestjs/common";
import { NestFactory } from "@nestjs/core";
import { AppModule } from "./app.module";
import { getEnv } from "./config/env";
import { AiScoreWorker } from "./modules/evaluation/ai-score.worker";

/**
 * Worker entrypoint: same DI container as the API but no HTTP listener.
 * Registers the BullMQ "ai-score" processor; the Worker's Redis connection
 * keeps the event loop alive. Future processors (outbox relay, escalation
 * scanner, retention purge, report-pdf) start here too.
 */
async function bootstrap(): Promise<void> {
  getEnv(); // fail fast on bad env, same as the HTTP entrypoint
  const app = await NestFactory.createApplicationContext(AppModule);
  app.enableShutdownHooks();
  app.get(AiScoreWorker).start();
  new Logger("worker").log(`worker up — consuming '${EVAL_QUEUE_NAME}'`);
}

void bootstrap();
