# Diseño: pagos a proveedores y conciliación — dejar el terreno preparado (2026-11-03)

Estado: **BORRADOR en papel. Niveles 1 a 5 de la escalera de diseño; los niveles 6 a 10 NO se diseñan hasta que el dueño confirme 1 a 5.** No hay código, ni migración, ni tabla. Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA.

## 0. Resumen para el dueño

- **Qué es esta idea (lo que entendí):** hoy los pagos a proveedores se manejan con un sistema armado en Google Sheets y Apps Script. El operario carga facturas y notas de crédito; auditoría interna las revisa; se envían a Administración por correo en lotes; Administración paga y devuelve los comprobantes de transferencia y de retención; el sistema los lee, los cruza con las facturas y concilia los importes; si cierra, marca las facturas como pagadas y avisa a los operarios. También maneja solicitudes sin archivo (transferencias y compras/anticipos) y el control de saldo $0 de los anticipos. El dueño aclaró (2026-11-03) que esos archivos **tienen errores y casos operativos sin contemplar**: se toman por la idea, no como especificación.
- **Qué pidió el dueño:** «dejar el terreno preparado» para esta idea. No pidió construirla.
- **Corrección a mi recomendación anterior.** Dije que «una fecha y un medio por factura» era la forma barata. **Con esta idea no alcanza:** un solo pago cubre varias facturas y notas de crédito, incluye retenciones, y se concilia por diferencia. Retiro esa recomendación (ver §5, I1).
- **Hallazgo central:** lo que esta idea necesita, **motor2 ya lo tiene planeado en otro lado**: `ConciliacionParcial` (N a N, con importe aplicado, deshacer con fila nueva) en `motor2-docs/04-contabilidad-y-caja/compatibilidad-motor2-contabilidad-odoo.md`. Y también hay una decisión que hay que reabrir: DM-11 dejó las **retenciones fuera del MVP**, pero este flujo las necesita para conciliar.
- **Decisión del dueño (2026-11-03, CONFIRMADA):** motor2 **absorbe todo el flujo**: solicitud → documentos → aprobación → pago o devolución → comprobante → conciliación y cierre, como un **expediente único** por caso (ver §9). Antes de diseñar tablas queda **una** pregunta abierta sobre las cuentas de correo y de archivos de cada cliente (§8).

## 1. Propósito y alcance

- **Necesidad (CONFIRMADA en el sentido de que existe y hoy se hace a mano):** pedido del dueño del 2026-11-03 («hay que dejar el terreno preparado para esta idea»), con sus archivos de referencia. Antecedente escrito: `docs/diseno-circuito-de-abastecimiento-2026-10-27.md` líneas 7 y 17 («Pago: contado declarado primero, cuenta corriente después»).
- **Dentro de este documento:** entender el flujo, ubicar qué existe y qué falta en motor2, y listar **qué se deja preparado ahora sin construir**.
- **Fuera:** construir cualquier pantalla o tabla; lectura de correos y OCR de comprobantes (integración externa, sin diseño); exportación a la planilla externa; facturación electrónica.

## 2. Actores (PROPUESTA, tomados del flujo de referencia)

| Actor | Qué hace en el flujo de referencia |
|---|---|
| Operario (remitente) | Carga facturas, notas de crédito, solicitudes de transferencia o de compra; recibe el aviso de pago |
| Auditoría interna | Revisa, corrige, rechaza con motivo, aprueba proveedores nuevos, concilia, hace correcciones o cierres manuales |
| Administración | Aprueba, observa, rechaza o paga; devuelve comprobantes de transferencia y de retención |
| Coordinador de centro de costo | Aparece en la cadena de destinatarios de avisos |
| Proveedor | Cobra; tiene CUIT y datos bancarios |

## 3. El flujo de referencia, paso a paso (lo que entendí)

1. **Carga:** tipo de solicitud (pago de factura, nota de crédito con «factura afectada», nota de débito, retenciones, devolución o reintegro), proveedor, centro de costo, número, fecha, monto, archivo. Verifica duplicados.
2. **Auditoría:** corrige datos, ve el comprobante, rechaza con motivo obligatorio, aprueba proveedores nuevos.
3. **Envío:** por proveedor, unificando facturas con sus notas de crédito; un correo por lote con identificadores `LOTE-AAAAMMDD-NNN` y `SOL-AAAAMMDD-NNN`.
4. **Solicitudes sin archivo:** transferencia (CBU o alias, titular, CUIT, concepto) o compra/anticipo (artículo, cantidad, enlace, importe estimado). Administración responde por correo con el identificador y una palabra: aprobada, observada, rechazada, pagada.
5. **Pago:** Administración paga y responde con comprobantes de transferencia y de retención.
6. **Conciliación:** por grupo de facturas, **neto de facturas menos notas de crédito** contra **comprobantes más retenciones**; si la diferencia es mínima (hoy hasta $1) cierra, si no queda para revisión. Intervenciones manuales (corregir importe, tipo o fecha; agregar factura o documento; asignar un archivo a varias facturas; cierre manual), todas con motivo y usuario.
7. **Cierre:** marca las facturas como pagadas, guarda los enlaces a comprobante y retención, avisa a los operarios; lleva el «saldo a favor» por notas de crédito pendientes.
8. **Anticipos:** saldo = adelanto + devoluciones − facturado neto; ciclo: solicitada, falta rendir, saldo a reintegrar, cerrada con saldo $0.

## 4. Qué existe hoy en motor2 y qué falta (verificado en el código y los documentos)

| Concepto del flujo | En motor2 | Estado |
|---|---|---|
| Factura de proveedor, número único | `FacturaProveedor` (+ renglones, partes por sucursal); la etapa 1 de Compras endurece el número | HOY |
| Nota de crédito | `NotaCreditoProveedor` (+ líneas, imputaciones, tributos): sobre factura o suelta; **nada de `src/` la escribe todavía** (Etapa C) | TABLAS SIN USO |
| Pago al proveedor | Solo `PagoConsignante` (por importe, sin vínculo a documento). Columnas `condicionPago`, `fechaPagoDeclarada`, `medioPagoDeclarado` en la factura, **sin ningún uso en `src/`**; la condición solo admite «contado pagada» (CHECK) | HOY, INSUFICIENTE |
| Pago conciliado con N facturas | `ConciliacionParcial` (importe, deshacer con fila nueva): **PROPUESTA** en `motor2-docs`; no existe | PLANIFICADO, NO VERIFICADO si sigue vigente (la copia local de `motor2-docs` es del 2026-10-09) |
| Retenciones al pagar | No hay. `FacturaProveedorTributo` es otra cosa (percepciones que trae la factura). DM-11: «fuera del MVP» | FALTA; DECISIÓN A REABRIR |
| Datos bancarios del proveedor | `Proveedor` tiene CUIT pero no CBU, alias ni titular | FALTA |
| Solicitud de pago con aprobación | No existe ni encontré plan (búsqueda en `docs/` y `motor2-docs` local) | FALTA, NO VERIFICADO en la copia remota |
| Anticipo con rendición (saldo $0) | No existe el concepto de «orden» ni de anticipo | FALTA |
| Centro de costo | `CentroDeCostos` (jerarquía); ADR-031: no aplica a mercadería | HOY |
| Adjuntos (PDF de comprobantes) | Sin lugar definido («falta decidir dónde se guardan los archivos») | PENDIENTE |
| Auditoría de correcciones manuales (quién, cuándo, motivo) | Patrón de auditoría existente | HOY |

## 5. Invariantes y políticas (nivel 5)

| # | Regla | Estado |
|---|---|---|
| I1 | El pago es un **registro aparte**, que solo se agrega, y se aplica a una o varias facturas y notas de crédito con un **importe aplicado** por cada una (relación N a N). No se modela como columnas de la factura. | PROPUESTA (retira «una fecha y un medio por factura») |
| I2 | Anular un pago o desconciliar se hace con un registro nuevo, nunca borrando (como `ConciliacionParcial` y el resto del Kardex). | PROPUESTA |
| I3 | Cada pago lleva clave de idempotencia obligatoria (patrón de `PagoConsignante`): repetir el mismo envío no duplica. | PROPUESTA |
| I4 | La diferencia aceptable de una conciliación es una **política declarada** (monto exacto y quién la define), no un número fijo en el código. El dinero va siempre en decimal exacto. | PROPUESTA |
| I5 | La clave de cruce entre un pago y una factura es el **número estructurado único por empresa y proveedor** (etapa 1 de Compras). Una factura ambigua nunca se marca como pagada en silencio. | PROPUESTA |
| I6 | Las retenciones son un componente del pago (lo retenido y su comprobante), no un descuento de la factura. | PENDIENTE (DM-11 a reabrir) |
| I7 | Corregir a mano un dato (importe, tipo, fecha) deja el valor original, el nuevo, quién, cuándo y el motivo. | PROPUESTA (el flujo de referencia ya lo hace) |
| I8 | Quien aprueba o paga no es quien carga (separación de funciones), con permisos verificados en el servidor. | PROPUESTA |
| I9 | **En cada caso decide una persona** (human in the loop): el sistema lee, cruza y propone; nunca marca pagado ni aplica un pago por su cuenta. Los errores operativos clásicos y no clásicos del envío y la respuesta por correo están en `docs/oraculo-conciliacion-por-correo-2026-11-03.md`. | CONFIRMADA (pedido del dueño, 2026-11-03) |
| I10 | **El dinero se puede cruzar entre facturas; el documento no.** Una nota de crédito cancela siempre una factura concreta (su factura afectada, ver `diseno-notas-de-credito-de-proveedor-2026-11-04.md` N16), pero en el pago puede compensarse contra otra: si por la nota 25 de la factura 124 se pagó de más, se paga de menos la 125 descontando esa nota del saldo a pagar. Por eso la aplicación es N a N (I1) y el saldo se calcula por proveedor además de por factura: una factura pagada de más deja un **saldo a favor** visible hasta que se descuenta en otro pago o se reintegra. Ninguna factura ni nota se edita para que el dinero cierre; solo se agregan aplicaciones, y deshacer es con un registro nuevo (I2). | CONFIRMADA como regla de negocio (dueño, 2026-11-04); forma de las tablas PENDIENTE |

## 6. Casos que el flujo de referencia no contempla (leídos en los archivos; **no ejecutados**, NO VERIFICADOS en producción)

El dueño avisó que los archivos tienen errores; esto es lo que noté al leer, para que el diseño nuevo los cubra:

1. **Marcar como pagada una factura con pago parcial:** si los comprobantes y retenciones suman menos pero dentro de la tolerancia, la factura entera pasa a pagada; no hay saldo.
2. **Factura ambigua:** si hay más de una factura del mismo proveedor con el mismo número, se saltea sin marcarla ni dar un aviso fuerte; queda impaga.
3. **Importes con coma flotante** y tolerancia fija de $1 escrita en el código.
4. **Reintentos:** el correo se envía y después se escribe en la planilla; si la escritura falla, el reintento reenvía. Las respuestas se procesan según «no leído» de Gmail, no por una clave propia.
5. **Respuesta mixta:** si un correo trae una decisión global del lote y otras por solicitud, solo vale la individual.
6. **Rechazar una solicitud operativa** no valida el estado actual ni registra quién lo hizo.
7. **Estados como texto libre** en celdas; sin restricción a los valores válidos.
8. **Pago que cubre varias facturas con una sola factura mal identificada** queda «sin identificar» y depende de asignar el archivo a mano.

## 7. Qué se deja preparado AHORA (sin construir ni migrar)

| # | Preparación | Costo | Dónde |
|---|---|---|---|
| T1 | **No usar** `condicionPago`, `fechaPagoDeclarada` ni `medioPagoDeclarado` como modelo de pago. La etapa 1 de Compras ya los deja sin tocar (el paso «Cómo se pagó» queda «pendiente de completar»). Se decide más adelante si se borran (poda) o quedan como resumen derivado. | cero | ya acordado con la sesión de compras |
| T2 | **Número de factura estructurado y único** por empresa y proveedor: es la clave de cruce (I5). | cero (ya es parte de la etapa 1) | etapa 1 |
| T3 | Cuando se implemente la nota de crédito, usar el modelo existente (`SOBRE_FACTURA` y `SUELTA`); no crear otro. | cero | Etapa C |
| T4 | Tomar `ConciliacionParcial` del plan contable como base del pago aplicado a facturas; confirmar si ese plan sigue vigente antes de diseñar tablas. | una revisión de documentos | antes del nivel 6 |
| T5 | Reabrir DM-11 (retenciones) **del lado proveedor**: retenciones practicadas al pagar. | una decisión del dueño | §11 |
| T6 | Datos bancarios del proveedor (CBU o alias, titular): columnas aditivas, **recién cuando se implemente** la solicitud de transferencia. | diferido | etapa propia |
| T7 | Decidir dónde se guardan los adjuntos antes de hablar de comprobantes. | diferido | decisión previa |

**Lo que no se hace:** no se crean tablas «a ciegas» (regla de `AGENTS.md`); no se escribe ninguna columna de pago en la factura.

## 8. Preguntas abiertas

1. **RESUELTA (2026-11-03):** motor2 absorbe el flujo completo (ver §9). Texto original: «¿solo el pago hecho y su conciliación, o también la solicitud y la aprobación?». Respuesta del dueño: «la idea es que absorba todo».
1.bis **(Dueño, una sola, la que cambia datos y permisos)** Los correos y los archivos pertenecen a cada cliente de motor2: ¿**cada cliente conecta su propia cuenta** (su Gmail y su Drive) o motor2 usa **una casilla y un almacenamiento propios por cliente** (por ejemplo un servicio de envío y recepción de correo y una carpeta por empresa)? Recomiendo lo segundo para arrancar: no depende de credenciales personales de cada cliente y se aísla por empresa desde el diseño; conectar el Gmail y el Drive de cada uno puede ser una etapa posterior con nombre.
2. **NO VERIFICADO:** si el plan de `ConciliacionParcial` sigue vigente en la copia remota de `motor2-docs` (la local es del 2026-10-09).
3. **PENDIENTE (después de la pregunta 1):** retenciones (DM-11), tolerancia de diferencia (I4) y almacenamiento de adjuntos (T7).

## 9. Alcance confirmado: expediente completo (dueño, 2026-11-03)

**Texto del dueño, resumido:** una plataforma interna para gestionar solicitudes y operaciones financieras con flujos de aprobación y comunicación por correo. El centro no son las «oportunidades comerciales» sino **cada caso o expediente y su estado**. Base de datos como registro principal; la hoja de cálculo solo para exportar o reportar.

**Flujos que incluye (CONFIRMADA como alcance; el orden y el detalle son PROPUESTA):**
1. **Cuentas por pagar:** facturas recibidas, notas de crédito, solicitudes de compra, devoluciones o reintegros por pagos realizados.
2. **Cuentas por cobrar:** solicitudes de pago y facturas enviadas a clientes.
3. **Devoluciones a clientes:** solicitud, aprobación, motivo y registro del reembolso.
4. **Bandeja de correo:** mensajes entrantes y salientes vinculados al expediente correcto.

**Qué lleva un expediente (PROPUESTA):** tipo, solicitante, proveedor o cliente, monto y moneda, documentos asociados, responsables, aprobaciones, fechas y la conversación de correo.

**Dos estados separados (CONFIRMADA como principio, nombres PROPUESTA):**
- **Estado de aprobación:** por ejemplo pendiente, aprobado, observado, rechazado.
- **Estado del dinero:** por ejemplo por pagar, parcialmente pagado, pagado, reembolsado.
- «Aprobado» **no** significa «ya se pagó».

**Casos nuevos que pidió el dueño (se suman al oráculo `docs/oraculo-conciliacion-por-correo-2026-11-03.md`):**
| Si… | Qué pasa (PROPUESTA) |
|---|---|
| El remitente manda un comprobante o una percepción equivocados | El expediente pasa a **«requiere corrección»**, indica qué documento o dato falta y permite **pedirlo de nuevo** |
| El remitente responde **fuera del hilo** | La bandeja permite **vincular a mano** ese correo y sus adjuntos al expediente |
| El remitente **no responde** | Queda registrado el **reenvío o seguimiento pendiente** (con fecha y quién) |
| Se reemplaza un documento | Se guarda el nuevo y queda registro de **quién lo recibió o reemplazó**; el anterior no se borra |
| Los documentos se almacenan | Vinculados al caso, con su origen (qué correo, quién) |

**Servicios externos que nombró el dueño (decisión técnica PENDIENTE):** Gmail (enviar solicitudes y vincular respuestas), Drive (facturas, notas de crédito, comprobantes), Sheets (exportar y reportes) y «Resend o alguna casilla» para enviar y recibir. **NO VERIFICADO:** si el servicio de envío que motor2 ya usa para avisos (Resend, ADR-018) permite también **recibir** correo; hoy solo se usa para enviar. **NO VERIFICADO:** el alcance de permisos y la cuota de las APIs de Gmail y Drive para una plataforma con varios clientes.

**Etapas propuestas (la más barata primero; cada una se puede frenar):**
| Etapa | Qué entrega | Depende de |
|---|---|---|
| X1 | Expediente de **cuentas por pagar** con los dos estados, documentos adjuntos (almacenamiento a decidir), historial y **bandeja manual** (se carga o vincula el correo a mano, sin automatización) | decisión de almacenamiento (T7) y la pregunta 1.bis |
| X2 | Envío de la solicitud por correo y recepción de respuestas, con la lista de decisión del oráculo (propuesta, sin asignar, bloqueo, observada) | canal de correo elegido |
| X3 | Pagos y conciliación N a N, con retenciones y diferencia declarada | reabrir DM-11 (retenciones) |
| X4 | Cuentas por cobrar | X1 |
| X5 | Devoluciones a clientes | X1 |
| X6 | Anticipos con rendición (saldo $0) | X1 y X3 |

**Riesgo declarado:** esto es un módulo del tamaño de Compras o más. Por eso se diseña por etapas y **no se crea ninguna tabla** hasta tener confirmados los niveles 1 a 5 de X1.

## 10. Respuestas del dueño del 2026-11-04 (prevalecen donde haya diferencia)

- **Hoy alcanza con «cargar la factura y después confirmar cuándo se pagó»** (CONFIRMADA). Ejemplo del dueño: la factura se carga el viernes, se paga el martes, se pasa de mes; **el flujo de caja es del mes de pago**, no del mes de la factura. El sistema completo (§9) se **prevé**, pero no se construye ahora.
- **Etapa X0 (la más barata, nueva; PROPUESTA de forma, CONFIRMADA de alcance):** la factura nace «pendiente de pago»; una acción «Declarar pago» guarda **fecha de pago (no posterior a hoy) y medio**, una sola vez, con quién y cuándo, idempotente y con control de versión. Reusa las columnas que ya existen en la factura (`fechaPagoDeclarada`, `medioPagoDeclarado`) y pide ampliar el CHECK de la condición de pago para admitir «pendiente de pago»: **migración mínima aditiva y reversible, cubierta por la autorización del 2026-11-03**. Para el flujo de caja se agrupa por **mes de la fecha de pago**; el reporte en sí queda pendiente (ver compras, reportes tipo planilla).
- **Compatibilidad con lo que viene:** cuando exista el pago como registro aparte con conciliación N a N (X3), cada pago declarado en X0 se convierte, una sola vez, en un pago con una imputación a su factura (sin perder fecha ni medio). Por eso X0 no es un callejón sin salida.
- **Retenciones (DM-11):** se **posponen**; siguen previstas para X3.
- **Cuentas de correo y archivos de cada cliente:** la pregunta **no es urgente**: solo importa para X1 y X2 (bandeja y envío de correo). Queda abierta y se vuelve a plantear antes de X1.
