# motor2 — migración completa (Core + Catálogo + Movimientos + Stock + Reportes + Traspasos)

Migración de `motor` (Google Apps Script + Sheets) a Next.js + Postgres/Neon.
**Las 6 porciones funcionales del proyecto están completas**: **Core**
(sucursales, roles, permisos, auth), **Catálogo** (productos, insumos/
grupos, categorías, unidades, presentaciones, proveedores, recetas),
**Movimientos** (Kardex/libro mayor de stock, secciones, conteo físico,
precio local, con UI bajo `/movimientos/*`), **Stock** (consolidado, por
familia, alertas de stock mínimo y reclasificación entre secciones, con UI
bajo `/stock/*`), **Reportes** (período, costos y márgenes, promociones,
pérdidas, devoluciones, vencimientos, diferencias de ajuste, salud por
producto, consignación, trazabilidad, historial de producto y más — 17
vistas bajo `/reportes/*`) y **Traspasos entre sucursales** (bandeja de
solicitud/aprobación/aceptación con dos flujos, PULL y PUSH, con UI bajo
`/traspasos/*`) — código, 141 tests de Vitest y la UI, todos verificados
contra Postgres real (los tests corriendo la suite, la UI a mano en un
navegador real vía Playwright). Ver `docs/plan-migracion.md` para el
contexto de negocio completo y el estado detallado de cada porción; esto
es la guía de arranque local.

La infraestructura real (Neon de producción, credenciales de Google OAuth)
ya está conectada en el deploy de Vercel; lo que queda son refinamientos de
UX no bloqueantes y una modularización de código pendiente — ver
"Pendiente" abajo.

## Setup

1. Base de datos — dos opciones:
   - **Local**: `docker compose up -d` (Postgres en `localhost:5432`, ver `docker-compose.yml`).
   - **Neon**: crear un proyecto y usar su connection string.
2. Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL` (pooled, con `pgbouncer=true` si es Neon) y `DIRECT_URL` (directa, sin pooler) — Prisma 7 las separa: `DIRECT_URL` es la que usan Migrate/CLI (`prisma.config.ts`), `DATABASE_URL` la que usa el runtime vía el driver adapter (`src/lib/db.ts`, ver nota abajo).
   - `AUTH_SECRET` (`npx auth secret`), `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (OAuth de Google Cloud Console — cualquier cuenta del negocio debe poder loguearse).
   - `BOOTSTRAP_ADMIN_EMAILS` — tu email, para quedar admin automático la primera vez (ver `src/core/auth/bootstrap.ts`).
3. `npm install`
4. `npm run db:migrate` — aplica el schema completo (Core + Catálogo + Movimientos + Stock + Reportes + Traspasos, más los índices manuales) y corre el seed (34 acciones + roles admin/operador + sucursal "Central" + unidades base kg/g/l/ml/unidad). Verificado contra Postgres 16 real.
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
Verificado: 141/141 tests verdes contra Postgres 16 local (Core + Catálogo +
Movimientos + Stock + Reportes + Traspasos).

## Pendiente

- Exportación CSV del reporte por período (`exportarReportePeriodoCSV` de
  Apps Script no se portó — endpoint trivial de agregar sobre
  `obtenerReportePorPeriodo`, que ya existe, cuando haga falta).
- Alertas de stock por mail (`notificarAlertasStockPorMail`) — necesita
  elegir un proveedor de mail (Resend/SendGrid/etc.), no configurado
  todavía.

Resuelto y ya no pendiente (quedaba desactualizado en versiones previas
de este README): credenciales reales de Google OAuth y conexión a un
proyecto Neon real de producción (ambos ya en el deploy de Vercel), y la
UI de selección de "sucursal activa" para usuarios con más de una
membresía (`src/components/selector-sucursal.tsx`, ver
`docs/plan-migracion.md` punto 3).
