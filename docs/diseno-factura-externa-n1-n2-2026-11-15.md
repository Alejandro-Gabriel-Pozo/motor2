# Diseño: factura externa de ventas, N1 (cargar el comprobante) y N2 (conciliar tickets por renglón o cantidad) — 2026-11-15

Estado: **diseño en papel. Sin código, sin migraciones, sin tocar ninguna base.** **Ninguna migración tiene autorización expresa.** Niveles 1 a 5 con sus estados; el nivel 6 va **solo como esquema propuesto, marcado «PROPUESTA, no se migra hasta confirmar niveles 1 a 5»**; niveles 7 a 10 hasta donde corresponde.

Continúa y **actualiza** `docs/diseno-caja-y-cobros-2026-11-04.md` (etapas N1 y N2; casos CU4, CU5, CU6, CU7, CU10; reglas C1 a C37; ahí están las citas textuales del dueño del 04/11, que **no se repiten ni se reabren** acá). Depende de dos documentos de hoy: `docs/diseno-parte-ficha-unica-2026-11-15.md` (la ficha del cliente) y `docs/diseno-identidad-del-renglon-del-ticket-2026-11-15.md` (los renglones congelados del ticket).

Estados: **CONFIRMADA** (dicha por el dueño, con cita y fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Marcas: **(V)** verificado en el código; **(DOC)** solo de un documento.

Fotos: Motor2 `origin/main` `a7077f52` (2026-11-15). Pedernal: código `ZuluHub-ERP` `7f3931be` (2026-11-14 23:28 -03:00), documentos `ZuluHub-docs` `82b99179` (2026-11-15 00:38 UTC). Redacción genérica (repositorio público): sin nombres de sucursales, cifras ni identificadores de bases.

## Para el dueño, en doce líneas

1. **Hoy Motor2 no emite**; la alternativa es traer y conciliar lo facturado en el otro sistema. N1 es **cargar** ese comprobante (letra, punto de venta, número, fecha, monto, cliente por CUIT); N2 es **aplicarlo a tickets**, por renglón o cantidad.
2. Son **dos tablas separadas**: la de compra (`FacturaProveedor`, que ya existe) y la de venta (nueva). No se mezclan.
3. Acepta los **nueve tipos** de Pedernal (factura, nota de débito y nota de crédito, con letras A, B y C).
4. El cliente se identifica por **CUIT, desde la ficha Parte**: no se agrega ninguna columna a `Cliente`.
5. Corregir un comprobante mal cargado = **un gesto con dos registros** (se anula el viejo y se carga el corregido, copiando lo aplicado). Así lo hace Pedernal en compras y Motor2 en `FacturaProveedor`: el dinero no se edita.
6. Conciliar: elegís el comprobante, el sistema **propone** los tickets y renglones pendientes, **vos confirmás**, y queda anotado cuánto de cada renglón se facturó. **No se puede facturar más de lo vendido**, aun si dos personas lo intentan a la vez.
7. Una nota de crédito externa parcial **devuelve a pendiente lo acreditado** (tu decisión del 11-15).
8. Solo tickets de **salón y cuentas** emitidos desde la activación (decisión tuya; los viejos según la pregunta 1 del documento del renglón).
9. El alojamiento se **declara aparte** como concepto: no es un ticket y no crea cobros.
10. Tablas propuestas: **cuatro** para cargar (N1) y **dos** para conciliar (N2), más la del renglón congelado. Menos que las cinco y tres que contaba el plan: explico por qué (§5).
11. Cambia el comportamiento de tres casos de uso que ya existen (corregir ticket, anular venta de una cuenta cerrada, quitar unidades): no podrán bajar lo ya facturado.
12. **Tres preguntas de negocio** al final.

---

## 0. Decisiones del dueño que usa este diseño

El 04/11 está citado en `diseno-caja-y-cobros-2026-11-04.md` §0.1 y §«Decisiones del dueño del 2026-11-04». Acá solo lo posterior y lo que cambia el diseño.

| # | Fecha | Texto literal | Fuente | Qué fija | Estado |
|---|---|---|---|---|---|
| F-1 | 2026-11-14 | «Si son dos tablas. En venta la tabla que emite y demas. El tema es que hoy motor2 no está emitiendo y la alternativa es conciliar Aquello que se facturo en el otro sistema con los datos, por eso se elegis letra, pto de venta, nro de comprobante y el manejo de tickets igual a pedernal+ declarar lo que es alojamiento seria en este contexto» | `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Factura de venta externa: explicación del dueño» | Dos tablas (compra y venta); el comprobante se identifica por letra, punto de venta y número; tickets igual a Pedernal; alojamiento declarado | **CONFIRMADA** (la lectura del orquestador sobre «dos tablas» quedó confirmada con F-2) |
| F-2 | 2026-11-15 | «Sí, siguen como confirmados el 04/11 (Recomendada)» | mismo archivo, «Factura externa: campos, tipos, nota de crédito parcial y ratificación en bloque» | Campos: clase factura o nota de crédito, fecha, monto, cliente por CUIT, una sucursal por comprobante, corregir o anular con registro, más letra, punto de venta y número. **Lo que el 04/11 dejó solo PROPUESTO sigue siendo propuesta** | **CONFIRMADA** |
| F-3 | 2026-11-15 | «Como Pedernal: los 9 tipos con A, B y C (Recomendada)» | mismo archivo | Los nueve tipos con A, B y C (**reemplaza «A y B» del 04/11**) | **CONFIRMADA** |
| F-4 | 2026-11-15 | «Sí, lo acreditado vuelve a pendiente (Recomendada)» | mismo archivo | Nota de crédito externa parcial: lo acreditado vuelve a pendiente de facturar | **CONFIRMADA** |
| F-5 | 2026-11-15 | «Por renglón o cantidad también en la externa» | mismo archivo, «Partes por renglón o cantidad…» | Se concilia por renglón o cantidad, con tope «facturado ≤ vendido» (**reemplaza «por importe» de C5**) | **CONFIRMADA** (opción no recomendada, elegida por el dueño) |
| F-6 | 2026-11-15 | «Solo lo que tiene ticket (salón y cuentas) (Recomendada)» | mismo archivo, «Mostrador en la conciliación…» | La primera conciliación cubre salón y cuentas; mostrador después si lo pide | **CONFIRMADA** |
| F-7 | 2026-11-14 | «Esperar a Parte (ficha única como Pedernal) (Recomendada)» | mismo archivo, «CUIT del cliente, cobro y registro…» | Sin columnas nuevas en `Cliente`; Parte antes de la factura externa | **CONFIRMADA** |
| F-8 | 2026-11-14 | «Como Pedernal: con caja, sesión y jornada (Recomendada)» (a cobrar un ticket, N3) | mismo archivo | Cobrar viene **después** (caja primero); por eso N2 no puede decir «cobrado» | **CONFIRMADA en dirección** |
| F-9 | 2026-11-15 | «Sí, copiar a Pedernal en esas cinco (Recomendada)» | mismo archivo | E5: lo nuevo nace con uuid, `timestamptz` y solo inserción | **CONFIRMADA en dirección** |
| F-10 | 2026-11-14 | «Revisa pedernal» (facturar por partes como lo decidido o lo construido) y «Ok. Facturación como pedernal» (destino de emisión propia, etapa futura) | mismo archivo | Se sigue lo **decidido** en Pedernal; la emisión con ARCA es un destino futuro que se diseña aparte; **la factura externa sigue vigente hasta que exista** | **CONFIRMADA** (ver el archivo: la anotación «reemplazada» del 04/11 era demasiado amplia y se corrigió) |
| F-11 | 2026-11-13 | «Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma…» | `AGENTS.md` | Paridad con Pedernal; toda diferencia lleva motivo | **CONFIRMADA** |
| — | — | Autorización de cada migración | — | — | **PENDIENTE** (no existe ninguna) |

Del 04/11, lo que sigue **confirmado y se conserva sin cambios**: facturan en otro sistema y no se integra (punto 1); tipo de comprobante, clase, punto de venta por sucursal con su nombre, número y fecha, monto (punto 2); número sugerido con freno y fundamentación (C7, C33, C35); cliente por CUIT (punto 4); la conciliación parte del comprobante (punto 5); alojamiento declarado como concepto con lista de la empresa y «anticipo recibido» que resta (puntos 9, P9, C19, C20); un comprobante, una sucursal (C11); la nota de crédito baja el monto a conciliar de su factura y no mueve dinero (C22); reglas de letra (C9, solo la parte del CUIT).

---

## 1. Inventario: lo que ya existe con otro nombre (validado contra el código, no contra documentos)

| Necesidad | Lo que existe hoy | Qué se reusa | Evidencia |
|---|---|---|---|
| Comprobante de **compra** registrado a mano | `FacturaProveedor` (+ renglones, tributos, sucursales, propuestas), `NotaCreditoProveedor` | Como **patrón** (clave de unicidad vigente, anulación con registro, «un error se anula y se vuelve a cargar», clave de reintento + huella). **No** como tabla: es de un proveedor y de renglones de compra. Dos tablas, como dijo el dueño (F-1) | (V) `prisma/schema.prisma:2755` y comentario del modelo |
| Número de comprobante (letra, punto de venta, número) | `src/core/datos/numero-comprobante.ts`: letras A, B, C, E, M, X; punto de venta 1 a 99999; número 1 a 99999999; formato «A-00023-00237728» | El formato y los rangos. **Las letras de la externa son solo A, B y C** (F-3), no E, M ni X | (V) archivo citado |
| Punto de venta | `PuntoDeVentaDeProveedor` (número por proveedor, sin uso en `src/`) | El rango y el patrón; el de la externa es **propio de la sucursal y con nombre** (nuevo) | (V) `schema.prisma:3061` |
| CUIT | `src/core/fiscal/cuit.ts` (`esCuitValido`) | La validación; P1 de Parte agrega `cuit_valido` en la base | (V) |
| Cliente / ficha | `Cliente` (solo nombre y %); **Parte no existe aún** (diseñada) | La ficha de Parte (P1) como receptor | (V) `schema.prisma:756`; doc de Parte |
| Ticket por cuenta, con sucursal | `Cuenta`, `EjemplarTicket`, `CuentaItem`, `Operacion` VENTA | Los renglones congelados del documento del renglón | (V) |
| Anulación con registro, un solo vigente, reintento seguro | Pagos X0 (`PagoDeFacturaProveedor` + anulación), `emitirTicketCorregido` | El patrón | (V) |
| Módulos y permisos | `src/core/modulos/catalogo.ts` (módulos `clientes_basico`, `proveedores_basico`, `salon`…); `src/core/permisos/acciones.ts` (permisos con contexto y nivel mínimo; todo nace excluido) | La forma; **no existe** un módulo de facturación | (V) |
| Cobro, medio de pago, caja | **No existe** | — (viene después, F-8) | (V) `cuenta-cierre.ts` |
| Conciliación de ventas contra comprobantes | **No existe** (búsqueda de «concili» y «comprobante externo» en `src/` y `schema.prisma`: sin coincidencias) | — | (V) |
| Palabra «reconciliación» en el código | Es la del **stock** (`cargarReconciliacionesPosteriores`); no es esto | — | (V) |

**En Pedernal (verificado en `7f3931be`), lo que hay y lo que no:**

| Pieza | Pedernal | Para la externa |
|---|---|---|
| Comprobante **de compra** registrado a mano | `comprobante_de_proveedor` (0037): clase (SIN_COMPROBANTE, FACTURA, NOTA_DE_DEBITO, NOTA_DE_CREDITO), los 9 tipos, punto de venta 1 a 99998 y número 1 a 99999999 (enteros), fecha, importes, `estado` REGISTRADO o ANULADO, clave de reintento `^[A-Za-z0-9_-]{16,128}$` y huella sha256, anulación con motivo ≤ 500; único `(empresa, proveedor, tipo, punto de venta, número)` solo entre los no anulados; **solo cambian** estado, anulación y versión (UPDATE por columna) | Es el **precedente a espejar** del lado venta, tal como lo describe el 04/11 (`ComprobanteExterno`) |
| Comprobante **de venta emitido** | `comprobante` (0009), atado a ARCA: `origen_tipo` en una lista cerrada (`MANUAL`, `EJEMPLAR_DE_TICKET`, `PROPINA_DE_TICKET`, `CORRECCION_DE_TICKET`, `SUSCRIPCION`, + `REEMISION_DE_TICKET`), siete estados de ARCA, CAE, ambiente, emisor congelado, receptor **copiado sin clave foránea** (nombre, tipo y número de documento, condición de IVA, domicilio; `receptor_parte_id` opcional); nota de crédito ligada a su factura por `comprobante_asociado_id` (misma letra, mismo emisor, mismo documento del receptor, factura autorizada) | **No** sirve tal cual para una factura emitida en otro sistema (ningún estado admite «número y fecha tipeados, sin CAE de este sistema»). **Sí** se copia la *forma* del receptor y de la nota ligada |
| Puntero ticket → comprobante | `documento_de_ticket` (0029): **un** vigente por ticket, entero; «facturado» lo decide fiscal | **No se copia el modelo** (no hay partes en lo construido): se copia lo **decidido** (partes por renglón o cantidad, F-5, R-3) |
| Partes (`renglon_facturado`, `renglon_de_documento`, `acreditacion_de_renglon`) | **No existen** (solo diseño, tramos T1 a T7 sin empezar; solo T0 está hecho) | Se **diseñan acá** siguiendo el diseño y la decisión, con el acumulado y el CHECK |
| Conciliación de **compras** | `conciliacion` y `asignacion_de_conciliacion` (0037): acto CONCILIACION o ANULACION (espejo, una sola vez), cantidades con signo, disparador `asignacion_aplicar` que mantiene el saldo y exige que lo asignado quede entre 0 y lo recibido/facturado | **Es el precedente real de código** para aplicar y anular con cantidades con signo; se usa su forma |
| Tipos y códigos de ARCA | A: 1, 2, 3; B: 6, 7, 8; C: 11, 12, 13 (factura, nota de débito, nota de crédito); los códigos viven en el adaptador, la base guarda los 9 nombres | La base guarda los 9 nombres; sin códigos (no hay adaptador) |
| «Pendientes de facturar» | Tickets cobrados sin comprobante vigente (por **ticket**, no por renglón) | Concepto equivalente: «tickets con renglones sin facturar» |
| Alojamiento como concepto declarado | **No existe** en el código de Pedernal | Diferencia declarada (propia de Motor2, CONFIRMADA en el punto 9 del 04/11) |

---

## 2. Escalera de diseño, niveles 1 a 5

### Nivel 1. Propósito y alcance — CONFIRMADA (necesidad)

- **Necesidad (quién y dónde):** el dueño, 2026-11-04 (puntos 1 a 5 y 9 de `diseno-caja-y-cobros-2026-11-04.md` §0.1) y 2026-11-14/15 (F-1 a F-6): *«conciliar con el otro sistema con un par de datos más los datos de este sistema»*.
- **Propósito:** que la administración **cargue** los comprobantes de venta emitidos en el otro sistema y **sepa qué parte de cada ticket está facturada**, para ver qué falta facturar.
- **Entra:** N1: puntos de venta de la sucursal; catálogo de conceptos; cargar, corregir y anular comprobantes (9 tipos); alta o búsqueda del cliente por CUIT (vía Parte); lista y filtros. N2: aplicar un comprobante a renglones o cantidades de tickets; anular lo aplicado; nota de crédito externa que devuelve a pendiente; lista «tickets con renglones sin facturar».
- **No entra** (cada punto con su motivo): emitir y hablar con ARCA (destino futuro, etapa aparte; F-10); cobro, medios de pago, caja, cuenta corriente (vienen después; F-8); reservas y folio (N6); consumo fuera de convenio (C30: el módulo de convenios es etapa propia); mostrador (F-6); desglose de IVA, CAE, vencimientos, domicilio y condición de IVA del receptor (nadie lo pidió; son datos del comprobante emitido, no de uno tipeado); importar desde el otro sistema (idea posterior del 04/11).
- **Primero lo más barato:** espejar el precedente de compras (una tabla de cabecera, sin estados nuevos) y reusar el patrón de conciliación de compras (acto con signo) en lugar de tablas separadas de acreditación.

### Nivel 2. Actores y contexto — PROPUESTA (salvo lo citado)

| Actor | Qué hace | Estado |
|---|---|---|
| Administración | Carga, corrige y anula comprobantes; concilia; ve pendientes | PROPUESTA (04/11, nivel 2) |
| Gerente | Todo lo anterior en su sucursal y empresa | PROPUESTA |
| Operario o cajero | **No** carga comprobantes ni concilia (permisos nacen excluidos, C16) | PROPUESTA |
| Sistema externo de facturación | **No se integra.** Sus datos se tipean | CONFIRMADA (04/11, punto 1) |
| Agente de una empresa cliente | No interviene en esta etapa (vínculo de P2 de Parte, fuera de la cadena) | CONFIRMADA que existe; fuera de alcance |

Contexto: multiempresa; la **sucursal** es la unidad (punto de venta por sucursal, un comprobante una sucursal: C10 y C11); fechas en zona Argentina (UTC-3); moneda única de la empresa; dinero en decimal exacto.

### Nivel 3. Casos de uso — PROPUESTA (salvo lo citado)

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU-P | Declarar, renombrar y dar de baja puntos de venta de una sucursal | N1 | CONFIRMADA (R1 del 04/11: los administra la administración) |
| CU-C | Administrar el catálogo de conceptos declarados (alojamiento, productos regionales, anticipo recibido…) | N1 | CONFIRMADA (P9 del 04/11) |
| CU4 | **Cargar** un comprobante (9 tipos), con número sugerido y freno | N1 | CONFIRMADA (puntos 2 y 3; F-2, F-3) |
| CU5 | **Corregir** un comprobante mal cargado, con registro | N1 | CONFIRMADA que debe poder corregirse (punto 3); **la mecánica** (anular y volver a cargar) es PROPUESTA (decisión técnica DT-4) |
| CU8 | **Anular** un comprobante con motivo | N1 | PROPUESTA (regla del sistema) |
| CU6 | **Conciliar:** a partir de un comprobante, proponer tickets y renglones pendientes y que una persona confirme, **por renglón o cantidad** | N2 | CONFIRMADA el flujo y la granularidad (punto 5, F-5); la confirmación humana PROPUESTA (C12) |
| CU6b | **Quitar una aplicación** hecha por error, sin anular el comprobante | N2 | PROPUESTA (mínimo para poder corregir una conciliación; alternativa: anular el comprobante y cargarlo de nuevo) |
| CU10 | **Nota de crédito externa:** baja el monto de su factura y **devuelve a pendiente** lo que acredita | N2 | CONFIRMADA (C22 y F-4) |
| CU7 | **Pendientes:** tickets emitidos con renglones sin facturar | N2 | CONFIRMADA el concepto (punto 5); la columna de cobro dice «pendiente de completar» hasta N3 |
| — | Nota de débito externa: **cargar** sí; efecto sobre tickets: ver pregunta 2 | N1 | Cargar: CONFIRMADA (F-3, los 9 tipos); efecto: PENDIENTE |

### Nivel 4. Conceptos y ciclo de vida — PROPUESTA (salvo lo citado)

- **Comprobante externo de venta:** un documento emitido en otro sistema y tipeado acá. Ciclo: **REGISTRADO → ANULADO**; sin borrador (R3 del 04/11, CONFIRMADA). Nunca se borra.
- **Tipo:** uno de los nueve (clase FACTURA, NOTA_DEBITO o NOTA_CREDITO × letra A, B o C). La **serie** es (punto de venta, tipo): cada una tiene su correlativo (NO VERIFICADA contra la norma de ARCA; se apoya en lo dicho el 04/11).
- **Receptor:** la persona o empresa a quien se emitió. Se identifica por **documento** (CUIT, o DNI en letra B) y se **copia congelado** en el comprobante (nombre, tipo y número de documento), con la referencia opcional a su ficha de Parte. Sin documento = consumidor final. La copia es lo que hace Pedernal (`comprobante`: receptor sin clave foránea, ADR-014); no cambia si después se edita la ficha.
- **Concepto declarado:** línea escrita en el comprobante que **no sale de este sistema** (alojamiento…). Importe siempre positivo; el signo lo pone el concepto (`SUMA` o `RESTA`). No crea cobro, ticket ni cargo (C20, CONFIRMADA).
- **Renglón del ticket y «vendido»:** definidos en el documento de la identidad del renglón. **Vendido** de un renglón = su cantidad en el último ejemplar emitido del ticket.
- **Aplicación:** el acto de imputar un comprobante a una cantidad (e importe) de un renglón de un ticket. **Solo se agrega**; se deshace con un registro espejo. Tiene un acto: `APLICACION` (suma), `ANULACION` (espejo, resta) o `ACREDITACION` (la resta que hace una nota de crédito).
- **Facturado de un renglón (acumulado):** lo aplicado menos lo anulado y acreditado. **Pendiente** = vendido − facturado. Es lo que aparece en «tickets con renglones sin facturar».
- **Composición del comprobante (C19):** monto = Σ conceptos declarados (con su signo) + Σ importes de renglones aplicados. La diferencia («falta $X», «sobra $X») **se muestra y no bloquea**; la decide una persona (el principio CONFIRMADO; «no bloquear» PROPUESTA).
- **Ticket que se puede conciliar:** de **salón o cuenta**, de la **sucursal** del comprobante, emitido desde la activación (con renglones congelados) y **no desactualizado**. Un ticket con renglones de importe 0 no genera pendiente (no hay nada que facturar; Pedernal tampoco emite comprobantes de total cero).

### Nivel 5. Invariantes y políticas — PROPUESTA (salvo lo marcado CONFIRMADA)

| # | Regla | Dónde se sostiene | Estado |
|---|---|---|---|
| E-1 | Dinero en decimal exacto (`DECIMAL(14,2)`), moneda de la empresa, redondeo definido; nunca flotantes | Tipos + `core/moneda.ts` | CONFIRMADA (C1, regla permanente) |
| E-2 | Un comprobante **no se borra**; se anula con motivo. Los renglones congelados y las aplicaciones **solo se agregan** | Disparadores de solo inserción + privilegios por columna | CONFIRMADA (trazabilidad, C3/C8) |
| E-3 | El **número** de un comprobante es único entre los **vigentes** de (punto de venta, tipo, número) | Índice único parcial `WHERE estado = 'REGISTRADO'` | PROPUESTA (C6) |
| E-4 | El número se **sugiere** (último vigente de la serie + 1); si se pone otro hay **freno y fundamentación obligatoria**; el servidor recalcula la sugerencia | Aplicación + CHECK de pareo | CONFIRMADA (C7, C33, C35); recalcular PROPUESTA (C34) |
| E-5 | **Un comprobante, una sucursal**: el punto de venta es de la misma sucursal; los tickets aplicados, también | FK compuestas con la sucursal | CONFIRMADA (C10, C11) |
| E-6 | **Letra A exige receptor con CUIT**; B admite consumidor final y DNI; C como B | CHECK (`letra = 'A' ⇒ documento CUIT`) + aplicación | CONFIRMADA la parte del CUIT (C9, P4 del 04/11); el DNI en B PROPUESTA |
| E-7 | Una **nota de crédito o de débito** se liga a **una factura** (o nota de débito) **vigente, de la misma letra, sucursal y mismo documento del receptor** | FK + disparador (como `comprobante_asociado` de Pedernal) | PROPUESTA (la columna que la liga es PROPUESTA en el 04/11; el criterio copia a Pedernal) |
| E-8 | **Facturado ≤ vendido**, por renglón y en cantidad e importe, **en la base**, aunque dos personas operen a la vez | Acumulado con CHECK + SERIALIZABLE con reintento | CONFIRMADA (F-5: «tope facturado ≤ vendido» igual que Pedernal); mecanismo PROPUESTA (DT6) |
| E-9 | Un **combo** (renglón de promo) y todo renglón no divisible se aplica **entero** | CHECK sobre `divisible` | PROPUESTA (decisión P7 de Pedernal) |
| E-10 | La aplicación usa **solo el ejemplar vigente** del ticket y falla si está desactualizado | Disparador (como `documento_validar_alta` de Pedernal) | PROPUESTA |
| E-11 | **Anular un comprobante libera todo lo aplicado en la misma transacción** | Caso de uso | PROPUESTA (DT9) |
| E-12 | Una **nota de crédito acredita solo lo aplicado a su factura**, por renglón: no más | Disparador + bloqueo de la factura | PROPUESTA (Pedernal: «una NC parcial por renglón queda limitada a lo facturado de ese renglón en esa factura», DOC) |
| E-13 | **Corregir** o anular un ticket o una línea ya facturados **no baja lo facturado**: se rechaza | CHECK del acumulado al emitir el ejemplar corregido + guarda previa en el caso de uso | PROPUESTA (P6, decidida para Pedernal el 2026-11-14) |
| E-14 | Todo se filtra por empresa y por alcance de sucursal; el servidor valida quién pide y con qué permiso | RLS + guardas | CONFIRMADA (C15) |
| E-15 | Los permisos nuevos nacen **excluidos** (denegar por defecto) | Catálogo de acciones | CONFIRMADA (C16) |
| E-16 | La fecha del comprobante es de **día local**, no futura | Aplicación | CONFIRMADA día local (C17); «no futura» PROPUESTA |
| E-17 | La anulación y la corrección dejan **quién, cuándo y motivo** | Columnas de anulación + auditoría | CONFIRMADA (C8) |
| E-18 | Lo que no se sabe se muestra **«pendiente de completar»**; nada se inventa (columna de cobro hasta N3; tickets sin renglones) | Reglas de lectura | CONFIRMADA (regla permanente) |
| E-19 | Los datos nuevos **nacen con la forma de Pedernal**: `id` uuid que manda la aplicación, `timestamptz`, solo inserción | Esquema | CONFIRMADA en dirección (F-9) |

**Lo que choca con el 04/11 y se resuelve así (declarado):**
- **C5** (cargo cubierto por más de un comprobante «por importe») queda **reemplazada** por «por renglón o cantidad» (F-5).
- **Corrección por UPDATE por columna con auditoría por campo** (propuesta del 04/11) queda **reemplazada** por «anular y cargar de nuevo en un solo gesto» (DT-4): lo pide E5 (solo inserción), lo hace Pedernal en compras y lo hace Motor2 en `FacturaProveedor`. El dueño pidió poder corregir, no una mecánica.
- **`Cliente.documentoTipo`/`documento`**: retiradas (F-7).
- **`AplicacionDeCargo` con importe**: reemplazada por la aplicación por renglón con cantidad e importe.
- **`AnulacionDeComprobanteExterno`** (tabla aparte del 04/11): se **retira**; la anulación va en la cabecera como en Pedernal (`cp_anulacion_ck`). Una tabla menos.

---

## 3. Escalera de producto N0 a N5 de este circuito

| Etapa | Qué ve el cliente | Qué hay que construir | Depende de |
|---|---|---|---|
| **N0 (hoy)** | Se cierra la cuenta, se imprime «no válido como factura» y se factura afuera sin que Motor2 lo vea | — | — |
| **N1** | Cargar la factura o nota del otro sistema con número sugerido, conceptos declarados y cliente por CUIT; corregir y anular; lista con filtros. Columna «sin explicar» = monto − conceptos | Puntos de venta, conceptos, comprobante, líneas | Parte P1 |
| **N2** | La factura propone los tickets y renglones pendientes; se confirma; se ve el tope y lo que falta; nota de crédito que devuelve a pendiente; lista «tickets con renglones sin facturar». **La columna de cobro dice «pendiente de completar»** | Renglón congelado (documento aparte), aplicación y acumulado | N1; renglones; Parte P3 (para «los tickets de este cliente») |
| N3 | Cobrar con caja, sesión y jornada, como Pedernal | Caja, cobro | N2 y la caja |
| N4 a N5 | Cuenta corriente, caja chica, reservas informativas | En papel en el 04/11 | — |

Lo que falta se muestra como «pendiente de completar», nunca se inventa. Formalidad y detalle son ejes separados: los desgloses de IVA y los datos del comprobante emitido entrarían como columnas opcionales, sin romper lo cargado.

---

## 4. Decisiones técnicas (con recomendación; no se le preguntan al dueño)

| # | Decisión | Recomendación y motivo |
|---|---|---|
| DT-1 | Dónde vive el comprobante de venta externo | **Tabla propia** (`ComprobanteExterno`) espejando `comprobante_de_proveedor` de Pedernal y `FacturaProveedor` de Motor2, **no** el comprobante emitido de Pedernal (su base lo ata a ARCA: la lista cerrada de orígenes, los siete estados y los CHECK de autorizado lo impiden) ni un comprobante único (el dueño dijo dos tablas, F-1) |
| DT-2 | Receptor | **Copia congelada** (nombre, tipo y número de documento) + `receptorParteId` opcional, igual que Pedernal. No se copian condición de IVA ni domicilio (no se emite; nadie los pidió) |
| DT-3 | Tipos | Lista cerrada de **9 nombres** en un CHECK (`FACTURA_A`…`NOTA_CREDITO_C`), con la clase derivada por CHECK, como Pedernal. Sin códigos de ARCA (sin adaptador). Fuente única en `src/core` con una prueba que compare con la lista de compras (Pedernal tiene ese test: `compras-fuente-unica`) |
| DT-4 | Corregir | **Un gesto, dos registros**: anula el comprobante viejo (libera lo aplicado y deja el motivo «corregido») y carga el nuevo con los datos corregidos, **copiando las aplicaciones vigentes** (nuevas filas espejo y de aplicación) en la **misma transacción**. El comprobante nuevo guarda `corrigeAId`. Si lo corregido es un dato que invalida lo aplicado (otra sucursal, otro receptor), la copia se rechaza y la persona decide. Motivo: E5 (solo inserción) y la convención de compras («el dinero no se edita») |
| DT-5 | Anulación del comprobante | Columnas `estado`, `anuladoPorId`, `anuladoEn`, `motivoDeAnulacion` en la cabecera (como Pedernal `cp_anulacion_ck`); único `UPDATE` por columna, condicional (`WHERE estado = 'REGISTRADO'`; 0 filas = `YA_ANULADO`). **No hay tabla de anulación aparte** |
| DT-6 | Dónde se impone «facturado ≤ vendido» | **Acumulado por renglón con CHECK** (`0 ≤ facturado ≤ vendido`, cantidad e importe), actualizado por el disparador de la aplicación al insertar (bloqueo de fila: la segunda persona sobre la última unidad falla por el CHECK), más SERIALIZABLE con reintento en el caso de uso. Es el diseño de Pedernal (§4.2 de `ventas-facturacion-por-partes.md`, DOC) y el patrón de `asignacion_aplicar` de su conciliación de compras (V) |
| DT-7 | Aplicación y acreditación en **una** tabla con acto y signo | `APLICACION` (+), `ANULACION` (espejo, una sola vez por original) y `ACREDITACION` (−), como `conciliacion`/`asignacion_de_conciliacion` de Pedernal (0037). Pedernal diseña `acreditacion_de_renglon` como tabla aparte (DOC, no construida); el precedente construido usa un solo registro con signo. **Una tabla menos** y mismo resultado |
| DT-8 | Importe de una parte | Se calcula (no lo trae el comprobante) con **reparto por restos mayores sobre lo pendiente**, de modo que la última parte lleve el resto exacto (P8 del dueño para Pedernal, 2026-11-14, DOC; el reparto del IVA **no** aplica: el comprobante lo trae). Función pura nueva en `src/core` con propiedades de `fast-check` (Σ partes = total, al centavo). **NO VERIFICADO** si ya existe una equivalente |
| DT-9 | Anular un comprobante libera lo aplicado | **En la misma transacción**: inserta los espejos de todas sus aplicaciones vigentes y baja el acumulado; si no, el acumulado quedaría mayor que lo realmente facturado |
| DT-10 | Idempotencia | `id` uuid que manda la pantalla = clave de alta del comprobante (E5); clave de reintento **por comando** (comprobante, aplicar, anular) + **huella** del contenido (renglones y cantidades ordenados, como `huellaDeComando` de compras en Pedernal): mismo envío = mismo resultado; misma clave con otros datos = `CLAVE_REUTILIZADA` |
| DT-11 | Anular ticket o línea con lo facturado | **Rechazado**: la guarda lee el acumulado `FOR UPDATE` antes de anular una venta; y el CHECK del acumulado es la red cuando se emite el ejemplar corregido (E-13). Alcanza a `anularVenta`, `quitarUnidadesDeLinea`, `corregirLineaDeTicket`, `reemplazarVentaConMenosUnidades` (**NO VERIFICADO** que sean todos; hacer la búsqueda exhaustiva antes de construir) |
| DT-12 | Cuándo se crea el acumulado | **De forma perezosa**, en la primera aplicación de ese renglón (no se escribe para cada venta que nunca se factura). Los ejemplares corregidos posteriores actualizan el acumulado **solo si existe**. SERIALIZABLE arbitra la carrera entre «aplicar» y «corregir» |
| DT-13 | Forma de lo nuevo | Ver §5 (E5): ids uuid, `timestamptz`, solo inserción, dinero `DECIMAL(14,2)` (Pedernal usa `numeric(18,2)`: se mantiene el de Motor2 por datos existentes y por la poda de «dinero en bigint») |
| DT-14 | Módulo | Nombre propuesto `facturacion_externa`, que requiere `clientes_basico` y la ficha de Parte. **La relación con el futuro módulo de facturación como Pedernal** (la pregunta del dueño del 2026-11-14: «Habría que verlo como modulo propio que acorta pasos en el modulo de facturación se podrá?», **sin respuesta decidida**) se resuelve en E11; **no se construye la relación «extiende»** (decisión del 2026-11-14) |
| DT-15 | Letras de compra vs. venta | Compras acepta A, B, C, E, M, X; la externa de ventas solo A, B y C (F-3). Se declara; no se toca compras |
| DT-16 | Fuera de línea: nota de crédito mayor que su factura | Pedernal no pone tope global (ARCA responde con una observación). En la externa **sí** (E-12: acredita solo lo aplicado a su factura, por renglón), porque aquí acredita renglones y no solo importe. Es una diferencia declarada |

---

## 5. Nivel 6. Historia y persistencia — **PROPUESTA, no se migra hasta confirmar niveles 1 a 5**

Todo aditivo y con `down.sql` (aborta si hay datos). Una migración por vez, cada una con autorización expresa. Sellos posteriores a `20261112170000`. Tablas nuevas: **todas de EMPRESA con `empresaId` y `aislamiento_empresa`**, y las que son de sucursal suman las cuatro políticas restrictivas por sucursal (patrón de `Mesa` y `Cuenta`). Forma de lo nuevo (E5): `id uuid` que manda la aplicación; `timestamptz`; privilegios `SELECT` e `INSERT` (y `UPDATE` solo de las columnas nombradas); sin `DELETE` ni `TRUNCATE`.

### Necesidad de cada tabla (poda)

| Tabla | Necesidad (quién y dónde está escrita) |
|---|---|
| `PuntoDeVentaDeSucursal` | «Punto de venta por sucursal, con su nombre» (dueño, 2026-11-04, punto 2; R1) |
| `ConceptoDeComprobante` | «Productos regionales… que nos deje armar la lista» (dueño, P9 del 04/11) y los detalles de sus facturas reales |
| `ComprobanteExterno` | Tipo, punto de venta, número, fecha, monto, cliente (dueño, 04/11 punto 2; F-1 a F-3) |
| `LineaDeConceptoDeComprobante` | «Alojamiento 0 o algún valor» y otros conceptos declarados (04/11 punto 9, P9; F-1) |
| `AplicacionDeRenglon` | Aplicar la factura a renglones o cantidades con tope (dueño, 2026-11-15, F-5) |
| `RenglonFacturado` | El tope «facturado ≤ vendido» impuesto en la base (F-5; DT-6) |
| *(en el otro documento)* `RenglonDeEjemplar` | Saber qué es y cuánto se vendió de cada renglón (F-5) |
| **Retiradas del 04/11:** `AnulacionDeComprobanteExterno` (la anulación va en la cabecera), `AplicacionDeCargo` (reemplazada), `Cliente.documentoTipo`/`documento` (F-7) | — |

### N1

**`PuntoDeVentaDeSucursal`**: `id` uuid; `empresaId`; `sucursalId` (FK compuesta a `Sucursal`); `numero` entero 1 a 99999; `nombre` 1 a 60 caracteres sin espacios a los costados ni saltos de línea; `activo`; `creadoEn timestamptz`. Únicos `(sucursalId, numero)`, `(empresaId, sucursalId, id)` (destino de la clave foránea del comprobante: el punto de venta es de la misma sucursal), `(empresaId, id)`. Baja lógica: `UPDATE` solo de `activo` y `nombre`.

**`ConceptoDeComprobante`**: `id` uuid; `empresaId`; `nombre` 1 a 60, único por empresa sin distinguir mayúsculas; `signo` `SUMA` o `RESTA` (por defecto `SUMA`); `activo`; `creadoEn`. `UPDATE` solo de `activo` y `nombre`.

**`ComprobanteExterno`** (de sucursal):

| Columna | Tipo | Regla |
|---|---|---|
| `id` | uuid | lo manda la aplicación |
| `empresaId`, `sucursalId` | texto | FK compuesta a `Sucursal` |
| `puntoDeVentaId` | uuid | FK compuesta `(empresaId, sucursalId, puntoDeVentaId)` → `PuntoDeVentaDeSucursal` |
| `tipo` | texto | CHECK: los 9 nombres (`FACTURA_A`, `FACTURA_B`, `FACTURA_C`, `NOTA_DEBITO_A`…, `NOTA_CREDITO_C`) |
| `clase` | texto | CHECK derivada del `tipo` (`FACTURA`, `NOTA_DEBITO`, `NOTA_CREDITO`) y letra derivada del `tipo` |
| `numero` | entero | CHECK 1 a 99999999 |
| `fecha` | date | día local de Argentina; no futura (la valida la aplicación) |
| `monto` | decimal(14,2) | CHECK `> 0`; no es un cobro |
| `receptorParteId` | uuid NULL | FK compuesta a `Parte` (Parte antes: F-7) |
| `receptorDocumentoTipo` | texto | CHECK `CUIT`, `CUIL`, `CDI`, `DNI`, `PASAPORTE`, `SIN_IDENTIFICAR` (los de Pedernal) |
| `receptorDocumentoNumero` | texto NULL | CHECK `^[0-9]{1,11}$`; con `cuit_valido` si es CUIT, CUIL o CDI; NULL si `SIN_IDENTIFICAR` y solo entonces |
| `receptorNombre` | texto NULL | ≤ 200; obligatorio si el receptor se identifica |
| `corrigeAId` | uuid NULL | FK compuesta a sí misma; el comprobante al que corrige (DT-4) |
| `facturaAfectadaId` | uuid NULL | FK compuesta a sí misma; **obligatoria si y solo si** `clase ≠ FACTURA` (E-7); disparador: vigente, misma letra, misma sucursal y mismo documento |
| `numeroSugerido` | entero NULL | lo que el **servidor** sugería al guardar |
| `motivoNumeroDistinto` | texto NULL | 1 a 200; obligatorio si y solo si `numeroSugerido` existe y difiere de `numero` (C33, C34) |
| `estado` | texto | CHECK `REGISTRADO` o `ANULADO` |
| `anuladoPorId`, `anuladoEn`, `motivoDeAnulacion` | | pareo con `estado = 'ANULADO'` (CHECK); motivo 1 a 500 |
| `claveIdempotencia`, `payloadHash` | | únicos y juntos (CHECK); la clave es global como `FacturaProveedor` |
| `creadoPorId`, `creadoEn` | | quién y cuándo (`timestamptz`) |

CHECK adicionales: `tipo` de letra A ⇒ `receptorDocumentoTipo = 'CUIT'` (E-6); `tipo` de clase ≠ FACTURA ⇒ `facturaAfectadaId` no nulo. Únicos: **`(puntoDeVentaId, tipo, numero) WHERE estado = 'REGISTRADO'`**; `(empresaId, id)`; `(empresaId, claveIdempotencia)`. Índices `(empresaId, sucursalId, fecha)`, `(empresaId, receptorParteId)`, `(facturaAfectadaId)`. `UPDATE` solo de `estado`, `anuladoPorId`, `anuladoEn`, `motivoDeAnulacion`. **No hay `version`** porque los datos no se editan.

**`LineaDeConceptoDeComprobante`**: `id` uuid; `empresaId`; `comprobanteId` (FK compuesta); `conceptoId` (FK compuesta); `importe decimal(14,2)` CHECK `> 0` (el signo lo pone el concepto; «alojamiento 0» es ninguna línea); `creadoEn`. **Solo inserción** (corregir = DT-4). Único `(comprobanteId, conceptoId)`. Que Σ líneas ≤ monto lo controla la aplicación (cruza filas).

### N2

**`RenglonFacturado`** (acumulado; de sucursal): `id` uuid; `empresaId`; `cuentaId` (FK compuesta); identidad del renglón (`operacionOriginalId` **o** `promoCuentaId`, exactamente una: la misma del documento del renglón); `ejemplarId` (el ejemplar que fijó el vendido); `cantidadVendida decimal(14,4)`, `cantidadFacturada decimal(14,4)`, `importeVendido decimal(14,2)`, `importeFacturado decimal(14,2)`; CHECK `0 ≤ cantidadFacturada ≤ cantidadVendida` y `0 ≤ importeFacturado ≤ importeVendido`. Únicos parciales por identidad y cuenta. `UPDATE` solo por las columnas del acumulado y solo desde el disparador y el caso de uso de emitir ticket corregido.

**`AplicacionDeRenglon`** (de sucursal, solo inserción): `id` uuid; `empresaId`; `comprobanteId` (FK compuesta; el que mueve lo facturado: la factura en `APLICACION` y `ANULACION`, la nota de crédito en `ACREDITACION`); `facturaAfectadaId` NULL (solo en `ACREDITACION`: la factura de la que se descuenta); `cuentaId`, identidad del renglón (como arriba), `ejemplarId`; `acto` CHECK `APLICACION`, `ANULACION` o `ACREDITACION`; `cantidad` y `importe` **con signo**, CHECK `cantidad ≠ 0`, y signo según el acto (`APLICACION` > 0; los otros dos < 0); `anulaAId` NULL (solo `ANULACION`; único: el espejo una sola vez); `claveDelComando` uuid; `creadoPorId`, `creadoEn`. Únicos `(claveDelComando, identidad)` y `(anulaAId)`. Disparador `aplicar` (AFTER INSERT, como `asignacion_aplicar` de Pedernal): suma en `RenglonFacturado` (el CHECK muerde), exige que `ejemplarId` sea el último de la cuenta y que la cuenta sea de la sucursal del comprobante, exige comprobante `REGISTRADO` y de la clase correcta, rechaza una cantidad parcial en un renglón no divisible (E-9) y, en `ACREDITACION`, que lo acreditado no supere lo aplicado a esa factura en ese renglón (E-12).

**Cantidad de tablas, comparada con el plan:** el plan contaba 5 (N1) + hasta 4 (N2, con el renglón congelado y una tabla de acreditación). Acá: **4** (N1) + **2** (N2) + **1** (renglón, otro documento) = 7 en total contra 9, por dos retiros con motivo (la anulación en la cabecera, DT-5; la acreditación como acto con signo, DT-7). Todas siguen sin autorización.

**Qué es calculado y nunca guardado:** «sin explicar» = monto − Σ conceptos − Σ importes aplicados; el correlativo sugerido (último vigente de la serie + 1; es orientativo, manda el índice único); el pendiente de un renglón (vendido − facturado); el estado «desactualizado» de un ticket.

**Efecto en casos de uso existentes (a diseñar en detalle antes de construir):** `emitirTicketCorregidoEnTx` actualiza el acumulado si existe; las cuatro acciones de DT-11 leen el acumulado antes de anular o reemplazar; el cierre de cuenta (renglones) está en el otro documento.

---

## 6. Nivel 7. Tabla «¿qué pasa si…?» por comando

| | **Cargar comprobante** | **Corregir comprobante** | **Anular comprobante** | **Aplicar tickets (conciliar)** | **Quitar una aplicación** |
|---|---|---|---|---|---|
| **Repetición** (doble clic, reintento) | `id` uuid y clave únicos: el mismo envío devuelve el mismo comprobante; el mismo número vigente rechaza con el comprobante que lo usa | Misma clave = mismo resultado; el viejo ya está anulado | `YA_ANULADO`; no repite | Clave por comando + huella: repetir devuelve lo hecho; no duplica filas ni suma dos veces al acumulado | `YA_QUITADA` (el espejo es único por original) |
| **Concurrencia** | Dos personas cargan el mismo número: gana una por el único parcial; la otra ve «ya cargado en ese punto de venta» | Corregir contra anular el mismo comprobante: SERIALIZABLE, gana uno | Anular contra aplicar: se serializa (la aplicación exige `REGISTRADO`) | **Dos personas sobre la última unidad de un renglón: una gana; la otra falla por el CHECK del acumulado** (`facturado ≤ vendido`) | Quitar contra aplicar: se serializa por el acumulado |
| **Tiempo** | Fecha de día local, no futura; puede ser anterior | Idem | Se puede anular después, con motivo | El ticket puede ser de otro mes: se muestra, no se bloquea | Idem |
| **Incertidumbre** (corte de red) | El reintento con la misma clave lo resuelve | Idem | Idem | Idem; lo propuesto en pantalla se **revalida** al confirmar (el ticket pudo cambiar) | Idem |
| **Reintento automático** | Seguro (clave + huella) | Seguro | Seguro | Seguro | Seguro |
| **Error parcial** | Cabecera, líneas y auditoría juntas o nada | Anulación del viejo, alta del nuevo y copia de aplicaciones **juntas o nada** | Estado, motivo, espejos de lo aplicado y auditoría juntos | Filas de aplicación, acumulado y auditoría juntos; si una línea falla por el tope, **falla toda** la confirmación | Espejo, acumulado y auditoría juntos |
| **Datos faltantes** | Sin tipo, punto de venta, número, fecha, monto o sucursal: no confirma. Letra A sin CUIT: rechaza. Sin sugerencia (primera de la serie): no se pide fundamentación | Sin motivo del cambio: no corrige | Sin motivo: no anula | Ticket sin renglones (anterior a la activación): no se ofrece, figura «pendiente de completar». Ticket desactualizado: «emití primero el ticket corregido» | Sin motivo: no quita |
| **Cambio de permisos** | Se valida cada vez en el servidor y **por sucursal**; sin permiso de alta de ficha, solo puede elegir una ficha existente | Idem | Idem | Idem, y por la sucursal de cada ticket | Idem |
| **Ficha del receptor** | Inactiva: no se ofrece para comprobantes nuevos | Si la ficha se inactivó entre tanto, la copia congelada se mantiene | Sin efecto | — | — |
| **Notas de crédito y débito** | Sin factura afectada vigente, o de otra letra, sucursal o documento: rechaza | — | Anular una factura con notas de crédito vigentes: **PENDIENTE** (ver nota) | NC: acredita solo lo aplicado a su factura, por renglón; lo acreditado vuelve a pendiente (F-4) | — |

**Nota (anular una factura con notas vigentes):** la regla de Pedernal para su comprobante emitido es que una factura con notas de crédito no «deja de valer» salvo que quede **acreditada por completo**; para la externa hace falta decidir si se puede anular una factura que tiene una nota de crédito vigente, o si hay que anular primero la nota. Se propone **rechazar** (anular primero la nota; todo nace cerrado). Es técnico y reversible: va a pruebas, no a pregunta.

---

## 7. Niveles 8 y 9. Acceso, interfaces, consultas y experiencia

**Permisos (todos nacen excluidos; de contexto sucursal; nivel administrador; PROPUESTA):**

| Clave | Qué permite |
|---|---|
| `cargar_comprobante_externo` | cargar un comprobante |
| `corregir_comprobante_externo` | corregir (anular y volver a cargar) |
| `anular_comprobante_externo` | anular con motivo |
| `conciliar_comprobante_externo` | aplicar o quitar tickets y renglones (N2) |
| `administrar_puntos_de_venta` | declarar, renombrar y dar de baja puntos de venta (**lo tiene administración**, R1 del 04/11; no se siembra a gerente ni operario) |
| `administrar_conceptos_de_comprobante` | lista de conceptos (de empresa) |

Campos sensibles: `monto` e importes con piso administrador, como los de `FacturaProveedor`. Módulo `facturacion_externa` (DT-14).

**Pantallas (mobile first, 375 px; con datos reales de la empresa cuando se muestren al dueño):** (1) lista de comprobantes con filtros de sucursal, fecha, tipo, receptor y estado; (2) alta con **número sugerido** («Anteriormente se cargó la 00002417. Te sugiero la 00002418.» y el freno de C33 con segunda confirmación y fundamentación); receptor por CUIT con búsqueda y alta al instante (Parte); conceptos declarados; «sin explicar» visible; (3) conciliar: el comprobante **propone** tickets y renglones pendientes del receptor (o consumidor final) en esa sucursal y ventana de fechas, con cantidad a aplicar por renglón (por defecto, todo lo pendiente; solo enteros donde el renglón no es divisible) y el aviso de lo que sobra o falta; (4) puntos de venta; (5) conceptos; (6) «Tickets con renglones sin facturar», con la columna de cobro «pendiente de completar».

**Consultas:** el comprobante con sus aplicaciones y la diferencia; el ticket con lo facturado y lo pendiente por renglón (calculado, nunca guardado); la lista de pendientes. Listas paginadas por `(sucursal, fecha)`; el correlativo sale del índice único.

**Textos nuevos:** los de las pantallas son **propuesta**; el dueño aprueba una lista cerrada antes de construir (regla de textos de Pedernal que el dueño ya aplicó a costos y margen). Ninguno está aprobado.

---

## 8. Nivel 10. Pruebas, combinaciones, migración y operación

### 8.1 Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock

| Dimensión | Valores |
|---|---|
| Tipo | los 9 (factura, nota de débito, nota de crédito × A, B, C) |
| Receptor | sin documento (consumidor final); con DNI; con CUIT; con CUIT y ficha inactiva |
| Conceptos | ninguno; uno; varios; Σ igual al monto; Σ mayor al monto; con signo negativo |
| Número frente a lo sugerido | coincide; distinto con fundamentación; distinto sin ella; sin sugerencia; la sugerencia cambió mientras se escribía |
| Estado del comprobante | REGISTRADO; ANULADO |
| Tipo de renglón | divisible; fraccionario; con adicionales; promo |
| Cantidad a aplicar | 0; parcial; todo lo pendiente; más que lo pendiente |
| Ticket | de salón; de mostrador; anterior a la activación; desactualizado; con renglón de importe 0 |
| Origen del importe | parcial con reparto por restos mayores; entero |
| Nota de crédito | parcial; total; más que lo aplicado a su factura |
| Permiso | tiene; no tiene; tiene en otra sucursal |

Cuenta cruda aproximada: ~9 × 4 × 6 × 5 × 2 × 4 × 4 × 5 × 2 × 3 × 3 ≈ **millones**, de modo que **no se recorre a fuerza bruta**: el oráculo escrito aparte (`docs/oraculo-combinaciones-factura-externa-AAAA-MM-DD.md`) enumera **exhaustivamente** los grupos de N1 (tipo × receptor × número × estado × permiso, unos cientos de combinaciones, muchas colapsan en la misma regla) y para N2 usa **propiedades con `fast-check`** más cobertura por pares sobre el resto. Un **guardián** falla si aparece una columna, un valor de `tipo`, un acto o una clave de permiso sin declarar si afecta.

### 8.2 Tabla de reglas esperadas (fragmento del oráculo, PROPUESTA; el oráculo completo se escribe antes de construir)

| Tipo | Receptor | Cantidad | Ticket | Resultado esperado |
|---|---|---|---|---|
| Factura A | sin documento | — | — | **Rechaza** (A exige CUIT) |
| Factura B | consumidor final | todo lo pendiente | de salón, actualizado | Aplica; `facturado = vendido`; el renglón sale de pendientes |
| Factura B | DNI | parcial 2 de 4 | renglón divisible | Aplica 2; pendiente 2; el importe de la parte por restos mayores |
| Factura B | — | parcial | **promo** | **Rechaza** (combo indivisible) |
| Factura B | — | parcial | con adicionales | **Rechaza** (no divisible) |
| Factura B | — | más que lo pendiente | divisible | **Falla por el CHECK** (tope) aun con dos personas a la vez |
| Factura B | — | todo | de **mostrador** | No se ofrece (F-6) |
| Factura B | — | todo | anterior a la activación | No se ofrece; «pendiente de completar» |
| Factura B | — | todo | desactualizado | Rechaza («emití primero el ticket corregido») |
| Nota de crédito B | misma | parcial de lo aplicado | — | Acredita; **lo acreditado vuelve a pendiente** (F-4) |
| Nota de crédito B | misma | más que lo aplicado a su factura | — | **Rechaza** (E-12) |
| Nota de crédito B | otra letra o sucursal o documento | — | — | **Rechaza** (E-7) |
| Nota de débito B | cualquiera | — | — | Se **registra**; sin efecto en tickets hasta que el dueño responda la pregunta 2 |
| Cualquiera | — | — | línea ya facturada | **Corregirla o anularla por debajo de lo facturado se rechaza** (E-13) |

### 8.3 Pruebas obligatorias

(1) **Reglas puras** con `fast-check`: reparto por restos mayores (Σ partes = total al centavo; la última parte lleva el resto), suma de conceptos con signo, formato y rango del número, sugerencia del correlativo. (2) **Integración contra Postgres real** de cada CHECK, único y disparador. (3) **Concurrencia con el caso de uso real, tres veces cada una:** dos personas cargan el mismo número (gana una); **dos personas aplican sobre la última unidad de un renglón** (gana una, la otra falla por el tope); corregir contra anular; aplicar contra anular el comprobante; aplicar contra emitir el ticket corregido. (4) **Idempotencia:** el mismo envío no duplica comprobante, aplicaciones ni suma al acumulado. (5) **Atomicidad:** forzar un fallo a mitad de corregir, de anular y de aplicar → nada a medias. (6) **Solo inserción:** UPDATE y DELETE rechazados aun con el rol dueño donde corresponde. (7) **Aislamiento** entre empresas y entre sucursales (RLS). (8) **Migración** subir–bajar–subir sobre una copia con datos reales; el `down.sql` aborta si hay comprobantes o aplicaciones. (9) **Mutación:** quitar cada CHECK y disparador nuevo pone algún test en rojo. (10) e2e a 375 px de la carga, la corrección y la conciliación; accesibilidad con `axe`. (11) **Paridad:** la lista de 9 tipos y de alícuotas, y los patrones de documento, comparados con los de compras y los de la ficha (como `compras-fuente-unica` de Pedernal).

**Gate** (AGENTS.md; los ocho en la misma corrida y limpios): `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Guardianes que se tocan:** clasificación de tablas (`POR_SUCURSAL` o `POR_EMPRESA`), columnas de significado (declarar `monto`, `tipo`, `numero`, `cantidad`, `importe`, `receptorDocumentoNumero`), matriz de permisos y claves reservadas, campos sensibles, solo-agrega, denegación por defecto con control positivo.

### 8.4 Operación y riesgos

- Orden: Parte P1 → renglón congelado (documento aparte) → N1 → Parte P3 → N2. **Una migración por vez**, cada una con respaldo y ensayo en una rama de Neon, base por base; `down.sql` que aborta si hay datos.
- **Riesgos declarados:** (1) el correlativo sugerido puede equivocarse si en el otro sistema se emitió algo que acá no se cargó: es orientativo; (2) sin integración, la verdad del comprobante vive en el otro sistema; (3) conciliar por renglón agranda la pantalla (Pedernal estima su pantalla de facturar por cantidades como **L**; sin medir en Motor2); (4) tres casos de uso existentes cambian de comportamiento (DT-11); (5) permisos y un módulo nuevo son superficie de seguridad: auditoría independiente antes de fusionar; (6) cuando exista la emisión propia (E11) habrá que decidir qué se retira de esto; **no se decide acá**.
- **Tamaño relativo (mío, no medido):** N1 mediano; N2 grande.

---

## 9. Preguntas de NEGOCIO abiertas

**Q-1 (dato personal y modelo de datos). En una factura B a un consumidor final con DNI, ¿se guarda también la ficha de esa persona o solo se anota el DNI en el comprobante?**
- **Opción 1 (recomendada):** solo se anota en el comprobante (copia: nombre y DNI), sin crear ficha. Menos datos personales guardados y menos carga; la ficha se crea solo si la persona se vuelve cliente.
- **Opción 2:** se crea siempre una ficha (cada DNI queda cargado). Sirve para reconocerlo la próxima vez, pero guarda un dato personal por cada factura B.
- **Si no se responde:** se asume la opción 1 (declarado como supuesto); pasar a la opción 2 después es aditivo.

**Q-2 (dinero). ¿Qué efecto tiene una nota de débito externa sobre los tickets?** (el 04/11 solo diseñó la nota de crédito; pediste los nueve tipos)
- **Opción 1 (recomendada):** solo se **registra** (número, monto, receptor); no toca tickets ni renglones. Nace cerrado.
- **Opción 2:** se trata como un cargo extra que se explica con conceptos declarados (como el alojamiento).
- **Si no se responde:** opción 1.

**Q-3 (permisos). ¿Quién puede conciliar (aplicar tickets a una factura)?**
- **Opción 1 (recomendada):** administración y gerente (como cargar el comprobante); el operario no.
- **Opción 2:** también el operario de la sucursal.
- **Si no se responde:** opción 1 (los permisos nuevos nacen excluidos y se le da a quien se decida).

*(Las preguntas del renglón del ticket —tickets ya cerrados y renglones con adicionales— están en `docs/diseno-identidad-del-renglon-del-ticket-2026-11-15.md`; la del cliente sin ficha, en `docs/diseno-parte-ficha-unica-2026-11-15.md`.)*

---

## 10. Decisiones técnicas (resumen)

DT-1 a DT-16 (§4). Ninguna se le pregunta al dueño; la autorización de cada migración se pide aparte.

## 11. Diferencias con Pedernal, con su motivo

| # | Pedernal | Motor2 con este diseño | Motivo |
|---|---|---|---|
| X-1 | El comprobante de venta es el emitido, atado a ARCA; no existe registro de uno externo | Tabla propia espejando el comprobante de compra | **Decisión del dueño** (F-1: «hoy motor2 no está emitiendo…»); el precedente en Pedernal es el de compras |
| X-2 | Receptor con condición de IVA y domicilio copiados | Solo nombre, tipo y número de documento | No se emite; nadie lo pidió |
| X-3 | Desglose neto/IVA/exento y alícuotas | Solo `monto` | Nadie lo pidió; entra después como columnas opcionales |
| X-4 | Motivo obligatorio en una nota de crédito | No se pide | Nadie lo pidió |
| X-5 | `numeric(18,2)` | `DECIMAL(14,2)` | Convención de Motor2 y poda del dinero en `bigint` |
| X-6 | Puntero ticket → comprobante entero y único vigente (lo construido) | Aplicación por renglón o cantidad (lo decidido) | **Decisión del dueño** (F-5, F-10) |
| X-7 | `acreditacion_de_renglon` como tabla aparte (diseño) | Acto `ACREDITACION` con signo en la misma tabla | Precedente construido de su conciliación de compras; una tabla menos, mismo resultado |
| X-8 | Alojamiento: no existe | Concepto declarado con lista de la empresa | **Decisión del dueño** (04/11, punto 9) |
| X-9 | NC sin tope global | NC acredita solo lo aplicado a su factura, por renglón | La NC externa acredita renglones; se alinea con «una NC parcial por renglón queda limitada a lo facturado de ese renglón en esa factura» (DOC) |
| X-10 | Facturar solo un ticket `COBRADO` (lo construido) | Un ticket emitido, cobrado o no | **Decisión del dueño** (04/11: N2 va antes del cobro; en Pedernal el dueño decidió el 14/11 permitir facturar antes de cobrar, aún sin construir) |
| X-11 | Punto de venta de ARCA (con series y certificados) | Punto de venta **declarado** por sucursal, con nombre, sin validar contra ARCA | **Decisión del dueño** (04/11, punto 2, R1) |

## 12. NO VERIFICADO

1. La norma de ARCA sobre la serie por (punto de venta, tipo): se apoya en lo dicho por el dueño.
2. Si ya existe en `src/core` un reparto por restos mayores equivalente.
3. Que los cuatro casos de uso de DT-11 sean todos los que anulan o reemplazan una venta de cuenta cerrada.
4. El contenido de la decisión de Pedernal sobre varios emisores por ticket (no aplica a la externa).
5. Cómo se resuelve en Pedernal que el mismo punto de venta de ARCA lo use otro sistema (marcado pendiente allá, C19; acá es la situación normal y por eso la serie es solo sugerida).
6. Medidas reales: filas de producción, tamaño de la pantalla de conciliar.
7. Si el dueño quiere que una factura anulada con nota de crédito vigente se rechace o no (§6, nota): propuesta cerrada, falta su ratificación implícita en la prueba.

Autoría: este documento lo escribió **Sonnet** (sesión de diseño en papel). No hay código ni migraciones.
