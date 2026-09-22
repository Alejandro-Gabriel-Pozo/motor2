# Grounding: las 5 decisiones abiertas de "Rendimiento real de recetas" (2026-09-22)

**Motivo**: `docs/planes-demo-y-claridad-reportes-2026-09-21.md` §3 ("Rendimiento
real de recetas: el +14,3 % y el botón peligroso") dejó **5 decisiones del dueño
sin tomar**. El arreglo urgente (el botón "Usar este valor" sin guarda) ya está
hecho (commit `74a14ab`, §6 punto 1) y **no es parte de este grounding**. Lo que
sigue abierto es qué ES este reporte y cómo se leen sus números. Este documento
es la investigación previa contra código real de ERPNext, Dolibarr, Grocy y
Tandoor Recipes (+ Odoo y la literatura de cycle counting donde ninguno de los
cuatro es la referencia natural) — **no es una implementación**: no se tocó
ningún archivo de `src/`.

Convención (la misma de los groundings previos): **VERIFICADO** = confirmado
leyendo el código citado. **NO ENCONTRADO** = búsqueda hecha, sin resultado
positivo.

**Limitación de método** (igual que `docs/grounding-historial-producto-mp-pv-2026-09-22.md`):
no hubo forma de clonar los repositorios ni de correr `curl` en esta sesión
(Bash deshabilitado). Todo lo externo se leyó vía `raw.githubusercontent.com`
(ramas `develop` de ERPNext/Dolibarr, `master` de Grocy, `17.0` de Odoo) el
2026-09-22 — por eso se cita **archivo + función/campo + texto literal**, sin
número de línea. Las citas de motor2 sí llevan `archivo:línea` (repo local).

---

## 0. Resultado en una línea por decisión

| # | Decisión | Veredicto del grounding |
|---|---|---|
| 1 | ¿Calibrador o medidor de pérdidas? | **Resuelta por evidencia: calibrador, y solo calibrador.** Los tres sistemas que modelan producción tienen reportes SEPARADOS, y motor2 **ya tiene el medidor de pérdidas construido** (`/reportes/diferencias` + `/reportes/perdidas`) |
| 2 | ¿Conteos físicos periódicos? | **La mitad técnica está resuelta: no existe alternativa.** Los cuatro sistemas exigen una cantidad contada por un humano para tener varianza real. La mitad operativa (¿el dueño se compromete?) **sigue siendo decisión de negocio** |
| 3 | ¿Filas 1:1/packaging: ocultar o rotular? | **Resuelta por evidencia: rotular, nunca ocultar — y con un dato DECLARADO, no inferido.** Ningún sistema infiere la exclusión de los números |
| 4 | ¿Ventana por defecto? | **Ya resuelta en el código** (`resolverRangoDeReporte`, 30 días). El grounding **no aporta nada nuevo**: NO ENCONTRADO un mínimo estadístico en ningún sistema. Queda un residuo real: la escala de confianza |
| 5 | ¿Umbral relativo a la banda de ruido? | **Parcialmente resuelta: el umbral fijo ES el estándar** (con override por ítem). La banda estadística NO tiene precedente. Pero hay una tercera salida mejor y ya usada en motor2: **ordenar por impacto en $, no por %** |

---

## 1. Qué hace motor2 hoy (leído del código, no de memoria)

### 1.1 La fórmula, literal

`calcularRendimientoRecetasSimples` (`src/core/reportes/rendimiento-recetas.ts:183-238`)
hace dos consultas al Kardex —`proceso: "COMPRA"` sobre el pool de MP y
`proceso: "VENTA"` sobre el PV— y divide:

    // src/core/reportes/rendimiento-recetas.ts:212-214
    const cantidadEstimada = totalVendido > 0 ? redondearCantidad(totalComprado / totalVendido) : null;
    const desviacionPorcentaje =
      cantidadEstimada !== null && uso.cantidad > 0 ? Math.round(((cantidadEstimada - uso.cantidad) / uso.cantidad) * 1000) / 10 : null;

**El insumo entra por `COMPRA` y sale por `VENTA`.** No hay saldo inicial, no hay
saldo final, no hay `PRODUCCION`, no hay `MERMA`, no hay `CONTROL`. Ese es,
exactamente, el diagnóstico del +14,3 % de §3 — acá queda con su cita.

### 1.2 `esTrivial` es una INFERENCIA de dos números, no un dato declarado

    // src/core/reportes/rendimiento-recetas.ts:93-95
    function esUsoTrivial(uso: Pick<UsoDeInsumo, "cantidad" | "mermaPorcentaje">): boolean {
      return uso.cantidad === 1 && uso.mermaPorcentaje === 0;
    }

De ahí sale el rótulo "(venta directa)" (`fila-simple.tsx:113`) que §3 ya marcó
como mal aplicado a una sub-receta producida o a una caja de cartón. La causa
está a la vista: **el predicado no mira ni `Producto.seProduce`, ni el `Grupo`
del insumo, ni el `tipo`** — solo dos campos de la línea de receta.

### 1.3 El umbral de ámbar es un número mágico DUPLICADO

    // src/app/(app)/reportes/rendimiento-recetas/fila-simple.tsx:35
    className={`px-2 py-2 ${desviacionPorcentaje !== null && Math.abs(desviacionPorcentaje) >= 10 ? "font-medium text-amber-700 dark:text-amber-600" : ""}`}

La misma expresión, carácter por carácter, en `fila-compartida.tsx:26`. No hay
constante compartida, no hay comentario que justifique el 10, y **nada de esto
está en `src/core/`** (es puro CSS condicional en la capa de presentación).
Independientemente de lo que se decida en la decisión 5, eso es un hallazgo por
sí solo.

### 1.4 motor2 YA tiene el medidor de pérdidas — y es el hallazgo más importante de este documento

`src/core/reportes/diferencias-ajustes.ts` (`generarReporteDiferenciasAjustes`,
pantalla `/reportes/diferencias`) suma, por MP, los movimientos `AJUSTE` y
`CONTROL` (= conteo físico) y **ya hace exactamente la separación que la decisión
1 plantea**, con las dos ramas nombradas en su docstring:

    // src/core/reportes/diferencias-ajustes.ts:50-55
     * - MP sin ninguna receta que la consuma: su saldo es una suma literal de
     *   movimientos reales — un Ajuste ahí es una anomalía a investigar.
     * - MP que solo se descuenta vía Receta: el consumo es una fórmula, no una
     *   medición real — un Ajuste ahí es esperable (señal para recalibrar la
     *   Merma % de la receta).

Grupo "a" (`grupoTexto: "Sin receta asociada"`, estado `REVISAR`) = **medidor de
pérdidas**. Grupo "b" (`"Solo receta"`, estado `ESPERADO`, con
`sugerenciaMerma: "aumentar" | "disminuir"`) = **calibrador**. Y el campo
`sugerenciaMerma` ya trae, en su propio docstring
(`diferencias-ajustes.ts:33-40`), la advertencia de por qué se da una señal
direccional y no un número:

     * Señal direccional (nunca un número puntual — atribuir la magnitud
     * exacta a una receta en particular exigiría prorratear el consumo
     * entre todas las recetas que usan este insumo, cada una con su propia
     * merma%, y arriesgarse a un cálculo tan engañoso como el que ya se
     * descartó para "Rendimiento real de recetas" opción B)

A eso se suma `/reportes/perdidas` (`src/core/reportes/perdidas.ts:45`), que
valoriza `MERMA` y `CONSUMO` evento por evento con el costo de reposición.

**Conclusión de esta sección**: la pregunta de la decisión 1 no es "¿qué debería
ser este reporte?" en el vacío — es "¿por qué hay dos reportes midiendo pérdida
y uno de ellos no lo sabe?". El medidor de pérdidas **ya existe, ya está anclado
en conteos físicos, y ya está en producción**.

---

## 2. Decisión 1 — ¿calibrador de recetas o medidor de pérdidas?

### 2.1 ERPNext — los separa en TRES reportes, y ninguno usa compras como input

**VERIFICADO.** ERPNext tiene reportes distintos para las dos preguntas, en
módulos distintos.

**Calibrador A — `erpnext/manufacturing/report/work_order_consumed_materials/work_order_consumed_materials.py`.**
Columnas (label / fieldname): "Id" / `name`, "Status" / `status`,
"Production Item" / `production_item`, "Qty to Produce" / `qty`,
"Produced Qty" / `produced_qty`, "Raw Material Item" / `raw_material_item_code`,
"Item Name" / `raw_material_name`, **"Required Qty" / `required_qty`**,
"Transferred Qty" / `transferred_qty`, **"Consumed Qty" / `consumed_qty`**,
**"Extra Consumed Qty" / `extra_consumed_qty`**, "Returned Qty" / `returned_qty`.
El cálculo central de `get_data` es literalmente la resta:

    d.extra_consumed_qty = d.consumed_qty - d.required_qty

`required_qty` sale de la BOM; `consumed_qty` sale de los Stock Entry reales
contra esa Work Order. **Es la comparación "receta vs. lo que el operario
declaró que usó", y las compras no participan en ningún momento.**

**Calibrador B — `erpnext/manufacturing/report/bom_variance_report/bom_variance_report.py`.**
Columnas: "Work Order", "BOM No", "Finished Good" / `production_item`,
"Ordered Qty", "Produced Qty", "Raw Material", "Required Qty", "Consumed Qty".
Filtros: `bom_no` y `work_order`. Su `get_data` restringe a
`(wo.produced_qty > wo.qty) & (wo.docstatus == 1)`. Otra vez: BOM vs. consumo
declarado, anclado a una orden de producción concreta.

**Medidor de pérdidas A (pérdida dentro del proceso) — `erpnext/manufacturing/report/process_loss_report/process_loss_report.py`.**
Columnas: "Work Order" / `name`, "Item" / `production_item`, "Status" / `status`,
"Qty To Manufacture" / `qty_to_manufacture`, "Manufactured Qty" / `produced_qty`,
**"Process Loss Qty" / `process_loss_qty`**, **"Process Loss Value" / `total_pl_value`**,
"Finished Goods Value" / `total_fg_value`, "Raw Material Value" / `total_rm_value`.
Filtros: `company` (obligatorio), `from_date`, `to_date`, `item`, `work_order`.
Es el único de los tres que tiene rango de fechas — coherente con que es un
reporte de **período**, no de calibración.

**Medidor de pérdidas B (pérdida no explicada) — `erpnext/stock/doctype/stock_reconciliation/stock_reconciliation.py`.**
`purpose: DF.Literal["", "Opening Stock", "Stock Reconciliation"]`,
`expense_account: DF.Link | None`, `difference_amount: DF.Currency`, y el cálculo:

    d.quantity_difference = flt(d.qty) - flt(d.current_qty)
    d.amount_difference = flt(d.amount) - flt(d.current_amount)

`current_qty` = saldo del sistema; `qty` = lo contado. Ese delta va a una cuenta
de gasto ("Stock Adjustment"). **Esto es, uno a uno, el grupo "a" de
`/reportes/diferencias` de motor2.**

### 2.2 Dolibarr — los separa en dos MÓDULOS distintos

**VERIFICADO.**

- **Calibrador**: módulo MRP. `htdocs/mrp/class/mo.class.php` maneja líneas
  (`MoLine`) con un campo `role` de cuatro valores — `'toconsume'` y
  `'toproduce'` (lo planificado, generado desde la BOM al crear la MO, en
  `createProduction()`) contra `'consumed'` y `'produced'` (lo realmente
  ejecutado, con sus movimientos de stock, revertidos por
  `cancelConsumedAndProducedLines()`). `updateProduction()` recalcula lo
  planificado solo `if (empty($moLine->qty_frozen))`. Dos registros separados
  para planificado y real, sobre el mismo objeto.
- **Medidor de pérdidas**: módulo Inventory. `htdocs/product/inventory/class/inventory.class.php`,
  `$fields` de la línea de inventario, con los `help` literales:
  - `'qty_stock'` → label `'QtyFound'`, help *"Qty we found/want (to define during draft edition)"*
  - `'qty_view'` → label `'QtyBefore'`, help *"Qty before (filled once movements are validated)"*
  - `'qty_regulated'` → label `'QtyDelta'`, help *"Qty added or removed (filled once movements are validated)"*
  - más `'pmp_real'` / `'pmp_expected'` (el impacto en valuación).

No hay ningún punto donde Dolibarr mezcle "¿la BOM está bien?" con "¿falta
stock?": son dos menús distintos, con dos tablas distintas.

### 2.3 Grocy — tiene el medidor, NO tiene el calibrador

**VERIFICADO.** Grocy declara la pérdida **en la propia transacción**, no en un
reporte derivado (`services/StockService.php`):

    public function ConsumeProduct(int $productId, float $amount, bool $spoiled,
      $transactionType, $specificStockEntryId = 'default', $recipeId = null,
      $locationId = null, &$transactionId = null,
      $allowSubproductSubstitution = false, $consumeExactAmount = false)

El `bool $spoiled` es el medidor de pérdidas de Grocy, y se agrega en
`GetProductDetails` como `'spoil_rate_percent' => $detailsRow->spoil_rate`
(el campo "Spoil rate" de la product card ya citado en
`docs/grounding-historial-producto-mp-pv-2026-09-22.md` §2.3). La pérdida no
explicada va por otro carril: `InventoryProduct(int $productId, float $newAmount, ...)`
→ `TRANSACTION_TYPE_INVENTORY_CORRECTION` (`const TRANSACTION_TYPE_INVENTORY_CORRECTION = 'inventory-correction';`).

**NO ENCONTRADO en Grocy: cualquier reporte que compare la receta contra el
consumo real.** `ConsumeRecipe` descuenta exactamente lo que la receta dice; la
receta se trata como verdad, nunca como hipótesis a validar. El único agregado
parecido es `views/stockjournalsummary.blade.php`, cuyas columnas son "Product",
"Transaction type", "User", "Amount" — un resumen por tipo de transacción, sin
ninguna comparación contra una receta.

### 2.4 Tandoor — no aplica

**VERIFICADO, sin aporte.** Ya establecido en
`docs/grounding-historial-producto-mp-pv-2026-09-22.md` §2.4: el inventario de
Tandoor es `InventoryEntry`/`InventoryLog` con `old_amount`/`new_amount` y
`booking_type ∈ add|remove|move`, y el concepto de uso diario es
`Food.onhand_users` (un booleano). No hay varianza de ninguna clase.

### 2.5 El hallazgo estructural: ninguno de los calibradores usa COMPRAS

Esto es lo que explica el +14,3 % mejor que cualquier otra observación.

| Sistema | Input del calibrador | Input del medidor de pérdidas |
|---|---|---|
| ERPNext | BOM (`required_qty`) vs. **Stock Entry contra la Work Order** (`consumed_qty`) | Conteo físico (`qty` vs. `current_qty`) / `process_loss_qty` |
| Dolibarr | MoLine `'toconsume'` vs. MoLine `'consumed'` | Inventory (`qty_stock` vs. `qty_view`) |
| Grocy | **no existe** | `$spoiled` declarado + `inventory-correction` |
| **motor2 hoy** | **COMPRA ÷ VENTA** (`rendimiento-recetas.ts:212`) | `/reportes/diferencias` (`AJUSTE`+`CONTROL`) y `/reportes/perdidas` (`MERMA`+`CONSUMO`) |

Los tres sistemas que calibran usan, del lado "real", **una medición
independiente de la receta**: alguien declaró "saqué esto del depósito para
producir". motor2 no tiene ese documento — en motor2, la salida de stock **la
genera la propia receta** (`venta.ts:208`, `detalle: "Consumo por venta de ..."`).
Por eso la Variante 2 del plan ("netear con el Kardex") es tautológica: netea
contra un número que la receta escribió. Y por eso la fórmula actual usó
compras: era el único input disponible que NO viene de la receta — pero las
compras no son consumo, son reposición, y la diferencia entre las dos es
precisamente el Δstock que la fórmula ignora.

Refuerzo lateral: **todo reporte de período de ERPNext que habla de movimiento
lleva apertura y cierre**. `erpnext/stock/report/stock_balance/stock_balance.py`,
`get_columns()`: "Opening Qty" / `opening_qty`, "Opening Value" / `opening_val`,
"In Qty" / `in_qty`, "In Value" / `in_val`, "Out Qty" / `out_qty`,
"Out Value" / `out_val`, "Balance Qty" / `bal_qty` (marcada `"sticky": "True"`),
"Balance Value" / `bal_val`, "Valuation Rate" / `val_rate`,
"Reserved Stock" / `reserved_stock`. Un reporte de industria que mostrara
entradas y salidas de un período **sin** apertura ni cierre no existe en ninguno
de los cuatro.

### 2.6 Recomendación — decisión 1

**Rendimiento real de recetas es un CALIBRADOR, y solo un calibrador. No es, ni
debería intentar ser, un medidor de pérdidas.** La evidencia apunta claro:

1. Los tres sistemas que modelan producción **separan** las dos preguntas, en
   reportes distintos y (en Dolibarr) hasta en módulos distintos. Ninguno las
   mezcla.
2. **motor2 ya tiene el medidor de pérdidas, construido y en producción**
   (`/reportes/diferencias` grupo "a", `/reportes/perdidas`), y ya está anclado
   en el input correcto (conteos físicos + mermas declaradas) — el mismo input
   que usa ERPNext Stock Reconciliation. Pedirle a Rendimiento real que también
   mida pérdida sería **duplicar un reporte que ya existe, con peores datos**.
3. El input que Rendimiento real usa hoy (compras) no es el input que usa ningún
   calibrador del mundo real, y es el origen directo del falso positivo del agua.

Consecuencias concretas que se desprenden (todas dentro de la Variante 1 ya
recomendada por §3, ninguna nueva):

- El título y el texto de la pantalla deben decir **"¿la receta cargada refleja
  lo que se usa?"**, y remitir explícitamente a `/reportes/diferencias` y
  `/reportes/perdidas` para "¿me falta stock?". Hoy la pantalla dice *"Compara la
  receta cargada contra lo que compras y ventas de esta sucursal sugieren que
  realmente se consume"* (`page.tsx:72-74`) — lo que ya la posiciona como
  calibrador, pero el usuario la lee como alarma porque el ámbar no distingue.
- El Δstock de la Variante 1 entra como **columna de contexto** (apertura/cierre,
  igual que `opening_qty`/`bal_qty` de Stock Balance), no como corrección de la
  fórmula: corregir la fórmula neteando es la Variante 2, ya descartada con
  razón.
- **Cruce que hoy no existe y es barato**: `diferencias-ajustes.ts` ya calcula
  `recetasQueLoUsan` con `mermaPorcentajeActual` y `sugerenciaMerma` por insumo
  (`diferencias-ajustes.ts:31,41`). Rendimiento real y Diferencias están mirando
  el mismo problema desde dos lados y **no se linkean entre sí**. Eso sí es un
  gap de implementación real, transversal a los dos reportes.

**Lo que esta decisión NO resuelve y sigue siendo del dueño**: si el negocio
quiere además un documento de consumo declarado ("hoy saqué 12 kg de muzzarella
para producir"), que es lo que le daría a motor2 el input que ERPNext y Dolibarr
sí tienen. Eso es un proceso nuevo, no un reporte — y es exactamente lo que
`docs/diseno-rendimiento-recetas-por-sucursal.md` §1 descartó como no realista
("la cocina no tiene — ni va a tener realistamente — disciplina de registro").
Vale la pena anotar que esa restricción es la causa raíz de todo este problema,
y que sigue vigente.

---

## 3. Decisión 2 — ¿se justifica pedir el compromiso de conteos físicos periódicos?

### 3.1 Los cuatro sistemas exigen una cantidad contada por un humano. No hay alternativa.

**VERIFICADO, y es unánime.** En los cuatro sistemas, el único lugar donde el
saldo teórico se encuentra con una medición independiente es un documento donde
alguien tipeó lo que contó:

| Sistema | Campo "lo que el sistema cree" | Campo "lo que un humano contó" | Delta |
|---|---|---|---|
| ERPNext | `current_qty` | `qty` | `quantity_difference = flt(d.qty) - flt(d.current_qty)` |
| Dolibarr | `qty_view` (*"Qty before (filled once movements are validated)"*) | `qty_stock` (*"Qty we found/want (to define during draft edition)"*) | `qty_regulated` (*"Qty added or removed"*) |
| Grocy | stock actual | `$newAmount` de `InventoryProduct(int $productId, float $newAmount, ...)` | `TRANSACTION_TYPE_INVENTORY_CORRECTION` |
| motor2 | `ConteoFisico.saldoSistema` | `ConteoFisico.conteoReal` | `ConteoFisico.diferencia` (`prisma/schema.prisma:954-958`) |

**NO ENCONTRADO en ninguno de los cuatro: un mecanismo que produzca una cifra de
varianza real SIN un conteo físico.** No es que sea difícil — es que no existe:
si las dos puntas del cálculo salen del mismo libro mayor, el resultado es una
identidad contable, no una medición. Esto es la formulación general del problema
que §3 ya detectó en particular para la Variante 2.

**El schema de motor2 ya es idéntico al de los tres.** No falta modelo, no falta
migración: `ConteoFisico` guarda `saldoSistema`, `conteoReal` y `diferencia`
(persistida, con el comentario *"guardado (no recalculado) porque es histórico"*,
`schema.prisma:956-958`), y `/reportes/conteos` ya lista el historial con
filtros por sección/producto/fecha (`src/app/(app)/reportes/conteos/page.tsx:26-32`).

### 3.2 Lo que SÍ falta en motor2: nada agenda ni reclama el próximo conteo

**VERIFICADO (búsqueda exhaustiva).** Un grep de `frecuencia|periodicidad|proximo`
sobre todo `src/` no devuelve ningún concepto de "cuándo toca contar de nuevo".
`diferencias-ajustes.ts:23` expone `ultimaFechaConteo`, y no hay ninguna
contraparte `proximaFechaConteo`, ni un producto marcado como "de conteo
periódico", ni una alerta por conteo vencido.

Ese es el gap real, y **Odoo lo resuelve exactamente con el patrón que motor2 ya
usa para todo lo demás** (`addons/stock/models/stock_location.py`, rama 17.0):

    cyclic_inventory_frequency = fields.Integer("Inventory Frequency (Days)", default=0,
        help=" When different than 0, inventory count date for products stored at this location will be automatically set at the defined frequency.")
    last_inventory_date = fields.Date("Last Effective Inventory", readonly=True,
        help="Date of the last inventory at this location.")
    next_inventory_date = fields.Date("Next Expected Inventory", compute="_compute_next_inventory_date", store=True,
        help="Date for next planned inventory based on cyclic schedule.")

Es un entero **por ubicación** (= por depósito/sucursal, no global), con
`0` = desactivado, y una fecha derivada. Odoo no es uno de los cuatro sistemas de
referencia del proyecto, pero ninguno de los cuatro tiene agenda de conteo —
ERPNext **NO ENCONTRADO** (Stock Reconciliation es un documento que se crea a
mano, sin recurrencia), Dolibarr **NO ENCONTRADO** (el módulo Inventory se abre a
mano), Grocy **NO ENCONTRADO**. Odoo es la referencia más apropiada disponible
para esta pieza puntual, y se documenta con la misma cita literal.

Para motor2, la traducción del patrón es doble y **es candidata directa a la
regla general del proyecto** (`CapacidadSucursal`/`PrecioLocalProducto`/`StockMinimoProducto`):
la frecuencia debería vivir **por sucursal × producto**, no hardcodeada — cada
local tiene su propio volumen, su propio depósito y su propia disciplina.

### 3.3 Cuánto se cuenta y cada cuánto — la literatura

**VERIFICADO (fuente externa, no código).** El estándar es *cycle counting* con
clasificación ABC, definido en el APICS Dictionary (14.ª ed.) como una técnica de
auditoría de exactitud de inventario donde se cuenta según un calendario cíclico
en vez de una vez al año, más seguido para los ítems de alto valor o alta
rotación. La práctica recomendada corriente: **ítems A semanal o quincenal, B
mensual, C trimestral**, con un objetivo de *inventory record accuracy* de
95-99 %. El punto del método, explícitamente, no es "saber el stock" sino
**identificar los ítems con error para investigar y eliminar la causa** — que es
literalmente para lo que sirve el grupo "a" de `/reportes/diferencias`.

Eso da el tamaño realista del compromiso que habría que pedir: **no es "contar
todo el depósito cada semana"**, es contar los ~10-15 insumos que concentran el
gasto (ABC) una vez por semana o cada quince días. Con el gasto por insumo ya
calculado en `/reportes/periodo` (`FilaGastoPorInsumo`, `src/core/reportes/periodo.ts`),
motor2 **ya puede derivar la clase A solo** — no hace falta que el dueño la
declare.

### 3.4 Recomendación — decisión 2

**Sí, se justifica pedir el compromiso — y la evidencia es más fuerte de lo que
§3 suponía, porque no alcanza solo a la Variante 3.**

1. **No hay alternativa técnica.** Los cuatro sistemas coinciden: sin una
   cantidad contada, no hay cifra de varianza real. Cualquier "alternativa sin
   conteos" que se construya va a ser una identidad contable disfrazada — el
   mismo error que la Variante 2. Esta parte de la decisión **la resuelve la
   evidencia, no el dueño**.
2. **El alcance del compromiso es chico y derivable.** ABC sobre el gasto que
   motor2 ya calcula → los pocos insumos que pesan, semanal o quincenal. No es
   "conteo general".
3. **La pieza que falta es de implementación, no de modelo**: una frecuencia de
   conteo configurable (por sucursal × producto, siguiendo el patrón ya
   establecido del proyecto y el precedente de Odoo) + "conteo vencido" como
   alerta. `ConteoFisico` ya guarda todo lo demás.
4. **Y hay un beneficio inmediato que no depende de la Variante 3**: con conteos
   regulares, el grupo "b" de `/reportes/diferencias` (que hoy solo puede decir
   `sugerenciaMerma: "aumentar" | "disminuir"`) pasa a tener una magnitud real
   detrás. O sea: el compromiso de conteos **mejora el calibrador que ya existe**,
   no solo el que se construiría.

**Lo que sigue siendo decisión de negocio**: si el dueño acepta operativamente
hacerlo. La evidencia dice que sin eso no hay varianza real posible; **no dice
que este negocio en particular quiera pagar ese costo operativo**, y nadie
debería decidir eso por él. Si la respuesta es "no", la consecuencia honesta es:
la Variante 3 no se construye nunca, y Rendimiento real se queda como calibrador
indirecto con los caveats de `docs/diseno-rendimiento-recetas-por-sucursal.md` §4
a la vista.

---

## 4. Decisión 3 — filas 1:1 (fraccionamiento) y packaging: ¿ocultar o rotular?

### 4.1 ERPNext — la exclusión es ESTRUCTURAL, no una regla de reporte

**VERIFICADO.** El caso del agua (compro caja x12, vendo unidad) en ERPNext es un
**Product Bundle**, no una BOM. Y un Product Bundle:

- Tiene prohibido ser ítem de stock —
  `erpnext/selling/doctype/product_bundle/product_bundle.py`, `validate_main_item`:
  *"Parent Item {0} must not be a Stock Item"* (ya citado en
  `docs/grounding-historial-producto-mp-pv-2026-09-22.md` §3.1 — **hallazgo ya
  conocido del proyecto**, no nuevo).
- **Nunca genera una Work Order.** Por lo tanto **nunca puede aparecer** en
  `work_order_consumed_materials` ni en `bom_variance_report`: los dos parten de
  `Work Order`.

Es decir: ERPNext no "oculta" el caso 1:1 del ranking de revisión de recetas —
**ese caso no llega nunca al ranking**, porque no es una receta para ERPNext.

### 4.2 Pero cuando ERPNext sí quiere excluir una línea, usa un FLAG declarado en la receta

**VERIFICADO.** `erpnext/manufacturing/doctype/bom_item/bom_item.json` tiene tres
campos que son, exactamente, "esta línea no participa como las demás":

- `include_item_in_manufacturing` → label **"Include Item In Manufacturing"**
- `do_not_explode` → label **"Do Not Explode"**
- `sourced_by_supplier` → label **"Sourced by Supplier"**

(y `is_balance_item`, label "Is Balance Item", con description *"This component
absorbs the percentage remaining after all other percentage rows"*).

Los cuatro son **checkboxes que un humano tilda en la línea de la BOM**. Ninguno
se infiere de que la cantidad sea 1 o la merma 0.

### 4.3 Grocy — tres flags, todos declarados por producto, con literales explícitos

**VERIFICADO.** `views/productform.blade.php`:

- `hide_on_stock_overview` → **"Never show on stock overview"**, tooltip: *"The
  stock overview page lists all products which are currently in stock or below
  their min. stock amount - enable this to hide this product there always"*.
- `not_check_stock_fulfillment_for_recipes` → **"Disable stock fulfillment
  checking for this ingredient"**, tooltip: *"This will be used as the default
  setting when adding this product as a recipe ingredient"*.
- `no_own_stock` → **"Disable own stock"**, tooltip: *"When enabled, this product
  can't have own stock, means it will not be selectable on purchase (useful for
  parent products which are just used as a summary/total view of the child
  products)"*.

Grocy **sí ofrece ocultar**, pero: es opt-in del usuario, por producto, explícito,
y el tooltip dice qué pantalla afecta. Nunca es una deducción del sistema.

### 4.4 Dolibarr y Tandoor

- **Dolibarr**: mismo corte que ERPNext — un kit/producto virtual no pasa por el
  módulo MRP, así que no aparece en ninguna comparación `toconsume`/`consumed`.
  Ya documentado en `docs/grounding-historial-producto-mp-pv-2026-09-22.md` §3.2.
- **Tandoor**: **NO ENCONTRADO** — no tiene reporte de varianza donde excluir
  nada.

### 4.5 El hallazgo convergente

**Ningún sistema INFIERE "esta línea no hay que revisarla" a partir de los
números de la línea.** O es estructural (el tipo de ítem no participa del
circuito de producción) o es un flag declarado (BOM Item de ERPNext, producto de
Grocy).

`esUsoTrivial` (`rendimiento-recetas.ts:93-95`) es una inferencia sobre
`cantidad === 1 && mermaPorcentaje === 0`, y por eso falla en los dos casos que
§3 reportó: una sub-receta producida y una caja de cartón caen en el predicado
sin ser "venta directa".

Lo bueno: **motor2 ya tiene los dos datos declarados que hacen falta**, sin
migración:

- **`Producto.seProduce`** distingue el producto de reventa (se arma al vender)
  de la sub-receta producida. El nombre visible ya está decidido:
  **"Producto de reventa"** (§4, decisión 8 de
  `docs/planes-demo-y-claridad-reportes-2026-09-21.md`). Y el predicado
  `tieneStockReal(tipo, seProduce)` (`src/core/movimientos/transiciones.ts:95-97`)
  ya es el que el resto del sistema usa para esto.
- **El grupo "No comestibles"** ya es una clasificación declarada de packaging y
  limpieza, y `/reportes/costos` ya la usa para excluirlo del food cost
  (`src/app/(app)/reportes/costos/tabla-costos.tsx:21`: *"el costo de comida y
  bebida (sin el packaging ni la limpieza del grupo «No comestibles»)"*). Es el
  mismo criterio de negocio, ya tomado, para el mismo tipo de ítem.

### 4.6 Recomendación — decisión 3

**Rotular, nunca ocultar — y cambiar la fuente del rótulo de inferida a
declarada.** La evidencia apunta claro en las tres partes:

1. **No ocultar por inferencia**: no tiene precedente en ninguno de los cuatro.
   Lo que Grocy oculta, lo oculta porque el usuario lo pidió producto por
   producto.
2. **Tres rótulos distintos en vez de uno mal puesto**, todos derivables de datos
   que ya existen:
   - `!seProduce` + receta 1:1 → **"Producto de reventa"** (vocabulario ya
     decidido en §4). Es el caso del agua. El desvío acá **no puede** ser un
     error de receta.
   - insumo del grupo **"No comestibles"** → **"Packaging / no comestible"**.
     Misma clasificación que ya usa el food cost.
   - sub-receta producida (el insumo es un PV con `seProduce: true`) → **no es
     trivial en absoluto**: es justamente una línea que sí conviene revisar. Hoy
     se rotula "(venta directa)", que es el peor error de los tres.
3. **Bajarlas del ranking sin esconderlas**, ordenando por impacto en $ (ver
   decisión 5): una caja de cartón de más cuesta centavos y cae sola al fondo de
   la lista, sin necesidad de ninguna regla de ocultamiento.

**Queda como decisión de negocio** (con precedente claro de ERPNext/Grocy si se
quiere tomar): si además conviene un flag **declarado y editable** en la línea de
receta — el análogo de `include_item_in_manufacturing` — para que el dueño marque
"esta línea no la revises más". Eso **sí** requiere migración (un booleano en
`RecetaIngrediente`) y no debería hacerse hasta que los tres rótulos de arriba
demuestren no alcanzar.

---

## 5. Decisión 4 — ventana por defecto (respuesta corta, como se pidió)

**Ya está resuelta en el código, y el grounding no aporta nada nuevo.**

`/reportes/rendimiento-recetas` **ya usa el selector compartido de §1**:
`page.tsx:39` llama `resolverRangoDeReporte(sp)`, cuyo default es "últimos 30
días" (`src/core/reportes/rango-por-defecto.ts:33-47`), con "Mes en curso" y
"Fechas personalizadas" como alternativas. La sospecha de §3 ("esta pregunta
puede resolverse sola con «últimos 30 días»") **se cumplió**: el cambio ya está
implementado y esta pantalla está entre las cinco que migró.

**NO ENCONTRADO**, en ninguno de los cuatro sistemas ni en Odoo: cualquier
afirmación sobre la ventana mínima para que una comparación compra/consumo sea
estadísticamente útil. Lo que hay es inconsistencia de defaults entre reportes
del mismo producto: `stock_ledger.js` usa
`default: frappe.datetime.add_months(frappe.datetime.get_today(), -1)` (un mes),
`process_loss_report.js` usa `default: frappe.datetime.year_start()` (año en
curso), y `stock_balance` arranca del inicio del ejercicio fiscal. Ninguno
justifica su elección. **La consistencia interna vale más que cualquier cosa que
aporte la evidencia externa acá.**

**Residuo real, que NO es una decisión de ventana**: `calcularConfianza`
(`rendimiento-recetas.ts:75-80`) solo devuelve `"alta"` con `semanas >= 8`.
Con el default de 30 días, la confianza **nunca** puede pasar de `"media"` — la
pantalla queda estructuralmente diciendo "no me creas del todo". Es el defecto 5
de §3, y sigue vigente después del cambio de ventana. Dos salidas, ninguna
requiere tocar el default:

- Agregar un preset **"últimas 8 semanas"** al `SelectorRango` (hoy solo hay
  `30d` / `mes` / `personalizado`), ofrecido desde esta pantalla cuando la
  confianza está limitada por la ventana y no por los datos.
- O hacer que el rótulo diga **por qué** ("Media — la ventana elegida tiene
  4 semanas"), que es información que la fila ya tiene (`semanasConDatos`).

Recomendación: **mantener 30 días por consistencia con §1** (decisión ya tomada y
ya implementada) y tratar la escala de confianza como lo que es: un problema de
rótulo, no de ventana.

---

## 6. Decisión 5 — ¿umbral de ámbar relativo a la banda de ruido, en vez de 10 % fijo?

### 6.1 El estándar de industria es un porcentaje FIJO — con override por ítem

**VERIFICADO.** ERPNext tiene tolerancias de cantidad, y son todas porcentajes
fijos configurables. `erpnext/stock/doctype/stock_settings/stock_settings.json`:

    {
      "fieldname": "over_delivery_receipt_allowance",
      "label": "Over Delivery/Receipt Allowance (%)",
      "description": "The percentage you are allowed to receive or deliver more against the quantity ordered. For example, if you have ordered 100 units, and your Allowance is 10%, then you are allowed to receive 110 units."
    }

(más `mr_qty_allowance` → "Over Transfer Allowance (%)", `over_picking_allowance`
→ "Over Picking Allowance (%)", y `role_allowed_to_over_deliver_receive` →
"Role Allowed to Over Deliver/Receive", *"Users with this role are allowed to over
deliver/receive against orders above the allowance percentage"*).

Nota al margen que vale la pena registrar: **el ejemplo literal de la
documentación de ERPNext usa 10 %** — el mismo número que motor2 eligió.

Y la resolución del umbral es **por ítem primero, global después**
(`erpnext/controllers/status_updater.py`, `get_allowance_for`), con el docstring
*"Returns the allowance for the item, if not set, returns global allowance."*:

    qty_allowance, over_billing_allowance = frappe.get_cached_value(
        "Item", item_code, [item_qty_allowance_field, "over_billing_allowance"]
    )

    if qty_or_amount == "qty" and not qty_allowance:
        if global_qty_allowance is None:
            global_qty_allowance = flt(
                frappe.get_single_value(global_qty_allowance_doctype, global_qty_allowance_field)
            )
        qty_allowance = global_qty_allowance

O sea: el patrón estándar es **un default global + un override por ítem**, no una
banda calculada. Es, estructuralmente, el mismo patrón que motor2 ya usa con
`PrecioLocalProducto` y `StockMinimoProducto` — con la diferencia de que el eje
de ERPNext es el ítem, no la sucursal.

### 6.2 Lo más cerca de SPC que llega ERPNext es una fórmula declarada, no calculada

**VERIFICADO.** `erpnext/stock/doctype/quality_inspection_reading/quality_inspection_reading.json`:

- `min_value` (Float) y `max_value` (Float), ambos con description *"Applied on
  each reading"*.
- `acceptance_formula` (Code), description: *"Simple Python formula applied on
  Reading fields. Numeric eg. 1: reading_1 > 0.2 and reading_1 < 0.5 Numeric eg.
  2: mean > 3.5 (mean of populated fields) Value based eg.: reading_value in
  ("A", "B", "C")"*.
- `status` (Select): "Accepted" / "Rejected".

Es un criterio **que un humano escribe**, incluso cuando usa la media de las
lecturas. **NO ENCONTRADO en ERPNext, Dolibarr, Grocy ni Tandoor: límites de
control calculados a partir de la variabilidad del propio ítem (±3σ, carta de
control, o cualquier otra construcción de SPC).** La banda de ruido por tamaño de
lote que propone §3 **no tiene precedente en ninguno de los sistemas de
referencia** — es una hipótesis propia del proyecto, en el mismo sentido en que
`docs/grounding-historial-producto-mp-pv-2026-09-22.md` §7 ajuste 3 marcó
"cantidad típica" y "frecuencia" como hipótesis propias.

Eso no la invalida (el caso del agua es real y el ±19 % es aritmética, no
estadística), pero sí cambia dónde conviene ponerla.

### 6.3 La tercera salida, que además motor2 ya usa: ordenar por impacto en $

Esto es lo que mejor resuelve el problema de fondo, y no es teórico: **motor2 ya
lo hizo una vez, y con el mismo grounding**.

`docs/grounding-reportes-compras-2026-09-18.md` §5 documentó que Restaurant365 y
xtraCHEF **no ordenan por % de variación — ordenan por plata**
(`Δprecio × cantidad comprada = impacto en $`). Y eso ya está implementado en
`/reportes/periodo`:

    // src/core/reportes/periodo.ts:519
    /** (precioUnitarioPromedio - precioUnitarioAnterior) × cantidadComprada — lo que realmente costó (o ahorró) el cambio de precio, a la cantidad que efectivamente se compró. Esto es lo que ordena la lista, no el %. */
    deltaImpacto: number | null;

Aplicado a Rendimiento real: **una caja de agua de más no compite con 0,3 kg de
ajo de más si se ordena por pesos.** El problema del denominador chico (63 ventas,
lote de 12 → ±19 % de ruido puro) se disuelve sin ninguna estadística, porque el
ruido de lote en pesos es chico por construcción — es una caja, no un mes de
muzzarella.

### 6.4 Precedente interno sobre configurabilidad de umbrales

El proyecto ya tomó posición sobre esto una vez, por grounding, y conviene no
reabrirla sin querer:

    // src/core/reportes/periodo.ts:202-208 (docstring de generarDigestAlertas)
     * paso 3 del grounding (segunda pasada, docs/grounding-reportes-compras-
     * 2026-09-18.md §5): "un dueño de pizzería chica no configura umbrales ni
     * lee mails de su ERP" — nada de esto es configurable ni es una
     * notificación aparte

Y hay dos umbrales fijos ya en producción, asumidos como tales:
`UMBRAL_VARIACION_SOSPECHOSA_PCT = 200` (`periodo.ts:525`, higiene de datos, con
respaldo en Restaurant365) y el food cost al 40 %, documentado en la UI como
**"umbral fijo, no configurable"** (`tabla-costos.tsx:21`).

### 6.5 Recomendación — decisión 5

**Umbral fijo, banda de ruido visible como contexto, y ranking por impacto en $.
No una banda estadística como criterio de alerta.** Desglosado:

1. **Mantener el 10 % como umbral de ámbar** — es lo que hace la industria
   (ERPNext, con el mismo número en su propio ejemplo), es lo que el proyecto ya
   decidió para otros umbrales, y una banda calculada no tiene precedente en
   ninguno de los cuatro sistemas.
2. **Extraer el 10 a una constante única en `src/core/`.** Hoy es un literal
   duplicado en `fila-simple.tsx:35` y `fila-compartida.tsx:26`, en la capa de
   presentación, sin justificación escrita. Esto es un hallazgo independiente de
   la decisión: cualquiera sea el número, debería estar en un solo lugar y
   testeable.
3. **Mostrar la banda de ruido de lote como CONTEXTO de la fila, no como umbral**
   — que es exactamente lo que la Variante 1 de §3 ya propone ("columnas
   Comprado/Vendido/Δstock visibles", "banda de ruido"). Un desvío de +14,3 %
   dentro de una banda de ±19 % se explica solo si la banda está a la vista; no
   hace falta suprimir el ámbar para eso, hace falta que al lado diga por qué.
4. **Cambiar el ORDEN del ranking a impacto en $** (Restaurant365, ya
   implementado en `periodo.ts` para precios). Esto resuelve de una vez el
   problema de la decisión 5 (ruido de denominador chico) y el de la decisión 3
   (packaging arriba del ranking sin merecerlo) — es la pieza con mejor relación
   evidencia/costo de todo este grounding.

**Queda como decisión de negocio**: si el umbral debe ser configurable **por
producto** (precedente directo: `Item.over_delivery_receipt_allowance` de ERPNext,
con fallback global) o **por sucursal** (la regla general del proyecto). La
evidencia externa apunta al eje *producto*, no al eje *sucursal* — el ruido de
lote es una propiedad del insumo y de su presentación de compra, no del local.
Y el propio proyecto ya decidió una vez que este dueño no configura umbrales
(`periodo.ts:205`). **Verificar si es intencional** que esa decisión se extienda
también acá: es coherente, pero se tomó para otro reporte.

---

## 7. Síntesis — qué queda claro y qué sigue siendo del dueño

### 7.1 Resueltas por la evidencia (el dueño puede ratificar, no necesita deliberar)

- **Decisión 1 — calibrador.** Tres sistemas separan las dos preguntas en
  reportes distintos; ninguno las mezcla; y **motor2 ya tiene el medidor de
  pérdidas construido y anclado en el input correcto** (`/reportes/diferencias`
  grupo "a" + `/reportes/perdidas`). Mezclar los dos propósitos en Rendimiento
  real sería duplicar un reporte existente con peores datos. Lo que falta es
  rotular la pantalla como calibrador y **linkear los dos reportes entre sí**
  (gap de implementación real, hoy no se conocen).
- **Decisión 3 — rotular, nunca ocultar, con dato declarado.** Ningún sistema
  infiere la exclusión de los números; ERPNext la resuelve estructuralmente
  (Product Bundle nunca llega a un reporte de varianza) o con flags de BOM Item
  declarados; Grocy con flags de producto declarados. motor2 ya tiene los dos
  datos declarados que hacen falta (`Producto.seProduce` y el grupo "No
  comestibles") — `esUsoTrivial` debería dejar de ser una inferencia.
- **Decisión 4 — ya resuelta en el código.** 30 días, por consistencia con §1,
  ya implementado. **NO ENCONTRADO** cualquier aporte externo. El residuo (la
  confianza "alta" inalcanzable con la ventana por defecto) es un problema de
  rótulo, no de ventana.

### 7.2 Resueltas a medias — la parte técnica cierra, la operativa no

- **Decisión 2 — conteos físicos.** Que **no existe alternativa** lo resuelve la
  evidencia: los cuatro sistemas exigen una cantidad contada por un humano, y
  `ConteoFisico` de motor2 ya es idéntico a los tres que lo modelan. Que el
  negocio **acepte** contar semanalmente sus 10-15 insumos clase A es una
  decisión operativa del dueño, y nadie debería tomarla por él. Si la respuesta
  es no: la Variante 3 no se construye, y hay que decirlo explícitamente en el
  plan en vez de dejarla "para después".
  - Gap de implementación asociado, independiente de la respuesta: **nada en
    motor2 agenda ni reclama un conteo** (grep exhaustivo, §3.2). El patrón está
    a mano (Odoo `cyclic_inventory_frequency` por ubicación; en motor2,
    configurable por sucursal × producto, como `StockMinimoProducto`).
- **Decisión 5 — umbral.** Que el estándar es **fijo** (y que la banda
  estadística no tiene precedente) lo resuelve la evidencia. Que el ranking
  debería ordenarse **por impacto en $** también (Restaurant365, ya aplicado en
  `periodo.ts`). Lo que queda abierto es si el umbral debe ser configurable y
  sobre qué eje — y ahí la evidencia externa (ERPNext: por **ítem**) apunta en
  dirección distinta a la regla general del proyecto (por **sucursal**).

### 7.3 Lo que este grounding NO resuelve y ni intentó

1. **Si el negocio quiere un documento de consumo declarado.** Es la causa raíz
   de que motor2 tenga que estimar con compras: ERPNext y Dolibarr calibran
   contra un documento donde alguien declaró qué sacó del depósito, y motor2 no
   tiene ese documento por decisión explícita
   (`docs/diseno-rendimiento-recetas-por-sucursal.md` §1: *"la cocina no tiene —
   ni va a tener realistamente — disciplina de registro"*). Esa restricción
   sigue vigente; se anota que es la causa, no se propone revertirla.
2. **Si conviene un flag "no revisar esta línea" en `RecetaIngrediente`**
   (análogo a `include_item_in_manufacturing`). Requiere migración; no hacerlo
   hasta que los rótulos declarados demuestren no alcanzar.
3. **Vocabulario visible de la pantalla.** El nombre "Rendimiento real de
   recetas" mezcla las dos lecturas tanto como la fórmula. Ponerle un nombre que
   diga "calibrador" es producto, y el vocabulario lo fija el dueño (mismo
   criterio que §2 del plan y que
   `docs/grounding-historial-producto-mp-pv-2026-09-22.md` §8.2).
4. **El arreglo del botón "Usar este valor"** — fuera de alcance por pedido
   explícito; ya hecho en `74a14ab`.

---

## Fuentes

Todo lo externo se leyó vía `raw.githubusercontent.com` el 2026-09-22 (ERPNext y
Dolibarr rama `develop`, Grocy `master`, Odoo `17.0`), sin clonar los repos y sin
acceso a shell — por eso las citas son archivo + función/campo + texto literal,
sin número de línea (ver "Limitación de método" al inicio).

**ERPNext** (`frappe/erpnext`):
- `erpnext/manufacturing/report/work_order_consumed_materials/work_order_consumed_materials.py`
  (`get_columns`, `get_data`, `extra_consumed_qty = consumed_qty - required_qty`)
- `erpnext/manufacturing/report/bom_variance_report/bom_variance_report.py`
  (`get_columns`, `get_data`, filtro `bom_no`/`work_order`)
- `erpnext/manufacturing/report/process_loss_report/process_loss_report.py` y su
  `.js` (columnas de pérdida de proceso; `from_date: frappe.datetime.year_start()`)
- `erpnext/stock/doctype/stock_reconciliation/stock_reconciliation.py`
  (`purpose` Literal, `quantity_difference`, `amount_difference`, `expense_account`)
- `erpnext/stock/report/stock_balance/stock_balance.py` (`get_columns`:
  `opening_qty`/`in_qty`/`out_qty`/`bal_qty`)
- `erpnext/stock/report/stock_ledger/stock_ledger.js` (default `add_months(get_today(), -1)`)
- `erpnext/stock/doctype/stock_settings/stock_settings.json`
  (`over_delivery_receipt_allowance` y su description con el ejemplo del 10 %)
- `erpnext/controllers/status_updater.py` (`get_allowance_for`: ítem primero,
  global de fallback)
- `erpnext/stock/doctype/quality_inspection_reading/quality_inspection_reading.json`
  (`min_value`/`max_value`/`acceptance_formula`)
- `erpnext/manufacturing/doctype/bom_item/bom_item.json`
  (`include_item_in_manufacturing`, `do_not_explode`, `sourced_by_supplier`,
  `is_balance_item`)
- `erpnext/selling/doctype/product_bundle/product_bundle.py` (`validate_main_item`)
  — **ya citado antes** en `docs/grounding-historial-producto-mp-pv-2026-09-22.md` §3.1

**Dolibarr** (`Dolibarr/dolibarr`):
- `htdocs/product/inventory/class/inventory.class.php` (`$fields`: `qty_stock`
  "QtyFound", `qty_view` "QtyBefore", `qty_regulated` "QtyDelta", `pmp_real`,
  `pmp_expected`)
- `htdocs/mrp/class/mo.class.php` (roles `toconsume`/`consumed`/`toproduce`/
  `produced`, `createProduction()`, `updateProduction()`, `qty_frozen`,
  `cancelConsumedAndProducedLines()`)

**Grocy** (`grocy/grocy`):
- `services/StockService.php` (`TRANSACTION_TYPE_*`, `ConsumeProduct` con
  `bool $spoiled`, `InventoryProduct(int $productId, float $newAmount, ...)`,
  `'spoil_rate_percent' => $detailsRow->spoil_rate`)
- `views/productform.blade.php` (`hide_on_stock_overview`,
  `not_check_stock_fulfillment_for_recipes`, `no_own_stock` con sus tooltips)
- `views/stockjournalsummary.blade.php` (columnas "Product", "Transaction type",
  "User", "Amount")

**Tandoor Recipes** (`TandoorRecipes/recipes`): sin aporte para estas 5
decisiones — ver `docs/grounding-historial-producto-mp-pv-2026-09-22.md` §2.4.

**Odoo** (`odoo/odoo`, rama `17.0`) — usado solo para la pieza que ninguno de los
cuatro tiene (agenda de conteos):
- `addons/stock/models/stock_location.py` (`cyclic_inventory_frequency`,
  `last_inventory_date`, `next_inventory_date`, `_compute_next_inventory_date`)

**Literatura de control de inventario** (decisión 2, frecuencia de conteo):
- APICS Dictionary, 14.ª ed. — definición de *cycle counting* (conteo según
  calendario cíclico, más frecuente para alto valor / alta rotación), y la
  práctica corriente de ABC: A semanal/quincenal, B mensual, C trimestral, con
  *inventory record accuracy* objetivo de 95-99 %. Referencias consultadas:
  [APICS San Antonio — "Cycle Counting by the Probabilities"](https://apicssanantonio.starchapter.com/blog/id/17),
  [NetSuite — Inventory Cycle Counting 101](https://www.netsuite.com/portal/resource/articles/inventory-management/using-inventory-control-software-for-cycle-counting.shtml),
  [Sphere WMS — Cycle Counting Guide](https://spherewms.com/blog/cycle-counting-guide).

**Documentos propios del proyecto usados como punto de partida**:
`docs/planes-demo-y-claridad-reportes-2026-09-21.md` §1, §3, §4 y §5;
`docs/diseno-rendimiento-recetas-por-sucursal.md`;
`docs/grounding-historial-producto-mp-pv-2026-09-22.md`;
`docs/grounding-reportes-compras-2026-09-18.md` (§5: ordenar por impacto en $,
Restaurant365/xtraCHEF);
`docs/grounding-desposte-grocy.md`; `docs/grounding-merma-productos-compartidos.md`;
`docs/grounding-ficha-tecnica-tandoor.md`;
`docs/comparativa-ux-erpnext-dolibarr.md`.
