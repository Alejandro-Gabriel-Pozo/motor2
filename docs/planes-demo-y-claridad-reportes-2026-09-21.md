# Planes: demo de venta, claridad de reportes y calidad de datos (2026-09-21)

Cuatro planes diseñados en modo **solo lectura y planificación** (agentes `Plan` con Opus, sin editar código, sin correr tests ni migraciones, sin tocar Neon salvo `SELECT`), a partir de dudas del usuario sobre la demo "La Cuadra" y sobre cómo se lee `/reportes/periodo`, `/reportes/rendimiento-recetas` y `/reportes/historial`. **Ningún plan está implementado.** Este documento es la versión condensada: conserva hallazgos, decisiones y pasos, no cada párrafo de los cuatro informes originales.

## 0. El objetivo de la demo (decisión de negocio, fijada en esta conversación)

La demo no es un banco de pruebas de reportes: es **una herramienta de venta**. Tiene que mostrarle al cliente «si armás bien tus recetas y tu stock, la aplicación te da esta información y te permite tomar estas decisiones» — un negocio típico que usa bien la herramienta.

**Reglas fijadas, en orden de importancia:**

1. **El estado que se ve por defecto (sin navegar hacia atrás en el tiempo) tiene que ser el de un negocio bien armado.** Sin platos sin receta, sin ventas sin precio, sin unidades mezcladas, sin números absurdos (el +3070 % del ajo, el −100 % de la prepizza). El desorden no da verosimilitud: hace pensar que la herramienta tiene huecos.
2. **Puede mostrar una evolución** — "esto empezó así y se acomodó así" — pero **siempre terminando bien**: haciéndolo como está pensado, sale bien y es útil. Eso es el fin último.
3. **Historia de 6 meses**, con **1 a 1,5 meses de desorden al inicio** (recetas incompletas, sin stock mínimo, sin conteos — ahí el margen real sale "parcial") y el resto **ordenado**: recetas completas, stock mínimo cargado, conteos periódicos.
4. **Las variaciones creíbles se mantienen** y no se confunden con errores: precios de compra que suben, cantidades que siguen la demanda, un faltante puntual, un lote que vence, una merma real detectada por un conteo. Son las que dan sentido a las decisiones que la demo quiere mostrar.
5. **Los errores de carga (compra duplicada, venta de más) no son el tema central.** Como mucho, un episodio corto para mostrar que se corrigen y quedan auditados — opcional, a decidir.
6. **Ningún reporte debe verse "vacío" o "roto" en el estado ordenado.** Los reportes de calidad de catálogo (Huecos, Insumos sin receta, Ventas sin receta) van a estar en cero: conviene que dijeran algo como "Todo en orden: no hay platos sin receta" en vez de una tabla en blanco — **esto es un cambio de la aplicación, no solo de los datos**, y queda como ítem a evaluar (no estaba en el alcance original de los cuatro planes).

**Vigencia de la demo (decidido):** se regenera manualmente cada 2 meses aproximadamente. **Se descartó** una "fecha de referencia" fija en el código (tocaba ~15 archivos y agregaba una pieza a mantener para siempre) a favor de la opción operativamente más simple: sin cambios en la aplicación, con el costo de un recordatorio para no dejarla envejecer. **El recordatorio queda anotado acá, sin evento de calendario**: cada tanto, al volver a este documento, corresponde revisar hace cuánto se regeneró la demo.

**Rango por defecto de los reportes (decidido):** las cinco pantallas que hoy abren en "mes en curso" (Resumen operativo, Período, Categorías, Promociones, Rendimiento de recetas) pasan a un **selector con "Últimos 30 días" por defecto y "Mes en curso" como segunda opción**, más fecha libre. Detalle en §1.

## 1. Selector de rango por defecto ("Últimos 30 días" / "Mes en curso") — HECHO (2026-09-22, local sin push)

**Verificado en el código:** `primerDiaDelMes()`/`primerDiaDelMesISO()` está copiada cinco veces (`resumen-operativo.ts`, y los `page.tsx` de periodo, categorias, promociones, rendimiento-recetas). Ningún test de Playwright depende de esos rótulos; un solo test de Vitest (`resumen-operativo.test.ts`) menciona "mes actual" y hay que actualizarlo.

**Diseño:**
- Una sola función pura de rango por defecto, parametrizada por la opción elegida, que reemplaza las cinco copias.
- Las cinco pantallas leen la opción de `searchParams` (`?rango=30d|mes`); una fecha explícita en la URL sigue mandando.
- El resumen operativo deja de decir "Financiero del mes actual", "Ventas del mes", "Margen del mes", etc., y rotula según la opción vigente.
- Selector como `<select>` dentro del formulario GET que ya usan esas pantallas (funciona sin JavaScript).

**Tests:** el cálculo puro (día 1, fin de mes, mes de 31 días, febrero, UTC), el test de resumen operativo actualizado, un E2E de que el selector cambia rango y rótulo, un chequeo axe del formulario en los dos estados, y maquetación a 1024/1280 px (el formulario se ensancha).

**Implementado tal cual el diseño:**
- `src/core/reportes/rango-por-defecto.ts` (nuevo): `resolverRangoPorDefecto`/`resolverRangoDeReporte`/`ETIQUETA_RANGO`, con 14 tests unitarios (`test/reportes/rango-por-defecto.test.ts`).
- `src/components/selector-rango.tsx` (nuevo): el `<select>` compartido por las cinco pantallas. Los `<input type="date">` solo se dibujan cuando la opción vigente es "personalizado" (evita que un valor de fecha obsoleto pise una elección fresca de `rango` en el próximo submit — no hay JS para mantenerlos sincronizados). El `<label>` del `<select>` va al lado del control (`htmlFor`), no envolviéndolo, por el mismo motivo ya documentado en `FormularioCorregirCompra` (K1b).
- `resumen-operativo.ts`: `ResumenFinancieroMes` → `ResumenFinanciero`; `obtenerResumenFinancieroMesActual` → `obtenerResumenFinancieroDelRango(sucursalId, desde, hasta, db)`; `obtenerResumenOperativo` acepta un tercer parámetro opcional `{ desde, hasta }`, con default de 30 días si no se pasa.
- Las 5 pantallas (`/reportes`, `/reportes/periodo`, `/reportes/categorias`, `/reportes/promociones`, `/reportes/rendimiento-recetas`) cableadas con `resolverRangoDeReporte` + `<SelectorRango>`; `/reportes` ganó `searchParams` (no tenía) y sus rótulos "del mes"/"(mes)" se sacaron (el subtítulo ya dice el rango exacto).
- Compatibilidad verificada: enlaces/specs que pasan `desde`/`hasta` sin `rango` (incluido `?desde=no-es-una-fecha` de `pantalla-de-error.spec.ts`, sin validar) siguen funcionando idéntico — la opción vigente pasa a ser "personalizado".
- Tests nuevos: `test/reportes/rango-por-defecto.test.ts` (14), un test más en `resumen-operativo.test.ts` (rango explícito que excluye la venta), `test/e2e/selector-rango.spec.ts` (cambia rango/rótulo por URL, verificado con mutación), y en `accesibilidad.spec.ts` un chequeo axe de `/reportes/periodo` en sus dos estados (solo lectura y "Fechas personalizadas").
- Verificación: Vitest 112 archivos/1064 tests, axe 18, Playwright 210, `tsc`/lint limpios, build OK, `test:e2e` confirma modo `build`.

**Sin migración.** Coordinado con §2 (Período), que toca los mismos archivos — §2 (la reestructuración de la tarjeta de margen y "Compras por proveedor") queda pendiente, es trabajo aparte.

## 2. Período y márgenes: de qué es cada número — HECHO (2026-09-22, local sin push)

### Diagnóstico verificado

- **"Compras por proveedor" se queda**, y hoy está sub-usada: la función ya calcula, por proveedor, la lista de productos comprados con su importe, y la UI no la muestra.
- **El margen no se entiende porque conviven 13 cifras de plata/porcentaje** en dos tarjetas, con tres bases de cálculo distintas (nominal con costo de reposición de hoy, "Real" con costo congelado al vender, "Ajustado IPC"), y las definiciones viven en un `title=` (tooltip nativo, casi invisible). El "Costo de lo vendido (consumo)" está en la tarjeta "Compras", lejos de su propio margen ("Real"), aunque se cumple la identidad `costoDeLoVendidoTotal ≈ ingresoConCostoReal − margenRealTotal`.
- **"Líneas" es un conteo de renglones de `MovimientoStock`**, no de productos. Ya se había "resuelto" con un tooltip en 2026-09-17 (`docs/comparativa-ux-erpnext-dolibarr.md` §8.6); el usuario volvió a preguntar lo mismo — el tooltip no alcanza.
- **Hallazgo de fondo (no pedido):** el margen "nominal" (`margenTotal`) suma en el ingreso *todo* lo facturado pero en el costo *solo* lo que tiene costo completo — con un plato sin receta queda inflado. Arreglarlo **cambiaría un número visible**, así que es una decisión aparte (§2, punto 4 de las decisiones).
- **Referentes externos leídos:** ERPNext ("Gross Profit": Selling Amount → Buying Amount → Gross Profit → %, con el costo del momento de la venta por defecto — equivalente a nuestro "Real"); Dolibarr (el módulo Margins obliga a elegir una sola base de costo, no muestra tres a la vez); el rubro gastronómico usa el par "theoretical vs. actual" (Toast/xtraCHEF, verificado solo por resultados de búsqueda, no por lectura directa).

### Recomendación (del agente)

- **Tabla de compras por proveedor:** "Líneas" → **"Productos"** (distintos) + nueva columna **"Compras"** (cantidad de compras), ambas de datos que ya se calculan, sin consultas nuevas. Agregar una columna con qué se le compró (usa el detalle que ya se calcula y se descarta).
- **Tarjeta de margen:** una sola cifra principal con la resta a la vista (Ventas costeadas − Costo de lo vendido = Ganancia, con % y cobertura); el "Costo de lo vendido" se muda ahí desde "Compras"; el margen nominal y el ajustado por IPC quedan en un `<details>` plegado, cada uno con su definición en **texto visible**, no en tooltip.
- **Vocabulario:** "producto" para lo comprado/vendido; "movimiento" para un renglón del Kardex en los mensajes de acción (p. ej. "se revirtieron N movimiento(s) de stock", no "línea(s)" — una anulación revierte también consumos de receta, que no son "productos comprados"); "compra" y no "factura" (hay compras sin N.º).
- **Ningún número cambia de valor** en el corte recomendado; solo rótulo, lugar y jerarquía.

### Decisiones del dueño (no tomadas por el dueño — resueltas con la recomendación del plan, marcadas para revisar, mismo criterio que K1b/K1c/6b)

1. ¿Cuál es el margen "principal"? **Aplicado: el Real** ("Ganancia de lo vendido"), la recomendación.
2. Nombres: **aplicados tal cual el plan** — "Ganancia de lo vendido" (real), "Si repusieras hoy" (nominal), "Ajustada por inflación (IPC)".
3. ¿El IPC se sigue mostrando en Período, plegado? **Aplicado: sí**, dentro del mismo `<details>` que el nominal.
4. ¿Se corrige el denominador del margen nominal (hallazgo de fondo)? **NO aplicado a propósito** — cambia un número ya visible, tal como advertía el plan; sigue pendiente, requiere confirmación explícita y un commit aparte.
5. ¿Se renombra la columna "Margen" de "Ventas por producto" (Período) a "Margen teórico"? **Aplicado** — evita que la misma palabra "Margen" signifique dos bases de costo distintas en dos pantallas (nominal acá, Real en Promociones). Promociones NO se tocó (fuera del alcance de este paso): sigue diciendo "Margen Real", que ahora es un nombre distinto al de la tarjeta de Período ("Ganancia de lo vendido") para el MISMO concepto — inconsistencia menor, no bloqueante, a revisar si se retoma Promociones.

### Implementado

- `src/core/reportes/periodo.ts`: `FilaCompraPorProveedor.lineas` → `cantidadProductos` (productos DISTINTOS) + `cantidadCompras` (operaciones DISTINTAS); `calcularComprasDelPeriodo` cuenta con un `Set<idOperacion>` en vez de incrementar un contador por renglón.
- `src/app/(app)/reportes/periodo/tabla-periodo.tsx`: columna "Líneas" → "Productos" + "Compras"; columna "Margen" de Ventas por producto → "Margen teórico" (con su definición visible en el tooltip de ayuda de la columna, que sí es un uso aceptable de `title=` para un encabezado angosto).
- `src/app/(app)/reportes/periodo/page.tsx` y `src/app/(app)/reportes/page.tsx` (resumen operativo, "mismo tratamiento"): la tarjeta de margen pasa a `<dl>` con una sola cifra principal (Real / "Ganancia de lo vendido"), su definición en texto visible (ya no en `title=`), "Costo de lo vendido" mudado ahí desde "Compras" (mismo `data-costo-de-lo-vendido`, mismo tooltip de detalle — eso SÍ se conservó, lo pedía el spec existente), y el nominal + IPC plegados en un `<details>` con sus definiciones también visibles.
- `src/server/actions/movimientos/compras.ts` y `venta.ts`: "Se revirtieron N línea(s) de stock" → "N movimiento(s) de stock" en los mensajes de anulación.
- **Ningún número cambió de valor** (salvo lo explícitamente excluido en la decisión 4): verificado con un E2E nuevo que siembra un caso con margen Real y nominal bien distintos y confirma que cada cifra aparece donde corresponde (test/e2e/reportes-margen-principal.spec.ts), mutado para confirmar que detecta un cruce Real↔nominal.
- Tests nuevos: `test/arquitectura/periodo-sin-lineas.test.ts` (prohíbe "línea(s)" visible, acotado a `/reportes/periodo` y `/reportes` — **no** a todo `src/app/`: `/reportes/compras` sigue diciendo "línea(s)" a propósito, es tarea de §4, que usa un criterio de conteo distinto), 2 tests más en `test/reportes/periodo.test.ts` (productos vs. compras distintas), `test/e2e/reportes-margen-principal.spec.ts`, y un chequeo axe de la tarjeta plegada/desplegada en las dos pantallas.
- `test/e2e/reportes-costo-de-lo-vendido.spec.ts`: sin cambios de comportamiento, sigue pasando tal cual (el atributo `data-costo-de-lo-vendido` y su `title=` de detalle se conservaron en el nuevo lugar).
- Verificación: Vitest 113 archivos/1067 tests (antes 112/1064), axe 19 (antes 18), Playwright 212 (antes 210), `tsc`/lint limpios, build OK, `test:e2e` confirma modo `build`.

### Pasos y verificación (plan original, para referencia)

10 pasos, sin migración: terminología → sacar definiciones del tooltip → reestructurar la tarjeta (con `<dl>`, nunca `<table>`, por la maquetación a 1024 px) → mismo tratamiento en `/reportes` → tests nuevos, incluido uno que prohíbe "línea(s)" como texto visible en `src/app/` y otro que afirma que la presentación coincide con la definición del cálculo. Verificación final: los 7 comandos de siempre en una misma corrida (línea de base a confirmar: Vitest ≈111 archivos/≈1049 tests, axe 16, Playwright 206), con un chequeo axe por cada estado nuevo de la tarjeta (plegada/desplegada) y actualización de `test/e2e/reportes-costo-de-lo-vendido.spec.ts` (conservando el atributo `data-costo-de-lo-vendido`, que usa su chequeo axe).

## 3. Rendimiento real de recetas: el +14,3 % y el botón peligroso

### El número, reconstruido

El ítem es **Agua mineral 500 ml** (consume 1 unidad de "Agua caja x12" por venta). No es un error: 72 comprados ÷ 63 vendidos = 1,143 → +14,3 %. Verificado contra el Kardex de la demo: el stock de ese insumo pasó de 81 a 90 dentro de la ventana — **las 9 unidades de diferencia están en el depósito, no se perdieron**. Descontando el cambio de stock, el consumo real es 63/63 = 0,0 % de desvío.

**Causas, en orden de peso:**
- La fórmula (compras ÷ ventas) **ignora el cambio de stock entre el inicio y el fin de la ventana** — causa principal.
- **Ruido de lote:** se compra de a cajas de 12 sobre 63 ventas; una caja de más o de menos mueve el resultado ±19 %. El +14,3 % cae dentro de esa banda.
- **Sesgo del seed:** compra ~12 % de más de todo, todas las semanas (`BUFFER = 1.12`), así que casi toda la tabla da desvíos positivos.

### Defectos reales encontrados de paso (con la tabla completa de la demo reconstruida)

1. **`−100 %` en productos que se producen** (no se compran nunca, como la prepizza): el cálculo solo mira compras.
2. **El link "Usar este valor" no tiene ninguna guarda de plausibilidad.** Propondría 0,317 kg de ajo por pizza (la receta dice 0,01) o 0 prepizzas por pizza. **Es el hallazgo más urgente de arreglar de los cuatro planes**, por el riesgo de que alguien lo clickee. **Decisión del usuario (2026-09-21): no ocultar ni deshabilitar el link en ningún caso — en cambio, siempre pedir confirmación explícita antes de aplicar el valor**, mostrando el porqué (comprado, vendido, semanas de datos, y la banda de ruido o el motivo cuando corresponda). La confirmación aparece igual cuando el dato es confiable: la diferencia entre un caso confiable y uno dudoso va en lo que dice el aviso, no en si el botón existe. Reemplaza la idea original de "sin 'Usar este valor' cuando hay motivo" (fila 1 de la tabla de variantes, más abajo).
3. **Compara contra la cantidad neta de receta, no contra la bruta con merma** — toda línea con merma arrastra un sesgo.
4. **`esTrivial` rotula mal**: una sub-receta producida o una caja de cartón se etiquetan "(venta directa)".
5. **La confianza "alta" exige ≥8 semanas**, inalcanzable con la ventana por defecto (mes en curso).

### Recomendación (variantes)

| Variante | Qué es | Veredicto |
|---|---|---|
| 1 — Mostrar la cuenta, banda de ruido, callarse cuando no se puede opinar | Sin cambiar la fórmula: columnas Comprado/Vendido/Δstock visibles, teórico con merma, `motivoSinEstimacion`; "Usar este valor" **siempre disponible, con confirmación explícita y el porqué a la vista** (ver decisión del usuario más arriba) | **Recomendada, hacer ahora** |
| 2 — Netear con el Kardex | `saldo inicial + compras − saldo final` | **Descartada sola**: en motor2 es casi tautológica (las salidas del Kardex las genera la propia receta); da ≈0 % en casi todo y no informa nada nuevo |
| 3 — Varianza real entre conteos físicos | El estándar de la industria ("actual vs. theoretical", verificado en ERPNext Stock Balance y en la literatura de restaurantes) | Después, **si el negocio adopta conteos periódicos** |

### Decisiones del dueño (no tomadas)

1. ¿Qué es este reporte: un **calibrador de recetas** o un **medidor de pérdidas**? Hoy mezcla los dos.
2. ¿Se acepta el compromiso de **conteos físicos periódicos** de los insumos que más pesan? Sin eso, la Variante 3 no tiene ancla.
3. ¿Las filas 1:1/packaging se ocultan del ranking de "revisar receta" o quedan rotuladas?
4. ¿Ventana por defecto: "mes en curso" o "últimas 8 semanas"? (coordinar con §1: si el selector de rango cambia el default de la pantalla, esta pregunta puede resolverse sola con "últimos 30 días" + acumulación de historia).
5. ¿Umbral de ámbar relativo a la banda de ruido, en vez de fijo en 10 %?

### Pasos y verificación

14 pasos (P0-P14 en el informe original), sin migración. Núcleo: módulo puro de banda de ruido y motivo → usar el teórico con merma → sumar `PRODUCCION` como entrada → Δstock informativo (cuidado: **no** debe filtrar `anuladaEn: null`, porque la anulación es un contra-asiento y hacerlo daría un saldo mal) → UI → rótulo correcto de `esTrivial` → chequeo axe propio (**hoy no tiene ninguno**) → Variante 3 opcional → seed. Tests obligatorios: el caso 1:1 con ruido de lote (reproduciendo exactamente el caso del Agua), el caso producido, el caso con merma, y que una compra anulada no mueva los saldos. Verificación final: los 7 comandos, con el chequeo axe nuevo sumando el conteo de 16 a 17.

## 4. Historial por producto y "líneas" en Compras registradas

### Diagnóstico verificado

- **El saldo escalonado decreciente de un PV es un artefacto por diseño**, declarado como tal en el código: un producto de venta que no se produce no tiene stock propio. En la demo **ningún PV tiene "Se produce"**, así que el único caso que se ve es el degenerado. Lo que sí es informativo es la **serie de ventas por día** (sube fines de semana, baja entre semana), que hoy no se muestra.
- **En una MP, la compra se ahoga en el consumo**: la muzzarella tiene 246 movimientos, de los cuales 5 son compras — sin filtro por tipo de movimiento en la pantalla.
- **La tabla descarta datos que ya calcula y no pinta**: proveedor, N.º de factura, lote.
- **Las anulaciones se ven como movimientos fantasma**: la compra original sin marca, más un ajuste de hoy con signo opuesto, sin indicar que una anula a la otra.
- **Confirmado en los datos de la demo:** el tomate perita se compró 1 kg, 27 veces, siempre a $1.800 — exactamente lo que el usuario señaló ("¿siempre se le compró la misma cantidad?"). El ajo y las aceitunas también tienen cantidad constante.
- **Bug del seed encontrado de paso:** cuando el generador elige un proveedor alternativo (para simular variación), la `Operacion` sigue quedando a nombre del proveedor de siempre — el único cambio de proveedor que el seed quería contar sale como una oscilación de precio inexplicable. Es un requisito de datos para §5.

### Recomendación

- **No tocar el Kardex** (sirve para auditar). **Agregar dos vistas nuevas dentro de `/reportes/historial`**, arriba de todo, y **plegar la tabla movimiento-por-movimiento** en un `<details>` "Movimiento por movimiento (auditoría)":
  - **"Cómo se compró" (MP):** resumen en prosa ("se compró 9 veces en 30 días, casi siempre 25 kg, cada 3 días, siempre al mismo proveedor, entre $860 y $892") + tabla de cada compra con proveedor, cantidad, precio, variación contra la anterior (con texto, no solo color) y días desde la anterior.
  - **"Cómo se vendió" (PV):** ventas por día con cantidad, importe y precio promedio; para un PV que no se produce, en vez del gráfico de saldo, un cartel que explica que no tiene stock propio y enlaza a los ingredientes de su receta.
- **Filtro nuevo "Qué mostrar"** en el Kardex (Todo / Solo compras / Solo consumos y ventas / Solo ajustes y conteos) — arreglo barato del problema de "5 compras entre 246 filas".
- **Terminología:** "líneas" → "productos" en `/reportes/compras` (contando productos **distintos**, no renglones — dos renglones del mismo producto en una factura no deben contarse dos veces); en los mensajes de anulación, → "movimientos" (mismo criterio que §2).
- **Permisos, decisión importante:** el historial está bajo `ver_reportes_operativos`, pero las vistas nuevas traen precios. Recomendado: mantener la pantalla en ese permiso y **condicionar solo las columnas de dinero** a `ver_reportes_dinero` (mismo patrón que ya usa `/reportes/compras` con `anular_compra`/`corregir_compra`), sin migración.

### Decisiones del dueño (no tomadas)

1. "Cantidad típica": ¿mediana (recomendada, resiste el stock inicial) o promedio?
2. Frecuencia: ¿días entre compras (recomendado) o compras por semana?
3. Variación de precio: ¿contra la compra anterior (recomendado) o contra el promedio del mes?
4. ¿Se muestra margen reconstruido en el PV? Commit aparte si se acepta.
5. Rango por defecto de las vistas nuevas: recomendado, últimos 90 días.
6. ¿Las devoluciones a proveedor entran en "Cómo se compró"? Recomendado: no, en la primera versión.

### Pasos y verificación

8 pasos, sin migración: terminología → lógica pura de compras (con tests puros: mediana, frecuencia, Δ de precio, cambio de proveedor) → capa de datos de compras contra Postgres real (con el filtro de anuladas en la misma línea, por el guardián de arquitectura) → ventas por día (con tope de filas y aviso si hay demasiadas) → UI reordenada → gráficos con su alternativa tabular siempre visible → margen reconstruido (opcional) → E2E con axe. Riesgo señalado: coordinar el rótulo "productos" con el de §2, para no tener dos palabras distintas en dos pantallas.

## 5. Impacto en el seed de la demo (requisitos de datos de los tres planes anteriores)

Los tres planes de reportes coinciden en que sus mejoras **no se pueden demostrar con los datos actuales** (cantidades y precios constantes, sin conteos, sin anulaciones, sin PV que se produzca). El plan del seed integra estos requisitos con el guion de negocio de §0:

- **Cantidades y frecuencias que varíen con sentido** entre productos (hoy: constantes).
- **Precios de compra con una serie temporal real** (inflación con dispersión, saltos puntuales) — necesario para Período/IPC/dólar y para que el historial de precios diga algo.
- **Arreglar el bug del proveedor alternativo** (§4), para que un cambio de proveedor se vea como tal.
- **Al menos un PV con "Se produce" = true**, para que el caso "el saldo del PV sí significa algo" exista en la demo.
- **Conteos físicos en ambos extremos de la ventana**, para al menos: un insumo bien calibrado (Rendimiento real cerca de 0 %), uno con merma real, y uno ruidoso por lote — para que Rendimiento real muestre los tres casos con sentido y no un +3070 %.
- **Al menos una compra anulada y una corregida** (con stock aún no consumido, para que `anularCompra` no la rechace), para que el aviso de "no cuentan acá" y la auditoría se vean — **acotado a un episodio corto**, no al centro de la historia (regla de §0).
- **Ventas de los primeros 1-1,5 meses sin costo congelado** (para "· reconstruido"/"· parcial"), solo en el tramo de desorden inicial.

**Hallazgos verificados sobre el seed actual, que no dependen de estas mejoras:**

- **No hay rotura de contrato**: `scripts/seed-demo-pizzeria.ts` pasa por `tsc`, y ninguna acción que llama cambió de forma incompatible con el código actual (verificado una por una).
- **La demo se vacía sola por diseño**: el seed ancla la ventana a `new Date()` al momento de correrlo; con reportes que abren en "mes en curso" (o "últimos 30 días", tras §1), pasado ese plazo la pantalla de entrada muestra ceros. Esto ya se decidió en §0: se regenera cada 2 meses, sin fecha fija en el código.
- **Riesgo real al escalar el guion a varios meses**: el limitador de tasa (300 mutaciones/minuto por usuario) puede cortar una corrida larga contra una base local rápida. Se neutraliza solo en el seed (`vi.mock` del módulo), sin tocar producción.
- **`registrarVenta` recalcula el costeo del catálogo completo por cada lote** dentro de la transacción — es el cuello de botella de tiempo si se agrandan los lotes de venta.
- **El seed no tiene ninguna guarda de destino ni es idempotente.** Riesgo de seguridad operativa real: correrlo dos veces duplica todo, y no valida host ni nombre de base antes de escribir.

### Diseño recomendado

- **Arquitectura en piezas puras + ejecutor + verificador**, separando "qué pasa" (el guion, testeable sin base) de "cómo se ejecuta" (llamadas a los server actions reales) de "qué se cumple" (invariantes de conciliación).
- **Determinismo**: un generador pseudoaleatorio con semilla fija, y "hoy" inyectable por variable de entorno **solo para poder generar el guion de forma reproducible en el desarrollo del seed** — esto es distinto de la "fecha de referencia en producción" que se descartó en §0; acá es una herramienta de testing del propio seed, no algo que quede corriendo en la demo.
- **Guardas de destino obligatorias, en este orden, antes de conectarse:** host local, nombre de base con sufijo permitido, verificación de `current_database()`, rechazo si ya hay datos salvo bandera explícita de "rehacer", y una confirmación explícita por variable de entorno antes de escribir.
- **El seed nunca corre contra Neon.** Se corre y verifica en local; a Neon llega un **dump verificado**, a una **rama nueva creada desde `main`** (para heredar las migraciones con sus checksums), nunca sembrando sobre la rama viva. Cada escritura en Neon (crear rama, truncar, restaurar, cambiar la variable de entorno de Vercel) **requiere confirmación expresa del usuario**, igual que las migraciones aplicadas hoy.
- **12 conciliaciones de dominio** (gasto del período = compras registradas = pivote por proveedor; ingreso = ventas por producto = por categoría; saldo del Kardex = valuación = stock consolidado; una anulación no suma; alertas = exactamente lo que el guion dejó bajo mínimo; etc.), verificadas contra la base local ya sembrada — es la parte que funciona como "test E2E de todo el proyecto".
- **Va en un job aparte, no en la corrida normal de `npm test`/`npx playwright test`:** sembrar una segunda sucursal rompería specs existentes (p. ej. el que verifica "con una sola sucursal no hay nada que consolidar"), y agrega varios minutos al ciclo de todos.

### Pasos y verificación

14 pasos, sin migración de schema: generador puro con tests → series de precio → guion de eventos tipado + calculadora de totales esperados → ejecutor con guardas y medición real del tiempo → escenarios (vencimientos/mínimos/mermas → anulaciones/correcciones/consignación → segunda sucursal/traspasos/rol operador) → invariantes de dominio (con demostración de mutación→rojo→revertir→verde por cada familia) → proyecto Playwright propio con axe sobre todas las pantallas → runbook documentado → verificación completa → **solo con autorización expresa, paso por paso: la re-inserción real en Neon**.

**Progreso (implementado en varios tramos, cada uno con su propia verificación y commit — plan grande, no entra en uno solo):**

- **Tramo 1 — HECHO (2026-09-22, local sin push): los primeros 3 pasos ("generador puro con tests", "series de precio", "guion de eventos tipado + calculadora de totales esperados").** Ninguno de los tres toca la base ni un server action — son piezas 100 % puras, testeadas con Vitest normal (no `vitest.seed.config.ts`), y NO alteran ningún archivo de `src/app`/`src/core` de la aplicación (por eso el build/axe/e2e no cambiaron de número).
  - `scripts/demo-seed/prng.ts`: PRNG con semilla fija (mulberry32) + `entero`/`real`/`conProbabilidad`/`elegir`/`gaussiana`. `Math.random()` no sirve acá: sin semilla, dos corridas del seed darían guiones distintos.
  - `scripts/demo-seed/series-precio.ts`: `generarSerieDePrecio` — inflación mensual compuesta semana a semana + ruido gaussiano (dispersión) + saltos puntuales ocasionales, siempre hacia arriba (§0 regla 4: "precios de compra que suben" es la variación creíble pedida, no una baja brusca que leería como error de carga). Reemplaza el precio único y constante de `PRECIOS_REFERENCIA` en `seed-demo-pizzeria-data.ts` (pendiente de conectar: eso pasa en el tramo del guion completo de 6 meses).
  - `scripts/demo-seed/guion.ts`: tipos del guion de eventos (`EventoCompra`/`EventoVenta`/`EventoProduccion`/`EventoConteoFisico`/`EventoMerma`/`EventoAnularCompra`/`EventoCorregirCompra`, referenciados por código de producto/proveedor, no por id — todavía no existen a esta altura), `validarGuion` (refs duplicadas, orden cronológico, referencias colgantes) y `calcularTotalesEsperados` (compras y ventas, con las anuladas excluidas). **Acotado a propósito**: no calcula saldo de stock/Kardex (depende de la receta, lógica que ya vive en `costos.ts`/`periodo.ts` — reimplementarla acá duplicaría esa lógica con riesgo de que diverjan); eso se verifica más adelante, en el paso de invariantes, comparando el sistema CONTRA SÍ MISMO.
  - Tests: `test/demo-seed/prng.test.ts` (13), `test/demo-seed/series-precio.test.ts` (16), `test/demo-seed/guion.test.ts` (12) — 41 tests nuevos, mutados uno por uno en los puntos de mayor riesgo (ej. la exclusión de compras anuladas del total).
  - Verificación: Vitest 116 archivos/1108 tests (antes 113/1067); axe 19, Playwright 212 y build sin cambios de número (esperable: cero archivos de `src/` tocados).
- **Tramo 2 — HECHO (2026-09-22, local sin push): el guion completo de 6 meses de "La Cuadra"** (`scripts/demo-seed/guion-la-cuadra.ts`, `generarGuionLaCuadra`), reusando `PRODUCTOS`/`PROVEEDORES`/`RECETAS` de `seed-demo-pizzeria-data.ts` + la serie de precios y el PRNG del Tramo 1. Sigue siendo 100 % puro (no toca la base) — el ejecutor que lo corre de verdad contra Postgres queda para el Tramo 3.
  - **Arco temporal de §0** (regla 3): las primeras `semanasDeDesorden` (default 5 ≈ 1,2 meses) son el tramo de desorden; el resto (hasta 26 semanas ≈ 6 meses) es el tramo ordenado.
  - **Mecanismo de "ventas sin costo congelado"** (nuevo tipo `EventoCrearReceta` en `guion.ts`): PV020 (la pizza más vendida) no tiene receta cargada hasta el final del tramo de desorden — sus ventas de esas semanas quedan con `costoUnitarioVenta: null`, y el margen Real las reconstruye más tarde usando la receta ya vigente ("· reconstruido"/"· parcial") — verificado que la reconstrucción usa la receta VIGENTE HOY, no la del día de la venta (`costo-historico.ts`), así que el mecanismo es válido.
  - **`EventoConteoFisico` revisado**: pasa de `conteoReal` (absoluto) a `ajusteRelativo` (diferencia contra el saldo real en ese momento) — el guion puro no simula el saldo acumulado del Kardex; el ejecutor lee el saldo real y calcula `conteoReal = saldoActual + ajusteRelativo`. 3 conteos con los perfiles de §5 (bien calibrado / ruidoso por lote / merma real), uno cerca de cada extremo de la ventana.
  - **Bug del proveedor alternativo corregido** (§4/§5): cuando un insumo sale de un proveedor distinto del habitual, esa compra es su PROPIA Operación a nombre del proveedor real — nunca mezclada con el resto de la ronda (antes la Operación entera quedaba a nombre del proveedor de siempre).
  - **PV030 "Pizza al corte (porción)"** agregado al catálogo de la demo (`seed-demo-pizzeria-data.ts`, con su receta) — el PV que "se produce" que pedía §5, para que el saldo de un PV signifique algo real (a diferencia del resto de la carta, que se arma al vender).
  - Un vencimiento de lote (compra de más con `loteVencimiento` cercano) y un faltante puntual (stockout: un insumo no llega una semana) — las "variaciones creíbles" de §0 regla 4.
  - Un episodio corto de anulación + corrección de compra (§5), sobre dos compras distintas de la misma semana, resuelto la semana siguiente.
  - Tests: `test/demo-seed/guion-la-cuadra.test.ts` (16, después 17 — ver Tramo 3) — determinismo, `validarGuion` sin problemas, presencia y perfil de cada escenario puntual, el arreglo del proveedor alternativo, la tendencia de precios al alza, y que `calcularTotalesEsperados` corre sin tirar error sobre el guion completo. Mutado el arreglo del proveedor alternativo y el flag `sinCostoCongelado`.
  - Verificación: Vitest 117 archivos/1124 tests (antes 116/1108); axe 19, Playwright 212 y build sin cambios de número (esperable, mismo motivo que el Tramo 1).
- **Tramo 3 — HECHO (2026-09-22, local sin push): el ejecutor, corrido de verdad contra Postgres local — primera vez que el guion de 6 meses se ve en una base real.**
  - `scripts/demo-seed/guardas-destino.ts` (nuevo, testeado con 22 tests puros): las guardas de §5 en orden — host local, sufijo de base obligatorio ("_demo", carril propio, nunca comparte base con E2E ni benchmark), `verificarBaseVacia` (rechaza si la sucursal "La Cuadra" ya existe, salvo `MOTOR2_SEED_REHACER=si`), `verificarConfirmacionExplicita` (`MOTOR2_SEED_CONFIRMAR="si"`, nunca desde `.env`). `resolverUrlDelSeed` es pura (mismo criterio que `resolverUrlE2E`); `vitest.seed-6-meses.config.ts` (nuevo) las corre ANTES de que exista un cliente Prisma, mismo mecanismo que `playwright.config.ts`.
  - `scripts/seed-demo-pizzeria-6-meses.ts` (nuevo): arma el catálogo (igual que el seed de 30 días, salvo que la receta de PV020 queda pendiente del evento `CREAR_RECETA`), genera el guion con una semilla FIJA (mismo guion siempre) y lo recorre evento por evento llamando a `registrarMovimiento`/`registrarVenta`/`registrarConteoFisico`/`guardarReceta`/`anularCompra`/`corregirCompra` reales — nunca un INSERT directo. Resuelve `ref` de compra → `operacionId` real consultando la Operación recién creada (ejecución secuencial, sin condición de carrera); para `CONTEO_FISICO` lee el saldo real y aplica `ajusteRelativo`. El limitador de tasa (300 mutaciones/minuto) se neutraliza con `vi.mock` SOLO acá, como preveía §5.
  - **2 bugs reales encontrados y corregidos al ejecutar por primera vez contra Postgres** (no se podían ver en las piezas puras del Tramo 2, que nunca simularon la base):
    1. **Sin stock inicial**: las ventas/producción del domingo de la semana 0 se quedaban sin stock (las primeras compras programadas recién caen martes/miércoles) — se agregó un bloque de stock inicial en `generarGuionLaCuadra` (semana 0, `diaSemana: -1`), mismo criterio que ya usaba el seed de 30 días.
    2. **Colisión de N.º de factura**: cuando la sustitución de proveedor alternativo caía el mismo día que la entrega habitual de ESE proveedor, las dos Operaciones (regular + sustituida) generaban el mismo N.º de factura — se agregó la "ronda" (`provCodigo`) a la factura, además del proveedor efectivo.
  - **Corrida real verificada** (base local `motor2_demo`, recreada y sembrada desde cero): 941 eventos en 5,2s, **0 fallos**. Verificado con consultas directas a Postgres (no solo confiando en el log del script): compras $37.864.676 y ventas $47.704.800 — coinciden EXACTO con lo que `calcularTotalesEsperados` había prometido antes de ejecutar nada; PV020 con receta al final; saldo de PV030 positivo (156); 28 líneas de venta sin costo congelado (todas de PV020, en el tramo de desorden); vencimiento de lote en cascada por 175 movimientos (la compra + todos sus consumos posteriores, comportamiento esperado del lote); 13 de 43 combinaciones producto+sección con saldo negativo (el artefacto ya conocido de los PV que se arman al vender). Rango real: 2026-03-24 a 2026-09-22 (6 meses exactos, terminando hoy).
  - **No es idempotente a propósito** (documentado, no un descuido): `MOTOR2_SEED_REHACER=si` solo salta la guarda de "ya existe", no vacía nada — reintentar sobre una base ya sembrada duplica/choca. Para una corrida limpia hay que recrear la base a mano primero (confirmado: un segundo intento sobre datos ya sembrados dio 651 fallos de factura duplicada, como se esperaba).
  - `.env.example`: variables `MOTOR2_SEED_DATABASE_URL`/`MOTOR2_SEED_CONFIRMAR`/`MOTOR2_SEED_REHACER` documentadas con el comando completo.
  - Tests nuevos: 1 test más en `guion-la-cuadra.test.ts` (17 en total) para el stock inicial; `test/demo-seed/guardas-destino.test.ts` (22).
  - Verificación: Vitest 118 archivos/1147 tests (antes 117/1124); axe 19, Playwright 212 y build sin cambios de número (el ejecutor no toca `src/`) — más la corrida real contra Postgres local descripta arriba, que no es parte de `npm test` (§5: "Va en un job aparte").
- **Tramo 4 — HECHO (2026-09-22, local sin push): stock mínimo + las 12 invariantes de dominio, corridas contra la base ya sembrada.**
  - **Stock mínimo** (§0, "el resto ordenado: recetas completas, stock mínimo cargado, conteos periódicos" — faltaba): el ejecutor ahora configura `stockMinimoProducto` para los 18 MP de compra regular, al 40 % de la necesidad semanal en régimen (última semana, ya sin el ruido del desorden) — una decisión de catálogo (cuánto y para cuáles), no un evento del guion, así que vive en `scripts/seed-demo-pizzeria-6-meses.ts`, no en `guion-la-cuadra.ts`. `MP_POR_PROVEEDOR` pasa a exportarse desde `guion-la-cuadra.ts` para reusarlo ahí.
  - `scripts/verificar-demo-invariantes.ts` + `vitest.demo-invariantes.config.ts` (nuevos): 10 conciliaciones de dominio — comparan al sistema CONTRA SÍ MISMO (dos reportes independientes del mismo dato, o un reporte contra una consulta cruda a Postgres), a diferencia de `calcularTotalesEsperados` (que compara el guion PURO contra la base, ya verificado a mano en el Tramo 3). De solo lectura: la config solo pasa por `resolverUrlDelSeed` (host local + sufijo `_demo`), sin pedir confirmación (no escribe nada).
    1. Compras: total del reporte de Período = suma "por proveedor" (mismo reporte).
    2. Compras: total del reporte de Período = consulta cruda a Postgres (excluyendo anuladas).
    3. Ventas: total del reporte de Período = suma "por producto" (mismo reporte).
    4. Ventas: total del reporte de Período = total de Ventas por categoría (dos reportes independientes).
    5. Una compra anulada no suma al total.
    6. Stock consolidado (teórico) = Valuación (saldo) por producto — dos reportes independientes del mismo saldo.
    7. Alertas de stock: cada alerta tiene un mínimo REALMENTE configurado, y su estado (CRÍTICO/BAJO) coincide con saldo vs. mínimo — no se exige que haya alertas (con el colchón de compra del 112 %, el saldo real casi nunca baja del mínimo heurístico; cero alertas cumple la conciliación igual).
    8. PV030 ("se produce"): saldo real positivo en stock consolidado.
    9. Margen Real: hay ingreso RECONSTRUIDO (las ventas de PV020 sin costo congelado al vender, del tramo de desorden) y es menor que el ingreso costeado total; nada queda sin poder costear "para siempre" (`ingresoSinCostoReal = 0`).
    10. Contención: el facturado de 30 días no puede superar el de los 6 meses completos.
  - **2 bugs reales encontrados al escribir las invariantes, ninguno en la aplicación** (los dos eran del propio script de verificación, no del ejecutor ni de un reporte real): la ventana de fechas (`DESDE`) heredaba la hora 23:59:59.999 de `HASTA` por derivarse DESPUÉS de fijársela, así que una consulta cruda (que no pasa por la normalización `rangoUtc` de los reportes) arrancaba casi un día tarde; y la conciliación #9 asumía que las ventas sin costo congelado quedaban `ingresoSinCostoReal` — en realidad, como PV020 ya tiene receta al momento del reporte, se RECONSTRUYEN con éxito (`ingresoRealReconstruido`), que es el campo correcto a verificar.
  - Mutación de dos invariantes representativas para confirmar que detectan divergencia real (no solo que pasan): #6 (sumar +1 al teórico de `calcularStockConsolidado`) y #4 (sumar +100 al total de `generarReporteVentasPorCategoria`) — las dos se pusieron en rojo, se revirtieron, y volvieron a verde.
  - Verificación: Vitest 118 archivos/1147 tests (sin cambio — el ejecutor y las invariantes no son parte de `npm test`); axe 19, Playwright 212 y build sin cambios de número — más la corrida real de ambos scripts contra `motor2_demo` (10/10 invariantes en verde) descripta arriba.
- **Tramo 5 — HECHO (2026-09-22, local sin push): proyecto Playwright propio con axe sobre TODAS las pantallas, corrido contra los datos reales de 6 meses — encontró 4 bugs reales de accesibilidad que ningún otro chequeo había atrapado nunca.**
  - `playwright.demo.config.ts` + `test/e2e-demo/` (nuevos): puerto propio (3102), corre contra `motor2_demo` con las mismas guardas que el seed (`resolverUrlDelSeed`) — a diferencia de `test/e2e/` (que VACÍA la base antes y después de cada corrida), `test/e2e-demo/global-setup-demo.ts` NUNCA toca los datos: solo verifica que "La Cuadra" ya esté sembrada. `test/e2e-demo/fixtures/auth-demo.ts` inicia sesión como el admin REAL de la demo (`alepogabriel@gmail.com`), sin crear ni modificar catálogo.
  - `test/e2e/rutas-sin-parametros.ts` (nuevo): la lista de las 49 pantallas sin parámetros, extraída de `maquetacion-general.spec.ts` para compartirla con `test/e2e-demo/todas-las-pantallas.spec.ts` (nuevo) — un solo lugar para agregar una pantalla nueva.
  - **Por qué encontró cosas que 19 chequeos de axe + 94 de maquetación no habían visto**: la carga de datos real (cientos de filas, un usuario con 2+ sucursales, columnas de "acción" con contenido de verdad) expone casos que un dato mínimo sintético no llega a armar. Los 4 hallazgos, todos corregidos y con test de regresión (mutados para confirmar que detectan la vuelta atrás):
    1. **`<SelectorSucursal>` sin nombre accesible** (`src/components/selector-sucursal.tsx`) — un `<select>` sin `aria-label`; invisible en TODA la app hasta ahora porque solo se dibuja con `membresias.length > 1` (`app-shell.tsx`), y ningún usuario de prueba había tenido nunca 2+ sucursales. Arreglado con `aria-label="Sucursal activa"`.
    2. **El input de renombrar sucursal** (`administracion/sucursales/page.tsx`) y **el `<select>` de rol** (`administracion/usuarios/usuarios-tabla.tsx`) sin nombre accesible — ninguna de las dos pantallas tenía chequeo de axe hasta ahora (no por ser difíciles, simplemente nunca se habían sumado a la lista cubierta).
    3. **Columna "acción" con `<th>` vacío** (`src/components/tabla-reporte.tsx`, usado por `reportes/consignacion`, `reportes/perdidas`, `reportes/trazabilidad`) — el guardián estático (`test/arquitectura/encabezados-de-tabla.test.ts`) no lo detecta porque la fuente SÍ tiene contenido (`{c.etiqueta}`); la vaciedad es de runtime (`etiqueta: ""`), no del JSX. Arreglado con un fallback `<span className="sr-only">Acciones</span>` en el componente compartido — corrige las 3 pantallas de una vez.
    4. **`text-neutral-400` con 2,58:1 de contraste** (`src/core/stock/estado-consolidado-ui.ts`, estado `SIN_MOVIMIENTOS` de `/stock/consolidado` y `/reportes/salud`) — muy por debajo del 4,5:1 que pide WCAG AA para texto normal; ninguna de las dos pantallas tenía chequeo de axe hasta ahora. Arreglado usando `text-neutral-500` (el tono ya usado en el resto de la app para texto apagado, que sí pasa).
  - Tests de regresión nuevos en `test/e2e/accesibilidad.spec.ts`: uno para el selector de sucursal (con un usuario de 2+ sucursales) y otro para `administracion/sucursales`/`administracion/usuarios` — mutados uno por uno. El arreglo de `tabla-reporte.tsx` y de `estado-consolidado-ui.ts` queda cubierto por el barrido de la demo en sí (que ahora es un guardián de regresión permanente y reusable para exactamente este tipo de hallazgo "solo aparece con datos reales") — no se agregó una siembra sintética mínima aparte para esos dos, a propósito.
  - `vitest.config.ts`: hubo que sumar `test/e2e-demo/**` a los `exclude` (mismo motivo que `test/e2e/**` — si no, Vitest intenta correr los specs de Playwright como si fueran suyos).
  - **Corrida real verificada**: 47/47 pantallas sin error ni violaciones de axe contra `motor2_demo`, sin tocar sus datos.
  - Verificación: Vitest 118 archivos/1147 tests (sin cambio); axe+maquetación 115 (antes 113, +2 tests nuevos); Playwright 214 (antes 212, +2); build sin cambios — más el barrido de la demo (47/47) y el proyecto normal de maquetación (94, sin cambios de comportamiento tras extraer la lista de rutas a un módulo compartido).

## 6. Orden sugerido de implementación

1. **Rendimiento real, el arreglo urgente — HECHO (2026-09-21, commit `74a14ab`, local sin push).** El link "Usar este valor" pide siempre una confirmación explícita, con el porqué a la vista (comprado, vendido, semanas de datos, confianza), en vez de aplicar el valor directo — nunca se oculta, incluso con datos confiables. El mismo contexto viaja hasta el editor de recetas. Sin migración; verificación completa en una misma corrida (Vitest, axe nuevo para esta pantalla, Playwright, `tsc`, lint, build). **No incluye** el resto de la Variante 1 (banda de ruido, `motivoSinEstimacion`, teórico con merma, `PRODUCCION` como entrada): eso sigue pendiente, en §3.
2. **Selector de rango (§1) — HECHO (2026-09-22).** + **Período y márgenes (§2) — HECHO (2026-09-22).** La decisión 4 de §2 (corregir el denominador del margen nominal) quedó explícitamente sin aplicar, según lo previsto en el plan.
3. **Seed de la demo (§5)**, con el guion de 6 meses de §0 — Tramos 1-5 HECHOS (2026-09-22): guion + ejecutor + stock mínimo + 12 invariantes de dominio + proyecto Playwright propio (47/47 pantallas, encontró y corrigió 4 bugs reales de accesibilidad), corridos y verificados contra Postgres local (`motor2_demo`). **Pendiente**: escenarios adicionales (segunda sucursal/traspasos/rol operador/consignación — decisión de alcance sin tomar: ¿le suman algo al pitch de venta de §0, o son solo cobertura técnica de otras partes de la app?), runbook documentado, y recién con autorización expresa la re-inserción real en Neon.
4. **Historial por producto (§4)**, que se apoya en los datos nuevos del seed.
5. **Rendimiento real, Variante 3 (§3)**, solo si se decide adoptar conteos físicos periódicos.

## 7. Decisiones que más destraban (resumen)

| Decisión | Dónde | Recomendación |
|---|---|---|
| ¿Cuál es el margen "principal" de Período? | §2 | El Real |
| ¿Rendimiento real es calibrador o medidor de pérdidas? | §3 | A definir; condiciona toda la Variante 3 |
| ¿Se adoptan conteos físicos periódicos? | §3, §5 | Necesario para la Variante 3 y para que el seed tenga casos con ancla |
| ¿Quién ve precios y proveedor en el Historial? | §4 | Condicionar a `ver_reportes_dinero`, sin migración |
| ¿Cómo se recuerda regenerar la demo cada 2 meses? | §0 | A definir: recordatorio de calendario o solo queda anotado acá |

## 8. Reglas comunes verificadas por los cuatro agentes

- **Ninguno de los cuatro planes requiere migración de schema.**
- **El guardián de arquitectura** (`test/arquitectura/reportes-compras-anuladas.test.ts`) exige que toda mención a `"COMPRA"`/`"VENTA"` en `src/core/reportes/` decida qué hace con las anuladas: cualquier consulta nueva de estos planes tiene que respetarlo, con la excepción documentada de los saldos de stock (que no deben excluir anuladas, porque la anulación ya es su propio contra-asiento).
- **Verificación final común**, en la misma corrida y en este orden: línea de base (`npm test` + `npx playwright test --list`, anotando los conteos reales) → `npx tsc --noEmit` → `npm run lint` → `npm test` → `npx playwright test test/e2e/accesibilidad.spec.ts` (con un chequeo axe por cada pantalla o estado nuevo) → `npm run build` (con `DATABASE_URL` a una base local descartable, nunca Neon) → `npm run test:e2e` (servidor en modo `build`). Aislamiento E2E confirmado: `global-setup`/`global-teardown` vacían y siembran la base `_e2e` en cada corrida; ningún spec depende del modo dev.
