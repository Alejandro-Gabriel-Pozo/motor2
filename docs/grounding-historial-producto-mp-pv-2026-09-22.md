# Grounding: historial de un producto — MP que se compra y se consume, vs. PV sin stock propio (2026-09-22)

**Motivo**: `docs/planes-demo-y-claridad-reportes-2026-09-21.md` §4 ("Historial
por producto y 'líneas' en Compras registradas") ya diagnosticó, con datos
reales de la demo, que `/reportes/historial` muestra un saldo corriente para
CUALQUIER producto — incluidos los PV que por diseño no tienen stock propio —
y escribió una recomendación completa. Esa recomendación se apoya solo en el
razonamiento interno del proyecto: **no tiene grounding externo**, a
diferencia de `docs/grounding-reportes-compras-2026-09-18.md`,
`docs/grounding-desposte-grocy.md` o `docs/grounding-merma-productos-compartidos.md`.
El dueño del producto pidió explícitamente esa verificación. Este documento
es la investigación previa contra código real de ERPNext, Dolibarr, Tandoor
Recipes y Grocy — **no es una implementación**, no se tocó ningún archivo de
`src/`.

Convención (la misma de los groundings previos): **VERIFICADO** = confirmado
leyendo el código citado. **NO ENCONTRADO** = búsqueda hecha, sin resultado
positivo.

**Limitación de método de esta sesión**: no hubo forma de clonar los
repositorios localmente (a diferencia de `grounding-desposte-grocy.md`, que
trabajó sobre un clon en disco y pudo citar `archivo:línea`). Todo lo de
ERPNext/Tandoor/Grocy/Dolibarr de acá se leyó vía `raw.githubusercontent.com`
(ramas `develop`/`master`, al 2026-09-22), que devuelve el archivo sin
numerar — por eso se cita **archivo + función/campo + el texto literal**, sin
número de línea. Las citas de motor2 sí llevan `archivo:línea` porque se
leyeron del repo local.

---

## 1. Qué hace motor2 hoy (leído del código, no de memoria)

### 1.1 El saldo corriente se calcula para todo producto, sin preguntar si tiene stock

`obtenerHistorialProducto` (`src/core/reportes/historial-producto.ts:73-170`)
es una función sola que sirve a MP y PV por igual. No consulta
`Producto.seProduce` en ningún momento (solo `tipo` y `unidadStock`,
`historial-producto.ts:81`), y arma el saldo con la suma acumulada
cronológica de `MovimientoStock.cantidad`:

```ts
// src/core/reportes/historial-producto.ts:152-157
let saldo = saldoInicial;
for (const ev of eventosVisibles) {
  if (ev.tipo !== "movimiento") continue;
  saldo += ev.cantidadConSigno!;
  ev.saldoCorriente = redondearCantidad(saldo);
}
```

Ese número se presenta en tres lugares a la vez:

1. **El encabezado**: `saldo actual: {historial.saldoActual} {unidad}`
   (`src/app/(app)/reportes/historial/page.tsx:50`).
2. **Un gráfico de línea escalonada** de la serie completa
   (`grafico-saldo.tsx:36`, `<Line type="stepAfter" dataKey="saldo" />`).
3. **Una columna "Saldo corriente"** en la tabla
   (`tabla-historial.tsx:18-24`).

Para PV009 ("Agua mineral 500 ml", `seProduce: false`) los tres muestran la
misma cifra sin sentido físico (`saldoActual: -756` en la base de la demo,
182 movimientos, todos `VENTA`): es "unidades vendidas acumuladas, con signo
negativo", no un stock. Para MX004 ("Agua mineral s/gas caja x12", MP) el
mismo cálculo da `348`, que sí es un saldo real.

### 1.2 El artefacto está declarado en el código que lo genera

No es un descubrimiento nuevo: `registrarVenta` lo dice en un comentario al
escribir la línea:

```ts
// src/server/actions/movimientos/venta.ts:222-224
// El PV vendido en sí: signoStock -1 (Movimientos.js:190-205) — si
// no tiene stock real (no "Se produce"), este saldo negativo es un
// artefacto contable de las ventas, mismo criterio que hoy.
```

### 1.3 motor2 YA tiene el predicado — y `/reportes/historial` es el único lugar que no lo usa

`tieneStockReal(tipo, seProduce)` (`src/core/movimientos/transiciones.ts:95-97`)
se aplica como filtro en **todas** las demás superficies que hablan de stock:

| Dónde | Cita |
|---|---|
| Stock consolidado | `src/core/stock/consolidado.ts:54` — `productos.filter((p) => tieneStockReal(...))` |
| Valuación | `src/core/reportes/valuacion.ts:41` — mismo filtro |
| Alertas de stock mínimo | `src/core/movimientos/stock.ts:141` |
| Conteo físico | `src/server/actions/movimientos/conteo-fisico.ts:68` (rechaza el producto) |
| Traspasos entre sucursales | `src/server/actions/traspasos/traspasos.ts:44` (rechaza) |
| Elegibilidad en el catálogo | `src/server/actions/catalogo/productos.ts:34` |

`src/core/reportes/historial-producto.ts` **NO** aparece en esa lista
(grep de `tieneStockReal` sobre todo `src/`). Es decir: la regla de negocio
ya existe, ya está centralizada, y hay exactamente **una** pantalla que
muestra un saldo sin consultarla. Esto reencuadra el hallazgo de §4: no es
"falta una regla nueva", es **una asimetría interna**.

### 1.4 El patrón 1:1 caja→unidad no es una elección del seed: es estructural

Dos validaciones disjuntas lo fuerzan:

- Comprar exige MP: `productoValidoParaProceso`
  (`src/core/movimientos/transiciones.ts:111`) —
  `if (proceso === "COMPRA" && producto.tipo !== "MP") return false;`
- Vender exige PV: `armarVentaCalculada`
  (`src/server/actions/movimientos/venta.ts:72-74`) — *"solo se puede vender
  un PV (vinculado por receta a la materia prima que consume)"*.

Un mismo `Producto` **no puede** comprarse y venderse. Por lo tanto "compro
la caja x12, vendo la unidad" **obliga** a dos productos + una receta 1:1 —
no hay atajo por `Producto.factorConversion` (`prisma/schema.prisma:282`) ni
por `Presentacion` (`prisma/schema.prisma:390-400`), que solo convierten
unidad de compra → unidad de stock **dentro de la misma MP**. La sección 4
muestra que esta no es una rareza de motor2: es una de las tres formas que la
industria usa, y la única compatible con la separación MP/PV.

### 1.5 El vínculo insumo ← venta ya se escribe, fila por fila

Al vender, la línea `VENTA` del PV y las líneas `CONSUMO` de sus insumos se
escriben bajo la **misma** `Operacion` (`venta.ts:187-231`: `operacionId:
operacion.id` en ambas), y el `detalle` del consumo nombra al plato:

```ts
// src/server/actions/movimientos/venta.ts:208
detalle: `Consumo por venta de "${producto?.nombre ?? venta.productoId}".`,
```

`obtenerHistorialProducto` ya devuelve ese `idOperacion` por evento
(`historial-producto.ts:38,132`) — y `tabla-historial.tsx` lo descarta: la
tabla tiene 6 columnas (Fecha, Tipo, Detalle, Sección, Cantidad, Saldo
corriente) y ninguna es el origen. Lo mismo con `proveedorNombre`,
`nroFactura` y `loteVencimiento`, que la capa de datos calcula
(`historial-producto.ts:128-131`) y la UI tira — ya señalado en §4
("La tabla descarta datos que ya calcula y no pinta").

---

## 2. Pregunta 1 — el historial de una MP que se compra y se consume por receta

### 2.1 ERPNext — Stock Ledger con saldo corriente en columna, y drill-down al documento

**VERIFICADO.** `erpnext/stock/report/stock_ledger/stock_ledger.py`
(`get_columns`) devuelve, entre otras: `date`, `item_code`, `stock_uom`,
**`in_qty` ("In Qty")**, **`out_qty` ("Out Qty")**, **`qty_after_transaction`
("Balance Qty")**, `warehouse`, `incoming_rate`, `valuation_rate`
("Avg Rate (Balance Stock)"), `stock_value` ("Balance Value"),
`stock_value_difference` ("Value Change"), **`voucher_type` ("Voucher Type")**
y **`voucher_no` ("Voucher #")**.

Dos diferencias de fondo con motor2:

- ERPNext separa **entrada y salida en dos columnas** (`in_qty`/`out_qty`) y
  el saldo en una tercera. motor2 tiene una sola columna "Cantidad" con
  signo (consecuencia directa de la decisión cerrada de firmar al escribir).
- El saldo corriente de ERPNext es un **campo persistido del asiento**
  (`qty_after_transaction` es una columna real de `Stock Ledger Entry`), no
  un acumulado calculado al leer como en motor2. Ese es exactamente el patrón
  "saldo cacheado" que motor2 decidió no tener; no es una recomendación a
  adoptar, se cita solo para que quede claro que la **columna** de saldo sí es
  estándar.

**Filtros** (`stock_ledger.js`): `company`, `from_date`, `to_date`,
`warehouse` (multi), `item_code` (multi), `item_group`, `batch_no`, `brand`,
`voucher_no`, `project`, `include_uom`, `valuation_field_type`,
`segregate_serial_batch_bundle`. **NO ENCONTRADO**: ningún filtro
server-side por *tipo* de movimiento ("solo compras" / "solo consumos"). Se
filtra por un documento concreto (`voucher_no`), no por clase de movimiento.

### 2.2 Dolibarr — lista de movimientos SIN saldo corriente, con columna "Origin"

**VERIFICADO.** `htdocs/product/stock/movement_list.php`, `$arrayfields`:

```php
'm.rowid' => 'Ref', 'm.datem' => 'Date', 'p.ref' => 'ProductRef',
'p.label' => 'ProductLabel', 'm.batch' => 'BatchNumberShort',
'pl.eatby' => 'EatByDate', 'pl.sellby' => 'SellByDate',
'e.ref' => 'Warehouse', 'm.fk_user_author' => 'Author',
'm.inventorycode' => 'InventoryCodeShort', 'm.label' => 'MovementLabel',
'm.type_mouvement' => 'TypeMovement', 'origin' => 'Origin',
'm.fk_projet' => 'Project', 'm.value' => 'Qty',
'm.price' => 'UnitPurchaseValue'
```

**NO ENCONTRADO**: ninguna columna de saldo acumulado / "stock after". Dolibarr
muestra la cantidad de cada movimiento y nada más; el stock actual se mira en
la ficha del producto, aparte. Es decir: **el saldo corriente en el listado de
movimientos es una convención de ERPNext (y de motor2), no un universal**.

Lo que sí tiene y motor2 no muestra: **`origin`** — el documento que causó el
movimiento, guardado como par polimórfico `fk_origin`/`origintype` por
`MouvementStock::_create`
(`htdocs/product/stock/class/mouvementstock.class.php`, INSERT en
`llx_stock_mouvement`: `... fk_user_author, label, inventorycode, price,
fk_origin, origintype, fk_projet`), documentado en el docstring del método
como *"$this->origin_type and $this->origin_id can be also be set to save the
source object of movement"* — y **`m.type_mouvement`**, disponible como
columna (oculta por defecto) y como criterio de búsqueda.

### 2.3 Grocy — journal sin saldo corriente, pero con filtro por tipo de transacción

**VERIFICADO.** `views/stockjournal.blade.php`. Columnas de la tabla:

```html
<th class="allow-grouping">{{ $__t('Product') }}</th>
<th>{{ $__t('Amount') }}</th>
<th>{{ $__t('Transaction time') }}</th>
<th class="allow-grouping">{{ $__t('Transaction type') }}</th>
<th ...>{{ $__t('Location') }}</th>
<th class="allow-grouping">{{ $__t('Done by') }}</th>
<th>{{ $__t('Note') }}</th>
```

Sin columna de saldo corriente (igual que Dolibarr). Y filtros:
`#search`, **`#product-filter`**, **`#transaction-type-filter`**,
`#location-filter`, **`#user-filter`**, **`#daterange-filter`**.

`#transaction-type-filter` es, literalmente, el filtro "Qué mostrar" que
propone §4 — sobre los `TRANSACTION_TYPE_*` de
`services/StockService.php`: `purchase`, `consume`, `inventory-correction`,
`product-opened`, `self-production`, `stock-edit-new`, `stock-edit-old`,
`transfer_from`, `transfer_to`. **Grocy es el respaldo externo directo de esa
pieza de la recomendación**, y con una vuelta de tuerca que motor2 no tiene:
también se filtra por **quién** lo hizo (`Done by` es columna y filtro).

El resumen item-céntrico vive aparte, en la **product card**
(`views/components/productcard.blade.php`): `Stock amount`, `Stock value`,
`Default location`, `Last purchased`, `Last used`, `Last price`,
`Average price`, `Average shelf life`, `Spoil rate`, un gráfico de
**`Price history`**, y links a `Stock journal` / `Stock entries`. Es decir:
**el resumen en prosa/tarjeta y el journal movimiento-por-movimiento son dos
superficies distintas, y el journal está detrás de un link** — exactamente
la jerarquía que propone §4 (resumen arriba, Kardex plegado en un
`<details>`).

### 2.4 Tandoor — no es el sistema de referencia natural acá, y conviene decirlo

**VERIFICADO, con matiz.** Tandoor sí tiene modelos de inventario:
`InventoryEntry` (`inventory_location`, `sub_location`, `amount`, `unit`,
`food`, `expires`, `note`) e `InventoryLog` (`entry`, `booking_type` ∈
`add|remove|move`, `old_amount`, `new_amount`, `old_inventory_location`,
`new_inventory_location`, `note`, `created_at`), con rutas de API
registradas en `cookbook/urls.py` (`inventory-location`, `inventory-entry`,
`inventory-log`).

Pero el diseño es el **opuesto** al de motor2 en dos puntos que importan:

1. `InventoryLog` guarda **`old_amount`/`new_amount`** (una foto del antes y
   el después), no un delta con signo que se sume. El saldo vive en
   `InventoryEntry.amount`, una tabla mutable — es "tabla de saldo +
   bitácora", no un libro mayor derivado.
2. `entry = models.ForeignKey(InventoryEntry, on_delete=models.CASCADE)`:
   borrar la entrada de stock **borra su historial**. No es append-only.

Y el concepto que un usuario de Tandoor usa a diario no es ese: es
**`Food.onhand_users`** (M2M a `User`), expuesto en la API como un
**booleano** vía `CustomOnHandField` (`cookbook/serializer.py`,
`to_representation` → `obj.onhand_users.filter(id__in=shared_users).exists()`).
O sea: "¿tengo esto en casa?" sí/no, sin cantidad y sin historial.

**Conclusión para este documento**: Tandoor es referencia válida para ficha
técnica/receta (como ya estableció `docs/grounding-ficha-tecnica-tandoor.md`),
**no** para el historial de stock de un insumo. Su ledger es más débil que el
de motor2 y no aporta nada que copiar; se lo cita para cerrar la pregunta con
evidencia, no porque haya algo que adoptar.

---

## 3. Pregunta 2 — ¿cómo se evita el "saldo" de un ítem que no mantiene stock propio?

Este es el punto donde la industria es **unánime y explícita**, y donde el
hallazgo más fuerte de este grounding aparece.

### 3.1 ERPNext — `is_stock_item` decide si el ítem tiene ledger, y el bundle de venta tiene PROHIBIDO tenerlo

**VERIFICADO.** El campo `is_stock_item` del doctype `Item`
(`erpnext/stock/doctype/item/item.json`) tiene label **"Maintain Stock"** y
esta descripción literal:

```json
{
  "default": "1",
  "description": "ERPNext will make a stock ledger entry for each transaction of this item. Keep unchecked for non-stock or service items.",
  "fieldname": "is_stock_item",
  "fieldtype": "Check",
  "label": "Maintain Stock"
}
```

Y el asiento mismo lo valida
(`erpnext/stock/doctype/stock_ledger_entry/stock_ledger_entry.py`):

```python
if item_detail.is_stock_item != 1:
    self.throw_error_message(f"Item {self.item_code} must be a stock Item")
```

Es decir: en ERPNext, un ítem sin stock propio **no tiene filas en el ledger**.
No hay "saldo confuso que explicar": directamente no existe la serie.

Ahora el caso puntual del agua. ERPNext modela "vendo una cosa, se descuenta
otra" con **Product Bundle** (el viejo "sales BOM"), y su primera validación
es exactamente la regla que motor2 no aplica
(`erpnext/selling/doctype/product_bundle/product_bundle.py`):

```python
def validate_main_item(self):
	"""Validates, main Item is not a stock item"""
	if frappe.db.get_value("Item", self.new_item_code, "is_stock_item"):
		frappe.throw(_("Parent Item {0} must not be a Stock Item").format(self.new_item_code))
```

El PV009 de motor2 es, punto por punto, un Product Bundle de un solo
componente: se vende, no se stockea, y lo que baja es el componente. **ERPNext
prohíbe por diseño que ese ítem tenga stock** — y como consecuencia, prohíbe
que tenga un saldo corriente. La pregunta "¿cómo muestran el saldo de un ítem
sin stock propio?" tiene, en ERPNext, una respuesta estructural: **no lo
muestran porque no lo generan.**

¿Y dónde se ve entonces el movimiento? En el ledger de los **componentes**,
con el documento de venta como voucher: `SellingController.update_stock_ledger`
recorre `self.get_item_list()`, que expande los bundles
(`if self.has_product_bundle(d.item_code): for p in self.get("packed_items"):
... il.append(...)` — con el comentario del código *"the packing details
table's qty is already multiplied with parent's qty"*), y de ahí salen los
SLE con `get_sle_for_source_warehouse(d)`. El componente queda con una fila
cuyo `voucher_type`/`voucher_no` es la venta.

### 3.2 Dolibarr — mismo corte, por dos vías

**VERIFICADO (documentación oficial).** Wiki oficial, `Module_Products`:

- Producto vs. servicio: *"A product can be stocked into a warehouse (only
  products appears in module Stock). Services are not visible."*
- Kits / productos virtuales: *"A product or service may be registered as a
  Kit (a 'parent') product, that is, containing other (single) products"*, y
  *"The stock of each individual component inside the virtual product is
  incremented / decremented when the parent product is acquired / delivered"*.
- Y la distinción explícita contra manufactura: en un kit los componentes
  *"will only be decrementing the respective stock at the time of delivery"*,
  quedando disponibles para otras ventas hasta ese momento; en manufactura,
  en cambio, se consumen para producir un ítem que **sí** queda en stock.

Ese último corte es, literalmente, la distinción `seProduce: true` vs.
`seProduce: false` de motor2 — con la diferencia de que en Dolibarr el kit
(el equivalente a `seProduce: false`) **no lleva stock propio**, mientras que
en motor2 igual se le escribe una línea `VENTA` negativa.

### 3.3 Grocy y Tandoor

- **Grocy: NO ENCONTRADO** un concepto de "producto sin stock propio". Grocy
  no vende: todo producto que existe se compra y se consume, así que la
  pregunta no se le plantea. Su respuesta al caso caja→unidad es otra (ver
  sección 4).
- **Tandoor: no aplica** — `food_onhand` es un booleano (sección 2.4); no hay
  saldo que desambiguar.

### 3.4 Síntesis de la pregunta 2

| Sistema | ¿Existe "ítem sin stock propio"? | ¿Qué muestra su historial de stock? |
|---|---|---|
| ERPNext | **Sí, explícito**: `is_stock_item = 0`; el Product Bundle padre está **obligado** a serlo | Nada: no se genera ningún Stock Ledger Entry |
| Dolibarr | **Sí**: servicios (no stockeables) y kits/productos virtuales | Nada: el movimiento vive en los componentes, con su `origin` |
| Grocy | NO ENCONTRADO (no modela venta) | N/A |
| Tandoor | N/A (no hay saldo, solo un booleano por usuario) | N/A |
| **motor2 hoy** | **Sí, y ya está codificado** (`tieneStockReal`, usado en 6 lugares) | **Un saldo corriente, un gráfico y un total en el encabezado** — la única superficie que no consulta el predicado |

---

## 4. Pregunta 3 — "comprar en una presentación, vender en otra" (caja x12 → unidad)

Los cuatro sistemas lo modelan, y **hay tres patrones distintos**, no uno:

### 4.1 Patrón A — conversión de unidad sobre el MISMO ítem (sin segundo producto)

- **ERPNext**: `UOM Conversion Detail` (`erpnext/stock/doctype/uom_conversion_detail/uom_conversion_detail.json`,
  `istable: 1`), tabla hija del `Item` con dos campos: `uom` (Link a UOM,
  `reqd: 1`) y `conversion_factor` (Float, precisión 9), contra el
  `stock_uom` del ítem. Comprás en "Box", stockeás en "Nos", factor 12 — un
  solo ítem, un solo ledger.
- **Grocy**: `qu_id_stock` vs. `qu_id_purchase` en `views/productform.blade.php`,
  con tooltips literales: *"This is the default quantity unit used on purchase
  and when adding this product to the shopping list"* (compra) y, para el de
  stock, *"After this product was once in stock and when the desired quantity
  unit cannot be selected here, first create a corresponding unit conversion"*.
  Hay además `qu_id_consume` y `qu_id_price` — Grocy llega a tener **cuatro**
  unidades por producto (stock, compra, consumo, precio), todas resueltas por
  conversiones, sin duplicar el producto.
- **Tandoor**: `UnitConversion` (`base_amount`, `base_unit`,
  `converted_amount`, `converted_unit`, **`food`**) — la conversión es
  **por alimento**, no global: "1 paquete de este producto = 12 unidades"
  convive con otro alimento donde "paquete" significa otra cosa. Mismo
  espíritu que `Presentacion` de motor2, que también es por producto
  (`@@unique([productoId, unidadCompraId])`, `prisma/schema.prisma:399`).

**motor2 ya tiene este patrón** (`Producto.factorConversion`,
`prisma/schema.prisma:282`; `Presentacion`, `:390-400`; aplicado en COMPRA vía
`aplicaFactorConversion: true`, `transiciones.ts:55`) — pero, como se mostró
en 1.4, **no alcanza** para el caso del agua, porque una MP no se puede
vender. El patrón A en motor2 resuelve "compro la caja, stockeo unidades"; no
resuelve "y además la vendo".

### 4.2 Patrón B — transacción explícita de refraccionamiento

**ERPNext: `Stock Entry` con `purpose = "Repack"`.** El literal de propósitos
(`erpnext/stock/doctype/stock_entry/stock_entry.py`) es:

```python
purpose: DF.Literal[
	"Material Issue", "Material Receipt", "Material Transfer",
	"Material Transfer for Manufacture", "Material Consumption for Manufacture",
	"Manufacture", "Repack", "Send to Subcontractor", "Disassemble",
	"Receive from Customer", "Return Raw Material to Customer",
	"Subcontracting Delivery", "Subcontracting Return",
]
```

con su clase propia (`"Repack": RepackStockEntry`) y ramas dedicadas
(`if self.purpose in ("Manufacture", "Repack")` para los asientos de stock y
el reparto de costos adicionales; `if self.purpose != "Repack"` para la
validación de conversión del producto terminado). Es decir: ERPNext considera
el refraccionamiento un **evento de stock de primera clase**, con nombre
propio, distinto de "fabricar".

Esto es el análogo exacto de `PRODUCCION` en motor2 (`transiciones.ts:56`,
`generaConsumoDeReceta: true`) — y es el camino que en motor2 corresponde a un
PV con `seProduce: true`. **Para el agua, el negocio eligió NO usarlo** (no
hay un acto de fraccionar: se saca la botella de la caja al venderla), lo cual
es coherente: ERPNext tampoco pediría un Repack para eso, pediría un Product
Bundle.

### 4.3 Patrón C — bundle/kit de venta (dos ítems, el vendible sin stock)

Es el 3.1/3.2 de arriba: ERPNext `Product Bundle`, Dolibarr kit/producto
virtual. **Es el patrón que motor2 implementa con la receta 1:1**, y la
implementación de motor2 coincide con la industria en todo salvo en un punto:
el ítem vendible sigue generando una línea de stock propia.

### 4.4 Cómo lo muestran en sus reportes

- **ERPNext**: el historial de ventas del bundle no se mira en el Stock Ledger
  (no existe), se mira en los reportes item-céntricos basados en documentos —
  `erpnext/selling/report/item_wise_sales_history/item_wise_sales_history.py`,
  que consulta `Sales Order`/`Sales Order Item` con `docstatus == 1` (no el
  ledger) y devuelve `item_code`, `item_name`, `item_group`, `description`,
  `quantity`, `uom`, `rate`, `amount`, `sales_order`, `transaction_date`,
  `customer`, `customer_group`, `territory`, `delivered_quantity`,
  `billed_amount`, `currency`. Su gemelo de compras es
  `erpnext/buying/report/item_wise_purchase_history/item_wise_purchase_history.py`
  (sobre `Purchase Order`/`Purchase Order Item`, con `supplier`,
  `supplier_group`, `quantity`, `rate`, `amount`, `transaction_date`,
  `received_quantity`, `billed_amount`).

  **Este par de reportes es el respaldo externo más directo de la recomendación
  de §4**: ERPNext tiene, separadas del ledger y una por cada lado del
  negocio, una vista "cómo se compró este ítem" y una "cómo se vendió este
  ítem" — que es exactamente "Cómo se compró (MP)" y "Cómo se vendió (PV)".
- **Grocy**: la product card (2.3) es la versión chica de lo mismo —
  `Last purchased`, `Last price`, `Average price`, gráfico de `Price history`.
  **NO ENCONTRADO** en Grocy: "cantidad típica" (mediana) o "frecuencia de
  compra" (días entre compras). Esas dos piezas de §4 no tienen precedente en
  ninguno de los cuatro sistemas; son un agregado de motor2 (razonable, pero
  conviene saber que no se está copiando a nadie).

---

## 5. Pregunta 4 — ¿vinculan el consumo de un insumo con la venta del plato?

**Respuesta corta: los cuatro guardan el vínculo fila por fila; ninguno lo
agrega en la vista del insumo.**

| Sistema | ¿Guarda el vínculo? | ¿Lo muestra en el historial del insumo? | ¿Agrega "bajó X porque vendiste Y platos"? |
|---|---|---|---|
| ERPNext | **Sí**: `voucher_type`/`voucher_no` en cada SLE (para un bundle, el voucher es la venta) | **Sí**, dos columnas del Stock Ledger, con drill-down al documento | **NO ENCONTRADO** |
| Dolibarr | **Sí**: `fk_origin`/`origintype` (`MouvementStock::_create`) | **Sí**, columna `origin`, activa por defecto | **NO ENCONTRADO** |
| Grocy | **Sí**: `stock_log.recipe_id`, escrito por `ConsumeProduct(..., $recipeId, ...)` | **NO**: el journal no tiene columna de receta; solo un link genérico *"Search for recipes containing this product"* (`href="{{ $U('/recipes?search=') }}{{ $stockLogEntry->product_name }}"`) | **NO ENCONTRADO** |
| Tandoor | Parcial (`InventoryLog.note`) | No | No |
| **motor2** | **Sí, doble**: mismo `operacionId` que la línea `VENTA` + `detalle` = `Consumo por venta de "<plato>"` | **Parcial**: el `detalle` se ve; el `idOperacion` se calcula y **se descarta en la UI** | No |

Detalle de la cita de Grocy (`services/StockService.php`):

```php
public function ConsumeProduct(int $productId, float $amount, bool $spoiled,
  $transactionType, $specificStockEntryId = 'default', $recipeId = null, ...)
...
$logRow = $this->DB->stock_log()->createRow([
    'product_id' => ..., 'amount' => $stockEntry->amount * -1,
    'transaction_type' => $transactionType, 'recipe_id' => $recipeId,
    'transaction_id' => $transactionId, 'user_id' => GROCY_USER_ID, ...
]);
```

Grocy **persiste** qué receta causó el consumo y **no lo usa** en el journal.
Es el mismo patrón que motor2 (dato guardado, vista que no lo aprovecha) — y
es una señal útil: el vínculo por fila es barato y todos lo guardan; la vista
agregada "este insumo bajó 47 unidades porque se vendieron 47 aguas" **no
existe en ninguno de los cuatro**. Si motor2 la construye, es una feature por
encima del estándar de los cuatro sistemas de referencia, no una carencia que
se esté corrigiendo. (Coherente con lo que ya observó
`docs/grounding-reportes-compras-2026-09-18.md` §5: el vínculo
compra→receta→plato es lo que separa al software de gastronomía de los ERP
genéricos, y ninguno de los tres de la pasada 1 lo tiene porque ninguno modela
recetas.)

---

## 6. Lo que motor2 ya tiene y no está usando para esto

Ninguna pieza de infraestructura nueva hace falta. Todo lo de abajo ya existe:

1. **`tieneStockReal`** (`transiciones.ts:95-97`) — el predicado exacto que
   ERPNext llama `is_stock_item`. Ya filtra consolidado, valuación, alertas,
   conteo y traspasos; solo falta en `historial-producto.ts`.
2. **`MovimientoStock.operacionId` + `/reportes/trazabilidad`** — la pantalla
   de drill-down ya existe y ya acepta `?idOperacion=` como parámetro
   (`src/app/(app)/reportes/trazabilidad/page.tsx:7,15`, sobre
   `obtenerOperacionPorId`, `src/core/reportes/trazabilidad.ts:36`). Convertir
   el `idOperacion` que `obtenerHistorialProducto` **ya devuelve** en un link
   es el equivalente al `voucher_no` clickeable de ERPNext y a la columna
   `origin` de Dolibarr, con **cero backend nuevo**.
3. **`proveedorNombre` / `nroFactura` / `loteVencimiento`**, ya calculados en
   `historial-producto.ts:128-131` y descartados por `tabla-historial.tsx`.
4. **`MovimientoStock.proceso`** — el `#transaction-type-filter` de Grocy es
   un `WHERE proceso IN (...)` sobre un campo que ya está en el `where` de la
   consulta.
5. **`RecetaVersion`/`RecetaIngrediente`** (`prisma/schema.prisma:484+`) — el
   cartel "este PV no tiene stock propio, mirá sus ingredientes" necesita solo
   leer la receta vigente (`MAX(version)`, derivado, ya resuelto).
6. **`Presentacion`/`factorConversion`** — el patrón A de la sección 4.1, ya
   implementado; relevante acá porque explica por qué el caso del agua NO es
   un error de modelado del seed (sección 1.4).

---

## 7. Veredicto sobre §4: **CONFIRMA**, con tres ajustes concretos

La recomendación de §4 **queda confirmada en su forma y en su prioridad**, y
con más respaldo del que tenía:

- "No tocar el Kardex" → coincide con que los cuatro sistemas mantienen el
  ledger crudo intacto y ponen el resumen **en otra superficie** (product card
  de Grocy; Item-wise Sales/Purchase History de ERPNext).
- "Dos vistas nuevas arriba, Kardex plegado en `<details>`" → es el mismo
  reparto que Grocy (product card con `Stock journal` como link) y que ERPNext
  (Stock Ledger vs. reportes item-céntricos basados en documentos).
- "Cómo se compró" / "Cómo se vendió" → tiene gemelos casi literales en
  ERPNext (`item_wise_purchase_history` / `item_wise_sales_history`).
- Filtro "Qué mostrar" → es el `#transaction-type-filter` de Grocy.
- "Para un PV sin stock propio, en vez del gráfico de saldo, un cartel que
  explica y enlaza a la receta" → es la conclusión correcta, y la industria es
  **más dura** todavía (ver ajuste 1).

### Ajuste 1 — el problema no es el gráfico, es el NÚMERO (el más importante)

§4 propone reemplazar **el gráfico de saldo** por un cartel. Pero el saldo
sale por tres caños (sección 1.1) y §4 solo tapa uno: quedarían en pantalla el
encabezado *"saldo actual: -756 unidad"* (`page.tsx:50`) y la columna "Saldo
corriente" (`tabla-historial.tsx:18-24`) — las dos cifras que el usuario
efectivamente lee.

La evidencia externa es inequívoca: ERPNext **no genera** el asiento
(`is_stock_item`), y para un bundle de venta lo **prohíbe** explícitamente
(*"Parent Item {0} must not be a Stock Item"*); Dolibarr tampoco stockea el
kit ni el servicio. En ninguno de los dos existe un lugar donde mirar ese
número y confundirse. Como en motor2 la fila `VENTA` del PV **se queda** (es
donde viven `precioTotal` y `costoUnitarioVenta`, que alimentan margen real y
reportes de venta — y el Kardex es append-only, decisión cerrada), la
traducción fiel del estándar es a nivel de **presentación**:

> cuando `tieneStockReal(tipo, seProduce) === false`: suprimir las tres
> apariciones del saldo (encabezado, gráfico y columna), no solo el gráfico.

Si se quiere conservar algo en la columna, que sea con **otro nombre**
("Vendido acumulado") y **otro signo**, porque el número no es un saldo. Esto
es una decisión de UI, no de dominio.

### Ajuste 2 — sumar la columna "Origen", que ya está calculada

Los dos ERPs generalistas muestran, en la propia línea del ledger, qué
documento la causó (`voucher_type`/`voucher_no`; `origin`). motor2 tiene el
dato en la mano (`idOperacion`) y una pantalla que ya lo consume
(`/reportes/trazabilidad?idOperacion=`). §4 no lo menciona — lo cubre a medias
con el filtro "Qué mostrar", que resuelve el ruido pero no el "¿de dónde salió
esta línea?".

Es **la pieza más barata de todo el paquete** (una columna con un `<Link>`,
cero backend) y resuelve de paso otro hallazgo de §4 ("Las anulaciones se ven
como movimientos fantasma"): con el origen a la vista, el ajuste de anulación
deja de ser anónimo. Recomendación: subirla al mismo paso que el filtro.

### Ajuste 3 — bajar expectativas sobre "cantidad típica" y "frecuencia"

§4 propone mediana de cantidad, días entre compras y variación de precio.
**Variación de precio tiene respaldo** (Grocy: `Last price`, `Average price`,
gráfico de `Price history`; ERPNext: `rate`/`amount` por línea de documento;
y ya lo cubrió `grounding-reportes-compras-2026-09-18.md` §2). **Mediana y
frecuencia: NO ENCONTRADO en ninguno de los cuatro.** No es razón para
descartarlas — el caso real de la demo (tomate perita comprado 27 veces, 1 kg
siempre, al mismo precio) muestra que la pregunta es legítima — pero sí para
tratarlas como **hipótesis propia**, ponerlas después de las que sí tienen
precedente, y estar dispuesto a sacarlas si no se usan.

### Lo que el grounding NO cambia

- El orden de implementación de §6 del plan (Historial después del seed) se
  mantiene.
- La decisión de permisos de §4 (pantalla bajo `ver_reportes_operativos`,
  columnas de dinero bajo `ver_reportes_dinero`) no la toca este grounding:
  ninguno de los cuatro sistemas tiene un corte de permisos comparable
  (Grocy y Tandoor no tienen permisos por columna; ERPNext/Dolibarr los tienen
  por doctype/módulo, no por dato). Queda como estaba: decisión del dueño.
- Las 6 decisiones abiertas de §4 siguen abiertas; este documento solo aporta
  evidencia indirecta y no resuelve ninguna.

---

## 8. Decisiones de negocio que este documento NO resuelve (y no debería)

1. **¿El encabezado de un PV sin stock muestra "Vendido acumulado" o no
   muestra nada?** El estándar dice "no debería haber un saldo"; qué poner en
   su lugar es producto.
2. **¿Se le pone nombre al patrón en la UI?** ERPNext lo llama *Product
   Bundle*, Dolibarr *kit / producto virtual*. motor2 hoy lo llama "un PV con
   receta 1:1", que no es un nombre. Ponerle uno visible ("producto de
   reventa", "se arma al vender") haría el cartel mucho más claro — pero es
   vocabulario, y el vocabulario lo fija el dueño (mismo criterio que §2 del
   plan con "producto"/"movimiento"/"compra").
3. **¿Debería `registrarVenta` dejar de escribir la línea `VENTA` para un PV
   sin stock real?** Es lo que haría ERPNext. **La recomendación de este
   documento es NO hacerlo** (esa fila carga `precioTotal` y
   `costoUnitarioVenta`, de los que dependen margen real, ventas por producto
   y ventas por categoría; y el Kardex es append-only por decisión cerrada) —
   pero queda anotado que la divergencia contra ERPNext es **deliberada y
   costosa de revertir**, no un descuido. Si alguna vez se discute, que se
   discuta sabiendo esto.

---

## Fuentes

Todo lo externo se leyó vía `raw.githubusercontent.com` (ramas `develop` de
ERPNext/Dolibarr/Tandoor, `master` de Grocy) el 2026-09-22, sin clonar los
repos — por eso las citas son archivo + función/campo + texto literal, sin
número de línea (ver "Limitación de método" al inicio).

**ERPNext** (`frappe/erpnext`):
- `erpnext/stock/report/stock_ledger/stock_ledger.py` (`get_columns`,
  `get_stock_ledger_entries`) y `stock_ledger.js` (filtros)
- `erpnext/stock/doctype/item/item.json` (`is_stock_item` / "Maintain Stock")
- `erpnext/stock/doctype/stock_ledger_entry/stock_ledger_entry.py`
  (*"Item {0} must be a stock Item"*)
- `erpnext/selling/doctype/product_bundle/product_bundle.py`
  (`validate_main_item`, `validate_child_items`)
- `erpnext/controllers/selling_controller.py` (`update_stock_ledger`,
  `get_item_list` con `packed_items`)
- `erpnext/stock/doctype/stock_entry/stock_entry.py` (`purpose` literal,
  `"Repack": RepackStockEntry`)
- `erpnext/stock/doctype/uom_conversion_detail/uom_conversion_detail.json`
- `erpnext/selling/report/item_wise_sales_history/item_wise_sales_history.py`
- `erpnext/buying/report/item_wise_purchase_history/item_wise_purchase_history.py`

**Dolibarr** (`Dolibarr/dolibarr`):
- `htdocs/product/stock/movement_list.php` (`$arrayfields`)
- `htdocs/product/stock/class/mouvementstock.class.php` (`_create`,
  `fk_origin`/`origintype`)
- [Module Products — Dolibarr Wiki](https://wiki.dolibarr.org/index.php/Module_Products)
  (kits/productos virtuales, producto vs. servicio y stock)
- [Virtual products (kits) — foro oficial](https://www.dolibarr.org/forum/t/virtual-products-kits-decrease-how-to-increase/17277)
  (corroboración de que el decremento ocurre en la entrega, no antes)

**Grocy** (`grocy/grocy`):
- `views/stockjournal.blade.php` (filtros y columnas del journal)
- `views/components/productcard.blade.php` (resumen item-céntrico)
- `views/productform.blade.php` (`qu_id_stock`/`qu_id_purchase`/`qu_id_consume`/
  `qu_id_price` y sus tooltips)
- `services/StockService.php` (`TRANSACTION_TYPE_*`, `ConsumeProduct` con
  `$recipeId`, insert en `stock_log` con `recipe_id`)
- Ya cubierto antes: `docs/grounding-desposte-grocy.md` (recetas N→1,
  `ConsumeRecipe`, `TRANSACTION_TYPE_SELF_PRODUCTION`)

**Tandoor Recipes** (`TandoorRecipes/recipes`):
- `cookbook/models.py` (`Food.onhand_users`, `UnitConversion`,
  `InventoryEntry`, `InventoryLog`)
- `cookbook/serializer.py` (`FoodSerializer.food_onhand` / `CustomOnHandField`,
  `UnitConversionSerializer`)
- `cookbook/urls.py` (rutas `inventory-entry`, `inventory-log`,
  `unit-conversion`)
- Ya cubierto antes: `docs/grounding-ficha-tecnica-tandoor.md`

**Documentos propios del proyecto usados como punto de partida**:
`docs/planes-demo-y-claridad-reportes-2026-09-21.md` §4 y §5,
`docs/grounding-reportes-compras-2026-09-18.md`,
`docs/grounding-desposte-grocy.md`,
`docs/grounding-merma-productos-compartidos.md`,
`docs/grounding-ficha-tecnica-tandoor.md`.
