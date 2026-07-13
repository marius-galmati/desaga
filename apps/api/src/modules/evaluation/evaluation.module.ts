import { Module } from "@nestjs/common";
import { StorageModule } from "../storage/storage.module";
import { AiScoreWorker } from "./ai-score.worker";
import { EvalQueueService } from "./eval-queue.service";
import { EvaluationController } from "./evaluation.controller";
import { EvaluationService } from "./evaluation.service";
import { EvaluatorService } from "./evaluator.service";

// HTTP side: enqueue + polling endpoints. Worker side: AiScoreWorker is only
// STARTED from main.worker.ts (same DI container, no HTTP listener there).
@Module({
  imports: [StorageModule],
  controllers: [EvaluationController],
  providers: [EvaluationService, EvalQueueService, EvaluatorService, AiScoreWorker],
  exports: [AiScoreWorker],
})
export class EvaluationModule {}
