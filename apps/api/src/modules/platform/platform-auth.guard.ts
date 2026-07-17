import {
  type CanActivate,
  type ExecutionContext,
  Injectable,
  UnauthorizedException,
} from "@nestjs/common";
import { JwtService } from "@nestjs/jwt";
import { z } from "zod";

// Platform tokens are a DIFFERENT type from tenant tokens: same signing secret,
// but the payload carries typ:"platform" and no tenant claims — a tenant access
// token can never pass this guard, and a platform token never passes the tenant
// guard (its payload fails accessTokenPayloadSchema).
const platformTokenSchema = z.object({
  sub: z.string().uuid(),
  typ: z.literal("platform"),
});

export interface RequestWithPlatformAdmin {
  headers: Record<string, string | string[] | undefined> & { authorization?: string };
  platformAdminId?: string;
}

/** Guards the /platform endpoints (which are @Public to skip the tenant guard). */
@Injectable()
export class PlatformAuthGuard implements CanActivate {
  constructor(private readonly jwt: JwtService) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const request = context.switchToHttp().getRequest<RequestWithPlatformAdmin>();
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
    const parsed = platformTokenSchema.safeParse(payload);
    if (!parsed.success) {
      throw new UnauthorizedException("Not a platform token");
    }
    request.platformAdminId = parsed.data.sub;
    return true;
  }
}
