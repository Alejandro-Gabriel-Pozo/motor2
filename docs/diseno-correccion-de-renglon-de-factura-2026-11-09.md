# Diseño: corregir un renglón de la factura (2026-11-09)

**Estado del documento:** diseño en papel para el dueño. Es solo un documento: no hay código, no hay migraciones, no se corrió ningún test. Lo escribió una sesión de diseño (Sonnet) sobre `origin/main` (`d231db21`, con U0 y U1 de «una sola compra» ya en producción) y el repo `motor2-docs` (clonado, `_planes/`).

**Estados:** CONFIRMADA (lo dijo el dueño), PROPUESTA, PENDIENTE y NO VERIFICADO. Lo que sale del código se marca VERIFICADO con archivo.

**Reemplaza** a E2 («renglón de compra suelta») y E3 («factura documento») de `docs/diseno-correccion-por-ajuste-2026-11-06.md`: desde U0 no hay «compra suelta»; toda compra es una factura de una o más partes (`docs/diseno-una-sola-compra-2026-11-06.md`, §10). Lo demás de ese documento (decisiones 1 a 6, la frontera con la nota de crédito, E0 y E1) sigue vigente.

**Decisiones del dueño que se respetan (CONFIRMADAS):**

1. Lo registrado queda congelado: nunca se edita ni se borra; el error nuestro se corrige con registros nuevos enlazados, con motivo, quién y cuándo (2026-11-06, decisiones 1 y 2).
2. Al corregir el precio, el costo vigente pasa a ser el precio corregido; si ya hubo una compra más nueva del producto, manda esa (decisiones 4 y 6).
3. Las ventas ya hechas conservan su costo (`costoUnitarioVenta`); un importe $0 es «sin dato» y no se revalúa (decisión 5).
4. D-ANUL: anular una factura es entero y atómico, y se bloquea si algo se consumió (2026-10-06). Esta corrección **no** cambia esa regla: es otro comando.
5. «No entiendo por qué habría dos compras»: una sola compra, una sola anulación, una sola corrección (2026-11-06).

---

## 0. Resumen para el dueño

- **El problema (caso C1, CONFIRMADO):** cargaste CORDECC, Cerveza Patagonia ×24 a $6.000 y estaba mal; se vendieron 2 y quedan 22. Hoy no se puede arreglar: «Anular» se rechaza porque algo se consumió, y «Corregir datos» solo toca proveedor, N.º de factura y detalle, no los renglones.
- **La solución:** corregir el renglón **por ajuste**. La factura original queda congelada y marcada «Corregida»; en el mismo instante se escribe la versión correcta con la misma fecha, el mismo proveedor y el mismo N.º de factura, más el motivo, quién y cuándo. El sistema mira solo la **diferencia**: si cambia el precio y la cantidad no, el stock no se mueve y se acepta aunque ya se hayan vendido 2.
- **Etapa 1 (E2a, la más barata):** factura de **una sola parte** (el caso común: una sucursal). Las facturas repartidas entre sucursales (E2b) quedan para después, con nombre.
- **Qué pasa con lo vendido:** esas ventas conservan el costo con que se vendieron. Desde la corrección, el costo vigente es el precio corregido (o el de la compra más nueva, si hay una).
- **Lo que NO se arregla solo (rechazos explícitos, con mensaje):** si después de la compra hubo un **conteo** y cambiás la **cantidad**; si la nueva cantidad queda **por debajo de lo que ya salió**; si la factura tiene **notas de crédito vigentes**; si tiene un **pago declarado** (ver la pregunta clave).
- **Hace falta UNA migración mínima** (ampliar una regla de la base: «esta operación reemplaza a otra» hoy solo vale para ventas). Es aditiva y reversible, va en su propio PR y **requiere tu autorización expresa** (§6). Sin ella el sistema podría corregir igual, pero el vínculo «corregida por…» quedaría por texto, que es justo la deuda que se decidió abandonar.
- **Pregunta clave (§12):** si la factura ya figura **pagada** y hay que corregirla, ¿se bloquea hasta anular el pago (recomendado) o el pago se arrastra a la versión corregida?

---

## 1. Inventario: qué existe hoy con otro nombre (VERIFICADO contra `d231db21`)

| Pieza | Qué hace hoy | Se reutiliza para |
|---|---|---|
| `anularFacturaProveedorCasoDeUso` (`src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor.ts`) | Anulación entera y atómica: candado `FOR UPDATE` sobre la cabecera (`bloquearFactura`), partes vistas = partes del permiso, notas vigentes → rechazo, evalúa cada parte (`evaluarAnulacion`, `evaluarPosterioresAAnularCompra`) ANTES de escribir, revierte cada compra y marca la cabecera anulada con su motivo | El molde del comando completo |
| `corregirFacturaProveedorCasoDeUso` (`corregir-factura-proveedor.ts`) | Corrige **solo** proveedor, N.º y detalle de la cabecera, en el lugar, con guarda optimista y auditoría por campo. **No toca renglones** | Queda como está; E2a es otro comando |
| `escribirContraAsiento` (`src/server/persistencia/movimientos/escribir-contra-asiento.ts`) | Escribe la AJUSTE inversa con `revierteAOperacionId` (índice único: una operación se revierte una sola vez) y marca `anuladaEn`/`anuladaPorId`/`motivoAnulacion` (si se le pasa) | La reversión de A. **`escribirAnulacionDeCompra` hoy NO le pasa el motivo** (`AnulacionAEscribir` no lo lleva): hay que agregarlo |
| `escribirCabeceraDeFactura`, `escribirRenglonesDeFactura`, `escribirParteRecibida` (`escribir-factura-proveedor.ts`) | Escriben una factura nueva completa. La base solo deja INSERT en renglones y partes y UPDATE por columna en la cabecera (**`importeTotal` «nunca se modifica»**, sin UPDATE) | La versión corregida B: **una factura nueva**, no un parche sobre A |
| `escribirAnulacionDeFactura` | Marca la cabecera `anuladaEn` (libera el número) y escribe `AnulacionDeFacturaProveedor` (motivo, clave única global, huella, mensaje) | Marcar A como reemplazada |
| `armarLineaMovimiento` (usado por `registrar-factura-proveedor.ts`) | Calcula la línea de compra: producto, conversión de unidad, precio, `precioPorUnidadStock` | Armar el renglón corregido **con las mismas reglas que la carga** (una sola puerta) |
| `evaluarAnulacion` / `evaluarPosterioresAAnularCompra` (`src/core/compras/anulacion.ts`) | Stock por lote y por total del par (producto, sección); conteos posteriores (solo conteos; un ajuste manual no cuenta) | La regla de «neto» de la corrección (§4, I5) |
| `exigirPermisoEnLasSucursalesDeLaFactura` | Pide el permiso en cada sucursal con parte y en la que cargó, ensancha el contexto solo si aprueba | El gate de permisos |
| E1 de ventas: `reemplazar-venta-con-menos-unidades.ts`, `escribir-venta-corregida.ts`, `versiones-de-venta.ts`, `core/movimientos/correccion-por-unidades.ts` | Anular y rehacer una venta con `reemplazaAOperacionId`, misma fecha, costo congelado | El patrón: cuerpo `…EnTx` dentro de una transacción SERIALIZABLE, escritor de la versión nueva que enlaza, lectura de la cadena de versiones |
| `Operacion.reemplazaAOperacionId` | Columna + FK compuesta + **índice único** `Operacion_empresaId_reemplazaAOperacionId_key` (una operación se reemplaza una sola vez). **CHECK `Operacion_reemplaza_solo_venta_chk`: `proceso = 'VENTA'`** | El vínculo A → B. Hay que ampliar el CHECK a COMPRA (§6) |
| `AnulacionDeFacturaProveedor` | Una por factura (`@@unique([facturaProveedorId])`), con clave única global NOT NULL | Registro del «motivo» de A |
| Escritores de nota de crédito, tributos, renglones `SIN_STOCK`, imputaciones de gasto | **No hay ninguno en `src/`** (la única lectura de notas es `tieneNotasDeCreditoVigentes`) | Hoy esos casos no existen en datos reales: se rechazan explícitamente y se dejan «pendientes de completar» |
| `motor2-docs/_planes` (plan documento comercial, B-REHACER, D-ANUL, D7) | B-REHACER aprobado («sí a ambas») para ventas; D-ANUL entera y atómica; D7 «me parece bien rechazar» | Respaldo de método. **No hay un plan aprobado específico de «corregir renglón de compra»**: este diseño es el primero |

**Conclusión:** no hace falta ninguna tabla ni columna nueva. Falta (a) ampliar un CHECK, (b) una regla pura de «neto» y (c) un caso de uso que combine piezas que ya existen.

---

## 2. Niveles 1 a 3

### Nivel 1. Propósito y alcance

- **Necesidad (CONFIRMADA):** caso C1 de `diseno-correccion-por-ajuste-2026-11-06.md`, pedido del dueño el 2026-11-06; una auditoría externa lo marcó como «Motor2 se traba en ese caso».
- **Propósito (PROPUESTA):** que el error de cantidad o precio de un renglón de una compra se corrija sin editar lo registrado, aunque parte de la mercadería ya se haya vendido, dejando el antes y el después.
- **Dentro del alcance de E2a:** factura de **una sola parte**, renglón de **mercadería**, cambiar cantidad, precio o ambos.
- **Fuera de alcance (no se hace ahora):** factura repartida (E2b), renglones `SIN_STOCK`, IVA desglosado y tributos (nada los escribe hoy), cambiar fecha (cambia el período del gasto), agregar o quitar renglones, cambiar producto, nota de crédito y devolución (otra entidad, decisión 3).

### Nivel 2. Actores y permisos (sin claves nuevas)

| Actor | Qué hace | Permiso | Estado |
|---|---|---|---|
| Administrador de la sucursal | Corrige un renglón | `corregir_compra` **y** `anular_compra` (ambas piso administrador, `src/core/permisos/acciones.ts:142,144`) en la sucursal activa y, en E2b, en cada sucursal con parte y en la que cargó | PROPUESTA (se piden las dos: la corrección anula y reescribe) |
| Operario | No puede | — | VERIFICADO el piso |
| Dueño | Autoriza la migración y responde §12 | — | CONFIRMADA |

La descripción de `corregir_compra` dice «solo la cabecera; nunca sus líneas»: al implementar hay que actualizarla (no es una clave nueva).

### Nivel 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Cantidad o precio mal tecleado, mercadería sin tocar | E2a | CONFIRMADA la necesidad |
| CU2 | Lo mismo con parte ya vendida o consumida (C1: 24 → 22 quedan) | E2a | CONFIRMADA |
| CU3 | Factura repartida entre sucursales, partes pendientes o aceptadas y consumidas | E2b | Necesidad CONFIRMADA (E3 del diseño viejo); forma PENDIENTE |
| CU4 | Factura con pago declarado | E2a (rechazo) / después | PENDIENTE (§12) |
| CU5 | El proveedor cambia lo cobrado (nota de crédito) | NO es corrección: NC0 | CONFIRMADA (decisión 3) |

---

## 3. Nivel 4. Concepto y ciclo de vida (PROPUESTA)

**Un solo concepto: «corrección de la factura por reemplazo».** En UNA transacción SERIALIZABLE:

1. **R, la reversión:** el contra-asiento de siempre de la compra de A (`escribirContraAsiento`, AJUSTE con `revierteAOperacionId` → compra de A, `motivoAnulacion` = el motivo, detalle con el prefijo reservado de reversiones para que los reportes no la confundan con un ajuste manual).
2. **La marca en A:** la cabecera de A queda `anuladaEn`/`anuladaPorId` y se escribe su `AnulacionDeFacturaProveedor` con el motivo. Eso libera el N.º de factura (índice único vigente por empresa, proveedor y número).
3. **B, la versión corregida:** una `FacturaProveedor` nueva con el **mismo proveedor, número, fecha, condición de pago y detalle**; los mismos renglones (copiados uno a uno, en el mismo orden) salvo el corregido; su parte (misma sucursal) con una `Operacion` COMPRA nueva que lleva `reemplazaAOperacionId` → la compra de A, la **misma fecha**, los mismos lotes y la misma sección. B queda con la clave de idempotencia I3 y la huella.

**Por qué una factura nueva y no un parche:** en la base el total y los renglones son inmodificables (sin UPDATE) y la parte apunta a su `Operacion` sin poder cambiarla (VERIFICADO `20261016101000_factura_proveedor`, GRANT). Cambiar eso sería otra migración y rompería la garantía «lo registrado no se toca».

**Qué ve la persona:** una sola cosa, «Corrección», con antes, después, motivo, quién y cuándo. A se muestra «Corregida el [día] por [persona]. Ver la versión vigente»; B es la factura vigente, con la marca «Corrige a la del [día]».

**Ciclo de vida:** vigente → corregida por B → B se puede volver a corregir (C). Una sola versión vigente a la vez. No hay «des-corregir»: un error en B se corrige con C.

**Resuelto por escrito (a)–(i) del pedido:**

- **(a) Una parte vs repartida.** E2a = factura con **exactamente una parte** (`FacturaProveedorSucursal`) con su `Operacion`, sin propuestas de ningún estado. Repartida (más de una parte, o con propuestas) → rechazo `REPARTIDA_PENDIENTE_DE_COMPLETAR`: «Esta factura está repartida entre sucursales; corregir renglones de facturas repartidas todavía no está disponible». E2b agrega, sobre el mismo comando: permiso en cada sucursal con parte, regla de neto **por parte**, recalcular el reparto y volver a proponer las partes pendientes (ver §9 y §12 P3).
- **(b) Qué se anula y qué se reescribe.** Se «anula» la **factura entera** A y la compra de su parte (R + marca) y se **reescribe** la factura completa B con su compra. No se reescribe el renglón suelto porque no se puede (inmodificable). Los renglones sin cambio se copian idénticos: su Kardex queda A (+x) + R (−x) + B (+x) = neto x. **El N.º de factura repetido sigue protegido:** A se marca anulada antes de escribir B dentro de la misma transacción; el índice único vigente (`FacturaProveedor_unica_vigente_key`) y el de `Operacion` por sucursal siguen siendo las barreras; dos correcciones a la vez no pueden dejar dos vigentes.
- **(c) Pagos hechos.** Ver §5 (I12 a I14) y §12.
- **(d) Notas de crédito vigentes.** Rechazo `CON_NOTAS_DE_CREDITO`: la línea de nota apunta por clave foránea al renglón de A, que no se puede mover a B. Hay que anular la nota y volver a cargarla (como en la anulación). Hoy no existe ningún escritor de notas (VERIFICADO), así que la regla está pero nunca se dispara hasta NC0. Las notas **anuladas** no bloquean.
- **(e) Conteos posteriores.** Ver I7.
- **(f) Reportes y costo vigente.** Ver §4.
- **(g) Permisos.** Ver nivel 2.
- **(h) Cantidad por debajo de lo consumido.** Ver I5 (se rechaza por defecto).
- **(i) La pantalla.** Ver §8.

---

## 4. Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | A no se edita ni se borra; solo recibe la marca de anulada (las mismas columnas de hoy, más el motivo) | CONFIRMADA |
| I2 | La corrección solo agrega filas: R, B (cabecera, renglones, parte, compra, Kardex), la anulación de A y la auditoría. El Kardex solo agrega | CONFIRMADA (guardián vigente) |
| I3 | **Una sola versión vigente:** A se reemplaza una sola vez (índice único de «revierte a» y de «reemplaza a») | VERIFICADO los índices; la regla PROPUESTA |
| I4 | B tiene la misma fecha, proveedor, número, sucursal, sección y lotes que A, y la misma condición de pago. Solo cambian cantidad y/o precio de **un** renglón | PROPUESTA |
| I5 | **El stock se mira en neto.** Por cada (producto, sección, lote) y por el total del par: `saldo actual − cantidad de A + cantidad de B ≥ 0`. Los renglones que no cambian dan neto 0 y no se evalúan. Una corrección de precio sola (neto 0) se acepta aunque se haya vendido todo. Si la nueva cantidad queda por debajo de lo que ya salió → rechazo `STOCK_CONSUMIDO` (política por defecto: la más simple, igual que hoy; alternativa en §12 P2) | PROPUESTA |
| I6 | **Conteo posterior (D7):** si después de A hubo un **conteo** del mismo producto en la misma sección, se rechaza el cambio de **cantidad** de ese renglón (el conteo ya absorbió la diferencia). El de **precio solo** se acepta. Un ajuste manual no cuenta (igual que `evaluarPosterioresAAnularCompra`) | D7 CONFIRMADA (2026-10-08); la excepción de precio, PROPUESTA |
| I7 | **El «desde cuándo» de D7 es el de la cadena, no el de B.** B se escribe «ahora» (`creadoEn` lo pone la base); si anular o corregir B mirara solo su `creadoEn`, un conteo hecho entre A y B quedaría «anterior» y D7 se evadiría con una corrección de precio. Por eso, para D7 se usa el `creadoEn` de la **primera** compra de la cadena (se llega siguiendo `reemplazaAOperacionId` hacia atrás). Esto también cambia `cargarCompraParaAnular` (anular B) | PROPUESTA — **hallazgo de este diseño, no estaba en el viejo** |
| I8 | **Notas de crédito vigentes sobre A** → rechazo (§3 d) | PROPUESTA |
| I9 | **Solo mercadería sin IVA desglosado ni tributos:** renglón `SIN_STOCK`, factura con IVA desglosado, tributos o imputaciones → rechazo `RENGLON_NO_CORREGIBLE` («pendiente de completar»). Hoy nada los escribe | PROPUESTA |
| I10 | **Motivo obligatorio** (1 a 200 caracteres, el CHECK de `motivoAnulacion`), en el mismo paso | CONFIRMADA (decisión 2) |
| I11 | **Antes y después** en la auditoría (`registrarCambioAuditado`, una fila por campo que cambia: cantidad, precio, total) en la misma transacción, apuntando a A y a B | PROPUESTA |
| I12 | **Pago declarado vigente** en A (condición `PENDIENTE_DE_PAGO` con un `PagoDeFacturaProveedor` vigente) → rechazo `CON_PAGO_DECLARADO`: «Esta compra figura pagada el [día]. Anulá primero el pago, corregí la compra y volvé a declararlo». Razón: el pago cubre «la factura entera» y no guarda importe (`schema.prisma`); copiarlo a B afirmaría que se pagó el total nuevo sin dato que lo respalde, y dejarlo en A haría que B figure «pendiente» (deuda doble). Es la opción que no inventa dinero | PROPUESTA — **PENDIENTE del dueño** (§12 P1) |
| I13 | **Factura pagada al cargar (`CONTADO_PAGADA`):** B copia la condición. No hay pago que mover. Si el total cambia, se **avisa** (no bloquea): «Esta compra se cargó como pagada al contado. El sistema no guarda cuánto se pagó: si el total pasa de $X a $Y, revisá la diferencia fuera del sistema» | PROPUESTA |
| I14 | **Pago anulado** o **pendiente sin pago:** B copia la condición y queda en el mismo estado de pago que tenía A | PROPUESTA |
| I15 | **Dinero exacto:** el total del renglón en pesos con 2 decimales (`redondearMoneda`), la cantidad con los decimales del producto, el precio por unidad con 4 decimales (`toFixed(4)`, como la carga). El total de B es la suma de sus renglones en centavos enteros; moneda ARS fija | PROPUESTA (reglas de la carga reutilizadas) |
| I16 | **Fecha:** B copia la fecha de A (mediodía argentino): el gasto queda en el mes de A. El momento de la corrección (`ahora`) solo va en la reversión, la marca, la auditoría y B (`creadoEn`) | PROPUESTA |
| I17 | **Una compra anterior a las facturas (sin renglón de factura)** o una factura anulada o ya corregida: no se corrige por este camino (`NO_ES_CORREGIBLE`, `YA_ANULADA`, `LA_FACTURA_CAMBIO`) | PROPUESTA |
| I18 | **«Quién cargó» se conserva:** B lleva `creadoPorId` y el usuario de la compra de A; quién corrigió queda en la reversión, la marca de A y la auditoría | PROPUESTA |

### Efecto en reportes y costo (decisiones 4, 5 y 6)

- **Gasto del período** (`src/core/reportes/periodo-compras.ts`): suma líneas COMPRA de operaciones **no anuladas**. A queda anulada, B suma con la misma fecha: el gasto del mes de A se corrige solo. **Ningún reporte cambia.** VERIFICADO el filtro por lectura del código; el efecto es PROPUESTA.
- **Costo vigente (V-T1):** `DISTINCT ON … ORDER BY o."fecha" DESC, m."id" DESC` con `o."anuladaEn" IS NULL` (VERIFICADO `src/server/lecturas/reportes/comun.ts`). B ocupa el lugar de A por tener su misma fecha. Si A era la entrada más reciente, el costo vigente pasa a ser el precio corregido (decisión 4); si hubo una compra posterior, sigue esa (decisión 6). **Límite que hay que declarar:** si otra compra del **mismo producto tiene exactamente la misma fecha** (mismo día, mediodía argentino), el desempate es por `m.id` y B, escrita después, gana aunque la otra fuera «más nueva». Es un caso marginal; no se propone tocar V-T1 (regla de «no tocar»); se declara y se prueba (§10). Es PENDIENTE del dueño aceptar el límite (§12 P4).
- **Ventas con costo guardado:** no cambian. **Ventas sin costo guardado:** el reporte las reconstruye desde el historial de compras y pasarán a usar el precio corregido (supuesto ya declarado el 2026-11-06).
- **Stock:** neto A + R + B = lo corregido. **NO VERIFICADO:** que ningún reporte calcule el stock «a una fecha pasada» sumando por `fecha`; en ese caso, entre la fecha de A y el momento de la corrección vería A y B a la vez (R está fechada «ahora»). Se cierra con un test (§10) antes de implementar; si aparece, la mitigación es fechar R igual que A o excluir lo anulado en esa lectura.
- **Compras anuladas:** A figura como «Corregida», no «Anulada»: la pantalla distingue por el vínculo `reemplazadaPor` de su compra (derivado, sin columna nueva). Los informes de «compras anuladas» no deben contarla como una anulación de negocio (se revisa `reportes-compras-anuladas.test.ts`).

---

## 5. Frontera con la nota de crédito (vigente, resumida)

Si **el papel está bien y nosotros lo cargamos mal** → corrección (este diseño). Si **el papel del proveedor cambia algo** (devuelve, bonifica, acredita) → nota de crédito. La corrección nunca crea una nota y la nota nunca corrige una carga (decisiones 2 y 3). Mientras haya notas vigentes sobre la factura, no se corrige (I8). Cuando se construya NC0 hay que actualizar `diseno-notas-de-credito-de-proveedor-2026-11-04.md`: la nota acredita sobre la versión vigente (B) y una nota sobre A impide la corrección.

---

## 6. Nivel 6. Persistencia (solo propuesta) y migración

### ¿Hace falta migración? **Sí, una, mínima.**

Mirado contra la base real: `Operacion.reemplazaAOperacionId` existe, tiene FK compuesta y **índice único**, pero el CHECK `Operacion_reemplaza_solo_venta_chk` (`20261015120000_m2_operacion_reversiones_y_motivo`) dice `proceso = 'VENTA'`; una COMPRA que lo escriba falla en la base. `revierteAOperacionId`, `motivoAnulacion` y las claves de idempotencia ya sirven tal cual para R y la marca.

| Opción | Qué es | Recomendación |
|---|---|---|
| **M1 (recomendada)** | Ampliar el CHECK a `proceso IN ('VENTA','COMPRA')` y `<> id`. Sin columnas nuevas, sin tablas, sin índices nuevos | **Sí** |
| M2 | Una columna `FacturaProveedor.reemplazaAFacturaId` con FK e índice único | No: duplica el vínculo ya presente en la operación de cada parte |
| M0 (sin migración) | Escribir B sin vínculo; reconocer «corregida» por proveedor + número + fecha, o por un prefijo en el motivo de `AnulacionDeFacturaProveedor` | No recomendada: repite la deuda «reconocer por texto» (decisión 44, 2026-10-08), A se vería «Anulada» y la corrección se contaría como anulación, y se pierde la cadena que necesita I7. Si el dueño quisiera empezar ya sin migración, habría que **rechazar también la corrección de precio cuando exista un conteo posterior** para no evadir D7 |

**Migración M1 (descripción; NO se escribe el archivo; REQUIERE AUTORIZACIÓN EXPRESA DEL DUEÑO, base por base, con respaldo y ensayo en una rama de Neon):**

- `up`: `ALTER TABLE "Operacion" DROP CONSTRAINT IF EXISTS "Operacion_reemplaza_solo_venta_chk"` y agregar el nuevo CHECK (`NOT VALID` + `VALIDATE CONSTRAINT`, mismo estilo que M2; idempotente; `lock_timeout`). Con los datos actuales ninguna fila lo viola (hoy solo VENTA usa la columna). Aditiva: el código anterior sigue andando sobre la base nueva.
- `down.sql`: **aborta** (`RAISE EXCEPTION`) si alguna `Operacion` con `proceso = 'COMPRA'` tiene `reemplazaAOperacionId` no nulo; si no, vuelve al CHECK anterior. Se baja el **código antes** que la migración.
- Nombre del CHECK: se propone uno nuevo (`…_solo_venta_o_compra_chk`); hay que actualizar los tests que lo nombran (`test/persistencia/reglas-m2-reversiones.test.ts`, `test/aislamiento/m2-venta-subir-bajar-subir.test.ts`).
- Va en **su propio PR**, antes del código; el código que escribe el vínculo no se mezcla hasta que la migración esté aplicada.
- Que B sea de la misma sucursal que A, y COMPRA como A, lo controla la aplicación (la base no puede mirar dos filas).

Sin tablas nuevas. Sin claves de permiso nuevas.

---

## 7. Nivel 7. Atomicidad y concurrencia

**Una transacción SERIALIZABLE** (`conTransaccionSerializable`) con reintento. Orden (PROPUESTA):

0. (fuera de la transacción) permisos `corregir_compra` y `anular_compra` en la sucursal activa (y en E2b en cada una con parte);
1. idempotencia I3: la clave y la huella van en la cabecera de B (mismo lugar y misma lectura que la carga, `cargarFacturaPorClaveIdempotencia`);
2. `bloquearFactura(A)` (`SELECT … FOR UPDATE`): primero siempre, serializa contra otra corrección, la anulación, el pago y la aceptación de una parte;
3. estado de A (anulada, ya corregida, con notas, con pago, sin renglón mercadería) y guarda optimista (lo que la persona vio = lo guardado);
4. cargar saldos y conteos posteriores; reglas puras (I5, I6, I7) **antes** de escribir nada;
5. R + marca de la compra de A (`escribirContraAsiento`, con motivo);
6. `escribirAnulacionDeFactura(A)`: libera el N.º. Su clave única propia se deriva de la de la corrección (detalle de implementación; hoy la columna es única global y NOT NULL);
7. B: cabecera, renglones, compra con vínculo, Kardex, parte (`escribirParteRecibida`), mensaje I3;
8. auditoría (I11).

Si algo falla, no queda nada escrito. Los índices únicos de «revierte a», «reemplaza a» y de factura vigente son la segunda barrera; el `.catch` los traduce al mismo mensaje de negocio que hoy (nunca un error 500).

### ¿Qué pasa si…? Comando «Corregir un renglón de la factura» (E2a)

| Situación | Qué pasa |
|---|---|
| Repetición (doble clic, reenvío) | Misma clave y mismo contenido: devuelve el mensaje original sin escribir. Misma clave con otro contenido: conflicto |
| Otra clave, mismo contenido, A ya corregida | «La compra cambió mientras la corregías: ahora la vigente es la corrección del [hora]; revisá y volvé a intentar». No duplica |
| Dos correcciones del mismo renglón a la vez | Gana una (candado + índices únicos). La otra reintenta, ve A anulada y responde lo anterior |
| Corrección y venta a la vez | SERIALIZABLE: una reintenta y relee el saldo; I5 se evalúa con el saldo real. Nunca queda stock negativo por la corrección |
| Corrección y anulación a la vez | El candado las turna; la segunda ve la factura anulada o corregida |
| Corrección y declarar un pago a la vez | Las dos toman el candado de la cabecera: se turnan. Si el pago entró primero, I12 rechaza; si la corrección entró primero, el pago se declara sobre B (el id nuevo; la pantalla vieja recibe «cambió») |
| Tiempo | Sin plazo. B conserva la fecha de A (I16); no hay cierre de períodos. «Hoy» Argentina (UTC-3) solo para mostrar |
| Incertidumbre («¿se guardó?») | La pantalla conserva la clave hasta el éxito; reenviar devuelve el mismo mensaje. «Quedan 22» en pantalla es orientativo: manda la lectura dentro de la transacción |
| Reintento por conflicto de serialización (40001) | Automático, con la misma clave: mismo resultado |
| Error parcial | Todo o nada: R, marca de A, B y auditoría en una transacción |
| Datos faltantes | Sin motivo no guarda. Cantidad o precio ≤ 0, o sin cambio real → «nada que corregir». Precio en 0: se avisa «pendiente de completar» y no entra al costo (regla vigente) |
| Cambio de permisos en el medio | Vale lo que se miró al entrar; si se pierde antes de confirmar, se rechaza |
| Factura repartida (más de una parte o con propuestas) | Rechazo `REPARTIDA_PENDIENTE_DE_COMPLETAR` hasta E2b |
| Notas de crédito vigentes / pago declarado / conteo posterior (cantidad) | Rechazos I8 / I12 / I6, con mensaje y salida |

---

## 8. Niveles 8 y 9. Interfaces y experiencia (texto = PROPUESTA hasta que el dueño apruebe con captura de la pantalla real)

**Acceso (PROPUESTA):** Server Action fina (`corregirRenglonDeFactura`, junto a `corregirFacturaProveedor` en `facturas-proveedor.ts`: permisos y formato) → caso de uso `corregir-renglon-de-factura.ts` (cuerpo `…EnTx` como E1) → reglas puras en `src/core/compras/` (nueva `correccion-de-renglon.ts`, exportada por `public.ts`) → persistencia en `src/server/persistencia/compras/`. Se agregan a `escribirAnulacionDeCompra` el motivo, y al escritor de la `Operacion` COMPRA el vínculo `reemplazaAOperacionId` (hoy solo lo tiene `escribirOperacionDeVenta`; si `escribirOperacionDeStock` no lo admite es **NO VERIFICADO**).

**Dónde se ofrece:** «Compras registradas» (`src/app/(app)/reportes/compras/page.tsx`), en la fila de la factura, al lado de «Corregir datos» y «Anular», un botón **«Corregir un renglón»** que abre **un solo diálogo** con el patrón de «Corregir una línea» de las cuentas cerradas (`src/app/(pos)/mesas/[mesaId]/corregir-linea.tsx`): elegir renglón → cantidad y/o precio → motivo → vista previa → Confirmar. En celular a 375 px.

**Lo que muestra (lenguaje llano, ejemplo CORDECC):**

- *Antes y después:* «Cerveza Patagonia · 24 u a $6.000 = $144.000 → 24 u a $5.500 = $132.000».
- *Estado del stock:* «Se compraron 24 y hoy quedan 22: salieron 2 (ventas, mermas o consumos)». (Es lo que el saldo permite afirmar; «se vendieron» solo si la salida es una venta: NO VERIFICADO que se pueda separar, no se afirma.)
- *Efecto, antes de confirmar:* «Stock: sin cambio. Gasto de octubre: −$12.000. Esas salidas conservan el costo con que se hicieron; desde ahora el costo vigente de Cerveza Patagonia es $5.500» (o «sigue siendo $X, el de la compra más nueva del [día]» si hubo una posterior; o el aviso de empate de §4).
- *Rechazos:* «Esta compra ya tiene 22 de 24; no se puede bajar a 20 porque ya salieron 2 y quedarían −… Si la mercadería no está, registrá un Ajuste de stock» · «Después de esta compra hubo un conteo de Cerveza Patagonia; para cambiar la cantidad hacé un Ajuste de stock» · «La compra tiene notas de crédito: anulalas primero» · «Esta compra figura pagada el [día]: anulá el pago, corregí y volvé a declararlo» · «Esta compra está repartida entre sucursales: todavía no se puede corregir un renglón».
- *Después:* en la fila, «Corregida el [día] por [persona]: Cerveza $6.000 → $5.500. Motivo: …» y el enlace a la versión anterior (A, tachada «Corregida»).

**Escalera de producto N0 a N5 (compras):**

| Peldaño | Qué ve el cliente | Etapa |
|---|---|---|
| N0 (hoy) | Anular se rechaza si algo se consumió; «Corregir datos» solo la cabecera | — |
| N1 | Corregir cantidad o precio de un renglón de una factura de **una** parte, con antes, después y efecto | E2a |
| N2 | Lo mismo en una factura repartida (permisos por sucursal, partes pendientes) | E2b |
| N3 | Con pago declarado o notas de crédito (según §12 P1 y NC0) | E2c |
| N4 | IVA desglosado, tributos y renglones de servicios | E2d |
| N5 | Lista «Correcciones» con todo lo corregido (compras, tickets, stock) | E4 |

Lo que falta se muestra «pendiente de completar», nunca se inventa.

---

## 9. Etapas (la más barata primero)

| Etapa | Qué entrega | Migración | Criterio de éxito |
|---|---|---|---|
| **E2-M** | Solo la migración M1 (§6), en su PR | **Sí. REQUIERE AUTORIZACIÓN EXPRESA** | Sube/baja/sube en una rama de Neon; el gate completo verde; los tests del CHECK actualizados |
| **E2a-1** reglas puras | `correccion-de-renglon.ts` (I5 a I9, I12, I13, mensajes) + test exhaustivo del oráculo (§11) | No | Cada fila del oráculo da el resultado escrito; guardián de dimensiones verde |
| **E2a-2** persistencia | Cargar la factura para corregir (una parte, saldos, conteos con `creadoEn` de la cadena); escribir B con vínculo; motivo en `escribirAnulacionDeCompra` | No (usa M1 ya aplicada) | Tests de integración con la base: antes/después exactos |
| **E2a-3** caso de uso y acción | El comando completo, permisos, idempotencia, auditoría | No | Pruebas de concurrencia, idempotencia, atomicidad y aislamiento (abajo) en verde |
| **E2a-4** pantalla | Botón y diálogo; **primero la maqueta real con datos reales** (CORDECC, Cerveza Patagonia, a 375 px) para que el dueño apruebe el texto | No | Aprobación del dueño con captura; e2e (abajo) |
| **E2b** repartida | Permiso en cada sucursal con parte y en la que cargó; neto por parte; destino que aceptó y consumió; recalcular el reparto de la corrección y **volver a proponer** las partes pendientes a cada destino (las propuestas de A quedan sin efecto con su anulación); I7 por parte | No (M1 basta) | Oráculo con REPARTIDA; concurrencia contra aceptación; el diseño de redistribución (P3) aprobado antes |
| E2c, E2d, E4 | Pago declarado / notas / IVA y tributos / corrección de stock (ver §8) | A definir | Etapas posteriores con nombre; **no se diseñan ni migran ahora** |

**Pruebas obligatorias de E2a (cada una con su mutación demostrada en rojo):**

- **Concurrencia:** 8 correcciones simultáneas del mismo renglón dejan exactamente **una** B y una A corregida; una corrección y una venta simultáneas nunca dejan stock negativo; una corrección y una anulación a la vez; una corrección y un pago declarado a la vez. Se corren 3 veces, con los clientes como `motor2_app`. Mutación: sacar el candado o el índice debe poner rojo.
- **Idempotencia:** la misma clave y el mismo contenido → mismo mensaje y una sola B; otra clave sobre una ya corregida → «la compra cambió»; misma clave con otro contenido → conflicto.
- **Atomicidad:** si falla cualquier paso (forzado en el escritor de B), no quedan R, ni marca, ni B ni auditoría.
- **Aislamiento por empresa y sucursal:** no se corrige una factura de otra empresa; con RLS, no se ve ni se escribe en otra sucursal.
- **Autorización en el servidor:** falta `corregir_compra`, falta `anular_compra`, operario → rechazo; la matriz de denegación ya existente se amplía.
- **Dinero exacto:** propiedades con `fast-check` (ya es dependencia): total de B = suma de renglones en centavos; el precio por unidad con 4 decimales; sin redondeos sueltos; A + R = 0 exacto por lote.
- **Fecha Argentina:** B conserva la fecha de A (mediodía argentino); el gasto queda en el mes de A aunque se corrija el mes siguiente (incluido el cruce de fin de mes y la franja 21:00–24:00 UTC-3).
- **Invariancia:** sobre el seed, ventas, gasto, valuación y costo vigente dan lo mismo antes y después de una corrección de diferencia 0 salvo el costo vigente del renglón corregido cuando corresponde; el costo guardado de las ventas no cambia.
- **Costo vigente:** con y sin compra posterior; con compra posterior de la **misma fecha** (documenta el límite de §4); stock «a fecha pasada» (cierra el NO VERIFICADO de §4).
- **D7:** conteo posterior con cambio de cantidad (rechaza) y de precio (acepta); **y después anular B con un conteo hecho entre A y B (debe rechazar, por I7)**.
- **e2e (Playwright):** ampliar `test/e2e/compras-corregir.spec.ts` (corregir un renglón con mercadería vendida, a 1280 px y a 375 px) y la matriz de denegación.

**Gate completo, en la MISMA corrida y todo limpio, para cada etapa que toque código (criterio de éxito: los 8 con código de salida 0, el conteo de tests ≥ la línea de base más los nuevos, «Gate (requerido)» verde en GitHub):**

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm run arquitectura`
4. `npm run analizar:muerto` (0 hallazgos)
5. `npm test`
6. `npm run build`
7. `npm run plataforma:build`
8. `npm run test:e2e`

El código lo escribe un subagente Sonnet (regla del 2026-11-04); Opus y Fable planifican, revisan y verifican.

---

## 10. Nivel 10. Pruebas, migración y operación

- **Oráculo de combinaciones (§11)**, escrito aparte del código; al implementar vivirá en `docs/oraculo-combinaciones-correccion-de-renglon-2026-11-09.md`, con un test que recorre todas las combinaciones contra esa tabla y un **guardián** que falla si aparece una columna nueva en `FacturaProveedor`, `FacturaProveedorRenglon`, `FacturaProveedorSucursal`, `PagoDeFacturaProveedor` u `Operacion`, o una condición o estado nuevos, sin declarar si afecta la corrección.
- **Operación:** la migración M1 se ensaya subir-bajar-subir en una rama de Neon; el código se baja antes que la migración; el despliegue sigue `docs/deploy-con-migraciones.md`.
- **Hay que cerrar antes de implementar** (NO VERIFICADO, §13): qué pasa con las compras anteriores a U0 que no tienen factura (bases de demostración).

---

## 11. Oráculo: combinaciones esperadas del comando (PROPUESTA)

**Dimensiones que cambian dinero, permisos, visibilidad o stock:**

| Dimensión | Valores |
|---|---|
| PARTES | `UNA` · `REPARTIDA` |
| STOCK del renglón | `SIN_CONSUMIR` · `CONSUMIDO_EN_PARTE` · `CONSUMIDO_DEL_TODO` |
| NUEVA cantidad vs lo consumido | `ALCANZA` · `NO_ALCANZA` (en `SIN_CONSUMIR` siempre alcanza) |
| PAGO | `CONTADO_PAGADA` · `PENDIENTE_SIN_PAGO` · `PENDIENTE_CON_PAGO_VIGENTE` · `PENDIENTE_CON_PAGO_ANULADO` |
| NOTAS | `NINGUNA` · `SOLO_ANULADAS` · `VIGENTE` |
| CONTEO posterior del producto | `NO` · `SI` |
| QUÉ cambia | `CANTIDAD` · `PRECIO` · `AMBOS` |
| TOTAL | `SUBE` · `BAJA` |
| ESTADO de la factura | `VIGENTE` · `ANULADA` · `YA_CORREGIDA` |
| PERMISOS | `LOS_DOS` · `FALTA_UNO` |
| REPETICIÓN | `NUEVA` · `MISMA_IGUAL` · `MISMA_DISTINTA` |
| VISTO | `IGUAL` · `DISTINTO` |

**Reglas (la primera que cumple, manda):**

| N | Condición | Resultado |
|---|---|---|
| R1 | PERMISOS=FALTA_UNO | RECHAZA `SIN_PERMISO` |
| R2 | REPETICIÓN=MISMA_DISTINTA | RECHAZA `CLAVE_REUTILIZADA` |
| R3 | REPETICIÓN=MISMA_IGUAL | ACEPTA `REPETIDA` (mensaje original, sin escribir) |
| R4 | ESTADO=ANULADA | RECHAZA `YA_ANULADA` |
| R5 | ESTADO=YA_CORREGIDA o VISTO=DISTINTO | RECHAZA `LA_FACTURA_CAMBIO` |
| R6 | PARTES=REPARTIDA (en E2a; E2b la levanta) | RECHAZA `REPARTIDA_PENDIENTE_DE_COMPLETAR` |
| R7 | NOTAS=VIGENTE | RECHAZA `CON_NOTAS_DE_CREDITO` |
| R8 | PAGO=PENDIENTE_CON_PAGO_VIGENTE | RECHAZA `CON_PAGO_DECLARADO` (pendiente de §12 P1) |
| R9 | CONTEO=SI y QUÉ ∈ {CANTIDAD, AMBOS} | RECHAZA `CONTEO_POSTERIOR` |
| R10 | NUEVA=NO_ALCANZA | RECHAZA `STOCK_CONSUMIDO` (neto negativo) |
| R11 | resto | ACEPTA, con los avisos de abajo |

**Avisos de las celdas que aceptan (no bloquean):**

| Aviso | Cuándo |
|---|---|
| `SALIDAS_CONSERVAN_COSTO` | STOCK ≠ SIN_CONSUMIR: «esas salidas conservan el costo con que se hicieron» |
| `COSTO_VIGENTE_CAMBIA` | QUÉ ∈ {PRECIO, AMBOS} y B pasa a ser la entrada más reciente del producto |
| `COSTO_VIGENTE_SIGUE` | QUÉ ∈ {PRECIO, AMBOS} y hay una compra más nueva (decisión 6) |
| `PAGADA_AL_CONTADO_REVISAR` | PAGO=CONTADO_PAGADA (y el total cambió: siempre en esta tabla, TOTAL es SUBE o BAJA) |

**Celdas representativas (las ejecuta el test; todas las demás se derivan de la tabla):**

| PARTES | STOCK | PAGO | NOTAS | CONTEO | QUÉ | TOTAL | Resultado |
|---|---|---|---|---|---|---|---|
| UNA | CONSUMIDO_EN_PARTE (2 de 24) | PENDIENTE_SIN_PAGO | NINGUNA | NO | PRECIO | BAJA | ACEPTA (stock sin cambio) + `SALIDAS_CONSERVAN_COSTO` + `COSTO_VIGENTE_CAMBIA` |
| UNA | CONSUMIDO_DEL_TODO | CONTADO_PAGADA | NINGUNA | NO | PRECIO | SUBE | ACEPTA + los tres avisos |
| UNA | CONSUMIDO_EN_PARTE | CONTADO_PAGADA | NINGUNA | NO | CANTIDAD baja a 20 (≥ 2 consumidas) | BAJA | ACEPTA (neto −4, saldo 18) |
| UNA | CONSUMIDO_EN_PARTE | CONTADO_PAGADA | NINGUNA | NO | CANTIDAD baja a 1 (< 2 consumidas) | BAJA | RECHAZA `STOCK_CONSUMIDO` |
| UNA | SIN_CONSUMIR | CONTADO_PAGADA | NINGUNA | SI | CANTIDAD | SUBE | RECHAZA `CONTEO_POSTERIOR` |
| UNA | SIN_CONSUMIR | CONTADO_PAGADA | NINGUNA | SI | PRECIO | BAJA | ACEPTA |
| UNA | cualquiera | PENDIENTE_CON_PAGO_VIGENTE | NINGUNA | NO | cualquiera | cualquiera | RECHAZA `CON_PAGO_DECLARADO` |
| UNA | cualquiera | PENDIENTE_CON_PAGO_ANULADO | SOLO_ANULADAS | NO | PRECIO | SUBE | ACEPTA |
| UNA | cualquiera | cualquiera | VIGENTE | NO | cualquiera | cualquiera | RECHAZA `CON_NOTAS_DE_CREDITO` |
| REPARTIDA | cualquiera | cualquiera | NINGUNA | NO | cualquiera | cualquiera | RECHAZA `REPARTIDA_PENDIENTE_DE_COMPLETAR` (hasta E2b) |

**Cómo se prueba:** las dimensiones de las reglas puras son pocas: 2×3×2×4×3×2×3×2×3×2×3×2 ≈ 62.000 combinaciones, se recorren **todas** contra esta tabla (rápido, sin base). La integración con la base va por pares (~25 filas). **Guardián:** falla si la entrada de la regla gana un campo, o si aparece una columna o un valor nuevo en las tablas listadas en §10, sin declarar si afecta (`NO_AFECTA` con el motivo).

**Dimensiones que NO cambian la decisión (declaradas para que nadie las dé por olvidadas):** proveedor, detalle libre, sección, lote (cambia solo el cálculo del neto, no el resultado), unidad de compra (cambia solo la conversión), sucursal activa (cambia el permiso, no la regla).

---

## 12. Decisiones del dueño y pregunta clave

**La ÚNICA pregunta clave (cambia el dinero):**

**P1 — Factura ya pagada.** Si la compra ya figura **pagada** (pago declarado) y hay que corregir un renglón, ¿qué querés?
- **(A) Recomendada: se bloquea y se pide anular el pago primero.** Lo corregís, y volvés a declarar el pago sobre la compra corregida. Razón: el sistema no guarda cuánto se pagó; arrastrar el pago afirmaría que se pagó el total nuevo sin dato. Es cero código extra y no inventa nada.
- (B) El pago pasa a la versión corregida (más cómodo, pero afirma algo que el sistema no puede comprobar; requeriría además registrar el importe pagado, que hoy no existe).

**Decisiones PENDIENTES con mi recomendación (no se asume; no bloquean empezar E2-M ni E2a-1):**

| # | Decisión | Recomendación |
|---|---|---|
| P2 | Bajar la cantidad por debajo de lo que ya salió: rechazar, permitir con aviso (stock negativo, como hace el POS por diseño) o cargar el faltante | **Rechazar** con la salida «registrá un Ajuste de stock» (la opción más simple, igual a hoy) |
| P3 | En E2b, cómo se redistribuye la corrección entre las sucursales con parte (¿proporcional al % declarado, o solo la sucursal cuya parte tiene el renglón?) y qué pasa con la sucursal destino que ya aceptó y consumió | Decidir cuando se llegue a E2b; recomiendo corregir solo dentro de la parte que contiene el renglón y rechazar lo que la dejaría por debajo de lo consumido en esa sucursal |
| P4 | Aceptar el límite de §4: con otra compra del mismo producto en la **misma fecha**, la corregida gana el costo vigente | Aceptar y declararlo; no tocar V-T1 |
| P5 | Quién figura como «cargó» en B (I18) | El cargador original; la persona que corrigió queda en la reversión, la marca y la auditoría |
| P6 | Texto exacto de los mensajes (§8) | Se aprueba con captura de la pantalla real (maqueta con los datos de CORDECC), en la etapa E2a-4 |
| P7 | Autorizar la migración M1 (§6) | Sí, en su propio PR, al ensayar en rama de Neon |

---

## 13. No verificado

- Que `escribirOperacionDeStock` admita el vínculo `reemplazaAOperacionId` para una compra (hoy lo tiene `escribirOperacionDeVenta`).
- Que ningún reporte calcule el stock «a una fecha pasada» sumando por `fecha` (§4): con A, R y B podría verse doble entre la fecha de A y la corrección.
- Que se pueda separar «vendido» de otras salidas para el texto de la pantalla (no se afirma «se vendieron»).
- Qué pasa con compras **anteriores a U0** sin factura, y con las bases de demostración (siguen sin camino de corrección).
- La clave única global de `AnulacionDeFacturaProveedor` (NOT NULL) para el paso 6: forma exacta de derivarla de la clave de la corrección.
- Que los informes de «compras anuladas» no deban contar una factura corregida como anulación de negocio (`test/arquitectura/reportes-compras-anuladas.test.ts`).
- El comportamiento real de producción (no se leyó la base; la palabra del dueño es que no hay datos que convertir).
- No se corrió ningún test, gate ni build: este PR es solo documentos.

### Archivos críticos para implementar

- `src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor.ts` y `corregir-factura-proveedor.ts` (moldes)
- `src/server/persistencia/movimientos/escribir-contra-asiento.ts`, `src/server/persistencia/compras/escribir-anulacion-de-compra.ts`, `escribir-factura-proveedor.ts`, `cargar-compra-para-anular.ts`
- `src/core/compras/anulacion.ts` (reglas de neto) y `public.ts`
- `src/server/actions/movimientos/casos-de-uso/reemplazar-venta-con-menos-unidades.ts` y `src/server/persistencia/movimientos/escribir-venta-corregida.ts` (patrón E1)
- `src/app/(app)/reportes/compras/page.tsx` y `src/app/(pos)/mesas/[mesaId]/corregir-linea.tsx` (patrón de pantalla)
- `prisma/migrations/20261015120000_m2_operacion_reversiones_y_motivo/` (CHECK actual)
