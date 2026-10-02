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
3. `npm ci` (instala exactamente lo del `package-lock.json`; `npm install` solo para agregar o actualizar una dependencia)
4. `npm run db:migrate` — aplica el schema completo (Core + Catálogo + Movimientos + Stock + Reportes + Traspasos, más los índices manuales) y corre el seed (34 acciones + roles admin/operador + sucursal "Central" + unidades base kg/g/l/ml/unidad). Verificado contra Postgres 16 real.
5. `npm run dev` y entrar a `http://localhost:3000`.

`src/lib/db.ts` elige el driver adapter según el host de `DATABASE_URL`:
`PrismaNeon` (protocolo HTTP/WebSocket, para funciones serverless de
Vercel) solo si es un host `neon.tech`; cualquier otro caso (local,
`docker compose`, otro proveedor) usa `PrismaPg` (driver `pg` estándar,
TCP normal) — antes de este fix, `docker compose up -d` no funcionaba en
absoluto contra el runtime de la app (sí contra Migrate/CLI), pese a que
el Setup de arriba lo ofrecía como opción.

## Auditoría de dependencias

`npm run auditar:dependencias` corre `npm audit --omit=dev --audit-level=high`. Hoy sale con código 1 por la cadena de la CLI de Prisma (`prisma` → `@prisma/config` → `deepmerge-ts`, y `mysql2` de `@prisma/dev`): son herramientas de build/migración que no se cargan en el runtime de la app. NO aplicar `npm audit fix --force`: «arregla» bajando `prisma` a 6.x (cambio mayor). Todo hallazgo nuevo fuera de esa cadena se corrige. Dependabot (`.github/dependabot.yml`) propone las actualizaciones semanales.

## Tests

`npm test` corre Vitest contra Postgres real (no hay mocks — mismo espíritu
que `Tests.js` en el proyecto Apps Script original). Necesitan una base
limpia con el schema migrado (local o un branch de Neon) antes de correr.
Verificado: 141/141 tests verdes contra Postgres 16 local (Core + Catálogo +
Movimientos + Stock + Reportes + Traspasos).

## Tests E2E (navegador real)

`npm run test:e2e` corre Playwright contra el build de producción (`next build`
+ `next start`) + Postgres real, con
sesión de Auth.js real (una fila en `Session`, sin pasar por Google OAuth —
ver `test/e2e/fixtures/auth.ts`). Complementa, no reemplaza, la suite de
Vitest: esos tests nunca renderizan el DOM (`environment: "node"`), así que
hay una clase de bugs — HTML inválido, eventos del navegador, hidratación
de React — invisible para `tsc`/`eslint`/Vitest. Encontrado así, no por la
suite existente: un `<form>` anidado dentro de otro `<form>` en los modales
de alta rápida (`QuickCrearProducto`/`QuickCrear`) que reseteaba el
formulario exterior entero al crear un producto/categoría inline —
`npx playwright test --ui` para verlo correr paso a paso.

**Base de datos dedicada.** Los E2E corren contra `MOTOR2_E2E_DATABASE_URL`,
una base local aparte cuyo nombre termina en `_e2e` (nunca la de desarrollo,
nunca Neon). Se crea una sola vez:

```
psql -h localhost -U postgres -c "CREATE DATABASE motor2_e2e OWNER motor2"
DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_e2e" npx prisma migrate deploy
```

y se pone la URL en `.env` (ver `.env.example`). Esa URL es la del dueño
(reset con `TRUNCATE`, migraciones); el servidor y los specs corren con el rol
sin privilegios `motor2_app` sobre la misma base, vía
`MOTOR2_E2E_APP_DATABASE_URL` (ADR-007, A0; el rol se crea con
`scripts/operaciones/crear-rol-motor2-app.sql`). Cada corrida la deja vacía
antes (`globalSetup`, más un seed mínimo) y después (`globalTeardown`), así que
no se acumulan datos entre corridas ni se toca `motor2_dev`. Las guardas
(`test/e2e/fixtures/base-e2e.ts`) abortan sin conectarse si el host no es
local o el nombre no termina en `_e2e`; no hay fallback a `DATABASE_URL`.

`npx playwright test --list` también necesita la variable, porque la
configuración la valida al cargarse.

**Qué servidor levanta.** Por defecto compila y sirve el artefacto de producción
(`npm run build:e2e` — sin `prisma migrate deploy` — y `next start`), que es lo
que se despliega: minificación, límites `"use client"`, hidratación y prefetch
reales. Medido, es más rápido que `next dev` (unos 2,1 min contra 3,4 min para
193 tests) y elimina la compilación bajo demanda como fuente de flakiness. Se
elige con `MOTOR2_E2E_SERVIDOR` (en `.env` o en la shell):

- `build` (default): compila y sirve. Es el que vale para cerrar un cambio.
- `start`: reusa el último build sin recompilar; ciclo corto para depurar un
  spec cuando el código no cambió.
- `dev`: `next dev`, con overlay de errores y HMR; conviene para
  `npm run test:e2e:ui` y para depurar. **Dejarlo en `dev` debilita el gate de
  cierre**: la salida dice `[e2e] Servidor: <modo>` y
  `test/e2e/servidor-en-modo-produccion.spec.ts` afirma que el modo es real.

Usa su propio puerto (3101) y nunca reutiliza un servidor ya abierto (el del
3000 apunta a `motor2_dev`). `workers: 1` a propósito — los
specs comparten la misma base Postgres, sin mocks (mismo criterio que
`fileParallelism: false` de Vitest); cada spec usa nombres únicos
(`Date.now()`) para no chocar con otros specs de la misma corrida.

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
