# Grounding: qué debería informar "Compras" (2026-09-18)

**Motivo**: el usuario señaló que la vista actual de Compras (Reporte por período → tarjeta "Compras" + tabla por proveedor) no sirve para tomar ninguna decisión — "5 líneas, tal monto" no dice nada. Este documento investiga a fondo qué es lo que falta, cómo lo resuelven los sistemas de referencia del proyecto (ERPNext, Dolibarr, Grocy), y qué convendría construir en motor2. **No es una implementación** — es la investigación previa, para decidir alcance antes de tocar código.

## 1. Qué muestra motor2 hoy (confirmado leyendo el código, no de memoria)

`calcularComprasDelPeriodo` (`src/core/reportes/periodo.ts:162-200`) agrupa las líneas de Kardex del rango elegido **solo por proveedor**, y por cada proveedor calcula:

- `importe`: suma de `precioTotal` de esa sucursal, ese proveedor, en el rango.
- `lineas`: cantidad de líneas de compra individuales (ya señalado como confuso en `docs/comparativa-ux-erpnext-dolibarr.md` §8.6, pero nunca resuelto de fondo — solo se aclaró la palabra).
- `productos`: lista de productos comprados a ese proveedor, cada uno con su importe acumulado (sin cantidad, sin precio unitario, sin comparación con nada).

Eso es TODO lo que hay. No hay:
- Ninguna serie temporal (mes a mes, semana a semana) — el reporte es un único total para el rango elegido, sin comparación con el rango anterior.
- Ninguna vista por producto/insumo/categoría — solo por proveedor. Para saber "¿dónde se me va la plata, en harina o en lácteos?" hoy no hay forma sin sumar a mano.
- Ningún precio unitario ni tendencia de precio — ni siquiera $/kg, solo el importe total de la línea.
- Ninguna comparación "¿estoy pagando más que la vez pasada por este insumo?" — existe `/catalogo/proveedores/comparativa` (compara el precio más reciente ENTRE proveedores, para el mismo insumo), pero no compara un proveedor contra SU PROPIO historial en el tiempo.

**Diagnóstico**: el reporte está armado alrededor de la dimensión equivocada para la pregunta que un dueño de pizzería realmente se hace. "¿Cuánto le compré a este proveedor?" es una pregunta contable (para pagarle), no una pregunta de gestión. Las preguntas de gestión son "¿en qué se me va la plata?" (por insumo/categoría) y "¿estoy pagando más que antes?" (por insumo, en el tiempo) — ninguna de las dos está resuelta hoy.

## 2. Cómo lo resuelven los sistemas de referencia

### ERPNext — motor de "Analytics" (pivot table), compartido por Ventas y Compras

`Purchase Analytics` (`erpnext/buying/report/purchase_analytics/`) reusa literalmente el mismo motor que `Sales Analytics` (`Analytics(filters).run()`, en `erpnext/selling/report/sales_analytics/sales_analytics.py`) — confirmado leyendo el código fuente real (`raw.githubusercontent.com/frappe/erpnext`):

- **Filas** = la dimensión elegida: Proveedor, Grupo de Proveedores, Insumo, o Grupo de Insumos (con indentado jerárquico si es un grupo).
- **Columnas** = períodos de tiempo (semanal/mensual/trimestral/anual), más una columna "Total" al final.
- **Valor** = **Monto** o **Cantidad**, a elección — nunca los dos mezclados en la misma tabla.
- Los grupos (nodos padre del árbol) acumulan el total de sus hijos automáticamente.

Es, en esencia, una tabla dinámica: elegís "por qué agrupar" y "cada cuánto", y el sistema arma la grilla. La pieza clave que le falta a motor2 no es el pivot completo (es una pieza de UI pesada para el tamaño de este negocio — ver la decisión ya tomada en Pivote 5, "escenario estándar chico-mediano") sino la idea de fondo: **la dimensión de agrupación (proveedor vs. insumo vs. categoría) y el eje temporal (total del rango vs. evolución mes a mes) tienen que ser elegibles, no fijos**.

`Purchase Order Analysis` (ciclo orden→recepción→facturación: Qty/Received Qty/Pending Qty/Billed Qty, Amount/Billed Amount/Pending Amount) no aplica a motor2 — motor2 no tiene un flujo de Orden de Compra, registra la Compra ya concretada. Se descarta como referencia para esta pregunta puntual.

`Item Price` (ficha de precio por Insumo×Proveedor×Lista, con `Valid From`/`Valid Upto`) es el equivalente conceptual de `ProveedorPorProducto` en motor2 (ya existe, ya se actualiza en cada Compra) — ERPNext expone un botón "Prices" en el Item que muestra el histórico completo en una tabla; no encontré un gráfico de tendencia nativo (según la documentación, sería una vista custom armada sobre esos datos).

### Dolibarr — módulo Estadísticas

El módulo "Statistiques" da una vista de "sus achats (en volumen y la repartición por proveedores, país de origen)" con histogramas, histogramas apilados, torta y curvas. El gráfico más relevante acá: **"últimos precios de compra y en qué proveedor, con cada proveedor de un color distinto"** — un scatter/línea de precio en el tiempo, coloreado por proveedor, exactamente la pregunta "¿le estoy pagando cada vez más a este proveedor?".

### Grocy — el más chico de los tres, y el más parecido en escala a motor2 (ya referencia del proyecto)

Dos piezas, ambas MUY relevantes para este caso:

1. **Reporte "Spendings"**: torta + tabla del gasto total por **producto o grupo de producto**, en cualquier rango de fechas elegible. Es exactamente la pregunta "¿en qué se me va la plata?" resuelta de la forma más simple posible — sin pivot table, sin dimensiones cruzadas, solo "elegí el rango, mirá la torta".
2. **Gráfico de historial de precio por producto**, con **línea de tendencia** agregada — muestra precio por unidad de compra en el tiempo, por tienda ("store" ≈ proveedor acá). Las compras cargadas con precio $0 se excluyen del cálculo de precio promedio/último (mismo problema que motor2 ya tiene con "compras sin precio", pero Grocy lo resuelve excluyendo del promedio en vez de solo avisar).

## 3. Lo que motor2 ya tiene y no está usando para esto

- `ProveedorPorProducto.precioPorUnidadStock` + `ultimaCompra`: ya es, literalmente, el dato de "último precio por proveedor" — hoy solo alimenta `/catalogo/proveedores/comparativa` (una foto del momento, sin historia).
- `Insumo.grupoId` → `Grupo` (árbol de familias): la dimensión "por categoría/familia" que pide Grocy (Spendings por grupo) ya existe en el modelo — hoy no la usa ningún reporte de Compras.
- `IndicePrecio`/`cargarSerieIPC`/`resolverCoeficienteIPC` (`src/core/reportes/indices-economicos.ts`): serie real de IPC INDEC ya integrada y funcionando, hoy usada SOLO para ajustar el margen de Ventas (Método 1, `docs/comparativa-ux-erpnext-dolibarr.md` §10). Es exactamente la pieza que NINGUNO de los tres sistemas de referencia tiene de fábrica (están pensados para monedas estables) — reusarla acá permite responder "¿de verdad estoy pagando más por la harina, o es solo inflación general?", una pregunta que en Argentina es más relevante que en cualquiera de los tres sistemas de referencia.

Ninguna pieza de infraestructura nueva hace falta para la Fase 1 de esto — es prácticamente todo reordenar datos que ya se guardan.

## 4. Recomendación — versión 1 (antes de la segunda pasada)

Ordenado de más simple/valioso a más ambicioso — no son excluyentes, se pueden construir en ese orden:

1. **Gasto por insumo/grupo, no solo por proveedor** (Grocy "Spendings"): la misma pantalla de Compras, pero con una segunda vista (o un selector) agrupando por `Insumo`/`Grupo` en vez de por `Proveedor`. Responde "¿en qué se me va la plata?" — la pregunta que hoy no tiene respuesta. Costo bajo: es una función de agregación nueva sobre datos que `obtenerReportePorPeriodo` ya trae, mismo patrón que `calcularComprasDelPeriodo`.
2. **Precio unitario + tendencia por insumo** (Dolibarr + Grocy): agregar a `/catalogo/proveedores/comparativa` (o una pantalla nueva) la evolución del precio por unidad de stock de cada insumo en el tiempo, coloreado por proveedor — no solo "hoy quién es más barato" sino "¿subió o bajó desde la compra anterior?". Con `ProveedorPorProducto` ya guardando `ultimaCompra`, falta solo consultar el historial completo de `MovimientoStock` (proceso COMPRA) de ese insumo en vez de solo el último precio.
3. **Ajustado por IPC** (diferenciador real de motor2, nadie más lo tiene): mismo Método 1 ya construido para margen — aplicado al precio de compra, para separar "subió el insumo en particular" de "subió todo por inflación general".
4. **Selector de dimensión + rango temporal, estilo Analytics de ERPNext** — la versión más ambiciosa: elegir agrupar por Proveedor/Insumo/Grupo, y ver la evolución mes a mes en vez de un solo total. Recién tendría sentido después de validar que 1-2 ya resuelven el problema real — es la pieza más cara de construir (UI de tabla dinámica) y el negocio hoy es chico-mediano (Pivote 5), no está claro que la complejidad se justifique todavía.

**Paso 1 implementado (2026-09-18)** — ver `FilaGastoPorInsumo`/`FilaGastoPorGrupo` en `src/core/reportes/periodo.ts`, tabla + gráfico de barras en `/reportes/periodo`. Pruebas en `test/reportes/periodo.test.ts`.

## 5. Segunda pasada — verificación independiente (2026-09-18)

A pedido del usuario ("otros modelos para verificar, comparar, contrastar y robustecer el análisis"): se lanzó un agente separado, con su propio contexto — **sin ver este documento ni el razonamiento de la pasada 1** — a investigar la misma pregunta desde cero, con enfoque explícito en sistemas ESPECÍFICOS de gastronomía (no ERPs genéricos), para poder comparar y contrastar sin sesgo de confirmación. (Nota de transparencia: no hay acceso a APIs de otros proveedores de LLM en esta sesión — la independencia se logró con un agente Claude separado, contexto propio, WebSearch propio.)

### Sistemas nuevos que apareció esta pasada (no cubiertos en la 1)

Software específico de gastronomía (xtraCHEF/Toast, Restaurant365, MarketMan, Apicbase, Supy, ChefTec, Jelly, Restroworks) resuelve esto de forma sistemáticamente distinta a los ERPs genéricos:

- **Price Fluctuation / Item Price Change Analysis** (xtraCHEF, y sobre todo **Restaurant365** — señalado como "el mejor diseño del rubro"): por ítem, precio al inicio del rango vs. precio promedio del rango, **más el consumo del mismo rango, más el impacto en pesos de ese cambio de precio**. No ordena por % de variación — ordena por plata: `Δprecio × cantidad comprada = impacto en $`.
- **Vínculo compra → receta → plato** (xtraCHEF, Jelly, ChefTec): cuando cambia el precio de un insumo, el sistema recalcula el costo y margen de CADA plato que lo usa. Es la diferencia real entre software de gastronomía y un ERP genérico — ninguna de las 3 referencias de la pasada 1 (ERPNext/Dolibarr/Grocy) lo hace, porque ninguna modela recetas.
- **Higiene de datos como parte del reporte, no aparte**: Restaurant365 diseñó su "Price Variance Report" explícitamente para separar una suba real de un error de carga (unidad/presentación mal tipeada) — con guardarraíles (mínimo de observaciones, banda de verosimilitud), no solo excluyendo $0.
- **Odoo, revisado aparte**: su "Purchase Analysis" es una pivot genérica, sin nada específico de gastronomía — mismo patrón que ERPNext. Señal de que la pivot es la respuesta que dan los sistemas que no saben de gastronomía, no la respuesta al problema de este negocio.

### Correcciones/adiciones concretas a la recomendación de la pasada 1

1. **El paso 2 (precio + tendencia) estaba incompleto sin ponderar por volumen** — el hallazgo más importante de esta pasada. Ordenar por % de variación de precio (como proponía la pasada 1) hace que un insumo barato y volátil (ej. orégano +60%) tape a uno caro con una suba moderada (ej. muzzarella +7%, pero es un tercio del gasto). Hay que ordenar por **impacto en $** (`Δprecio × cantidad comprada del período`), no por %.
2. **Falta un "paso 0" más barato y más prioritario que el paso 1 ya implementado**: `gasto en insumos / ventas del período` (el "food cost %" que todo dueño de gastronomía ya tiene en la cabeza), comparado con el mismo ratio del período anterior. `obtenerReportePorPeriodo` ya calcula `ventas` y `compras` en la misma función — es casi gratis, y es el único número que se entiende sin explicación.
3. **Falta el vínculo compra → receta → plato** (paso nuevo, no estaba en la v1): motor2 ya tiene la infraestructura completa para esto (`RecetaVersion`/`RecetaIngrediente`, costeo BOM recursivo, `MovimientoStock.costoUnitarioVenta` ya congela el costo real de cada venta) — es la pieza que ningún sistema de referencia de la pasada 1 podía sugerir, porque ninguno modela recetas.
4. **Falta el caveat "compras ≠ costo"**: un reporte de Compras mide desembolso, no consumo — una compra grande de stockeo un mes se lee como "gasté mucho" sin serlo en términos de consumo real. Mismo criterio de honestidad que ya usa `hayComprasSinPrecio`.
5. **El ajuste por IPC (paso 3 de la v1) es una buena idea mal encuadrada**: (a) `IndicePrecio` hoy es el IPC nivel general — el rubro "Restaurantes y hoteles" se mueve distinto (ver fuente Infobae); más preciso sería IPC "Alimentos y bebidas". (b) Hay un comparador mejor y ya disponible: el propio índice de precios de CARTA del negocio (motor2 ya audita cambios de `PrecioLocalProducto.precio` desde el Pivote 6/A3) — "¿subió más el insumo que lo que yo subí mi carta?" es más accionable que "¿subió más que la inflación general?". Se recomienda: **carta propia como comparador primario, IPC Alimentos como contexto secundario**, no al revés.
6. **El paso 4 (pivot estilo ERPNext) se confirma como el de más baja prioridad**, con más fuerza que en la v1: la literatura de software para negocios chicos es explícita en que priorizan simplicidad sobre herramientas configurables — una pivot "permite construir preguntas", no las responde, y el problema acá es que el dueño no sabe cuál es la pregunta. Bajarlo a export-para-el-contador antes que a herramienta de análisis del dueño.
7. **Alertas como digest siempre visible, no notificaciones configurables**: un dueño de pizzería chica no configura umbrales ni lee mails de su ERP — 3-5 bullets arriba del reporte (mayor impacto en $, mayor % de suba, proveedor más barato disponible, dato sospechoso), sin configuración, con defaults razonables.
8. **Packaging como categoría propia** (hallazgo específico de la segunda pasada, no genérico): para un negocio con delivery/takeaway, cajas/bolsas/servilletas es una línea de costo grande y sistemáticamente mal categorizada como "varios" — separarla es barato y muy visible.

### Roadmap consolidado (reemplaza la v1)

| # | Paso | Esfuerzo | Estado |
|---|---|---|---|
| 0 | Ratio gasto insumos/ventas del período, vs. período anterior, con el caveat "compras ≠ costo" | Muy bajo | **Pendiente — subió de prioridad, es más barato que el 1 y ya implementado** |
| 1 | Gasto por insumo/grupo (agregar corte Pareto 80/20 + % sobre el total a lo ya construido) | Bajo | **Implementado (2026-09-18)**, falta el corte Pareto |
| 2 | Precio por unidad + Δ% vs. compra anterior + **Δ$ de impacto (ponderado por volumen)**, ordenado por impacto — con guardarraíl de anomalías (mínimo de observaciones, no solo excluir $0) | Medio | Pendiente — reemplaza al paso 2 original, ahora con la ponderación |
| 3 | Digest de 3-5 alertas fijas arriba del reporte (sin configuración) | Bajo, si el 2 existe | Pendiente |
| 4 | Impacto en recetas/platos (qué platos usa el insumo que subió, cuánto les sube el costo/food cost %) | Medio-alto | Pendiente — nuevo, no estaba en la v1 |
| 5 | Comparación contra el índice de carta propio (primario) + IPC Alimentos (secundario, en vez de IPC general) | Medio | Pendiente — reemplaza al paso 3 original |
| 6 | Packaging como categoría propia + costo de packaging por pedido | Bajo | Pendiente — nuevo |
| 7 | Selector de dimensión + período estilo pivot ERPNext | Alto | Pendiente — confirmado como el de más baja prioridad, posible export para el contador en vez de herramienta de análisis |

**No se tocó código de los pasos 2 en adelante en esta pasada** — el paso 0 y el ajuste del paso 1 (Pareto) sí, por ser extensiones baratas de lo ya construido. El resto queda para que el usuario confirme el nuevo orden antes de seguir.

## Fuentes

Pasada 1 (ERPNext/Dolibarr/Grocy):
- [Buying Reports — ERPNext](https://docs.frappe.io/erpnext/buying_reports)
- [Purchase Order Analysis Report — TechfordAI](https://techfordai.com/purchase-order-analysis-report-in-erpnext/)
- `erpnext/buying/report/purchase_analytics/purchase_analytics.py` y `erpnext/selling/report/sales_analytics/sales_analytics.py` (código fuente real, `frappe/erpnext`, leído vía `raw.githubusercontent.com`)
- [Item Price — Frappe docs](https://docs.frappe.io/erpnext/user/manual/en/item-price)
- [Module Statistiques — Dolibarr Wiki](https://wiki.dolibarr.org/index.php/Module_Statistiques)
- [Grocy Changelog & Release History](https://grocy.info/changelog) (price history trendline, Spendings report, exclusión de compras a $0)
- [Grocy issue #1743 — Price (history) per quantity unit purchase](https://github.com/grocy/grocy/issues/1743)

Pasada 2 (software específico de gastronomía, independiente):
- [MarketMan — Restaurant Purchasing & Order Management](https://www.marketman.com/platform/restaurant-purchasing-software-and-order-management)
- [xtraCHEF — Cost Management Reports (Toast)](https://support.toasttab.com/en/article/xtraCHEF-Reports-Cost-Management)
- [xtraCHEF — Spending by GL Analytics](https://support.toasttab.com/en/article/xtraCHEF-Analytics-Spending-by-GL)
- [Restaurant365 — Item Price Change Analysis](https://docs.restaurant365.com/docs/item-price-change-analysis)
- [Restaurant365 — Price Variance Report](https://radar.help.restaurant365.com/support/solutions/articles/12000084008-price-variance-report)
- [Supy — How to Calculate Food Cost Percentage](https://supy.io/blog/how-to-calculate-food-cost-percentage)
- [Apicbase — Food Cost Control](https://get.apicbase.com/food-cost-control/)
- [ChefTec Ultra](https://www.cheftec.com/cheftec-ultra)
- [Jelly — Ingredient & Supplier Price Alert Software](https://blog.getjelly.co.uk/ingredient-supplier-price-alert-software/)
- [Odoo 19 — Purchase Analysis report](https://www.odoo.com/documentation/19.0/applications/inventory_and_mrp/purchase/advanced/analyze.html)
- [VantaInsights — Restaurant Food Cost Percentage 2026: 28-35%](https://vantainsights.com/insights/restaurant-food-cost-percentage)
- [Infobae — Inflación y presión sobre restaurantes y hoteles (ago-2026)](https://www.infobae.com/economia/2026/08/14/la-inflacion-volvio-a-subir-y-crece-la-presion-sobre-restaurantes-y-hoteles-el-margen-del-negocio-no-te-permite-tomar-credito/)
