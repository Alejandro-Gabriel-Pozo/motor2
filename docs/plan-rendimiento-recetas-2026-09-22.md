# Plan de implementación — §3 "Rendimiento real de recetas: el +14,3 % y el botón peligroso"

Diseñado por un agente de planificación (Opus), a partir de las 5 decisiones ya
resueltas de §3 (`docs/planes-demo-y-claridad-reportes-2026-09-21.md`) y el
grounding externo (`docs/grounding-rendimiento-recetas-decisiones-2026-09-22.md`).

**P0-P11 IMPLEMENTADOS y cerrados (2026-09-22)** — un commit por paso
(`7b1e3ae`…`02aae25`). Verificación end-to-end final (§G), en una sola
corrida: `npx tsc --noEmit` limpio, `npm run lint` 0/0, `npm test` 1244/1244
(121 archivos, línea de base 1192), `npx playwright test
test/e2e/accesibilidad.spec.ts` sin violaciones, `npm run build` exitoso sin
migración nueva (contra `motor2_dev` local), `npm run test:e2e` 222/222
specs (línea de base 220). Demostración de mutación obligatoria hecha sobre
las 4 funciones citadas en §G (`impactoDelDesvio` signo invertido,
`compararPorImpacto` sin `Math.abs`, `bandaDeRuidoDeLote` promedio en vez de
mediana, `calcularCantidadEstimadaNeta` sin dividir por la merma) — las
cuatro pusieron tests en rojo por separado, revertidas, suite verde de
nuevo. Detalle de un bug real de bundling encontrado y corregido durante
P7 (importar un valor runtime de un módulo "vistas" puro que a su vez
importaba `@/lib/db` transitivamente rompía el build del cliente) en el
commit `1901c30`, aplicado preventivamente también a `historial-vistas.ts`
(§4).

Pendiente: **sub-plan S** (§E, conteo físico periódico) — autorizado por el
dueño, no implementado todavía en este documento.

---

## A. Correcciones a premisas de §3 / del grounding (verificadas contra el código)

Siete cosas que los documentos dan por ciertas y **no coinciden con el código de
hoy**. Ninguna invalida el plan, pero todas cambian algún detalle del alcance.

**A1. La pantalla YA tiene chequeo axe.** §3 dice «chequeo axe propio (hoy no
tiene ninguno)» y que el conteo de axe sube «de 16 a 17». Falso hoy:
`test/e2e/accesibilidad.spec.ts:395-427` ya cubre `/reportes/rendimiento-recetas`
en reposo y con la confirmación abierta — lo agregó el commit `74a14ab`.
**Consecuencia:** el paso de axe NO es "crear un caso nuevo", es **extender el
caso existente** con los estados nuevos (fila con rótulo, fila con
`motivoSinEstimacion`, banda de ruido a la vista). Y la línea de base de axe no
es 16 sino ~19-21 (subió con §2, §4 y §5 tramo 5).

**A2. El permiso del cruce (punto 10, verificado).** `/reportes/rendimiento-recetas`
se gatea con **`ver_reportes_dinero`** (`page.tsx:35`, y `estructura.ts:81`).
`/reportes/diferencias` y `/reportes/perdidas` se gatean con
**`ver_reportes_control`** (`diferencias/page.tsx:10`, `perdidas/page.tsx:11`,
`estructura.ts:84,87`). **Son permisos distintos en las dos direcciones → el
cruce va obligatoriamente con `EnlaceInterno`, nunca con `Link`**, y el guardián
`test/arquitectura/enlaces-con-permiso.test.ts:90-110` hace fallar el build de
tests si se usa `Link`. Efecto secundario correcto y deseado: un rol "solo
dinero" ve el texto sin enlace (`EnlaceInterno` degrada a `<span data-sin-permiso>`).

**A3. «Un insumo que es a su vez un PV con `seProduce: true`» no puede existir
por los caminos normales.** `venta.ts:82-84` rechaza cualquier ingrediente de
receta que no sea **MP activa** (`mp.tipo !== "MP"` → error), y `movimientos.ts`
hace lo mismo al producir. El dato declarado correcto es
**`insumoProducto.seProduce === true` sobre una MP** — que es justamente lo que
`Producto.seProduce` documenta en el schema: *"MP solo si seProduce=true (se
fabrica por lote, ej. una salsa base)"*. El rótulo visible debe ser
**"Sub-receta producida"**, derivado de `insumoProducto.seProduce`, no de
`tipo === "PV"`.

**A4. `tieneStockReal` NO sirve como discriminante acá.** `transiciones.ts:95-97`
es `tipo === "MP" || (tipo === "PV" && seProduce)`. Como todo ingrediente de
receta es MP, devuelve `true` **siempre** — no distingue ninguna de las tres
situaciones. El dato que realmente distingue es **`seProduce`** (del insumo,
para la sub-receta; del PV, para la reventa) más el grupo "No comestibles".
Corregido en el diseño de §B.

**A5. Pasar al teórico "neta + merma" cambia DOS cosas, no una — y una de ellas
es el botón que se acaba de blindar.** `RecetaIngrediente.cantidad` es la
cantidad **NETA**; lo que el Kardex descuenta es `cantidad × (1 + merma/100)`
(`venta.ts:85`, `movimientos.ts:100`, `costos.ts:63`).
`cantidadEstimada = totalComprado/totalVendido` es por construcción un número
**BRUTO**. Hoy se compara bruto contra neto (el defecto 3, correcto) **pero
además se escribe ese bruto en el campo neto** vía `?sugerido=` (`fila-simple.tsx:76`).
Si se arregla solo el denominador del %, toda línea con merma seguiría
proponiendo un valor inflado — un bug nuevo en el botón peligroso. **Hay que
introducir `cantidadEstimadaNeta` y usarla en `?sugerido=` y en el texto "vas a
pasar de X a Y".** Detalle exacto en §B3. Es el riesgo #9 de §F.

**A6. La Variante 3 NO hay que construirla: `/reportes/diferencias` grupo "b" ya
la cubre.** Confirmado leyendo `diferencias-ajustes.ts:76-118`: suma por MP los
movimientos `AJUSTE` **y `CONTROL`** (= el asiento que escribe un conteo físico),
excluyendo las Operaciones-AJUSTE que son reversión de anulación, y expone
`sumaConteosFisicos` + `ultimaFechaConteo` + `sugerenciaMerma` para el grupo "b"
(solo receta). Esa suma **es** la varianza real entre conteos: apenas haya
conteos regulares, la magnitud aparece sola, ya está en la tabla
(`tabla-diferencias.tsx:32`, columna "Suma conteos"). Lo único que falta de
verdad es el conteo periódico en sí (sub-plan S). **El grounding §3.4 tenía
razón — se confirma y no se construye ningún reporte nuevo.**

**A7. Las líneas de base de §3 están viejas.** §3 habla de "axe 16→17". Hoy,
tras §2/§4/§5: Vitest 120 archivos/1192 tests, Playwright 220 specs, axe ~19-21,
maquetación 94+. Igual hay que correr la corrida real antes de empezar (P0).

**A8. Riesgo de maquetación, no mencionado en ningún documento.**
`/reportes/rendimiento-recetas` está en `test/e2e/rutas-sin-parametros.ts:40`,
así que `maquetacion-general.spec.ts` la mide a 1024 y 1280 px y **falla si la
tabla desborda su caja o si la página gana scroll horizontal**. Las dos tablas
de hoy son `<table className="w-full max-w-6xl text-sm">` **sin contenedor con
`overflow-x-auto`**. Agregar 3-4 columnas sin envolverlas rompe ese spec.
**Mitigación obligatoria, en el mismo commit que agrega columnas:** envolver
cada `<table>` en `<div className="overflow-x-auto">` (patrón ya usado en
`catalogo/productos/page.tsx:54`, `administracion/permisos/permisos-matriz.tsx:191`).

---

## B. Definiciones EXACTAS de los cómputos (nada librado al implementador)

Todo esto vive en un **módulo puro nuevo** `src/core/reportes/rendimiento-recetas-vistas.ts`
(mismo molde que `src/core/reportes/historial-vistas.ts`, que §4 creó para esto
mismo: cero Prisma, tipos estructurales locales, testeable sin base).
`rendimiento-recetas.ts` pasa a ser solo "traer datos y llamar a estas funciones".

### B1. Entradas (reemplaza `totalComprado` como input de la fórmula)

```
totalComprado  = Σ cantidad  de MovimientoStock con proceso "COMPRA"
totalProducido = Σ cantidad  de MovimientoStock con proceso "PRODUCCION"
totalEntradas  = totalComprado + totalProducido
```
Filtro común (idéntico al de hoy): `seccion.sucursalId = sucursalId`,
`productoId ∈ pool.productoIds`, `operacion.fecha ∈ [desde 00:00 UTC, hasta
23:59:59.999 UTC]`, **`operacion.anuladaEn: null`**.

Se hacen en **una sola consulta** con `proceso: { in: ["COMPRA", "PRODUCCION"] }`
trayendo `proceso` en el `select`, y se separan en JS. (Esa línea menciona
`"COMPRA"` → el guardián `reportes-compras-anuladas.test.ts` exige `anulad…` en
la ventana de ±líneas; el `anuladaEn: null` del mismo `where` lo satisface.)

**Lo que NO se suma, a propósito, y hay que dejarlo escrito en el docstring:**
`DEVOLUCION_PROVEEDOR` (coherente con §4 decisión 6: devoluciones a proveedor no
entran en la primera versión) y `TRANSFERENCIA_ENTRADA_SUCURSAL` (una entrada
real pero de otro carril). Las dos quedan capturadas como contexto en el
Δstock, que sí suma todo.

Los tres campos (`totalComprado`, `totalProducido`, `totalEntradas`) van en la
fila: se muestran los dos primeros por separado cuando `totalProducido > 0` (si
no, solo "Comprado").

### B2. Teórico con merma

```
cantidadTeoricaBruta = cantidadReceta × (1 + mermaPct / 100)
```
Misma fórmula literal que `venta.ts:85` / `movimientos.ts:100` / `costos.ts:63`.
`cantidadReceta` = `RecetaIngrediente.cantidad` (neta), `mermaPct` =
`RecetaIngrediente.mermaPorcentaje`.

### B3. Estimado bruto, estimado neto y desvío

```
cantidadEstimadaBruta = totalEntradas / totalVendido            (null si totalVendido <= 0)
cantidadEstimadaNeta  = cantidadEstimadaBruta / (1 + mermaPct/100)
desviacionPorcentaje  = round( ((cantidadEstimadaBruta − cantidadTeoricaBruta) / cantidadTeoricaBruta) × 1000 ) / 10
                        (null si cantidadTeoricaBruta <= 0 o cantidadEstimadaBruta === null)
```
Los dos redondeados con `redondearCantidad` (3 decimales, `comun.ts:177`), el %
con el mismo `×1000/10` que ya usa el archivo.

**Identidad a documentar y a testear:**
`(estBruta − teoBruta)/teoBruta === (estNeta − cantidadReceta)/cantidadReceta`.
El % es el mismo mire el neto o el bruto; lo que **sí** cambia contra hoy es el
denominador (antes era `cantidadReceta` contra un numerador bruto — el sesgo
del defecto 3).

**Qué se muestra y qué viaja:**
- Columna "Receta actual" → `cantidadReceta` (neta) + `" + merma X%"` cuando `mermaPct > 0`.
- Columna "Rendimiento real" → **`cantidadEstimadaNeta`** (misma base que la columna de al lado).
- `?sugerido=` y el texto "Vas a pasar de {cantidadActual} a {X}" → **`cantidadEstimadaNeta`**. Es el campo neto de la receta el que se va a editar.

### B4. Δ de stock (CONTEXTO — no entra en ninguna fórmula)

```
stockApertura = Σ cantidad de TODOS los MovimientoStock del pool en la sucursal con operacion.fecha <  desde
deltaStock    = Σ cantidad de TODOS los MovimientoStock del pool en la sucursal con desde <= fecha <= hasta
stockCierre   = stockApertura + deltaStock
```
**Sin ningún filtro de `proceso` y sin `anuladaEn: null`** — la anulación es su
propio contra-asiento; filtrarla daría un saldo mal (advertencia de §3,
confirmada). Patrón idéntico a `historial-producto.ts:124-128` (`saldoInicial`
con `operacion: { fecha: { lt: desde } }`, sin filtro de anuladas). Dos
`aggregate({ _sum: { cantidad } })`, el cierre se deriva (no una tercera
consulta). Redondeo con `redondearCantidad`.

Ninguna de las dos líneas menciona `"COMPRA"`/`"VENTA"` como literal, así que el
guardián de anuladas no se activa — **hay que dejar un comentario explícito**
de por qué no se filtran, o el próximo lector lo "arregla".

**Cómo se lee (el caso del Agua):** entradas 72, vendido 63, Δstock +9 →
*"comprado 72, vendido 63, pero el stock del insumo subió 9 en la ventana: las
9 unidades están en el depósito, no se consumieron"*. Consumo real 63/63 = 0 %
de desvío.

Para el caso compartido (Fase 2) el Δstock es del **pool**, igual para todas
las filas → va en el párrafo de encabezado del pool, no repetido por fila.

### B5. Banda de ruido de lote (CONTEXTO en texto, nunca umbral)

```
loteTipico    = mediana( [cantidad de cada MovimientoStock de proceso "COMPRA" del pool dentro de la ventana] )
bandaRuidoPct = round( (loteTipico / totalVendido) / cantidadTeoricaBruta × 1000 ) / 10
```
- `mediana` = `src/core/estadistica/mediana.ts` (ya existe; mismo criterio que
  §4 decisión 1 — mediana, no promedio, "resiste el stock inicial").
- **Solo `COMPRA`, no `PRODUCCION`**: el ruido de lote es una propiedad del
  envase del proveedor (caja x12), no de un lote de producción propio. Decisión
  explícita, a documentar.
- `null` si `loteTipico === null` (ninguna compra en la ventana), `totalVendido
  <= 0` o `cantidadTeoricaBruta <= 0`.
- **Verificación aritmética obligatoria en el test:** lote 12, vendido 63,
  teórico 1 → **19,0 %** (el ±19 % citado en §3). Y con desvío +14,3 % →
  `dentroDeLaBanda === true`.

```
dentroDeLaBanda = bandaRuidoPct !== null && Math.abs(desviacionPorcentaje) <= bandaRuidoPct
```
`dentroDeLaBanda` **solo elige el texto**, jamás decide si la celda se pinta
ámbar (decisión 5, ya cerrada).

Texto de la fila: *"Se compra de a ~{loteTipico} por vez sobre {totalVendido}
vendidos: una compra de más o de menos mueve el resultado ±{bandaRuidoPct} %"*
+ *"— el desvío cae dentro de esa banda"* cuando `dentroDeLaBanda`.

### B6. Impacto en $ (y el nuevo orden del ranking)

```
costoUnitarioPool = entre pool.productoIds que tengan costo en obtenerCostoActualPorMP(sucursalId),
                    el de `fecha` MÁS RECIENTE; empate → el de menor productoId (determinismo). null si ninguno.

impactoPesos = redondearMoneda( (totalEntradas − cantidadTeoricaBruta × totalVendido) × costoUnitarioPool )
               (null si costoUnitarioPool === null o totalVendido <= 0)
```
- Algebraicamente idéntico a
  `(cantidadEstimadaBruta − cantidadTeoricaBruta) × totalVendido × costo` — la
  forma citada en el grounding §6.3 y el eco de `deltaImpacto` (`periodo.ts:519`).
  Se implementa en la forma sin división: no pierde precisión y no explota con
  `totalVendido = 0`.
- **Nunca se inventa un costo**: `null` y se avisa, mismo criterio que
  `perdidas.ts:83` (`sinPrecio`) y que `deltaImpacto`.
- Signo: **positivo** = entró/se consumió MÁS de lo que la receta prevé (plata
  de más); **negativo** = menos.
- Rótulo visible: **"Impacto del desvío"**, paralelo exacto de **"Impacto del
  cambio"** (`tabla-periodo.tsx:193`), con el mismo formato: signo + `$` +
  `toLocaleString("es-AR")`.

**Orden del ranking (reemplaza el alfabético actual, `rendimiento-recetas.ts:234-236`
y `:337`):**
```
|impactoPesos| descendente → null al final → desempate por el orden alfabético de hoy
                              (productoVentaNombre, luego insumoONombre; al revés en compartidas)
```
Para Fase 2, los **pools** se ordenan por el máximo `|impactoPesos|` de sus
filas, y dentro del pool las filas por `|impactoPesos|`. `page.tsx:54-58` arma
el `Map` de pools en orden de aparición, así que basta con que
`calcularRendimientoRecetasCompartidas` devuelva las filas ya ordenadas por
pool.

**Esto es lo que disuelve el caso del agua sin estadística:** una caja de agua
de más pesa centavos y cae al fondo; 0,3 kg de ajo de más en 600 pizzas sube
solo.

### B7. `motivoSinEstimacion`

`string | null`, texto listo para pintar — **mismo patrón que
`motivoNoResoluble`, que ya existe en este archivo** (`rendimiento-recetas.ts:52`)
y que los tests ya verifican por regex (`toMatch(/semanas/i)`). Orden de
evaluación, gana el primero:

| Condición | Texto | Efecto en `cantidadEstimada` |
|---|---|---|
| `totalVendido === 0` | "No hubo ventas de este plato en la ventana elegida: no hay contra qué comparar." | `null` (ya lo era) |
| `totalEntradas === 0` (y hubo ventas) | "No hubo compras ni producción de este insumo en la ventana: no se puede estimar el consumo." | **`null`** (hoy da 0 → −100 %) |
| `cantidadTeoricaBruta <= 0` | "La receta dice 0: no se puede calcular un porcentaje de desvío." | se muestra; el **desvío** queda `null` |
| resto | `null` | — |

La fila **nunca se oculta** (decisión 3: rotular, nunca ocultar). Sin
estimación no hay botón "Usar este valor" (ya es así hoy: `href` es `null`).

Esto, junto con `PRODUCCION` como entrada (B1), mata el defecto 1 por dos
caminos: si hubo producción, ahora cuenta; si no la hubo, en vez de "−100 %"
dice por qué.

Para las compartidas conviven los dos motivos; si hay `motivoSinEstimacion` se
muestra ese (es más básico que "la regresión no cerró").

### B8. Rótulo declarado (reemplaza `esUsoTrivial`, `rendimiento-recetas.ts:93-95`)

```ts
export type RotuloLinea = "SUBRECETA_PRODUCIDA" | "PACKAGING_NO_COMESTIBLE" | "PRODUCTO_DE_REVENTA" | null;
```
Función pura `rotularLineaDeReceta({ insumoSeProduce, insumoEsNoComestible, pvSeProduce, cantidadReceta, mermaPct })`,
**prioridad estricta**:

1. `insumoSeProduce === true` → **`"SUBRECETA_PRODUCIDA"`** — visible **"Sub-receta
   producida"**. Explícitamente **NO es trivial**: es justo una línea que
   conviene revisar. (Hoy se rotula "(venta directa)" — el peor de los tres
   errores, grounding §4.6.) Fuente: `Producto.seProduce` del `insumoProducto`
   (ver corrección A3/A4).
2. `insumoEsNoComestible === true` → **`"PACKAGING_NO_COMESTIBLE"`** — visible
   **"Packaging / no comestible"**. Fuente: el `Insumo.grupoId` bajo el árbol
   "No comestibles", vía `cargarClasificacionNoComestibles` (`comun.ts:32`), la
   misma clasificación que ya usa `/reportes/costos` para excluir packaging del
   food cost.
3. `pvSeProduce === false && cantidadReceta === 1 && mermaPct === 0` →
   **`"PRODUCTO_DE_REVENTA"`** — visible **"Producto de reventa"** (vocabulario
   ya fijado en §4 decisión 8). Es el caso del agua: el desvío acá **no puede**
   ser un error de receta.
4. si no → `null` (sin rótulo).

Ninguno oculta la fila; el que las baja del ranking es el impacto en $ (B6).

Los tres datos nuevos hay que traerlos en `construirPools`
(`rendimiento-recetas.ts:113-171`): agregar `seProduce` al `select` del PV y del
`insumoProducto`, y `insumo: { select: { grupoId: true } }` + una llamada a
`cargarClasificacionNoComestibles(db)` (una consulta chica, la tabla de Grupos
es corta). `UsoDeInsumo` gana `insumoSeProduce`, `insumoEsNoComestible`,
`pvSeProduce`.

### B9. Umbral de ámbar — constante única

```ts
/**
 * Un desvío de |10 %| o más se marca en ámbar. FIJO y NO configurable
 * (decisión 5, docs/planes-demo-y-claridad-reportes-2026-09-21.md §3;
 * grounding §6.5: es el estándar de industria — ERPNext usa el mismo
 * número en el ejemplo de `over_delivery_receipt_allowance` — y el
 * proyecto ya decidió una vez que este dueño no configura umbrales,
 * periodo.ts:205). El ruido de denominador chico no se resuelve moviendo
 * este número, se resuelve ordenando por impacto en $ (ver
 * `compararPorImpacto`) y mostrando la banda de ruido al lado.
 */
export const UMBRAL_DESVIO_AMBAR_PCT = 10;
export function desvioEsNotable(pct: number | null): boolean {
  return pct !== null && Math.abs(pct) >= UMBRAL_DESVIO_AMBAR_PCT;
}
```
Reemplaza el literal duplicado carácter por carácter en `fila-simple.tsx:35` y
`fila-compartida.tsx:26`.

### B10. Confianza — la opción barata, evaluada

`calcularConfianza` (`rendimiento-recetas.ts:75-80`) **no se toca** (≥8 alta,
≥4 media, ≥1 baja). Se agrega una función pura:
```
explicarConfianza(confianza, semanasConDatos) →
  "Alta — 9 semanas con datos" | "Media — la ventana elegida tiene 5 semanas" |
  "Baja — solo 2 semanas con datos" | "Sin datos"
```

**Decisión: NO extender `OpcionRango`.** Razones concretas, tras leer
`rango-por-defecto.ts` y `selector-rango.tsx`: `OpcionRango` es
`"30d" | "mes" | "personalizado"` y el `<select>` vive en un componente
compartido por **cinco** pantallas; sumar `"8sem"` obliga a tocar
`resolverRangoPorDefecto`, `resolverRangoDeReporte`, `ETIQUETA_RANGO`, los 14
tests de `rango-por-defecto.test.ts`, `selector-rango.spec.ts` y el rótulo de
las otras cuatro pantallas que no lo pidieron — el mismo cálculo que en §4
llevó a no extenderlo. **Sí se hace lo barato equivalente**: en `page.tsx`, un
`EnlaceInterno` "Ver las últimas 8 semanas" a
`/reportes/rendimiento-recetas?rango=personalizado&desde=<hoy−55d>&hasta=<hoy>`
(56 días = 8 semanas exactas, inclusive los dos extremos, mismo criterio que el
"29 + hoy" de `rango-por-defecto.ts:43-46`), visible solo cuando la confianza
de alguna fila está limitada por la ventana.

⚠️ Tiene que ser `EnlaceInterno`, **no** `Link`: el guardián
`enlaces-con-permiso.test.ts:98-101` rechaza cualquier `<Link href={expresión}>`
en `src/app/(app)` salvo el literal `volver`.

### B11. Reencuadre como calibrador (punto 1)

- **El `<h1>` NO cambia.** "Rendimiento real de recetas" se queda: (a) el
  grounding §7.3.3 deja explícitamente el nombre del producto al dueño, (b)
  cambiarlo rompe `conTitulo(page, "Rendimiento real de recetas")` del spec de
  axe, el `getByRole("heading")` de `rendimiento-recetas-confirmar.spec.ts:27`
  y el label del menú (`estructura.ts:81`). Anotarlo como pendiente de
  vocabulario, no hacerlo acá.
- El subtítulo (`page.tsx:72-74`) pasa a la pregunta del calibrador:
  *"**¿La receta cargada refleja lo que realmente se usa?** Compara la receta
  contra lo que las compras, la producción y las ventas de esta sucursal
  sugieren que se consume."*
- Párrafo nuevo debajo, con los dos `EnlaceInterno`: *"**Esto no mide si te
  falta stock.** Para eso están [Diferencias de ajuste] (qué se ajustó y qué
  dice el último conteo) y [Pérdidas y consumo interno] (qué se mermó o se
  consumió, valorizado)."*

### B12. Cruce con `/reportes/diferencias` (punto 10, las dos direcciones)

- **Ida** (ya descrita en B11).
- **Vuelta**, en `tabla-diferencias.tsx:51-67`, columna "Recetas que lo usan"
  (solo grupo "b", que ya lista `recetasQueLoUsan` con su
  `mermaPorcentajeActual`): junto a cada `EnlaceInterno` al editor de receta, un
  segundo `EnlaceInterno` a
  `/reportes/rendimiento-recetas?productoId=${r.productoVentaId}` con texto
  "ver rendimiento". `accionDeRuta` resuelve esa ruta a `ver_reportes_dinero`
  (verificado en `enlaces-con-permiso.test.ts:45`), distinto del
  `ver_reportes_control` de la pantalla → `EnlaceInterno` obligatorio; el
  archivo ya lo importa.
- La pantalla de rendimiento ya soporta `?productoId=` (`page.tsx:49-50`), no
  hay backend nuevo.

---

## C. Reparto: qué es lógica de core y qué es puramente presentación

| Pieza | Dónde |
|---|---|
| `UMBRAL_DESVIO_AMBAR_PCT`, `desvioEsNotable` | `rendimiento-recetas-vistas.ts` (puro, nuevo) |
| `cantidadTeoricaBruta`, `cantidadEstimadaNeta`, `desviacionPorcentaje` | idem (puro) |
| `bandaDeRuidoDeLote`, `dentroDeLaBanda`, texto de la banda | idem (puro) |
| `impactoDelDesvio`, `compararPorImpacto` | idem (puro) |
| `rotularLineaDeReceta`, `ETIQUETA_ROTULO` | idem (puro) |
| `motivoSinEstimacion` | idem (puro) |
| `explicarConfianza` | idem (puro) |
| Consultas de entradas (COMPRA+PRODUCCION) y de Δstock; `construirPools` con `seProduce`/no-comestible; `costoUnitarioPool` | `rendimiento-recetas.ts` (capa de datos) |
| Columnas, `overflow-x-auto`, colSpan, textos, links, `<details>` | `page.tsx`, `fila-simple.tsx`, `fila-compartida.tsx` |
| El "ver rendimiento" de vuelta | `reportes/diferencias/tabla-diferencias.tsx` |

**Ningún paso de A a D toca `prisma/schema.prisma`.** El único que lo tocaría
es el sub-plan S, separado y bloqueado.

---

## D. Pasos de implementación (chicos, reversibles, uno por commit, en este orden)

**P0 — Línea de base (sin commit).**
Correr `npm test` y `npx playwright test --list` y **anotar los números
reales** antes de tocar nada. Punto de partida conocido: Vitest 120
archivos/1192 tests, Playwright 220 specs. No asumirlos: confirmarlos.

**P1 — Módulo puro + tests puros.** `src/core/reportes/rendimiento-recetas-vistas.ts`
con todo lo de §B1-B10 (funciones puras, tipos estructurales locales, cero
Prisma), + `test/reportes/rendimiento-recetas-vistas.test.ts`. Ningún archivo
existente se modifica → build/axe/e2e no cambian de número (igual que el paso 1
de §4 con `historial-vistas.ts`).
Tests mínimos: el caso del Agua completo (12/63/teórico 1 → banda 19,0 %,
desvío +14,3 % dentro de la banda); la identidad bruto↔neto del %;
`cantidadEstimadaNeta` con merma 20 %; `impactoDelDesvio` con costo y sin costo
(null); orden con nulls al final; los cuatro rótulos con su prioridad (incluido
el caso trampa: insumo que se produce Y 1:1 → gana "Sub-receta producida"); los
cuatro `motivoSinEstimacion`.
**Demostración de mutación obligatoria sobre `impactoDelDesvio`** (§G).

**P2 — Teórico con merma + estimado neto + `motivoSinEstimacion`** en
`rendimiento-recetas.ts` (Fase 1 y Fase 2), y ajuste de
`test/reportes/rendimiento-recetas.test.ts` (los casos con merma 0 no cambian
de número; hace falta un caso nuevo **con** merma). Todavía sin tocar UI.

**P3 — `PRODUCCION` como entrada.** `totalComprado` / `totalProducido` /
`totalEntradas` en las dos fases. Test nuevo: una MP con `seProduce: true`
producida y nunca comprada deja de dar −100 %.

**P4 — Δ de stock.** `stockApertura` / `deltaStock` / `stockCierre` por pool,
sin filtro de anuladas, con el comentario de por qué. Tests: reproducir el
caso del agua (stock sube 9 dentro de la ventana) y **"una compra anulada no
mueve los saldos"** (el test explícitamente pedido por §3).

**P5 — Rótulo declarado.** `construirPools` trae `seProduce` del PV y del
insumo + `esNoComestible`; `esTrivial` → `rotulo: RotuloLinea` en los dos tipos
de fila. Actualizar el test "marca esTrivial…" → "rotula 'Producto de
reventa'…", + un test por cada uno de los otros dos rótulos.

**P6 — Impacto en $ + orden del ranking.** `costoUnitarioPool`, `impactoPesos`,
`sinCosto`; `totalVendido` expuesto también en `FilaRendimientoCompartido` (hoy
se calcula y se descarta); los dos `sort` cambian a `compararPorImpacto`.
Tests: orden, nulls al final, y que `totalVendido` de las compartidas es el
del plato, no el del pool.

**P7 — UI: la tabla.** En el mismo commit (van juntos o rompen el spec de
maquetación):
- Envolver las dos `<table>` en `<div className="overflow-x-auto">`.
- Fase 1: columnas nuevas **Comprado** (con "+ N producido" cuando aplica),
  **Vendido**, **Δ stock** (con apertura→cierre en el `title`), **Impacto del
  desvío**. Total 11 → **actualizar el `colSpan={7}` de la fila de
  confirmación a 11**.
- Fase 2: solo **Vendido** e **Impacto del desvío** por fila (7 columnas →
  `colSpan={5}` pasa a 7); Comprado/Producido/Δstock del pool van en el
  párrafo de encabezado del pool (`page.tsx:138-141`), donde ya viven los
  datos por pool.
- `desvioEsNotable(...)` importado, adiós al literal `>= 10` duplicado.
- Rótulo con su ayuda propia por tipo (reemplaza el `AYUDA_TRIVIAL` único, que
  hoy dice "venta directa" para los tres casos).
- Banda de ruido como texto de la fila; `motivoSinEstimacion` como texto en
  vez de celda "—" muda; confianza con `explicarConfianza`.
- Actualizar el texto de la confirmación: donde hoy dice "Venta directa 1:1…"
  para cualquier `esTrivial`, ahora el texto del rótulo que corresponda.
  **Conservar intacto** `"Comprado: {n} · Vendido: {n}"` —
  `rendimiento-recetas-confirmar.spec.ts:38` lo busca con esa regex exacta.

**P8 — UI: reencuadre.** Subtítulo + párrafo "esto no mide si te falta stock"
con los dos `EnlaceInterno` + el link "Ver las últimas 8 semanas" (B10/B11).

**P9 — Cruce de vuelta** en `tabla-diferencias.tsx` (B12).

**P10 — axe y E2E.**
- **Extender** (no crear) el caso de axe existente
  (`accesibilidad.spec.ts:395-427`) para cubrir los estados nuevos: fila con
  rótulo, fila con `motivoSinEstimacion`, banda de ruido visible, y la
  confirmación abierta con el `colSpan` nuevo. Si se prefiere un caso aparte
  para la siembra "con rótulo", el conteo de axe sube en 1 — anotarlo.
- Spec E2E de comportamiento nuevo: sembrar el caso del Agua (compra x12, 63
  ventas, receta 1, stock que sube 9) y afirmar Δstock, banda, orden por
  impacto y el rótulo "Producto de reventa"; más un caso con merma que
  verifique que `?sugerido=` lleva el **neto**.
- `rendimiento-recetas-confirmar.spec.ts` **tiene que seguir verde sin cambios
  de comportamiento**; si hay que tocarlo, solo por el `colSpan`/textos
  nuevos, nunca por el flujo.

**P11 — Verificación end-to-end final (§G).** Obligatoria, en una sola
corrida.

---

## E. SUB-PLAN S — Conteo físico periódico configurable ⚠️ REQUIERE AUTORIZACIÓN EXPRESA

> **Separado del resto a propósito. Es el ÚNICO tramo que toca
> `prisma/schema.prisma` y genera una migración nueva. No empezarlo sin un "sí"
> explícito del dueño. Los pasos P1-P11 de arriba funcionan completos sin él y
> no dependen de él en ningún punto.**

**Qué falta hoy (verificado):** `diferencias-ajustes.ts:23` expone
`ultimaFechaConteo` y no hay ninguna contraparte — ni frecuencia, ni próxima
fecha, ni alerta de conteo vencido (coincide con el grep exhaustivo del
grounding §3.2).

**S1 — Modelo.** Tabla nueva `FrecuenciaConteoProducto`. **El patrón más
parecido es `PrecioLocalProducto`, no `StockMinimoProducto`**: una agenda de
conteo es una política operativa de la **sucursal** sobre el **producto**, no
por sección (y `StockMinimoProducto` arrastra el `seccionId` nullable + un
índice único parcial hecho a mano en la migración — complejidad que acá no se
necesita). Forma:

```prisma
/// Cada cuánto toca volver a contar este producto en esta sucursal.
/// `0` = desactivado, mismo criterio que Odoo `cyclic_inventory_frequency`
/// (addons/stock/models/stock_location.py, rama 17.0 — el único de los
/// sistemas de referencia que modela una agenda de conteo; ERPNext,
/// Dolibarr y Grocy: NO ENCONTRADO). Por sucursal × producto, no global:
/// cada local tiene su propio volumen y su propia disciplina.
/// La "próxima fecha" NO se persiste — se deriva de ConteoFisico.fecha
/// más reciente + frecuenciaDias (mismo criterio que el resto del sistema:
/// no materializar lo que se puede calcular; ver el docstring de
/// StockMinimoProducto sobre por qué las vistas de stock no son tablas).
model FrecuenciaConteoProducto {
  id             String   @id @default(cuid())
  sucursalId     String
  sucursal       Sucursal @relation(fields: [sucursalId], references: [id])
  productoId     String
  producto       Producto @relation(fields: [productoId], references: [id])
  frecuenciaDias Int

  @@unique([sucursalId, productoId])
}
```
Migración: un `CREATE TABLE` + el índice único, **sin backfill** (fila ausente
= sin agenda, mismo criterio de "no hay fila" que
`StockMinimoProducto`/`PrecioLocalProducto`). Reversible por `DROP TABLE`.

**S2 — Permiso: reusar `proceso_control`, NO crear una acción nueva.**
`proceso_control` ("Registrar un Conteo Físico", `acciones.ts:58`) ya gatea
`/reportes/conteos` y `/stock/reclasificar`; quien cuenta es quien configura
cada cuánto. Reusarlo evita una **segunda** migración de datos (el molde
sería `20260921230200_permiso_anular_compra/migration.sql`:
`INSERT INTO "Accion"` + `INSERT INTO "PermisoRol"` para admin, ambos
`ON CONFLICT DO NOTHING`). Si se prefiere acción propia
(`frecuencia_conteo`), hay que sumar esa migración de datos y un ítem de
menú — decisión del dueño, no técnica.

**S3 — Lógica pura + core.**
`resolverProximoConteo({ ultimaFechaConteo, frecuenciaDias, hoy })` →
`{ proximaFecha, diasDeAtraso, vencido }`, con `frecuenciaDias === 0` → sin
agenda. Sin agenda y sin conteo nunca → "nunca se contó", que no es lo mismo
que "vencido".

**S4 — Derivar la clase A sola, sin que el dueño la declare.**
`generarReporteGastoPorInsumo` de `periodo.ts` ya calcula
`porcentajeAcumulado` y **`dentroDel80`** (corte Pareto 80/20,
`periodo.ts:500-502`). Eso alcanza para sugerir a qué ~10-15 insumos ponerles
frecuencia semanal, sin pedirle al dueño que los liste (grounding §3.3).

**S5 — UI de configuración.** Clon de `/stock/minimo` (`page.tsx` +
`stock-minimo-form.tsx` + `boton-eliminar.tsx` +
`src/server/actions/stock/stock-minimo.ts`) — es el template exacto de "algo
configurable por sucursal × producto con alta/baja".

**S6 — "Conteo vencido" dónde vive.** **En `/reportes/diferencias`, no en
`/stock/alertas`.** `/stock/alertas` responde "¿me falta stock?" y se gatea con
`ver_stock`; el conteo vencido es higiene de control, se gatea con
`ver_reportes_control`, y `diferencias-ajustes.ts` **ya tiene
`ultimaFechaConteo` cargado por producto** — sumar `proximaFechaConteo` /
`conteoVencido` ahí es casi gratis y queda al lado de su público. Columna
nueva "Próximo conteo" + estado.

**S7 — Beneficio inmediato, independiente de la Variante 3.** Con conteos
regulares, `sumaConteosFisicos` del grupo "b" deja de ser 0 y la
`sugerenciaMerma` ("aumentar"/"disminuir") pasa a tener una magnitud real
detrás. **Y con eso la Variante 3 queda cubierta por un reporte que ya
existe — ver A6, no se construye nada nuevo.**

**S8 — Verificación.** Los mismos 6 comandos de §G, **más**: `npm run build`
ahora **sí aplica una migración nueva** — avisarlo explícitamente y apuntar
`DATABASE_URL` a una base local descartable, **nunca a Neon/producción**
(regla ya fijada en §5 y en el runbook: cada escritura en Neon requiere
autorización expresa paso a paso).

---

## F. Riesgos a vigilar

1. **Terminología coordinada con §2/§4.** "Impacto del desvío" ↔ "Impacto del
   cambio" (`tabla-periodo.tsx:193`); "Δ stock" ↔ "Δ%"/"Δ costo"
   (`tabla-periodo.tsx:186,235`); "Producto de reventa" ↔ §4 decisión 8 (ya
   usado en `/reportes/historial`); "productos", no "líneas" (§2/§4). No
   inventar sinónimos.
2. **El guardián de anuladas** (`reportes-compras-anuladas.test.ts`): la
   consulta de entradas menciona `"COMPRA"` → tiene que llevar `anuladaEn:
   null` cerca. La de Δstock **no debe** llevarlo y no menciona ningún proceso
   → no se activa; dejar el comentario de por qué.
3. **El guardián de enlaces** (`enlaces-con-permiso.test.ts`): `EnlaceInterno`
   en los tres cruces (diferencias, pérdidas, "8 semanas" con href dinámico) —
   un `Link` ahí hace fallar el test.
4. **El guardián de contraste** (`contraste-de-color.test.ts`): cualquier
   ámbar nuevo va como `text-amber-700 dark:text-amber-600`; nada de
   `text-neutral-400` suelto.
5. **El guardián de `<th>` vacío** y el de "celda con display propio"
   (`encabezados-de-tabla.test.ts`): las columnas nuevas llevan `<th>` con
   texto; ningún `flex` en un `<td>`.
6. **Maquetación 1024/1280 px** (A8): `overflow-x-auto` en el mismo commit que
   las columnas.
7. **`colSpan` de la fila de confirmación** (7→11 y 5→7): si no se actualiza,
   la tabla queda desalineada sin que ningún test lo grite.
8. **`totalVendido` es un nombre de contrato:**
   `test/reportes/ventas-anuladas.test.ts:142` lo afirma. No renombrarlo.
9. **`?sugerido=` con el neto (A5):** si se olvida, el botón peligroso vuelve
   a ser peligroso para toda línea con merma. Es el riesgo más serio de todo
   el plan.

---

## G. Paso final OBLIGATORIO — verificación end-to-end sobre la suite TOTAL

**Antes de tocar nada (P0):** correr `npm test` y `npx playwright test --list`
y anotar los conteos reales. Línea de base conocida: **Vitest 120 archivos /
1192 tests**, **Playwright 220 specs** — confirmarla con la corrida real, no
asumirla.

**Al cerrar, en la MISMA corrida y en este orden:**

| Capa | Comando | Criterio de éxito |
|---|---|---|
| Tipos | `npx tsc --noEmit` | Salida vacía (único ruido preexistente aceptable: `LayoutProps` de `layout.tsx`) |
| Lint | `npm run lint` | 0 errores, **0 warnings** |
| Unitaria/integración | `npm test` (Vitest contra Postgres real, suite ENTERA) | Todos los archivos en verde; conteo de tests **≥ línea de base** |
| Accesibilidad | `npx playwright test test/e2e/accesibilidad.spec.ts` | `violations` vacío en cada página y cada estado cubierto. **Esta pantalla YA tiene su chequeo** (`accesibilidad.spec.ts:395-427`, de `74a14ab`) — se **extiende** con los estados nuevos (fila con rótulo, fila con `motivoSinEstimacion`, banda visible, confirmación con el `colSpan` nuevo); si se agrega un caso aparte, el conteo sube en 1 y hay que anotarlo |
| Build | `npm run build` | Build exitoso, sin warnings nuevos. `DATABASE_URL` a una base **local/descartable, NUNCA producción ni Neon**. Los pasos P1-P11 **no** agregan migraciones; **si se autoriza e implementa el sub-plan S, este comando SÍ aplica una migración nueva — avisarlo explícito antes de correrlo** |
| E2E | `npm run test:e2e` (Playwright, suite ENTERA) | Todos los specs en verde; conteo de specs **≥ línea de base** |

**Criterio de cierre conjunto:** el pendiente se considera terminado **solo
cuando los seis comandos pasan limpios en la MISMA corrida final**. Un verde
de ayer no cuenta.

**Specs a mirar con atención especial:**
- `test/e2e/rendimiento-recetas-confirmar.spec.ts` — **no se puede romper**.
  Verifica el arreglo de `74a14ab`: "Comprado: 20 · Vendido: 10", "de 1 a 2
  kg", foco al cancelar, `?sugerido=2` en la URL y la nota en el editor. Su
  caso tiene merma 0, así que el neto y el bruto coinciden: tiene que seguir
  dando 2.
- `test/e2e/accesibilidad.spec.ts:395-427` — el caso de esta pantalla.
- `test/reportes/rendimiento-recetas.test.ts` — cambia de forma en
  P2/P3/P5/P6.
- `test/reportes/ventas-anuladas.test.ts:134-143` — afirma `totalVendido` de
  este reporte.
- `test/reportes/diferencias-ajustes.test.ts` y `test/reportes/perdidas.test.ts`
  — los dos reportes del cruce.
- `test/arquitectura/enlaces-con-permiso.test.ts`,
  `reportes-compras-anuladas.test.ts`, `contraste-de-color.test.ts`,
  `encabezados-de-tabla.test.ts` — los cuatro guardianes que este plan roza.
- `test/e2e/maquetacion-general.spec.ts` — 1024/1280 px, cubre esta ruta
  (`rutas-sin-parametros.ts:40`).

**Demostración de que el test nuevo detecta lo que dice detectar** (mutación
temporal → rojo → revertir → verde), **obligatoria como mínimo para el impacto
en $** (el cómputo más citado del grounding, con precedente externo directo en
Restaurant365/xtraCHEF vía `docs/grounding-reportes-compras-2026-09-18.md` §5
y ya implementado en `periodo.ts:519`):
- Mutación sugerida: invertir el signo de `impactoDelDesvio` (`totalEntradas −
  teórico×vendido` → `teórico×vendido − totalEntradas`) **y** cambiar
  `compararPorImpacto` de `|x|` a `x` — las dos tienen que poner tests en rojo
  por separado (una afirma la plata, la otra el orden del ranking).
- Recomendado hacer lo mismo con `bandaDeRuidoDeLote` (cambiar `mediana` por
  `promedio` debe romper el caso del Agua) y con `cantidadEstimadaNeta` (sacar
  la división por `(1+merma/100)` debe romper el test de la línea con merma —
  es el riesgo #9).

---

## Archivos críticos para la implementación

- `src/core/reportes/rendimiento-recetas.ts`
- `src/app/(app)/reportes/rendimiento-recetas/page.tsx` (+ `fila-simple.tsx`, `fila-compartida.tsx` de la misma carpeta)
- `src/core/reportes/rendimiento-recetas-vistas.ts` (**nuevo**, módulo puro — molde: `src/core/reportes/historial-vistas.ts`)
- `src/core/reportes/diferencias-ajustes.ts` y `src/app/(app)/reportes/diferencias/tabla-diferencias.tsx` (el cruce)
- `src/core/reportes/comun.ts` (`construirMapaProductos`/`obtenerCostoActualPorMP`/`cargarClasificacionNoComestibles` — las tres fuentes de los datos nuevos)
- `prisma/schema.prisma` (**solo** para el sub-plan S, bloqueado por autorización expresa)
