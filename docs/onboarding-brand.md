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
3. **Onboarding** — din **dashboard-ul de super-admin** (`PLATFORM_HOST`,
   apps/platform): „+ Adaugă restaurant" (slug, denumire, admin, domenii).
   Tot acolo: gestionarea domeniilor și identitatea de brand (texte + culori;
   logo-ul rămâne la panoul restaurantului).

   Alternativa CLI (test local / avarie) — același nucleu
   (`src/modules/platform/onboarding.ts`):

   ```bash
   pnpm --filter @boca/api exec tsx scripts/create-tenant.ts \
     --slug=brandx --name="Restaurant Brand X" \
     --admin-email=admin@brandx.ro --admin-password="..." \
     --guest-domain=app.brandx.ro \
     --admin-domain=brandx-admin.platforma.ro \
     --staff-domain=brandx-staff.platforma.ro
   ```

4. **Verificare** — `https://app.brandx.ro` arată meniul (gol) al brandului;
   login-urile pe domeniile admin/staff pre-completează automat brandul
   (câmpul „Restaurant" dispare); QR-urile din Admin → Mese folosesc domeniul
   de guest al brandului.

## Activarea dashboard-ului de super-admin (o singură dată)

1. În Dokploy setezi: `PLATFORM_HOST`, `PLATFORM_DB_PASSWORD`,
   `PLATFORM_ADMIN_EMAIL`, `PLATFORM_ADMIN_PASSWORD` și — recomandat —
   `PLATFORM_IP_ALLOWLIST` (IP-ul tău, CSV de CIDR-uri).
2. Adaugi domeniul `PLATFORM_HOST` în Dokploy pe serviciul `platform` + DNS.
3. Redeploy. Job-ul migrate creează rolul `boca_platform_login`, seed-ul creează
   contul de operator, iar dashboard-ul devine activ pe `PLATFORM_HOST`.
   Fără aceste variabile, endpoint-urile `/platform` răspund 503 — nimic
   altceva nu se schimbă.

Securitate: auth separat de conturile de restaurant (JWT de tip `platform`,
valabil 8h), rol DB dedicat (`boca_platform` — singurul care poate crea
tenanți), IP allowlist în Traefik, host nepublicat.

## Cum funcționează rezolvarea

- `GET /api/guest/tenant-context` (public) citește `X-Forwarded-Host`/`Host`
  și îl caută prin `resolve_tenant_domain` (SECURITY DEFINER — `boca_app` nu
  poate citi `tenant`/`tenant_domain` pre-context, prin design).
- Aplicația guest rezolvă tenantul server-side în layout; domeniile
  neînregistrate cad pe tenantul bakeuit (`NEXT_PUBLIC_TENANT_SLUG`, azi
  `desaga`) — plasa de siguranță a deploymentului existent.
- Domeniile Desaga curente se auto-înregistrează la fiecare deploy prin seed
  (`SEED_*_DOMAIN` din compose).
