# Diseño: corrección por ajuste. Lo registrado (A) queda congelado (2026-11-06)

**Estado del documento:** diseño en papel para el dueño. Salvo donde se indica otra cosa, todo es PROPUESTA. No se implementó nada, no hay migraciones y no se corrió ningún test. Lo preparó un agente de planificación (Opus), que leyó `main` (`50c11538`), la rama `origin/alegp/diseno-flujos-y-pasos`, la rama de la maqueta `origin/alegp/tmp-capturas-correcciones` y la copia local de `motor2-docs` (último commit `582484a`, 2026-11-06).

**Estados que se usan:** CONFIRMADA (lo dijo el dueño), PROPUESTA, PENDIENTE y NO VERIFICADO. Cuando una afirmación sale del código se marca VERIFICADO y se cita el archivo y la línea.

**Decisiones del dueño que este diseño respeta (2026-11-06, CONFIRMADAS):**

1. Lo registrado (A: ticket, factura/compra, movimiento de stock) queda siempre congelado. Nunca se edita ni se borra.
2. Si A se escribió mal (error nuestro), se corrige con un renglón de ajuste nuevo (ejemplar / Kardex) que apunta a A y deja ver los cambios (antes y después, quién, cuándo, motivo). Vale para todo: venta/ticket, compra, stock; salvo la nota de crédito.
3. La nota de crédito es otra entidad: un documento del proveedor que actúa sobre los hechos de A sin alterar A. Ya tiene diseño propio (`docs/diseno-notas-de-credito-de-proveedor-2026-11-04.md`).
4. Al corregir por ajuste el precio de un renglón de compra mal cargado, el costo vigente del producto pasa a ser el precio corregido. Una bonificación del proveedor, en cambio, no cambia el costo.
5. Las ventas quedan congeladas. Un importe $0 significa «sin dato» y nunca se revalúa.
6. Si después de la compra mal cargada ya hubo otra compra del mismo producto, el costo vigente sigue siendo el de la compra más nueva (ver §10).

---

## 0. Resumen para el dueño

- **Lo que ya se registró no se toca nunca.** Un error nuestro se corrige escribiendo algo nuevo que apunta al registro original y muestra el antes y el después, quién lo hizo, cuándo y por qué. CONFIRMADA.
- **La pieza principal ya existe y la usan las mesas.** Para corregir se «da vuelta» el original y en el mismo instante se carga la versión correcta. El original queda a la vista con la marca «Reemplazada por…». Es lo que hace hoy el ticket 1-A → 1-B. Para las ventas, este método («anular y rehacer») ya estaba aprobado en octubre en el plan de documento comercial. Se propone usar este mismo concepto para la venta, la compra y el stock.
- **Ninguna de las piezas es nueva.** La base ya tiene las columnas pensadas para esto (qué operación revierte a cuál, cuál reemplaza a cuál, el motivo de la anulación) y nadie las escribe todavía. Aprovecharlas es la forma más barata.
- **El callejón sin salida de la compra se resuelve así.** Hoy, si parte de la mercadería ya se vendió, no se puede anular la compra para cargarla de nuevo. Con la corrección, el sistema mira solo la **diferencia**: si cambia el precio y la cantidad no, el stock no se mueve y la corrección se acepta aunque ya se hayan vendido 2 de las 24 cervezas.
- **El costo vigente queda con el precio corregido.** Es la decisión 4. Las ventas ya hechas conservan el costo que tenían ese día. Si después de la compra mal cargada ya hubo otra compra del mismo producto, el costo sigue siendo el de la compra más nueva (decisión 6, §10).
- **La nota de crédito no es una corrección.** Es un papel del proveedor, con su propio diseño. Acá solo se traza la frontera entre las dos (§4).
- **Etapas:**
  - **E0** (sin migración): un solo botón «Corregir una línea» en las cuentas cerradas, con el motivo en el mismo paso. Además se ve el pago en la compra y se arreglan detalles de pantalla.
  - **E1** (sin migración): corregir **unidades** de un ticket cerrado, por ejemplo 1 de 2 cervezas.
  - **E2:** corregir cantidad o precio de un renglón de compra. Necesita una migración mínima: ampliar una regla de la base, reversible y con autorización expresa del dueño.
  - **E3 y E4:** la factura repartida o pendiente de pago, y los demás movimientos de stock.

---

## 1. Inventario: qué existe hoy, con otro nombre

| Pieza | Qué hace hoy | Estado |
|---|---|---|
| **Contra-asiento** | Anular una compra o una venta escribe una operación AJUSTE nueva con las líneas al revés y marca la original como anulada (`anuladaEn`). Es el único escritor para las dos. | VERIFICADO `src/server/persistencia/movimientos/escribir-contra-asiento.ts:41-55` |
| **Enlace «revierte a»** | La columna `Operacion.revierteAOperacionId` existe y la base la limita a AJUSTE con un índice único («una operación se revierte una sola vez»). **El contra-asiento no la escribe.** El comentario de la anulación de factura dice que sí. | VERIFICADO `prisma/schema.prisma:1212`; migración `20261015120000_m2_operacion_reversiones_y_motivo/migration.sql:41-43`; el comentario está en `anular-factura-proveedor.ts:39`. **Discrepancia entre comentario y código.** |
| **Enlace «reemplaza a»** | `Operacion.reemplazaAOperacionId` existe, es único y la base lo limita a **VENTA** («anular y rehacer unidades»). Nadie lo escribe. | VERIFICADO `schema.prisma:1224-1230`; migración M2 `:61-64` |
| **Motivo de la anulación** | `Operacion.motivoAnulacion` existe (solo si está anulada, 1 a 200 caracteres, por CHECK). Nadie lo escribe. «Anular venta» no pide motivo. | VERIFICADO `schema.prisma:1218`; migración M2 `:48-49`; el comando lleva solo `operacionId` (`src/core/features/ventas/venta.schema.ts:50`) |
| **Espejo de ítem (POS, cuenta abierta)** | Anula total o parcialmente un ítem ya enviado a cocina, con motivo. «1 de 2 cervezas» **ya funciona mientras la cuenta está abierta**. | VERIFICADO `src/server/actions/pos/casos-de-uso/anular-item-enviado.ts:52-67`; `schema.prisma:2272-2278` |
| **Ejemplar de ticket (cuenta cerrada)** | Fila nueva con el mismo número, el ejemplar siguiente, `corrigeAId` apuntando al A y motivo. Nunca se edita. | VERIFICADO `schema.prisma:2454-2479`; `emitir-ticket-corregido.ts:15-30` |
| **Ticket vigente** | Se calcula: son los ítems cuya venta no está anulada. | VERIFICADO `src/core/pos/ticket.ts:108-133` |
| **Corrección de compra** | Corrige **solo la cabecera** (proveedor, número, detalle), **en el lugar**, con una fila de auditoría por campo. Está declarada como deuda H11. Las líneas no se corrigen: «anulá y volvé a cargar». | VERIFICADO `src/core/compras/correccion.ts:8-12`; `escribir-correccion-de-compra.ts:11-14`; `test/arquitectura/kardex-solo-agrega.test.ts:83-88` |
| **Anular compra** | Se rechaza si lo comprado ya no está (por lote y por total), si hubo un conteo posterior o si la compra es parte de una factura documento. | VERIFICADO `src/core/compras/anulacion.ts:13-17`; `anular-compra.ts:57-73`; `src/core/compras/compra-de-factura.ts:14-19` |
| **Costo vigente (V-T1)** | Es la entrada valorizada más reciente: líneas COMPRA o TRANSFERENCIA_ENTRADA_SUCURSAL, con precio mayor que 0, de una operación **no anulada**, ordenadas por `Operacion.fecha`. | VERIFICADO `src/server/lecturas/reportes/comun.ts:115-178`; `src/core/reportes/comun.ts:217` |
| **Costo de la venta congelado** | `costoUnitarioVenta` se guarda al vender y no se recalcula. Si está vacío, el reporte lo **reconstruye** con el historial de compras y lo rotula «reconstruido». | VERIFICADO `schema.prisma:1339-1357`; `src/core/reportes/costo-historico.ts:8` |
| **Gasto del período** | Suma las líneas COMPRA de operaciones no anuladas. | VERIFICADO `src/core/reportes/periodo-compras.ts:40-46` |
| **Reglas de signo y precio en la base** | COMPRA no admite cantidad negativa. Solo AJUSTE admite un importe negativo. | VERIFICADO migración `20261002160000_reglas_en_la_base_operacion_movimiento/migration.sql:28-42` |
| **Pago de la compra simple** | «Pagada ahora» sin reparto va por la compra simple y **no se guarda en ningún lado**. «Pendiente de pago» crea una factura documento de una parte. | VERIFICADO `src/app/(app)/movimientos/[proceso]/panel-compra-por-pasos.tsx:363-385`; `compras-registradas.ts:53-67` |
| **Pago de la factura documento** | Paga la factura **entera**, sin importe. | VERIFICADO `schema.prisma:2995-2997` |
| **Factura documento** | `importeTotal` «nunca se modifica». | VERIFICADO `schema.prisma:2772` |
| **Guía de ajuste** | El texto que manda a corregir con un Ajuste de stock por la diferencia. | VERIFICADO `src/core/guia-de-ajuste.ts` |
| **Reversión reconocida por texto** | Los reportes reconocen la reversión por el comienzo del detalle («Anulación de la venta/compra…»). Es deuda: el enlace por columna quedó para más adelante. | VERIFICADO `src/core/movimientos/anulaciones.ts:11-16`; decisión 44 de `motor2-docs/_planes/_decisiones-del-dueno-2026-10-08.md` |
| **Permisos** | `anular_venta`, `anular_compra` y `corregir_compra` tienen piso administrador. `pos_emitir_ticket_corregido` tiene piso operario. `proceso_ajuste` tiene piso administrador. | VERIFICADO `src/core/permisos/acciones.ts:110,129-133,215` |
| **Plan aprobado (motor2-docs)** | «Anular una unidad: B-REHACER». Se anula la operación entera y en la misma transacción se escribe lo que queda, copiado en proporción (misma fecha, lotes y costo congelado) y enlazado con `reemplazaAOperacionId`. «Ningún lector de ventas ni de pérdidas cambia; solo el ticket.» Respuesta del dueño: «sí a ambas» (unidad y línea entera). También quedó «anulación + Merma» cuando la mercadería no se recupera. | VERIFICADO `motor2-docs/_planes/plan-documento-comercial-compras-y-ventas.md:11,143-147`; `plan-unificado-gastos-compras-y-ventas.md:107` |
| **Diseño previo de corrección con ejemplares (compra)** | Proponía revertir y cargar el ejemplar siguiente con el mismo número. No resolvía el caso de la mercadería ya vendida. | VERIFICADO `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` §12 |

**Conclusión del inventario:** no hace falta inventar un modelo. El «renglón de ajuste» de la decisión 2 es la pareja que ya existe en el código: el contra-asiento (que revierte A y apunta a A) más el registro nuevo con lo correcto (que reemplaza a A). Falta escribir los enlaces que ya están en la base y cambiar la regla de rechazo por una que mire la diferencia neta.

---

## 2. Niveles 1 a 3

### Nivel 1. Propósito y alcance

- **Necesidad.** Pedido del dueño del 2026-11-06: corregir lo que se cargó mal sin editar ni borrar lo registrado, y que se vea qué cambió. La evidencia es la maqueta (`docs/_capturas/correcciones/LEEME.md`, rama `alegp/tmp-capturas-correcciones`): la compra queda en un callejón sin salida, el ticket tiene un recorrido confuso y la devolución y la nota están sueltas. CONFIRMADA.
- **Propósito.** Que cualquier registro hecho por error nuestro se pueda corregir con un registro nuevo, enlazado y con motivo, de modo que el stock, el costo y el dinero salgan de sumar lo original más sus ajustes. CONFIRMADA (decisiones 1 y 2). La forma es PROPUESTA.
- **Dentro del alcance:** venta o ticket, compra y movimiento de stock. CONFIRMADA.
- **Fuera del alcance:** la nota de crédito y la devolución a proveedor (otra entidad, decisión 3); la nota de débito, que nadie pidió; los comprobantes fiscales emitidos con CAE, que no existen todavía; y el cierre de períodos, que no existe. PROPUESTA.

### Nivel 2. Actores y contexto

| Actor | Qué hace | Permiso | Estado |
|---|---|---|---|
| Administrador de sucursal | Corrige renglones de compra y movimientos de stock | `corregir_compra` y `anular_compra` en la sucursal (sin claves nuevas) | PROPUESTA |
| Encargado de salón o administrador | Corrige una línea de un ticket cerrado | `anular_venta` (piso administrador) y `pos_emitir_ticket_corregido` | PROPUESTA (manda la clave más exigente) |
| Mozo u operario | Sigue anulando ítems de una cuenta **abierta** con el espejo, como hoy | `pos_anular_item` | Hoy |
| Dueño | Aprueba las migraciones y responde la pregunta de §10 | — | CONFIRMADA |

Contexto: pesos argentinos, hora argentina, varias empresas y sucursales, sin cierre de períodos.

### Nivel 3. Casos de uso

| CU | Caso | Ejemplo real (maqueta) | Etapa | Estado |
|---|---|---|---|---|
| **C1** | Corregir un renglón de compra (cantidad, precio o las dos), aunque ya se haya vendido parte | CORDECC, Cerveza Patagonia ×24 a $6.000, cargada mal; se vendieron 2 y quedan 22 | E2 (compra simple), E3 (factura documento) | Necesidad CONFIRMADA; forma PROPUESTA |
| **C2** | Corregir una línea de un ticket cerrado de mesa o mostrador, total o parcial (1 de 2 cervezas) | Mesa 1: 2 Cerveza + 1 Brownie + 2 Café = $46.000 | E0 (línea entera en un paso), E1 (unidades) | Necesidad CONFIRMADA; «unidad y línea entera» CONFIRMADA en el plan del 2026-10-06 |
| **C3** | Corregir un movimiento de stock mal cargado (merma, consumo, ajuste, producción) | Merma de 5 kg cargada como 50 | E0 (ajuste guiado), E4 (reemplazo) | Necesidad CONFIRMADA; forma PROPUESTA |
| **C4** | Lo que **no** es corrección: nota de crédito, devolución a proveedor, bonificación | El proveedor acredita 6 cervezas devueltas | Su propio diseño (NC0, NC1) | CONFIRMADA (decisión 3) |

---

## 3. Niveles 4 y 5

### Nivel 4. Concepto y ciclo de vida

- **Un solo concepto: «corrección por reemplazo».** PROPUESTA. Se escriben tres cosas en una sola transacción:
  1. **la reversión R:** el contra-asiento de siempre (AJUSTE con las líneas de A al revés), con `revierteAOperacionId` apuntando a A;
  2. **la versión corregida B:** una operación nueva del **mismo tipo que A** (VENTA, COMPRA, MERMA…), con `reemplazaAOperacionId` apuntando a A, la **misma fecha** que A y los mismos lotes y secciones, cambiando solo lo corregido;
  3. **la marca en A:** cuándo, quién y el motivo (`anuladaEn`, `anuladaPorId`, `motivoAnulacion`). Es la única marca que ya se le pone a A hoy al anularla. Los datos de A no cambian. La pantalla la muestra como «**Reemplazada por B**», no como «Anulada», porque la distingue el enlace de reemplazo.
- **Por qué no un renglón de «diferencia» suelto.** Una corrección que solo sumara la diferencia (por ejemplo, +$X) dejaría la operación A vigente al lado de un AJUSTE parcial. El plan de octubre lo descartó (variante B-POS): obligaba a cambiar unos 15 lectores de ventas y pérdidas, con riesgo de contar dos veces. Además la base no admite una línea COMPRA negativa (VERIFICADO, migración `20261002160000:28-42`), así que una corrección hacia abajo no se puede escribir como «compra». Con el reemplazo, **ningún reporte de ventas, gasto ni pérdidas cambia**, porque ya excluyen lo anulado y suman lo vigente. PROPUESTA.
- **Ciclo de vida:** vigente → reemplazada por B → B puede volver a corregirse (reemplazada por C). La cadena A → B → C queda visible. **Una sola versión vigente a la vez.** No hay «des-corregir»: un error en B se corrige con C. PROPUESTA.
- **Con el ticket:** en C2, además, se emite el ejemplar siguiente (1-B) con el mismo motivo, en la misma transacción. El ejemplar es el «comprobante» de la corrección y la venta reemplazada es su efecto en stock y dinero. PROPUESTA.
- **Lo que ve la persona:** una sola cosa, «Corrección», con el antes, el después, el motivo, quién y cuándo. R, B y la marca son detalle interno, visible en Trazabilidad para quien quiera auditar. PROPUESTA.

### Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | A no se edita ni se borra. Solo recibe la marca de reemplazo (las mismas columnas que la anulación de hoy, más el motivo). | CONFIRMADA (principio); la marca es PROPUESTA |
| I2 | La corrección solo agrega filas: R, B, el ejemplar (si es un ticket) y la auditoría. El Kardex solo agrega (guardián vigente). | CONFIRMADA |
| I3 | El stock, el gasto, el ingreso y el costo salen de sumar lo vigente. A y R se cancelan entre sí, así que el efecto neto es B − A. | PROPUESTA |
| I4 | **Una sola versión vigente:** A se reemplaza una sola vez (lo garantizan los índices únicos que ya existen sobre «revierte a» y «reemplaza a»). | VERIFICADO el índice (`schema.prisma:1257,1259`); la regla es PROPUESTA |
| I5 | **El tope y el stock se miran en neto.** Se rechaza solo si **el resultado neto** (B − A) deja un lote o el total del producto en la sección por debajo de 0. Una corrección de precio sola tiene diferencia 0 de stock y se acepta aunque ya se haya vendido todo. | PROPUESTA (reemplaza, para la corrección, la regla de anulación de `anulacion.ts:13-17`) |
| I6 | **Una corrección no deja stock negativo.** Si bajar la cantidad deja saldo negativo, se rechaza con la guía: «primero un conteo o un ajuste». | PROPUESTA |
| I7 | **Conteo posterior (D7):** si después de A hubo un conteo del mismo producto en la misma sección, se rechaza la corrección de **cantidad**, porque el conteo ya absorbió la diferencia. La de **precio sola** se acepta. | D7 CONFIRMADA (2026-10-08); la excepción para el precio es PROPUESTA |
| I8 | B lleva la misma fecha, sucursal, sección y lotes que A. En la compra, también el mismo proveedor y el mismo número de factura. El número queda libre al marcar A, así que el índice de factura única no choca si se marca A **antes** de escribir B. | PROPUESTA |
| I9 | **Ventas congeladas:** B copia de A el precio cobrado, el descuento, el precio de lista y el `costoUnitarioVenta` en proporción, sin recalcular la receta. Un importe $0 o un costo vacío se copian tal cual, porque significan «sin dato» y nunca se revalúan. | CONFIRMADA (decisión 5); la copia proporcional, CONFIRMADA en el plan B-REHACER |
| I10 | Promo: un componente no se corrige por unidades; se corrige la promo entera, como hoy. Un adicional se corrige con su producto. | CONFIRMADA (reglas vigentes) |
| I11 | **Motivo obligatorio** (1 a 200 caracteres) en el mismo paso. Quién y cuándo los pone el sistema. | CONFIRMADA (decisión 2); el largo sale del CHECK existente |
| I12 | **Antes y después** en la auditoría: una fila por campo que cambia (cantidad, precio) en la misma transacción, con `registrarCambioAuditado`. | PROPUESTA |
| I13 | **Pagos ya hechos:** la compra simple no guarda pago, así que no hay nada que mover. En la factura documento el pago cubre «la factura entera» sin importe, así que la corrección no lo toca. El detalle es de E3. | VERIFICADO el modelo; la regla es PROPUESTA |
| I14 | **Reparto entre sucursales:** una compra que es parte de una factura documento no se corrige suelta (D8); se corrige la factura (E3), con permiso en cada sucursal que tenga parte, igual que la anulación. | D8 CONFIRMADA; E3 PENDIENTE |
| I15 | **Notas de crédito sobre la factura:** mientras haya notas vigentes, la factura no se corrige (mismo criterio C29 que la anulación). | PROPUESTA |

### Política de costo (decisión 4)

- Al corregir el precio de un renglón de compra, **el costo vigente pasa a ser el precio corregido**. CONFIRMADA (decisión 4).
- Esto sale solo, sin tocar la consulta del costo. A queda marcada y la consulta ya excluye lo anulado. B es una COMPRA con el precio corregido y la misma fecha, así que ocupa el lugar de A en la lista «más reciente». Si A era la entrada más reciente, el costo vigente pasa a ser el de B. VERIFICADO el filtro (`lecturas/reportes/comun.ts:173-178`); el efecto es PROPUESTA.
- **Bonificación del proveedor:** no cambia el costo. Es una nota de crédito, no una corrección. CONFIRMADA (decisión del 2026-10-06; N11 del diseño de notas).
- **Lo ya vendido a costo viejo:**
  - Las ventas que guardaron su costo (`costoUnitarioVenta`) **no se tocan**. CONFIRMADA (decisión 5).
  - Las ventas **sin** costo guardado ya aparecen «reconstruidas» desde el historial de compras. Ese número se recalcula al leer, así que pasará a usar el precio corregido. Es lo correcto: el precio viejo era un error. Supuesto declarado; si el dueño lo prefiere de otro modo, se corrige.
  - **Cómo se informa (PROPUESTA):** en la pantalla de confirmación se muestra «De esta compra ya se vendieron 2 unidades. Esas ventas conservan el costo con que se vendieron; desde ahora el costo de reposición es $5.500».

---

## 4. Frontera con la nota de crédito: ¿ajuste o nota?

**Regla:** si **el papel está bien y nosotros lo cargamos mal**, se corrige con un ajuste. Si **el papel del proveedor cambia algo** (devuelve, bonifica o acredita), se carga una nota de crédito. La corrección nunca crea una nota y la nota nunca corrige una carga. CONFIRMADA (decisiones 2 y 3).

| Situación real | ¿Qué es? | Efecto |
|---|---|---|
| La factura dice 24 cervezas a $5.500 y se tecleó $6.000 | **Ajuste** (C1) | Costo vigente $5.500; gasto del mes corregido; stock igual |
| La factura dice 24 y se tecleó 42 | **Ajuste** (C1) | Stock −18 neto (se rechaza si queda negativo); gasto corregido |
| Número de factura tecleado al revés | **Corrección de cabecera** (existe hoy, deuda H11) | Ni stock ni dinero |
| Se cobró 2 cervezas y la mesa tomó 1 | **Ajuste** (C2) | Ticket 1-B; venta de 1; +1 en stock; ingreso corregido |
| El proveedor manda una nota por 6 cervezas devueltas | **Nota** (NC0 y NC1) más la devolución | Dinero acreditado; el stock baja por la devolución; el costo **no** cambia |
| El proveedor bonifica el 10 % del total | **Nota** (NC0) | Baja el gasto (en NC2); el costo **no** cambia |
| La factura estaba bien pero el precio subió y el proveedor lo reconoce después | **Nota** | El costo no cambia |
| Se cargó la nota con un importe mal tecleado | Se **anula la nota** y se carga de nuevo (CU4 del diseño de notas) | Nunca un ajuste |
| Se corrige un renglón que ya tiene notas vigentes (factura documento) | Primero se anula la nota (I15) | — |

**Relación:** la nota acredita sobre la **versión vigente** del renglón. El tope de la nota (precio del renglón − notas vigentes) se calcula sobre B. En NC0 las notas sobre compra simple van sueltas, sin enlace, así que la corrección no las afecta. PROPUESTA.

**Del caso 4 de la maqueta** (importe tecleado dos veces): se resuelve en NC1 (elegir la devolución al cargar la nota), no en este diseño.

---

## 5. Nivel 6. Persistencia (solo propuesta)

| Etapa | Qué usa | ¿Migración? |
|---|---|---|
| **E0** | `Operacion.motivoAnulacion` y `revierteAOperacionId`, que ya existen, se empiezan a escribir. Cambia la lista de columnas permitidas en el guardián `kardex-solo-agrega` (código, no base). | **Ninguna** |
| **E1** | Además `reemplazaAOperacionId` en VENTA (el CHECK ya lo permite). | **Ninguna** |
| **E2** | Ampliar el CHECK `Operacion_reemplaza_solo_venta_chk` para que admita también COMPRA. Aditiva, en el mismo estilo `NOT VALID` + `VALIDATE`. Su `down.sql` aborta si alguna COMPRA ya usa la columna; si no, vuelve al CHECK anterior. | **Una, mínima. Requiere autorización expresa**, base por base, con respaldo y ensayo en una rama de Neon |
| **E3** | Factura documento: probablemente `FacturaProveedor.corrigeAId` y su motivo (§12 del diseño de compras), o reemplazar la factura entera. Se diseña aparte. | PENDIENTE. **Requiere autorización expresa** |
| **E4** | Ampliar el mismo CHECK a MERMA, CONSUMO, AJUSTE y PRODUCCION, si el dueño lo pide después de E0. | **Requiere autorización expresa** |

- **Alternativa sin migración para E2, no recomendada:** enlazar B con A solo por texto en el detalle y por la auditoría. Repite la deuda «reconocer por texto» que la decisión 44 (2026-10-08) pidió abandonar.
- **Ningún paso de esquema crea tablas.**

---

## 6. Nivel 7. Atomicidad y concurrencia

**Una transacción SERIALIZABLE por comando**, con reintento (`conTransaccionSerializable`). El orden:

1. idempotencia I3, con la clave en B;
2. cargar A;
3. la guarda optimista (lo que la persona vio coincide con lo que está guardado);
4. las reglas puras (I5 a I7, I10, I14 e I15);
5. escribir R con el enlace a A;
6. marcar A con el motivo;
7. escribir B con el enlace a A;
8. en C2, el ejemplar del ticket;
9. la auditoría (antes y después);
10. guardar el mensaje de I3.

Si algo falla, no queda nada escrito. PROPUESTA.

### ¿Qué pasa si…? Comando «Corregir un renglón de compra» (C1, E2)

| Situación | Qué pasa |
|---|---|
| Repetición (doble clic, reenvío) | Misma clave y mismo contenido: devuelve el mensaje original sin escribir. Misma clave con otro contenido: conflicto. |
| Dos correcciones del mismo renglón a la vez | Gana una. La otra reintenta, ve que A ya fue reemplazada (índice único de «revierte a» y «reemplaza a») y responde «La compra cambió mientras la corregías: ahora la vigente es la corrección del [hora]; revisá y volvé a intentar». |
| Corrección y venta a la vez | SERIALIZABLE: una reintenta y relee el saldo; I5 se evalúa con el saldo real. |
| Tiempo | B lleva la fecha de A, así que el gasto queda en el mes de A. El costo vigente sigue la regla de §3 (y la pregunta de §10). |
| Incertidumbre | «Quedan 22» en pantalla es orientativo. Manda la verificación dentro de la transacción. |
| Reintento por conflicto de serialización (40001) | Automático. Con la misma clave, el mismo resultado. |
| Error parcial | Todo o nada: R, la marca, B y la auditoría van en una sola transacción. |
| Datos faltantes | Sin motivo no guarda. El precio en 0 se avisa como «pendiente de completar» y no entra al costo (regla vigente). |
| Cambio de permisos en el medio | Se piden `corregir_compra` y `anular_compra` al entrar. Si se pierden antes de confirmar, el envío se rechaza. |
| A es parte de una factura documento | Se rechaza y se manda a la factura (D8) hasta E3. |
| Conteo posterior y cambio de cantidad | Se rechaza con la guía de ajuste (I7). |

### ¿Qué pasa si…? Comando «Corregir una línea del ticket» (C2, E0 y E1)

| Situación | Qué pasa |
|---|---|
| Repetición | Hoy no tiene I3 (VERIFICADO `anular-venta.ts:22-24`, `emitir-ticket-corregido.ts:20-21`). PROPUESTA: guarda optimista con «lo que queda» visto (el molde del espejo) y además el índice único de reemplazo. El segundo envío responde «ya corregida». |
| Concurrencia (dos personas sobre la misma mesa) | El índice único elige una ganadora; la otra relee y ve el ejemplar nuevo. |
| Tiempo | El 1-A impreso ya está en manos del cliente. El 1-B es otro papel con el mismo número, como hoy. |
| Error parcial | Venta reemplazada y ejemplar B en la misma transacción. Desaparece el estado intermedio de hoy (venta anulada y ticket sin corregir). |
| Datos faltantes | Sin motivo no guarda. Una cuenta cerrada antes de la numeración de tickets responde «sin numeración», como hoy. |
| Conteo o pago a consignante posterior | Se rechaza (D7, CONFIRMADA). |
| Permisos | Se piden `anular_venta` y `pos_emitir_ticket_corregido`. |
| La fila de la mesa no se actualiza | Se refresca al confirmar (E0). |

### ¿Qué pasa si…? Comando «Corregir un movimiento de stock» (C3)

- **E0:** es el Ajuste de siempre, prellenado. Rige su propia tabla vigente.
- **E4:** igual que C1, sin costo vigente en juego (merma y consumo no fijan costo).

---

## 7. Niveles 8 y 9. Interfaces y experiencia

**Acceso (PROPUESTA).** Casos de uso nuevos con el molde que ya existe (Server Action como adaptador fino, después el guard y después el caso de uso):

- `corregir-linea-de-ticket` (E0 y E1);
- `corregir-renglon-de-compra` (E2).

Las reglas puras van en `src/core/compras/correccion.ts` (ampliado) y en `src/core/movimientos/anulaciones.ts`. Hay que agregar los textos «Corrección de la venta/compra…» a la lista única de prefijos reservados, así los reportes de diferencias de ajuste no confunden R con un ajuste manual. **Sin claves de permiso nuevas** (criterio de poda).

**Lo que ve la persona (PROPUESTA):**

- **El contenedor de la compra:** comprobante (fecha, proveedor, número, total), renglones, «Cargada por», **pago** («Pagada al contado al cargarla; fecha y medio: pendiente de completar» en la compra simple; el estado de pago en la factura documento) y, si hubo correcciones, «Corregida el [día] por [persona]: Cerveza $6.000 → $5.500. Motivo: …», con un enlace a la versión anterior.
- **Botón «Corregir una línea»** en cada renglón. Abre **un solo diálogo**:
  - antes y después, con los campos editables (cantidad, precio);
  - «De esto ya se vendieron 2; quedan 22» (lo que hoy aparece solo como error);
  - el motivo, obligatorio;
  - una vista previa del efecto: «Stock: sin cambio · Costo de reposición: $6.000 → $5.500 · Gasto de octubre: −$12.000»;
  - el botón Confirmar.
- **Cuentas cerradas (mesa y mostrador):** en cada fila, «Corregir una línea» → elegir la línea → cuántas unidades quitar (E1; en E0 la línea entera) → motivo → «Corregir y emitir ticket». Pasa de ~8 toques en 3 pantallas a **unos 4 toques en una**. La fila se actualiza sola.
- **Trazabilidad:** A dice «Reemplazada por…» con el enlace a B. El buscador por producto lista también las ventas (hallazgo de la maqueta; causa NO VERIFICADO).
- **La anulación de venta** pide motivo (E0).

**Escalera de producto «corregir lo registrado».** Los peldaños se acumulan y no rompen lo ya cargado:

| Peldaño | Qué ve el cliente | Etapa |
|---|---|---|
| N0 (hoy) | Ticket: línea entera, en 3 pantallas. Compra: solo la cabecera. Stock: ajuste a mano. | — |
| N1 | Un botón y un paso para la línea entera del ticket. Motivo guardado en la venta. Pago visible en la compra. | E0 |
| N2 | Corregir unidades del ticket (1 de 2). | E1 |
| N3 | Corregir cantidad o precio de un renglón de compra simple, con antes, después y costo vigente. | E2 |
| N4 | Lo mismo en la factura repartida o pendiente de pago. | E3 |
| N5 | Merma, consumo, ajuste y producción por reemplazo, más una lista «Correcciones» con todo lo corregido. | E4 |

Lo que falta en cada peldaño se muestra «pendiente de completar». Por ejemplo, en N3 un renglón de factura repartida dice «Corrección de facturas repartidas: pendiente de completar».

---

## 8. Nivel 10. Pruebas, migración y operación

**Reglas puras**, con propiedades de `fast-check` (ya es dependencia):

- A + R = 0 exacto por lote;
- B − A = la diferencia pedida;
- la copia proporcional suma exacto en centavos (`repartirImporte`): por ejemplo, $9.000 entre 2 da $4.500 + $4.500;
- una corrección de precio sola tiene diferencia de stock 0.

**Integración:**

- Corregir una compra con mercadería vendida: acepta en precio; en cantidad, rechaza si queda negativo.
- Conteo posterior en cantidad y en precio.
- Compra de factura documento: rechazo D8.
- Costo vigente antes y después; con y sin compra posterior.
- Gasto del mes de A corregido.
- Ventas con costo guardado: el costo no cambia.
- Ticket 1-B con 1 cerveza.
- Promo y adicional.
- Aislamiento por RLS entre empresas y sucursales.

**Concurrencia** (el caso de uso real, corrido 3 veces):

- 8 correcciones simultáneas del mismo renglón dejan exactamente 1 B;
- una corrección y una venta simultáneas nunca dejan stock negativo;
- mutación: si se quita el índice o la guarda, el test se pone en rojo.

**Idempotencia:**

- misma clave → mismo mensaje y una sola B;
- otra clave con el mismo contenido → «ya corregida».

**Invariancia:** sobre el seed, los totales de ventas, pérdidas, rendimiento y valuación dan lo mismo antes y después de una corrección con diferencia 0.

**Combinaciones (oráculo escrito aparte, en `docs/oraculo-combinaciones-correccion-por-ajuste-AAAA-MM-DD.md`, a crear con la implementación):**

| Dimensión (C1) | Valores |
|---|---|
| D1 qué cambia | precio / cantidad sube / cantidad baja / los dos |
| D2 lo ya vendido | nada / parte / todo |
| D3 el neto deja negativo | no / sí |
| D4 conteo posterior | no / sí |
| D5 compra posterior del producto | no / sí |
| D6 estado de A | vigente / ya reemplazada / anulada / de factura documento |
| D7 permisos | los dos / falta uno |
| D8 repetición | nueva / misma clave igual / misma clave distinta |

Salidas por fila: acepta o rechaza (con código), diferencia de stock, diferencia de gasto del mes de A, costo vigente y «ventas pasadas sin cambio».

C2 tiene sus propias dimensiones: unidades (parte o total), promo, adicional, descuento de cliente, conteo posterior, pago a consignante posterior, permisos y «lo que queda» visto. Son pocas y se recorren todas.

**Guardián:** falla si aparece un proceso nuevo en el CHECK de «reemplaza a» o una columna nueva en `Operacion` sin declarar si afecta la corrección.

**Specs e2e (PROPUESTA):** ampliar `compras-corregir.spec.ts` (corregir un renglón con mercadería vendida), `reportes-tickets.spec.ts` y `venta-anular-trazabilidad.spec.ts` (corregir una línea y 1 de 2 en un paso), y `movil-pos-mesa.spec.ts` (a 375 px).

**Operación:** la migración de E2 se ensaya subir-bajar-subir en una rama de Neon. El código se revierte antes que la migración. Antes de E0 hay que corregir el comentario de `anular-factura-proveedor.ts:39`.

---

## 9. Etapas

| Etapa | Qué entrega | Cuánto cambia lo que ve el usuario | Migración |
|---|---|---|---|
| **E0 «un paso»** (la más barata) | (a) «Corregir una línea» en Cuentas cerradas: anula la línea entera, guarda el motivo en la venta y emite el ticket corregido, todo en una transacción. (b) «Anular venta» pide motivo. (c) El contenedor de la compra muestra el pago. (d) Trazabilidad por producto lista las ventas. (e) La fila de la mesa se refresca. (f) El contra-asiento escribe «revierte a» y el motivo. (g) En un movimiento de stock, «Corregir este movimiento» abre el Ajuste prellenado con producto, sección y una referencia al original en el detalle. | Mucho en el ticket; poco en el resto | Ninguna |
| **E1 «unidades»** | C2 parcial: anular y rehacer la venta con «reemplaza a» (el plan B-REHACER aprobado). El ticket vigente toma la cantidad de la venta que reemplaza. | Se puede quitar 1 de 2 | Ninguna |
| **E2 «renglón de compra»** | C1 en compra simple: reemplazo con diferencia neta, antes y después, costo vigente y la vista previa del efecto. Opcional: la corrección de cabecera (deuda H11) pasa al mismo mecanismo y se borra su excepción. | Se termina el callejón sin salida | Ampliar un CHECK. **Requiere autorización expresa** |
| **E3 «factura documento»** | C1 en factura repartida o pendiente de pago (partes en otras sucursales, pago declarado, notas). | Igual que E2, en más compras | PENDIENTE. **Requiere autorización expresa** |
| **E4 «todo el stock»** | C3 por reemplazo (merma, consumo, ajuste, producción) y la lista «Correcciones». | Historial unificado | Ampliar el CHECK. **Requiere autorización expresa** |

**Qué NO tocar:**

- la consulta del costo vigente (V-T1);
- los lectores de ventas y pérdidas;
- el diseño y las tablas de la nota de crédito;
- el espejo de cuenta abierta;
- la numeración de tickets;
- la regla D7;
- `FacturaProveedor.importeTotal`;
- los pagos X0.

No se agregan claves de permiso nuevas ni tablas.

---

## 10. Preguntas abiertas y supuestos

**Decisión 6 (CONFIRMADA por el dueño, 2026-11-06).** Se corrige el precio de una compra de octubre, pero en noviembre ya hubo otra compra del mismo producto: **el costo de reposición sigue siendo el de la compra de noviembre**. La corrección pone el precio correcto en el lugar de la compra mal cargada, y el costo vigente sigue siendo el de la compra más nueva. Solo si la compra corregida es la más nueva, el costo pasa a ser el precio corregido (decisión 4). No requiere cambio en la consulta del costo vigente (V-T1): ya ordena por fecha de la operación. No queda ninguna pregunta abierta en este diseño; lo único pendiente es la autorización expresa de cada migración (E2, E3, E4) cuando se implemente.

**Supuestos declarados** (una línea cada uno; el dueño los corrige si no son así):

- C2 corrige cantidades. Un precio de venta mal cobrado no es parte de este pedido.
- En C2, la unidad quitada vuelve al stock porque no se sirvió. Si se sirvió y se tiró, va «anulación + Merma», decisión ya confirmada el 2026-10-06; queda para después de E1.
- Para corregir un renglón de compra se piden `corregir_compra` y `anular_compra`. No hay clave nueva.
- La corrección de cabecera sigue como está hasta E2.
- Las ventas sin costo guardado pasan a reconstruirse con el precio corregido.
- La compra simple cargada como «Pagada ahora» se muestra como pagada al contado al cargarla, con fecha y medio «pendiente de completar».

---

## 11. Verificación final obligatoria (para cada etapa, cuando se implemente)

1. **Línea de base**, antes de tocar nada, en `main`:
   - el conteo de tests de `npx vitest run` y de specs de `npm run test:e2e`;
   - sobre el seed: los totales de ventas, gasto, costo de reposición y valuación.
2. **Pasos chicos y reversibles:** primero las reglas puras con su test, después la persistencia, después el caso de uso, después la pantalla. Un commit por paso y `git revert` posible en cada uno. La migración de E2 va en su propio PR.
3. **Los 8 comandos del gate**, en la **misma** corrida:
   - `npx tsc --noEmit`
   - `npm run lint`
   - `npm run arquitectura`
   - `npm run analizar:muerto` (0 hallazgos)
   - `npm test`
   - `npm run build`
   - `npm run plataforma:build`
   - `npm run test:e2e`
4. **Criterio de éxito:**
   - los 8 terminan con código 0 y «Gate (requerido)» queda en verde en GitHub;
   - el conteo de tests es mayor o igual que la línea de base más los nuevos;
   - cada test nuevo tiene su mutación demostrada en rojo;
   - la prueba de invariancia da los valores exactos de la línea de base cuando la diferencia es 0;
   - ninguna lista de deuda sube; la de `kardex-solo-agrega` solo cambia por las columnas declaradas y baja en E2 si se elimina H11.
5. **Áreas para mirar con atención:**
   - Compras: `test/e2e/compras-corregir.spec.ts`, `compras-anular.spec.ts`, `factura-repartida.spec.ts`, `test/arquitectura/reportes-compras-anuladas.test.ts`.
   - POS y ticket: `test/reportes/tickets-emitidos.test.ts`, `test/e2e/reportes-tickets.spec.ts`, `venta-anular-trazabilidad.spec.ts`, `movil-pos-mesa.spec.ts`.
   - Kardex: `test/arquitectura/kardex-solo-agrega.test.ts`, `test/persistencia/kardex-escritores-huella.test.ts`, `test/arquitectura/caracterizaciones-congeladas.test.ts` (los goldens de lecturas de anular venta).
   - Costos: `test/auditoria/precision-costos-precios-reversiones.test.ts`, `test/reportes/ventas-anuladas.test.ts`, `rendimiento-recetas.test.ts`.
   - Idempotencia: `test/arquitectura/idempotencia-i3-cobertura-concurrente.test.ts`.

---

## 12. No verificado

- Por qué el buscador de Trazabilidad por producto no lista la venta (se vio en la maqueta; no se leyó la consulta).
- Si hubo un relleno que completó `revierteAOperacionId` en las reversiones viejas (el esquema lo menciona).
- Si alguna otra vía, además del panel por pasos, crea una compra simple con un pago distinto de «al contado».
- Que el nuevo cálculo del ticket vigente con «reemplaza a» no afecte el reporte de tickets como se imprimió (`armarTicketImpresoEn`).
- El permiso del mozo en la corrección de ticket (la maqueta solo probó con admin).
- Que la copia local de `motor2-docs` sea la última.

### Archivos críticos para implementar

- `src/server/persistencia/movimientos/escribir-contra-asiento.ts`
- `src/core/compras/anulacion.ts` y `src/core/compras/correccion.ts`
- `src/server/actions/movimientos/casos-de-uso/anular-venta.ts` y `src/server/actions/pos/casos-de-uso/emitir-ticket-corregido.ts`
- `src/core/pos/ticket.ts`
- `prisma/schema.prisma` (Operacion, líneas 1208-1259) y `test/arquitectura/kardex-solo-agrega.test.ts`
