# ADR-019: Consola de plataforma: ingreso en dos factores, sesión propia y auditoría

> Redactado el 2026-10-03 (paso E4 del plan de plataforma). **Estado: implementado en el código, sin aplicar a ninguna base remota**: las dos migraciones
> (`20261009120000_admin_de_plataforma`, `20261009130000_auditoria_de_plataforma`) se aplicaron solo a la base local; en cada base de Neon se aplican con
> autorización expresa, ensayo en una rama y respaldo previo. Concreta ADR-012 §2, §3, §4, §5 y §7; no cambia lo que ese ADR decidió.
> Actualización (2026-10-04): las migraciones ya están aplicadas en las bases de zuluhub y stockhneuquen (con respaldo y ensayo); la consola sigue sin desplegar. El alta
> de empresas (E5) está en ADR-020.

## Contexto

ADR-012 decidió quién es el administrador de plataforma y cómo debe ingresar, pero dejó abiertos los detalles que se fijan al construirlo: dónde vive el
código, qué se guarda, cuántos intentos se permiten y cómo se arma el primer administrador sin que nadie vea sus credenciales. Esta es la superficie más
sensible del producto (quien entra puede dar de alta empresas y asignar módulos), así que cada decisión va con su porqué.

## Decisión

### 1. Una aplicación aparte, en el mismo repositorio

La consola es la carpeta `plataforma/`, un workspace de npm (`@motor2/plataforma`, puerto 3200 en desarrollo) que usa el mismo schema de Prisma y el mismo
núcleo (`@/`), pero se compila y despliega como **otro proyecto de Vercel**, con su propio subdominio. No comparte rutas, cookies ni variables con la
aplicación de empresas. Las fronteras las cuida `npm run arquitectura`:

- la aplicación de empresas no importa nada de `plataforma/` (`app-sin-consola-de-plataforma`);
- la consola no importa lo interno de la aplicación (`consola-sin-lo-interno-de-la-app`);
- el código de ingreso (`src/core/plataforma/`) solo lo importa la consola; la única excepción es `email-reservado.ts`, que usa el alta de empresas
  (`core-plataforma-solo-desde-la-consola`).

### 2. Qué se guarda y cómo

| Dato | Cómo se guarda |
|---|---|
| Código de ingreso del mail (6 dígitos) | HMAC-SHA-256 con `PLATAFORMA_SECRETO_CODIGOS` y contexto `ingreso:<admin>:<código>`. Seis dígitos son pocos: sin el secreto del servidor, la base sola permitiría adivinarlos. |
| Secreto TOTP | AES-256-GCM con `PLATAFORMA_CLAVE_TOTP`, atado al id del administrador (un secreto copiado a la fila de otro no descifra). |
| Códigos de recuperación (10, `XXXXX-XXXXX`) | Solo su HMAC, contexto `recuperacion:<admin>`, sobre la forma canónica (mayúsculas, sin guiones). Se muestran una vez. |
| Token de sesión | 256 bits aleatorios; la base guarda solo su SHA-256. |

Nada de esto se escribe jamás en un registro, en una auditoría ni en un mensaje de error (los errores nombran variables, nunca valores).

### 3. Límites de ingreso

- El código del mail vence a los **10 minutos**, sirve **una vez**, se invalida al pedir otro y se agota a los **5 intentos** fallidos.
- Se pueden pedir como máximo **5 códigos por hora** por administrador.
- **5 fallos del segundo factor** bloquean al administrador **15 minutos**.
- El TOTP no se repite (se guarda el último paso aceptado) y acepta el paso anterior y el siguiente por desfase de reloj.
- El email desconocido ve **exactamente** la misma pantalla que uno conocido: la consola no revela quién es administrador. No se envía ningún mail a quien
  no lo es. (Se acepta que la diferencia de tiempo de respuesta entre ambos casos no está igualada.)
- Las comparaciones y los cambios de estado de los factores se hacen en transacción con el administrador bloqueado (`FOR UPDATE`): dos pedidos en paralelo
  no se reparten los intentos ni usan dos veces el mismo código.

### 4. Sesión propia en la base

La sesión nace al verificar el código del mail, **todavía sin valor** (`segundoFactorEn` vacío, vive 10 minutos) y vale recién al verificar el segundo
factor: una sesión del paso 1 no sirve para entrar. Una vez válida: máximo **8 horas** y **30 minutos de inactividad**. Se guarda en la base (no en un JWT)
para poder cerrarla de verdad: cerrar sesión la marca cerrada y el token deja de servir aunque alguien lo conserve.

La cookie es `__Host-plataforma.sesion` (con HTTPS) o `plataforma.sesion` (HTTP local): `httpOnly`, `SameSite=Strict`, `Path=/`, sin `Domain`. El nombre con
`__Host-` obliga al navegador a aceptarla solo con `Secure`, sin `Domain` y en la raíz. Es distinta de la de empresas.

### 5. Auditoría de plataforma

Tabla `AuditoriaPlataforma`: `adminId` y `adminEmail` como texto (sin clave foránea: el administrador vive en la base de identidad y la empresa afectada
en la suya), `accion`, `empresaAfectadaId` (a propósito **no** se llama `empresaId`: ese nombre dispara las reglas de aislamiento por empresa) y `detalle`.
Es append-only a nivel de motor (el trigger de `RegistroAuditoria` rechaza UPDATE, DELETE y TRUNCATE a todo rol que no sea el dueño). El rol de plataforma
solo puede leer e insertar. Desde E4 se anotan `ingreso`, `cierre-de-sesion`, `segundo-factor-fallido` y `bloqueo-por-fallos`, siempre con el
administrador como autor; los ingresos viven en la base de identidad (zuluhub). Las acciones sobre empresas se suman con E5 en adelante y, como dice
ADR-012 §5, se escriben en la base de la empresa afectada y en la transacción del cambio.

### 6. Rol de base de datos y variables de entorno

El rol `motor2_plataforma` se crea a mano, por rama de Neon, con `scripts/operaciones/crear-rol-motor2-plataforma.sql` (nunca desde la consola de Neon:
nacería con `BYPASSRLS`). Sobre las tablas de identidad tiene SELECT, INSERT y UPDATE, **sin DELETE**: un administrador se desactiva, una sesión se cierra,
un código se marca usado. Las tablas de identidad tienen RLS con una única política que solo deja pasar a ese rol (por nombre de rol); `motor2_app` no
tiene ningún permiso sobre ellas.

La consola lee tres variables, y solo la consola: `PLATAFORMA_DATABASE_URL` (tiene que conectar con el rol `motor2_plataforma`; **nunca cae en
`DATABASE_URL`**: si falta, no hay conexión), `PLATAFORMA_SECRETO_CODIGOS` (≥ 32 caracteres) y `PLATAFORMA_CLAVE_TOTP` (32 bytes en base64). Se validan al
primer uso, no al compilar, y los mensajes nombran la variable y el motivo, no el valor. Rotar `PLATAFORMA_CLAVE_TOTP` o `PLATAFORMA_SECRETO_CODIGOS`
invalida los factores ya enrolados: hay que volver a crear los administradores.

### 7. El primer administrador, y nunca gerente

`npm run plataforma:crear-admin -- --email … --nombre …` (`scripts/plataforma/crear-primer-admin.ts`) lo corre el dueño una vez, con un archivo
`DOTENV_CONFIG_PATH` **fuera del repositorio** que lleva las tres variables de arriba. Imprime una única vez el secreto TOTP (y su enlace `otpauth`) y los
códigos de recuperación; la base guarda solo el secreto cifrado y los hash. Se niega si el email ya es de un administrador **o de un usuario de una
empresa de CUALQUIERA de las instalaciones configuradas** (ADR-025: el administrador no entra a ninguna empresa, de ninguna instalación). Si una
instalación adicional no responde, el alta se aborta sin crear nada en vez de asumir que está libre.

La regla inversa vale en el alta de empresas: `crearEmpresa` rechaza como primer gerente el email de un administrador (comparado en minúsculas y sin
espacios) con `EmailReservadoError`, antes de crear nada. `scripts/crear-empresa.ts` lee los emails de `AdminPlataforma` con el rol de plataforma; sin esa
conexión el alta falla cerrada en vez de omitir el control. Las invitaciones de E5 tienen que aplicar el mismo rechazo al **enviarse**, no al aceptarse.

### 8. Tests

- Persistencia contra Postgres real: ingreso en dos factores, límites, concurrencia, auditoría y alta del primer administrador
  (`test/persistencia/ingreso-de-plataforma.test.ts`, `test/persistencia/primer-admin-de-plataforma.test.ts`).
- Arquitectura: las tres reglas de fronteras, el aislamiento del `package.json` de la consola y la política de variables
  (`test/arquitectura/consola-de-plataforma.test.ts`, `test/plataforma/entorno.test.ts`).
- Navegador real (`test/e2e/consola-plataforma.spec.ts`): ingreso completo, código y TOTP equivocados, recuperación de un solo uso, email desconocido,
  accesibilidad de cada paso y CSP. Corre solo donde existe el rol `motor2_plataforma` (en CI sí); se omite si `MOTOR2_E2E_PLATAFORMA_DATABASE_URL` no está.

## Alternativas descartadas

- **Verificar el TOTP o el código con una biblioteca de autenticación externa**: el flujo (dos pasos, sesión que no vale hasta el segundo, límites por
  administrador) no encaja en un proveedor genérico y agregaría una dependencia en la superficie más sensible. El TOTP es un módulo corto sobre `node:crypto`,
  probado con los vectores del RFC 6238.
- **Sesión en JWT sin estado**: no se puede cerrar de verdad ni invalidar al bloquear a un administrador.
- **Guardar el código del mail con un hash sin secreto**: con 10⁶ combinaciones, una base filtrada lo revelaría en milisegundos.
- **Compartir la cookie o el proyecto de Vercel con la aplicación de empresas**: rompe la separación que ADR-012 pide.

## Correcciones a otros ADR

Los ADR originales no se reescriben; ADR-012 lleva una línea de estado que apunta a este.

1. **ADR-012, estado.** Decía «Decidido, todavía sin implementar»: desde E4 el ingreso, la sesión, el rol y la auditoría del ingreso están implementados
   (sin aplicar a ninguna base remota); siguen sin implementar las acciones sobre empresas (E5 en adelante).
2. **ADR-012, §5.** Habla de una tabla de auditoría «en la base de la empresa afectada». Lo hecho en E4 (ingreso, cierre de sesión, fallos) no afecta a
   ninguna empresa y se anota en la base de identidad; la regla de la base de la empresa rige para las acciones sobre empresas.
3. **ADR-018.** El canal `avisos` tiene ahora su primer consumidor: el código de ingreso de la consola. Si el envío falla, el administrador pide otro
   código; no hay reenvío manual.

## Consecuencias

- El ingreso depende del canal de avisos (ADR-018): si el correo no sale, nadie entra. El código de recuperación reemplaza solo al TOTP (segundo
  factor), no al código del mail.
- Cada instalación necesita su rol `motor2_plataforma` y sus migraciones, y la identidad vive en una sola de ellas (zuluhub): en las demás las tablas
  quedan vacías.
- La consola nueva se suma al gate: `npm run plataforma:build` corre en CI, y el e2e levanta un segundo servidor.
- Sin segundo administrador, perder el TOTP y los códigos de recuperación deja la consola inaccesible: se crea otro con el script, como dueño de la base.
