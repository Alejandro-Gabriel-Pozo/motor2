# Compras: paridad con Pedernal — escalera de diseño (Fase 1, solo documentos)

Fecha: 2026-11-16. Frente 5 (COMPRAS). Auditoría en `diseno-compras-paridad-auditoria-2026-11-16.md`; índice, carril, etapas y preguntas en `diseno-compras-paridad-pedernal-2026-11-16.md`.

Estados: **CONFIRMADA** = lo dijo el dueño de Motor2, con cita literal y fecha. **PROPUESTA** = viene de una decisión del dueño en Pedernal (se cita) o del ingeniero; para Motor2 no vale hasta que el dueño la confirme aquí. **PENDIENTE** = falta decidir. **NO VERIFICADA** = no se leyó.

Compuerta: los niveles 6 a 10 están escritos como PROPUESTA para que el dueño vea el modelo completo en papel, pero **no se migra ninguna tabla** hasta que los niveles 1 a 5 estén CONFIRMADOS (y no hay migración en este PR). Se migra solo la etapa que se implemente.

## Nivel 1 — Propósito y alcance

| # | Decisión | Estado | Respaldo |
|---|---|---|---|
| 1.1 | Motor2 debe igualar a Pedernal en compras: recepción separada (N3) y orden de compra, tres vías, diferencias, notas de crédito y devolución (N4). | **CONFIRMADA** | «compras […] nosotros algo teníamos en Motor 2 de compras, nota de crédito y demás. No teníamos recepción separada, orden de compra, etcétera» — 2026-11-16, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md` §«Paridad con Pedernal». |
| 1.2 | Igual en resultado y en forma, salvo Prisma/RLS/datos existentes. | **CONFIRMADA** | «Necesitamos ser iguales [a Pedernal] en todo… El resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» — 2026-11-13 (AGENTS.md). |
| 1.3 | Las migraciones no se aplican hasta tener «todo el código igual». | **CONFIRMADA** | «las migraciones van a estar aprobadas cuando ya tengamos todo el código igual» — 2026-11-16 (misma fuente). |
| 1.4 | N3 y N4 se habilitan por perillas del plan; N4 requiere N3. | PROPUESTA | `DDD:196` (Pedernal, «Si», 16/11). Dependencia con el frente 4. |
| 1.5 | Fuera de alcance de este frente: caja (frente 1), unidades y presentaciones (2), forma de datos (3), perillas (4), pantallas (6); rechazo de partes propuestas, gastos, bienes de uso, flujo de caja por mes de pago. | PROPUESTA | Necesidad no escrita en el pedido; «Lo que el dueño no pidió no entra». |

## Nivel 2 — Actores y contexto

| # | Decisión | Estado | Respaldo |
|---|---|---|---|
| 2.1 | Roles: gerente y administrador confirman recepciones, configuran tolerancias (`compras.configurar` solo gerente en Pedernal), pagan, destinan saldo, corrigen y anulan; el operador/empleado carga compras y recibe en borrador. | PROPUESTA | `DDD:120(4)` (supuesto del ingeniero de Pedernal, «sin preferencia»), `DDD:176 (17A)`, `DDD:197 (5A)`. En Motor2 hoy `anular_compra`/`corregir_compra` son piso administrador y `declarar_pago_compra` es de empresa con piso operario: **no coincide con «gerente y administrador»** (ver pregunta 6). |
| 2.2 | Quien recibe elige el depósito (la «sección» de su sucursal). | PROPUESTA | `DDD:198`. En Motor2 la sección ya la elige el usuario al cargar y al aceptar. |
| 2.3 | Contexto: el stock y la caja se tocan; toda acción es de una empresa y, en N3, de una sucursal; el proveedor es de la empresa. | CONFIRMADA (reglas permanentes del proyecto) | CLAUDE/AGENTS: aislamiento por empresa y autorización en servidor. |

## Nivel 3 — Casos de uso

| Id | Caso de uso | Etapa | Estado |
|---|---|---|---|
| CU-1 | Cargar una compra que queda **pendiente de recibir** (stock no entra) | N3 | PROPUESTA |
| CU-2 | **Confirmar la recepción** (depósito elegido, control por línea, stock entra) | N3 | PROPUESTA |
| CU-3 | Anular compra (con pago vigente: no; con recepción pendiente: se anula sin stock) | C0/N3 | PROPUESTA |
| CU-4 | Corregir precio / cantidad / peso real de una línea | Corrección | PROPUESTA |
| CU-5 | Declarar pago (con importe y, en efectivo, desde caja abierta) y anularlo | Pago | PROPUESTA |
| CU-6 | Crear / pedir / cerrar / anular una orden de compra | N4 | PROPUESTA |
| CU-7 | Conciliar tres vías y resolver una diferencia (4 resoluciones) | N4 | PROPUESTA |
| CU-8 | Configurar tolerancias | N4 | PROPUESTA |
| CU-9 | Devolver mercadería al proveedor | N4 | PROPUESTA |
| CU-10 | Pedir y cargar una nota de crédito (con «aplicar a esta factura» en el mismo paso) | N4 | PROPUESTA |
| CU-11 | Aplicar saldo a una factura / registrar reintegro / anular el destino | N4 | PROPUESTA |
| CU-12 | Ver la cuenta corriente del proveedor | N4 | PROPUESTA |

## Nivel 4 — Conceptos y ciclo de vida

| # | Decisión | Estado | Respaldo / nota |
|---|---|---|---|
| 4.1 | **La compra sigue siendo una factura de proveedor con partes por sucursal**; «recepción separada» se modela con `FacturaProveedorSucursal.estadoRecepcion` (`PENDIENTE → RECIBIDA`, una vez, irreversible: el disparador ya lo impone). No se crea una tabla `Recepcion` aparte. | **CONFIRMADA** (opción A) | Motor2: decisión «una sola compra» 2026-11-06 y base lista (auditoría §1.4). Difiere en forma de Pedernal (que separa recepción y comprobante); mismo resultado. Respuesta del dueño, 2026-11-16: «Toda compra sigue llevando factura (Recomendada)» (registrada en `motor2-docs`, «segunda tanda»). |
| 4.2 | Una compra sin factura (Pedernal N1) **no existe** en Motor2; la regla del 2026-11-06 se mantiene. | **CONFIRMADA** | «Toda compra sigue llevando factura (Recomendada)» — 2026-11-16. Diferencia con Pedernal declarada (motivo: decisión del dueño). |
| 4.3 | Control por línea: `CONFORME`, `CON_OBSERVACIONES`, `RECHAZADA`; observación obligatoria si no es conforme; motivo de rechazo = la observación escrita, sin lista cerrada. | PROPUESTA | `DDD:198`. Rechazada = esa cantidad no entra a lo disponible (destino cuarentena/rechazo es etapa posterior, 0064). |
| 4.4 | Orden de compra: `BORRADOR → PEDIDA → CERRADA \| ANULADA`; «recibida parcial/recibida» se **calculan**; no se edita una vez pedida; se anula solo sin recepciones, con motivo. | PROPUESTA | E9 D127 (`DDD` no la fija con cita literal; NO VERIFICADO su texto). El DDL viejo de Pedernal dice `EMITIDA`; vale el vocabulario aprobado «Pedida». |
| 4.5 | Sin aprobación de segunda persona; la crea y pide quien administra o gerencia. | PROPUESTA | `DDD:197` «1A … 5A». |
| 4.6 | Tolerancias de cantidad, precio e importe: **sin valor por defecto**; sin tolerancia definida toda diferencia queda abierta; las configura el gerente. | PROPUESTA | `DDD:197 (3A)`. |
| 4.7 | Diferencia: resoluciones «Dejar abierta», «Pedir nota de crédito», «Aceptar la diferencia», «Devolver al proveedor». | PROPUESTA | `DDD:197 (2A)` (reemplaza las siete de `DDD:121`). |
| 4.8 | Cuatro hechos separados: devolución de mercadería (stock, sin dinero), nota de crédito (corrige la factura), saldo a favor, pago/reintegro. | PROPUESTA | «a vos te pueden hacer una nota de crédito y ellos te tienen con saldo a favor… que yo devuelva una compra no significa que devuelva dinero» — `DDD:166`, 15/11 (dueño de Pedernal). |
| 4.9 | La devolución no crea sola el pedido de nota; la nota siempre pasa por saldo a favor, con «aplicar a esta factura» en el mismo paso; la empresa decide el destino; nunca descuento automático ni plazo. | PROPUESTA | `DDD:167, 168, 176 (15A, 16A)`. |
| 4.10 | **Notas de crédito: se reutilizan las 4 tablas `NotaCreditoProveedor*` que ya existen sin escritor** (ya traen factura asociada, mismo proveedor, único parcial e imputación con `operacionDevolucionId`), en vez de un `comprobante` clase nota como en Pedernal. | PROPUESTA | Regla «inventariar lo que ya existe con otro nombre» y «tablas a ciegas». Difiere en forma de Pedernal; se declara. Falta verificar que su forma cubra tope (`total_acreditado`), crédito y destino. |
| 4.11 | Saldo a favor: Pedernal lo está pasando a un «libro común de saldos por parte» (`DDD:210, 216`). | NO VERIFICADA | `primitiva-de-libro-diseno.md` no leído. El modelo de saldos de Motor2 **no se decide** hasta leerlo y hasta que exista el frente que lo comparta. |
| 4.12 | Valorización al corregir cantidad o peso real, **opción A**: lo agregado entra al costo corregido de esa línea; lo quitado sale al costo con que entró esa línea (no al promedio); lo ya consumido conserva su costo; bajar nunca supera la existencia. | PROPUESTA | «creo que es A, porque si alguien lo ve no lo va a entender…» — `DDD:199`, 16/11 (Pedernal). |
| 4.13 | Anular con oferta vigente: la oferta deja de existir como precio vigente; no se borra nada. | PROPUESTA | `DDD:180 (23A)`. En Motor2 ya sucede por derivación (auditoría fila 16). |
| 4.14 | Efectivo siempre sale de una caja abierta; no hay «pago fuera de caja». | PROPUESTA | «3A», `DDD:188`, 16/11. Bloqueada por el frente 1. |
| 4.15 | Camino B de anulación («la compra anula sus pagos») no se construye; perilla futura. | PROPUESTA | `DDD:169`. |

## Nivel 5 — Invariantes y políticas (todo nace cerrado)

| # | Invariante | Estado |
|---|---|---|
| 5.1 | Una parte `PENDIENTE` **no genera stock, costo ni gasto**; solo la confirmación los crea, en una sola transacción. | PROPUESTA (ya lo dice el schema, 2026-10-12) |
| 5.2 | Confirmar es de una sola vez: dos confirmaciones concurrentes de la misma parte → una gana, la otra recibe «ya recibida» (disparador + `UPDATE … WHERE estadoRecepcion='PENDIENTE'`). | PROPUESTA |
| 5.3 | Sin tolerancia definida toda diferencia queda abierta; ninguna se acepta sola. | PROPUESTA (`DDD:197`) |
| 5.4 | Una asignación nunca supera lo recibido ni lo facturado (por línea). | PROPUESTA (Pedernal ya lo tiene en 0037) |
| 5.5 | Suma de notas vigentes de una factura ≤ total de la factura (bloquea; S-1 de Pedernal). | PROPUESTA |
| 5.6 | Saldo disponible = importe − usado, **calculado**; nunca un número editable; destino concurrente: gana uno (`UPDATE … WHERE usado + n <= importe`). | PROPUESTA |
| 5.7 | Pago: importe = total − aplicado (nunca resta la nota por sí sola: sería doble descuento). | PROPUESTA (corrección de Pedernal, `e9-n4` §5) |
| 5.8 | Anulación en cadena: no se anula un eslabón con dependiente vigente (reintegro/aplicación → pago → nota/crédito → factura/compra); el error nombra al dependiente. | PROPUESTA |
| 5.9 | Nada se borra: anular es un registro nuevo (contra-asiento) con quién, cuándo y motivo. | CONFIRMADA (regla permanente) |
| 5.10 | Dinero: `Decimal` exacto en ARS con redondeo definido; nunca flotantes; moneda explícita. Fechas: zona Argentina (UTC-3), fecha de negocio. | CONFIRMADA (regla permanente) |
| 5.11 | Permisos nacen cerrados: toda acción nueva se declara en `ACCIONES` y la valida el servidor. | CONFIRMADA (regla permanente) |
| 5.12 | Cruce con la escalera de producto N0 a N5: lo que falta se muestra «pendiente de completar», nunca inventado; N3/N4 no rompen lo cargado en N2. | PROPUESTA |

## Niveles 6 a 10 (modelo en papel, PROPUESTA; no se migra nada)

**6 — Historia y persistencia.** Todo aditivo, solo-inserción donde haya historia, con `down.sql` y `verificacion-previa.sql`, **«requiere autorización expresa por base»** y sin aplicarse (congelamiento). Por etapa:
- *N3-a:* **ninguna migración** (usa `estadoRecepcion`, `operacionId` opcional, `compra_recibir`); verificar en la Fase 2 si falta un CHECK que impida stock con parte PENDIENTE.
- *N3-b:* `ControlDeLineaDeRecepcion` (solo inserción: parte, renglón, `condicion` con CHECK, `observacion` obligatoria si no conforme, quién y cuándo, clave idempotente única) y la entrada de stock por línea y depósito con clave única (patrón de 0063 de Pedernal, **sin** único por movimiento: `DDD:202`).
- *N4:* `OrdenDeCompra` + línea; `ToleranciaDeCompras` (NULL = no definida, distinto de cero); `DiferenciaDeCompra` + resolución (4 valores, CHECK); `PedidoDeNotaDeCredito`; completar `NotaCreditoProveedor*` (factura asociada, tope); créditos/destinos/reintegro **o** libro de saldos (pregunta de diseño 4.11); `ingresoDeCaja` (frente 1).
- Costo provisional solo en N3/N4 (`DDD:197 4A`): mecanismo NO VERIFICADO en Pedernal; se define en la etapa N3-c.

**7 — Atomicidad y concurrencia.** Cada comando: `conTransaccionSerializable` con reintento (el patrón ya usado), `FOR UPDATE` sobre la cabecera de la factura (como `bloquearFactura`), clave de idempotencia + `payloadHash` (I3), `UPDATE … WHERE estado=…` como cerrojo. Stock + recepción + (más adelante) caja: todo o nada.

**8 — Acceso e interfaces.** Acciones nuevas (zona restringida, las pide el orquestador general): confirmar recepción = **activar `compra_recibir`** (hoy reservada) con piso gerente/administrador; `ordenes_de_compra.*`, `compras.configurar`, `notas_de_credito_de_proveedor.*`, `creditos_de_proveedor.*` (nombres de Pedernal; en Motor2 se adaptan a la convención `snake_case` de `ACCIONES`: **diferencia declarada**). Perillas `recepcion_separada` y `conciliacion_de_tres_vias` las declara el frente 4. Textos: catálogo T1 (zona restringida); los 23 textos de compras ya aprobados en Pedernal son punto de partida.

**9 — Consultas y experiencia.** Bandeja «Por recibir» (lo que pide `compra_recibir`), compras registradas con estado derivado (`ANULADA`, `RECIBIDA_SIN_FACTURAR`, `RECIBIDA_Y_FACTURADA` en Pedernal; en Motor2 «pendiente de recibir / recibida / anulada»), cuenta corriente del proveedor. Pantallas = frente 6.

**10 — Pruebas, migración y operación.** Concurrencia (dos confirmaciones; confirmar y anular a la vez; dos destinos sobre un crédito; dos notas que juntas pasan la factura), idempotencia (misma clave en cada comando), atomicidad (falla de stock deshace la recepción; falla de caja deshace el pago), aislamiento por empresa, denegación de permisos, subir-bajar-subir de cada migración. **Combinaciones (oráculo aparte del código):** dimensiones que cambian dinero, stock, permisos o visibilidad: *nivel* (N2/N3/N4) × *estado de recepción* (pendiente/recibida/anulada) × *control de línea* (conforme/observaciones/rechazada) × *rol* (gerente/administrador/operador) × *pago* (ninguno/vigente/anulado) × *medio* (efectivo/otro) × *caja* (abierta/cerrada/sin caja) × *tolerancia* (sin definir/definida) × *nota vigente* (sí/no) × *saldo* (con/sin). Tabla de reglas esperadas escrita en `docs/oraculo-combinaciones-compras-paridad-…md` en la Fase 2 (antes que el código); test exhaustivo en las dimensiones chicas y por pares en las grandes; guardián que falla si aparece una columna/opción/clave sin declarar si afecta. Revisar los guardianes existentes (`combinaciones-una-sola-compra-declaradas`) para **extenderlos**, no duplicarlos.

## «¿Qué pasa si…?» por comando

Convención: **R** repetición · **Co** concurrencia · **T** tiempo · **I** incertidumbre · **Re** reintento · **EP** error parcial · **DF** datos faltantes · **CP** cambio de permisos. Todo es PROPUESTA.

| Comando | R | Co | T | I | Re | EP | DF | CP |
|---|---|---|---|---|---|---|---|---|
| CU-1 cargar pendiente | misma clave+huella → devuelve lo ya cargado; clave igual con otro contenido → `CLAVE_REUTILIZADA`; mismo N.º vigente → rechazo | dos cargas del mismo N.º: el índice parcial deja una | fecha de factura ≤ hoy (Argentina) | falla de red tras commit: el reintento con la misma clave devuelve el resultado | seguro (I3) | transacción única: factura+partes+propuestas o nada | sin sucursal/sección: rechazo explícito | si pierde `proceso_compra` a mitad: la acción re-valida en servidor y rechaza |
| CU-2 confirmar recepción | segunda confirmación → «ya recibida», sin segundo stock | dos confirmaciones: gana una (cerrojo `PENDIENTE`); confirmar y anular a la vez: `FOR UPDATE` en cabecera ordena | fecha de stock entre la de la factura y hoy | si no llegó la respuesta, reintentar con la misma clave devuelve lo hecho | seguro | stock+control+estado en una transacción: falla de una línea deshace todo | línea rechazada sin observación → rechazo; sin depósito → rechazo | solo gerente/administrador (`compra_recibir`); se re-valida al confirmar |
| CU-3 anular compra | `RECEPCION_YA_ANULADA`/«ya anulada», sin segundo contra-asiento | anular y confirmar a la vez: gana el primero en la cabecera | — | — | seguro (anulación única por factura) | contra-asiento y marca en una transacción | motivo obligatorio | con pago vigente: **rechazo** `COMPROBANTE_YA_PAGADO{pagoId}`; con nota vigente: rechazo |
| CU-4 corregir línea | misma clave: no duplica la corrección; mismo valor: «sin cambios» | dos correcciones sobre la misma versión: una gana, la otra `CORRECCION_DESACTUALIZADA` | no se corrige una compra anulada | — | seguro | línea + ajuste de costo/stock + oferta: todo o nada | motivo obligatorio | corregir pide piso admin; si toca stock, además permiso de ajustar |
| CU-5 declarar pago | un pago vigente por factura (índice parcial) | dos pagos: gana uno | fecha de pago ≤ hoy | efectivo con caja cerrada: rechazo, no pago «fuera de caja» | seguro | pago + egreso de caja: o ambos o ninguno | sin importe/medio: rechazo; efectivo sin caja: rechazo | gerente/administrador (a confirmar) |
| CU-6 orden de compra | misma clave: una orden | pedir y anular a la vez: `FOR UPDATE` | una vez pedida no se edita | — | seguro | orden + líneas atómicas | proveedor y sucursal obligatorios | crear/pedir: gerente/administrador |
| CU-7 conciliar y resolver | repetir resolución: no duplica | dos asignaciones a la vez: tope por línea (`UPDATE … WHERE asignada + n <= recibida`) | — | sin tolerancia: toda diferencia abierta | seguro | asignación + estado atómicos | tolerancia no definida ≠ cero | configurar: solo gerente |
| CU-9 devolver mercadería | misma clave: una salida de stock | dos devoluciones sobre la misma existencia: la base impide pasar de cero | — | — | seguro | devolución + salida de stock atómicas | motivo obligatorio | gerente/administrador (supuesto de Pedernal) |
| CU-10 cargar nota | misma nota (proveedor+tipo+N.º) no se duplica | dos notas que juntas pasan la factura: gana una (tope atómico) | — | — | seguro | nota + crédito + (opcional) aplicación en una transacción | sin factura asociada: rechazo | cargar: operador con compras; aplicar: gerente/administrador |
| CU-11 aplicar / reintegrar | misma clave: un destino y un movimiento de caja | dos destinos sobre un crédito: `CREDITO_INSUFICIENTE` al segundo | — | reintegro en efectivo: caja abierta | seguro | destino + `usado` + caja atómicos | importe ≤ lo que falta pagar | gerente/administrador (17A) |

## Etapas y escalera de producto

La escalera de producto (N0–N5, lo que ve el cliente) se cruza con esta en el nivel 5: **N2** = compra con factura (hoy); **N3** = N2 + recepción pendiente/confirmada con control por línea; **N4** = N3 + orden de compra, tres vías, diferencias, notas, devolución y saldo. Cada peldaño es aditivo y no reescribe lo cargado.
