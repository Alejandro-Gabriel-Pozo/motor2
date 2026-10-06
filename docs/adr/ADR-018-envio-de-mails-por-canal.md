# ADR-018: Envío de mails: interfaz propia, dos canales, configuración por instalación

> Redactado el 2026-10-03 (paso E3 del plan de plataforma). **Estado: implementado; consumidores: el código de ingreso de la consola (E4) y las
> invitaciones de gerente (E5, ADR-020) y el aviso «tu empresa está activa» (E6, ADR-021): el mail sale después del commit y, si falla, se reenvía a mano**; falta el módulo de hoteles. Sin migración de base.

## Contexto

El plan de plataforma necesita mails para el código de ingreso, las invitaciones, los avisos de la app y el módulo de hoteles (solicitudes de pago).
Resend es el proveedor elegido, pero el código de negocio no debe conocerlo: en local no hay clave, en los tests no se debe mandar nada, y el cupo de
una cuenta de Resend (plan gratuito: 100 por día, 3.000 por mes) es por cuenta, así que un día de muchas solicitudes de hoteles no puede dejar sin
códigos de ingreso a la plataforma.

## Decisión

### 1. Una interfaz en el núcleo, tres implementaciones

`core/correo/` (infraestructura transversal): `EnviadorDeCorreo.enviar(mensaje)` devuelve siempre un `ResultadoDeEnvio` y **no lanza**.

- **Resend** (`resend.ts`): `POST https://api.resend.com/emails` con `fetch` (sin SDK, sin dependencia nueva), `Idempotency-Key` opcional y 15 s de límite.
- **Consola** (`locales.ts`): local y desarrollo. Muestra el mail en la terminal del servidor y no lo envía.
- **Memoria** (`locales.ts`): los tests. Guarda en `enviados` y puede simular un fallo (`fallarProximoEnvio`).
- Una cuarta, **sin configurar**, que no envía y devuelve un fallo `DEFINITIVO` explícito.

La elección (`crearEnviadorDelCanal`) es, en orden: `NODE_ENV=test` → memoria, aunque haya claves en el entorno (un test nunca manda un mail de verdad);
clave y remitente del canal → Resend; dentro de Vercel (`VERCEL`) sin configuración → sin configurar; local sin configuración → consola.
**La consola nunca se elige dentro de Vercel**: es la única implementación que escribe el contenido del mail (puede traer el código de ingreso; sin eso
nadie entraría en local sin clave) y los registros de Vercel no pueden llevarlo. Quien manda mails usa `enviarCorreo(canal, mensaje)`, que valida el
mensaje (destinatarios, asunto de una línea, tamaños) antes de intentar.

### 2. Dos canales con configuración separada

| Canal | Para qué | Variables |
|---|---|---|
| `avisos` | invitaciones, avisos de la app, códigos de la plataforma | `CORREO_AVISOS_RESEND_API_KEY`, `CORREO_AVISOS_REMITENTE` |
| `operativo` | mails del módulo de hoteles | `CORREO_OPERATIVO_RESEND_API_KEY`, `CORREO_OPERATIVO_REMITENTE` |

Van en las variables de entorno de **cada proyecto de Vercel** (por instalación), no en la base. Las cuatro están en el schema de `src/env.ts` y por eso
las cubre el test `variables-de-entorno-declaradas`. Son opcionales (sin ellas el canal no envía, ver arriba); el formato lo valida el schema
(`re_…`; remitente `ana@dominio` o `Nombre <ana@dominio>`) y, en el arranque estricto (Producción de Vercel o `MOTOR2_ENTORNO_ESTRICTO=1`),
`problemasDeConfiguracionDeCorreo` exige además que la clave y el remitente de un canal vayan juntos y que los dos canales **no compartan clave ni
dominio** (cada canal tiene su propia cuenta, su cupo y su dominio). Los errores nombran variables, nunca valores.

Más adelante se decidirá si alguna de las cuatro pasa a ser requerida en Producción (cuando E4/E5 dependan del canal de avisos); hoy exigirlas
rompería el arranque de las instalaciones que todavía no mandan mails.

### 3. Cuándo se envía y qué pasa si falla

- **Siempre después del commit, nunca dentro de la transacción**: una transacción serializable se reintenta entera y volvería a mandar el mail. Hoy lo
  garantiza la regla escrita en `enviarCorreo` y la revisión; el primer consumidor (E4/E5) debería sumar un test que lo compruebe en su acción.
- **Canal de avisos**: si el envío falla, la acción ya quedó hecha y se reenvía a mano (la invitación desde la plataforma; el código de ingreso,
  pidiendo otro). Sin cola.
- **Canal operativo**: el fallo trae un `motivo` para decidir el reintento: `CUPO` (429 `daily_quota_exceeded`/`monthly_quota_exceeded`: esperar al
  día siguiente), `TRANSITORIO` (otros 429, 408, 5xx, red, 409 `concurrent_idempotent_requests`: reintentar), `DEFINITIVO` (clave inválida, dominio sin
  verificar, destinatario inválido, 409 `invalid_idempotent_request`: corregir). La bandeja de salida con reintento programado (`email_log`, botón
  «reenviar», `Idempotency-Key` por lote) es parte de las solicitudes de pago (parte 3, punto 5 del plan), no de E3: acá solo queda la clasificación y
  el soporte de `claveDeIdempotencia`.
- Todo fallo se reporta a Sentry una vez por arranque y causa (`reportarErrorUnaVez`, área `correo`).

### 4. Nada sensible en logs ni en errores

`detalle` de un fallo contiene solo canal, estado HTTP y el `name` del error de Resend (validado como código en minúsculas; el `message` del proveedor
se descarta porque puede repetir destinatarios). Nunca el contenido, los destinatarios, los códigos ni las claves. Lo comprueban los tests de
`test/core/correo/`. La consola es la única excepción deliberada y solo existe fuera de Vercel.

## Consecuencias

- Cada instalación necesita crear su clave y verificar su dominio en Resend y cargar las variables en su proyecto de Vercel antes de que E4/E5 manden
  el primer mail (cuentas de Resend, dominios y claves: ver parte 2 del plan; son tareas del dueño).
- Sin las variables, en Vercel `enviarCorreo` devuelve `DEFINITIVO` «canal … sin configurar» en vez de simular que envió.
- Recibir mails (webhook de pagos de administración) no está acá: es parte del módulo de hoteles.
