# Caja y cobro, etapa C1b: estado «en cierre» de la sesión de caja (2026-11-16)

Continúa `docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md` y `...-escalera-2026-11-16.md` (C1). Regla de paridad con Pedernal (AGENTS.md, 2026-11-13). Estados de decisión: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA.

## Nivel 1 y 2: propósito, necesidad y quién la pidió

- **Necesidad (CONFIRMADA):** mientras se cuenta el efectivo para cerrar la caja, el sistema deja de aceptar cobros y movimientos de efectivo. Hoy (C1) el cierre es un solo paso (`cerrarSesion` con el conteo, todo o nada): si un cobro se coló mientras se contaba, el cierre falla entero porque la base recalcula lo esperado.
- **Pedido del dueño (2026-11-16, literal):** pregunta «mientras se cuenta el efectivo para cerrar la caja, ¿el sistema deja de aceptar cobros (como Pedernal, estado «en cierre») o alcanza con el aviso y recontar?»; respuesta: «Frenar el cobro, como Pedernal (Recomendada)». Fuente: pregunta y respuesta del orquestador al dueño del 2026-11-16 (la cita la trae el pedido de esta etapa; el registro de decisiones del dueño es el lugar donde queda asentada).
- **Alcance de esta etapa:** estado `EN_CIERRE` en la base (columnas, reglas, disparadores) y los casos de uso que lo mueven y lo respetan. Sin pantallas, sin Server Actions, sin permisos nuevos (los declara el PR de permisos con la clave `caja_cerrar_sesion`).
- **Actores:** quien cierra la caja (permiso `caja_cerrar_sesion`, el mismo que ya cierra), quien cobra y quien mueve efectivo (ven `CAJA_EN_CIERRE`).

## Auditoría breve contra Pedernal (versión leída: checkout local de `zuluhub-erp`; NO VERIFICADO contra `origin/main` vigente: el worktree no permitió `git fetch` del checkout compartido)

Leído: `migraciones/0027_caja.sql` (estado, `sesion_caja_validar_cambio`, `cierre_iniciado_en/por`, `movimiento_caja_validar_alta`), `src/modulos/caja/casos-de-uso/{iniciar-cierre,cancelar-cierre}.ts`, `dominio/sesion.ts`, `estados.ts`, la especificación E3 (sesión y cierre, cobrar contra cerrar).

| Punto | Pedernal | Motor2 C1b | Estado |
|---|---|---|---|
| Estados | `ABIERTA`, `EN_CIERRE`, `CERRADA` (CHECK) | igual | IGUAL |
| Iniciar cierre | ABIERTA → EN_CIERRE; ya en cierre → `yaEstabaEnCierre: true` sin escribir ni auditar; cerrada → `SESION_CERRADA` | igual (`iniciarCierreDeSesion`) | IGUAL |
| Cancelar cierre | EN_CIERRE → ABIERTA sin marcas; ya abierta → `yaEstabaAbierta: true`; cerrada → `SESION_CERRADA` | igual (`cancelarCierreDeSesion`) | IGUAL |
| Marcas del cierre | `cierre_iniciado_en/por`; el CHECK exige que estén si y solo si no es ABIERTA | `cierreIniciadoEn/PorId`; ABIERTA sin marcas, EN_CIERRE con ellas | IGUAL (en la CERRADA se permiten nulas: las cerradas en un solo paso de C1 no las tienen) |
| Cobro en cierre | `CAJA_EN_CIERRE { cajaId, sesionId }`; sin sesión → `SIN_SESION_ABIERTA` | `CAJA_EN_CIERRE { sesionId }`; sin sesión sin cerrar → `SIN_SESION_ABIERTA` | DIFIERE (no lleva `cajaId`: C1 tiene una sola caja por sucursal) |
| Movimiento manual y anulación en cierre | `SESION_EN_CIERRE` | `CAJA_EN_CIERRE` | DIFIERE: el pedido de esta etapa fija `CAJA_EN_CIERRE` para los tres; mismo resultado (se rechaza sin escribir), distinto código. PREGUNTA ABIERTA Q1 |
| Cerrar | se puede cerrar directo desde ABIERTA o desde EN_CIERRE | solo desde EN_CIERRE (`SESION_NO_EN_CIERRE` desde ABIERTA) | DIFIERE por decisión del pedido de la etapa («cerrar se hace desde EN_CIERRE»); la base rechaza ABIERTA → CERRADA |
| Volver atrás desde «Contar» | no cancela el cierre (DEC-0455): la caja sigue en cierre hasta cancelar o cerrar | igual: no hay evento de «volver atrás» en el servidor; solo `cancelarCierreDeSesion` reabre | IGUAL (la pantalla llega con el PR de pantallas) |
| Quién inicia | el disparador exige que sea la persona del contexto | el caso de uso sella `actor.usuarioId`; la base no lo compara con una variable de sesión | DIFIERE: Motor2 no tiene `app_persona_id()`; mismo resultado porque la persona sale del contexto firmado |
| Jornada (`jornadaVencida`, EN_AUDITORIA) | existe | NO existe: llega con C2 | NO ES DE ESTA ETAPA |
| Bloqueo cobrar contra iniciar cierre | `FOR SHARE` en el alta del movimiento; el cierre es un `UPDATE` que espera a los cobros en vuelo | igual: `SesionCaja_exigir_abierta` ya hace `FOR SHARE`; iniciar es un `UPDATE` | IGUAL |

## Nivel 3: casos de uso

CU-iniciar: `iniciarCierreDeSesion`. CU-cancelar: `cancelarCierreDeSesion`. CU-cerrar: `cerrarSesionCasoDeUso` (ahora desde EN_CIERRE). Los que respetan el estado: `cobrarCuentaCasoDeUso`, `registrarMovimientoManualCasoDeUso`, `anularMovimientoCasoDeUso`. `abrirSesionCasoDeUso`: con una sesión EN_CIERRE responde `CAJA_YA_ABIERTA { sesionId }` (la sesión sin cerrar de la caja, abierta o en cierre).

## Nivel 4: ciclo de vida

```
ABIERTA --iniciar--> EN_CIERRE --cerrar con conteo--> CERRADA
   ^                     |
   +-----cancelar--------+
```

Solo esas tres transiciones. ABIERTA → CERRADA directo y quedarse en el mismo estado son inválidas; CERRADA no se toca. Plata (cobros, ingresos, egresos, anulaciones) entra SOLO con ABIERTA; el conteo (arqueo y billetes) entra SOLO con EN_CIERRE.

## Nivel 5: invariantes y políticas (las decide la base)

- `SesionCaja_estado_chk`: ABIERTA | EN_CIERRE | CERRADA.
- `SesionCaja_marcas_chk`: ABIERTA sin marcas ni observación; EN_CIERRE con `cierreIniciadoEn/PorId` y sin cierre ni observación; CERRADA con `cerradaEn/PorId` y el cierre iniciado completo o ausente.
- `SesionCaja_validar` (disparador): transiciones permitidas; CERRADA inmutable; al cerrar no cambia quién ni cuándo inició el cierre.
- `SesionCaja_una_sin_cerrar_por_caja_key` (índice único parcial `WHERE estado <> 'CERRADA'`) ya cubre EN_CIERRE: con la sesión contándose no se abre otra (verificado en `test/caja/reglas-de-la-base-de-caja-c1b.test.ts`).
- `SesionCaja_exigir_abierta` (sin cambios): `MovimientoCaja_validar` y `Cobranza_validar` la llaman, así que con EN_CIERRE rechazan solos.
- `SesionCaja_exigir_en_cierre` (nueva): `Arqueo_validar` la llama para el arqueo y los billetes.
- `SesionCaja_verificar_cierre` (sin cambios): al confirmar, recalcula lo esperado y exige que el arqueo cuadre. Defensa final.
- Privilegio: `UPDATE` por columna sobre `cierreIniciadoEn` y `cierreIniciadoPorId`; la app sigue sin DELETE.
- Dato derivado, no guardado: la diferencia del arqueo se calcula, nadie la escribe (igual que C1).

## Nivel 6: historia y persistencia

Migración aditiva y reversible `20261117119000_caja_c1b_en_cierre` (columnas nulas, dos CHECK, una función nueva, dos reemplazadas). Nada se borra: el inicio y la cancelación del cierre quedan en el registro de auditoría (`cierre_iniciado`, `cierre_cancelado`), y al cerrar queda quién y cuándo inició. Al cancelar el cierre, las dos columnas vuelven a nulo (el rastro es la auditoría, que no se borra).

**Funciones de base que reemplaza (para fusionar con C2/C3 al integrar):** `SesionCaja_validar()` y `Arqueo_validar()` (ambas `CREATE OR REPLACE`, cuerpos de C1); agrega `SesionCaja_exigir_en_cierre(text, uuid, text)`. NO toca `SesionCaja_exigir_abierta`, `MovimientoCaja_validar`, `Cobranza_validar`, `Cobro_validar`, `Cobranza_cuadra` ni `SesionCaja_verificar_cierre`.

## Nivel 7: atomicidad y concurrencia

- Cada caso de uso es una transacción SERIALIZABLE con reintento (`conTransaccionSerializable`).
- **Cobro contra iniciar cierre:** el cobro lee la sesión con `FOR SHARE` dentro del disparador; iniciar el cierre es un `UPDATE` de la sesión: espera al cobro en vuelo (o uno de los dos falla con 40001 y se reintenta). El cobro que llega después ve EN_CIERRE y devuelve `CAJA_EN_CIERRE` sin escribir. Resultado garantizado: todo cobro confirmado está en lo esperado del arqueo.
- **Doble clic en iniciar o en cancelar:** idempotente por estado; la transacción serializable arbitra y el reintento ve el estado nuevo (`yaEstabaEnCierre` / `yaEstabaAbierta`).
- **Cerrar dos veces a la vez:** una cierra, las otras ven CERRADA y devuelven `yaEstabaCerrada` si el conteo es el mismo.

## Tabla «¿qué pasa si…?» por comando

| | iniciarCierre | cancelarCierre | cerrarSesion | cobrar / mover efectivo / anular | abrir |
|---|---|---|---|---|---|
| **Repetición** (mismo comando dos veces) | la segunda: `yaEstabaEnCierre`, sin escribir ni auditar | la segunda: `yaEstabaAbierta`, sin escribir ni auditar | la segunda con el mismo conteo: `yaEstabaCerrada`; con otro conteo: `SESION_CERRADA` | por clave (como C1): `yaExistia` | por clave (como C1) |
| **Concurrencia** | ocho a la vez: una inicia, las demás `yaEstabaEnCierre`; una sola auditoría. Con cobros en vuelo: espera, y todo cobro confirmado entra al conteo | ocho a la vez: una cancela, una sola auditoría | ocho a la vez: una cierra, un solo arqueo (el cierre toma `FOR UPDATE` de la sesión para ordenar a los contendientes en vez de pelearse por el bloqueo compartido de los disparadores) | contra iniciar cierre: o entra antes y se cuenta, o `CAJA_EN_CIERRE`; nunca queda plata fuera del cierre | con la sesión en cierre: `CAJA_YA_ABIERTA`; dos aperturas a la vez dejan una sola (índice único) |
| **Tiempo** | sella `cierreIniciadoEn` con el reloj inyectado; cancelar y volver a iniciar sella de nuevo | no usa reloj | `cerradaEn` con el reloj inyectado; la sesión no vence sola (la jornada llega con C2) | día de negocio sellado al abrir (como C1) | como C1 |
| **Incertidumbre** (no sé si llegó) | reintentar es seguro: idempotente por estado | ídem | reintentar con el mismo conteo es seguro; si el cierre llegó, `yaEstabaCerrada` | por clave de reintento | por clave de reintento |
| **Reintento tras fallo** | nada que deshacer | nada que deshacer | un conteo inválido o un «conforme» faltante deja la sesión EN_CIERRE sin arqueo escrito: se reintenta con el conteo correcto | ante `CAJA_EN_CIERRE` hay que cancelar el cierre y reintentar | — |
| **Error parcial** | todo o nada (una transacción) | todo o nada | arqueo, billetes, cierre y auditoría en una transacción; el disparador diferido hace fallar el COMMIT si no cuadra | todo o nada | todo o nada |
| **Datos faltantes** | sin sesión o de otra sucursal: `SESION_NO_ENCONTRADA`, no escribe | ídem | ídem | sin caja o sin sesión sin cerrar: `SIN_SESION_ABIERTA` (cobrar) / `SESION_NO_ENCONTRADA` (mover) | — |
| **Cambio de permisos** | lo pide la Server Action (PR de permisos, clave `caja_cerrar_sesion`); el caso de uso recibe al actor ya autorizado | ídem | ídem | permisos propios de cada comando, sin cambios | sin cambios |

Cobrar con la sesión cerrada y ninguna abierta: `SIN_SESION_ABIERTA` (no hay a dónde cobrar). Cobrar con una sesión EN_CIERRE: `CAJA_EN_CIERRE { sesionId }`.

## Nivel 10: pruebas

**Dimensiones que cambian dinero:** el estado de la sesión (3) y el comando (9). **No afectan en esta etapa (declarado):** el actor, la sucursal y el medio de pago. Un guardián (`GUARDIÁN` de `test/caja/en-cierre-c1b.test.ts`) falla si aparece un estado en el CHECK, un comando en el oráculo o un caso de uso en `src/server/actions/caja/casos-de-uso/` sin declarar.

**Oráculo** (escrito aparte del código, `test/caja/oraculo-de-estados-de-sesion.ts`; el test recorre las 27 celdas contra Postgres real):

| comando \ estado | ABIERTA | EN_CIERRE | CERRADA |
|---|---|---|---|
| iniciarCierre | OK, pasa a EN_CIERRE | OK `yaEstabaEnCierre`, no escribe | `SESION_CERRADA` |
| cancelarCierre | OK `yaEstabaAbierta`, no escribe | OK, vuelve a ABIERTA | `SESION_CERRADA` |
| cerrarSesion (mismo conteo) | `SESION_NO_EN_CIERRE` | OK, CERRADA | OK `yaEstabaCerrada` |
| cerrarSesion (otro conteo) | `SESION_NO_EN_CIERRE` | OK con diferencia (dos auditorías) | `SESION_CERRADA` |
| cobrar | OK | `CAJA_EN_CIERRE` | `SIN_SESION_ABIERTA` |
| ingreso / egreso manual | OK | `CAJA_EN_CIERRE` | `SESION_CERRADA` |
| anular movimiento | OK | `CAJA_EN_CIERRE` | `SESION_CERRADA` |
| abrir | `CAJA_YA_ABIERTA` | `CAJA_YA_ABIERTA` | OK, sesión nueva |

Otras pruebas: concurrencia con `Promise.allSettled` (iniciar, cancelar, cerrar y cobros contra iniciar el cierre), reglas de la base directo con SQL crudo como `motor2_app` (transiciones prohibidas, marcas, movimiento/cobro/arqueo con el estado equivocado, cierre que falla al COMMIT si no cuadra, el inicio del cierre que espera un movimiento en vuelo), subir/bajar/subir de la migración (`test/aislamiento/caja-c1b-subir-bajar-subir.test.ts`), y el núcleo puro contra el mismo oráculo.

## Diferencia declarada con C1: «C1 cerraba en un paso»

C1 cerraba la caja en un solo paso (`cerrarSesionCasoDeUso` con el conteo sobre una sesión ABIERTA). C1b lo reemplaza por dos pasos (iniciar el cierre y después cerrar con el conteo): `cerrarSesionCasoDeUso` sobre una sesión ABIERTA ahora devuelve `SESION_NO_EN_CIERRE`. Motivo: la decisión del dueño del 2026-11-16 («Frenar el cobro, como Pedernal»). Compatibilidad: ninguna pantalla ni Server Action de cierre existe todavía (el PR de acciones llega aparte, con `caja_cerrar_sesion` para iniciar, cancelar y cerrar), así que no hay un cliente que se rompa; las filas cerradas en un solo paso por C1 siguen siendo válidas (cierre iniciado nulo).

## Nivel 10: migración y operación

Aditiva y reversible. `verificacion-previa.sql` (solo lectura) antes de aplicar; `down.sql` aborta si hay sesiones EN_CIERRE (hay que cancelar o terminar el cierre antes). Aplicar en bases reales sigue congelado (solo al desplegar, con autorización expresa).

## Preguntas abiertas para el dueño

- **Q1 (código):** ¿el rechazo de un ingreso, egreso o anulación con la caja en cierre se llama `CAJA_EN_CIERRE` (como pidió esta etapa) o `SESION_EN_CIERRE` (como Pedernal)? Mismo resultado; solo cambia el nombre interno que traduce la pantalla.
- **Q2 (texto):** los textos que ve el cliente («La caja está en cierre: se está contando el efectivo.», «Para cerrar la caja primero hay que iniciar el cierre.», «Cierre de caja iniciado», «Cierre de caja cancelado») son del caso de uso y NO están aprobados: Pedernal también los tiene como pendientes (Q6). Se aprueban al armar la pantalla.
