import { EVAL_QUEUE_NAME } from "@boca/config";
import { Inject, Injectable, Logger, type OnApplicationShutdown } from "@nestjs/common";
import { Queue } from "bullmq";
import IORedis from "ioredis";
import { ENV, type Env } from "../../config/env";

/** Job payload on the "ai-score" queue. tenantId scopes the worker's RLS tx. */
export interface AiScoreJobData {
  evaluationId: string;
  tenantId: string;
}

/**
 * Producer side of the ai-score queue (HTTP app). The Redis connection is
 * created lazily on the first enqueue so the API can boot without Redis;
 * enqueue failures surface to the caller (the enqueuer then marks the row).
 */
@Injectable()
export class EvalQueueService implements OnApplicationShutdown {
  private readonly logger = new Logger(EvalQueueService.name);
  private queue: Queue | undefined;
  private connection: IORedis | undefined;

  constructor(@Inject(ENV) private readonly env: Env) {}

  async enqueue(data: AiScoreJobData): Promise<void> {
    // attempts: 1 — the processor itself converts failures into terminal
    // eval_failed rows; BullMQ-level retries would race the status guard.
    await this.getQueue().add("evaluate", data, {
      jobId: data.evaluationId,
      attempts: 1,
      removeOnComplete: 1000,
      removeOnFail: 1000,
    });
  }

  private getQueue(): Queue {
    if (this.queue) {
      return this.queue;
    }
    const connection = new IORedis(this.env.REDIS_URL);
    connection.on("error", (error) => {
      this.logger.error(`redis (producer) error: ${error.message}`);
    });
    const queue = new Queue(EVAL_QUEUE_NAME, { connection });
    this.connection = connection;
    this.queue = queue;
    return queue;
  }

  async onApplicationShutdown(): Promise<void> {
    await this.queue?.close();
    // BullMQ does not close externally-provided connections — quit explicitly.
    await this.connection?.quit().catch(() => undefined);
    this.queue = undefined;
    this.connection = undefined;
  }
}
