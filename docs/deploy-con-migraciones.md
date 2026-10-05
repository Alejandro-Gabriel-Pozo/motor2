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

Alta y baja de módulos de una empresa: la vía normal es la consola (`/empresas/[id]/modulos`, ADR-023); `npm run modulos-empresa` con `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`) queda como vía de emergencia.
Para volver atrás una migración del bloque, ver `scripts/operaciones/restaurar-registro-de-modulos.md`.

## Consola de plataforma (E4, ADR-019): migraciones y puesta en marcha

Dos migraciones **aditivas** (solo agregan tablas; el código viejo las ignora, así que el Instant Rollback de Vercel sigue siendo seguro):
`20261009120000_admin_de_plataforma` (administrador, código del mail, códigos de recuperación, sesión) y `20261009130000_auditoria_de_plataforma`. Se aplican **por
base y con autorización expresa**, con ensayo previo en una rama de Neon y respaldo. Aplicadas el 2026-10-03/04 a las bases de zuluhub y stockhneuquen (con respaldo `respaldo-pre-e4-*`, ensayo en zuluhub y `migrate status` al día).
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

## Alta de empresas e invitaciones (E5, ADR-020): migración y puesta en marcha

Una migración **aditiva**: `20261010120000_invitaciones` (tabla `Invitacion`, un tipo, una función y un trigger; el código viejo la ignora, así que el Instant Rollback de
Vercel sigue siendo seguro). Se aplicó solo a la base local y a la de E2E. En cada base de Neon se aplica **con autorización expresa**, ensayo en una rama y respaldo previo,
y **antes del deploy de la aplicación** (el build verifica que no haya migraciones pendientes).

Orden por base (el dueño; primero zuluhub, después stockhneuquen):

1. Rama de respaldo de Neon y rama de ensayo; en la de ensayo: `node scripts/operaciones/con-env.mjs <env de ensayo> -- npx prisma migrate deploy`.
2. Verificar en la rama: `SELECT policyname FROM pg_policies WHERE tablename = 'Invitacion'` (tres políticas: `aislamiento_empresa`, `escritura_plataforma`, `lectura_por_token`),
   `has_table_privilege` de `motor2_app` (SELECT sí; INSERT y DELETE no) y de `motor2_plataforma` (SELECT, INSERT, UPDATE; DELETE no), y que existan los dos triggers `Invitacion_proteger_*`.
3. Aplicar en la base real: `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npm run migrar:aprobar`.
4. **Volver a correr** `scripts/operaciones/crear-rol-motor2-plataforma.sql` con psql como dueño (idempotente): ahora también le da a `motor2_plataforma` permiso sobre `Invitacion`.
5. Borrar la rama de ensayo.
6. Deploy de la aplicación. Después, en el proyecto de Vercel de la consola: la variable nueva `PLATAFORMA_URL_APP` (la dirección pública de la app de empresas de ESA
   instalación, `https://…` sin ruta) y el canal `avisos` de mails con el dominio verificado; deploy de la consola.
7. Prueba de humo, a mano: alta de una empresa de prueba desde `/empresas/nueva` → llega el mail → abrir el enlace, entrar con una cuenta de Google **del email invitado**,
   cargar el CUIT y aceptar. Esa prueba valida el regreso desde Google con la cookie de la invitación (`SameSite=Lax`), que un E2E no puede recorrer.

La consola administra **la instalación a la que apunta su conexión** (hoy la de zuluhub): sumar la de hoteles es una variable por instalación (ADR-012 §4), pendiente.

Vuelta atrás: el código se vuelve con Instant Rollback; `down.sql` de la migración solo después (pierde las invitaciones pendientes y los CUIT declarados; guardar antes
`SELECT id, "empresaId", email, estado, "cuitDeclarado" FROM "Invitacion"`) y después `prisma migrate resolve --rolled-back 20261010120000_invitaciones`.

El alta por script (`npm run crear-empresa`) se retiró: hasta que la consola esté desplegada, no hay otra forma de crear una empresa que pedirlo en una sesión de desarrollo.

## Confirmar, corregir el CUIT, suspender y reactivar (E6, ADR-021): sin migración

No hay migración ni cambio de permisos: el rol `motor2_plataforma` ya puede actualizar `Empresa` y escribir la auditoría. Lo que hay que hacer, por instalación:

1. En el proyecto de Vercel de la **aplicación de empresas**, la variable opcional `CONTACTO_PLATAFORMA_EMAIL` (el email que ve quien tiene su empresa suspendida). Sin ella la
   pantalla no muestra ningún contacto. Se carga con `scripts/operaciones/cargar-env-vercel.sh`.
2. Confirmar la segunda empresa activa de una instalación **ya no cambia nada** (ADR-022). Lo que antes exigía verificar a mano pasó a ser prerrequisito del despliegue de ADR-022 (más abajo).
3. Confirmar un alta: `/empresas?filtro=cuit-pendiente` → detalle → revisar el CUIT contra la constancia de ARCA → tildar → «Confirmar el alta». La empresa pasa a activa
   y el gerente recibe el aviso; si el mail no sale, «Reenviar el aviso de activación».
4. Una empresa recién activa tiene solo Administración. Los módulos se activan desde la consola, en `/empresas/[id]/modulos` (ADR-023); el script `npm run modulos-empresa -- --actor <User existente>` es la vía de emergencia.
5. Suspender: la empresa deja de dar acceso en el pedido siguiente; el portal público de la carta da 404 al instante y la carta de cada sucursal puede verse **hasta unos 5 minutos** más (caché ISR).
6. Corregir o cargar un CUIT: desde el detalle de una empresa activa o suspendida, con motivo. Hoy no existe el circuito fiscal, así que siempre se puede; cuando exista,
   se bloquea con la primera factura autorizada por ARCA en producción.
7. Para empresas anteriores a E2 sin CUIT: filtro «Activas sin CUIT» → «Cargar el CUIT».

Endurecimientos opcionales (cada uno **requiere autorización expresa** y queda fuera de E6): permisos por columna sobre `Empresa` para `motor2_plataforma` (hoy tiene `UPDATE` de toda la tabla) y un
`CHECK` de formato sobre `Empresa.cuit`, junto con la migración que lo vuelva obligatorio (ADR-012 §6) cuando todas las empresas tengan CUIT.

## Sin empresa por defecto (ADR-022): despliegue en dos tiempos

Hay una migración, **no aditiva** (`app_empresa_actual_sin_respaldo`, una sola sentencia `CREATE OR REPLACE FUNCTION`), y código. El código ya no depende del respaldo y se despliega primero; la
migración se aplica después, base por base, **con autorización expresa**. Hasta que no se aplique, la base conserva el respaldo y todo sigue andando (el código nuevo no lo usa).

**Verificaciones del dueño antes de desplegar el código (solo lectura):**
1. En Vercel de cada app (zuluhub y stockhneuquen): que `DATABASE_URL` conecte con `motor2_app` y no con el dueño (`scripts/operaciones/cargar-env-vercel.sh` imprime el usuario). El rol de ejecución es estricto
   siempre: con el dueño la app no arranca.
2. Que no esté `MOTOR2_MIGRAR_EN_BUILD` y que el despliegue actual sea posterior al commit `8f22f96` (`dbDeUsuario`).
3. `BOOTSTRAP_ADMIN_EMAILS` ya no se usa: se puede borrar de las variables de Vercel.
4. En cada base de Neon, como dueño: `SELECT estado, count(*) FROM "Empresa" GROUP BY 1;`, `SELECT rolname, rolsuper, rolbypassrls FROM pg_roles WHERE rolname IN ('motor2_app','motor2_plataforma');`,
   `SELECT * FROM pg_db_role_setting;` (no tiene que haber nada `app.*`) y `SELECT pg_get_functiondef('app_empresa_actual'::regproc);`.
5. En Sentry, los eventos `rol-de-ejecucion-privilegiado` de los últimos 30 días (si hay, la app corrió alguna vez con un rol que salta el RLS).

**Migración, por base (primero zuluhub, después stockhneuquen):** rama de respaldo de Neon; rama de ensayo con `migrate deploy`, comprobar como `motor2_app` que `SELECT app_empresa_actual()` da NULL
sin contexto, que un `count` sin contexto da 0, que con `set_config('app.empresa_id', …, true)` da lo esperado y que un `INSERT` sin contexto falla con `23502`, y un recorrido real (login, POS, carta, crons, consola);
borrar la rama de ensayo; `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npm run migrar:aprobar`; deploy; vigilar Sentry 48 horas (errores `P2011`/`23502` sobre `empresaId` y `42501`).
Nunca ensayar con el Preview de stockhneuquen: comparte la base de producción. Vuelta atrás: `down.sql` (una sentencia) y `prisma migrate resolve --rolled-back`.

Una instalación local: `npm run db:seed -- --gerente tu@email.com` deja al primer gerente (ya no existe el bootstrap por email).
