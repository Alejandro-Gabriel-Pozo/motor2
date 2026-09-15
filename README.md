# motor2 — Core + Catálogo

Migración de `motor` (Google Apps Script + Sheets) a Next.js + Postgres/Neon.
Porciones completadas hasta ahora: **Core** (sucursales, roles, permisos,
auth) y **Catálogo** (productos, insumos/grupos, categorías, unidades,
presentaciones, proveedores, recetas). Ver el plan completo en el historial
de la sesión para el contexto de negocio; esto es la guía de arranque local.

Siguientes porciones (no empezadas): Movimientos (los 14 procesos de
TRANSICIONES), Stock (vistas materializadas), Reportes, Traspasos entre
sucursales.

## Setup

1. Base de datos — dos opciones:
   - **Local**: `docker compose up -d` (Postgres en `localhost:5432`, ver `docker-compose.yml`).
   - **Neon**: crear un proyecto y usar su connection string.
2. Copiar `.env.example` a `.env` y completar:
   - `DATABASE_URL` (pooled, con `pgbouncer=true` si es Neon) y `DIRECT_URL` (directa, sin pooler) — Prisma 7 las separa: `DIRECT_URL` es la que usan Migrate/CLI (`prisma.config.ts`), `DATABASE_URL` la que usa el runtime vía el driver adapter (`src/lib/db.ts`).
   - `AUTH_SECRET` (`npx auth secret`), `AUTH_GOOGLE_ID`/`AUTH_GOOGLE_SECRET` (OAuth de Google Cloud Console — cualquier cuenta del negocio debe poder loguearse).
   - `BOOTSTRAP_ADMIN_EMAILS` — tu email, para quedar admin automático la primera vez (ver `src/core/auth/bootstrap.ts`).
3. `npm install`
4. `npm run db:migrate` — aplica el schema y corre el seed (32 acciones + roles admin/operador + sucursal "Central" + unidades base kg/g/l/ml/unidad).
5. `npm run dev` y entrar a `http://localhost:3000`.

## Tests

`npm test` corre Vitest contra Postgres real (no hay mocks — mismo espíritu
que `Tests.js` en el proyecto Apps Script original). Necesitan una base
limpia con el schema migrado (local o un branch de Neon) antes de correr.

## Pendiente de esta porción

- Migración inicial de Prisma no corrida todavía contra una base real (se
  hizo sin DB por decisión explícita en la sesión de diseño) — falta
  `npm run db:migrate` una vez que haya `DATABASE_URL`/`DIRECT_URL` reales.
- Agregar a mano, en la migración generada, índices únicos que Prisma no
  puede declarar:
  - Índice único parcial sobre `CapacidadSucursal` (como máximo una fila
    "default", `sucursalId IS NULL`, por acción — ver comentario en
    `prisma/schema.prisma`, modelo `CapacidadSucursal`).
  - Índices únicos funcionales `lower(nombre)` en `Producto`, `Proveedor`,
    `Insumo`, `CategoriaProducto`, `Unidad` y `Grupo` (unicidad case/espacio-
    insensible, mismo criterio que `mismoTexto_` — ver el plan de la porción
    Catálogo para el SQL exacto).
- Credenciales reales de Google OAuth.
- La UI de selección de "sucursal activa" para un usuario con más de una
  membresía queda fuera de esta porción (ver `src/core/auth/contexto.ts`).
