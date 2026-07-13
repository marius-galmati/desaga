import type { UserRole } from "@boca/contracts";
import {
  type CanActivate,
  type ExecutionContext,
  ForbiddenException,
  Injectable,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import type { RequestWithPrincipal } from "./principal";
import { ROLES_KEY } from "./roles.decorator";

/** Global guard, runs after JwtAuthGuard. No @Roles metadata = any staff role. */
@Injectable()
export class RolesGuard implements CanActivate {
  constructor(private readonly reflector: Reflector) {}

  canActivate(context: ExecutionContext): boolean {
    const required = this.reflector.getAllAndOverride<UserRole[] | undefined>(ROLES_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (!required || required.length === 0) {
      return true;
    }

    const { principal } = context.switchToHttp().getRequest<RequestWithPrincipal>();
    if (!principal) {
      // Public route carrying @Roles would be a wiring bug — fail closed.
      throw new ForbiddenException("No authenticated principal");
    }
    if (!required.includes(principal.role)) {
      throw new ForbiddenException("Insufficient role");
    }
    return true;
  }
}
