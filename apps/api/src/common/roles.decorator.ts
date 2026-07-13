import type { UserRole } from "@boca/contracts";
import { SetMetadata } from "@nestjs/common";

export const ROLES_KEY = "boca:roles";

/** Restricts a handler/controller to the given staff roles. */
export const Roles = (...roles: UserRole[]) => SetMetadata(ROLES_KEY, roles);
