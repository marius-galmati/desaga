import { SetMetadata } from "@nestjs/common";

export const IS_PUBLIC_KEY = "boca:isPublic";

/** Skips the global JwtAuthGuard (health, login, refresh, logout). */
export const Public = () => SetMetadata(IS_PUBLIC_KEY, true);
