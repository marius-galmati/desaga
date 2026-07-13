import { type UserRole, userRoleSchema } from "@boca/contracts";
import { z } from "zod";

// Access-token JWT payload (extra claims like iat/exp are stripped by zod).
export const accessTokenPayloadSchema = z.object({
  sub: z.string().uuid(), // app_user.id
  tid: z.string().uuid(), // tenant_id — drives withTenant() per request
  rol: userRoleSchema,
  // app_user.location_id: the user's home venue. Nullable = tenant-wide staff.
  // The schema models ONE optional location per user, not a list.
  loc: z.string().uuid().nullable(),
});
export type AccessTokenPayload = z.infer<typeof accessTokenPayloadSchema>;

export interface Principal {
  userId: string;
  tenantId: string;
  role: UserRole;
  locationId: string | null;
}

// Minimal request shape — avoids depending on express types in app code.
export interface RequestWithPrincipal {
  headers: { authorization?: string; "user-agent"?: string };
  ip?: string;
  principal?: Principal;
}
