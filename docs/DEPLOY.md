# Deploy pe Dokploy — Boca / Desaga

O singură platformă, un singur domeniu, mai multe subdomenii. Dokploy construiește
imaginile din GitHub, iar Traefik (integrat în Dokploy) termină TLS-ul automat
(Let's Encrypt) pe fiecare subdomeniu.

## Ce se publică

| Subdomeniu | Serviciu | Public |
|---|---|---|
| `admin.desaga.ro` | Panoul de administrare (Next) | da |
| `demo.desaga.ro` | Showcase-ul / prezentarea (Next) | da |
| `media.desaga.ro` | MinIO — pozele (URL-uri semnate) | da |
| — | API + worker | intern (Next-urile le apelează prin rețeaua internă) |
| `app.desaga.ro` | oaspeți (PWA) | rezervat — se adaugă când e construit |
| `staff.desaga.ro` | personal | rezervat |

Bazele de date (Postgres, Redis, MinIO) rulează pe o rețea privată, fără acces din
exterior. API + worker au ieșire la internet doar pentru API-ul Anthropic.

## Preliminarii

- Un VPS (recomandat UE, ex. Hetzner Falkenstein) cu **Dokploy** instalat.
- Domeniul `desaga.ro` cu acces la zona DNS.
- Repo-ul pe GitHub (Dokploy îl clonează și construiește).

## Pas 1 — DNS

Creează câte un record **A** către IP-ul VPS-ului pentru fiecare subdomeniu public:

```
admin.desaga.ro   A   <IP_VPS>
demo.desaga.ro    A   <IP_VPS>
media.desaga.ro   A   <IP_VPS>
```

(Un wildcard `*.desaga.ro A <IP_VPS>` funcționează la fel și acoperă subdomeniile
viitoare.)

## Pas 2 — aplicația în Dokploy

1. În Dokploy: **Create → Application** și alege tipul **Compose** (Docker Compose).
2. **Source**: conectează repo-ul GitHub (branch `main`).
3. **Compose file path**: `infra/compose/docker-compose.prod.yml`
   (contextul de build e rădăcina repo-ului — implicit).
4. Activează **auto-deploy on push** dacă vrei ca fiecare `git push` pe `main` să
   declanșeze un redeploy.

## Pas 3 — variabile de mediu

În tab-ul **Environment** al aplicației, pornește de la `infra/env/.env.prod.example`
și completează valori reale (generează secrete cu `openssl rand -hex 32`):

| Variabilă | Ce e |
|---|---|
| `ROOT_DOMAIN` | `desaga.ro` |
| `POSTGRES_PASSWORD` | parola superuser Postgres (doar jobul de migrare o folosește) |
| `APP_DB_PASSWORD` | parola rolului `boca_app_login` (aplicația, cu RLS) |
| `WORKER_DB_PASSWORD` | parola rolului `boca_worker_login` (joburi de fundal) |
| `S3_ACCESS_KEY` / `S3_SECRET_KEY` | credențialele MinIO (și cheile S3 ale aplicației) |
| `S3_BUCKET` | `boca-media` |
| `JWT_ACCESS_SECRET` | secret de semnare a token-urilor (≥ 16 caractere; folosește 32+) |
| `ANTHROPIC_API_KEY` | cheia Anthropic (goală → evaluatorul mock determinist) |
| `EVAL_MODEL` | `claude-sonnet-5` |
| `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD` | contul de admin creat la bootstrap (Pas 6) |

## Pas 4 — confirmă convențiile Traefik (o singură dată)

Compose-ul presupune configul standard Dokploy. Confirmă că se potrivesc cu
instalarea ta (altfel ajustează în `docker-compose.prod.yml`):

- Rețeaua externă a lui Traefik: **`dokploy-network`** (`docker network ls`).
- Numele cert-resolver-ului TLS: **`letsencrypt`** (apare în etichetele
  `tls.certresolver=letsencrypt`). Dacă al tău are alt nume, schimbă-l în toate
  cele trei locuri (admin, demo, media).
- Entrypoint: **`websecure`** (443).

## Pas 5 — primul deploy

Apasă **Deploy**. Ordinea e automată (prin `depends_on`):
`postgres` → **`migrate`** (rulează migrările + creează rolurile RLS
`boca_app_login`/`boca_worker_login` din `prod-roles.sql`) → `api` → `worker`;
`minio` → `minio-init` (creează bucket-ul); `admin` și `showcase` pornesc după ce
`api` e sănătos. Traefik emite certificatele TLS la prima accesare a fiecărui
subdomeniu.

## Pas 6 — bootstrap: tenantul Desaga + contul tău (automat)

Nu ai nimic manual de făcut. Serviciul `seed` rulează **automat la fiecare deploy**
(exact ca `migrate` și `minio-init`) și creează tenantul „Desaga", meniul real și
contul de admin din `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`. E sigur la
re-rulare: tenantul/meniul se creează o singură dată, iar parola de admin se
setează **doar la prima creare** — un redeploy ulterior nu suprascrie o parolă pe
care ai schimbat-o din aplicație.

Nu ai nevoie de acces SSH la server: totul se întâmplă în timpul deploy-ului din
Dokploy. (Dacă vrei să resetezi parola de admin, șterge rândul din `app_user` — sau
schimb-o din aplicație — apoi redeploy.)

## Pas 7 — autentificare

- `https://admin.desaga.ro` → login cu `SEED_ADMIN_EMAIL` / `SEED_ADMIN_PASSWORD`.
- `https://demo.desaga.ro` → showcase-ul (prezentarea pentru owner).

## Actualizări

`git push` pe `main` → Dokploy reconstruiește și redeployează (dacă ai activat
auto-deploy). Migrările noi rulează automat la fiecare deploy prin jobul `migrate`.

## De reținut

- **Pozele**: URL-urile semnate ale imaginilor țintesc `media.desaga.ro`; de aceea
  MinIO are nevoie de subdomeniul lui public. Aplicația încarcă intern (`minio:9000`)
  și semnează pentru `media.desaga.ro` — ambele funcționează.
- **AI real vs mock**: fără `ANTHROPIC_API_KEY`, pipeline-ul rulează cu evaluatorul
  mock determinist (util pentru un demo fără costuri). Cu cheie reală, rulează pe
  Claude.
- **Roluri RLS**: aplicația se conectează pe roluri non-superuser, deci RLS e aplicat
  în producție (izolarea pe tenant e garantată de baza de date). Superuser-ul e dat
  doar jobului de migrare.
- **Oaspeți / personal**: când construim PWA-urile, se adaugă ca servicii noi în
  compose (există blocuri comentate `app` și `staff` ca șablon) + recorduri DNS
  `app.` / `staff.`.
- **Backup**: pentru producție, activează backup-uri pe volumul `pg_data` (Dokploy
  are backup-uri programate pentru volume) și oglindește `minio_data` off-site.
