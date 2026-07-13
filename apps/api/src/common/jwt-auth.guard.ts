import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { Reflector } from "@nestjs/core";
import { JwtService } from "@nestjs/jwt";
import { accessTokenPayloadSchema, type RequestWithPrincipal } from "./principal";
import { IS_PUBLIC_KEY } from "./public.decorator";

/** Global guard: verifies the Bearer access token, attaches request.principal. */
@Injectable()
export class JwtAuthGuard implements CanActivate {
  constructor(
    private readonly jwt: JwtService,
    private readonly reflector: Reflector,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const isPublic = this.reflector.getAllAndOverride<boolean | undefined>(IS_PUBLIC_KEY, [
      context.getHandler(),
      context.getClass(),
    ]);
    if (isPublic) {
      return true;
    }

    const request = context.switchToHttp().getRequest<RequestWithPrincipal>();
    const header = request.headers.authorization;
    if (!header?.startsWith("Bearer ")) {
      throw new UnauthorizedException("Missing bearer token");
    }

    let payload: unknown;
    try {
      payload = await this.jwt.verifyAsync(header.slice("Bearer ".length));
    } catch {
      throw new UnauthorizedException("Invalid or expired token");
    }

    const parsed = accessTokenPayloadSchema.safeParse(payload);
    if (!parsed.success) {
      throw new UnauthorizedException("Malformed token payload");
    }

    request.principal = {
      userId: parsed.data.sub,
      tenantId: parsed.data.tid,
      role: parsed.data.rol,
      locationId: parsed.data.loc,
    };
    return true;
  }
}
