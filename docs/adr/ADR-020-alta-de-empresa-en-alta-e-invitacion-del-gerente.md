# ADR-020: Alta de empresa en `PROVISIONING` e invitación del primer gerente

> Redactado el 2026-10-04 (paso E5 del plan de plataforma). **Estado: implementado en el código; la migración `20261010120000_invitaciones` se aplicó solo a
> la base local y a la de E2E**: en cada base de Neon se aplica con autorización expresa, ensayo en una rama y respaldo previo. Concreta ADR-012 §6 y corrige
> dos puntos de ADR-012 y ADR-017 (ver «Correcciones a otros ADR»). No cambia nada de lo decidido sobre el ingreso de la consola (ADR-019).

## Contexto

ADR-012 §6 decidió que una empresa nace sin usuarios y que su primer gerente entra por una invitación. El plan del dueño (2026-10-03) precisó cómo:
la plataforma da de alta la empresa **sin CUIT ni módulos** y en estado `PROVISIONING`; el invitado entra con Google con el **mismo email invitado**, **carga el
CUIT** y queda como gerente; la empresa sigue en alta hasta que la plataforma confirme ese CUIT (E6). Hasta hoy el alta era un script que creaba la empresa
ya `ACTIVE`, con el gerente precargado por email (`crearEmpresa`, ADR-007 A7).

## Decisión

### 1. El alta la hace la consola, en una transacción, y deja rastro

`plataforma/src/servidor/empresas.ts` (`darDeAltaEmpresa`) escribe, en **una** transacción: la empresa en `PROVISIONING`, su siembra (roles `admin` y `operador`
con su matriz, unidades base, motivos de merma, destinos de consumo y la primera sucursal: la misma función que usa `crearEmpresa`, `sembrarEmpresa`), la
invitación del gerente y la fila de `AuditoriaPlataforma` con el administrador como autor (ADR-012 §5). **No** se crean usuarios, ni módulos (los activa la
plataforma, E7), ni CUIT. Reenviar, revocar e invitar de nuevo siguen el mismo patrón: el cambio y su auditoría, juntos.

El mail sale **después** de que la transacción se confirmó, nunca adentro, por el canal `avisos` (ADR-018). Si el envío falla, la acción queda hecha, la lista
muestra la invitación «sin enviar» y se reenvía a mano. Un test comprueba el orden desde otra conexión.

### 2. Tabla `Invitacion`

Empresa, email (en minúsculas), rol de empresa (hoy solo `gerente`, con un `CHECK`), **hash del token** (nunca el token), estado, vencimiento, cuándo se envió,
y, al aceptar, quién, cuándo y el CUIT declarado.

- **Estados guardados:** `PENDIENTE`, `ACEPTADA`, `REVOCADA`. **«Vencida» no se guarda**: es una pendiente cuyo `venceEn` ya pasó (una sola fuente de verdad, sin cron).
- **Vida:** 7 días desde que se crea o se reenvía.
- **Índices únicos parciales:** una sola pendiente por (empresa, email) y una sola pendiente de gerente por empresa.
- **RLS, tres políticas:** `aislamiento_empresa` (la de siempre), `lectura_por_token` (la app, que todavía no tiene empresa, lee UNA fila si conoce el hash, con
  `app.invitacion_hash` local a la transacción, mismo mecanismo que `app.usuario_id`) y `escritura_plataforma` (por nombre de rol).
- **Privilegios:** `motor2_app` solo lee y actualiza **cuatro columnas** (`estado`, `aceptadaEn`, `aceptadaPorId`, `cuitDeclarado`); no inserta ni borra.
  `motor2_plataforma` inserta y actualiza, sin `DELETE`.
- **Trigger** con la máquina de estados por rol: la plataforma solo crea `PENDIENTE` y, desde `PENDIENTE`, reenvía (rota el token) o revoca; cualquier otro rol
  solo puede pasar `PENDIENTE → ACEPTADA` tocando únicamente lo de la aceptación. No mira el reloj: el vencimiento lo controla el código con su `ahora`.

### 3. Token y enlace

32 bytes aleatorios en base64url; la base guarda el SHA-256. Nunca se compara un token en JavaScript: se valida la forma, se hashea y se busca por igualdad sobre un
índice único. **Un solo uso**, garantizado por un `UPDATE` condicional (`estado = PENDIENTE` y no vencida) dentro de la transacción de aceptación: dos
aceptaciones simultáneas no pueden ganar las dos. **Reenviar rota el token**: el enlace anterior deja de servir.

El token viaja en el **fragmento** del enlace (`/invitacion#t=…`): no llega a los logs del servidor, a Sentry ni al `Referer`, y abrir el enlace (un escáner de mails
lo hace) no gasta la invitación. Un componente del cliente lo pasa a una acción que lo guarda en una cookie `httpOnly`, `SameSite=Lax` (con `Strict` no viajaría en el
regreso desde Google), de una hora como máximo, con prefijo `__Host-` en https.

### 4. Aceptar

`aceptarInvitacion` corre en una transacción serializable bajo la empresa de la invitación y **sin efectos externos** (puede reintentarse). Exige: invitación
`PENDIENTE` y no vencida, empresa en `PROVISIONING`, **mismo email** que la sesión, CUIT válido (E2) que ninguna empresa tenga ya, y que la empresa no tenga gerente. Marca la
invitación `ACEPTADA` con el CUIT declarado, incorpora al invitado como gerente y admin de la primera sucursal (`incorporarPrimerGerente`, bajo las invariantes de
gobierno de ADR-008) y deja la auditoría de la empresa con el nuevo gerente como actor. **La empresa no cambia de estado.**

### 5. El CUIT declarado queda en la invitación, no en `Empresa`

La app de empresas (`motor2_app`) no escribe `Empresa` a propósito (ADR-012 §3). Escribir ahí el CUIT del gerente exigiría devolverle ese permiso o abrir una función con
privilegios elevados, y un CUIT mal cargado ocuparía el único (`Empresa_cuit_key`) de una empresa real. Por eso queda en `Invitacion.cuitDeclarado` y **E6 lo copia a
`Empresa.cuit`** al confirmar (ADR-021: la invitación conserva lo declarado); ahí el índice único decide si dos empresas declararon el mismo.

### 6. Cuarta vía del login

`emailPuedeIniciarSesion` suma una vía: la cuenta de Google es la del email invitado y trae una invitación pendiente, no vencida, de una empresa en alta. Solo deja llegar
a la pantalla de aceptación. El kill-switch (`User.activoGlobal`) sigue primero y la regla de la sesión abierta de otro email no cambia. **No se toca
`allowDangerousEmailAccountLinking`**: eso es E8.

### 7. Quién no puede ser gerente

El email de un administrador de plataforma se rechaza al dar de alta, al reenviar y al invitar de nuevo (ADR-012 §1); el alta de un administrador se niega si su email
tiene una invitación pendiente. Un email con la cuenta desactivada en toda la plataforma también se rechaza al invitar.

### 8. Estado «empresa en alta» y salida de la invitación equivocada

Quien aceptó y todavía no tiene empresa activa ve en `/login` que su empresa está en alta y que la plataforma le avisa (estado `EMPRESA_EN_ALTA`). Si el email se
escribió mal, «Invitar de nuevo» revoca la pendiente y crea otra en una transacción.

### 9. El script de alta se retira

el script `crear-empresa` y su comando `npm run crear-empresa` se eliminan por decisión del dueño (2026-10-04): el alta pasa a ser la consola. `crearEmpresa` queda en
el núcleo solo como fixture de pruebas (alta directa `ACTIVE`).

## Alternativas descartadas

- **El CUIT directo en `Empresa.cuit`:** ver §5.
- **El token en la ruta o en la query:** quedaría en logs y en el `Referer`; abrir el enlace tendría que gastar la invitación o ser idempotente.
- **«Vencida» como estado guardado:** exige un cron o escribir al leer; el cálculo con `venceEn` no tiene desfasaje.
- **Sembrar la empresa recién al aceptar:** deja la aceptación grande y con el rol de la app escribiendo la siembra; la consola ya tiene los permisos y el alta queda atómica y auditada.
- **Mostrar el enlace al administrador si el mail falla:** el canal sigue siendo solo el mail; se reenvía.

## Correcciones a otros ADR

1. **ADR-012 §6:** dice que la empresa nace «vacía (solo núcleo)» y que la plataforma fija el CUIT. Nace con **Administración sembrada**, sin módulos vendibles, y el CUIT lo
   **declara el gerente al aceptar** y lo confirma la plataforma (E6).
2. **ADR-017 §1:** dice que las empresas en alta no se mencionan. Desde E5 `/login` explica que la empresa está en alta (`EMPRESA_EN_ALTA`).
3. **ADR-019 §7** (el email de un administrador no es gerente): cumplido también al invitar, reenviar e invitar de nuevo.

## Consecuencias

- Una migración aditiva más, por base y con autorización (el Instant Rollback sigue siendo seguro). `down.sql` pierde las invitaciones pendientes y los CUIT declarados.
- La consola maneja la instalación a la que apunta su conexión (hoy zuluhub); sumar la de hoteles es una variable por instalación (ADR-012 §4), todavía sin implementar.
- Las altas abandonadas dejan nombre y slug ocupados; cancelarlas o darlas de baja queda para una etapa posterior (ver ADR-021, que corrige la atribución a E6).
- El login de producción gana una vía (cambio autorizado por el dueño); la vinculación automática por email sigue encendida hasta E8.

## Implementación

Núcleo: `src/core/features/empresa/invitacion.ts`, `aceptar-invitacion.ts`, `sembrar-empresa.ts`, `src/core/auth/invitacion.ts`, `src/core/seguridad/tokens.ts`. Consola:
`plataforma/src/servidor/empresas.ts` y `plataforma/src/app/empresas/`. App: `src/app/invitacion/page.tsx` y `src/server/actions/auth/invitacion.ts`. Migración:
`prisma/migrations/20261010120000_invitaciones` (con `down.sql`). Pruebas: `test/aislamiento/invitaciones-rls.test.ts`, `test/persistencia/aceptar-invitacion.test.ts`,
`test/persistencia/alta-de-empresa.test.ts`, `test/auth/invitacion-gate.test.ts`, `test/e2e/invitacion-aceptar.spec.ts`, `test/e2e/consola-alta-de-empresa.spec.ts`.

**Nota (Hito 3 de la pureza, B3, 2026-10-08): dónde vive hoy.** Sin cambio de comportamiento (lo fija `test/auth/caracterizacion/huella-de-aceptacion.test.ts`). Aceptar la invitación del
primer gerente es un caso de uso, `src/server/actions/auth/casos-de-uso/aceptar-invitacion-de-gerente.ts` (`permiso=SIN_PERMISO`: la autoridad es el token y el email de la cuenta de Google;
lista cerrada `CASOS_SIN_PERMISO`), y su escritura de la invitación está en `src/server/persistencia/invitaciones/marcar-invitacion-aceptada.ts`. La lectura por token y la base de la
empresa de la invitación están en `src/server/sesion/invitacion.ts` (`invitacionDelToken` e `invitacionConSuBase`, la única puerta de un token a esa base, que verifica antes el rol de
ejecución: `test/arquitectura/invitacion-verifica-el-rol.test.ts`). En `src/core/features/empresa/aceptar-invitacion.ts` y `src/core/auth/invitacion.ts` queda solo lo puro.
