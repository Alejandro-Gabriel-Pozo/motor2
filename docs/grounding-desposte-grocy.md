# Grounding: ¿el "producción/desposte" de Grocy es real? y ¿motor2 ya tiene los datos para una regresión?

Expediente de la diligencia técnica corrida el 2026-09-16 contra código real de
[Grocy](https://github.com/grocy/grocy) (clonado localmente en
`/home/user/grocy/grocy`, backend PHP en `services/`/`controllers/`, schema
SQLite versionado incrementalmente en `migrations/*.sql`, 258 migraciones
completas desde `0001.sql`) — documento DISTINTO e independiente de
`docs/comparativa-ux-erpnext-dolibarr.md`,
`docs/grounding-ficha-tecnica-tandoor.md` y
`docs/grounding-merma-productos-compartidos.md` (mismo criterio de cita y
misma convención VERIFICADO/NO ENCONTRADO, pero no se tocó ninguno de esos
archivos). Motivación: el dueño del negocio (carne vacuna comprada en varios
cortes — nalga, bife, lomo, cuadrada — usados de forma intercambiable en una
cocina sin disciplina de registro por plato) pegó un documento externo
generado por IA que afirmaba que **Grocy** soporta un mecanismo de "Butcher's
Yield Test": pesar 1 pieza cruda, producir N salidas distintas en cantidades
variables cargadas en el momento. Esa afirmación NO se tomó como hecho — se
verificó contra el código fuente real.

Convención: **VERIFICADO** = confirmado leyendo el código fuente citado. **NO
ENCONTRADO** = búsqueda exhaustiva sin resultado positivo (ausencia
confirmada, no simple desconocimiento).

---

## Parte A — Grocy: ¿existe el mecanismo "1 insumo → N salidas distintas, cantidades variables al producir"?

### A.1 — NO ENCONTRADO (el reclamo pegado está mal descripto/embellecido)

**NO ENCONTRADO**, tras revisar el mecanismo real de "Recipes" de punta a
punta (schema, servicio, controlador, vista). Lo que Grocy tiene es un BOM
clásico de **N ingredientes → 1 producto de salida**, con la relación de
cantidades **fija en la definición de la receta** (no cargada a mano en el
momento de producir) — exactamente la cardinalidad OPUESTA a la que describe
el reclamo pegado.

Evidencia, tabla por tabla:

```sql
-- migrations/0025.sql:1-15 (creación original, todavía la forma de fondo hoy)
CREATE TABLE recipes (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
	name TEXT NOT NULL,
	description TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
);

CREATE TABLE recipes_pos (
	id INTEGER NOT NULL PRIMARY KEY AUTOINCREMENT UNIQUE,
	recipe_id INTEGER NOT NULL,
	product_id INTEGER NOT NULL,
	amount INTEGER NOT NULL DEFAULT 0,
	note TEXT,
	row_created_timestamp DATETIME DEFAULT (datetime('now', 'localtime'))
);
```

`recipes_pos` es la lista de INGREDIENTES de una receta (N filas, cada una
con su propio `product_id` y `amount` — esto sí es "muchos productos de
entrada distintos", pero son los INSUMOS que se CONSUMEN, nunca las salidas
producidas). `migrations/0050.sql:1-2` agrega a `recipes` la columna que
falta para saber qué produce:

```sql
ALTER TABLE recipes ADD picture_file_name TEXT;
```

(esa migración puntual solo agrega la foto; el campo real que importa,
`recipes.product_id` — "el producto que esta receta produce" — y
`desired_servings`/`base_servings` se confirman en uso real más abajo, en
`recipes_pos_resolved`/`RecipesService.php`). El punto estructural clave:
**una receta apunta a UN SOLO `product_id` de salida**, no a una lista de
salidas. Grep exhaustivo (`grep -rliE "disassembl|butcher|byproduct|
by-product|sub.?recipe"` sobre todo `.php`/`.js` del repo, excluyendo los
falsos positivos de `@yield(...)` — la propia sintaxis de sección del motor
de templates Blade, que contaminaba una búsqueda ingenua de "yield"): los
únicos 4 archivos con coincidencia real son:

- `controllers/RecipesController.php:127-153` — `selectedRecipeSubRecipes`:
  esto es **anidado de recetas** (una receta puede INCLUIR otra receta
  completa como si fuera un ingrediente más, vía la vista
  `recipes_nestings_resolved`) — es composición jerárquica de BOM (como el
  `step_recipe` de Tandoor, ver `docs/grounding-ficha-tecnica-tandoor.md`
  sección 5), NO un desposte con salidas múltiples variables.
- `services/DemoDataGeneratorService.php:84` — un `product_group` de
  demostración llamado literalmente "Butchery products" (`04 Butchery
  products`), usado solo como categoría/rubro de ejemplo para clasificar
  productos de carnicería en los datos de demo — no es una feature, es una
  etiqueta de ejemplo.
- `public/viewjs/shoppinglist.js` — coincidencias de "by product group"
  (agrupar la lista de compras por rubro), sin relación alguna con
  desposte.

Ningún resultado real para "disassembly", "butcher('s) yield", "byproduct" o
un concepto equivalente como feature de producto.

### A.2 — El mecanismo real: `ConsumeRecipe` (N ingredientes fijos → 1 salida)

**VERIFICADO.** `RecipesService::ConsumeRecipe($recipeId)`
(`services/RecipesService.php:80-133`) es la única función que "produce"
algo en Grocy:

```php
// services/RecipesService.php:87-105
$recipePositions = $this->DB->recipes_pos_resolved()->where('recipe_id', $recipeId)->fetchAll();
...
foreach ($recipePositions as $recipePosition)
{
	if ($recipePosition->only_check_single_unit_in_stock == 0 && $recipePosition->stock_amount > 0)
	{
		$amount = $recipePosition->recipe_amount;
		if ($recipePosition->stock_amount > 0 && $recipePosition->stock_amount < $recipePosition->recipe_amount)
		{
			$amount = $recipePosition->stock_amount;
		}
		StockService::GetInstance()->ConsumeProduct($recipePosition->product_id, $amount, false,
			StockService::TRANSACTION_TYPE_CONSUME, 'default', $recipeId, null, $transactionId, true, true);
	}
}
```

```php
// services/RecipesService.php:117-131
$recipe = $this->DB->recipes()->where('id = :1', $recipeId)->fetch();
$productId = $recipe->product_id;
$amount = $recipe->desired_servings;
...
if (!empty($productId))
{
	$product = $this->DB->products()->where('id = :1', $productId)->fetch();
	$recipeResolvedRow = $this->DB->recipes_resolved()->where('recipe_id = :1', $recipeId)->fetch();
	StockService::GetInstance()->AddProduct($productId, $amount, null,
		StockService::TRANSACTION_TYPE_SELF_PRODUCTION, date('Y-m-d'), $recipeResolvedRow->costs_per_serving,
		null, null, $dummyTransactionId, $product->default_stock_label_type, true, $recipe->name);
}
```

Es decir: consume TODOS los ingredientes de `recipes_pos` (N productos
distintos, sí — eso es real), cada uno en la cantidad `recipe_amount` que
sale de escalar el `amount` fijo de la receta por
`desired_servings/base_servings` (`migrations/0249.sql:9`:
`rp.amount * ((r.desired_servings*1.0) / (r.base_servings*1.0))`), y agrega
stock de **un único** `productId` (`recipe.product_id`) por
`amount = desired_servings`. `StockService::ConsumeProduct` y
`StockService::AddProduct` (`services/StockService.php`) son funciones que
operan sobre **un producto por llamada** — no existe ninguna función que
reciba "1 producto de entrada + un array de {producto, cantidad} de salida"
en Grocy.

### A.3 — Cómo calcula el costo del producto de salida: acumulación hacia arriba, NO reparto hacia abajo

**VERIFICADO**, y confirma que ni siquiera el cálculo de costo se parece al
patrón "reparto proporcional del costo de 1 insumo entre N salidas" que
describe el reclamo pegado — es al revés: SUMA el costo de cada ingrediente
(a su precio vigente) hacia UN SOLO total, y ese total se divide por las
porciones (`desired_servings`) de esa única receta:

```sql
-- migrations/0247.sql:9-10 (vista recipes_resolved)
IFNULL(SUM(rpr.costs), 0) AS costs,
IFNULL(SUM(rpr.costs) / CASE WHEN IFNULL(r.desired_servings, 0) = 0 THEN 1 ELSE r.desired_servings END, 0) AS costs_per_serving,
```

`rpr.costs` (por línea de ingrediente, `migrations/0249.sql`, columna
`costs`) es `cantidad_del_ingrediente × precio_vigente_del_ingrediente`. Ese
costo total (`costs_per_serving`) es el que `ConsumeRecipe` pasa como
`price` al `AddProduct` del producto de salida único
(`services/RecipesService.php:129`). No hay ningún cálculo de "el insumo
crudo costó $X, repartilo proporcionalmente por peso/valor entre las N
salidas que salieron de él" — ese problema (el que sí describe un yield test
real de carnicería) no está resuelto en ningún lado del código de Grocy.

### A.4 — ¿Es lo mismo que la "receta" normal de Grocy, o algo distinto?

**Es EXACTAMENTE la misma feature — no hay una feature "producción/desposte"
separada de "Recetas".** `ConsumeRecipe` (sección A.2) ES el mecanismo de
receta de Grocy, el mismo que resuelve tanto "recetas para cocinar y comer"
como "recetas de autoproducción" (`self-production` — el mismo
`TRANSACTION_TYPE_SELF_PRODUCTION` que aparece en
`services/StockService.php:15`). No existe una tabla, servicio o
transaction_type separado para desposte. Los `TRANSACTION_TYPE_*` completos
de Grocy (`services/StockService.php:11-19`) son: `consume`,
`inventory-correction`, `product-opened`, `purchase`, `self-production`,
`stock-edit-new`, `stock-edit-old`, `transfer_from`, `transfer_to` — los
únicos parecidos a "producir/abrir" son `self-production` (la receta de
arriba, salida única) y `product-opened`
(`StockService.php:981`, `OpenProduct`: abrir/perforar 1 unidad de stock ya
existente del MISMO producto — p. ej. destapar una botella — no genera
ningún producto nuevo distinto, solo marca esa unidad como abierta).
Conclusión: **el reclamo pegado describe un mecanismo que Grocy no tiene.**
Lo que sí tiene (recetas N→1 con receta fija) es una feature real y madura,
pero no resuelve "pesar 1 nalga cruda y producir cantidades variables de
milanesas + bifes + descarte, cargadas en el momento".

### A.5 — UI/UX del mecanismo real (para contraste, aunque no aplica al problema del dueño)

**VERIFICADO.** El flujo real de "producir con receta" en Grocy es de
altísima velocidad porque es de **cero campos**: un botón
`recipe-consume` en la card de cada receta
(`views/recipes.blade.php:335,371`, `data-recipe-id="{{ $recipe->id }}"`)
dispara directo `ConsumeRecipe($recipeId)` sin ningún formulario intermedio
— ni cantidad, ni peso, ni nada que tipear; usa `desired_servings` ya
configurado en la receta. Es rapidísimo (1 tap) precisamente PORQUE asume
una relación fija predefinida — la misma razón por la que no sirve para un
yield test real, donde el peso de la pieza cruda y el rendimiento de cada
salida varían pieza a pieza y se necesitan campos para cargarlos. Cargar un
ingrediente a una receta sí tiene más fricción:
`views/recipeposform.blade.php:38-45` — selector de producto (autocomplete
con lector de código de barras vía `components.productpicker`) + cantidad +
unidad + checkbox opcional — pero eso es a nivel de DEFINICIÓN de receta
(una vez), no de cada evento de producción.

---

## Parte B — motor2: ¿ya existe el dato crudo para el enfoque de regresión?

### B.1 — El Kardex (`MovimientoStock`) ya registra, por separado, compras de MP y ventas de PV

**VERIFICADO.** `MovimientoStock` (`prisma/schema.prisma:680-745`) es un
libro mayor único, 1 fila = 1 movimiento de stock con signo, con
`proceso: Proceso` (`prisma/schema.prisma:485-502`, incluye `COMPRA` y
`VENTA` como valores del enum), `productoId`, `cantidad` y, vía
`operacionId → Operacion.fecha`, una fecha real. Concretamente:

- **Compras de un corte (MP)**: `registrarMovimiento`/flujo de Compra
  escribe filas `MovimientoStock.proceso = COMPRA`,
  `MovimientoStock.productoId = <id de la MP>` (nalga, bife, lomo,
  cuadrada — cada una su propio `Producto.id`), `cantidad` positiva en la
  unidad de stock del producto. Esta es la serie histórica "kg comprados de
  cada corte, con fecha".
- **Ventas de un plato (PV)**: `registrarVenta`
  (`src/server/actions/venta.ts:140-184`) escribe, por cada línea vendida,
  una fila `proceso: "VENTA"` con `productoId: venta.productoId` (el PV,
  p. ej. "Milanesa de nalga") y `cantidad: -venta.cantidadVendida`
  (`venta.ts:179-183`) — **siempre**, sin importar si el PV tiene o no
  `seProduce=true` (líneas 64-76 y 178-183: la línea VENTA del PV se
  escribe siempre; los `consumos` de receta son un bloque aparte, ver B.2).
  Esta es la serie histórica "unidades vendidas de cada plato, con fecha".

Ambas series ya existen, comparten el mismo modelo (`MovimientoStock`), y
son consultables por rango de fecha vía el mismo patrón que ya usa
`obtenerReportePorPeriodo` (`src/core/reportes/periodo.ts:61-74`, filtro
`operacion: { fecha: { gte, lte } }` + `proceso` + `productoId`).

### B.2 — Aclaración importante: el `CONSUMO` que ya registra motor2 NO sirve para esto (y por qué no importa)

**VERIFICADO, hallazgo no trivial.** `venta.ts:64-76` muestra que, al
vender un PV, motor2 SÍ calcula y registra consumo de MP — pero ese consumo
sale de la `RecetaVersion` vigente del PV (`ing.cantidad`, `ing.
mermaPorcentaje`), es decir, es la teoría de la receta cargada, no lo que
realmente pasó en la cocina:

```ts
// src/server/actions/venta.ts:66-75
const receta = await tx.recetaVersion.findFirst({ where: { productoId: producto.id }, orderBy: { version: "desc" }, include: { ingredientes: true } });
for (const ing of receta?.ingredientes ?? []) {
  ...
  const cantidadSalida = cantidad * Number(ing.cantidad) * (1 + Number(ing.mermaPorcentaje) / 100);
  const reparto = await resolverConsumoPorFamilia(ing.insumoProductoId, cantidadSalida, seccionId, tx);
  consumos.push(...reparto);
}
```

Si la receta de "Milanesa" dice "consume Nalga", cada venta de Milanesa va a
generar SIEMPRE una fila `CONSUMO` de Nalga — sin importar que, en la
realidad de la cocina descripta por el dueño, ese día el cocinero haya
usado Bife porque era lo que tenía a mano. Usar estas filas `CONSUMO` como
insumo de una regresión sería circular: ya asumen la respuesta (qué corte
usa qué plato) que se quiere estimar. **Las series útiles para la
regresión son exclusivamente `COMPRA` (por MP) y `VENTA` (por PV) — nunca
`CONSUMO`.** Esto no es una limitación de motor2, es la razón de fondo por
la que el enfoque de regresión tiene sentido acá: `COMPRA` mide lo que
entró al freezer sin importar receta, `VENTA` mide lo que salió por caja sin
importar receta — ninguna de las dos pasa por la suposición de la receta.

### B.3 — Cómo se agregan hoy "kg comprados por período" y "unidades vendidas por período" — ¿ya existe el reporte, o falta construirlo?

**VERIFICADO — existe la mitad, y la mitad que falta es una consulta
directa sobre datos que YA están, no una tabla nueva.**

- **Ventas por producto en un período: YA agregado hoy.**
  `calcularVentasDelPeriodo` (`src/core/reportes/periodo.ts:194-226`) ya
  arma exactamente `Map<productoId, {cantidad, importe, ...}>` sumando
  todas las filas `VENTA` del rango de fechas pedido —
  `acc.cantidad += r.cantidad` (línea 209) es literalmente "unidades
  vendidas de este PV en este período". Se llama desde
  `obtenerReportePorPeriodo` (línea 103), que ya expone `desde`/`hasta`
  como parámetros arbitrarios — technically ya soporta cualquier
  granularidad de ventana con solo llamarlo repetidas veces (una vez por
  semana/mes).
- **Compras por producto en un período: el dato existe línea por línea,
  pero HOY se agrega por proveedor/$ (`calcularComprasDelPeriodo`,
  `periodo.ts:133-171`), no por producto/kg.** Esa función agrupa por
  `proveedorNombre` y suma `importe` ($), con un mapa interno de productos
  → importe (línea 149) que tampoco es cantidad. La cantidad SÍ está
  disponible en cada `ItemPeriodo.cantidad` (línea 87,
  `esSignoFijo(m.proceso) ? Math.abs(Number(m.cantidad)) : ...` — magnitud
  sin signo para COMPRA, que es de signo fijo) — el "resumen por producto en
  kg" de compras simplemente no está armado como función hoy, sería un
  `Map` análogo al de `calcularVentasDelPeriodo` filtrando
  `proceso === "COMPRA"` y sumando `cantidad` por `productoId` en vez de
  `importe` por proveedor. **Cero tablas nuevas, cero cambios de schema —
  es agregar una función de agregación más sobre datos que
  `obtenerReportePorPeriodo` ya trae.**

### B.4 — Conclusión de la Parte B

**El dato crudo (compras históricas por corte, ventas históricas por plato,
con fecha, sobre el mismo período) ya está 100% capturado en el Kardex
existente de motor2, sin necesitar ningún cambio de captura de datos ni
ningún workflow nuevo en la cocina.** Un reporte de "coeficientes estimados
de rendimiento por regresión" es, para motor2, una feature puramente de
LECTURA/analítica sobre `MovimientoStock` agrupado por `proceso` + fecha +
`productoId` — exactamente la categoría de trabajo que
`docs/comparativa-ux-erpnext-dolibarr.md` sección 2 ya identificó como la
más barata de motor2 ("ningún backend nuevo" para el caso de los links de
drill-down; acá el costo es ligeramente mayor, una función de agregación +
el cálculo de regresión, pero sigue sin tocar ni `schema.prisma` ni ningún
flujo de registro existente).

---

## Parte C — Comparación honesta para la situación real de este dueño

### C.1 — Por qué el enfoque "disciplinado" (desposte/producción tipo Grocy) no calza con esta cocina

El propio dueño ya lo dijo con precisión: no hay disciplina de pesar/cargar
por plato, y no cree que pueda imponerla. El mecanismo que el reclamo pegado
atribuía a Grocy (que de por sí resultó ser NO ENCONTRADO, Parte A) hubiera
requerido, de todas formas, exactamente el comportamiento que el dueño
descarta: alguien en la cocina pesando la pieza cruda, registrando el
desposte, y cargando cuánto salió de cada corte — en tiempo real, por lote de
producción. Aun si esa feature existiera en algún sistema real, su
prerrequisito operativo es el mismo que el dueño ya evaluó como no viable.
No es un problema de qué software se use — es un problema de qué proceso
humano hay que instalar, y ese es precisamente el que no se puede instalar
acá.

### C.2 — Por qué el enfoque estadístico/regresión SÍ calza — con caveats reales, sin sobrevenderlo

**A favor:**
- **Cero cambio de comportamiento en la cocina.** No pide pesar nada nuevo,
  no pide un cocinero disciplinado, no pide un paso extra en ningún proceso
  existente. Usa datos que YA se generan como efecto colateral de comprar
  (COMPRA) y de cobrar (VENTA) — Parte B.
- **No requiere ninguna migración de schema ni backend nuevo de escritura**
  — es un reporte de lectura, en la misma familia que los ~16 reportes que
  ya existen (`src/core/reportes/*.ts`).

**Caveats reales, sin edulcorar:**
1. **Da un promedio histórico, no una verdad por transacción.** El
   coeficiente estimado ("la Milanesa consume en promedio X kg de Nalga")
   es un ajuste agregado sobre muchos períodos — nunca va a decir "esta
   Milanesa puntual del martes usó Nalga o Bife". Si el dueño necesita
   trazabilidad por plato (p. ej. para un reclamo puntual de un cliente),
   esto no lo resuelve; solo resuelve la pregunta de gestión ("¿cuánto
   corte X consume en total la mezcla de ventas de un mes típico?").
2. **Necesita variación real en la mezcla de ventas entre períodos para ser
   resoluble — si no, el sistema queda indeterminado.** Es álgebra lineal
   lisa y llana: si TODAS las semanas venden exactamente la misma
   proporción de Milanesa/Bife/Lomo-a-la-parrilla, todas las ecuaciones
   `compras_corte_i ≈ Σ_j (ventas_plato_j × coef_i_j)` son múltiplos
   linealmente dependientes entre sí — no hay forma de separar cuánto le
   aportó cada plato a cada corte, sin importar cuántas semanas de
   historia se agreguen (agregar más ecuaciones idénticas en dirección no
   agrega información nueva). Hace falta que, entre semana y semana,
   varíe de verdad qué se vendió más — una temporada con más Milanesa que
   Bife y otra al revés, por estacionalidad/promos/rotación de carta —
   para que el sistema tenga información suficiente para despejar los
   coeficientes individuales.
3. **Sensible a que "compras − ventas" no sea solo "lo que se cocinó".**
   El balance real de un corte en un período es compras − mermas
   (vencido, robo, mal preparado — `MotivoMerma`, `prisma/schema.prisma:
   509-520`, ya tipado y separable) − stock que quedó en heladera sin
   vender todavía − lo que efectivamente fue a un plato. Si el modelo
   simplifica a "compras ≈ Σ ventas×coeficiente" sin restar la merma
   conocida y sin considerar el stock en tránsito (comprado esta semana,
   cocinado la próxima), el coeficiente estimado absorbe ese ruido como si
   fuera "consumo por plato" y queda sesgado. Motor2 YA separa MERMA de
   COMPRA/VENTA en el Kardex (Parte B.1) — eso es una ventaja real (se
   puede restar la merma conocida antes de correr la regresión), pero no
   elimina el desfasaje temporal compra↔cocción ni la merma NO registrada
   (recorte de grasa/nervios al preparar, que hoy no pasa por ningún
   proceso tipeado — ver `docs/grounding-merma-productos-compartidos.md`,
   que ya estableció que esa merma de preparación vive hoy en
   `RecetaIngrediente.mermaPorcentaje`, un valor cargado a mano, no medido).
4. **Cuantos más cortes y más platos entren en la mezcla, más períodos de
   historia hacen falta.** Es un sistema con tantas incógnitas
   (coeficientes) como pares corte×plato relevantes — para que haya más
   ecuaciones (períodos) que incógnitas (condición necesaria para poder
   resolver por mínimos cuadrados en vez de quedar indeterminado), hacen
   falta semanas/meses de historia, no un puñado de datos.
5. **No reemplaza al criterio del dueño, lo informa.** El resultado es una
   estimación con margen de error — útil para decisiones de compra/costeo
   aproximado, no para afirmaciones contables exactas por plato.

### C.3 — Veredicto para este caso concreto

Dado el escenario real (sin disciplina de kitchen logging, cortes
intercambiados libremente, el dueño mismo descarta imponer un proceso de
pesado-y-registro), el enfoque de **regresión/estadística es el único de
los dos que es utilizable en la práctica hoy**: no depende de ningún cambio
de comportamiento humano y usa datos que motor2 ya recolecta como
subproducto de operar (Parte B). El enfoque de "producción/desposte
disciplinado" — que además resultó no ser lo que Grocy realmente ofrece
(Parte A) — sigue siendo, en el mejor de los casos, una opción válida a
futuro SI el negocio decide en algún momento sí instalar esa disciplina en
la cocina; hoy no lo es.

---

## Parte D — Sketch de alto nivel del reporte de regresión (diseño, no implementación)

**Nota de alcance**: esto es un sketch conceptual para dimensionar la idea,
no una implementación — no se escribió código ni se tocó ningún archivo de
motor2 como parte de esta investigación.

### D.1 — Qué consulta trae los datos

Dos agregaciones, ambas sobre `MovimientoStock` filtrado por `sucursalId`
(vía `seccion.sucursalId`, mismo patrón que `obtenerReportePorPeriodo`) y
agrupado en la MISMA grilla de períodos (ver D.2):

- **Purchases**: `SUM(cantidad) WHERE proceso = 'COMPRA' AND productoId IN
  (cortes de MP relevantes)`, agrupado por `(período, productoId)`.
- **Sales**: `SUM(cantidad) WHERE proceso = 'VENTA' AND productoId IN
  (platos de PV relevantes)`, agrupado por `(período, productoId)` — mismo
  patrón que ya usa `calcularVentasDelPeriodo` (Parte B.3), corrido una vez
  por período en vez de una sola vez sobre todo el rango.
- Opcionalmente, restar `SUM(cantidad) WHERE proceso = 'MERMA' AND
  productoId = <ese corte>` del lado de compras de cada período, para
  aislar mejor "lo que realmente pudo haberse cocinado" (mitiga el caveat
  C.2.3 parcialmente — no lo elimina, porque sigue sin cubrir la merma de
  preparación no tipeada).

### D.2 — Granularidad del período

**Semanal** es la unidad más razonable como default: mensual da muy pocos
puntos de datos en un horizonte manejable (12 meses = 12 ecuaciones, muy
poco margen sobre el número de cortes×platos a resolver — ver caveat
C.2.4), mientras que diario introduce demasiado ruido de timing (una compra
grande de nalga un lunes no se cocina toda ese mismo día; a nivel semana ese
desfasaje se promedia mejor). El propio reporte podría, igual, ofrecer el
parámetro de agrupación (semana/mes) como lo hacen ya varios reportes de
motor2 con su rango de fechas.

### D.3 — El planteo de álgebra lineal, conceptualmente

Para cada período *t* (una fila) y cada corte *i* (nalga, bife, lomo,
cuadrada):

```
compras_corte_i(t)  ≈  Σ_j [ ventas_plato_j(t) × coeficiente_i_j ]  +  error_i(t)
```

donde `coeficiente_i_j` es la incógnita a estimar: "cuánto corte *i*, en
promedio, consume una unidad vendida del plato *j*". Con *P* períodos de
historia y *K* = (número de cortes) × (número de platos que podrían usar
ese corte) incógnitas, el sistema es una regresión lineal múltiple estándar
(mínimos cuadrados) — resoluble de forma única y estable solo cuando `P` es
razonablemente mayor a `K` Y hay variación real entre filas (caveat C.2.2).
Con pocos períodos o mezcla de ventas casi constante, el sistema queda
subdeterminado o mal condicionado (coeficientes ambiguos, sensibles a
ruido) — el reporte debería, como mínimo, mostrar alguna medida de
confianza/ajuste (p. ej. R² por corte, o simplemente cuántos períodos de
historia hay disponibles vs. cuántas incógnitas se están resolviendo) para
que el dueño sepa cuándo el número es confiable y cuándo es solo una
extrapolación floja con pocos datos.

### D.4 — Qué NO cubre este sketch (a propósito)

Ni el detalle de qué librería de regresión usar, ni el diseño de la UI del
reporte, ni cómo se seleccionan a mano qué platos "podrían" usar qué cortes
(un prior razonable — p. ej. limitar `j` a los platos de la categoría
"carne vacuna" en vez de correr la regresión contra el catálogo entero de
PVs — reduce `K` y hace el sistema más resoluble, pero es una decisión de
producto/UX, no de este documento). Este documento contesta únicamente si
el dato crudo ya existe (sí, Parte B) y si el enfoque alternativo de Grocy
es real (no tal como se describió, Parte A) — el diseño detallado del
reporte, si el dueño decide construirlo, es trabajo de otra sesión.
