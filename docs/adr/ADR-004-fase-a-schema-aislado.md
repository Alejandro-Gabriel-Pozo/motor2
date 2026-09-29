# ADR-004: Schema de Fase A aislado de `prisma/schema.prisma`

> Redactado el 2026-09-29, al empezar a construir el modelo `Empresa`/
> `UsuarioEmpresa`/`Sucursal.empresaId` de la Fase A del checklist de
> multi-tenancy. Es una decisión técnica de implementación (mía, no del
> dueño) para cumplir al pie de la letra la instrucción ya dada: "trabajar
> el schema en una base de Neon sin tocar main".

## Contexto

El dueño pidió conectar una base de Neon dedicada
(`motor2-multitenancy-fase-a`, ver `.env.multitenancy`) para poder diseñar
el schema de Fase A sin tocar `main` ni ningún recurso compartido.

La forma obvia de hacerlo — editar `prisma/schema.prisma` directamente en
esta rama y aplicar la migración solo contra Neon — **no alcanza esa
garantía**: Prisma genera UN Client desde el schema, y ese mismo Client
(`node_modules/@prisma/client`) es el que usa toda la app (`src/lib/db.ts`),
sin importar contra qué `DATABASE_URL` se apunte en cada comando. En cuanto
`prisma generate` corre con `Sucursal.empresaId` en el modelo, el Client
generado espera esa columna en CUALQUIER Postgres al que se conecte —
incluido el local (`motor2_dev`/`motor2_e2e`), que no la tiene todavía. El
resultado sería que `npm test`, `npm run build` o el propio `next dev`
empiezan a fallar con `column "empresaId" does not exist` en cualquier
consulta que toque `Sucursal`, apenas alguien (o un CI, o yo en otra sesión)
corra esos comandos estando parado en esta rama. Eso es exactamente la
interferencia que el dueño pidió evitar — no alcanza con "no mergear a
main", porque el problema aparece ya en la rama, antes de cualquier merge.

## Decisión

El schema de Fase A vive **fuera** de `prisma/schema.prisma`, en
`prisma/fase-a/`, como una copia completa e independiente:

- `prisma/fase-a/schema.prisma`: copia de `prisma/schema.prisma` + las
  adiciones de Fase A (`Empresa`, `EstadoEmpresa`, `UsuarioEmpresa`,
  `Sucursal.empresaId`). El generator declara `output =
  "../../node_modules/.prisma/fase-a-client"` — un Client separado, que
  nunca pisa `node_modules/@prisma/client` (el real).
- `prisma/fase-a/prisma.config.ts`: config propio que lee
  `FASE_A_DIRECT_URL` (cargado a mano desde `.env.multitenancy`, nunca
  desde `.env`) — deliberadamente un nombre de variable distinto al
  `DIRECT_URL` que usa `prisma.config.ts` real, para que sea imposible
  que un comando de esta carpeta toque `motor2_dev` por compartir nombre
  de variable.
- `prisma/fase-a/migraciones-manuales/`: SQL escrito a mano (patrón de 3
  pasos: columna nullable → backfill → `NOT NULL` + constraints), pensado
  para aplicarse tal cual sobre una base con `Sucursal` ya pobladas.
- `prisma/fase-a/smoke-test.mjs`: script manual (Prisma Client aislado +
  `PrismaPg`) que probó el modelo de punta a punta contra Neon.
- `knip.jsonc`: `schema.prisma` y `prisma.config.ts` de esta carpeta se
  declaran en `entry` (RESERVADO) — se invocan a mano vía `--schema`/
  `--config`, nunca importados desde código, igual que el resto de esa
  lista.

Todo comando de esta carpeta requiere pasar `--schema`/`--config`
explícito; nada se ejecuta por default ni se descubre automáticamente.

## Alternativas consideradas

- **Editar `prisma/schema.prisma` directamente en la rama, sin mergear a
  `main`**: descartada — como se explica arriba, rompe `npm test`/`npm run
  build`/`next dev` locales apenas alguien corra esos comandos en esta
  rama, mucho antes de cualquier merge. No cumple "sin tocar main" en la
  práctica.
- **Migrar también el Postgres local (`motor2_dev`/`motor2_e2e`) para que
  coincida con el schema nuevo**: descartada — el dueño pidió explícitamente
  no tocar los recursos que ya usa la app hoy; migrar local ata la Fase A a
  una decisión (cuándo activar esto de verdad) que todavía no se tomó.
- **`prisma db push` contra Neon en vez de migración a mano**: evaluada
  para prototipar rápido, pero no deja un artefacto SQL revisable con el
  patrón de backfill de 3 pasos que va a hacer falta el día que esto se
  aplique contra datos reales (Fase B). Se usó igual `prisma migrate diff`
  para generar un borrador de referencia, pero la migración final se
  escribió y probó a mano.

## Consecuencias

- Cero riesgo para `main`, para el Postgres local y para el Client real:
  verificado (`git status` solo muestra `prisma/fase-a/` como nuevo;
  `prisma/schema.prisma` sin cambios).
- El modelo se probó de punta a punta contra Neon: backfill de `Sucursal`
  preexistentes a una Empresa por defecto, unicidad de `nombre` ahora por
  empresa (dos empresas pueden compartir nombre de sucursal; la misma
  empresa no), integridad referencial de `Sucursal.empresaId` → `Empresa`,
  y CRUD real vía el Prisma Client generado (no solo SQL crudo).
- Costo: hay que mantener la copia de `prisma/fase-a/schema.prisma`
  sincronizada a mano con `prisma/schema.prisma` mientras dure esta fase
  exploratoria (cualquier cambio al schema real posterior a esta fecha no
  se refleja acá solo). Aceptable porque es un estado transitorio: el
  destino final es fusionar esto a `prisma/schema.prisma` real de una sola
  vez, con su propia migración en `prisma/migrations/`, cuando el dueño
  decida activar Fase A.

## Revisar cuando

El día que se decida activar Fase A contra datos reales: en ese momento,
`prisma/fase-a/schema.prisma` dejar de existir como copia — sus cambios se
aplican directamente a `prisma/schema.prisma`, con una migración nueva en
`prisma/migrations/` (adaptando `migraciones-manuales/20260929_empresa_y_usuarioempresa.sql`
a los datos reales), y toda esta carpeta se borra.
