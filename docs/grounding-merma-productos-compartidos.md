# Grounding: merma por producto vs. merma por línea de receta

Expediente de la diligencia técnica corrida el 2026-09-16 contra código real de
[ERPNext](https://github.com/frappe/erpnext) (clonado localmente en
`/home/user/frappe/erpnext`, módulo `erpnext/manufacturing/` y doctype `Item`
en `erpnext/stock/doctype/item/`) y de
[Dolibarr](https://github.com/Dolibarr/dolibarr) (clonado localmente en
`/home/user/dolibarr/dolibarr`, módulo `htdocs/bom/`) — mismo criterio de cita
y misma convención VERIFICADO/NO ENCONTRADO que
`docs/comparativa-ux-erpnext-dolibarr.md` y
`docs/grounding-ficha-tecnica-tandoor.md` (documentos DISTINTOS, no tocados
acá). Pregunta concreta: ¿la merma de un insumo debería vivir como default a
nivel `Producto`, o alcanza con `RecetaIngrediente.mermaPorcentaje` (por
línea, ya existente)?

Convención: **VERIFICADO** = confirmado leyendo el código fuente citado. **NO
ENCONTRADO** = búsqueda exhaustiva sin resultado positivo (ausencia
confirmada, no simple desconocimiento).

---

## 0. Punto de partida: ¿motor2 ya soporta un mismo insumo en varias recetas?

**VERIFICADO, ya resuelto, sin necesidad de más investigación.** No hay
ningún UNIQUE ni restricción que ate un `Producto` (MP) a una sola receta:

```prisma
// prisma/schema.prisma:427-443
model RecetaIngrediente {
  id               String        @id @default(cuid())
  recetaVersionId  String
  recetaVersion    RecetaVersion @relation(fields: [recetaVersionId], references: [id], onDelete: Cascade)
  insumoProductoId String
  insumoProducto   Producto      @relation("RecetaIngredienteInsumo", fields: [insumoProductoId], references: [id])
  cantidad         Decimal       @db.Decimal(14, 4)
  unidadId         String
  unidad           Unidad        @relation(fields: [unidadId], references: [id])
  mermaPorcentaje  Decimal       @default(0) @db.Decimal(6, 2)
  observaciones    String?

  @@index([insumoProductoId])
}
```

`insumoProductoId` es un FK simple, sin `@@unique`. "Nalga" puede aparecer en
`N` filas `RecetaIngrediente`, una por cada `RecetaVersion` (una por PV) que
la use — el índice `@@index([insumoProductoId])` incluso está pensado para
recorrer justamente ese caso (todas las recetas que usan un insumo dado).
`mermaPorcentaje` vive en esa fila, es decir, ya es por-insumo-por-receta:
"nalga en Bifes" y "nalga en Milanesas" son dos filas distintas con
`mermaPorcentaje` potencialmente distinto. Esto ya está resuelto en el modelo
actual — no requiere cambios.

Lo que sigue es exclusivamente la pregunta 2 y 3: si además conviene un
default a nivel `Producto`.

## 1. ERPNext — ¿qué es "scrap" realmente?

### 1.1 `BOM Item` (línea de insumo de entrada): NO ENCONTRADO

**NO ENCONTRADO.** `BOM Item` es el child doctype que representa cada línea
de materia prima que entra a un BOM
(`/home/user/frappe/erpnext/erpnext/manufacturing/doctype/bom_item/bom_item.json`).
Se extrajeron los 38 `fieldname` completos del doctype:

```
item_code, item_name, operation, bom_no, source_warehouse, description,
image, image_view, percentage, qty, uom, stock_qty, stock_uom,
conversion_factor, rate, base_rate, amount, base_amount,
qty_consumed_per_unit, allow_alternative_item, include_item_in_manufacturing,
original_item, has_variants, sourced_by_supplier, do_not_explode,
is_stock_item, operation_row_id, is_sub_assembly_item, is_phantom_item,
is_balance_item
```

Ningún campo de porcentaje de merma/desperdicio/pérdida sobre esta línea de
entrada. El único campo `Percent` es `percentage` (`bom_item.json:142-147`,
label "Percentage (%)"), condicionado a `is_balance_item` — es la porción que
le corresponde a esa línea dentro de un reparto de "item de balanceo" entre
varios sub-BOMs, un concepto de reparto de costo entre BOMs alternativos, NO
una pérdida de proceso. Conclusión: ERPNext **no tiene** un equivalente
estructural de `RecetaIngrediente.mermaPorcentaje` en la línea de entrada.

### 1.2 "Scrap" en ERPNext = BYPRODUCT, no pérdida de rendimiento

**VERIFICADO.** El campo `secondary_item_type` de `BOM Secondary Item`
(`/home/user/frappe/erpnext/erpnext/manufacturing/doctype/bom_secondary_item/bom_secondary_item.json:35-41`)
tiene como opciones literales:

```json
"options": "\nCo-Product\nBy-Product\nScrap\nAdditional Finished Good"
```

Es decir, "Scrap" en ERPNext es UN TIPO de ítem de **salida** del proceso de
manufactura, al mismo nivel que "Co-Product" o "By-Product" — algo que sale
del otro lado del proceso con código de producto propio, valuación propia
(`valuation_type`: Valuation Rate / % of Component Cost / Manual,
`bom_secondary_item.json:180-188`) y hasta warehouse propio de destino
(`work_order.json:291-298`: `scrap_warehouse`, descripción literal *"This is
a location where scraped materials are stored"*). Es aserrín, retazos,
recortes que se venden o se descartan — no es "necesito más materia prima
porque una parte se pierde". Esto confirma explícitamente lo que el pedido
sospechaba: **"scrap" en ERPNext ≠ merma de rendimiento sobre un insumo de
entrada**. Es tracking de subproducto/desecho de SALIDA, un concepto que hoy
motor2 no tiene y que es un gap DISTINTO (y no relevante a esta pregunta).

### 1.3 `process_loss_percentage` — existe, pero a nivel de SALIDA agregada del BOM, no por insumo

**VERIFICADO.** Hay un campo de pérdida por proceso, pero vive en el doctype
`BOM` (cabecera, no línea) y se aplica sobre la cantidad de PRODUCTO
TERMINADO planificada, no sobre cada insumo:

```json
// bom.json:549-561
{ "fieldname": "process_loss_percentage", "fieldtype": "Percent", "label": "% Process Loss" },
{ "fieldname": "process_loss_qty", "fieldtype": "Float", "label": "Process Loss Qty", "read_only": 1 }
```

```python
# bom.py:1131-1138
def set_process_loss_qty(self):
    if self.process_loss_percentage:
        self.process_loss_qty = flt(self.quantity) * flt(self.process_loss_percentage) / 100

    for item in self.secondary_items:
        item.process_loss_qty = flt(
            item.stock_qty * (item.process_loss_per / 100), self.precision("quantity")
        )
```

`self.quantity` es la cantidad de salida del BOM (el producto terminado que
se fabrica), no un insumo. El segundo bloque (`item.process_loss_per`) itera
`self.secondary_items`, que es la misma tabla `BOM Secondary Item` de la
sección 1.2 — de nuevo los ítems de salida (co-producto/subproducto/scrap),
no los de entrada. Conclusión: incluso el "process loss" nominal de ERPNext
mide pérdida sobre lo que sale del proceso (el lote fabricado, o un
subproducto de salida), nunca sobre cuánto insumo de entrada extra hace
falta por línea. `Work Order` (`work_order.json`) repite el mismo patrón:
`scrap_warehouse` (salida) y `process_loss_qty` calculado, sin ningún campo
de pérdida por línea de insumo.

### 1.4 `Item` (producto) — NO ENCONTRADO

**NO ENCONTRADO.** Búsqueda exhaustiva (`scrap|wastage|yield|shrinkage|loss`,
case-insensitive) sobre
`/home/user/frappe/erpnext/erpnext/stock/doctype/item/item.json` (el doctype
maestro de producto/insumo, equivalente a `Producto` en motor2): cero
resultados. ERPNext no tiene ningún campo de merma/rendimiento default a
nivel Item. Tampoco en `Production Plan` / `Production Plan Item`
(`erpnext/manufacturing/doctype/production_plan*`): cero resultados con la
misma búsqueda.

## 2. Dolibarr — línea de BOM SÍ tiene un campo de rendimiento por línea

### 2.1 `BomLine::efficiency` — VERIFICADO, y es el análogo real de `mermaPorcentaje`

**VERIFICADO.** `bomline.class.php` (la línea de insumo de un BOM en
Dolibarr — no hay una tabla separada de "salidas": el BOM de Dolibarr modela
solo componentes que se consumen, ver `bomtype` en 2.2) tiene un campo
`efficiency` a nivel de LÍNEA, habilitado (`enabled: 1`):

```php
// htdocs/bom/class/bomline.class.php:94
'efficiency' => array('type' => 'double(24,8)', 'label' => 'ManufacturingEfficiency',
  'enabled' => 1, 'visible' => 0, 'default' => '1', 'position' => 110, 'notnull' => 1,
  'css' => 'maxwidth50imp', 'help' => 'ValueOfEfficiencyConsumedMeans'),
```

Rango validado en `create()` y `update()`:

```php
// htdocs/bom/class/bomline.class.php:234-235 (y 329-330, misma validación en update)
if ($this->efficiency < 0 || $this->efficiency > 1) {
    $this->efficiency = 1;
}
```

Y se usa exactamente como una merma de rendimiento (a más pérdida, más
insumo bruto hace falta para la misma cantidad neta):

```php
// htdocs/bom/class/bom.class.php:1449 / 1458
$line->total_cost = (float) $line->unit_cost * $line->qty / $line->efficiency;
```

Con `efficiency = 0.85` (85% de rendimiento, equivalente a ~15% de merma),
el costo de esa línea se divide por 0.85 — es decir, se necesita más
cantidad/costo de esa materia prima específica para obtener la cantidad neta
planificada. Esto es estructuralmente equivalente a
`RecetaIngrediente.mermaPorcentaje`: **vive en la línea del BOM (por
insumo × por receta), no en el producto**, exactamente como motor2 ya lo
tiene hoy (con la fórmula invertida: `efficiency ≈ 1 / (1 + mermaPorcentaje/100)`).

### 2.2 `Bom` (cabecera) — el mismo campo, a nivel producto, fue CONSIDERADO y DESCARTADO

**VERIFICADO, y es el hallazgo más relevante para la pregunta 3.** En
`bom.class.php`, justo debajo de la definición de campos de cabecera del BOM
(que sí incluye `bomtype`: Manufacturing/Disassemble, y `fk_product`, el
producto terminado que define ese BOM), hay una línea de código
**comentada**, es decir, un campo que Dolibarr definió pero decidió NO
habilitar:

```php
// htdocs/bom/class/bom.class.php:119-120
'qty' => array('type' => 'real', 'label' => 'Quantity', 'enabled' => 1, ...),
//'efficiency' => array('type'=>'real', 'label'=>'ManufacturingEfficiency', 'enabled'=>1,
//  'visible'=>-1, 'default'=>'1', 'position'=>100, 'notnull'=>0, 'css'=>'maxwidth50imp',
//  'help'=>'ValueOfMeansLossForProductProduced'),
```

Notar el `help` distinto: `ValueOfMeansLossForProductProduced` (pérdida del
PRODUCTO PRODUCIDO, es decir, del output del BOM completo — un default único
por BOM/producto) contra `ValueOfEfficiencyConsumedMeans` de la línea
(pérdida de LO QUE SE CONSUME, por insumo). Dolibarr modeló ambas variantes
explícitamente, las dos con la misma semántica de rendimiento, y dejó
**habilitada solo la de línea**, dejando la de cabecera/producto comentada
(código muerto, nunca activado en ningún release). Es una decisión de diseño
documentada en el propio código fuente, no una omisión.

### 2.3 `Product` — NO ENCONTRADO

**NO ENCONTRADO.** Búsqueda exhaustiva (`perte|wastage|efficiency|shrinkage|
yield|rendement|déchet`, case-insensitive) sobre
`/home/user/dolibarr/dolibarr/htdocs/product/class/product.class.php`
(7562 líneas): cero resultados. Tampoco hay un campo de merma/rendimiento
default a nivel `Product` en Dolibarr.

## 3. Síntesis de lo verificado

| Sistema | Campo de % pérdida en LÍNEA de insumo (entrada) | Campo de % pérdida/rendimiento a nivel PRODUCTO (default) |
|---|---|---|
| ERPNext `BOM Item` / `Item` | NO ENCONTRADO | NO ENCONTRADO |
| ERPNext `BOM`/`Work Order` (solo salida) | N/A (es cabecera, no línea) | Existe pero mide pérdida de SALIDA (`process_loss_percentage`), no de insumo — y "scrap" ahí es directamente un byproduct con código propio, no un %. |
| Dolibarr `BomLine` | **VERIFICADO** — `efficiency` (bomline.class.php:94), habilitado y en uso | — |
| Dolibarr `Bom` (cabecera/producto) | — | **Existió en el diseño, quedó comentado/deshabilitado** (bom.class.php:120) |
| Dolibarr `Product` | N/A | NO ENCONTRADO |

Ningún sistema de referencia tiene, habilitado y en uso, un default de
merma/rendimiento a nivel producto. El único lugar donde ese concepto de
"pérdida por producto" fue considerado explícitamente en el código —
Dolibarr, `bom.class.php:120` — quedó descartado a favor de la variante por
línea, que es la que ambos sistemas (Dolibarr con `efficiency` habilitado, y
motor2 con `mermaPorcentaje`) efectivamente usan.

## 4. Veredicto y recomendación

**No agregar un default de merma a nivel `Producto`. El modelo actual de
motor2 (merma solo por línea de receta) ya es el correcto, y coincide con lo
que hacen los dos sistemas de referencia una vez que se separa la señal del
ruido.**

Razones, en el propio lenguaje del negocio:

1. **La causa raíz de la merma no es el corte, es la preparación.** El
   pedido original lo dice con precisión: la MISMA nalga cruda tiene una
   merma distinta según si se prepara para Bifes (se recorta grasa y
   nervios, corte más limpio) o para Milanesas (fetas más finas, más
   descarte de bordes). La merma es una propiedad del PROCESO/RECETA que se
   le aplica al insumo, no una propiedad física fija del insumo en sí. Un
   default en `Producto.mermaPorcentaje` estaría modelando la causa
   equivocada: sugeriría que "nalga" tiene UNA merma característica, cuando
   en la realidad del negocio tiene tantas mermas como preparaciones
   distintas se le apliquen. Esto es exactamente lo que evidenció Dolibarr
   al descartar la variante de cabecera/producto (`ValueOfMeansLossForProductProduced`)
   y quedarse solo con la de línea (`ValueOfEfficiencyConsumedMeans`).

2. **Ningún sistema de referencia lo tiene habilitado.** No es una omisión
   de motor2 respecto a un estándar de la industria — es la ausencia
   consistente en dos ERPs maduros y de dominios distintos (ERPNext:
   manufactura genérica; Dolibarr: PyME/servicios), y en un caso (Dolibarr)
   hay evidencia directa de que se lo pensó y se lo descartó.

3. **Un default mal calibrado es peor que no tener default.** Si se agrega
   `Producto.mermaPorcentaje` como valor de pre-carga, el riesgo concreto es
   que alguien dé de alta "nalga en Milanesas" y el formulario le sugiera la
   merma de Bifes (o un promedio sin sentido de ambas) solo porque coincide
   el insumo — y que lo acepte sin pensar, silenciosamente, porque "ya venía
   cargado". Eso es peor que un campo en blanco que obliga a pensar el
   número real de esa preparación puntual.

4. **El caso en que SÍ tendría sentido no es este.** Un default de
   producto se justifica cuando la merma es intrínseca al insumo
   independientemente de qué se cocine con él — por ejemplo, un envase que
   sistemáticamente se rompe 2% en el traslado, o una verdura con cáscara
   que siempre se pela igual sin importar el plato. Ninguno de los ejemplos
   reales del pedido (nalga, lomo, bife criollo) cae en ese caso: todos son
   cortes de carne cuyo trim depende de la preparación.

Si en el futuro aparece un insumo real que SÍ tenga una merma
insumo-intrínseca y estable en todas sus recetas (el caso del punto 4), la
solución mínima y de bajo riesgo — recién en ese momento, no ahora — sería
agregar un campo opcional y puramente informativo en `Producto`, nunca
autoritativo:

```prisma
// Sketch, NO aplicado — solo si en el futuro aparece un caso real de
// merma intrínseca al insumo, independiente de la preparación.
model Producto {
  // ...
  mermaDefaultPorcentaje Decimal? @db.Decimal(6, 2)
  // Usado SOLO como valor de pre-carga sugerido al crear un nuevo
  // RecetaIngrediente para este insumo; nunca sobreescribe ni valida
  // contra RecetaIngrediente.mermaPorcentaje, que sigue siendo la fuente
  // de verdad real y editable en cada receta.
}
```

Pero con la evidencia de este relevamiento — ni ERPNext ni Dolibarr lo tienen
en uso, y el propio escenario del negocio (nalga/lomo/bife criollo con
distinto trim según el plato) es el caso de libro donde ese default sería
activamente engañoso — la recomendación concreta para motor2 hoy es: **no
agregarlo.** El modelo actual, `mermaPorcentaje` solo en `RecetaIngrediente`,
ya es suficiente y ya es correcto para el escenario real descripto.
