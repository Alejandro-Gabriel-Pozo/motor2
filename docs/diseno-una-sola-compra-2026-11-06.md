# Diseño: una sola compra. Toda compra crea su factura (2026-11-06)

**Estado del documento:** diseño en papel para el dueño. No se implementó nada, no hay migraciones y no se corrió ningún test. Lo preparó un agente de planificación (Opus), leyendo `origin/main` (`e2a2baae`; el checkout local estaba en `35939e28`, un commit atrás, y los 16 archivos que cambian en ese commit se leyeron con `git show origin/main:…`) y la copia local de `motor2-docs` (último commit `582484a`, 2026-11-06).

**Estados:** CONFIRMADA (lo dijo el dueño), PROPUESTA, PENDIENTE, NO VERIFICADO. Lo que sale del código se marca **VERIFICADO** con archivo y línea.

**Decisión del dueño que este diseño respeta (2026-11-06, CONFIRMADA con supuesto declarado):** «No entiendo por qué habría dos compras. Pensé que siempre hubo una… está bien lo que vas a hacer». Toda compra queda como UNA factura de una o más partes. La anulación, la corrección, la nota de crédito y el pago se escriben una sola vez.

---

## 0. Resumen para el dueño

- **Tenés razón: en el negocio la compra es una sola.** El sistema hoy la guarda de dos formas según cómo se cargue. Si es de una sola sucursal y «pagada ahora», queda como un movimiento de stock con el número de factura escrito como texto. Si se reparte entre sucursales o queda «pendiente de pago», se crea un documento «factura» con sus renglones y sus partes. VERIFICADO (§1).
- **Ya lo habías decidido en octubre y nunca se terminó.** El 2026-10-06 dijiste: «tenerlo planeado… sin que los datos se transformen en otra cosa». De ahí salió la regla «toda compra con proveedor crea su factura desde el primer día y dice si se pagó al contado». El diseño de la factura repartida dejó ese paso con nombre propio (E3b) y no se construyó. VERIFICADO (`motor2-docs/_planes/_decisiones-del-dueno-2026-10-06.md:29`; `docs/diseno-factura-de-proveedor-e3a-2026-10-27.md:184`).
- **La pieza ya existe y ya se usa.** La compra «pendiente de pago» de una sola sucursal ya se guarda como factura de una sola parte, con el mismo stock que la compra simple. La propuesta es que **toda** compra pase por ese mismo camino. VERIFICADO (`src/app/(app)/movimientos/[proceso]/panel-compra-por-pasos.tsx:363-375`).
- **No hace falta tocar la base para unificar.** Las dos primeras etapas (U0 y U1) van sin migración. Como en producción no hay compras ni facturas, tampoco hay datos que convertir. La migración aparece recién cuando se construya «corregir el precio o la cantidad de un renglón» (U3), y esa etapa ya la necesitaba de todos modos.
- **Qué vas a notar:**
  - La pantalla de carga queda igual.
  - En «Compras registradas» habrá **un solo** botón «Anular», que pide el motivo, y un solo «Corregir datos» (proveedor, número y detalle).
  - Toda compra va a decir si se pagó: «Pagada al cargarla», «Pendiente» o «Pagada el…».
  - La nota de crédito y el pago se podrán enganchar a **cualquier** compra.
- **Recepción de la factura repartida (pediste «proponeme una solución»):** queda **un solo mecanismo**. La sucursal que carga recibe su parte en el acto. Cada otra sucursal **acepta** su parte desde su pantalla de Compra (y, cuando se construya, la **rechaza** con motivo). No hay un segundo paso de «recepción». Es lo más barato: no requiere código nuevo ni migración (§6.6).
- **Una sola pregunta abierta** (§14): si al cargar una compra «pagada ahora» querés que también se anote cómo se pagó.

---

## 1. Verificación del hallazgo (lo que dijeron las auditorías, contra el código)

| Afirmación | Estado | Evidencia |
|---|---|---|
| La compra simple de una sucursal es `Operacion` COMPRA + Kardex, con el número como texto (`Operacion.nroFactura`), por `registrarMovimiento` | VERIFICADO | `panel-compra-por-pasos.tsx:376-386`; `registrar-movimiento.ts:84-90` (número estructurado), `:212-225` (escritura); `prisma/schema.prisma:1134` |
| La compra repartida o pendiente de pago crea `FacturaProveedor` (renglones, partes, pago) por `registrarFacturaProveedor` | VERIFICADO | `panel-compra-por-pasos.tsx:349-375`; `registrar-factura-proveedor.ts:130-211` |
| El comentario dice que la pendiente de pago se arma como factura de una parte al 100 %, «mismo stock y Kardex que la compra simple» | VERIFICADO el comentario (`panel-compra-por-pasos.tsx:364`). Que el Kardex sea **idéntico** está NO VERIFICADO: el redondeo del precio por unidad se hace distinto en los dos caminos (`registrar-factura-proveedor.ts:188` usa `toFixed(4)`; el camino simple pasa el número sin redondear, `armar-filas-de-movimiento.ts:96-101`). Lo cierra la prueba de caracterización de U0.1 | |
| Hay dos anulaciones | VERIFICADO | `anular-compra.ts` (103 líneas, sin motivo, clave de reintento opcional, `:46-50`) y `anular-factura-proveedor.ts` (150 líneas, motivo obligatorio, permiso por sucursal, candado, `:52-80`). La segunda **reutiliza** las reglas y la escritura de la primera (`:88`, `:106`): ya es un superconjunto |
| Hay dos correcciones | **INEXACTO.** Hay **una** (`corregirCompra`, solo cabecera, solo compra simple). La factura **no tiene corrección**: se rechaza y se manda a «anulá y volvé a cargar» | `corregir-compra.ts:47-49`; `src/core/compras/compra-de-factura.ts:14-19` |
| Hay dos detectores de factura repetida | **PARCIAL.** El **rechazo** ya está unificado en una sola función, que mira las dos tablas (`comprobante-en-la-empresa.ts:27` y `:32-42`). Lo que está duplicado: (a) dos índices únicos en la base, uno por empresa en la factura y uno por sucursal en `Operacion`; (b) dos reconocedores del choque (`factura-unica.ts:68` y `:89`); (c) el **aviso** de posible repetida (C25) existe solo en la compra simple (`registrar-movimiento.ts:95-110`, `:189-197`) | Índices en `prisma/migrations/20260921230000_factura_unica_vigente/migration.sql:17-19` y `20261016101000_factura_proveedor/migration.sql:71-73` |
| La nota de crédito y el pago solo se enganchan a la compra «documento» | VERIFICADO | El pago tiene una clave foránea a la factura (`schema.prisma`, `PagoDeFacturaProveedor.facturaProveedorId`). La nota de crédito también (`NotaCreditoProveedor.facturaProveedorId`), pero hoy no tiene escritor (`docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md` §1a). Una compra simple no tiene a qué engancharse |
| El pago «al contado» de la compra simple no se guarda en ningún lado | VERIFICADO | La rama simple no manda condición de pago (`panel-compra-por-pasos.tsx:376-386`). La factura sí la guarda (`escribir-factura-proveedor.ts:43`) |
| En producción hay 0 compras y 0 facturas | **NO VERIFICADO desde el código** (no se puede). Lo que sí se comprobó: ninguna migración inserta facturas ni operaciones; `prisma/seed.ts` no crea compras. **Pero** los seeds de demostración sí crean compras simples por `registrarMovimiento`: `scripts/seed-demo-pizzeria.ts:472-569`, `scripts/seed-demo-pizzeria-6-meses.ts` y `scripts/demo-seed/guion.ts`. Las bases de demostración pueden tener compras simples viejas (supuesto S4, §14) | — |

---

## 2. Nivel 1. Propósito y necesidad

- **Necesidad (CONFIRMADA):** el dueño, 2026-11-06: «No entiendo por qué habría dos compras… está bien lo que vas a hacer». Hay dos antecedentes escritos:
  - decisión 5 del 2026-10-06 (`motor2-docs/_planes/_decisiones-del-dueno-2026-10-06.md:29`): «nada de lo que se escriba hoy debe necesitar reinterpretarse después», traducido a «toda compra con proveedor crea su cabecera desde el primer día y la cabecera declara “contado, pagada”»;
  - el plan de la factura repartida, decisión D-CABECERA-100 % con la variante H2 recomendada (`motor2-docs/_planes/plan-factura-repartida-entre-sucursales.md:14,188,266`).
- **Propósito (PROPUESTA):** que cada compra exista una sola vez, como factura de una o más partes, y que todo lo que se le hace (anular, corregir, nota de crédito, pago, devolución) tenga un solo lugar donde engancharse y una sola forma de hacerse.
- **Dentro del alcance:**
  - la carga (cualquier compra con proveedor y número);
  - la anulación;
  - la corrección de datos de la cabecera;
  - el lugar donde se enganchan el pago, la nota de crédito y la devolución;
  - la recepción de la parte de otra sucursal (pedido del dueño).
- **Fuera del alcance (CONFIRMADA o PROPUESTA según el caso):**
  - remitos y recepción separada en la misma sucursal: CONFIRMADA («solo carga de facturas sin remito por ahora», 2026-11-03);
  - gastos sin stock;
  - construir la nota de crédito (NC0, diseño propio);
  - construir la corrección de renglón por ajuste (diseño propio). Acá solo se dice cómo cambia;
  - cuenta corriente;
  - IVA desglosado.

---

## 3. Nivel 2. Actores y permisos (sin claves nuevas)

| Actor | Qué hace | Permiso (ya existe) | Estado |
|---|---|---|---|
| Operario o administrador de la sucursal | Carga la compra (una o varias partes) | `proceso_compra`. Si hay partes de otras sucursales, además `compra_repartir` (empresa, piso operario) | VERIFICADO `facturas-proveedor.ts:21-30`; `acciones.ts:107,240` |
| Operario de la sucursal destino | Acepta su parte | `proceso_compra` en la destino | VERIFICADO `facturas-proveedor.ts:34-40` |
| Administrador | Anula la compra (con motivo) | `anular_compra` en la sucursal activa, en cada sucursal con parte y en la que la cargó | VERIFICADO `anular-factura-proveedor.ts:52-64`; `acciones.ts:131` |
| Administrador | Corrige proveedor, número o detalle | `corregir_compra`, con la misma regla «en cada sucursal con parte y en la que la cargó» que la anulación | Clave VERIFICADA (`acciones.ts:133`); extenderla a varias sucursales es PROPUESTA |
| Quien confirma pagos | Declara o anula el pago de una compra pendiente | `declarar_pago_compra` (empresa) | VERIFICADO `pagos-factura-proveedor.ts:16-31` |

- **Ninguna clave nueva.** PROPUESTA (regla de poda).
- `compra_recibir` existe, está reservada y nada la usa (`acciones.ts:247`; `test/arquitectura/toda-accion-se-usa.test.ts:38`). Con la propuesta de §6.6 sigue sin uso: es candidata a poda, con aviso al dueño. PROPUESTA.

---

## 4. Nivel 3. Casos de uso

| CU | Caso | Hoy | Con este diseño | Etapa | Estado |
|---|---|---|---|---|---|
| CU1 | Compra de una sucursal, sin reparto, pagada ahora | `Operacion` suelta, sin factura, sin pago guardado | Factura de **una parte** (100 %, esta sucursal), `CONTADO_PAGADA` | U0 | CONFIRMADA la idea; forma PROPUESTA |
| CU2 | Compra repartida (con o sin parte propia) | Factura de N partes; las ajenas, propuestas | Igual | — | VERIFICADO, sin cambios |
| CU3 | Compra pendiente de pago (con o sin reparto) | Factura `PENDIENTE_DE_PAGO` | Igual | — | VERIFICADO, sin cambios |
| CU4 | Compra pagada ahora | Simple: no se guarda. Repartida: `CONTADO_PAGADA` | Siempre `CONTADO_PAGADA` («Pagada al cargarla») | U0 | CONFIRMADA (decisión 5 b, 2026-10-06); el medio, ver §14 |
| CU5 | Anular | Dos botones y dos comandos | **Uno:** anular la factura entera, con motivo | U1 | PROPUESTA |
| CU6 | Corregir datos de la cabecera (proveedor, número, detalle) | Solo en la compra simple; la factura se rechaza | **Uno:** sobre la factura, copiando el cambio a la compra de cada parte | U1 | PROPUESTA |
| CU7 | Corregir cantidad o precio de un renglón (error nuestro) | No existe (callejón sin salida) | Un solo mecanismo sobre la factura (E2 y E3 del diseño de corrección colapsan) | U3 | Necesidad CONFIRMADA (2026-11-06); forma PROPUESTA |
| CU8 | Nota de crédito del proveedor | Solo sobre factura documento; si no, «suelta» | Siempre puede ir «sobre factura»; la «suelta» queda para facturas que no están en el sistema | Al construir NC0 | Regla CONFIRMADA (nota sin factura sí, 2026-10-06); el resto PROPUESTA |
| CU9 | Devolución a proveedor | Movimiento suelto con número en texto, sin vínculo | Igual hasta NC1; el vínculo futuro llega a la factura por el renglón | NC1 | PROPUESTA |
| CU10 | Aceptar (y más adelante rechazar) la parte de otra sucursal | Propuesta → aceptación | **Único** mecanismo de recepción | — | ADR-041 VERIFICADO; el rechazo CONFIRMADO el 2026-11-03 (requiere migración, etapa 3 del diseño de factura única) |

---

## 5. Inventario: qué existe con otro nombre y qué se reutiliza

| Pieza | Qué hace hoy | Se reutiliza para | Estado |
|---|---|---|---|
| `registrarFacturaProveedorCasoDeUso` | Carga una factura de 1 o N partes. Ya es el «único escritor» de las tablas de la factura y ya trae el modo «una sola sucursal» | **La** puerta de carga de toda compra | VERIFICADO `registrar-factura-proveedor.ts:40-61`; E3a lo previó (`diseno-factura-de-proveedor-e3a:184`) |
| Factura de una parte | El panel ya la arma para «pendiente de pago sin reparto» | CU1 y CU4 | VERIFICADO `panel-compra-por-pasos.tsx:363-375` |
| `anularFacturaProveedorCasoDeUso` | Anulación entera y atómica, con motivo, candado, permiso por sucursal y regla de notas vigentes; revierte cada parte con las reglas de la compra simple | **La** anulación | VERIFICADO `anular-factura-proveedor.ts:48-150` |
| Reglas puras de corrección de cabecera | Normalizar, comparar, validar, mensajes | Corregir datos de la factura | VERIFICADO `src/core/compras/correccion.ts:48-102` |
| Permiso de la base para corregir la cabecera | La app ya tiene UPDATE por columna de `proveedorId`, `nroFactura`, `nroFacturaNormalizado`, `letra` y `detalleLibre` de la factura | Corregir datos **sin migración** | VERIFICADO `prisma/migrations/20261016101000_factura_proveedor/migration.sql:218-220` |
| Corrección en el lugar de `Operacion` | `corregirCompra` ya actualiza proveedor, número y detalle de la `Operacion` | La copia del cambio en la compra de cada parte | VERIFICADO `escribir-correccion-de-compra.ts` |
| Rechazo del número repetido en la empresa | Cerrojo + SERIALIZABLE + lectura de las dos tablas | Igual. Le falta excluir la propia factura al corregir (hoy solo excluye una `Operacion`) | VERIFICADO `comprobante-en-la-empresa.ts:20-43` |
| Aviso C25 (posible repetida, no bloquea) | Solo en la compra simple | Pasa al escritor de la factura | VERIFICADO `registrar-movimiento.ts:95-110,189-197` |
| `condicionPago` | `CONTADO_PAGADA` (por defecto) o `PENDIENTE_DE_PAGO` | CU4 sin cambio de esquema | VERIFICADO `schema.prisma:2788`; `escribir-factura-proveedor.ts:43` |
| Estado de pago visible | «Pagada al cargar» / «Pendiente» / «Pagada» | Toda compra | VERIFICADO `src/core/compras/pago-de-factura.ts:64-73` |
| Propuesta y aceptación | Parte de otra sucursal: propuesta pendiente → aceptada (entra stock, costo y gasto) | El único mecanismo de recepción | VERIFICADO `schema.prisma` `FacturaProveedorPropuesta`; ADR-041 |
| `FacturaProveedorSucursal.estadoRecepcion` | Columna PENDIENTE/RECIBIDA con disparador. El código la escribe **siempre** RECIBIDA | Queda como huella de «esta parte entró al stock» | VERIFICADO `escribir-factura-proveedor.ts:82`; `schema.prisma:2899` |
| Plan con la misma idea | D-CABECERA-100 % = H2; E3b | — | VERIFICADO (§2) |

**Conclusión:** no hace falta ninguna tabla ni columna para unificar. La compra simple es un caso particular de la factura (una parte al 100 %). El trabajo consiste en mandar todo por la puerta que ya existe y retirar la otra.

---

## 6. Niveles 4 y 5. Concepto, ciclo de vida, modelo e invariantes

### 6.1 Un solo concepto: la compra es una factura de una o más partes (PROPUESTA)

- **Factura (cabecera, de la empresa):** proveedor, número único, fecha, total con IVA, condición de pago y anulación.
- **Renglones:** lo comprado (producto, cantidad en unidad de stock, precio, unidad y cantidad compradas).
- **Partes:** cuánto le toca a cada sucursal. Cada parte recibida tiene **su** `Operacion` COMPRA y sus líneas de Kardex, atadas al renglón.
- **Factura de una sola parte:** una parte al 100 % en la sucursal que carga, recibida en el acto. Es exactamente lo que hoy arma la pendiente de pago. VERIFICADO `panel-compra-por-pasos.tsx:371`.
- **Ciclo de vida:** vigente → anulada. Nada se borra. La corrección por ajuste (U3) agrega «reemplazada por…». PROPUESTA.

### 6.2 Qué pasa con `Operacion.nroFactura` (PROPUESTA)

- Queda como **copia** del número de la cabecera en la compra de cada parte. La escribe solo el escritor de la factura (ya lo hace, `registrar-factura-proveedor.ts:168`). La corrección de datos la cambia junto con la cabecera, en la misma transacción.
- **Por qué no se borra:**
  - la leen Trazabilidad, el historial, Compras registradas, el aviso C25 y el índice por sucursal;
  - la **Devolución a proveedor** la usa como texto libre propio (`registrar-movimiento.ts:89`).
- Cambiar esos lectores no está pedido y no aporta nada a la unificación (alcance).
- **Invariante I-NUM:** en toda parte vigente, `Operacion.nroFactura` y `Operacion.proveedorId` son iguales a los de su factura. PROPUESTA (se prueba en U1).

### 6.3 Número único de comprobante (VERIFICADO; sin cambios)

- Se carga como letra + punto de venta + número y se guarda en forma canónica, «A-00023-00237728» (`compra.guard.ts:70`; `factura-proveedor.guard.ts:65-66`).
- La clave normalizada conserva la letra, «A:23-237728» (`numero-de-comprobante.ts:13-24`).
- La unicidad vigente en la empresa la da `FacturaProveedor_unica_vigente_key`.
- La columna `FacturaProveedor.letra` no se escribe (queda para la etapa 2 del diseño de factura única). La clave normalizada ya distingue letras, así que no hace falta para la unicidad.
- El índice por sucursal en `Operacion` queda como **segunda barrera redundante**. No se toca: borrarlo sería una migración sin beneficio.

### 6.4 `FacturaProveedor.estado` y `origen` (PROPUESTA)

- **Siempre `CONFIRMADA` y `CARGA`.** VERIFICADO que el escritor fija `CONFIRMADA` (`escribir-factura-proveedor.ts:37`); `origen` toma el valor por defecto `CARGA` (`schema.prisma:2786`).
- **`PENDIENTE_DE_REPARTO`** quedó sin uso desde E3a (`diseno-factura-de-proveedor-e3a:42,81`).
- **`MIGRACION`** no hace falta: no hay compras viejas que convertir.
- Ninguno de los dos se borra ahora: un guardián vigila que nada los escriba. Quedan como candidatos a poda, con aviso al dueño.

### 6.5 Pagos (PROPUESTA)

- Toda compra lleva su condición: `CONTADO_PAGADA` («Pagada al cargarla», la fecha es la de la factura) o `PENDIENTE_DE_PAGO`.
- Las reglas de Pagos X0 no cambian:
  - solo una pendiente admite que se declare el pago (`pago-de-factura.ts:56`);
  - a lo sumo un pago vigente;
  - anular la factura no anula el pago (P5 de `diseno-pagos-x0`).
- `fechaPagoDeclarada` y `medioPagoDeclarado` siguen sin uso (pregunta de §14).

### 6.6 Recepción de la factura repartida: un solo mecanismo (PROPUESTA; pedido del dueño)

Hoy conviven **tres** piezas pensadas para lo mismo. VERIFICADO:

1. la columna `estadoRecepcion` (PENDIENTE → RECIBIDA, con disparador, 2026-10-12): el código la escribe siempre RECIBIDA;
2. la clave `compra_recibir`: reservada, sin uso;
3. la **propuesta y aceptación** (ADR-041, 2026-10-28): es la que funciona.

| Opción | Qué es | Costo | Recomendación |
|---|---|---|---|
| **A. La propuesta es el único mecanismo** | La sucursal que carga recibe su parte en el acto. Cada otra sucursal acepta (y más adelante rechaza) desde su Compra. `estadoRecepcion` queda siempre RECIBIDA: significa «esta parte entró al stock», que es lo que pedía la decisión del 2026-10-12 | Cero código. Un guardián. La poda de lo sobrante, más adelante y con autorización | **Sí** |
| B. Usar `estadoRecepcion` PENDIENTE para las partes ajenas | La parte nace pendiente y la destino la marca recibida | La base no deja que la app anote la compra de la parte después (sin UPDATE de `operacionId`: `diseno-factura-de-proveedor-e3a:11`). Requiere migración y duplica la propuesta | No |
| C. Propuesta + recepción aparte | Aceptar y, después, «recibir» | Dos pasos para lo mismo. Solo tendría sentido con remitos, que están fuera del alcance (CONFIRMADA 2026-11-03) | No |

- **El rechazo con motivo**, cuando se construya, va sobre la misma propuesta (estado RECHAZADA y la parte vuelve a la sucursal que la envió). CONFIRMADA el 2026-11-03; requiere migración (etapa 3 de `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md`).
- **Candidatos a poda** (aviso al dueño; cada uno requiere autorización expresa; **no se recomienda hacerlo ahora**): el valor por defecto PENDIENTE y el disparador de `estadoRecepcion`; la clave `compra_recibir`; el estado `PENDIENTE_DE_REPARTO`.

### 6.7 Invariantes (PROPUESTA salvo indicación)

| # | Regla |
|---|---|
| U-I1 | Toda `Operacion` COMPRA nueva escrita por `src/` pertenece a una parte de factura: alguna de sus líneas lleva `facturaProveedorRenglonId`. Hoy vale solo para la repartida y la pendiente |
| U-I2 | Un solo escritor de `Operacion` COMPRA en `src/`: el escritor de la factura (al cargar y al aceptar). Lo vigila un guardián de arquitectura |
| U-I3 | Una factura vigente por (empresa, proveedor, número normalizado). VERIFICADO, índice existente |
| U-I4 | La suma de las partes es igual al total, por renglón (dinero y cantidad). VERIFICADO `registrar-factura-proveedor.ts:254-263` |
| U-I5 | La anulación es entera y atómica: se bloquea si cualquier parte se consumió, si hubo un conteo posterior o si hay notas vigentes. VERIFICADO (CONFIRMADA D-ANUL) |
| U-I6 | Cabecera siempre `CONFIRMADA`/`CARGA`; parte siempre `RECIBIDA` |
| U-I7 | I-NUM (§6.2) |
| U-I8 | Nada cambia en stock, costo vigente ni gasto por cargar una compra de una sucursal como factura de una parte en vez de compra simple. Lo prueba U0.1 |

---

## 7. Nivel 6. Persistencia por etapa

| Etapa | Tablas o columnas | ¿Migración? |
|---|---|---|
| U0 y U1 | Ninguna nueva. Se escriben las que ya existen (`FacturaProveedor*`), también para la compra de una sucursal | **Ninguna** |
| U2 (nota de crédito, pago, recepción) | Ninguna por la unificación (NC0 tiene sus tablas, aplicadas el 2026-10-13) | **Ninguna** |
| U3 (corrección de renglón por ajuste) | Un enlace «esta factura reemplaza a aquella» (por ejemplo, `FacturaProveedor.reemplazaAFacturaId`, único y nulable) y, si el diseño de corrección lo mantiene, ampliar el CHECK de `Operacion.reemplazaAOperacionId` a COMPRA | **Sí, aditiva y reversible. Requiere autorización expresa**, base por base, con respaldo y ensayo en una rama de Neon |
| Poda (opcional, después) | `estadoRecepcion` por defecto y disparador; `PENDIENTE_DE_REPARTO`; `compra_recibir`; `MovimientoStock.unidadCompraId`/`cantidadCompra`, que dejan de escribirse porque lo comprado vive en el renglón; `fechaPagoDeclarada`/`medioPagoDeclarado` | **Requiere autorización expresa** cada una. No recomendada ahora |

- **No se propone** un CHECK «toda COMPRA tiene factura» en la base (FR2.6 del plan de octubre). Rompería 96 archivos de test que crean compras directo como dato de partida y las bases de demostración. Alcanza con el guardián U-I2. PROPUESTA.

---

## 8. Nivel 7. Atomicidad y concurrencia

Cada comando corre en **una** transacción SERIALIZABLE con reintento (`conTransaccionSerializable`). VERIFICADO en los tres casos de uso existentes.

### 8.1 ¿Qué pasa si…? «Cargar compra» (toda compra: `registrarFacturaProveedor`, y `registrarMovimiento` COMPRA como adaptador)

| Situación | Qué pasa | Estado |
|---|---|---|
| Repetición (doble clic, reenvío) | Misma clave y mismo contenido: devuelve el mensaje original y no escribe nada. Misma clave con otro contenido: conflicto. La clave y la huella viven en la cabecera | VERIFICADO `registrar-factura-proveedor.ts:76-78,85-87` |
| Concurrencia: el mismo número cargado a la vez en dos sucursales | Cerrojo por empresa + proveedor + número, SERIALIZABLE y el índice de la factura: gana una; la otra recibe «Ya hay una factura de este proveedor con ese número…» | VERIFICADO `comprobante-en-la-empresa.ts:25`; `registrar-factura-proveedor.ts:243-244` |
| Concurrencia: la misma clave desde dos pestañas | La segunda ve a la ganadora al reintentar: «repetida» | VERIFICADO `:245-249` |
| Tiempo | Fecha de la factura ≤ hoy (Argentina). Stock y costo al mediodía de ese día. La parte ajena entra en la fecha de stock que elige la destino al aceptar | VERIFICADO `factura-proveedor.guard.ts:46`; `guardComandoAceptarParteDeFactura` |
| Incertidumbre («¿se guardó?») | La pantalla conserva la clave hasta el éxito; reenviar devuelve el mismo mensaje | VERIFICADO `panel-compra-por-pasos.tsx:401` |
| Reintento por conflicto de serialización | Automático, con la misma clave | VERIFICADO |
| Error parcial | Todo o nada: cabecera, renglones, `Operacion`, Kardex, parte, propuestas, vínculo proveedor↔producto y auditoría | VERIFICADO `:84-241` |
| Datos faltantes | Sin proveedor, número, sección o renglones: rechazo sin escribir. Precio 0: avisa y no bloquea | VERIFICADO `factura-proveedor.guard.ts:35-73` |
| Cambio de permisos en el medio | Vale lo que se miró al entrar (`proceso_compra`; `compra_repartir` si hay partes ajenas), como en todo el sistema | VERIFICADO `facturas-proveedor.ts:22-28` |
| Pantalla vieja abierta durante el despliegue (llama a `registrarMovimiento` COMPRA) | El adaptador la convierte en factura de una parte: nunca vuelve a nacer una compra sin factura | PROPUESTA (U0.4) |
| Posible repetida con otro número (aviso C25) | Avisa sin bloquear, para toda carga | PROPUESTA (U0.2; hoy solo en la simple) |

### 8.2 ¿Qué pasa si…? «Anular compra» (= anular la factura entera)

| Situación | Qué pasa | Estado |
|---|---|---|
| Repetición | Misma clave: mismo mensaje. Otra clave sobre una ya anulada: «La factura ya está anulada» | VERIFICADO `anular-factura-proveedor.ts:67-73,129` |
| Concurrencia con una aceptación | Candado sobre la cabecera. Si una destino aceptó entre la lectura de permisos y el candado: «la factura cambió mientras la anulabas, volvé a intentarlo» | VERIFICADO `:71,76-79` |
| Concurrencia con una venta que consume el stock | SERIALIZABLE: una reintenta y la regla «lo comprado sigue en stock» se evalúa con el saldo real | VERIFICADO |
| Concurrencia con declarar un pago | Las dos toman el candado de la cabecera: se turnan | VERIFICADO `declarar-pago-de-factura-proveedor.ts` (paso 2) |
| Tiempo | Sin plazo. Un conteo posterior del mismo producto y sección bloquea (D7) | VERIFICADO `:93-100` |
| Incertidumbre | Reenviar con la misma clave | VERIFICADO |
| Reintento | Automático | VERIFICADO |
| Error parcial | Si una parte no se puede anular, no se anula ninguna | VERIFICADO `:82-102` |
| Datos faltantes | Motivo obligatorio (1 a 200 caracteres) | VERIFICADO `factura-proveedor.guard.ts:89-98` |
| Cambio de permisos | `anular_compra` en la activa, en cada sucursal con parte y en la que la cargó; si falta en una, se rechaza nombrándola | VERIFICADO `:52-64` |
| Mercadería ya vendida | Se rechaza (`STOCK_CONSUMIDO`). La salida es una devolución con nota de crédito o, en U3, la corrección por ajuste | VERIFICADO; U3 PROPUESTA |
| Pago declarado vigente | No bloquea; la factura anulada deja de contar como deuda (P5) | VERIFICADO en el diseño X0 |
| Nota de crédito vigente | Se rechaza (`CON_NOTAS_DE_CREDITO`) | VERIFICADO `:80` |

### 8.3 ¿Qué pasa si…? «Corregir datos de la compra» (proveedor, número, detalle; nuevo sobre la factura, PROPUESTA)

| Situación | Qué pasa |
|---|---|
| Repetición | Idempotente por estado, como hoy: si ya tiene lo pedido, «no hay nada que corregir» (sin clave). VERIFICADO el molde `corregir-compra.ts:53-54` |
| Concurrencia con otra corrección | Primero el candado sobre la cabecera (`bloquearFactura`) y después la guarda optimista «lo que viste es lo que está»: si no coincide, «cambió mientras la editabas» |
| Concurrencia con una aceptación | El candado de la cabecera serializa. La parte aceptada copia el número **después** del candado, así nunca queda con el número viejo (I-NUM). **Sin el candado podría quedar desparejo**: por eso es lo primero |
| Concurrencia con la anulación | Candado; si ya se anuló, «una compra anulada no se corrige» |
| Número nuevo que ya usa otra factura | Rechazo de la empresa (cerrojo + SERIALIZABLE), excluyendo la propia factura; segunda barrera, el índice. El mensaje es el mismo de la carga |
| Tiempo | La fecha **no** se corrige acá: cambia el período del gasto, así que va por la corrección por ajuste (U3) |
| Incertidumbre | Reenviar: «nada que corregir» |
| Error parcial | La cabecera y la copia en la compra de cada parte van en la misma transacción |
| Datos faltantes | Número obligatorio y estructurado; proveedor obligatorio y activo (mismas reglas puras de hoy) |
| Cambio de permisos | `corregir_compra` en la activa, en cada sucursal con parte y en la que la cargó (mismo molde que la anulación) |
| Notas de crédito vigentes y cambio de proveedor | La base lo rechaza (clave foránea de tres columnas, VERIFICADO `schema.prisma`, `@@unique([empresaId, id, proveedorId])`). Se traduce a «primero anulá las notas» |
| Propuestas pendientes | No guardan el número; al aceptar se copia el vigente |

### 8.4 Comandos sin cambios: aceptar parte, declarar pago, anular pago

Rigen sus tablas vigentes (`diseno-factura-de-proveedor-e3a` §9; `diseno-pagos-x0` §6). Lo único nuevo: ahora alcanzan también a la compra de una sucursal. Por ejemplo, una compra de una parte cargada «pendiente de pago» ya funciona hoy.

---

## 9. Niveles 8 y 9. Interfaces y experiencia

**Server Actions (PROPUESTA):**

| Acción | Destino |
|---|---|
| `registrarFacturaProveedor` | Se queda. Es la carga |
| `aceptarPropuestaDeFactura` | Se queda |
| `anularFacturaProveedor` | Se queda. Es la anulación |
| `declararPagoDeFacturaProveedor` / `anularPagoDeFacturaProveedor` | Se quedan |
| `corregirFacturaProveedor` | **Nueva**, en `facturas-proveedor.ts`. Reemplaza a `corregirCompra` |
| `registrarMovimiento` con COMPRA | Adaptador fino al caso de uso de la factura (una parte, contado). Se mantiene por compatibilidad: seeds y 113 archivos de test lo usan para cargar stock |
| `anularCompra`, `corregirCompra` | **Se retiran** (U1) |

**Pantallas (PROPUESTA):**

- **Carga por pasos:** sin cambios visibles. El mensaje de una compra de una sucursal pagada ahora es el de hoy («Se guardaron N movimiento(s)…», con los avisos), para no cambiar lo que la persona lee.
- **Compras registradas:**
  - cada fila es una compra (factura) con su estado de pago;
  - un solo «Anular» (con motivo) y un solo «Corregir datos»;
  - desaparece la frase «Es la parte de esta sucursal en una factura de proveedor: no se corrige ni se anula sola…» (`page.tsx:189`), porque deja de ser una excepción. En una repartida se dice «Repartida: también tiene partes en X e Y».
- **Bandeja «Para aceptar»:** sin cambios. Es el único lugar de recepción.
- **Escalera de producto (compras):**
  - N0 (hoy): dos caminos;
  - N1 (U0+U1): una compra, una anulación, una corrección de datos, pago visible en todas;
  - N2 (U3): corregir un renglón;
  - lo que falta se muestra «pendiente de completar». Por ejemplo, el medio de pago de una compra pagada al cargarla, si la respuesta a §14 es «no».

---

## 10. Impacto en reportes y en la corrección por ajuste

**Reportes (VERIFICADO que leen `Operacion` COMPRA vigente, no la cabecera):**

| Reporte | Cómo lee | Cambio esperado |
|---|---|---|
| Gasto del período | Líneas COMPRA de operaciones no anuladas (`src/core/reportes/periodo-compras.ts:40-46`) | **Ninguno.** La parte de una factura es una `Operacion` COMPRA igual que la simple |
| Costo vigente (V-T1) | Entrada valorizada más reciente, no anulada, ordenada por `Operacion.fecha` (`src/server/lecturas/reportes/comun.ts:115-178`) | **Ninguno** (lo prueba U0.1, incluido el redondeo del precio por unidad) |
| Compras anuladas | Guardián: todo filtro de COMPRA decide sobre anuladas (`test/arquitectura/reportes-compras-anuladas.test.ts`). La anulación de factura marca anulada la `Operacion` de cada parte (`escribir-anulacion-de-compra.ts`) | **Ninguno** |
| Compras registradas | Una fila por `Operacion` COMPRA de la sucursal, con el pago de su factura (`src/server/consultas/reportes/compras-registradas.ts:53-58`) | Toda fila trae `facturaProveedorId` y pago |
| Unidad y cantidad compradas | En la compra simple viven en `MovimientoStock`; en la factura, en el renglón. **No se encontró** ningún reporte que lea las de `MovimientoStock` | Ninguno visible. Las columnas de `MovimientoStock` dejan de escribirse (candidatas a poda) |

**Corrección por ajuste** (`docs/diseno-correccion-por-ajuste-2026-11-06.md`):

- **E2 (compra simple) y E3 (factura documento) colapsan en una sola etapa, U3.** Ya no hay compra simple. PROPUESTA.
- **Consecuencia de diseño.** En la factura, el renglón y el total «nunca se modifican» (`schema.prisma`, `importeTotal`), y la parte apunta a su `Operacion` sin poder cambiarla. Por eso el «registro nuevo que apunta a A» tiene que existir **también en el documento**: una factura B, con el mismo número, que reemplaza a la A. La A queda marcada con el motivo. La compra de cada parte se revierte y se vuelve a cargar con lo corregido, en la misma transacción.
  - Es «anular y volver a cargar» en un paso, con enlace. La regla de rechazo pasa a mirar la **diferencia neta** de stock (I5 del diseño de corrección), así se acepta aunque ya se haya vendido mercadería.
  - Las decisiones del dueño se mantienen. El costo vigente pasa a ser el precio corregido; si hubo una compra posterior, sigue el de la más nueva, porque B lleva la misma fecha que A y V-T1 ordena por fecha.
  - **Requiere autorización expresa** (§7). Hay que actualizar §5 y §9 del diseño de corrección: hoy dicen E2 con «ampliar el CHECK de reemplaza a COMPRA» y E3 PENDIENTE.
- **La corrección de cabecera** sigue siendo en el lugar, con auditoría por campo (deuda H11 ya declarada). Solo se muda de la compra a la factura (U1). Que pase al mecanismo de reemplazo es parte de U3. Supuesto S3.

---

## 11. Etapas (la más barata primero)

| Etapa | Qué entrega | Migración | Qué se retira |
|---|---|---|---|
| **U0 «una sola puerta para cargar»** | (1) Línea de base y prueba de caracterización: la misma compra por los dos caminos da el mismo Kardex, stock, costo y gasto. (2) El escritor de la factura gana lo que solo tenía la compra simple: el aviso C25 y el mensaje de una parte igual al de hoy. (3) El panel llama **siempre** a `registrarFacturaProveedor` (se borra la tercera rama, `panel-compra-por-pasos.tsx:376-386`, y se juntan la primera y la segunda). (4) `registrarMovimiento` COMPRA delega en el mismo caso de uso y devuelve la `operacionId` de la parte. (5) Guardianes U-I1, U-I2 y U-I6 | **Ninguna** | Las ramas COMPRA de `registrar-movimiento.ts` (número, C25, referencia, vínculo y rechazo: ~65 líneas en `:84-90,95-110,128-131,155-165,189-197,234-251`) |
| **U1 «una sola anulación y una sola corrección»** (sale **junto con U0**) | (1) Caso de uso «corregir datos de la factura» (§8.3), con las reglas puras de `correccion.ts`. (2) `hayComprobanteVigenteEnLaEmpresa` acepta «excluir esta factura». (3) Compras registradas con un solo juego de botones. (4) Se migran los tests de anular y corregir compra a los de la factura (con motivo) | **Ninguna** | `anularCompra` y `corregirCompra` (acción, caso de uso, botón, guards y tipos); `compra-de-factura.ts`; `cargar-compra-para-corregir.ts`; `escribir-correccion-de-compra.ts` se absorbe |
| **U2 «todo cuelga de la factura»** | Sin código propio de la unificación. NC0 y Pagos alcanzan a toda compra; la recepción queda en la propuesta (§6.6). Hay que actualizar los documentos `diseno-notas-de-credito` (la «suelta» solo para facturas que no están en el sistema) y ADR-029/041 (nota breve o un ADR «toda compra es una factura») | **Ninguna** | — |
| **U3 «corregir un renglón»** (E2+E3 del diseño de corrección) | Corrección por reemplazo a nivel factura (§10) | **Sí. Requiere autorización expresa** | El rechazo «anulá y volvé a cargar» para errores de renglón |
| **Poda** (opcional) | §7, última fila | **Requiere autorización expresa** cada una | Columnas, estados y la clave sin uso |

- **Por qué U0 y U1 salen juntas.** Si U0 sale sola, toda compra nueva queda «de factura», y la corrección de cabecera de hoy rechaza las compras de factura (`corregir-compra.ts:47-49`). Se perdería «Corregir proveedor, número o detalle» hasta que llegue U1. PROPUESTA.
- **Por qué primero el aviso C25 y el mensaje.** Si el panel cambia antes, la compra de una sucursal pierde el aviso de posible repetida y cambia su mensaje. Sería una regresión.

---

## 12. Nivel 10. Pruebas y oráculo de combinaciones

### 12.1 Oráculo (tabla de reglas escrita aparte del código; PROPUESTA: `docs/oraculo-combinaciones-una-sola-compra-AAAA-MM-DD.md`, a crear con la implementación)

**Dimensiones:**

- **D1 reparto:** sin reparto (1 parte propia) / repartida con parte propia / repartida sin parte propia.
- **D2 pago:** contado / pendiente sin pago / pendiente con pago vigente / pendiente con pago anulado.
- **D3 anulada:** no / sí.
- **D4 nota de crédito:** ninguna / vigente / anulada.
- **D5 devolución de una parte:** no / sí.
- **D6 mercadería vendida (en alguna parte):** nada / parte / toda.
- **D7 partes ajenas:** sin ajenas / pendientes / aceptadas.

**Reglas esperadas (salidas):**

| Salida | Regla |
|---|---|
| O1 stock por sucursal | La parte propia entra al cargar; la ajena, al aceptar. Anulada: neto 0 en todas. Devolución: resta en su sucursal |
| O2 gasto del período (por sucursal) | Suma de la compra de su parte, vigente. Anulada: 0. Devolución y nota no lo cambian (NC2 pendiente) |
| O3 costo vigente | El de la compra vigente más reciente. Anulada: se excluye. Nota y devolución: no lo cambian |
| O4 pago visible | Contado: «Pagada al cargarla». Pendiente sin pago: «Pendiente». Con pago: «Pagada el…». Anulada: no aparece como deuda |
| O5 ¿se puede anular? | No si: D3 sí (`YA_ANULADA`); D4 vigente (`CON_NOTAS_DE_CREDITO`); D6 ≠ nada o D5 sí (`STOCK_CONSUMIDO`); conteo posterior (`CONTEO_POSTERIOR`); falta permiso en una sucursal con parte. El pago y las ajenas pendientes **no** bloquean |
| O6 ¿se pueden corregir datos? | No si D3 sí. Con D4 vigente, no se puede cambiar el proveedor. D2, D5 y D6 no influyen |
| O7 ¿se puede declarar pago? | Solo D2 «pendiente sin pago» o «pago anulado», y D3 no |
| O8 ¿se puede cargar nota sobre factura? | D3 no, y dentro del tope (NC0) |

**Cómo se prueba:**

- Test exhaustivo sobre las reglas puras: 3×4×2×3×2×3×3 = 1.296 casos, rápido.
- Integración con la base por **pares** (unas 20 filas, `fast-check` o pares a mano; sin librerías nuevas).
- **Guardián:** falla si aparece una columna nueva en `FacturaProveedor`, `FacturaProveedorSucursal` o `PagoDeFacturaProveedor`, o un valor nuevo de condición, estado o recepción, sin declarar si afecta. Molde existente: `test/arquitectura/guardas/columnas-de-significado.ts:156-158`.

### 12.2 Pruebas

- **Caracterización (U0.1, antes de tocar nada):** la misma compra por `registrarMovimiento` (camino viejo) y por la factura de una parte da las mismas filas de Kardex (producto, sección, cantidad, `precioTotal`, `precioPorUnidadStock`, lote), el mismo saldo, el mismo costo V-T1 y el mismo gasto. Diferencias permitidas, enumeradas: `facturaProveedorRenglonId`; la unidad comprada pasa al renglón; la clave de reintento pasa a la cabecera.
- **Invariancia sobre el seed de demostración:** totales de stock por sección, gasto por período, costo de reposición y compras anuladas **iguales** antes y después del cambio (el seed carga por `registrarMovimiento`, que ahora delega).
- **Concurrencia** (caso de uso real, con clientes como `motor2_app`):
  - 8 cargas con la misma clave → 1 factura, 1 `Operacion`;
  - el mismo número con dos claves en dos sucursales → 1 éxito + `FACTURA_DUPLICADA`;
  - anular contra aceptar;
  - corregir contra aceptar: al terminar, toda parte vigente tiene el número de su cabecera (I-NUM);
  - corregir contra anular;
  - corregir el número contra una carga simultánea de ese número;
  - anular contra declarar pago;
  - con mutación: sacar el candado de «corregir» tiene que poner rojo el test I-NUM.
- **Idempotencia:** `registrarMovimiento` COMPRA reenviado → mismo mensaje y una sola factura; la misma clave con otro contenido → conflicto; anular con la misma clave → mismo mensaje.
- **Guardianes:** U-I1 (toda COMPRA nueva tiene parte), U-I2 (único escritor), U-I6 (estado, origen y recepción constantes).
- **Áreas a mirar:**
  - `test/arquitectura/idempotencia-i3-cobertura-concurrente.test.ts`, `test/persistencia/kardex-escritores-huella.test.ts` y `test/arquitectura/caracterizaciones-congeladas.test.ts`;
  - las 7 suites del camino viejo (§13);
  - los e2e `compras-anular.spec.ts`, `compras-corregir.spec.ts`, `compras-registradas.spec.ts`, `movimientos-compra-wizard.spec.ts`, `movil-compra-por-pasos.spec.ts` y `factura-repartida.spec.ts`.

---

## 13. Líneas que se evitarían (medidas con `wc -l` en `origin/main`)

**Se retiran enteras (U1):**

| Archivo | Líneas |
|---|---|
| `src/server/actions/movimientos/casos-de-uso/anular-compra.ts` | 103 |
| `src/server/actions/movimientos/compras.ts` (sus dos acciones; la de corrección renace, más chica, en `facturas-proveedor.ts`) | 77 |
| `src/app/(app)/reportes/compras/boton-anular-compra.tsx` | 31 |
| `src/core/compras/compra-de-factura.ts` | 24 |
| `src/server/persistencia/compras/cargar-compra-para-corregir.ts` | 49 |
| `src/server/persistencia/compras/escribir-correccion-de-compra.ts` (se absorbe) | 15 |
| **Subtotal** | **299** |

**Se recortan:**

- ramas COMPRA de `registrar-movimiento.ts`: ~65 (rangos de §11, contados por línea, no por `wc`);
- guards y tipos de anular y corregir compra en `compra.guard.ts` (114) y `compra.schema.ts` (95): ~85;
- la rama simple del panel: ~12;
- la rama `!c.facturaProveedorId` de `reportes/compras/page.tsx`: ~20.

**Se agregan:**

- el caso de uso «corregir datos de la factura» (~100, reemplaza a `corregir-compra.ts`, de 99);
- el adaptador de `registrarMovimiento` COMPRA (~25);
- el aviso C25 en el escritor de la factura (~20, se mueve).

**Neto estimado en `src/`:** entre −300 y −350 líneas, y un solo camino por comando.

**Tests del camino viejo:** 1.714 líneas en 7 suites. Se fusionan con las de la factura, no se ahorran enteras:

| Suite | Líneas |
|---|---|
| `test/casos-de-uso/anular-compra.test.ts` | 460 |
| `test/movimientos/compras-anular.test.ts` | 355 |
| `test/movimientos/compras-corregir.test.ts` | 280 |
| `test/core/compras-anulacion.test.ts` | 276 |
| `test/casos-de-uso/corregir-compra.test.ts` | 154 |
| `test/core/compras-correccion.test.ts` | 97 |
| `test/movimientos/compra-de-parte-de-factura.test.ts` (desaparece: la excepción deja de existir) | 92 |

Hay además 21 archivos de test que llaman a `anularCompra` y 9 a `corregirCompra`.

---

## 14. Pregunta abierta y supuestos

**Pregunta 1 (cambia qué se registra del dinero).** Al cargar una compra «Pagada ahora», ¿querés que el sistema pregunte también **cómo** se pagó (efectivo, transferencia, cheque, tarjeta u otro)?

- **Recomendación: no por ahora.** Se guarda «Pagada al cargarla» con la fecha de la factura, y el medio se muestra «pendiente de completar». Las columnas para el medio existen, pero están marcadas para podar porque el pago declarado vive en otro registro. Usarlas abriría un segundo lugar para el mismo dato.
- Si decís que sí, se diseña aparte: probablemente que el contado también cree su registro de pago.

**Supuestos declarados** (el dueño los corrige si no son así):

- **S1.** Anular cualquier compra pide motivo. Hoy la compra simple no lo pedía; la factura sí.
- **S2.** Corregir datos y anular una compra repartida piden el permiso en cada sucursal con parte y en la que la cargó, como la anulación de hoy.
- **S3.** La corrección de cabecera sigue siendo en el lugar (deuda H11) hasta U3.
- **S4.** Las bases de demostración se vuelven a sembrar después de U0. Las compras simples viejas que tengan quedan visibles, pero ya no se anulan ni corrigen desde la app.
- **S5.** El aviso C25 vale para toda carga. En una repartida compara el total de la factura contra la compra de cada parte; puede no avisar en algún caso, y no bloquea nunca.
- **S6.** `registrarMovimiento` COMPRA se mantiene como adaptador, no se borra (seeds y 113 tests).

---

## 15. Verificación final obligatoria (para cada etapa, cuando se implemente)

1. **Línea de base, en `main`, antes de tocar nada:**
   - el conteo de tests de `npm test` y de specs de `npm run test:e2e`;
   - knip con 0 hallazgos;
   - sobre el seed de demostración: los totales de stock, gasto, costo de reposición y compras anuladas.
2. **Pasos chicos.** Reglas puras y su test → persistencia → caso de uso → pantalla. Un commit por paso, reversible con `git revert`. El código lo escribe Sonnet (regla del 2026-11-04).
3. **Los 8 comandos del gate**, en la **misma** corrida:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run arquitectura`
   - `npm run analizar:muerto` (0 hallazgos; nada nuevo en `knip.jsonc` sin motivo)
   - `npm test`
   - `npm run build`
   - `npm run plataforma:build`
   - `npm run test:e2e`
4. **Criterio de éxito conjunto:**
   - los 8 terminan con código 0 en la misma corrida y «Gate (requerido)» queda verde;
   - el conteo de tests es mayor o igual que la línea de base menos los tests retirados de §13 (cada uno enumerado y con su reemplazo) más los nuevos;
   - la caracterización U0.1 y la invariancia sobre el seed dan **exactamente** la línea de base;
   - cada test nuevo tiene su mutación demostrada en rojo;
   - ninguna lista de deuda o excepción crece.

---

## 16. No verificado

- Que no existan en producción compras ni facturas: es la palabra del dueño. Desde el código solo se comprobó que nada las crea fuera de la app y de los seeds de demostración.
- Que el Kardex de la factura de una parte sea idéntico al de la compra simple en el redondeo de `precioPorUnidadStock` (§1). Lo cierra U0.1.
- Cuántos de los 113 tests que cargan compras por `registrarMovimiento` comparan el mensaje exacto (12 archivos de test contienen «Se guardaron»), o leen `Operacion.claveIdempotencia` de una compra.
- Cómo ve y anula la sucursal que cargó una factura **sin** parte propia: Compras registradas lista por `Operacion` de la sucursal, y esa sucursal no tiene ninguna. Hoy existe «Lo que cargué» (`listarPropuestasEnviadas`); no se leyó si trae «Anular».
- Si `zuluhub-demo` o `motor2-demo` tienen hoy compras simples cargadas.

---

### Archivos críticos para implementar

- `src/server/actions/movimientos/casos-de-uso/registrar-factura-proveedor.ts`
- `src/server/actions/movimientos/casos-de-uso/registrar-movimiento.ts`
- `src/app/(app)/movimientos/[proceso]/panel-compra-por-pasos.tsx`
- `src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor.ts` (y, para retirar, `anular-compra.ts` y `corregir-compra.ts`)
- `src/server/persistencia/compras/comprobante-en-la-empresa.ts` y `src/app/(app)/reportes/compras/page.tsx`

Otros documentos a actualizar cuando se apruebe:

- `docs/diseno-correccion-por-ajuste-2026-11-06.md` (§5 y §9: E2 y E3 colapsan en U3)
- `docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md` (§0 y §1c: la «suelta» ya no es para la compra simple)
- `docs/adr/ADR-029-factura-de-proveedor-documento-de-empresa.md` y `ADR-041-la-parte-de-una-factura-repartida-se-propone-y-se-acepta.md`
