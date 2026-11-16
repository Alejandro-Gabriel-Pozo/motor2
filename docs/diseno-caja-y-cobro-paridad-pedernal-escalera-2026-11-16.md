# Caja y cobro, paridad con Pedernal — 2. Escalera de diseño (2026-11-16)

Estado: **diseño en papel. Sin código, sin migraciones.** Niveles 1 a 5 con el estado de cada decisión; niveles 6 a 10 **solo esbozo marcado PROPUESTA, no se migra hasta que el dueño confirme los niveles 1 a 5** (compuerta de `AGENTS.md`). Auditoría en `docs/diseno-caja-y-cobro-paridad-pedernal-auditoria-2026-11-16.md`; etapas, carril, dependencias y preguntas en `docs/diseno-caja-y-cobro-paridad-pedernal-2026-11-16.md`.

Estados: **CONFIRMADA** (dicha por el dueño, con cita literal y fecha) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**. Lo que Pedernal ya tiene **no es por sí solo un pedido del dueño de Motor2**; solo el pedido de abajo habilita el frente.

## Citas del dueño que usa este diseño

| Id | Fecha | Texto literal | Fuente | Qué fija |
|---|---|---|---|---|
| Q-1 | 2026-11-16 | «… En realidad a nosotros nos falta caja, que tiene que ver con el cobro. …» | `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja» | Pedido de este frente: caja y cobro |
| Q-2 | 2026-11-13 | «Necesitamos ser iguales [a Pedernal] en todo. … no es que hay que copiar código, pero sí tiene que ser idéntico… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» | `AGENTS.md`, «Paridad con Pedernal» | Mismo resultado y misma forma; toda diferencia con motivo |
| Q-3 | 2026-11-14 | «Como Pedernal: con caja, sesión y jornada (Recomendada)» (a «Cobrar un ticket (N3)») | mismo archivo de decisiones, «CUIT del cliente, cobro y registro…» | **CONFIRMADA en dirección:** cobrar con caja, sesión y jornada; la caja se construye antes. «No autoriza migración ni construcción» |
| Q-4 | 2026-11-15 | «Sí, copiar a Pedernal en esas cinco (Recomendada)» | mismo archivo; `docs/diseno-factura-externa-n1-n2-2026-11-15.md` F-9 | Lo nuevo nace con uuid, `timestamptz` y solo inserción |
| Q-5 | 2026-11-04 | La planilla de **caja chica** en papel con billetes de 10, 20, 50, 100, 200, 500, 1.000, 2.000, 10.000 y 20.000, un conteo por turno, «corrector» sobre una fila (resumen en `docs/diseno-caja-y-cobros-2026-11-04.md` §0.1 punto 10; no hay cita literal en este documento) | `docs/diseno-caja-y-cobros-2026-11-04.md` | Práctica actual confirmada; **las denominaciones difieren de Pedernal** (Q-DENOM) |
| Q-6 | 2026-11-15 | «Solo lo que tiene ticket (salón y cuentas) (Recomendada)» (conciliación con la factura externa) | mismo archivo de decisiones, «Mostrador en la conciliación…» | El mostrador sin cuenta queda fuera de la conciliación; **no** dice nada sobre cobrar en mostrador |

No hay en el repo cita del dueño de Motor2 sobre: cantidad de cajas, vuelto, propina, datos del cobro, hora de corte ni cobrar-y-cerrar en un gesto. Esas decisiones son de Pedernal (9 a 15/11) y acá van como **PROPUESTA «igual a Pedernal»**, no como confirmadas.

---

## Nivel 1. Propósito y alcance

- **Propósito:** que cada sucursal pueda **registrar lo que cobra** (por medio de pago), **saber qué cuentas cerradas faltan cobrar**, **abrir y cerrar la caja** contando el efectivo y **cerrar el día** sabiendo si lo registrado cuadra con lo contado. PROPUESTA (derivada de Q-1 y Q-3).
- **Necesidad:** Q-1 (pedido de este frente) y Q-3 (dirección: caja, sesión y jornada). Quién: el dueño; dónde: arriba.
- **Entra (por etapa, ver resumen):** medios de pago, caja, sesión con fondo inicial, movimientos manuales de efectivo, cobro de una cuenta cerrada con `Σ cobros = total`, arqueo y cierre de sesión, jornada y cierre del día. PROPUESTA.
- **No entra (queda afuera, con nombre):** facturación electrónica y comprobante fiscal (frente propio/futuro; Q-ARCA), factura externa de venta (diseño `docs/diseno-factura-externa-n1-n2-2026-11-15.md`), cuenta corriente, seña, folio de reservas, caja grande y depósitos (Pedernal no los tiene; Q-CC), cobro en partes (Pedernal lo decidió y no lo construyó), propina (Pedernal decidió que no existe), «obligatorio» por dato del medio (no construido en Pedernal), integración con terminales o pasarelas (el sistema **registra** cobros que ocurrieron afuera; Pedernal lo dice igual, CYN 152). PROPUESTA.
- **Primero lo más barato:** ver etapa C1 del resumen: una caja por sucursal que nace sola, el medio Efectivo, sesión con fondo, cobro con un solo medio o varios que sumen el total, sin datos del cobro, sin cuentas de cobro, cierre contando el efectivo y declarando el resto «conforme». El resto, etapas con nombre.

## Nivel 2. Actores y contexto

| Actor | Qué hace | Estado |
|---|---|---|
| Operador/cajero | Abre y cierra su sesión, cobra, mueve efectivo (ingreso/egreso con motivo), anula lo suyo | PROPUESTA (igual a Pedernal: los tres roles) |
| Administrador | Además: edita medios y cuentas de cobro, ajusta, anula movimientos de otros | PROPUESTA |
| Gerente/dueño | Además: crea y desactiva cajas | PROPUESTA |
| Mozo | Toma pedidos; **no** cobra salvo que su rol tenga la acción | PROPUESTA (hoy el POS ya dice «sin … cobrar») |
| Plataforma | Habilita el módulo `caja` y la perilla de cantidad de cajas (Frente 4) | PROPUESTA |
| Sistema externo de facturación | No se integra (decisión del 04/11, vigente) | CONFIRMADA (`docs/diseno-caja-y-cobros-2026-11-04.md` punto 1) |

Contexto: multiempresa con RLS por empresa y por sucursal; la **sucursal** es la unidad; la sesión de caja pertenece a una caja de una sucursal; moneda única **ARS** (`MONEDA_FIJA`, poda del 2026-11-06); zona `America/Argentina/Buenos_Aires` (UTC-3, sin horario de verano) tomada de `Empresa.zonaHoraria`. Los roles de Motor2 son editables por empresa (Roles P1, otra corriente): los permisos nuevos nacen **cerrados** para todos salvo `admin` (patrón de `rolesEditarSemilla`), y quien edite roles los reparte.

## Nivel 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Configurar medios de pago de la empresa (lista cerrada de 6 tipos; efectivo fijo) | C1 | PROPUESTA |
| CU2 | Caja de la sucursal (nace sola, «Caja 1»); crear/desactivar más con perilla | C1 (una) / C4 (varias) | PROPUESTA |
| CU3 | Abrir sesión de caja con fondo inicial (puede ser $0) | C1 | PROPUESTA |
| CU4 | Ingreso y egreso manual de efectivo con motivo; anular un movimiento con motivo | C1 | PROPUESTA |
| CU5 | Cobrar una cuenta cerrada con uno o varios medios (`Σ = total`) | C1 | PROPUESTA |
| CU6 | Ver cuentas cerradas sin cobrar y cobradas | C1 | PROPUESTA |
| CU7 | Cerrar sesión: contar el efectivo por billetes, declarar el resto o dar «conforme general»; cerrar con diferencia permitido y auditado | C1 | PROPUESTA |
| CU8 | Cierre del día: empezar el cierre, corregir el medio de un cobro, declarar totales, reconocer controles, cerrar | C2 | PROPUESTA |
| CU9 | Datos opcionales del cobro (cupón, últimos 4, marca, cuotas, DNI) según el medio | C3 | PROPUESTA |
| CU10 | Cuentas de cobro (terminal, QR, cuenta bancaria) | C3 | PROPUESTA |
| CU11 | Mostrador: vender y cobrar en un gesto | C5, depende de Q1 | PENDIENTE |
| CU12 | Vuelto (cálculo en pantalla, solo efectivo) | C1 (pantalla, Frente 6) | PROPUESTA |
| CU13 | Ajuste a una jornada cerrada desde el día en curso | C2 | PROPUESTA |
| CU14 | Cobro en partes, propina, seña, cuenta corriente, caja grande, devolución de dinero | — | NO ENTRA (ver nivel 1) |

## Nivel 4. Conceptos y ciclo de vida

- **Caja:** lugar de cobro de una sucursal. Se desactiva, no se borra; no se desactiva con sesión sin cerrar. PROPUESTA (igual a Pedernal).
- **Medio de pago:** 6 tipos cerrados (`EFECTIVO`, `TARJETA_DEBITO`, `TARJETA_CREDITO`, `TRANSFERENCIA`, `QR`, `OTRO`); la empresa los habilita y los nombra; **el tipo es inmutable**; el efectivo es único y no se desactiva. PROPUESTA. *Diferencia con Motor2 hoy:* la lista de medios de pago de **proveedores** (`TRANSFERENCIA, EFECTIVO, CHEQUE, TARJETA, OTRO`) es otro libro y **no se toca**. Se evalúa en el nivel 8 si la compra en efectivo usa la caja (Frente 5).
- **Sesión de caja:** `ABIERTA` → `EN_CIERRE` → `CERRADA` (una cerrada no se reabre); a lo sumo una sin cerrar por caja; sella `fecha_de_negocio`, hora de corte y zona al abrir. PROPUESTA.
- **Movimiento de caja:** solo se agrega; clases `FONDO_INICIAL`, `COBRO`, `INGRESO_MANUAL`, `EGRESO_MANUAL`, `AJUSTE`, `ANULACION`; la anulación es el espejo con motivo y se hace una sola vez. PROPUESTA.
- **Cobro:** un registro por (cuenta, orden) con medio e importe; `Σ cobros de la cuenta = total de la cuenta` al centavo. «Cobrada» se **deriva** (existe la cobranza); no hay estado que se actualice. PROPUESTA (difiere en forma de Pedernal; motivo: Motor2 no tiene `ticket` con total/estado, ver auditoría §D.1).
- **Total cobrable de una cuenta:** el mismo que sumó `cerrarCuenta` (Σ `importeDeLinea` del precio cobrado, con el descuento congelado de la cuenta). **Hoy no se guarda en ningún lado** (`Venta` no se escribe): hay que **congelarlo en el cobro** (la cobranza guarda `total`), o escribir `Venta`. **PENDIENTE:** cuál de las dos; se decide en nivel 6 con el dueño solo si cambia dinero visible. Ver Q-TOTAL.
- **Arqueo:** por medio, esperado vs contado/declarado; la diferencia se **calcula**, nadie la escribe; el efectivo se cuenta por billetes + monedas. PROPUESTA (igual a Pedernal; denominaciones: Q-DENOM).
- **Diferencia de caja:** contado − esperado; cerrar con diferencia **se permite y se audita**, nadie la aprueba (igual a Pedernal 09/11; PROPUESTA en Motor2). Un egreso mayor al efectivo esperado **no bloquea**: avisa y audita.
- **Jornada de sucursal:** `ABIERTA` → `EN_AUDITORIA` («En cierre») → `CERRADA` (inmutable). Nace con la primera actividad del día; **no se cierra sola** al llegar el corte; una sesión abierta pasada la hora de corte **sigue cobrando en su jornada** y avisa. Un error en una jornada cerrada se corrige con un `AJUSTE` del día en curso que la nombra. PROPUESTA (igual a Pedernal).
- **Fecha de negocio** = fecha civil del instante en la zona de la empresa **menos la hora de corte** de la sucursal (por defecto 00:00). Se calcula una vez al abrir la sesión y se sella. PROPUESTA.

## Nivel 5. Invariantes y políticas

| Id | Invariante / política | Estado |
|---|---|---|
| I-1 | **Todo nace cerrado:** módulo `caja` apagado, permisos de caja solo para `admin`, medios habilitados solo el efectivo, ningún dato del cobro pedido, ninguna cuenta de cobro; nada se habilita sin declararlo y dejar rastro | PROPUESTA (regla del dueño 2026-11-11, vigente) |
| I-2 | Ni caja, ni sesión, ni movimiento, ni cobro, ni arqueo, ni jornada se borran ni se editan el dinero: se anula con un registro nuevo | PROPUESTA (regla del sistema; patrón `PagoDeFacturaProveedor`) |
| I-3 | Dinero siempre `Decimal` exacto en la base y `decimal.js`/centavos en código; moneda `ARS` explícita; tope por movimiento; **nunca `number` flotante** ni aritmética con `+` | PROPUESTA |
| I-4 | `Σ importe de los cobros de una cuenta = total` al centavo, verificado **en la base** (disparador diferido o restricción) y en el caso de uso | PROPUESTA (igual a Pedernal) |
| I-5 | Una sola sesión sin cerrar por caja (índice único parcial); un solo `FONDO_INICIAL` por sesión | PROPUESTA |
| I-6 | Cobrar exige sesión `ABIERTA` de la caja de la sucursal **y** jornada `ABIERTA` (jornada en cierre no cobra); mientras la sesión está `EN_CIERRE` no se cobra | PROPUESTA (igual a Pedernal; `CAJA_EN_CIERRE`, `JORNADA_EN_AUDITORIA`) |
| I-7 | Una cuenta se cobra **una sola vez** (único por cuenta); repetir el pedido con la misma clave devuelve lo hecho; con otro contenido, `CLAVE_REUTILIZADA` | PROPUESTA |
| I-8 | El movimiento hereda la fecha de negocio de su sesión; la jornada nunca se cierra sola | PROPUESTA |
| I-9 | Un cobro **no se anula desde caja**; un error de medio se corrige con `corregirMedio` (no cambia el original) y un error de monto vía anulación de la cuenta (R-ANU) | PROPUESTA (igual a Pedernal) |
| I-10 | Una jornada `CERRADA` es inmutable; el cierre es todo o nada y guarda la foto de los controles | PROPUESTA |
| I-11 | El efectivo recibido y el vuelto **no se guardan**; a caja va el neto | PROPUESTA (igual a Pedernal) |
| I-12 | Aislamiento: toda tabla nueva con `empresaId` (`app_empresa_actual()`) y RLS; las de sucursal con RLS por sucursal; el servidor valida alcance; el frontend no manda `empresaId` ni `sucursalId` | PROPUESTA |
| I-13 | Auditoría en la misma transacción de cada comando, sin valores de datos personales (solo la lista de campos completados) | PROPUESTA |
| I-14 | **R-ANU:** corregir o anular una cuenta ya cobrada **no puede cambiar su total en silencio**: anular todo deja la diferencia a explicar en el cierre del día (como `anularTicket` de Pedernal: no escribe en caja); corregir líneas de una cuenta cobrada se **bloquea** hasta decidir (pregunta Q-ANU) | PENDIENTE |
| I-15 | Validación por lista de permitidos (regla 2026-11-12): nombres de caja y medio con conjunto, largo y forma; cupón, DNI, últimos 4 con forma; nunca «lista de prohibidos» | PROPUESTA |
| I-16 | Fechas: DD/MM/AAAA en pantalla; internamente `timestamptz`/instantes y día de negocio `AAAA-MM-DD`; formateador existente `fechaParaMostrar` | PROPUESTA (decisión del dueño de Pedernal 15/11, vigente en Motor2 por `core/tiempo`) |

---

## Niveles 6 a 10 (esbozo; **no se migra** hasta confirmar 1 a 5)

### Nivel 6. Historia y persistencia (PROPUESTA)

Se diseña completo en papel y **se migra solo la etapa en curso**. Modelo completo: `Caja`, `MedioDePago`, `CuentaDeCobro`, `SesionCaja`, `MovimientoCaja`, `Cobranza` (una por cuenta, con `total` congelado y `clave`), `Cobro` (renglón: medio, cuenta de cobro opcional, importe, datos opcionales), `ArqueoCaja`, `ArqueoBillete`, `JornadaDeSucursal`, `ControlDeJornadaCerrada`, `CorreccionDeMedio`, `DeclaracionDeTotal`, `ConformeDeJornada`, y la lista global de marcas de tarjeta. Etapa C1 migra solo: `Caja`, `MedioDePago`, `SesionCaja`, `MovimientoCaja`, `Cobranza`, `Cobro` (renglón con medio e importe, **sin** datos opcionales ni cuenta de cobro hasta C3), `ArqueoCaja` y `ArqueoBillete`. Nada de tablas que nadie escribe. Migraciones aditivas, con `down.sql` y `verificacion-previa.sql`; ninguna se aplica a ninguna base real; timestamps reservados al pasar a Fase 2. Campos de forma: `Decimal(18,2)` y `CHECK` con tope; ids y fechas según lo que decida Frente 3 (propuesta: como Pedernal, Q-4).

### Nivel 7. Atomicidad y concurrencia (PROPUESTA)

Cada comando en `conTransaccionSerializable` (ya existente) con reintento; árbitros en la base: índice único parcial de sesión vigente; único `(empresa, clave)`; único por cuenta en la cobranza; único `anula_a`; disparador diferido `Σ cobros = total`; `FOR SHARE` de la sesión y la jornada al insertar movimientos. **Cobrar** escribe cobranza + cobros + movimientos de caja + auditoría en una sola transacción: todo o nada. La clave de idempotencia se mira **antes** que el estado. Dos cobros de la misma cuenta: uno gana, el otro ve «ya cobrada». Cobro contra cierre de sesión simultáneo: el cierre serializable choca y reintenta.

### Nivel 8. Acceso e interfaces (PROPUESTA)

- **Permisos** (zona compartida `src/core/permisos/acciones.ts`, se piden al orquestador general): `caja_ver`, `caja_crear`/`caja_editar`/`caja_desactivar`, `medios_de_pago_editar`, `cuentas_de_cobro_editar` (C4), `sesion_caja_abrir`, `sesion_caja_cerrar`, `movimiento_caja_registrar`, `movimiento_caja_anular`, `movimiento_caja_ajustar`, `cobrar_cuenta`, `cobro_corregir_medio`, `jornada_operar`. Nombres en el estilo existente (`pos_*`, `reporte_*`); lista definitiva al pasar a Fase 2. Todas con piso de nivel y fail-closed.
- **Puerto para otros módulos:** `registrarEgresoDeCajaEnTx` / `registrarCobroEnTx` **no** son acciones de usuario (como el puerto de Pedernal); Compras podrá pagar en efectivo desde la caja abierta usando ese puerto (contrato en el resumen, §Dependencias).
- **Pantallas:** las dibuja y construye Frente 6 sobre las maquetas aprobadas de Pedernal (`10-ux-ui/prototipos-gastronomia/caja.html`, `cierre-del-dia.html`, `medios.html`, `venta-rapida-v4.html`, `datos-cobro*.html`), con datos reales de la empresa del dueño (regla 2026-11-05).

### Nivel 9. Consultas y experiencia (PROPUESTA)

Cuentas cerradas sin cobrar por sucursal; estado de caja (cerrada/abierta/en cierre/jornada en cierre); movimientos de la sesión; esperado por medio; resumen de cierre; cuentas cobradas. Lo que falta se muestra «pendiente de completar», nunca inventado. Tablas (cierre en tres pasos, controles con severidad) según la maqueta aprobada de Pedernal; **el dueño de Pedernal dijo el 15/11 que la maqueta del cierre «no se entiende mucho»** (fila 181 de las decisiones de Pedernal): se rediseña con Frente 6 antes de construir.

### Nivel 10. Pruebas, migración y operación (PROPUESTA)

- **Pruebas por comando:** repetición (misma clave), concurrencia (dos a la vez), tiempo (corte de día, `05:59:59.999` vs `06:00:00.000`), error parcial (la transacción revierte), permisos, aislamiento entre empresas y sucursales, dinero (propiedades con `fast-check`: `Σ cobros = total` para cualquier reparto).
- **Combinaciones (regla del 2026-10-28).** Dimensiones cuyas combinaciones cambian dinero, permisos o visibilidad: (a) tipo de medio × dato del cobro admitido (techo por tipo: oráculo = la tabla de Pedernal, **escrito aparte** del código); (b) estado de la sesión (`ABIERTA`/`EN_CIERRE`/`CERRADA`/inexistente) × estado de la jornada (`ABIERTA`/`EN_AUDITORIA`/`CERRADA`/inexistente) × comando (cobrar, mover efectivo, abrir, cerrar, anular, ajustar); (c) rol × acción. Test exhaustivo contra la tabla (son pocas) y guardián que falla si aparece una columna, opción o clave nueva sin declarar si afecta.
- **Poda:** cada opción cita su necesidad; cuenta de cobro, datos del cobro, vuelto y cuentas de cobro quedan **fuera de C1** hasta que el dueño las pida para Motor2.
- **Operación:** sin datos que migrar (no existe caja). Cuentas ya cerradas antes de activar caja: **no se vuelven «sin cobrar»**; se marca «anterior a la caja» (Q-ANT, PENDIENTE). Despliegue congelado hasta que el dueño apruebe, con respaldo y autorización por base.
- **Gate de Fase 2:** los 8 comandos de `AGENTS.md` en la misma corrida, solo por «CI casero».

---

## Tabla «¿qué pasa si…?» por comando

Convención: **R**epetición · **C**oncurrencia · **T**iempo · **I**ncertidumbre (no sé si llegó) · **Re**intento · **EP** error parcial · **DF** datos faltantes · **CP** cambio de permisos. Todos: PROPUESTA (igual a Pedernal salvo lo marcado). `—` = no aplica.

| Comando | R | C | T | I | Re | EP | DF | CP |
|---|---|---|---|---|---|---|---|---|
| `abrirSesion` | Misma clave y contenido → devuelve la misma sesión; otro contenido → `CLAVE_REUTILIZADA`; caja ya abierta → `CAJA_YA_ABIERTA` con su id | Dos aperturas: el índice único parcial deja pasar una; la otra reintenta y ve la abierta | Jornada `EN_AUDITORIA`/`CERRADA` → rechaza; fecha de negocio se sella con la zona y corte leídos **dentro** de la transacción | Cliente sin respuesta: reintenta con la misma clave y obtiene lo hecho | Idempotente por clave | Sesión sin fondo: imposible (misma transacción) | Sin caja en la sucursal → `CAJA_REQUERIDA`; fondo vacío → rechaza (puede ser 0, no vacío) | Pierde el permiso a mitad: valida de nuevo en servidor, rechaza |
| `registrarMovimientoManual` (ingreso/egreso) | Misma clave → mismo movimiento | Dos movimientos a la vez: ambos entran (suman); contra cierre serializable choca y reintenta | Sesión no `ABIERTA` o jornada cerrada → rechaza | Reintento con clave | Seguro por clave | Movimiento + auditoría juntos o nada | Sin motivo → rechaza (motivo obligatorio, ≤500) | Operador solo lo suyo |
| Egreso mayor al esperado | — | — | — | — | — | — | — | Se **permite**, avisa y audita `EGRESO_SUPERA_EFECTIVO` (Pedernal 11/11); en Motor2 PROPUESTA |
| `anularMovimiento` | Ya anulado → `MOVIMIENTO_YA_ANULADO` | Dos anulaciones: el único `anula_a` deja una | Solo en la misma sesión abierta | Reintento con clave | Seguro | Espejo + auditoría atómicos | Sin motivo → rechaza | Anular lo de otros exige acción mayor; un cobro **nunca** (`MOVIMIENTO_CON_ORIGEN`) |
| `cobrarCuenta` | Misma clave+huella → `yaExistia`; otra huella → `CLAVE_REUTILIZADA`; cuenta ya cobrada → `YA_COBRADA` | Dos cobros de la misma cuenta: único por cuenta; el segundo ve `YA_COBRADA` | Sesión en cierre → `CAJA_EN_CIERRE`; jornada en cierre → rechaza; sesión abierta pasada su corte → cobra en su jornada y avisa | Pantalla sin respuesta: reintenta con la misma clave; nunca doble movimiento de caja | 20 reintentos ante conflicto de serialización | Cobranza+cobros+movimientos+auditoría en una transacción: si cualquiera falla, nada | `Σ ≠ total` → `COBRO_NO_CUADRA{falta/sobra}`; sin sesión → `SIN_SESION_ABIERTA`; cuenta abierta o sin venta → rechaza | Cobrador sin acción → rechaza; **precio/total cambió** desde que se vio → `TOTAL_CAMBIO` (nadie cobra un número viejo) |
| `iniciarCierre` / `cancelarCierre` | Idempotente por estado | Un cobro en vuelo hace esperar al cierre | Sesión `CERRADA` → `SESION_CERRADA` | — | Seguro | — | — | Los tres roles pueden |
| `cerrarSesion` | Ya cerrada con mismo conteo → `yaEstabaCerrada`; otro conteo → `SESION_CERRADA` | Cierre serializable vs cobro: gana uno; el otro reintenta | — | Reintento con mismo conteo | Seguro | Arqueo + billetes + cierre + auditoría atómicos; el chequeo diferido recalcula el esperado y falla si se coló un cobro | Sin conteo de efectivo → `CONTEO_DE_EFECTIVO_FALTANTE`; sin declarar ni «conforme» el resto → `CONTEO_O_CONFORME_FALTANTE` | Cierra quien tenga la acción; con diferencia **se permite** y se audita |
| `iniciarAuditoria` (jornada) | Idempotente (`yaEstabaEnAuditoria`) | Toma la jornada `FOR UPDATE` | Jornada inexistente (sin actividad) → `JORNADA_NO_ENCONTRADA` | — | Seguro | — | Hay cajas sin cerrar o cuentas abiertas → `JORNADA_CON_IMPEDIMENTOS` | |
| `corregirMedioDeCobro` | `MEDIO_DEL_COBRO_SIN_CAMBIOS` | PK `(cobro, secuencia)` arbitra | Solo con jornada `EN_AUDITORIA` | Reintento con clave | Seguro | Corrección + auditoría; el cobro original no cambia | Sin motivo → rechaza | Acción propia |
| `cerrarJornada` | Ya cerrada con mismo pedido → `yaEstabaCerrada` | `huellaVista`: si los controles cambiaron → `CONTROLES_CAMBIARON` | La jornada **nunca** se cierra sola | Reintento con la misma huella | Seguro | Todo o nada (foto de controles incluida) | Controles `BLOQUEA` → no cierra; `RECONOCIBLE` sin reconocer → rechaza | Acción propia |
| `registrarAjuste` (a jornada cerrada) | Por clave | — | Solo a jornada cerrada y anterior a la de la sesión | Reintento con clave | Seguro | Movimiento + auditoría | Sin motivo → rechaza | Solo gerente y administrador |
| Anular o corregir una **cuenta ya cobrada** | Repetir no duplica | Contra un cierre de día: serializable | Con la jornada cerrada → rechaza | — | — | — | — | **PENDIENTE (I-14 / Q-ANU):** hoy `corregirLineaDeTicket`/`quitarUnidadesDeLinea`/`anularVenta` cambian el total; una vez cobrada habría que bloquear o dejar diferencia |
| `crearMedioDePago` / `editar` | Nombre repetido → rechaza | Único por (empresa, nombre sin mayúsculas) | — | — | Seguro | — | Tipo fuera de lista → rechaza; el efectivo no se desactiva | Solo administrador y gerente |

**Lo que sigue siendo NO VERIFICADO:** el comportamiento exacto de Pedernal en el borde «mesa sin enviar» (`HAY_PLATOS_SIN_ENVIAR`), el manejo de salón de `cobrarMesa` y qué pasa con la cuenta cuando el cobro falla a mitad: el agente de lectura leyó solo cabeceras de `arqueo.ts`, `cerrar-sesion.ts` y `corregir-medio-de-cobro.ts`, no su lógica. Antes de Fase 2 se lee el código completo contra `main` de Pedernal.
