# Înrolarea unui brand nou (multi-tenant)

Platforma servește mai multe branduri de restaurante dintr-un singur deployment.
Fiecare brand are propriile domenii, rezolvate la runtime din header-ul `Host`
prin tabela `tenant_domain` (migrația 0015). Un brand nou NU necesită rebuild
sau modificări de cod.

## Modelul de domenii

| Suprafață | Domeniu recomandat                 | DNS necesar de la restaurant |
|-----------|------------------------------------|------------------------------|
| Guest     | `app.brandx.ro`                    | 1 CNAME → serverul platformei |
| Admin     | `brandx-admin.<domeniul-platformei>` | — (domeniul platformei)     |
| Staff     | `brandx-staff.<domeniul-platformei>` | — (domeniul platformei)     |

Doar domeniul de guest e văzut de clienți (tipărit pe QR-uri); admin/staff sunt
unelte interne și pot sta pe domeniul platformei. Dacă brandul vrea totuși
`admin.brandx.ro`, e doar un rând în plus în `tenant_domain`.

## Pași

1. **DNS** — restaurantul adaugă CNAME-ul de guest (ex. `app.brandx.ro`);
   pentru admin/staff adaugi tu subdomeniile pe domeniul platformei.
2. **Dokploy** — la serviciile `guest`, `admin`, `staff`: *Add Domain* cu
   hostname-ul respectiv (port 3000). Traefik emite automat certificatul
   Let's Encrypt.
3. **Onboarding** — rulează scriptul (conexiune privilegiată; local împotriva
   DB-ului de producție printr-un tunel, sau ca serviciu one-off în compose):

   ```bash
   pnpm --filter @boca/api exec tsx scripts/create-tenant.ts \
     --slug=brandx --name="Restaurant Brand X" \
     --admin-email=admin@brandx.ro --admin-password="..." \
     --guest-domain=app.brandx.ro \
     --admin-domain=brandx-admin.platforma.ro \
     --staff-domain=brandx-staff.platforma.ro
   ```

   Scriptul e idempotent (re-rulabil); parola adminului se setează doar la
   prima creare. Funcția `createTenant()` din același fișier e gândită să fie
   refolosită de viitorul dashboard de super-admin.

4. **Verificare** — `https://app.brandx.ro` arată meniul (gol) al brandului;
   login-urile pe domeniile admin/staff pre-completează automat brandul
   (câmpul „Restaurant" dispare); QR-urile din Admin → Mese folosesc domeniul
   de guest al brandului.

## Cum funcționează rezolvarea

- `GET /api/guest/tenant-context` (public) citește `X-Forwarded-Host`/`Host`
  și îl caută prin `resolve_tenant_domain` (SECURITY DEFINER — `boca_app` nu
  poate citi `tenant`/`tenant_domain` pre-context, prin design).
- Aplicația guest rezolvă tenantul server-side în layout; domeniile
  neînregistrate cad pe tenantul bakeuit (`NEXT_PUBLIC_TENANT_SLUG`, azi
  `desaga`) — plasa de siguranță a deploymentului existent.
- Domeniile Desaga curente se auto-înregistrează la fiecare deploy prin seed
  (`SEED_*_DOMAIN` din compose).
