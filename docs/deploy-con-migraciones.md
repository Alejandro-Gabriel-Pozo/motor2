# Deploy con migraciones: el build no migra solo

> Tanda 7 (2026-10-02). Reemplaza el comportamiento anterior (S-03 de ADR-007), donde `npm run build` corría `prisma migrate deploy` en
> Producción y en local. Aplicar una migración a una base es una decisión del dueño: se aprueba con un paso explícito, antes del deploy.

## Qué hace `npm run build` (`scripts/construir.ts`)

Siempre corre `prisma generate` y `next build`. Entre los dos, según `modoDeMigracionEnBuild`:

| Entorno | Modo | Qué pasa |
|---|---|---|
| Local, gate, CI, Producción de Vercel (default) | `verificar` | `prisma migrate status`. Sin pendientes, sigue. **Con pendientes (o si no puede consultar la base) el build falla** y dice cómo aprobarlas. |
| `MOTOR2_MIGRAR_EN_BUILD=1` en local o en Producción de Vercel | `aplicar` | `prisma migrate deploy`. Es la aprobación explícita «solo para este deploy». |
| `MOTOR2_MIGRAR_EN_BUILD=0`, o Vercel con `VERCEL_ENV` ≠ `production` | `omitir` | No toca la base ni la mira (el Preview de `stockhneuquen` comparte la base de producción, ADR-007). |
| `MOTOR2_MIGRAR_EN_BUILD=1` en Vercel con `VERCEL_ENV` ≠ `production` (S-31) | `rechazar` | **El build falla** antes de tocar nada: un Preview comparte la base de producción y no puede migrarla. `VERCEL_ENV` se mira antes que la variable. Se saca la variable de ese entorno. |

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

Alta y baja de módulos de una empresa: la vía normal es la consola (`/instalaciones/<id>/empresas/<empresa>/modulos`, ADR-023 y ADR-025); `npm run modulos-empresa` con `PLATAFORMA_DATABASE_URL` (rol `motor2_plataforma`) queda como vía de emergencia.
Para volver atrás una migración del bloque, ver `scripts/operaciones/restaurar-registro-de-modulos.md`.

## Consola de plataforma (E4, ADR-019): migraciones y puesta en marcha

Dos migraciones **aditivas** (solo agregan tablas; el código viejo las ignora, así que el Instant Rollback de Vercel sigue siendo seguro):
`20261009120000_admin_de_plataforma` (administrador, código del mail, códigos de recuperación, sesión) y `20261009130000_auditoria_de_plataforma`. Se aplican **por
base y con autorización expresa**, con ensayo previo en una rama de Neon y respaldo. Aplicadas el 2026-10-03/04 a las bases de zuluhub y stockhneuquen (con respaldo `respaldo-pre-e4-*`, ensayo en zuluhub y `migrate status` al día).
Se crean en todas las bases, pero solo se usa la de identidad (zuluhub); en las demás quedan vacías.

Orden por base (el dueño; el asistente de desarrollo no ve credenciales ni corre nada de esto contra Neon):

1. Snapshot de la rama de Neon destino y ensayo de las dos migraciones en una rama descartable.
2. Crear el rol `motor2_plataforma` en ESA rama, **con psql como dueño** (`neondb_owner`), nunca desde la consola de Neon (nacería con `BYPASSRLS`):
   `psql <conexión del dueño> -1 -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql` (`-1` o el ejecutor `scripts/operaciones/ejecutar-sql-de-psql.mjs`: una sola
   transacción). La `clave` solo hace falta si el rol NO existe (lo crea) o si querés CAMBIARLE la contraseña a propósito: con el rol ya creado, correrlo SIN `-v clave` no toca el rol
   (solo verifica que siga siendo el de la consola) y reaplica los grants. Los roles son por rama: la rama de producción de cada despliegue necesita el suyo. Es idempotente.
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
4. **Volver a correr** `scripts/operaciones/crear-rol-motor2-plataforma.sql` con psql como dueño, con `-1` y **sin `-v clave`** (idempotente; con clave le cambiaría la contraseña a la consola): ahora también le da a `motor2_plataforma` permiso sobre `Invitacion`.
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

Una instalación local: `npm run db:seed -- --gerente tu@email.com --mostrar-enlace` deja al primer gerente (ya no existe el bootstrap por email) e imprime el enlace para entrar con Google la primera vez; sin `--mostrar-enlace` el enlace (lleva un token) no se imprime y sale por el correo de avisos si está configurado (S-33). El seed solo corre contra un Postgres local; para sembrar una base real hace falta `--permitir-remoto` y confirmar a mano el nombre de la base (terminal interactiva), y nunca corre en Vercel ni con `NODE_ENV=production`.

## Invitación por usuario y sin enlace automático de cuentas (ADR-024): despliegue en tres tiempos

Hay una migración (`20261012120000_invitacion_de_usuario`, aditiva en lo funcional, con `down.sql`) y código que apaga `allowDangerousEmailAccountLinking`. **Cada paso con autorización expresa del dueño.**

**Antes (solo lectura):**
1. En cada app de Vercel (zuluhub y stockhneuquen): configurar `CORREO_AVISOS_*` (el canal `avisos` de Resend) y `AUTH_URL` (la dirección pública fija de esa app, https, sin ruta). Sin ellas, las invitaciones quedan «sin enviar».
2. Estado de migraciones de cada base: `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npx prisma migrate status` (las de E5 y ADR-022 tienen que estar aplicadas).
3. `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npm run medir-precargados` (sin `--detalle` en chats): cuántos precargados activos no entraron nunca con Google.

**Orden:** (1) desplegar la **consola** (ya filtra las invitaciones por `rolEmpresa = 'gerente'`; sirve antes y después de la migración); (2) la migración en cada base, primero zuluhub y después stockhneuquen:
rama de respaldo de Neon; rama de ensayo con `migrate deploy`; en el ensayo comprobar con `has_table_privilege('motor2_app', '"Invitacion"', 'INSERT')` (sí) y `'DELETE'` (no), que `InvitacionSucursal` tiene
sus 2 triggers y su política, y que `motor2_plataforma` no tiene ningún privilegio sobre `InvitacionSucursal`; borrar la rama de ensayo; `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npm run migrar:aprobar`;
(3) desplegar la **app**. Nunca ensayar con el Preview de stockhneuquen: comparte la base de producción.

**Después:** «Invitar a vincular» a cada precargado que `medir-precargados` haya contado (Administración → Usuarios), prueba de humo con una cuenta real (alta de una persona nueva → mail → enlace → Google → Aceptar → entra),
y vigilar Sentry 48 horas (errores de `signIn`, `invitacion-sin-auth-url`, correos `avisos` no enviados).

**Vuelta atrás:** Instant Rollback de la app (vuelve a encender el enlace automático; las invitaciones nuevas quedan inútiles pero no rompen nada). La migración, solo si hace falta: `down.sql` como dueño
(borra las invitaciones de usuario y de vinculación) y `prisma migrate resolve --rolled-back 20261012120000_invitacion_de_usuario`.

**Soporte — cuenta de Google rehecha (`/login?aviso=cuenta-distinta`):** la persona recuperó su email con otra cuenta de Google (otro identificador). Verificar su identidad por un canal propio; como dueño, borrar su `Account` vieja
(`DELETE FROM "Account" WHERE "userId" = '…' AND provider = 'google'`) y mandarle «Invitar a vincular» desde Administración → Usuarios.

## Paquete 1 de migraciones: M.2 + P3 + RLS por sucursal (M.3, ADR-028), un solo despliegue en `stockhneuquen`

> Redactado el 2026-10-11 (reemplaza el flujo «código primero, por grupo y en dos bases» del 2026-10-10: ya no hay ZuluHub ni usuarios, la instalación es una sola y la regla es un OK por paquete). **Mientras el dueño no dé la autorización expresa, ninguna de estas
> migraciones se aplicó a ninguna base de Neon**; el asistente de desarrollo no corre nada de esto contra Neon sin ese OK (lecturas incluidas).

> **APLICADO Y DESPLEGADO el 2026-10-12 (OK del dueño «OK paquete 1, PR 96»).** Las 8 migraciones se aplicaron a la rama `main` de Neon (`inventario-api`) en UNA transacción (`lock_timeout` 10 s), con respaldo previo (rama `br-lucky-night-af6qdfaz`) y ensayo en otra rama con ciclo subir/bajar/subir. Resultado medido después: 104 migraciones vigentes, 0 a medias, la última es B6, 128 políticas `alcance_sucursal_*` en 32 tablas, 2 funciones de alcance, tabla `AgregadoDeCuenta` y 2 filas de `producto_campos_sensibles`. Después se desplegó `stockhneuquen` (commit `819bd8d`, `main`): `/login` y la carta pública responden 200 y no hubo errores de runtime. La fusión del PR #96 fue SQUASH (la regla era merge commit); el código es idéntico al de `1c652a5`. **Sin confirmar:** el usuario de `DATABASE_URL`; la app lo exige (`EXIGIR_ROL_DE_LA_APP`) y se confirma con la primera sesión autenticada. Reversa si hiciera falta: `down.sql` de B6 a B1 (en ese orden), después P3 y M.2, y `prisma migrate resolve --rolled-back` de cada una.
>
> **Estado medido de la base de `stockhneuquen` ANTES de aplicar (lecturas de solo lectura autorizadas por el dueño, 2026-10-12, proyecto Neon `inventario-api`, rama `main`).** E8 (`20261012120000_invitacion_de_usuario`, ADR-024) **YA ESTÁ APLICADA** (el checkpoint del 2026-10-05 estaba desactualizado):
> `_prisma_migrations` tiene 96 filas, todas terminadas y ninguna revertida ni a medias; la última es E8; el repo tiene 96 migraciones hasta E8. **Lo pendiente son exactamente las 8 del paquete.** Variables de Vercel (producción) presentes: `AUTH_URL`, `CORREO_AVISOS_REMITENTE`, `CORREO_AVISOS_RESEND_API_KEY`; `MOTOR2_MIGRAR_EN_BUILD` ausente.
> Rol `motor2_app`: no es superusuario, sin `BYPASSRLS`, sin membresía en ningún rol (ni `neon_superuser`), sin `CREATE` en `public`, sin `TRUNCATE`, dueño de 0 tablas. Ids de `Sucursal` con forma rara: 0. Las 6 consultas de coherencia de datos: 0. Hoy no hay políticas ni funciones de alcance, ni `AgregadoDeCuenta`, ni la clave `producto_campos_sensibles`.
> Volumen: 1 empresa, 6 sucursales, 3 usuarios, 0 operaciones, 0 movimientos, 0 secciones, 1 cuenta, 50 productos, 57 filas de auditoría. **Sin confirmar:** el usuario de `DATABASE_URL` (la variable es secreta en Vercel y no hay conexiones de la app abiertas en la base); no hay ningún evento `rol-de-ejecucion-privilegiado` en Sentry en 90 días, lo que indica que siempre corrió con `motor2_app`.

**Qué lleva el paquete (8 migraciones, cada una con su `down.sql`):**
1. `20261013120000_permiso_producto_campos_sensibles` (M.2): solo datos. Alta de la clave `producto_campos_sensibles` y copia de los permisos de quien hoy edita `producto_editar` o `producto_presentaciones`. **Sin ella nadie podría cambiar un precio, un factor ni una unidad con el código nuevo.**
2. `20261014100000_i3_agregado_de_cuenta` (P3): tabla nueva `AgregadoDeCuenta` (el comprobante de idempotencia del «agregar al pedido» del salón; solo se agrega: SELECT e INSERT para `motor2_app`).
3. `20261014110000_rls_sucursal_b1_funciones`: `app_sucursales_lectura()` y `app_sucursales_escritura()`.
4. a 8. `..._b2_configuracion`, `..._b3_carta`, `..._b4_punto_de_venta` (incluye `AgregadoDeCuenta`), `..._b5_stock_y_dinero`, `..._b6_receta_y_auditoria`: 4 políticas RESTRICTIVE `TO motor2_app` por tabla, 32 tablas, 128 políticas. El SQL de B1 a B6 sale de `test/setup/politicas-de-alcance-de-sucursal.ts`
   (nadie lo escribe a mano) y el guardián B7 (`test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts`) exige que cada archivo sea igual a la salida del generador.

**Fuera del paquete (a propósito):** el candado del Kardex y `SaldoStock` (van con M2, paquete 3), el índice de C25 y los índices del Kardex (se miden con volumen real).

### Antes (solo lectura; cada lectura sobre Neon necesita el OK)

1. **El usuario de `DATABASE_URL` de `stockhneuquen` (Production) es `motor2_app`.** Con la migración B1 el control del rol de ejecución (`EXIGIR_ROL_DE_LA_APP`, `src/server/sesion/base.ts`) pasa de aviso a **bloqueante**: la app no opera con otro rol. En Vercel el valor está oculto (variable sensible): se confirma
   con `scripts/operaciones/cargar-env-vercel.sh` o contra la propia base (`SELECT usename FROM pg_stat_activity` desde una conexión viva de la app).
2. **`MOTOR2_MIGRAR_EN_BUILD` ausente** en `stockhneuquen` y en `motor2-demo` (verificado en Vercel el 2026-10-11: no existe en ninguno). Tiene que seguir así: con `=0` el build no mira la base y se podría publicar código nuevo sobre una base sin migrar; con `=1` la migración corre dentro del build y, si el build falla después, queda el código viejo sobre la base nueva sin lugar para los post-chequeos.
3. Estado de la base, como dueño: `_prisma_migrations` sin filas a medias, `npx prisma migrate status` (tienen que faltar **exactamente las 8 del paquete**; E8 ya está aplicada, medido el 2026-10-12: si aparece cualquier otra pendiente, parar y avisar), conteos de las tablas principales, las consultas de coherencia de datos y los chequeos del rol de abajo (todos en 0, vacíos o `false`, según se indica).
4. Coherencia de datos: una fila visible con un padre invisible rompe el `include` que la lee (ADR-028, limitaciones).
   - movimientos cuya sección es de otra sucursal que su operación:
     `SELECT count(*) FROM "MovimientoStock" m JOIN "Seccion" s ON s."id" = m."seccionId" JOIN "Operacion" o ON o."id" = m."operacionId" WHERE s."sucursalId" <> o."sucursalId";`
   - ejemplares de ticket de una sucursal distinta a la de la mesa de su cuenta:
     `SELECT count(*) FROM "EjemplarTicket" e JOIN "Cuenta" c ON c."id" = e."cuentaId" JOIN "Mesa" m ON m."id" = c."mesaId" WHERE e."sucursalId" <> m."sucursalId";`
   - rendimientos locales de una sucursal sobre el ingrediente de una receta PROPIA de otra:
     `SELECT count(*) FROM "RendimientoLocalIngrediente" r JOIN "RecetaIngrediente" i ON i."id" = r."recetaIngredienteId" JOIN "RecetaVersion" v ON v."id" = i."recetaVersionId" WHERE v."sucursalId" IS NOT NULL AND v."sucursalId" <> r."sucursalId";`
   - (auditoría, I-1) conteos físicos de una sección de otra sucursal:
     `SELECT count(*) FROM "ConteoFisico" c JOIN "Seccion" s ON s."id" = c."seccionId" WHERE s."sucursalId" <> c."sucursalId";`
   - secciones habituales de producto de otra sucursal:
     `SELECT count(*) FROM "SeccionHabitualProducto" h JOIN "Seccion" s ON s."id" = h."seccionId" WHERE s."sucursalId" <> h."sucursalId";`
   - opciones de un ítem agrupado de la carta de otra sucursal:
     `SELECT count(*) FROM "OpcionItemAgrupadoCarta" o JOIN "ItemAgrupadoCarta" i ON i."id" = o."itemAgrupadoCartaId" WHERE i."sucursalId" <> o."sucursalId";`
   Las seis tienen que dar 0. (Las relaciones OPCIONALES hacia otra sucursal devuelven null y es lo esperado: `StockMinimoProducto.seccion`, `Operacion.seccionDestino`, `TraspasoSucursal.seccionOrigen/Destino` (D7) y `generoCarta`.)
5. (auditoría, I-2) El rol `motor2_app` en Neon, como dueño (el control en tiempo de ejecución no ve la membresía en `neon_superuser` ni el TRUNCATE, que salta la RLS):
   - `SELECT r.rolname FROM pg_auth_members m JOIN pg_roles r ON r.oid = m.roleid JOIN pg_roles u ON u.oid = m.member WHERE u.rolname = 'motor2_app';` → **sin filas**.
   - `SELECT has_schema_privilege('motor2_app', 'public', 'CREATE');` → **false**.
   - `SELECT count(*) FROM information_schema.role_table_grants WHERE grantee = 'motor2_app' AND privilege_type = 'TRUNCATE';` → **0**.
   - `SELECT count(*) FROM "Sucursal" WHERE id !~ '^[A-Za-z0-9_-]+$';` → **0** (un id de sucursal con otra forma hace fallar la base de cualquiera que la tenga: falla cerrado, pero lo deja sin acceso).
   - `motor2_app` tiene que existir antes de `migrate deploy`: si no, el `CREATE POLICY` de B2 falla a mitad.
6. (auditoría, M-9) `CREATE POLICY` toma un bloqueo sobre cada tabla mientras corre: con una conexión colgada, `migrate deploy` espera. Aplicar sin tráfico y, si se puede, con `lock_timeout` corto en la conexión del dueño (falla en vez de esperar sin fin; las migraciones son idempotentes por sus `down.sql`/`IF EXISTS`).

### E8 (invitación por usuario)

Ya está aplicada en `stockhneuquen` (ver el estado medido arriba), así que **no entra en este despliegue**. Lo que sí hay que saber: el código de este PR que apaga `allowDangerousEmailAccountLinking` sale con la fusión a `main`; para ese código ya están las variables `AUTH_URL` y `CORREO_AVISOS_*`. Después de desplegar, «Invitar a vincular» a cada precargado que no haya entrado nunca con Google (sección «Invitación por usuario…» de este documento).

### Ensayo y aplicación (el mismo día, con un solo OK)

1. **Respaldo:** rama de Neon `respaldo-pre-paquete-1-AAAAMMDD` desde la rama por defecto (el plan gratuito guarda 6 horas de historia, por eso hace falta la rama).
2. **Ensayo completo en la rama `ensayo-paquete-1`** (desde la misma rama por defecto), con las cadenas de conexión en archivos fuera del repo y `node scripts/operaciones/con-env.mjs <archivo> -- …`: `migrate deploy` de las 8 del paquete (medir el tiempo y contar que aplicó exactamente 8), chequeos de solo lectura (128 políticas, las dos funciones y `has_function_privilege('motor2_app', …, 'EXECUTE')`, la tabla nueva sin UPDATE ni DELETE, la clave de M.2 con la cantidad esperada de permisos),
   escenario como `motor2_app` por el host `-pooler` (modo transacción: sin variables ve 0 filas; con alcance, solo las de su sucursal; un INSERT en una sucursal ajena da 42501), **subir / bajar / subir** (los `down.sql` en el orden de abajo, cada uno seguido de `prisma migrate resolve --rolled-back`), un humo con dos cuentas sintéticas y la práctica de la vuelta atrás total (restaurar desde el respaldo). Al terminar se borra la rama de ensayo.
3. **Aplicación a la rama por defecto:** `node scripts/operaciones/con-env.mjs .env.vercel.stockhneuquen -- npm run migrar:aprobar`, post-chequeos de solo lectura, **fusión del PR a `main`** (autorización aparte: la consola de plataforma despliega sola en `main`, y `motor2-demo` también; su build va a fallar en `migrate status` y conserva el deploy anterior) y `vercel deploy --prod` de `stockhneuquen` (el repo no despliega solo: `git.deploymentEnabled: false`).
4. **Ventana conocida:** entre la migración y la publicación (los minutos de un build) sigue publicado el código anterior al alcance, que fija solo `app.empresa_id`: las 32 tablas con política no devuelven filas y los INSERT dan 42501. No se pierde ni se corrompe ningún dato; sin usuarios es aceptable. Se avisa antes.
5. **Humo en Producción sin escribir nada:** `/login` y `/carta/<slug>` de una sucursal; logs de Vercel y Sentry por 15 a 30 minutos (errores `42501` y de `include` hacia filas que no se ven). La rama de respaldo se conserva unos 7 días.

### Reversa

El orden importa: **primero la base y después el código.** Volver a un código anterior al alcance con las políticas puestas es una **caída total** (falla cerrado); el código nuevo sobre la base vieja rompe M.2 y P3.

- **Solo políticas (B2 a B6):** el `down.sql` de cada grupo como dueño con `psql -1 -v ON_ERROR_STOP=1`, en orden inverso (B6, B5, B4, B3, B2) y después `prisma migrate resolve --rolled-back <migración>`. Con el código nuevo publicado, la app sigue andando (la RLS por empresa no se toca).
- **B1 (las funciones) va última** de las de alcance: una política en uso impide borrar la función. Recién ahí el control del rol de ejecución puede volver a `false` (revertir el commit de B1).
- **P3 y M.2 son DESTRUCTIVAS:** `down.sql` de P3 borra la tabla `AgregadoDeCuenta` (contar las filas antes); el de M.2 borra la clave `producto_campos_sensibles` y todo lo configurado sobre ella (guardar antes `SELECT * FROM "PermisoRol" WHERE "accionClave" = 'producto_campos_sensibles'`). Bajarlas exige volver atrás el código antes o a la vez.
- **Vuelta atrás total:** restaurar la rama por defecto desde `respaldo-pre-paquete-1-…`, Instant Rollback de Vercel al deploy anterior y revertir la fusión en `main`.
- Si una migración falla a mitad de `migrate deploy`: las anteriores quedan aplicadas, la fallida queda marcada (P3009 en el próximo deploy), las siguientes no corren, y el build falla en modo `verificar` sin publicar nada. Salida: su `down.sql` (seguro aunque haya quedado a medias, por los `IF EXISTS`), `migrate resolve --rolled-back` y corregir.

### Qué NO está medido (ADR-028)

El costo de las políticas con volumen (el riesgo está en las consultas de saldos e índices del Kardex; hoy hay 0 operaciones y 0 movimientos en `stockhneuquen`), el comportamiento contra el pooler de Neon en modo transacción, y las bases reales (nada se ensayó contra Neon). Las dos primeras se miden en el ensayo.

## Server Actions: clave de cifrado de los closures y versiones entre deploys

> O.3 de la lista de control (`docs/pureza-integracion.md`; Hito 4, bloque D, paso G1 de `docs/plan-hito-4-pureza.md` §4). Solo documentación: no se tocó
> ninguna variable de entorno ni configuración. Fuentes: la guía de Next empaquetada con la versión que usa el repo
> (`node_modules/next/dist/docs/01-app/02-guides/self-hosting.md`, «Server Functions encryption key» y «Version Skew»; `data-security.md`, «Overwriting
> encryption keys (advanced)»).

**Qué es.** Una Server Action declarada EN LÍNEA (un `"use server"` dentro de una función de un componente) que usa variables del render (un closure)
manda esas variables al navegador CIFRADAS y las recibe de vuelta al invocarse. Next genera la clave **por build**: la acción solo se puede invocar
contra el build que la renderizó. Hoy hay **78 `"use server"` en línea en 22 archivos de `src/app`** (contados con `grep` el 2026-10-08); el editor de
recetas (`catalogo/recetas/[productoId]/page.tsx` y `receta-de-la-sucursal.tsx`) depende de ellos, igual que las listas que activan o desactivan en el lugar.

**Dónde estamos.** El proyecto despliega **solo en Vercel** (`docs/p2109.md`: no se usa Render ni otro hosting). En Vercel la clave sale del build y
la comparten TODAS las instancias (funciones) de un mismo deployment: dentro de un deployment no hay «una instancia con otra clave», así que la sospecha
de la revisión #93 (punto 8) no aplica tal cual. **En Vercel no se define `NEXT_SERVER_ACTIONS_ENCRYPTION_KEY`**: no hace falta, y fijarla solo
agregaría un secreto que custodiar y rotar.

**El riesgo real: la diferencia de versiones entre deployments («version skew»).** Una pestaña abierta con el deployment N que, después del deploy N+1,
invoca una acción (un closure cifrado con la clave de N, o el id de una acción que en N+1 cambió o ya no existe) falla con **«Failed to find Server
Action»**: el usuario ve un error y tiene que recargar. Pasa en cada deploy con pestañas abiertas; el editor de recetas es el caso típico (se deja
abierto mucho tiempo). Lo que lo mitiga en Vercel es **Skew Protection**: mientras dura su ventana, Vercel manda los pedidos de una pestaña vieja al
deployment que la sirvió. No es configuración del repo: se prende o se apaga en el panel de cada proyecto (configuración avanzada; si está disponible y
cuánto dura la ventana depende del plan de la cuenta).

**Si algún día hubiera varias instancias autoalojadas** (contenedores detrás de un balanceador, cada una compilada por separado), ahí sí cada build
tendría su clave y lo cifrado por una instancia no se podría descifrar en otra. Se arregla fijando la clave **al compilar**
(`NEXT_SERVER_ACTIONS_ENCRYPTION_KEY` en el entorno del `next build`: queda embebida en el artefacto), con un valor **base64 de 16, 24 o 32 bytes** (Next
genera 32; por ejemplo `openssl rand -base64 32`) tratado como **secreto**. **Rotarla invalida las pestañas abiertas** (para esas acciones es lo mismo
que un deploy nuevo). Para las versiones entre deploys, además, un `deploymentId` en `next.config` hace que Next detecte la diferencia y navegue
completo en vez de fallar.

**Acción del dueño (fuera de la rama, sin tocar variables de entorno):** verificar en el panel de Vercel de cada proyecto —`motor2-demo`,
`stockhneuquen`, el de zuluhub y `plataforma-motor2` (la consola)— si **Skew Protection** está prendida y con qué ventana, y decidir si se prende donde
no lo esté.

- [ ] Skew Protection revisada en los 4 proyectos (anotar acá el estado de cada uno y la decisión).
