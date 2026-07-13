import { destroyDbPools } from "@boca/db";
import { Global, Module, type OnApplicationShutdown } from "@nestjs/common";
import { APP_FILTER, APP_GUARD, APP_INTERCEPTOR } from "@nestjs/core";
import { JwtModule } from "@nestjs/jwt";
import { AuditInterceptor } from "./common/audit.interceptor";
import { JwtAuthGuard } from "./common/jwt-auth.guard";
import { RolesGuard } from "./common/roles.guard";
import { ZodExceptionFilter } from "./common/zod-exception.filter";
import { ENV, getEnv } from "./config/env";

@Global()
@Module({
  imports: [
    JwtModule.registerAsync({
      global: true,
      useFactory: () => ({ secret: getEnv().JWT_ACCESS_SECRET }),
    }),
  ],
  providers: [
    { provide: ENV, useFactory: getEnv },
    // Order matters: authentication first, then role check.
    { provide: APP_GUARD, useClass: JwtAuthGuard },
    { provide: APP_GUARD, useClass: RolesGuard },
    { provide: APP_INTERCEPTOR, useClass: AuditInterceptor },
    { provide: APP_FILTER, useClass: ZodExceptionFilter },
  ],
  exports: [ENV],
})
export class CoreModule implements OnApplicationShutdown {
  async onApplicationShutdown(): Promise<void> {
    await destroyDbPools();
  }
}
