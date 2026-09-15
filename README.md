# motor2 — Core + Catálogo + Movimientos

Migración de `motor` (Google Apps Script + Sheets) a Next.js + Postgres/Neon.
Porciones completadas hasta ahora: **Core** (sucursales, roles, permisos,
auth), **Catálogo** (productos, insumos/grupos, categorías, unidades,
presentaciones, proveedores, recetas) y **Movimientos** (Kardex/libro
mayor de stock, secciones, conteo físico, precio local, con UI bajo
`/movimientos/*`) — código, 68 tests de Vitest y la UI, todos verificados
contra Postgres real (los tests corriendo la suite, la UI a mano en un
navegador real vía Playwright). Ver `docs/plan-migracion.md` para el
contexto de negocio completo y el estado detallado de cada porción; esto
es la guía de arranque local.

Siguientes porciones (no empezadas): Stock (vistas materializadas,
Reclasificación), Reportes, Traspasos entre sucursales.

## Setup

1. Base de datos — dos opciones:
   - **Local**: `docker compose up -d` (Postgres en `localhost:5432`, ver `docker-compose.yml`).
   - **Neon**: crear un proyecto y usar su connection string.
2. Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL` (pooled, con `pgbouncer=true` si es Neon) y `DIRECT_URL` (directa, sin pooler) — Prisma 7 las separa: `DIRECT_URL` es la que usan Migrate/CLI (`prisma.config.ts`), `DATABASE_URL` la que usa el runtime vía el driver adapter (`src/lib/db.ts`, ver nota abajo).
   - `AUTH_SECRET` (`npx auth secret`), `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (OAuth de Google Cloud Console — cualquier cuenta del negocio debe poder loguearse).
   - `BOOTSTRAP_ADMIN_EMAILS` — tu email, para quedar admin automático la primera vez (ver `src/core/auth/bootstrap.ts`).
3. `npm install`
4. `npm run db:migrate` — aplica el schema (Core + Catálogo + Movimientos, más los índices manuales) y corre el seed (33 acciones + roles admin/operador + sucursal "Central" + unidades base kg/g/l/ml/unidad). Verificado contra Postgres 16 real.
5. `npm run dev` y entrar a `http://localhost:3000`.

`src/lib/db.ts` elige el driver adapter según el host de `DATABASE_URL`:
`PrismaNeon` (protocolo HTTP/WebSocket, para funciones serverless de
Vercel) solo si es un host `neon.tech`; cualquier otro caso (local,
`docker compose`, otro proveedor) usa `PrismaPg` (driver `pg` estándar,
TCP normal) — antes de este fix, `docker compose up -d` no funcionaba en
absoluto contra el runtime de la app (sí contra Migrate/CLI), pese a que
el Setup de arriba lo ofrecía como opción.

## Tests

`npm test` corre Vitest contra Postgres real (no hay mocks — mismo espíritu
que `Tests.js` en el proyecto Apps Script original). Necesitan una base
limpia con el schema migrado (local o un branch de Neon) antes de correr.
Verificado: 68/68 tests verdes contra Postgres 16 local (Core + Catálogo +
Movimientos).

## Pendiente

- Credenciales reales de Google OAuth (Google Cloud Console) — no
  verificable sin acceso a Google Cloud Console.
- Probar contra un proyecto Neon real (todo lo de acá se verificó contra
  Postgres local; el código soporta los dos casos, ver la nota de
  `src/lib/db.ts` arriba, pero Neon en sí nunca se conectó).
- La UI de selección de "sucursal activa" para un usuario con más de una
  membresía queda fuera de esta porción (ver `src/core/auth/contexto.ts`).
- Wizard de Compra por proveedor con alta rápida de producto inline
  (refinamiento de UX sobre `/movimientos/compra`, no bloqueante) — ver
  `docs/plan-migracion.md`.
