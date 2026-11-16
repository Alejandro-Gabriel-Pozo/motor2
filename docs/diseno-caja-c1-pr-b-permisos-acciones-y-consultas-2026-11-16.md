# Caja y cobro, etapa C1, PR-B: permisos, guards, Server Actions y consultas (2026-11-16)

Lo que falta para poder USAR desde la aplicación la etapa C1 de caja (núcleo, 8 tablas y 5 casos de uso del PR-A), SIN pantallas (las hace el Frente 6). Diseño base: `docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md` y `...-escalera-2026-11-16.md`.

Estado de cada decisión: CONFIRMADA = dicha por el dueño; PROPUESTA = criterio del orquestador o de quien implementó, a confirmar con el dueño; PENDIENTE = falta decidir.

## 1. Necesidad que resuelve

Quién la pidió y dónde está escrita: el dueño pidió la caja y el cobro aparte de cerrar la cuenta («Cobro aparte primero», 2026-11-16; ver el diseño base). Este PR no suma funciones: solo pone permisos, validación de formato, la capa fina de acciones y las lecturas que el diseño base ya nombra (CU3 a CU7 y la consulta de cuentas sin cobrar). Los pisos y la semilla de los permisos son un criterio del orquestador (PROPUESTA, ver §2).

## 2. Permisos (oráculo de la matriz rol × acción, escrito aparte del código)

Seis claves, todas de SUCURSAL (la caja es de la sucursal) y todas con la semilla en solo el rol `admin` («todo nace cerrado», 2026-11-11): nadie más las tiene hasta que el gerente las delega en la matriz. El PISO es quién puede llegar a tenerlas.

| Clave | Qué permite | Piso (quién puede llegar a tenerla) | Semilla | Solo ver |
| --- | --- | --- | --- | --- |
| `caja_ver` | Ver el estado de la caja, la sesión, los movimientos y las cuentas sin cobrar | operario | admin | sí |
| `caja_abrir_sesion` | Abrir la caja con su fondo inicial | operario | admin | no |
| `cobrar_cuenta` | Cobrar una cuenta cerrada | operario | admin | no |
| `caja_cerrar_sesion` | Cerrar la caja con el arqueo | administrador | admin | no |
| `caja_mover_efectivo` | Ingreso o egreso manual de efectivo y anular los propios | administrador | admin | no |
| `caja_anular_movimiento_ajeno` | Anular un movimiento hecho por otra persona | administrador | admin | no |

Matriz resultante por rol (lo que el gate decide; el piso manda sobre la fila de la matriz, así que un rol propio o el operador NO llegan a las de piso administrador aunque alguien les prenda la fila):

| Acción de la pantalla | Gerente | Administrador (rol `admin`) | Operador o rol propio con la fila |
| --- | --- | --- | --- |
| Ver la caja, las cuentas sin cobrar y la última sesión cerrada (`caja_ver`) | sí | sí | sí, si el gerente se la delega |
| Abrir la caja (`caja_abrir_sesion`) | sí | sí | sí, si se la delega |
| Cobrar una cuenta (`cobrar_cuenta`) | sí | sí | sí, si se la delega |
| Ingreso o egreso manual, anular lo propio (`caja_mover_efectivo`) | sí | sí | NO (el piso es administrador) |
| Cerrar la caja (`caja_cerrar_sesion`) | sí | sí | NO |
| Anular un movimiento ajeno (`caja_anular_movimiento_ajeno`) | sí | sí | NO |

Criterio del orquestador (PROPUESTA): gerente y administrador en todo lo de la caja; el operador solo puede llegar a ver, abrir y cobrar. El «gerente» recibe todo por jerarquía (el piso administrador lo alcanza); no necesita fila. Módulo: las seis quedan provisoriamente en `salon` (el cobro es de las cuentas del salón); el catálogo de módulos es del Frente 4 y todavía no tiene `caja`: cuando exista se cambia solo el campo `modulo` de las seis en `ACCIONES`. PENDIENTE: confirmar con el dueño los pisos y que el operador pueda abrir la caja.

Migración de datos `prisma/migrations/20261117118000_permisos_caja_c1/` (aditiva, idempotente, con `down.sql` que aborta si hay configuración a mano y `verificacion-previa.sql`): da de alta las seis claves y las siembra al rol `admin` de cada empresa. Requiere autorización expresa para aplicarse en cada base real.

## 3. Guards de formato (`src/core/features/caja/caja.guard.ts`)

Por LISTA DE PERMITIDOS, puros, antes de tocar la base. Rechazan con códigos estables (`ENTRADA_INVALIDA`, `CLAVE_INVALIDA`, `IDENTIFICADOR_INVALIDO`, `IMPORTE_INVALIDO`, `SENTIDO_INVALIDO`, `MOTIVO_INVALIDO`, `OBSERVACION_INVALIDA`, `RENGLONES_INVALIDOS`, `CONTEO_INVALIDO`, `CONFORME_INVALIDO`) y un `campo` (por ejemplo `renglones.2.importe`); el mensaje lo pone la pantalla.

- Clave de reintento, sesión, movimiento y medio de pago: UUID. La cuenta: el id de `Cuenta` (letras, dígitos, `_` y `-`, hasta 64).
- Importes: TEXTO decimal exacto (`1234.56`: sin signo, sin coma, sin separador de miles, sin ceros a la izquierda, a lo sumo 2 decimales, menor que el tope de la columna), nunca `number`. `centavosDeTexto` los pasa a centavos enteros sin float. Mayor que cero, salvo el fondo y las monedas, que admiten 0.
- Motivo y observación: una línea de 1 a 500 caracteres con la regla de texto del proyecto (`textoDeUnaLineaDesdeTexto`, con signos de catálogo, al menos una letra).
- Conteo: solo las 10 denominaciones de la planilla, cantidades enteras de 0 a 99999; monedas como texto decimal.
- Cobro: hasta 50 renglones (más, se rechaza sin recorrerlos); la lista vacía y que la suma no dé el total los juzga el caso de uso con su código (`COBRO_SIN_RENGLONES`, `COBRO_NO_CUADRA`).

## 4. Server Actions (`src/server/actions/caja/caja.ts`)

Adaptadores finos: permiso (primera línea, `conPermiso`) → guard → caso de uso con `azarDelProceso` → `aResultadoAccion` más lo que la pantalla necesita (código del fallo, `campo`, ids, `yaExistia`, `superaElEfectivo`, y los importes en centavos como TEXTO).

| Acción | Clave | Caso de uso |
| --- | --- | --- |
| `abrirSesionDeCaja` | `caja_abrir_sesion` | `abrirSesionCasoDeUso` |
| `registrarMovimientoDeCaja` | `caja_mover_efectivo` | `registrarMovimientoManualCasoDeUso` |
| `anularMovimientoDeCaja` | `caja_mover_efectivo` (y `caja_anular_movimiento_ajeno` para lo ajeno) | `anularMovimientoCasoDeUso` |
| `cerrarSesionDeCaja` | `caja_cerrar_sesion` | `cerrarSesionCasoDeUso` |
| `cobrarCuenta` | `cobrar_cuenta` | `cobrarCuentaCasoDeUso` |

`anularMovimientoDeCaja` decide `puedeAnularAjenos` con el MISMO gate (`requierePermiso` sobre `caja_anular_movimiento_ajeno`), no con una copia de la regla.

## 5. Lecturas (`src/server/actions/caja/lecturas-de-caja.ts` y `src/server/lecturas/caja/`)

Cada lectura pide `caja_ver` en la sucursal ACTIVA como primera línea y llama a su lectura con la sucursal y la empresa del contexto (nada que mande el navegador). Las lecturas filtran por sucursal además de la RLS. Importes en CENTAVOS como texto; la pantalla los formatea. Viven en `server/lecturas/` (la capa de las lecturas compartidas) y no en `server/consultas/` porque las usa una Server Action y `server/actions/` no importa de `consultas`; la pantalla las pide con esas acciones (como `buscarFichasDeParte`).

- `leerEstadoDeCaja`: sesión abierta (id, día de negocio, quién la abrió y cuándo), efectivo esperado, esperado por medio y movimientos (con marca de anulado).
- `leerCuentasSinCobrar(cursor?)`: cuentas cerradas con venta y SIN cobranza (se DERIVA, no hay marca), con mesa, cerrada en y total (el de `cargarCuentaParaCobrar`), de a 30 con cursor. `total-de-cuenta.ts` pasó de `server/persistencia/caja/` a `server/lecturas/caja/` (lectura compartida entre el caso de uso y las lecturas de la caja: una lectura no puede importar de la persistencia).
- `leerCobranzasDeSesion(sesionId)`: cobranzas con sus renglones y medios, sin datos personales (ni cliente ni nombre de quien cobró).
- `ultimaSesionDeLaCaja`: la última sesión CERRADA de la caja de la sucursal con su arqueo por medio (esperado, contado, «conforme», diferencia = contado − esperado calculada acá, con signo), billetes por denominación y monedas, o `null` si nunca se cerró; es el resumen de la pantalla «Caja» cerrada (pedido del orquestador, como Pedernal `ultima-sesion-de-la-caja.ts`). Permiso `caja_ver`.
- `leerMediosDeCobro`: medios de pago activos de la empresa.

## 6. Tabla «¿qué pasa si…?» de permisos y concurrencia

| Situación | Qué pasa | Quién lo garantiza |
| --- | --- | --- |
| Se le quita el permiso a mitad (ya había cobrado) y reintenta con la MISMA clave | Rechaza por permiso, no devuelve `yaExistia` ni toca la base: el permiso se mira ANTES que la clave de reintento | `conPermiso` (primera línea) |
| Se le quita antes del primer intento, y se le devuelve | El primero rechaza; el mismo pedido después pasa (el permiso se lee en cada llamada, no se cachea) | `requierePermiso` |
| Un operador con las seis filas prendidas intenta cerrar la caja, mover efectivo o anular | Rechaza: el PISO administrador manda sobre la fila | `decidirEnSucursal` |
| Se le desactiva la membresía con la pestaña abierta | No hay contexto: la acción lleva al login (o la lectura lanza) | `obtenerContextoUsuario` |
| Pierde `caja_anular_movimiento_ajeno` pero conserva `caja_mover_efectivo` | Anula lo propio; lo ajeno devuelve `SIN_PERMISO_SOBRE_MOVIMIENTO_AJENO` | caso de uso con `puedeAnularAjenos` |
| Una sucursal opera con ids de otra (sesión, cuenta, movimiento) | No se encuentra (`SESION_NO_ENCONTRADA`, `CUENTA_NO_ENCONTRADA`, `MOVIMIENTO_NO_ENCONTRADO`) y la base no cambia | RLS por sucursal + el chequeo de sucursal del caso de uso |
| Una lectura con id de sesión que no es UUID | Devuelve vacío | lectura |
| Mismo pedido dos veces (doble clic) | La segunda devuelve `yaExistia` sin escribir ni auditar | clave de reintento del caso de uso |
| Pedido mal formado con permiso | Rechazo de guard con código y `campo`, sin tocar la base | `caja.guard.ts` |
| Pedido mal formado SIN permiso | Dice que falta el permiso (el permiso va antes que el formato) | orden de las capas |
| Un importe llega como `number` o con coma o con 3 decimales | `IMPORTE_INVALIDO` | `centavosDeTexto` |

## 7. Pruebas (nivel 10)

- `test/caja/caja-guard.test.ts`: los guards y la conversión de texto a centavos (casos límite, sin float).
- `test/caja/caja-acciones.test.ts`: contra Postgres real y la sesión simulada: permiso exacto de cada acción (con todas MENOS la que exige, sin ninguna y con la exacta), operador cobra pero no cierra, una sucursal no ve la caja de otra, cambio de permisos a mitad, lecturas con `caja_ver`.
- `test/permisos/migracion-permisos-caja-c1.test.ts`: la migración de datos y su `down.sql`.
- Los goldens y las matrices de permisos (clases de claves, matriz esperada, piso de gobierno, caracterizaciones, módulos) cuentan las seis claves nuevas.

Dimensiones que cambian permisos (regla «Combinaciones»): rol × acción, declaradas en la matriz de §2 y en `test/permisos/matriz-esperada.ts`; el guardián de clases de claves falla si aparece una clave sin declarar.

## 8. Fuera de este PR (preguntas abiertas)

- PENDIENTE: confirmar con el dueño los pisos de §2 (operador: ver, abrir y cobrar) y el módulo definitivo de las seis claves (hoy `salon`, provisorio hasta que el Frente 4 agregue `caja`).
- PENDIENTE: «cuentas cobradas del día» (varias sesiones de un mismo día): C1 las lista por sesión; el día entero es de la etapa C2 (jornada).
- Textos visibles: siguen literales en los casos de uso y las acciones; la lista completa para el catálogo T1 está en el informe del PR.
