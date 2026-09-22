# Runbook: demo de 6 meses de "La Cuadra"

Procedimiento paso a paso para (re)generar la demo de 6 meses de "La Cuadra" en local, verificarla, y —recién con
autorización expresa— llevarla a Neon. Complementa (no reemplaza) `docs/planes-demo-y-claridad-reportes-2026-09-21.md`
§5, que tiene el diseño y el porqué de cada pieza; esto es solo "qué comando corro y en qué orden".

**Cuándo correr esto** (§0 del plan): cada ~2 meses aproximadamente, para que la demo no se vea vieja (los reportes
abren en "Últimos 30 días" por defecto — pasado ese plazo desde la última corrida, la pantalla de entrada empieza a
mostrar ceros). No hay una fecha de referencia fija en el código a propósito (se descartó: agregaba ~15 archivos a
mantener para siempre); el costo es este recordatorio manual.

## 0. Prerrequisitos

- Postgres local corriendo (`docker compose up -d`, ver README) — MISMO servidor que usa `motor2_dev`, puerto 5432,
  usuario `motor2`/`motor2`.
- `motor2_dev` ya con el seed base corrido al menos una vez (`npm run db:seed`), y un `User` con el email
  `alepogabriel@gmail.com` — el runbook de abajo crea uno en la base NUEVA si no existe, pero necesita saber cuál
  email usar (está hardcodeado en `scripts/seed-demo-pizzeria-6-meses.ts`, `EMAIL_ADMIN`).
- Nada de esto toca `motor2_dev` ni Neon en ningún paso hasta el §5 de acá abajo (Neon), que además necesita
  autorización expresa por separado.

## 1. Base local dedicada (`motor2_demo`)

Sufijo `_demo` obligatorio — `scripts/demo-seed/guardas-destino.ts` rechaza cualquier otra cosa antes de conectarse.

**Si ya existe una demo vieja y se quiere regenerar desde cero** (recomendado — el seed NO es idempotente, ver §3):
recrear la base entera primero. Ejemplo con un script Node ad hoc (no hay `psql` disponible en todos los entornos):

```js
// crear-o-recrear-motor2-demo.mjs — correr desde la raíz del repo: node crear-o-recrear-motor2-demo.mjs
import { Client } from "pg";
const client = new Client({ connectionString: "postgresql://motor2:motor2@localhost:5432/motor2_dev" });
await client.connect();
try {
  await client.query("SELECT pg_terminate_backend(pid) FROM pg_stat_activity WHERE datname = 'motor2_demo' AND pid <> pg_backend_pid()");
  await client.query("DROP DATABASE IF EXISTS motor2_demo");
  await client.query("CREATE DATABASE motor2_demo OWNER motor2");
} finally {
  await client.end();
}
```

## 2. Migraciones + seed base

```bash
DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
  npx prisma migrate deploy

DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
  npx tsx prisma/seed.ts
```

Da roles/acciones + sucursal "Central" + las 5 unidades base — el mismo seed que corre `motor2_dev`.

## 3. Usuario admin

El ejecutor (`scripts/seed-demo-pizzeria-6-meses.ts`) necesita que YA exista un `User` con el email de
`EMAIL_ADMIN` (`alepogabriel@gmail.com`) y membresía admin en "Central" — es quien da de alta "La Cuadra" y queda
como su primer admin. Si la base es nueva (recién creada en el §1), crearlo a mano:

```js
// crear-usuario-admin.mjs
import { PrismaClient } from "@prisma/client";
import { PrismaPg } from "@prisma/adapter-pg";
const prisma = new PrismaClient({ adapter: new PrismaPg({ connectionString: "postgresql://motor2:motor2@localhost:5432/motor2_demo" }) });
const central = await prisma.sucursal.findUniqueOrThrow({ where: { nombre: "Central" } });
const admin = await prisma.rol.findUniqueOrThrow({ where: { nombre: "admin" } });
let user = await prisma.user.findUnique({ where: { email: "alepogabriel@gmail.com" } });
if (!user) user = await prisma.user.create({ data: { email: "alepogabriel@gmail.com", name: "Alejandro" } });
const yaTiene = await prisma.usuarioSucursal.findFirst({ where: { usuarioId: user.id, sucursalId: central.id } });
if (!yaTiene) await prisma.usuarioSucursal.create({ data: { usuarioId: user.id, sucursalId: central.id, rolId: admin.id } });
await prisma.$disconnect();
```

## 4. El ejecutor (siembra 6 meses reales)

```bash
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
MOTOR2_SEED_CONFIRMAR="si" \
  npx vitest run --config vitest.seed-6-meses.config.ts
```

- Tarda ~5-25s (941 eventos; el rango varía con la máquina).
- Guion determinístico: misma semilla (`SEMILLA_GUION` en `scripts/seed-demo-pizzeria-6-meses.ts`) siempre da el
  mismo guion (mismos precios, mismas cantidades, mismos escenarios) — lo único que cambia entre corridas es a
  qué fechas reales de calendario se mapea (la ventana siempre termina HOY).
- **"0 fallos" es el único resultado aceptable.** Si falla, no seguir a los pasos siguientes — revisar el error,
  arreglar, y volver a correr desde una base recreada (§1), nunca sobre datos parciales.
- **No es idempotente a propósito**: `MOTOR2_SEED_REHACER=si` solo salta la guarda de "la sucursal ya existe", NO
  vacía nada — correrlo dos veces sobre la misma base choca (números de factura duplicados, entre otras cosas).
  Para una corrida limpia, siempre volver al §1.

## 5. Invariantes de dominio

```bash
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
  npx vitest run --config vitest.demo-invariantes.config.ts
```

De solo lectura (no pide `MOTOR2_SEED_CONFIRMAR`). 10 conciliaciones — el sistema contra sí mismo (dos reportes
independientes del mismo dato, o un reporte contra una consulta cruda). **10/10 en verde es el resultado esperado.**
Si alguna falla, algo real cambió (en el guion, en un reporte, o en la app) — no es "normal" que fluctúe.

## 6. Proyecto Playwright de la demo (barrido de pantallas + axe)

```bash
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
  npx playwright test --config playwright.demo.config.ts
```

Compila (`next build`) y arranca en modo producción contra `motor2_demo`, en el puerto 3102 (no choca con `dev` en
3000 ni con E2E en 3101). Barre las 49 pantallas sin parámetros (`test/e2e/rutas-sin-parametros.ts`): cada una tiene
que abrir sin la pantalla de error y sin violaciones de axe. **NUNCA vacía ni modifica `motor2_demo`** — es de
solo lectura, a diferencia de `npm run test:e2e` (que sí vacía su propia base E2E). **47/47 es el resultado
esperado.**

## 7. Mirar la demo a mano (opcional)

Para navegar la demo en el navegador (no solo verla pasar por specs), apuntar `next dev` a `motor2_demo` un rato:

```bash
DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" \
  npm run dev
```

Entrar como `alepogabriel@gmail.com` (el login de Google real pide esa cuenta) y cambiar a la sucursal "La Cuadra"
con el selector del encabezado. **No dejar el `.env` apuntando a `motor2_demo` por error** — al terminar, confirmar
que `DATABASE_URL` vuelve a `motor2_dev` antes de seguir desarrollando.

## 8. Neon — HECHO (2026-09-22)

Por diseño (§5 del plan), el seed NUNCA corrió contra Neon directo — a Neon llegó un dump YA VERIFICADO (pasos 4-6
en verde), aplicado a una rama NUEVA creada desde `main` (para heredar las migraciones con sus checksums), sin
sembrar sobre la rama viva. Ejecutado con autorización expresa del usuario, paso a paso:

- Rama nueva `demo-la-cuadra-6-meses-2026-09-22` (`br-sweet-term-aff8ggxs`), creada desde `main`.
- Migración de datos verificada completa y correcta (conteo de filas + integridad de FKs, 0 hallazgos).
- Cutover de Vercel: `DATABASE_URL`/`DIRECT_URL` de Producción apuntados a la rama nueva (cambio manual del usuario
  en el dashboard — un cambio de variable de entorno no dispara redeploy solo, así que se forzó uno con un commit
  vacío vía la integración de git de Vercel). Deployment verificado `READY`.

**Vigencia**: la demo se ancla a `new Date()` al momento de sembrarla (§0) — pasado el plazo de "cada 2 meses
aproximadamente", hay que repetir el procedimiento completo (recrear localmente, verificar, volver a migrar a una
rama nueva) para que la ventana de fechas no quede vacía en los reportes.

## Resumen de comandos (una vez que la base ya existe y solo se quiere re-sembrar desde cero)

```bash
node crear-o-recrear-motor2-demo.mjs
DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" npx prisma migrate deploy
DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" DIRECT_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" npx tsx prisma/seed.ts
node crear-usuario-admin.mjs
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" MOTOR2_SEED_CONFIRMAR="si" npx vitest run --config vitest.seed-6-meses.config.ts
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" npx vitest run --config vitest.demo-invariantes.config.ts
MOTOR2_SEED_DATABASE_URL="postgresql://motor2:motor2@localhost:5432/motor2_demo" npx playwright test --config playwright.demo.config.ts
```

## Troubleshooting

- **El ejecutor falla a mitad de camino**: no reintentar sobre la misma base (choca con lo ya escrito). Volver al
  §1 (recrear) y correr de nuevo desde cero.
- **Las invariantes fallan**: no es un problema de la demo en sí — comparan reportes ya construidos y verificados
  contra sí mismos. Si fallan, algo cambió en un reporte real (`src/core/reportes/*`) desde la última vez que se
  corrió esto; revisar el diff de código, no el guion.
- **El barrido de Playwright encuentra una violación de axe nueva**: es un hallazgo real de la aplicación (así se
  encontraron los 4 bugs del Tramo 5, docs/planes-demo-y-claridad-reportes-2026-09-21.md §5) — arreglar el
  componente, nunca silenciar el chequeo.
- **`MOTOR2_SEED_DATABASE_URL`/`MOTOR2_SEED_CONFIRMAR` faltantes o mal puestos**: los tres scripts (`vitest.seed-6-
  meses.config.ts`, `vitest.demo-invariantes.config.ts`, `playwright.demo.config.ts`) abortan ANTES de conectarse a
  nada — ver `scripts/demo-seed/guardas-destino.ts` para el mensaje exacto de cada guarda.
