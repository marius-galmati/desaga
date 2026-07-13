import type { TenantTransaction } from "../tenant";

export async function findActiveUserByEmail(trx: TenantTransaction, email: string) {
  return trx
    .selectFrom("app_user")
    .selectAll()
    .where("email", "=", email)
    .where("is_active", "=", true)
    .executeTakeFirst();
}

export async function findActiveUserById(trx: TenantTransaction, userId: string) {
  return trx
    .selectFrom("app_user")
    .selectAll()
    .where("id", "=", userId)
    .where("is_active", "=", true)
    .executeTakeFirst();
}

export async function insertRefreshToken(
  trx: TenantTransaction,
  params: {
    tenantId: string;
    userId: string;
    tokenHash: string;
    expiresAt: Date;
    issuedIp: string | null;
  },
): Promise<void> {
  await trx
    .insertInto("auth_refresh_token")
    .values({
      tenant_id: params.tenantId,
      user_id: params.userId,
      token_hash: params.tokenHash,
      expires_at: params.expiresAt,
      issued_ip: params.issuedIp,
    })
    .execute();
}

export async function findActiveRefreshToken(trx: TenantTransaction, tokenHash: string) {
  return trx
    .selectFrom("auth_refresh_token")
    .selectAll()
    .where("token_hash", "=", tokenHash)
    .where("revoked_at", "is", null)
    .where("expires_at", ">", new Date())
    .executeTakeFirst();
}

export async function revokeRefreshTokenById(trx: TenantTransaction, id: string): Promise<void> {
  await trx
    .updateTable("auth_refresh_token")
    .set({ revoked_at: new Date() })
    .where("id", "=", id)
    .where("revoked_at", "is", null)
    .execute();
}

export async function revokeRefreshTokenByHash(
  trx: TenantTransaction,
  tokenHash: string,
): Promise<void> {
  await trx
    .updateTable("auth_refresh_token")
    .set({ revoked_at: new Date() })
    .where("token_hash", "=", tokenHash)
    .where("revoked_at", "is", null)
    .execute();
}
