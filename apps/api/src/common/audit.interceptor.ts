import { insertAuditLog, withTenant } from "@boca/db";
import {
  type CallHandler,
  type ExecutionContext,
  Injectable,
  Logger,
  type NestInterceptor,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { Observable } from "rxjs";
import { tap } from "rxjs";
import { AUDITED_KEY } from "./audited.decorator";
import type { Principal, RequestWithPrincipal } from "./principal";

/**
 * SKELETON audit interceptor: writes an audit_log row after every successful
 * handler marked with @Audited(action).
 *
 * TODO(next increment): enlist in the SAME transaction as the handler's domain
 * reads/writes once request-scoped transaction plumbing lands — the audit row
 * for chef-performance reads must be atomic with the read itself.
 */
@Injectable()
export class AuditInterceptor implements NestInterceptor {
  private readonly logger = new Logger(AuditInterceptor.name);

  constructor(private readonly reflector: Reflector) {}

  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
    const action = this.reflector.getAllAndOverride<string | undefined>(AUDITED_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!action) {
      return next.handle();
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const principal = request.principal;

    return next.handle().pipe(
      tap({
        next: () => {
          if (principal) {
            void this.record(action, principal, request);
          }
        },
      }),
    );
  }

  private async record(
    action: string,
    principal: Principal,
    request: RequestWithPrincipal,
  ): Promise<void> {
    try {
      await withTenant(principal.tenantId, (trx) =>
        insertAuditLog(trx, principal.tenantId, {
          actorType: "staff",
          actorId: principal.userId,
          action,
          ip: request.ip ?? null,
          userAgent: request.headers["user-agent"] ?? null,
        }),
      );
    } catch (error) {
      // Never break the response path from the skeleton; the same-tx version
      // will make this atomic instead.
      this.logger.error(`audit write failed for ${action}`, error);
    }
  }
}
