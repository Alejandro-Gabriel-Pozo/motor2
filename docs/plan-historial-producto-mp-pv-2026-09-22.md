# Plan de implementación — §4 "Historial por producto y 'líneas' en Compras registradas"

Diseñado por un agente de planificación (Opus), a partir de las 9 decisiones ya
resueltas de §4 (`docs/planes-demo-y-claridad-reportes-2026-09-21.md`) y el
grounding externo (`docs/grounding-historial-producto-mp-pv-2026-09-22.md`).
**No implementado todavía** — es el plan, verificado contra el código real.

La décima decisión (rango del Kardex) se resolvió después de este plan: **un
solo rango + opción explícita "Todo el historial"** (ver §0 del plan, abajo).

---

## 0. Verificación de premisas contra el código real

### Lo que se confirma tal cual está documentado

| Premisa | Estado | Evidencia |
|---|---|---|
| El saldo sale por 3 caños | ✅ Confirmado | `src/app/(app)/reportes/historial/page.tsx:50` (encabezado), `grafico-saldo.tsx:36` (`<Line type="stepAfter" dataKey="saldo">`), `tabla-historial.tsx:18-24` (columna "Saldo corriente") |
| `tieneStockReal` existe y `historial-producto.ts` es el único que no lo usa | ✅ Confirmado | `src/core/movimientos/transiciones.ts:95-97`; grep de `tieneStockReal` sobre `src/core/reportes/` no lo trae; `obtenerHistorialProducto` solo lee `tipo` y `unidadStock` (`historial-producto.ts:81`) |
| `idOperacion` se calcula y la UI lo descarta | ✅ Confirmado | `historial-producto.ts:38,132` lo devuelve; `tabla-historial.tsx` tiene 6 columnas y ninguna es Origen |
| `proveedorNombre`/`nroFactura`/`loteVencimiento` también se descartan | ✅ Confirmado | `historial-producto.ts:128-131` |
| `/reportes/trazabilidad?idOperacion=` existe y funciona | ✅ Confirmado | `trazabilidad/page.tsx:7,15` → `obtenerOperacionPorId` (`core/reportes/trazabilidad.ts:36`), acotado por `sucursalId` |
| `/reportes/compras` **todavía** dice "línea(s)" | ✅ Confirmado | `compras/page.tsx:124` (`{c.lineas.length} línea(s)`) y `:137` (`· hay líneas sin precio`) |
| §2 ya hizo el cambio en `/reportes/periodo` (código SEPARADO) | ✅ Confirmado | `core/reportes/periodo.ts:365-368` (`cantidadProductos` / `cantidadCompras`); `/reportes/compras` usa `core/reportes/compras-registradas.ts`, otro archivo, intocado |
| La venta escribe VENTA + CONSUMO bajo el mismo `operacionId` | ✅ Confirmado | `server/actions/movimientos/venta.ts:186-231` — ojo: es **una `Operacion` por producto vendido**, no una por lote de venta |
| Nada de esto necesita migración de Prisma | ✅ Confirmado | `seProduce` (schema:297), `precioTotal`/`precioPorUnidadStock` (schema:886-890), `operacionId` (schema:859), `Operacion.anuladaEn`, `RecetaVersion`/`RecetaIngrediente` (schema:484+) ya existen |

### Tres hallazgos que CORRIGEN lo documentado (leer antes de implementar)

**(a) La analogía de permisos de §4 es inexacta, aunque la conclusión sigue siendo válida.**
§4 (línea 142) y el prompt dicen "condicionar solo las columnas de dinero a `ver_reportes_dinero` — mismo patrón que ya usa `/reportes/compras`". En el código real, **`/reportes/compras` gatea la PANTALLA ENTERA con `ver_reportes_dinero`** (`compras/page.tsx:27`); lo que condiciona con `obtenerMiNivelPermiso` son los **botones de acción** (`anular_compra`, `corregir_compra`, líneas 30-33), no columnas de dinero. **No existe hoy en el proyecto ningún precedente de "columna de dinero condicionada dentro de una pantalla operativa"** — `/reportes/historial` sería el primero. El mecanismo (`obtenerMiNivelPermiso(...).ver`, `core/permisos/gate.ts:103-117`) sí existe y es el correcto; lo que no existe es el precedente. Consecuencia práctica: no hay un patrón que copiar línea por línea, y **hace falta un test E2E nuevo** para el caso "rol con `ver_reportes_operativos` pero sin `ver_reportes_dinero`" (el spec actual `test/e2e/reportes-permisos.spec.ts` apaga los dos permisos a la vez, así que ese caso hoy no está cubierto por nadie).

**(b) El cambio "líneas"→"productos" choca con un guardián de arquitectura que hay que tocar en el mismo commit.**
`test/arquitectura/periodo-sin-lineas.test.ts:10-12` declara **explícitamente**: *"`/reportes/compras` todavía dice 'N línea(s)' a propósito, ese arreglo es de §4"*. O sea: el paso de terminología tiene que **extender `ARCHIVOS`** (línea 14-17) con `src/app/(app)/reportes/compras` y reescribir ese docstring. Y hay una trampa: el regex `PALABRA_LINEA = /\bl[ií]nea(s)?\b/i` corre sobre el **código fuente sin comentarios**, así que `c.lineas.length` y `c.lineas.map(...)` **matchean** (el punto antes de `lineas` es borde de palabra). Por eso el paso obliga a renombrar el campo del tipo, no solo el texto visible: `CompraRegistrada.lineas` → `renglones` y `hayLineasSinPrecio` → `haySinPrecio` en `core/reportes/compras-registradas.ts:27,49,53,103,122-126`. Blast radius real (verificado con grep): solo `compras-registradas.ts`, `compras/page.tsx` y `test/reportes/compras-registradas.test.ts:59,60,96`. (`core/compras/anulacion.ts` usa `LineaComprada`, otro tipo, no se toca.)

**(c) Filtrar el Kardex en SQL rompería el saldo corriente.**
El filtro "Qué mostrar" **no puede** ir al `where` de `movimientoStock.findMany` (`historial-producto.ts:113-116`): el saldo corriente se acumula recorriendo *todos* los eventos del rango (`:152-157`). Si se filtran los CONSUMO en la consulta, "Solo compras" mostraría un saldo inventado. Tiene que ser un filtro de **presentación**, aplicado después de calcular el saldo. Esto no está dicho en §4 ni en el grounding y es el error más fácil de cometer.

### Un punto de diseño que §4 dejaba abierto — YA RESUELTO (2026-09-22)

Decisión 5 dice "rango por defecto **de las vistas nuevas**: últimos 90 días", pero la pantalla tiene **un solo rango** que alimenta una sola consulta (`obtenerHistorialProducto`), del que salen las tres superficies. **Decidido: un solo rango para toda la pantalla, con default 90 días y una opción explícita "Todo el historial"** (el comportamiento de hoy: `desde`/`hasta` vacíos). El `<details>` del Kardex rotula el rango vigente.

Verificado que no rompe nada existente: `test/e2e/catalogo-ficha-producto.spec.ts:40` solo comprueba que el enlace exista, y `test/reportes/historial-producto.test.ts` llama a la función del core directo. **Condición de diseño:** el default de 90 días se resuelve en `page.tsx`, **nunca** dentro de `obtenerHistorialProducto` (cuyo contrato "undefined = todo" está testeado en 4 tests de regresión del Plan R2 y hay que dejarlo intacto).

---

## 1. Diseño

### 1.1 Capa de datos — `src/core/reportes/historial-producto.ts` (una sola consulta, sin duplicar queries)

Toda la información que necesitan las dos vistas nuevas ya viaja en el `findMany` de la línea 113-116; solo hay que **dejar de tirarla**. No se agrega ninguna consulta al camino normal.

`EventoHistorialProducto` (`:28-46`) suma cuatro campos, todos ya cargados o baratísimos:
- `precioTotal?: number` y `precioPorUnidadStock?: number` — de `m.precioTotal` / `m.precioPorUnidadStock`. **`precioPorUnidadStock` es el campo correcto para la variación de precio**, no `precioTotal`: su docstring (schema:887-890) dice justamente que existe "para comparar compras en presentaciones distintas del mismo producto".
- `anulada: boolean` — de `m.operacion.anuladaEn !== null`. Requiere agregar `anuladaEn` al `include` de `operacion` (hoy trae `{ include: { proveedor: true } }`, que ya devuelve el objeto entero, así que probablemente no haya ni que tocar el include — verificar).
- `procesoOperacion?: string` — `m.operacion.proceso`, para que la columna Origen pueda decir "Compra"/"Venta"/"Ajuste" en vez de un cuid.

`HistorialProducto` (`:48-58`) suma:
- `tieneStockPropio: boolean` = `tieneStockReal(producto.tipo, producto.seProduce)`. Esto cierra la asimetría de §1.3 del grounding: la pantalla pasa a consultar el mismo predicado que las otras 6 superficies.

Función nueva y separada, llamada **solo** cuando `tipo === "PV" && !tieneStockPropio`:
```
obtenerIngredientesRecetaVigente(productoId, db): Promise<{ nombre: string; cantidad: number; unidad: string }[]>
```
`recetaVersion.findFirst({ where: { productoId }, orderBy: { version: "desc" }, include: { ingredientes: { include: { insumoProducto, unidad } } } })` — el mismo `MAX(version)` derivado que usan `venta.ts:79`, `movimientos.ts:95` y `comun.ts:106`.
⚠️ **No reusar `obtenerRecetaVigente` de `server/actions/catalogo/recetas.ts:61`**: llama a `requerirVer("guardar_receta")` y le negaría la pantalla a un usuario con `ver_reportes_operativos`.

### 1.2 Lógica pura — dos archivos nuevos, sin Prisma, 100 % testeables

**`src/core/estadistica/mediana.ts`** (junto a `minimos-cuadrados.ts`, que ya establece esa carpeta como el hogar de lo estadístico puro):
```
mediana(valores: number[]): number | null   // null con lista vacía; promedio de los dos centrales si es par
```

**`src/core/reportes/historial-vistas.ts`** — todo puro, entra `EventoHistorialProducto[]`, sale un view-model:

- `type QueMostrar = "todo" | "compras" | "consumos-ventas" | "ajustes-conteos"`
- `const GRUPO_POR_PROCESO: Record<Proceso, QueMostrar…>` — **exhaustivo sobre el enum de Prisma**, mismo criterio que `TRANSICIONES` (`transiciones.ts:54`): si mañana se agrega un `Proceso`, el compilador obliga a clasificarlo en vez de dejarlo caer en silencio fuera de todos los filtros. Los eventos `tipo === "conteo"` van a `"ajustes-conteos"`.
- `filtrarEventosKardex(eventos, queMostrar)` — filtro de **presentación**, se aplica *después* de que `obtenerHistorialProducto` calculó `saldoCorriente` (ver hallazgo (c)).
- `resumirCompras(eventos)` → `{ filas, cantidadCompras, medianaCantidad, comprasPorSemana, precioMin, precioMax, proveedores: string[] }`, donde cada `fila` es `{ fecha, proveedor, nroFactura, cantidad, precioPorUnidadStock, variacionPct, idOperacion }`.
- `agruparVentasPorDia(eventos)` → `[{ dia: "YYYY-MM-DD", cantidad, importe, precioPromedio }]`, clave `fecha.toISOString().slice(0,10)` (mismo criterio UTC que `tabla-historial.tsx:7` y el resto del proyecto).
- `variacionPorcentual(actual, anterior): number | null`.

**Definiciones concretas de los 4 cómputos (para que no queden a interpretación del implementador):**
1. **Cantidad típica** = `mediana(compras.map(c => c.cantidad))` — decisión 1, "resiste el stock inicial".
2. **Frecuencia** = compras por semana = `cantidadCompras / (díasDelRango / 7)`, redondeado a 1 decimal — decisión 2 (no "días entre compras"). Si el rango es "Todo el historial", los días van de la primera a la última compra. Hay precedente de clave semanal en el proyecto (`rendimiento-recetas.ts:67-73`, `claveSemana`), pero acá **no** sirve: eso cuenta *semanas con datos*, no la tasa. Definición propia, documentada en el docstring.
3. **Variación de precio** = contra la compra **anterior** (decisión 3), sobre `precioPorUnidadStock`: `(actual - anterior) / anterior * 100`. **Casos borde que el test tiene que fijar:** `anterior === 0` (compra cargada sin precio, caso real y frecuente — ver `hayLineasSinPrecio` en `compras-registradas.ts:123`) ⇒ `null`, **no** `Infinity` ni `-100 %`; `actual === 0` ⇒ `null`; primera compra del rango ⇒ `null` con `—` en pantalla y la nota "es la primera compra del rango elegido" (no se va a buscar una compra anterior fuera del rango: sería una consulta extra para una celda; queda anotado como posible mejora futura).
4. **Ventas por día**: suma de `Math.abs(cantidad)` y de `precioTotal` por día; `precioPromedio = importe / cantidad` (null si cantidad 0).

⚠️ **`historial-vistas.ts` vive en `src/core/reportes/` y menciona `"COMPRA"`/`"VENTA"`, así que cae bajo el guardián `test/arquitectura/reportes-compras-anuladas.test.ts`**: cada línea con esos literales necesita una referencia a `anulad…` a ≤3 líneas antes / ≤8 después. Es exactamente lo que queremos: la forma correcta es `if (ev.proceso !== "COMPRA" || ev.anulada) continue;` (el guardián tiene un caso de prueba idéntico en su línea 102). **Decisión de negocio que esto fuerza y que conviene dejar escrita: las vistas nuevas EXCLUYEN las anuladas** (una factura anulada no ocurrió; mismo criterio que §2 y que `/reportes/compras`, que las muestra marcadas pero no las suma). El Kardex las sigue mostrando (append-only, es la superficie de auditoría).

### 1.3 Componentes de UI

Todos en `src/app/(app)/reportes/historial/`:

| Archivo | Tipo | Qué hace |
|---|---|---|
| `como-se-compro.tsx` (nuevo) | client | Prosa de resumen + `TablaReporte` de compras. Props: `resumen: ResumenCompras`, `unidad: string`, `mostrarDinero: boolean` |
| `como-se-vendio.tsx` (nuevo) | client | `TablaReporte` de ventas por día. Props: `filas`, `unidad`, `mostrarDinero` |
| `cartel-sin-stock-propio.tsx` (nuevo) | server | El cartel "Producto de reventa" (decisión 8) + lista de ingredientes + `EnlaceInterno` a la receta |
| `tabla-historial.tsx` | modificado | Columna "Origen"; marca "Anulada"; columna "Saldo corriente" condicional |
| `grafico-saldo.tsx` | sin cambios | Deja de renderizarse desde `page.tsx` cuando `!tieneStockPropio` (el componente sigue tonto) |
| `historial-filtros.tsx` | modificado | `<select>` "Qué mostrar" + control de rango |
| `page.tsx` | modificado | Orquesta: rango por defecto, permiso de dinero, orden de las secciones, `<details>` |

**Columnas de dinero (bajo `ver_reportes_dinero`):** en "Cómo se compró", `precioPorUnidadStock` y `variacionPct`; en "Cómo se vendió", `importe` y `precioPromedio`. Se construyen armando el **array de columnas condicionalmente** (`[...base, ...(mostrarDinero ? columnasDinero : [])]`). Beneficio lateral verificado: `TablaReporte` exporta a Excel solo las columnas que tienen `valor` y que están en el array (`tabla-reporte.tsx:80,85-87`), así que **el export no filtra precios** sin trabajo extra. La prosa del resumen ("entre $860 y $892") también se condiciona.

**Columna "Origen":** `<Link href={/reportes/trazabilidad?idOperacion=${encodeURIComponent(ev.idOperacion)}}>`. Verificado contra `test/arquitectura/enlaces-con-permiso.test.ts`: `accionDeRuta("/reportes/trazabilidad?...")` y la acción de la pantalla son **ambas `ver_reportes_operativos`** (el propio test lo afirma en sus líneas 42-43), así que un `<Link>` a secas es legal acá. El enlace a `/catalogo/recetas/${productoId}` del cartel, en cambio, va a `guardar_receta` ≠ `ver_reportes_operativos` ⇒ **obligatorio `EnlaceInterno`**, o el guardián falla. La columna Origen **no** lleva `valor` (es un link, la tabla la deja sin ordenar y fuera del Excel) — mismo criterio que la doc de `ColumnaReporte.valor` (`tabla-reporte.tsx:12`).

**Cartel "Producto de reventa" (decisiones 7, 8):** reemplaza al gráfico y **borra el número del encabezado** (`page.tsx:50` pasa a mostrar solo `{codigo} — {producto} (PV)`, sin "saldo actual"); en la tabla, la columna "Saldo corriente" **no se agrega al array** (no se pone "—": se saca la columna). Texto propuesto: *"Producto de reventa: no lleva stock propio. Se arma al venderse, consumiendo los ingredientes de su receta vigente."* + lista de ingredientes + enlace. La línea `VENTA` sigue apareciendo en el Kardex (decisión 9: se deja de MOSTRAR el saldo, no de escribir el movimiento).

**Orden final de `page.tsx`:** filtros → encabezado → (si PV sin stock) cartel / (si no) "Evolución del saldo" → "Cómo se compró" (MP) o "Cómo se vendió" (PV) → `<details>` "Movimiento por movimiento (auditoría)".

---

## 2. Pasos — chicos, reversibles, un commit cada uno

**Paso 0 — Línea de base (sin commit).** Correr los 6 comandos de §3 *antes de tocar nada* y **anotar los números** (cantidad de archivos y de tests en verde en Vitest, cantidad de specs y de casos en Playwright, warnings de build). Conteo estático de referencia tomado el 2026-09-22: **118 archivos `*.test.ts`**, ~**911** declaraciones `it(`/`test(`; **34 specs** de Playwright con ~**122** `test(`. Los números autoritativos son los de la corrida real, no estos.

**Paso 1 — Lógica pura + tests (sin tocar UI ni DB).**
Crea `src/core/estadistica/mediana.ts` y `src/core/reportes/historial-vistas.ts`; tests `test/estadistica/mediana.test.ts` y `test/reportes/historial-vistas.test.ts` (sin `limpiarBaseDeTest`, sin Prisma: son puros, corren en milisegundos). Casos obligatorios: mediana par/impar/vacía; Δ precio con `anterior = 0`, con la primera compra, subida y bajada; agrupación por día con dos ventas el mismo día y una venta anulada (excluida); `filtrarEventosKardex` preservando `saldoCorriente` ya calculado; exhaustividad de `GRUPO_POR_PROCESO` sobre el enum.
**Demostración de mutación (sobre el cómputo con precedente externo):** en `variacionPorcentual`, cambiar `(actual - anterior) / anterior` por `(actual - anterior) / actual` y `npm test test/reportes/historial-vistas.test.ts` → debe quedar **rojo** con un mensaje que nombre el caso; revertir → **verde**. Segunda mutación recomendada: sacar la guarda `anterior === 0 ⇒ null` → debe dar rojo por `Infinity`.

**Paso 2 — Capa de datos.** Extiende `EventoHistorialProducto`/`HistorialProducto` y agrega `obtenerIngredientesRecetaVigente`. Tests nuevos en `test/reportes/historial-producto.test.ts` (Postgres real, ya tiene el andamiaje `limpiarBaseDeTest`/`sembrarBase`/`mockearUsuarioActual`): que `precioPorUnidadStock` llegue desde una COMPRA real; que `anulada` sea `true` en la compra original después de `anularCompra` y que el contra-asiento AJUSTE aparezca como fila propia; que `tieneStockPropio` sea `false` para un PV con `seProduce: false` y `true` para una MP. **Nada visible cambia todavía.** Los 5 tests existentes de este archivo deben seguir verdes sin tocarlos (es el chequeo de que no se rompió el contrato del rango).

**Paso 3 — Filtro "Qué mostrar".** Param `queMostrar` en `searchParams`, `<select>` en `historial-filtros.tsx` (con `<label htmlFor>` **al lado** del control, no envolviéndolo — motivo documentado en `selector-rango.tsx:15-16`: un label que envuelve un `<select>` rompe `getByLabel`), y `filtrarEventosKardex` aplicado en `page.tsx` antes de pasar `filas` a la tabla.

**Paso 4 — Columna "Origen" + marca "Anulada"** en `tabla-historial.tsx`.

**Paso 5 — Cartel del PV sin stock propio + supresión del saldo en los 3 lugares** (encabezado, gráfico, columna). Test de datos: un PV `seProduce: false` con ventas ⇒ `tieneStockPropio === false`; test E2E en el paso 11 de que la pantalla no dibuja "saldo actual" ni la columna.

**Paso 6 — "líneas" → "productos" en `/reportes/compras`.** Renombres en `core/reportes/compras-registradas.ts` (`LineaCompra`→`RenglonCompra`, `lineas`→`renglones`, `hayLineasSinPrecio`→`haySinPrecio`), campo nuevo `cantidadProductos` = `new Set(renglones.map(r => r.productoId)).size` (⇒ agregar `productoId` a `RenglonCompra`), textos de `compras/page.tsx:124,136-137`, y **extender `ARCHIVOS` en `test/arquitectura/periodo-sin-lineas.test.ts:14-17`** con `src/app/(app)/reportes/compras`, reescribiendo su docstring (que hoy dice que esto es deuda de §4). Ajustar `test/reportes/compras-registradas.test.ts:59,60,96`.
**Riesgo señalado en §4 — coordinación del rótulo con §2:** §2 ya fijó el vocabulario en `/reportes/periodo`: columna **"Productos"**, con la ayuda *"Productos DISTINTOS comprados a este proveedor en el rango — dos renglones del mismo producto en una misma factura cuentan una sola vez"* (`reportes/periodo/tabla-periodo.tsx:57-62`). **Usar literalmente esa misma palabra y esa misma explicación** en `/reportes/compras`: `{c.cantidadProductos} producto(s)` con el mismo texto de ayuda adaptado ("…en esta factura…"). Y `· hay líneas sin precio` → `· hay productos sin precio`.

**Paso 7 — Cableado de permisos, ANTES de la primera columna de dinero.** `page.tsx` calcula `const { ver: mostrarDinero } = await obtenerMiNivelPermiso(ctx.usuarioId, ctx.sucursalId, "ver_reportes_dinero")` y lo pasa por props. **Desviación deliberada del orden "natural"** (poner permisos después de las vistas dejaría un commit intermedio que le muestra precios a un rol sin `ver_reportes_dinero`). Poner el cableado antes cuesta lo mismo y ningún commit de la serie queda inseguro.

**Paso 8 — Vista "Cómo se compró" (MP)** — `como-se-compro.tsx`, consumiendo `resumirCompras` (paso 1) y `mostrarDinero` (paso 7).

**Paso 9 — Vista "Cómo se vendió" (PV)** — `como-se-vendio.tsx` + `agruparVentasPorDia`. Tope de filas (§4 lo pide): con el default de 90 días son ≤90 filas; para "Todo el historial", cortar en 180 días y avisar *"Se muestran los últimos 180 días con ventas"*.

**Paso 10 — UI final: reordenamiento + `<details>` + rango 90 días por defecto (con "Todo el historial" explícito).** El Kardex pasa a `<details><summary>Movimiento por movimiento (auditoría)</summary>`. **No extender `OpcionRango`/`SelectorRango` de `core/reportes/rango-por-defecto.ts`**: esa unión (`"30d" | "mes" | "personalizado"`) y `ETIQUETA_RANGO` (`Record<"30d"|"mes", string>`) los comparten 5 pantallas de §1 y agregar `"90d"` obliga a tocarlas todas. `/reportes/historial` tiene su propio formulario cliente (`historial-filtros.tsx`, con el combobox de producto), así que le corresponde su propio resolutor chico — reusando `hoyUtcSinHora` si se exporta, o replicando las 3 líneas con un comentario que apunte al archivo compartido.

**Paso 11 — E2E + accesibilidad.**
- Spec nuevo `test/e2e/historial-producto-vistas.spec.ts`: (1) MP con 3 compras → "Cómo se compró" con la mediana y el Δ de precio; (2) PV `seProduce: false` con ventas → cartel "Producto de reventa", **sin** "saldo actual" en el encabezado y **sin** columna "Saldo corriente"; (3) filtro "Solo compras" reduce las filas y **el saldo corriente de las filas que quedan no cambia** (la regresión del hallazgo (c)); (4) la columna Origen navega a `/reportes/trazabilidad` y muestra la operación.
- Spec de permisos: rol con `ver_reportes_operativos: true` + `ver_reportes_dinero: false` ⇒ entra a la pantalla, ve "Cómo se compró", **no** ve precio/importe/variación. Reusar el helper `paginaComoOperador` de `test/e2e/reportes-permisos.spec.ts:13-35` (hay que dejarlo con `ver_reportes_operativos` en `true`, hoy lo apaga en el bucle de la línea 24).
- **Axe: sí, esta pantalla necesita su propio chequeo.** El docstring de `test/e2e/accesibilidad.spec.ts:10-13` declara que la cobertura **no es exhaustiva** y que se suma una pantalla "cuando aparece una necesidad concreta". Acá hay cuatro necesidades concretas que ninguna pantalla cubierta ejercita: (i) texto de color para la variación de precio — decisión de §4: **texto además de color**, y el guardián estático `test/arquitectura/contraste-de-color.test.ts` exige `text-amber-700 dark:text-amber-600` / `text-neutral-500 dark:text-neutral-400`, pero el contraste **renderizado** solo lo ve axe; (ii) el `<details>/<summary>` del Kardex; (iii) el `<select>` "Qué mostrar" y su nombre accesible; (iv) tablas nuevas con encabezados (regla `empty-table-header`, ver `tabla-reporte.tsx:134-139`). Agregar un caso `testAutenticado("reportes/historial: …")` a `accesibilidad.spec.ts` que **siembre** el PV sin stock + la MP con compras (si no, axe no ve el cartel ni el ámbar) y asserte `expect(resultados.violations).toEqual([])`.
- Verificar además que `/reportes/historial` sigue verde en `test/e2e/maquetacion-general.spec.ts` (barre `RUTAS_SIN_PARAMETROS`, que ya la incluye) a 1024 y 1280 px: las tablas nuevas son anchas y ese spec caza desbordes horizontales.

**Paso 12 — Verificación end-to-end total (§3).**

### Prisma: ningún paso toca el schema
Confirmado campo por campo contra `prisma/schema.prisma`. Todo lo pedido es **lectura y presentación sobre datos que ya existen**. **No hay ningún paso que requiera migración**, y por lo tanto no hay nada en este plan que necesite "autorización expresa" para el schema. Si durante la implementación aparece la tentación de una migración, es señal de que se desvió del plan: parar y consultar.

---

## 3. Paso final OBLIGATORIO — verificación sobre la suite TOTAL

| Capa | Comando | Criterio de éxito |
|---|---|---|
| Tipos | `npx tsc --noEmit` | Salida vacía (único ruido preexistente aceptable: `LayoutProps` de `layout.tsx`) |
| Lint | `npm run lint` | 0 errores, 0 warnings |
| Unitaria/integración | `npm test` (Vitest contra Postgres real, suite ENTERA) | Todos los archivos en verde; conteo de tests ≥ línea de base |
| Accesibilidad | `npx playwright test test/e2e/accesibilidad.spec.ts` | `violations` vacío en cada página cubierta — **incluida la página nueva de `/reportes/historial`**, que este plan agrega en el paso 11 (no se asume que las páginas ya cubiertas alcanzan; ver la justificación de las 4 necesidades concretas) |
| Build | `npm run build` (aplica migraciones — apuntar a una base local/descartable, NUNCA a producción) | Build exitoso, sin warnings nuevos |
| E2E | `npm run test:e2e` (Playwright, suite ENTERA) | Todos los specs en verde; conteo de specs ≥ línea de base |

**Criterio de cierre conjunto:** el pendiente se considera terminado **solo cuando los 6 comandos pasan limpios en la MISMA corrida final**, de punta a punta, en ese orden. Que cada uno haya pasado alguna vez por separado, en commits distintos, **no cuenta**.

**Advertencia operativa sobre `npm run build`:** el script es `prisma generate && prisma migrate deploy && next build` — `migrate deploy` **escribe en la base a la que apunte `DATABASE_URL`**. Apuntarlo a la base local/descartable antes de correrlo. Los E2E usan su propia base (`MOTOR2_E2E_DATABASE_URL`, nombre terminado en `_e2e`, validada por `resolverUrlE2E`), así que ese comando es seguro por construcción.

**Áreas a mirar con atención especial en la corrida final:**
- Vitest: `test/reportes/historial-producto.test.ts` (los 4 tests de regresión del Plan R2 sobre el rango son el canario de que no se movió el contrato del core), `test/reportes/compras-registradas.test.ts`, `test/reportes/compras-anuladas.test.ts`, `test/reportes/trazabilidad.test.ts`, `test/reportes/periodo.test.ts`.
- Guardianes de arquitectura (los 4 que este plan toca o roza): `test/arquitectura/periodo-sin-lineas.test.ts` (se modifica en el paso 6), `test/arquitectura/reportes-compras-anuladas.test.ts` (lo dispara `historial-vistas.ts`), `test/arquitectura/enlaces-con-permiso.test.ts` (Origen y el enlace a la receta), `test/arquitectura/contraste-de-color.test.ts` y `test/arquitectura/encabezados-de-tabla.test.ts` (UI nueva).
- Playwright: `historial-producto-vistas.spec.ts` (nuevo), `reportes-permisos.spec.ts` (se le agrega el caso `ver_reportes_dinero` apagado con `ver_reportes_operativos` encendido), `compras-registradas.spec.ts`, `compras-anular.spec.ts`, `compras-corregir.spec.ts` (los tres pueden romperse por el renombre `lineas`→`renglones` o por el texto "línea(s)"), `accesibilidad.spec.ts`, `maquetacion-general.spec.ts` y `test/e2e-demo/todas-las-pantallas.spec.ts` (los dos barren `/reportes/historial`).
- **Prueba de que el test nuevo detecta lo que dice detectar** (paso 1): dejar registrada la mutación de `variacionPorcentual` (`/ anterior` → `/ actual`) con su salida en rojo, la reversión, y el verde posterior. Es el cómputo con precedente externo (Grocy `Last price`/`Price history`, ERPNext `rate` por línea — grounding §7 ajuste 3) y el más citado del grounding.

---

## 4. Notas para quien implemente

1. La frase de §4 sobre permisos está mal atribuida: `/reportes/compras` **no** condiciona columnas de dinero, gatea la pantalla entera. La decisión sigue siendo implementable y correcta, pero **es un patrón nuevo en el proyecto**, no una copia.
2. El cambio "líneas"→"productos" arrastra un renombre de campo en `compras-registradas.ts` y una edición del guardián `periodo-sin-lineas.test.ts`, que hoy declara esa deuda como "de §4" — está previsto, no es un desvío.
3. El rango por defecto de 90 días, en la práctica, **también cambia el Kardex** (hoy abre mostrando todo) — resuelto: un solo rango + opción explícita "Todo el historial" (ver §0).

### Archivos críticos para la implementación
- `src/core/reportes/historial-producto.ts`
- `src/app/(app)/reportes/historial/page.tsx`
- `src/app/(app)/reportes/historial/tabla-historial.tsx`
- `src/core/reportes/compras-registradas.ts`
- `test/arquitectura/periodo-sin-lineas.test.ts`
