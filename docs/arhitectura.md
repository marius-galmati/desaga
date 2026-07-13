# Boca — Arhitectura MVP (schiță v0.2)

> **DECIZIE 2026-07-13 — staff = all-PWA pe Android (fără Expo în MVP).** Aplicația de staff
> (moduri ospătar + pass) devine PWA web, rulată pe un model Android standardizat la pass
> (Chrome expune controale de expunere/WB prin ImageCapture; web push matur) și pe telefoanele
> ospătarilor (BYOD, orice platformă). Referințele la Expo/EAS/Metro/jest-expo din acest
> document sunt istorice și se înlocuiesc la incrementul staff-PWA. Validare rămasă înainte de
> lock-in definitiv: spike pe device-ul real (varianța a 20 de poze identice sub lumină fixă +
> alertă web-push cu ecranul blocat). Stația fixă cu cameră UVC din faza 2 rămâne neschimbată.

> Stadiu: schiță de fundație, validată printr-un review adversarial pe 10 fluxuri end-to-end.
> Schema de date completă: [`db/schema.sql`](../db/schema.sql).
> Decizii de produs blocate: scoruri AI = coaching documentat intern (niciodată vizibile oaspeților), poza obligatorie la pass (iPhone în MVP), multi-tenant din prima zi, PWA pentru oaspeți RO/EN, POS necunoscut încă (scenariul B = baseline).

## 1. Privire de ansamblu

| Strat | Alegere | De ce |
|---|---|---|
| Deployment MVP | 1 VPS Ubuntu (UE) + Docker Compose | cost minim, viteză; migrare ulterioară la managed = config, nu rescriere |
| Backend | NestJS monolit modular, TypeScript peste tot | un singur limbaj în MVP; workerii BullMQ rulează din aceeași imagine (`main.worker.ts`) |
| DB | PostgreSQL 16, multi-tenant shared-schema + RLS | `tenant_id` pe fiecare rând, FK-uri compuse `(tenant_id, id)` — izolarea nu se poate retrofita |
| Query layer | **Kysely** + kysely-codegen | migrări SQL-first obligatorii (RLS, partiții, trigger-e); Kysely nu concurează schema; `SET LOCAL app.tenant_id` per tranzacție se potrivește exact. Drizzle = a doua opțiune; Prisma respins (tranzacții interactive incomode pentru SET LOCAL, DSL-ul nu exprimă RLS/partiții) |
| Migrări | node-pg-migrate în mod SQL (fișiere `.sql` up/down) | zero DSL între noi și DDL-ul de RLS/partiții |
| Contracte API | ts-rest + Zod în `packages/contracts` | o definiție → handler-e tipate în Nest + clienți react-query tipați în toate cele 3 frontend-uri; fără codegen/OpenAPI drift |
| Real-time | Socket.IO + adapter Redis | comenzi, cheamă-chelnerul, alerte; event maps tipate din aceleași scheme Zod |
| Storage foto | MinIO (S3-compatibil), chei `tenant/{id}/location/{id}/...` | DB ține doar chei; migrarea la S3/R2 = schimbare de endpoint |
| AI scoring | API Anthropic, model pinuit (clasă Sonnet), output structurat | doar din procesorul BullMQ `ai-score`, niciodată din request path; ansamblu-de-3 cu mediană în calibrare |
| Auth | JWT propriu (argon2, access+refresh), 6 roluri | fără IdP extern în MVP |
| i18n | next-intl / use-intl, cataloage comune în `packages/i18n` | UI copy în cataloage; conținutul de meniu e date (`{ro,en}` JSONB în `dish_version`) |
| Lint/format | Biome (înlocuiește ESLint+Prettier) | un singur tool, rapid |
| Testare | Vitest + Testcontainers (Postgres/Redis/MinIO reale) + Playwright (E2E) + jest-expo (doar RN) | testele de integrare includ **negarea RLS cross-tenant**, state machine comenzi, outbox, aplicarea migrărilor |
| PDF coaching | @react-pdf/renderer în workerul `report-pdf` | fără headless Chrome în imagine |

## 2. Structura monorepo (pnpm + Turborepo)

```
boca/
├── pnpm-workspace.yaml            # apps/*, packages/*
├── turbo.json                     # graf lint/typecheck/test/build + boundaries tags (db-only-for-api)
├── biome.json                     # lint+format unic pe repo
├── tsconfig.base.json             # strict, noUncheckedIndexedAccess, exactOptionalPropertyTypes
├── .github/workflows/             # ci.yml (PR), deploy.yml (main -> VPS), staff-eas.yml (release tags)
├── apps/
│   ├── guest-pwa/                 # Next.js App Router PWA, RO+EN, fără conturi de oaspete
│   │   └── app/[locale]/
│   │       ├── t/[qrSlug]/        # intrare QR: slug -> token sesiune 3h sliding + alegere nume/emoji
│   │       ├── menu/              # navigare, filtre alergeni, povești preparate, tratare 86
│   │       ├── order/             # coș, modificatori/cereri speciale, fel, trimitere
│   │       ├── tab/               # nota comună multi-device, linii per oaspete, cheamă-chelnerul, cere nota
│   │       └── feedback/          # post-masă, per preparat, 1-5 + taguri/text
│   ├── staff/                     # UN singur codebase Expo, două moduri de rol
│   │   └── app/                   # expo-router
│   │       ├── (auth)/            # login JWT staff, rutare rol -> mod
│   │       ├── (waiter)/          # secțiuni, acceptare prima comandă, fire pe feluri, inbox alerte cu escaladare, checklist decontare POS
│   │       └── (pass)/            # coadă tichete (sugestie next-item), captură foto (AE/AWB lock + ghid), skip/refire, farfurii n-din-m
│   ├── admin/                     # Next.js web
│   │   └── app/(dashboard)/
│   │       ├── menu/              # CMS: dish/dish_version, câmpuri RO/EN, stații, badge refs_stale
│   │       ├── photos/            # bibliotecă foto, aprobare reference_set (3+2 holdout), autorare toleranțe
│   │       ├── staffing/          # roster ture, hartă stații, plan de sală/secțiuni, ciclu de viață QR mese
│   │       ├── quality/           # dashboards, calibrare shadow, porți go-live, drift
│   │       ├── coaching/          # rapoarte, semnătură manager, confirmare/contestare bucătar
│   │       └── settings/          # tenant/locație, utilizatori+roluri, registru dispozitive de captură
│   └── api/                       # NestJS monolit modular + workeri BullMQ (o imagine, două entrypoints)
│       └── src/
│           ├── main.ts            # entrypoint HTTP + gateway Socket.IO
│           ├── main.worker.ts     # entrypoint doar BullMQ (aceleași module DI, fără HTTP)
│           ├── common/            # middleware context tenant (SET LOCAL), guards de rol, interceptor audit, zod pipes
│           ├── modules/           # un modul Nest per domeniu:
│           │   │                  # auth, tenancy, tables, sessions, menu, orders, waiter, shifts,
│           │   │                  # photos, references, evaluation, calibration, attribution,
│           │   │                  # coaching, feedback, alerts, pos, audit
│           └── queues/            # procesoare BullMQ: preprocess (sharp + quality gates), ai-score,
│                                  # escalation, drift-weekly, variance-nightly, report-pdf, retention-purge
├── packages/
│   ├── contracts/                 # SINGURA sursă de adevăr API — depinde doar de zod
│   │   └── src/{schemas,routers,sockets}/   # entități+enums+hărți de tranziții; contracte ts-rest guest/staff/admin; event maps Socket.IO
│   ├── db/                        # strat Kysely — importabil DOAR de apps/api
│   │   ├── migrations/            # .sql numerotate up/down: RLS, FK-uri compuse, partiții, trigger-e
│   │   ├── src/
│   │   │   ├── generated/         # tipuri kysely-codegen din DB migrat (committed, niciodată editat manual)
│   │   │   ├── tenant.ts          # withTenant()/asSystem() — singurele căi de query exportate
│   │   │   └── repositories/      # query helpers tipate per agregat
│   │   └── scripts/               # migrate, codegen, seed, new-migration
│   ├── i18n/                      # cataloage JSON RO/EN per namespace + glue next-intl/use-intl
│   └── config/                    # presets tsconfig, constante comune, overrides biome
├── infra/
│   ├── compose/
│   │   ├── docker-compose.yml     # prod: caddy, guest-pwa, admin, api, worker, postgres, redis, minio, minio-init, backup
│   │   └── docker-compose.dev.yml # local: doar postgres+redis+minio; apps prin pnpm dev
│   ├── caddy/Caddyfile            # TLS, reverse proxy pe subdomenii, upgrade WebSocket pentru Socket.IO
│   ├── docker/                    # Dockerfiles: api (servește api+worker), guest-pwa, admin (Next standalone)
│   ├── backup/                    # backup.sh (nightly pg_dump -Fc + mc mirror offsite, pruning 7z/4s/6l), restore.sh (repetat periodic)
│   └── env/                       # .env.example per serviciu; .env real doar pe VPS (/srv/boca/.env, chmod 600)
└── docs/
    ├── adr/                       # deciziile blocate ca ADR-uri (query layer, auth, pinning evaluări...)
    ├── runbooks/                  # deploy, restore, rotire slug QR, re-pin model, go-live calibrare
    └── schema/                    # ERD, catalog politici RLS, matricea claselor de retenție
```

## 3. Granițe între pachete (impuse cu Turborepo boundaries)

- Direcția dependențelor: strict `apps -> packages`; pachetele nu importă din apps; apps nu importă între ele.
- `packages/db` e importabil **doar** de `apps/api`. Frontend-urile văd sistemul exclusiv prin `packages/contracts`.
- `packages/contracts` depinde doar de Zod (fără Nest, fără pg, fără API-uri Node-only) — se bundle-uiește curat în Next, Expo și Nest. Toate enum-urile și hărțile de tranziții de stare sunt definite **o singură dată** aici.
- `packages/db` exportă doar `withTenant(tenantId, fn)` și `asSystem(fn)` + repositories — instanța Kysely/Pool nu se exportă, deci e structural imposibil să rulezi un query tenant-scoped fără `SET LOCAL app.tenant_id`.
- **`asSystem()` rulează pe rolul DB `boca_worker`** (definit în migrări, cu politici RLS înguste per job: outbox relay, scanner escaladări, varianța nocturnă, reguli de alertă, purge retenție, drift, pre-crearea partițiilor). Fără BYPASSRLS nicăieri. *(corecție din review — fără acest rol, joburile de fundal erau neimplementabile sub FORCE RLS)*
- MinIO e accesibil doar din api/worker; clienții primesc URL-uri presigned cu viață scurtă; DB ține doar chei de obiecte.
- API-ul Anthropic e apelat doar din procesorul `ai-score` — niciodată din calea HTTP.
- Rutele guest nu expun scoruri de conformitate, atribuire bucătar sau date de coaching — regula „feedback-ul oaspetelui nu se leagă de scoruri" e structurală, nu disciplinară.

## 4. Infrastructură & deploy

**Servicii Compose (prod, 1 VPS UE):** caddy, guest-pwa, admin, api, worker (aceeași imagine, `node dist/main.worker.js`), postgres:16 (minor pinuit, volum), redis:7 (AOF), minio, minio-init (bootstrap bucket + politici + **reguli de lifecycle oglindind clasele purge_after**, defense-in-depth), backup.

**CI/CD (GitHub Actions):** PR = install (cache) → biome ci → turbo typecheck → turbo test → integrare Testcontainers → turbo build. Main = buildx 3 imagini → GHCR (taguri sha) → SSH pe VPS → `compose pull` → container one-off de migrare → `compose up -d` → smoke-check `/health`. Staff: EAS build pe release tags.

**Secrete pe VPS:** un singur `/srv/boca/.env` (root, 600), referit prin `env_file`; template-uri `.env.example` în repo; Zod validează env-ul la boot (deploy prost = moare imediat). Cheile Anthropic/JWT rotite prin runbook.

**Corecții din review (aplicate în design):**
- **Backup vs retenție:** mirror-ul MinIO offsite **exclude prefixele cu TTL scurt** (pozele brute de la pass — imagini GDPR-adiacente ale personalului) — se copiază doar seturile de referință, PDF-urile de coaching și obiectele pinuite ca dovezi; `restore.sh` include un pas de re-purge post-restore; matricea de retenție acoperă explicit și mediile de backup. RPO acceptat în ADR: pg_dump nocturn = până la 24h pierdere (upgrade ulterior: wal-g/pgBackRest).
- **Anti-drift enums:** test de CI care compară enum-urile din `packages/contracts` cu tipurile generate în `packages/db/src/generated` (ambele importabile în testele api) — pică PR-ul la divergență; la fel pentru forma JSONB `criterion_scores` (comună între `ai_evaluation` și `sous_chef_rating`).
- **Anti-drift codegen:** pas de CI care pornește Postgres în Testcontainers, rulează toate migrările, rulează kysely-codegen și pică dacă output-ul diferă de cel committed.
- **Expo + pnpm:** Metro trebuie configurat explicit pentru pachete workspace symlinked (symlink support + watchFolders, sau `node-linker=hoisted` pentru staff); alegerea ts-rest intră în ADR cu cale de ieșire (alternativă contemporană: oRPC); de validat clientul react-query al ts-rest sub fetch-ul din React Native.
- **Hardening compose:** healthcheck + depends_on corecte (api nu bootează înaintea postgres/redis), rotire loguri Docker (json-file max-size), verificarea blocului de upgrade WS în Caddy pentru ambele app-uri Next.

## 5. Schema de date — rezumat

Detaliile complete (DDL + comentarii): [`db/schema.sql`](../db/schema.sql). Opt domenii:

1. **Tenancy & auth** — `tenant` → `location`; `app_user` + roluri; `platform_admin` în afara modelului de tenant (ca `tenant_id` să rămână NOT NULL peste tot); rol DB `boca_platform` pentru onboarding.
2. **Sală & sesiuni** — `floor_section`, `dining_table` cu slug QR înlocuibil (rezolvat printr-o singură funcție SECURITY DEFINER — singurul bypass RLS sancționat), `table_session` (nota comună) + `session_guest` (identitate per device) + token per device (multi-device pe aceeași notă).
3. **Meniu versionat imutabil** — `dish` (soft-delete, pointer la versiunea curentă) → `dish_version` (JSONB bilingv, prețuri în bani, alergeni EU-14, mapare stație, flag non_scoreable); 86 per locație (`dish_location_availability`).
4. **Comenzi** — `guest_order`/`order_item` cu state machine (`fired`/`ready` doar la nivel de item), preț dublu-snapshotat (pin pe `dish_version` + copie pe linie), outbox tranzacțional → interfața POSConnector (driver manual în MVP + raport de varianță nocturn cu `pos_entered_total_minor`).
5. **Ture & atribuire** — `shift`, roster, `station_assignment`, `chef_attribution` (metodă + încredere + corecție same-day audit-logată).
6. **Captură & scoring AI** — registru `capture_device` (care iPhone, ce profil de captură), `pass_photo` imutabil (refire, n-din-m, skip cu motiv, purge cu scrub de `storage_key`), `reference_set`/`tolerance_profile` versionate, `ai_evaluation` cu configul complet pinuit (model, prompt, referințe, toleranțe, preprocesare) + CHECK-uri care fac pinning-ul obligatoriu la status `completed`.
7. **Calibrare & coaching** — `sous_chef_rating` (orb), poarta go-live per `dish_version` (bump de versiune = înapoi în shadow), `golden_set`, `coaching_report` append-only cu semnătură manager + confirmare/contestare bucătar + snapshot PDF în MinIO.
8. **Evenimente & conformitate** — `service_request` (cheamă-chelnerul/cere nota, cu escaladare pe niveluri), `guest_feedback`, inbox de alerte manageri, `audit_log` partiționat lunar, append-only (inclusiv fiecare **citire** de date de performanță ale bucătarilor, scrisă de un interceptor NestJS în aceeași tranzacție).

## 6. Întrebări deschise (de rezolvat înainte de / în timpul dezvoltării)

**Pentru owner / head chef:**
- Cele 6 criterii de scoring finale + forma canonică a toleranțelor per criteriu (contract JSONB, nu migrare — dar îngheață prompt-ul și UI-ul de autorare).
- POS-ul: brandul/versiunea (declanșează evaluarea de integrare; până atunci scenariul B e baseline).
- Stațiile: catalog la nivel de brand (presupunerea curentă) sau topologii diferite per locație?
- Politici de mutare/îmbinare mese mid-service; acceptarea de către ospătar doar la prima comandă sau și după pauze lungi?
- Definirea „orbirii" pentru evaluările sous-chefului (vede numele preparatului sau doar poza?).

**Pentru specialiști (nu se improvizează):**
- Duratele de retenție per clasă (poze brute, scoruri, feedback, pseudonimizare sesiuni) — specialist GDPR/dreptul muncii; schema are doar hook-urile.
- DPA Anthropic cu procesare UE/retenție zero — înainte de prima poză de producție trimisă la API.
- TVA pe modificatori/tips când se trezesc plățile — contabil/integrator fiscal.

**Tehnice (de decis la kickoff):**
- Țintă backup offsite: Hetzner Storage Box vs Backblaze B2 (criptare offsite → restic în loc de mc mirror).
- Topologie domenii: subdomenii (app./admin./api.boca.ro) vs path routing — Caddyfile e schițat pe subdomenii.
- Distribuție staff app pe iPhone-uri: TestFlight vs Apple Business Manager; Guided Access/MDM pe iPhone-ul de la pass.
- Automatizarea partițiilor `audit_log`: job worker (schițat) vs pg_partman — de ales înainte de primul rollover lunar.
- ID-ul concret al modelului Anthropic pinuit + procesul de re-pin (re-calibrare shadow scurtă la fiecare schimbare; owner de semnătură).
- Rol/cont personal pentru bucătari la confirmarea rapoartelor de coaching (enum-ul actual are doar `kitchen_pass` ca mod partajat pe device-ul de la pass) — afectează auth, rutele de coaching și semantica audit-ului.
