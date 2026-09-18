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

## 4. Recomendación (para decidir alcance, no para implementar todavía)

Ordenado de más simple/valioso a más ambicioso — no son excluyentes, se pueden construir en ese orden:

1. **Gasto por insumo/grupo, no solo por proveedor** (Grocy "Spendings"): la misma pantalla de Compras, pero con una segunda vista (o un selector) agrupando por `Insumo`/`Grupo` en vez de por `Proveedor`. Responde "¿en qué se me va la plata?" — la pregunta que hoy no tiene respuesta. Costo bajo: es una función de agregación nueva sobre datos que `obtenerReportePorPeriodo` ya trae, mismo patrón que `calcularComprasDelPeriodo`.
2. **Precio unitario + tendencia por insumo** (Dolibarr + Grocy): agregar a `/catalogo/proveedores/comparativa` (o una pantalla nueva) la evolución del precio por unidad de stock de cada insumo en el tiempo, coloreado por proveedor — no solo "hoy quién es más barato" sino "¿subió o bajó desde la compra anterior?". Con `ProveedorPorProducto` ya guardando `ultimaCompra`, falta solo consultar el historial completo de `MovimientoStock` (proceso COMPRA) de ese insumo en vez de solo el último precio.
3. **Ajustado por IPC** (diferenciador real de motor2, nadie más lo tiene): mismo Método 1 ya construido para margen — aplicado al precio de compra, para separar "subió el insumo en particular" de "subió todo por inflación general".
4. **Selector de dimensión + rango temporal, estilo Analytics de ERPNext** — la versión más ambiciosa: elegir agrupar por Proveedor/Insumo/Grupo, y ver la evolución mes a mes en vez de un solo total. Recién tendría sentido después de validar que 1-2 ya resuelven el problema real — es la pieza más cara de construir (UI de tabla dinámica) y el negocio hoy es chico-mediano (Pivote 5), no está claro que la complejidad se justifique todavía.

**No se tocó código en esta pasada** — queda pendiente de que el usuario elija con qué punto arrancar (o si prefiere otro orden).

## Fuentes

- [Buying Reports — ERPNext](https://docs.frappe.io/erpnext/buying_reports)
- [Purchase Order Analysis Report — TechfordAI](https://techfordai.com/purchase-order-analysis-report-in-erpnext/)
- `erpnext/buying/report/purchase_analytics/purchase_analytics.py` y `erpnext/selling/report/sales_analytics/sales_analytics.py` (código fuente real, `frappe/erpnext`, leído vía `raw.githubusercontent.com`)
- [Item Price — Frappe docs](https://docs.frappe.io/erpnext/user/manual/en/item-price)
- [Module Statistiques — Dolibarr Wiki](https://wiki.dolibarr.org/index.php/Module_Statistiques)
- [Grocy Changelog & Release History](https://grocy.info/changelog) (price history trendline, Spendings report, exclusión de compras a $0)
- [Grocy issue #1743 — Price (history) per quantity unit purchase](https://github.com/grocy/grocy/issues/1743)
