# Deploy con migraciones: el build no migra solo

> Tanda 7 (2026-10-02). Reemplaza el comportamiento anterior (S-03 de ADR-007), donde `npm run build` corría `prisma migrate deploy` en
> Producción y en local. Aplicar una migración a una base es una decisión del dueño: se aprueba con un paso explícito, antes del deploy.

## Qué hace `npm run build` (`scripts/construir.ts`)

Siempre corre `prisma generate` y `next build`. Entre los dos, según `modoDeMigracionEnBuild`:

| Entorno | Modo | Qué pasa |
|---|---|---|
| Local, gate, CI, Producción de Vercel (default) | `verificar` | `prisma migrate status`. Sin pendientes, sigue. **Con pendientes (o si no puede consultar la base) el build falla** y dice cómo aprobarlas. |
| `MOTOR2_MIGRAR_EN_BUILD=1` (cualquier entorno) | `aplicar` | `prisma migrate deploy`. Es la aprobación explícita «solo para este deploy». |
| `MOTOR2_MIGRAR_EN_BUILD=0`, o Vercel con `VERCEL_ENV` ≠ `production` | `omitir` | No toca la base ni la mira (el Preview de `stockhneuquen` comparte la base de producción, ADR-007). |

`npm run build:e2e` (el que usa Playwright) nunca migra ni verifica: la base E2E la migra el workflow o quien corre la suite.

## Flujo aprobado de un deploy con migraciones

1. El dueño revisa las migraciones nuevas (`prisma/migrations/*`, cada una con su `down.sql` si es destructiva) y hace un snapshot de la rama de Neon
   si el cambio lo amerita.
2. **Aprueba y aplica**, con `DIRECT_URL` (conexión directa, sin pooler) de ESA base cargada en el entorno de la terminal:
   `npm run migrar:aprobar` (= `prisma migrate deploy`). Se hace una vez por base: `zuluhub-demo` y `hoteles-del-neuquen` son bases distintas.
3. Recién después se hace el deploy (push a `multitenancy-fase-a`). El build de Producción corre `migrate status`, ve la base al día y compila.
4. Si se hace el deploy ANTES del paso 2, el build falla con el mensaje de cómo aprobar: no queda código nuevo sobre una base vieja.

Alternativa para un deploy puntual: poner `MOTOR2_MIGRAR_EN_BUILD=1` en el proyecto de Vercel, desplegar, y **sacarla** al terminar. No dejarla fija:
con la variable fija, el build vuelve a migrar solo y se pierde la aprobación. Si hoy está cargada en `motor2-demo` o `stockhneuquen` (por la
nota de «rama de Producción» de ADR-007), el dueño la quita (o la pone en `0`) cuando adopte este flujo.

## Gate local y CI

- Local/gate: el build falla si la base de `DIRECT_URL` tiene migraciones sin aplicar. Antes del gate, `npm run migrar:aprobar` contra la base local
  (las migraciones nuevas de una tanda se aplican acá, nunca a Neon sin autorización).
- CI (`.github/workflows/ci.yml`): corre `npx prisma migrate deploy` como dueño sobre la base efímera y después `npm run build`, y recién al final
  `npm test`. El orden importa: el build verifica el registro de módulos (ver abajo) y los tests dejan la base con empresas y roles de prueba, que el
  verificador rechazaría.

## Bloque de módulos (migraciones 20261003 a 20261006): orden por base

Cuatro migraciones llegan juntas a cada base: `20261003120000_extensiones_btree_gist_trgm_unaccent`, `20261004120000_registro_de_modulos_por_empresa`,
`20261005120000_renombrar_boleta_a_ticket` y `20261006120000_clave_de_rol_de_sistema`. Se aplican **por base y con autorización expresa**:
`zuluhub-demo` (Neon `vercel-dev`) ya las tiene; `hoteles-del-neuquen` (stockhneuquen) no, y no se despliega ahí hasta aplicarlas.

1. Snapshot (rama de respaldo de Neon) de la base destino. Es el rollback del DEPLOY: código viejo más base vieja.
2. `node scripts/operaciones/con-env.mjs <archivo-env> -- npx prisma migrate status` y revisar qué falta.
3. `... -- npm run migrar:aprobar`.
4. `... -- npx tsx scripts/verificar-registro-de-modulos.ts`: tiene que salir con código 0. Falla si hay una empresa activa anterior a la migración sin
   registro de módulos, o con un rol llamado «admin» sin la clave «admin». El mismo chequeo corre dentro de `npm run build` (modo `verificar`), así que
   un deploy sobre una base sin registro falla antes de publicar.
5. Recién ahí el deploy.

Alta y baja de módulos de una empresa: solo `npm run modulos-empresa` con `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`); ninguna pantalla lo hace.
Para volver atrás una migración del bloque, ver `scripts/operaciones/restaurar-registro-de-modulos.md`.

## Consola de plataforma (E4, ADR-019): migraciones y puesta en marcha

Dos migraciones **aditivas** (solo agregan tablas; el código viejo las ignora, así que el Instant Rollback de Vercel sigue siendo seguro):
`20261009120000_admin_de_plataforma` (administrador, código del mail, códigos de recuperación, sesión) y `20261009130000_auditoria_de_plataforma`. Se aplican **por
base y con autorización expresa**, con ensayo previo en una rama de Neon y respaldo. Se aplicaron solo a la base local; ninguna base remota las tiene.
Se crean en todas las bases, pero solo se usa la de identidad (zuluhub); en las demás quedan vacías.

Orden por base (el dueño; el asistente de desarrollo no ve credenciales ni corre nada de esto contra Neon):

1. Snapshot de la rama de Neon destino y ensayo de las dos migraciones en una rama descartable.
2. Crear el rol `motor2_plataforma` en ESA rama, **con psql como dueño** (`neondb_owner`), nunca desde la consola de Neon (nacería con `BYPASSRLS`):
   `psql <conexión del dueño> -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql`. Los roles son por rama: la rama de producción de
   cada despliegue necesita el suyo. Es idempotente.
3. `... migrate status` y `npm run migrar:aprobar` (ver «Flujo aprobado» arriba). Si el rol ya existía, las migraciones le dan el permiso al crear las tablas.
4. Archivo local **fuera del repositorio** (`.env.plataforma.<despliegue>`, gitignored) con `PLATAFORMA_DATABASE_URL` (usuario `motor2_plataforma`),
   `PLATAFORMA_SECRETO_CODIGOS` (`openssl rand -base64 48`) y `PLATAFORMA_CLAVE_TOTP` (`openssl rand -base64 32`). Los mismos tres valores van en el proyecto de
   Vercel de la consola; **la aplicación de empresas no los lleva**.
5. Primer administrador, una vez, en la instalación de identidad (zuluhub):
   `DOTENV_CONFIG_PATH=.env.plataforma.<despliegue> npm run plataforma:crear-admin -- --email <email> --nombre "<nombre>"`.
   Imprime **una sola vez** el secreto TOTP (cargarlo en la app autenticadora) y 10 códigos de recuperación (guardarlos fuera de línea). No se vuelven a ver.
   Se niega si el email ya es de un administrador o de un usuario de una empresa.
6. Proyecto de Vercel de la consola: Root Directory `plataforma/`, mismas variables, subdominio propio, y el canal de mails `avisos` configurado
   (`CORREO_AVISOS_RESEND_API_KEY`, `CORREO_AVISOS_REMITENTE`; ADR-018) para que llegue el código del primer factor. Como en la aplicación, el build de la
   consola no migra. El deploy se hace recién después de los pasos 1 a 5.

Rotar `PLATAFORMA_SECRETO_CODIGOS` o `PLATAFORMA_CLAVE_TOTP` invalida los factores ya enrolados: hay que crear de nuevo a los administradores.
