# ADR-022: Sin empresa por defecto: `app_empresa_actual()` solo lee el contexto del pedido

> Redactado el 2026-10-04. **Estado: el código y las pruebas están listos; la migración `app_empresa_actual_sin_respaldo` está pendiente de aplicar** (primero local y base de E2E,
> después cada base de Neon, con autorización expresa, respaldo y ensayo). Reemplaza la decisión D1 = V1 de ADR-007 («empresa del contexto o, sin contexto, la única empresa activa»).

## Contexto

ADR-007 dejó la instalación multiempresa «activada con una»: la función SQL `app_empresa_actual()` devolvía la empresa fijada por la transacción (`app.empresa_id`) o, si el
pedido no traía ninguna, **la única empresa `ACTIVE`** (con dos o más devolvía NULL y fallaba cerrado). Ese respaldo permitió activar el modelo sin tocar el seed, los scripts ni
los cientos de pruebas que escribían sin indicar empresa. Pero deja una trampa: la primera vez que se confirma una segunda empresa activa (E6), todo lo que dependía del respaldo
deja de andar.

Verificado antes de este cambio: **el código de la aplicación (`src/`) ya no usaba el respaldo**. Cada pedido arma su contexto (`dbDeEmpresa`, `transaccionDeEmpresa`,
`baseDeEmpresa`) a partir de la sesión, la cookie de empresa y las pertenencias del usuario; no hace falta ningún ruteo por URL (la carta pública ya se rutea por slug). Dependían
del respaldo: las pruebas, el seed, las herramientas de demo, el alta automática del primer admin y la tolerancia al rol privilegiado.

## Decisión

### 1. La función solo lee el contexto

`app_empresa_actual()` pasa a devolver únicamente `NULLIF(current_setting('app.empresa_id', true), '')`. Sin contexto es NULL: el `DEFAULT` de `empresaId` (53 tablas) hace fallar el
alta por `NOT NULL` y las políticas `aislamiento_empresa` (56 tablas) no muestran nada. Se mantienen el nombre, la firma y la volatilidad, así que ni los `DEFAULT` ni las políticas
cambian. La migración es una sola sentencia (`CREATE OR REPLACE FUNCTION`) y su `down.sql` devuelve el cuerpo anterior. **No es aditiva**: el código desplegado antes de este cambio ya
no depende del respaldo, pero un despliegue anterior a `dbDeUsuario` (commit `8f22f96`) sí lo necesitaba para el login; el Instant Rollback es seguro hacia cualquier despliegue posterior.

### 2. Las pruebas indican la empresa en la conexión, no en la base

Los clientes de FIXTURES (`prisma` y `prismaAdmin` de `test/setup/`, el `prisma` de `test/e2e/fixtures/db.ts`) abren la conexión con `app.empresa_id` fijado como parámetro de
arranque (`-c app.empresa_id=empresa_principal`). `src/` sigue usando el cliente sin empresa (`src/lib/db`) y corre con la semántica de producción; los tests que prueban la ausencia de
contexto usan `prismaSinEmpresa`. **No se guarda nada en la base** (nada de `ALTER ROLE … SET`): sería una puerta trasera copiable a producción. `test/arquitectura/sin-empresa-por-defecto.test.ts`
impide que el preset exista fuera de `test/setup/empresa-de-prueba.ts`, que algo fije el contexto de sesión o lo guarde en la base, y que el cliente global toque tablas por empresa.

Las bases de prueba tienen además una **empresa testigo** permanente (`empresa_testigo`, `ACTIVE` y vacía). Con dos activas el respaldo viejo ya no devolvía nada: por eso toda la
suite corrió, **antes de la migración**, como va a correr sin respaldo, y cualquier fixture que olvide indicar la empresa falla enseguida.

### 3. Se retira el bootstrap por email

`BOOTSTRAP_ADMIN_EMAILS`, `intentarBootstrapAdmin` y la primera vía del gate de login se eliminan: solo actuaban con exactamente una empresa activa y su función la cumple la invitación del
primer gerente (ADR-020). En una instalación local, `npm run db:seed -- --gerente tu@email.com` deja al primer gerente. Un email que figuraba en esa variable ya no entra sin membresía ni invitación.

### 4. El rol de ejecución es estricto siempre

`verificarRolDeEjecucion` se niega a operar con un rol que salta el RLS (superusuario, `BYPASSRLS` o dueño de las tablas) **siempre**, no solo con más de una empresa.
`MOTOR2_ROL_ESTRICTO=0` es el escape explícito para herramientas de demo que corren como dueño sobre una base descartable: no cuenta nada y avisa a Sentry. Además, una conexión que trae
`app.empresa_id`, `app.usuario_id` o `app.invitacion_hash` ya fijados se niega **sin escape**: dejaría a todos los pedidos en una misma empresa.

**Enmienda 2026-10-06 (Pureza 0.4, hallazgo H1 de la auditoría de pureza):** el escape `MOTOR2_ROL_ESTRICTO=0` **no existe en Producción de Vercel** (`VERCEL_ENV=production`). El arranque se niega
si está puesto (`escapesProhibidosEnProduccion`, `src/env.ts`) y, aunque llegara a estarlo, `permitirRolPrivilegiado` (`src/core/auth/rol-de-ejecucion.ts`) lo ignora: una variable mal puesta no puede apagar
el aislamiento entre empresas. Vale solo fuera de Producción (herramientas de demo, local, Preview).

### 5. Seed y herramientas

`prisma/seed.ts` recibe `--empresa <slug>` (por defecto la empresa `empresa_principal`) y escribe con `dbDeEmpresa`; las herramientas de demo y benchmark usan `scripts/demo-seed/cliente.ts`
(`EMPRESA_ID`). Las herramientas que corren como dueño sobre la base de la demo ya no necesitan nada más, pero si pasan por la app deben llevar `MOTOR2_ROL_ESTRICTO=0`.

### 6. Un defecto latente que apareció al revisar

`invitacionDelToken` leía la invitación sin `where`, confiando solo en el RLS: con el respaldo y una única empresa activa con invitaciones, un token bien formado pero inexistente podía
devolver la fila de otra empresa. Ahora busca por el hash del token (con una prueba que lo demuestra).

## Alternativas descartadas

- **Un GUC por instalación con la «empresa por defecto»** (la V2 que ADR-007 ya descartó): con varias empresas, una escritura sin contexto caería en la empresa por defecto, o sea una fuga entre empresas.
- **Respaldo apagable con `ALTER DATABASE … SET`:** dos semánticas que probar, deriva entre bases y conexiones del pool que tardan en tomarlo.
- **`ALTER ROLE motor2_app SET app.empresa_id` en las bases de prueba:** queda escondido en la base, `motor2_dev` es también la base de desarrollo, y es justo la puerta trasera que alguien podría copiar a Neon.
- **Que el `prisma` de prueba sea `dbDeEmpresa(...)`:** rompe en silencio las transacciones interactivas (cada operación correría fuera de la transacción).
- **Reescribir los ~300 archivos de prueba:** inviable y sin ganancia.

## Correcciones a otros ADR

1. **ADR-007:** D1 = V1 queda reemplazada por este ADR. Dejan de ser ciertos: «el seed, los crons, los scripts y los tests funcionan sin tocar nada» (hoy indican la empresa), la tolerancia
   del rol privilegiado «con UNA empresa» y el bootstrap del primer admin. Lleva una línea de estado que apunta acá.
2. **ADR-021 (Consecuencias):** confirmar la segunda empresa activa ya no cambia nada de lo que dependía del respaldo; las verificaciones del runbook pasan a ser prerrequisitos del despliegue de este ADR.
3. **ADR-012 §6:** la invitación es también la única vía del primer gerente (se retiró el bootstrap por email).

## Consecuencias

- Una instalación puede tener cualquier cantidad de empresas activas sin que nada cambie de comportamiento; confirmar la segunda deja de ser un evento.
- **Antes de desplegar este cambio**, el dueño verifica en producción (solo lectura): que `DATABASE_URL` conecta con `motor2_app` (no con el dueño), que `BOOTSTRAP_ADMIN_EMAILS` no hace falta, que
  el despliegue actual es posterior a `dbDeUsuario` y que no hay `MOTOR2_MIGRAR_EN_BUILD`. Si producción corriera con el dueño, la app dejaría de arrancar (es el objetivo, y por eso se avisa antes).
- Una base nueva sigue naciendo con `empresa_principal`, pero deja de ser especial: la plataforma la puede suspender como a cualquier otra.
- Después de aplicar la migración, escribir en una tabla por empresa sin contexto es siempre un error (`NOT NULL`), y leer sin contexto no devuelve nada.

## Implementación

Núcleo: `src/core/auth/rol-de-ejecucion.ts`, `src/core/auth/invitacion.ts`. Pruebas: `test/setup/empresa-de-prueba.ts`, `test/aislamiento/cliente-de-prueba.test.ts`,
`test/arquitectura/sin-empresa-por-defecto.test.ts`, `test/auth/db-de-empresa.test.ts`, `test/auth/invitacion-gate.test.ts`, `test/e2e/fixtures/db.ts`.
