// TODO(next increment): seed a demo tenant + locations + staff users through
// the boca_platform onboarding path (tenant insert cannot go through boca_app
// by design — the RLS WITH CHECK cannot match a not-yet-existing tenant id).
// Blocked on: argon2 hashing helper placement and the platform-admin endpoint
// shape. Run with: pnpm --filter @boca/db seed
console.log("seed: not implemented yet (see TODO in scripts/seed.ts)");
