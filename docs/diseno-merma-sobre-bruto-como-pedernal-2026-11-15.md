# Diseño: merma sobre el bruto como Pedernal (la receta carga el bruto; neto = bruto × (1 − merma)) — 2026-11-15

> Diseño en papel, escalera de 10 niveles (`AGENTS.md`). **No se escribió código, ni migraciones, ni se tocó ninguna base.** El nivel 6 es un **esquema PROPUESTO: no se migra hasta confirmar los niveles 1 a 5.** Documento público: redacción genérica, sin nombres de clientes, cifras reales ni identificadores de bases.
>
> **Marcas.** **VERIFICADO** (archivo:línea): lo leí en el código. **CONFIRMADA**: lo dijo el dueño, con cita. **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**.
> **Fuentes.** Motor2: `origin/main` `b36de06`. Pedernal: `ZuluHub-ERP` `243432a` (código leído: `src/modulos/stock/dominio/merma.ts`, `migraciones/0030_stock.sql:270-290`) y `ZuluHub-docs` `b179a9f` (fichas `conceptos/merma.md`, `bruto-y-neto.md`: **describen la fórmula anterior**; el código ya está en la nueva, DEC-0357, según el diseño `docs/diseno-paridad-costos-y-margen-con-pedernal-2026-11-13.md`, actualización del 2026-11-14).
> **Parte de:** `docs/diseno-paridad-costos-y-margen-con-pedernal-2026-11-13.md` (etapa D) y `docs/anexo-paridad-food-cost-pedernal-motor2-2026-11-13.md` (filas 2 y 3). **Este documento reemplaza el §6 «Etapa D» de aquel en lo que dice de la conversión de datos** (ver §6.4: la conversión no es exacta).
> **Pieza hermana:** `docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md`.

---

## 0. Resumen para el dueño

**La diferencia, en una línea.** Hoy en Motor2 la receta carga lo que **lleva el plato** (el neto) y la merma se **suma**: 800 g con 20 % → se descuentan **960 g**. En Pedernal la receta carga lo que **se compra y se descuenta** (el bruto) y la merma se **resta** para saber qué llega al plato: 1.000 g con 20 % → al plato llegan **800 g**. Mismo porcentaje, resultado distinto.

**Lo que decidió el dueño (2026-11-15)** y lo que se propone:

1. **M0, sin migración:** juntar la fórmula, que hoy está escrita **nueve veces en cinco archivos**, en una sola función, **sin cambiar ningún resultado**.
2. **Marcar cada versión con «cómo se cargó»** (`NETA` o `BRUTA`), en recetas, opciones y combinaciones (misma regla en todo: Q-M2). Las versiones que ya existen quedan `NETA` y **no se reescriben**.
3. **Al editar una receta, opción o combinación vieja se crea una versión NUEVA cargada en bruto** (Q-M1). La conversión conserva lo que se descuenta del stock y lo que se costea; **el neto de hoy se conserva con una diferencia mínima que la persona ve y confirma antes de guardar** (nunca en silencio). La versión vieja queda como está, en el historial.
4. **Ensanchar la merma a 4 decimales, como Pedernal (M2b):** con 2 decimales el neto se corre hasta 0,05 g sobre 1 kg; con 4, hasta 0,0005 g. Es lo que hace posible «el mismo neto de hoy».

**Por qué la conversión nunca es exacta del todo.** 800 g de neto con 20 % de merma sobre el neto equivalen a 960 g de bruto con **16,6666…** % de merma, que no cabe en un número finito de decimales (§6.4). Se conserva el **bruto** (stock y costo) y el neto se acerca lo más posible; la diferencia se muestra antes de guardar.

**Hecho de una copia (solo lectura, orquestador, 2026-11-15; sin nombres ni cifras de clientes):** en una copia reciente de una base **no había recetas, ni ingredientes, ni productos que «se producen»**. El recuento real se repite **en cada base** (consultas de §9); donde no hay recetas, la conversión no tiene nada que convertir.

| Etapa | Qué | Migración | Quién autoriza |
|---|---|---|---|
| **M0** | Una sola función de merma, mismos resultados | **Ninguna** | Nadie: refactor puro |
| **M1** | Consulta de solo lectura: cuántas recetas, líneas y calibraciones hay en cada base | **Ninguna** | Nadie |
| **M2** | Columna `baseDeCantidad` (`NETA` por defecto) en las tres tablas de versiones | **Aditiva y reversible** (`down.sql`) | Autorización permanente del 2026-11-15 |
| **M2b** | Ensanchar `mermaPorcentaje` de 2 a 4 decimales (cuatro tablas) | Cambia el tipo de la columna **sin cambiar ningún valor**; reversible solo si ningún valor usa más de 2 decimales | **Autorización EXPRESA** por base, con ensayo (§11, texto Z) |
| **M3a** | Todo el código **lee** la marca (sin cambiar lo que se escribe) | Ninguna | Se despliega solo |
| **M3b** | Lo nuevo se carga en bruto; al editar una versión `NETA` se crea la nueva en bruto con vista previa y confirmación | Ninguna | **Confirmación expresa del dueño** (§11, texto X) **y aprobación de los textos nuevos de la vista previa** (Q-M3) |

**Ninguna versión existente se reescribe.** Lo que cambia son las versiones **nuevas** y, al editar, la nueva versión convertida (con confirmación).

## 1. Nivel 1. Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| N-1 | Motor2 igual a Pedernal en todo: mismo resultado y misma forma, salvo Prisma, RLS o datos existentes | Dueño, 2026-11-13 (regla permanente de `AGENTS.md`) | CONFIRMADA |
| N-2 | La merma es «sobre lo que se compra»: neto = bruto × (1 − merma) | Dueño, 2026-11-13: «Sobre lo que se compra» (plan de paridad E3) | CONFIRMADA |
| N-3 | Se carga el bruto | Dueño, 2026-11-13: «Bruto, cargo el bruto. Cargo los 300 gr que corté y le defino una merma» y «Sí, cargar el bruto como Pedernal (Recomendada)» (chat con el orquestador) | CONFIRMADA |
| N-4 | Una merma de 100 % o más se rechaza (no se acota); el neto se rotula «Neto»; una merma inválida se marca en el campo y apaga «Guardar» | Dueño, 2026-11-13 (plan E3) y T2 «Neto» aprobado el 2026-11-14 (anexo B del diseño de paridad) | CONFIRMADA |
| N-5 | **Marcar cada receta con «cómo se cargó» y no reescribir las viejas** | Dueño, 2026-11-14, chat con el orquestador, opciones: «Marcar cada receta con «cómo se cargó» y no reescribir las viejas (Recomendada)» (en el diseño de paridad, Q5) | CONFIRMADA |
| N-6 | «Sí, copiar a Pedernal en esas cinco» (incluye E3: costos desde ahora, merma sobre el bruto) | Dueño, 2026-11-15, chat con el orquestador | CONFIRMADA |
| N-7 | Esta pieza **no** reescribe datos sin autorización expresa por base y con ensayo | Encargo del orquestador (la autorización permanente del 2026-11-15 cubre solo lo aditivo y reversible) | CONFIRMADA |
| N-8 | Al editar una receta vieja (cargada como neto) **se convierte a bruto** | Dueño, 2026-11-15, chat con el orquestador, opciones: «Al editarla se convierte a bruto» (Q-M1; **no era la recomendación del diseño**: CONFIRMADA la dirección; la forma —versión nueva, vista previa y confirmación, versiones viejas intactas— la fijó el orquestador al transmitirla) | CONFIRMADA |
| N-9 | Opciones y combinaciones: la misma regla que las recetas | Dueño, 2026-11-15, chat con el orquestador, opciones: «La misma regla que las recetas (Recomendada)» (Q-M2) | CONFIRMADA |
| N-10 | La conversión de neto a bruto **deja el mismo neto de hoy** y **no cambia el costo en silencio**: se muestra antes de guardar y la persona confirma | Encargo del orquestador, 2026-11-15, al transmitir la respuesta del dueño | CONFIRMADA (como requisito de diseño) |

**Fuera de alcance (no se pidió):** base del margen sin IVA, costo neto de IVA, objetivo de food cost (otras etapas del diseño de paridad), rendimiento de la receta (`rinde`), la «merma» como motivo de una salida de stock y la merma de lote de producción (cuatro cosas con el mismo nombre: ficha `merma.md` de Pedernal; esta pieza es solo la **B**: la merma de un ingrediente en la receta).

**Inventario de lo que ya existe (VERIFICADO en `origin/main`).**

- **Dónde se guarda la merma:** `RecetaIngrediente.mermaPorcentaje` `Decimal(6,2)`, por defecto 0 (`prisma/schema.prisma:864`); `RendimientoLocalIngrediente.mermaPorcentaje` y `.cantidad` (calibración **por sucursal**, opcional, `:1549-1550`); `ConsumoDeOpcion.mermaPorcentaje` (`:3676`, `CHECK` de 0 a 100); `RecetaDeCombinacionIngrediente.mermaPorcentaje` (`:3949`, `CHECK` de 0 a 100). **Cuatro tablas.** Pedernal tiene la merma en **una** (`componente_de_composicion.perdida numeric(7,4)`, `CHECK 0 ≤ p < 100`); no tiene merma en opciones ni en combinaciones (`0025_catalogo.sql`: ninguna columna `perdida` ni `merma`).
- **Las tres tablas de versiones, todas de solo agregar:** `RecetaVersion` (`:778`, «NUNCA se pisa ni borra una versión»), `VersionDeOpcion` (`:3630`) y `RecetaDeCombinacionVersion` (`:3918`).
- **Validación hoy:** hasta 1.000 % en recetas (`src/core/datos/limites.ts:30-31`, `src/core/catalogo/receta-validacion.ts:129-131`) y de 0 a 100 en opciones (`src/core/opciones/validar-configuracion.ts:56-57`, `consumo-de-linea-configurada.ts:121`). **Pedernal exige menor que 100**: una receta de hoy puede tener una merma que en Pedernal sería inválida.
- **La fórmula `cantidad × (1 + merma/100)`, escrita así (nueve expresiones en cinco archivos):**
  1. `src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts:66` (producción: lo que sale del stock);
  2. `src/core/movimientos/linea-de-venta.ts:95` (venta; el comentario de `:87` pide que sea **textualmente igual** porque el orden de las multiplicaciones cambia los últimos bits del número);
  3. `src/core/movimientos/consumo-de-linea-configurada.ts:133` y `:141` (venta con opciones, en `Decimal` exacto);
  4. `src/core/reportes/costos.ts:61`, `:158` y `:310` (costo de la receta; con números de JavaScript);
  5. `src/core/reportes/rendimiento-recetas-vistas.ts:50` (`calcularCantidadTeoricaBruta`) y `:61` (`calcularCantidadEstimadaNeta`, la inversa: neto = bruto ÷ (1 + merma)).
  El encargo hablaba de seis archivos: el sexto no apareció en mi búsqueda de `(1 + …/100)` ni de `/ 100` junto a `merma` (**NO VERIFICADO** que no exista con otra forma de escribirla).
- **Consumidores de esas funciones:** `src/server/consultas/reportes/rendimiento-recetas.ts:573,617,810,811` y `rendimiento-por-sucursal.ts:37,49` (comparan el bruto entre sucursales); la ficha de cocina (`src/core/catalogo/ficha-de-cocina.ts`); la calibración por sucursal (`src/core/catalogo/rendimiento-local.ts`, `src/server/actions/catalogo/casos-de-uso/fijar-rendimiento-local.ts`, `volver-al-rendimiento-central.ts`); el botón «Usar este valor» (`src/app/(app)/reportes/rendimiento-recetas/fila-simple.tsx`, `fila-compartida.tsx`, `catalogo/recetas/[productoId]/page.tsx`), que **escribe el neto estimado en la receta** (`rendimiento-recetas-vistas.ts:52-60`).
- **Dónde se escribe una receta:** un solo caso de uso, `guardarVersionDeRecetaCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts`, persistencia en `src/server/persistencia/catalogo/guardar-version-de-receta.ts`), por todos los caminos: central, propia de sucursal, copiar, «a ciegas» de scripts (`docs/diseno-guardia-de-unidad-receta-2026-11-09.md`); **al guardar arrastra las calibraciones locales a la versión nueva** (persistencia, `guardar-version-de-receta.ts:63`).
- **Dónde se lee la receta:** un embudo (`src/server/lecturas/catalogo/recetas-vigentes.ts` y `src/core/catalogo/recetas-vigentes.ts`) con un guardián de arquitectura que obliga a clasificar a cada lector (`test/arquitectura/lectores-de-receta.test.ts`). Es la puerta natural para leer la marca.
- **Duplicar producto** copia la merma (`src/core/catalogo/duplicar-producto.ts:74`, `SE_COPIA`).
- **Pantalla:** `src/components/receta/materia-prima-y-cantidad.tsx:131` (campo «Merma %»).
- **Pruebas que ya fijan el resultado de hoy** (el arnés de regresión de M0 y M3a): `test/reportes/caracterizacion/…golden…`, `test/recetas/caracterizacion-consumo-y-costo.test.ts`, `test/movimientos/caracterizacion/`, `test/movimientos/venta-caracterizacion-consumo.test.ts`, `test/catalogo/caracterizacion/dinero-tramo-c.test.ts`, `test/core/opciones/consumo-de-la-base-con-factor.test.ts`, `test/reportes/costos.test.ts`, `test/reportes/rendimiento-recetas-vistas.test.ts`.
- **Pedernal (VERIFICADO leyendo el código):** la receta guarda el **bruto** en `cantidad` (`numeric(18,4)`) y `perdida` (0 ≤ p < 100); `netoDeBruto(bruto, merma) = bruto × (100 − p) ÷ 100`, **redondeado una sola vez** a 4 decimales con `MITAD_SUBE_SIMETRICA` (la mitad se aleja del cero); la merma de 100 % o más **lanza error** (no se acota); el descuento de stock y el costo usan el bruto sin ninguna cuenta; el neto es solo para mostrar.

- **Hecho de una copia (solo lectura, orquestador, 2026-11-15):** 0 recetas, 0 ingredientes y 0 productos que «se producen». No hay datos que convertir en esa base; en las demás se cuenta con la consulta de §9.

---

## 2. Nivel 2. Actores y contexto

Quien edita recetas (`guardar_receta` central; `receta_sucursal_editar` propia: sin permisos nuevos), el administrador (calibración por sucursal y reportes), quien vende (la venta descuenta el stock de la receta), quien cierra una producción (descuenta lo producido), quien mira costos (`reporte_costos`). Todo por empresa y con RLS (sin cambios). Cada base (producción de cada cliente y las de prueba) tiene sus propias recetas: **cuántas** se cuenta en cada una (§9).

## 3. Nivel 3. Casos de uso

| # | Caso de uso | Etapa |
|---|---|---|
| CU-1 | Una sola función decide el bruto y el neto de una línea; todos los consumidores la usan | M0 |
| CU-2 | Contar, base por base, qué recetas existen y cuántas líneas tienen merma | M1 |
| CU-3 | Cada versión de receta (y de opción y de combinación) dice si se cargó **neta** o **bruta** | M2 |
| CU-4 | Una receta vieja (neta) se sigue vendiendo, costeando y reportando exactamente igual que hoy | M3a |
| CU-5 | Cargar una línea de receta nueva con el **bruto** y la merma; ver el **neto** calculado | M3b |
| CU-6 | Vender, producir y costear descuentan y valorizan el **bruto** de una receta nueva | M3b |
| CU-7 | Calibrar por sucursal la cantidad y la merma de una línea (en la base de esa versión) | M3b |
| CU-8 | «Usar este valor» del reporte de rendimiento escribe lo correcto según la marca de la receta | M3b |
| CU-9 | Editar una receta, opción o combinación vieja: se crea una versión nueva en bruto, con vista previa de lo que cambia y confirmación; la versión vieja queda intacta | M3b |
| CU-10 | Ver, antes de confirmar, el bruto, la merma, el neto y el costo por unidad de cada línea, antes y después | M3b |

## 4. Nivel 4. Conceptos y ciclo de vida

- **Bruto:** lo que sale del stock y se costea. **Neto:** lo que llega al plato; es derivado, solo para mostrar (Pedernal: «los derivados se calculan exactos y no se tipean»). **Merma:** el porcentaje del **bruto** que se pierde.
- **Fórmulas (la base `BRUTA` es la de Pedernal; la `NETA` es la de Motor2 de hoy):**

| Base de la versión | Lo que se escribe en `cantidad` | Bruto (descuento y costo) | Neto (lo que lleva el plato) |
|---|---|---|---|
| `BRUTA` | el bruto | `cantidad` (sin cuenta) | `cantidad × (100 − merma) ÷ 100`, redondeado una vez a 4 decimales, mitad que se aleja del cero |
| `NETA` (lo existente) | el neto | `cantidad × (1 + merma ÷ 100)` (**exactamente como hoy**) | `cantidad` |

- **Marca `baseDeCantidad`:** `NETA` | `BRUTA`, **una por versión** (no por línea: una versión no mezcla bases). Nace con la versión y **no cambia nunca** (la versión es de solo agregar). **Toda versión nueva es `BRUTA`.** Si la versión anterior de la serie era `NETA`, la nueva se crea **convirtiendo** todas sus líneas (con vista previa y confirmación, §6.2). Copiar la receta central como propia o duplicar un producto copia las líneas **con su marca**; si la marca es `NETA`, la copia queda `NETA` hasta que se edite. Las `NETA` solo quedan como historial y como recetas vigentes que nadie editó todavía.
- **Calibración por sucursal** (`RendimientoLocalIngrediente`): su `cantidad` y su `merma` están en la **base de la versión de la línea a la que cuelgan**. No lleva marca propia. Al convertir una versión se convierten también las calibraciones (§6.2).
- **Opciones y combinaciones** (`ConsumoDeOpcion`, `RecetaDeCombinacionIngrediente`): **la misma regla y la misma marca** (N-9), en `VersionDeOpcion` y `RecetaDeCombinacionVersion`.
- **Estados nuevos de datos:** ninguno más que la marca.

## 5. Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | Lo que sale del stock y se costea es el **bruto**; lo que llega al plato es el neto (solo para mostrar). Hay **una sola función** que lo decide | PROPUESTA (el criterio es CONFIRMADO: N-2 y N-3) |
| I2 | Una versión `NETA` sin editar da **el mismo costo, el mismo descuento de stock y el mismo reporte** que hoy, bit a bit en lo que hoy se calcula con números de JavaScript | PROPUESTA |
| I3 | En `BRUTA`: 0 ≤ merma < 100; con 100 o más se **rechaza** (no se acota). En `NETA` se admite lo de hoy (hasta 1.000 % en recetas, 0 a 100 en opciones): no se rechaza lo ya cargado | PROPUESTA (CONFIRMADA la parte de rechazar 100 %) |
| I4 | Merma 0: neto = bruto; las dos bases coinciden y el resultado de una receta sin merma **no cambia en ningún caso** | PROPUESTA |
| I5 | La marca no se cambia nunca; **toda versión nueva es `BRUTA`** (la única vía a una versión nueva `NETA` es la carga «a ciegas» de scripts y pruebas, que hoy ya está acotada por un guardián, para poder seguir fijando el comportamiento de las versiones viejas). Nadie elige la marca a mano en la pantalla | PROPUESTA |
| I6 | **Ninguna versión existente se reescribe:** ninguna fila de receta, opción, combinación, movimiento de stock, costo congelado ni venta pasada cambia. La conversión **crea una versión nueva** y deja la vieja en el historial. Lo ya vendido y lo ya valorizado queda como está | PROPUESTA (CONFIRMADA por N-5 y N-8) |
| I7 | Dinero y cantidades exactos: las funciones **nuevas** usan `Decimal` (o enteros), moneda explícita, redondeo **una sola vez al final** y a 4 decimales para el neto. Lo existente en números de JavaScript **no se reescribe** (no se pidió): la función única conserva la expresión idéntica de cada sitio (DT-M2) | PROPUESTA |
| I8 | La función de merma devuelve error, no un valor acotado, ante una merma fuera de rango en `BRUTA` | PROPUESTA (como Pedernal) |
| I9 | La calibración por sucursal respeta la base de su versión; al convertir una versión se convierten también sus calibraciones, línea por línea, con la misma regla (§6.2) | PROPUESTA |
| I10 | Aislamiento por empresa y permisos: sin cambios | VERIFICADO |
| I11 | Un **guardián** (cerco de trinquete en 0) falla si queda una fórmula de merma escrita fuera de la función única | PROPUESTA |
| I12 | Las versiones vigentes que **nadie edita** dan el mismo resultado de hoy; lo que el plan de paridad dejó como pregunta («¿se recalculan los costos ya mostrados?») queda respondido: **no se recalculan**; cambia lo que se guarda desde la edición en adelante | PROPUESTA (derivada de N-5 y N-8) |
| I13 | **Conversión neta → bruta, regla única:** para cada línea, `bruto = redondear4(neto × (100 + merma) ÷ 100)` y `merma nueva = redondear(100 × merma ÷ (100 + merma))` a los decimales de la columna; un solo redondeo por valor, mitad que se aleja del cero (§6.2) | PROPUESTA |
| I14 | **El bruto se conserva** (es lo que mueve stock y costo): la diferencia de bruto es a lo sumo medio 0,0001 de unidad y es **cero** cuando la cuenta es exacta (merma 0, o `neto × merma` con a lo sumo 2 decimales). **El neto se acerca** al de hoy hasta `bruto × 5×10⁻⁷` con 4 decimales de merma (`× 5×10⁻⁵` con 2) | PROPUESTA |
| I15 | **Nada se convierte en silencio:** si para alguna línea el bruto, el neto o el costo por unidad vendida difieren del de hoy, el servidor **exige una confirmación estricta** (`true`, como `confirmaCantidadDesproporcionada` de la guardia de unidad) sobre **esa** vista previa y **esa** versión esperada; sin ella, rechaza y devuelve la vista previa. Si no difiere nada (merma 0), se guarda sin preguntar | PROPUESTA (requisito N-10) |

## 6. Nivel 6. Historia y persistencia — **ESQUEMA PROPUESTO: no se migra hasta confirmar los niveles 1 a 5**

### 6.1 M2: una columna por tabla de versiones, aditiva y reversible

```sql
-- migration.sql (PROPUESTA, no aplicar). Se repite para "VersionDeOpcion" y "RecetaDeCombinacionVersion" (Q-M2 confirmada: misma regla en todo).
ALTER TABLE "RecetaVersion" ADD COLUMN "baseDeCantidad" TEXT NOT NULL DEFAULT 'NETA';
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_baseDeCantidad_chk"
  CHECK ("baseDeCantidad" IN ('NETA', 'BRUTA'));

-- down.sql (PROPUESTA): solo saca la marca. No toca ninguna cantidad ni merma.
-- ATENCIÓN: si ya existen versiones BRUTA, quitar la marca las haría leer como NETA. Antes de correrlo, volver el código a M3a o anterior
-- Y verificar con la consulta de §9 que no quedan versiones BRUTA; si quedan, el down se niega (guarda al principio del script).
ALTER TABLE "RecetaVersion" DROP CONSTRAINT IF EXISTS "RecetaVersion_baseDeCantidad_chk";
ALTER TABLE "RecetaVersion" DROP COLUMN IF EXISTS "baseDeCantidad";
```

- `NOT NULL DEFAULT 'NETA'` es un cambio de **solo metadatos** en Postgres 11 o posterior (no reescribe la tabla): **NO VERIFICADO** la versión de Postgres de cada base; se comprueba en el ensayo. Todo lo existente queda `NETA` sin una sola escritura de fila.
- **Texto con `CHECK` y no un `enum`:** el proyecto usa `CHECK` para estados (`AGENTS.md`, «estados con CHECK») y un valor de `enum` no se puede sacar después.
- **Compatibilidad hacia atrás:** un binario viejo que inserta una versión sin nombrar la columna recibe `NETA`, que es justo lo que ese binario entiende. Por eso M2 va **antes** que el código.
- **La regla «en BRUTA la merma es menor que 100»** no se puede escribir como `CHECK` de la línea (necesitaría mirar la versión, que es otra tabla). Se impone **en la aplicación** (el guard de la receta, I3) y, como refuerzo, con un **disparador** en las líneas que consulta la marca de su versión (precedente en el proyecto: `20261001230000_auditoria_inmutable`, `20261002160000_reglas_en_la_base_operacion_movimiento`; **NO VERIFICADO** el patrón exacto). **Decisión técnica DT-M11** (§8).
- `RendimientoLocalIngrediente`: **sin columna** (hereda la base de su línea).

### 6.1b M2b: ensanchar la merma a 4 decimales (cuatro tablas)

```sql
-- migration.sql (PROPUESTA, no aplicar). Se repite para RendimientoLocalIngrediente, ConsumoDeOpcion y RecetaDeCombinacionIngrediente.
ALTER TABLE "RecetaIngrediente" ALTER COLUMN "mermaPorcentaje" TYPE NUMERIC(7,4);

-- down.sql (PROPUESTA): se NIEGA si algún valor usa más de 2 decimales (volver a (6,2) los redondearía en silencio).
--   DO $$ BEGIN IF EXISTS (SELECT 1 FROM "RecetaIngrediente" WHERE "mermaPorcentaje" <> round("mermaPorcentaje", 2)) THEN
--     RAISE EXCEPTION 'hay merma con más de 2 decimales: no se puede volver a NUMERIC(6,2) sin perderla'; END IF; END $$;
-- ALTER TABLE "RecetaIngrediente" ALTER COLUMN "mermaPorcentaje" TYPE NUMERIC(6,2);
```

Es **lossless** (ningún valor existente cambia) pero **cambia el tipo de la columna**: puede reescribir la tabla y toma un bloqueo corto; por eso no entra en «aditivo» y pide autorización expresa (texto Z). Los `CHECK` de 0 a 100 de opciones y combinaciones siguen; el de menor que 100 para `BRUTA` va como en DT-M11. **Con M2b desaparece la diferencia de precisión con Pedernal** (`numeric(7,4)`).

### 6.2 M3b: qué se escribe y cómo se convierte al editar

**Versión nueva sin anterior** → `baseDeCantidad = 'BRUTA'`, `cantidad` = bruto, `mermaPorcentaje` = el % del bruto.

**Versión nueva con anterior `BRUTA`** → `BRUTA`, sin conversión.

**Versión nueva con anterior `NETA`** → `BRUTA`, **todas** las líneas convertidas (también las que la persona no tocó: una versión no mezcla bases), con esta regla, por línea:

| Paso | Cuenta | Redondeo |
|---|---|---|
| Bruto | `neto × (100 + merma) ÷ 100` | **una vez**, a 4 decimales (la columna `cantidad`), mitad que se aleja del cero |
| Merma nueva | `100 × merma ÷ (100 + merma)` | **una vez**, a los decimales de la columna (4 con M2b; 2 si no se hace) |
| Neto resultante (para mostrar) | `bruto × (100 − merma nueva) ÷ 100` | una vez, a 4 decimales |

Todo en `Decimal`/enteros, nunca `number`. Cualquier merma de hoy (0 a 1.000 %) da una merma nueva **menor que 100** (con 1.000 % da 90,9091 %), así que la conversión siempre produce una línea válida.

**Calibraciones por sucursal** (`RendimientoLocalIngrediente`): para cada sucursal con calibración se calcula el par efectivo (cantidad y merma, con la central donde la sucursal no calibró), se lo convierte con la misma regla y se guarda solo lo que difiere de la central ya convertida. Una calibración que solo cambiaba la cantidad conserva la merma central; una que cambiaba la merma pasa a llevar **cantidad y merma**.

**La vista previa** (la calcula el servidor con las mismas funciones puras que el guardado; la pantalla solo la muestra): por línea, **antes** y **después** de bruto, merma, neto y costo por unidad vendida (el costo, con la misma lectura que el reporte de costos; si falta el costo de un ingrediente se dice «pendiente de completar» y **no bloquea**); y por calibración, lo mismo. La confirmación vale **para ese pedido y esa versión esperada**: si entre la vista previa y el guardado alguien guardó otra versión, el servidor rechaza y la muestra de nuevo.

**Ejemplos (verificados a mano; el oráculo de §9 los fija):**

| Neto | Merma de hoy | Bruto | Merma nueva (2 dec.) → neto | Merma nueva (4 dec.) → neto |
|---|---|---|---|---|
| 800 g | 20 % | 960 g | 16,67 % → 799,9680 g (Δ −0,032) | 16,6667 % → 799,9997 g (Δ −0,0003) |
| 250 g | 15 % | 287,5 g | 13,04 % → 250,0100 g (Δ +0,010) | 13,0435 % → ≈ 249,9999 g (Δ −0,0001) |
| 500 g | 0 % | 500 g | 0 % → 500 g (exacto; **sin confirmación**) | igual |

### 6.3 Lo que se evaluó y se descartó

- **Reescribir las versiones viejas** (la «D-ii» del diseño de paridad). Descartada: reescribe tablas de solo agregar y no es exacta. La conversión **al editar** crea una versión nueva y es lo que decidió el dueño.
- **Conservar el neto exacto y dejar que corra el bruto.** Descartada: el bruto mueve stock y costo; el neto es solo para mostrar.
- **Convertir en silencio al guardar.** Descartada por el requisito N-10.
- **Una fecha de corte por empresa** en vez de una marca por versión: contradice «marcar cada receta» (N-5) y depende del reloj.
- **Marca por línea** o **tabla aparte de «cómo se cargó»:** más superficie de error y ningún beneficio.

### 6.4 Por qué la conversión nunca es exacta del todo

Para una línea con neto `n` y merma `m` sobre el neto, la línea bruta equivalente es `b = n × (1 + m/100)` y `m' = 100 × m ÷ (100 + m)`. Casi nunca `m'` es un número con pocos decimales (800 g y 20 % dan 16,666…). Con la columna actual (2 decimales) el neto recalculado corre hasta `bruto × 0,005 %` (0,048 g sobre 960 g); con 4 decimales, hasta `bruto × 0,00005 %` (0,0005 g). **Esto corrige el §6 «Etapa D» del diseño de paridad del 2026-11-13**, que decía que la conversión conservaba el neto.


## 7. Nivel 7. Atomicidad y concurrencia — «¿qué pasa si…?»

### 7.1 Guardar una versión de receta, opción o combinación (M3b)

| Situación | Resultado |
|---|---|
| Repetición / doble clic en «guardar» o en la confirmación | Una sola versión (versionado e idempotencia vigentes de `guardarVersionDeRecetaCasoDeUso`; **no se modifican**); el segundo pedido no duplica |
| Concurrencia (dos personas editan la misma receta) | Como hoy: transacción serializable y versión esperada; la marca y la conversión se calculan **dentro de la misma transacción** leyendo la versión anterior |
| Editar una versión `NETA` sin confirmar | Se rechaza **en el servidor** con la vista previa; no se escribe nada; sigue vigente la `NETA` |
| Confirmar una vista previa vieja (otra persona guardó antes) | Se rechaza por versión esperada y se muestra la vista previa nueva |
| Dos confirmaciones simultáneas de la misma receta | Gana una; la otra falla por la versión esperada |
| Merma ≥ 100 en una versión `BRUTA` | Se rechaza **siempre en el servidor** y se marca en el campo (N-4) |
| Merma ≥ 100 en una versión `NETA` sin editar | Se admite hasta el tope de hoy: no se rompe lo cargado (al editar se convierte y queda < 100) |
| Cantidad ≤ 0 | Como hoy: se rechaza |
| Falta el costo de un ingrediente | La vista previa dice «pendiente de completar» en el costo; **no bloquea** (el costo es información, el bruto y el neto sí se muestran) |
| Error parcial | Una versión con todas sus líneas, su marca y sus calibraciones convertidas, o ninguna |
| Datos faltantes (merma vacía) | 0 %; neto = bruto; sin confirmación |
| Cambio de permisos entre la vista previa y el guardado | Se verifica el permiso **en cada pedido**; sin permiso, se rechaza |
| Versión anterior ausente | `BRUTA` sin conversión |
| Una línea con merma 0 en una receta `NETA` | Se convierte exacta (bruto = neto, merma 0); si todas son así, no se pide confirmación |
| Copiar la central como propia con la central `NETA` | La copia queda `NETA` (copia las líneas con su marca) hasta que se edite |

### 7.2 Vender, producir y costear (M3a/M3b)

| Situación | Resultado |
|---|---|
| Receta `NETA` | Mismo descuento y mismo costo que hoy (I2) |
| Receta `BRUTA` | Descuenta `cantidad × unidades vendidas` y costea lo mismo; sin multiplicar por la merma |
| Una venta en curso mientras se guarda una versión nueva | Usa la versión vigente al cerrar, como hoy; la marca **viaja con la versión** que se leyó |
| Reintento de una venta | Idempotencia de la venta, sin cambios; el descuento no se duplica |
| Venta con opciones | Cada consumo se interpreta en la base de **su** versión de opción |
| Receta sin marca legible (error de lectura) | **Cierra, no abre:** la operación falla con error explícito; nunca se asume `BRUTA` ni se omite la merma |
| Una receta convertida entre dos ventas | La venta anterior queda como estaba (costo congelado); la siguiente usa la nueva versión; el descuento de bruto es el mismo salvo el resto de redondeo del bruto (§6.4) |

### 7.3 Calibración por sucursal

| Situación | Resultado |
|---|---|
| Calibrar cantidad o merma de una línea | Se guarda en la base de la versión de la línea; la pantalla rotula según la marca |
| Guardar una versión nueva (arrastre) | Si la versión anterior es `BRUTA`, se arrastra como hoy; si es `NETA`, **se convierte** con la regla de §6.2 y se muestra en la vista previa |
| Una calibración que no se puede convertir (dato fuera de rango) | Se **descarta y se audita**, como ya se hace hoy ante un cambio de unidad, y la vista previa lo dice |

### 7.4 «Usar este valor» del reporte de rendimiento

| Receta | Qué escribe |
|---|---|
| `BRUTA` | El **bruto** estimado tal cual (no hay conversión) |
| `NETA` | Crea la versión nueva **convertida**, con la línea objetivo en el bruto estimado, y exige la **misma confirmación** de §7.1: nunca convierte en silencio con un clic |

Repetir el clic: una sola versión nueva. Concurrencia: la versión esperada.

### 7.5 Despliegue y marcha atrás

| Situación | Resultado |
|---|---|
| Código viejo corriendo con M2 ya aplicado | Funciona: las versiones nuevas que escriba se marcan `NETA` por defecto, que es lo que entiende |
| Se enciende M3b y hay que volver el código atrás | **Riesgo real:** las versiones `BRUTA` ya escritas se leerían como `NETA` con el código anterior a M3a. Por eso M3a (leer) va **antes** y **no se retira** nunca; lo que se puede apagar es M3b. Apagarlo deja las `BRUTA` ya escritas leyéndose bien; las `NETA` vuelven a poder editarse sin convertir |
| Aplicar el `down` de M2 con `BRUTA` presentes | El script se **niega** (guarda de §6.1) |
| Aplicar el `down` de M2b con merma de más de 2 decimales | El script se **niega** (§6.1b) |


## 8. Decisiones técnicas (sin pregunta al dueño; PROPUESTAS, el orquestador las acepta o corrige)

| # | Decisión | Motivo |
|---|---|---|
| DT-M1 | Una función única de merma, **en un módulo puro de `src/core/`** (candidato `src/core/catalogo/merma.ts`, expuesto por `public.ts`); la ubicación exacta se fija con `npm run arquitectura` (**NO VERIFICADO** que `core/reportes` y `core/movimientos` puedan importarla sin una excepción) | Una sola fuente de la fórmula (como `merma.ts` de Pedernal) |
| DT-M2 | **M0 no cambia ni un bit:** la función expone el **factor** `1 + merma/100` (en `number`, para los sitios que hoy son `number`) y la versión `Decimal` (para `consumo-de-linea-configurada.ts`); cada sitio sigue multiplicando **en el mismo orden** (`linea-de-venta.ts:87` documenta que el orden cambia los últimos bits). Una prueba fija que las dos presentaciones coinciden en una grilla | Cero cambio de resultado |
| DT-M3 | Marca como `TEXT` con `CHECK` (`NETA`/`BRUTA`), no `enum` | Reversible; convención del proyecto |
| DT-M4 | La marca vive en **las tres tablas de versiones**, no en las líneas | Una versión no mezcla bases; las líneas son de solo agregar |
| DT-M5 | `DEFAULT 'NETA'` en la base; el código nuevo escribe la marca **siempre explícita** | Compatibilidad hacia atrás y claridad |
| DT-M6 | **Orden de despliegue:** M0 → M2 → (M2b) → M3a (leer) → M3b (escribir `BRUTA` y convertir). Nunca al revés | Marcha atrás segura (§7.5) |
| DT-M7 | **Ensanchar `mermaPorcentaje` a `NUMERIC(7,4)` (M2b)**, igual que Pedernal; reemplaza a la propuesta anterior de dejarlo en 2 decimales | Es lo que permite «el mismo neto de hoy» (§6.4) y elimina una diferencia con Pedernal |
| DT-M8 | Neto = `bruto × (100 − merma) ÷ 100`, redondeado **una vez** a 4 decimales, mitad que se aleja del cero; igual a Pedernal. El criterio de `redondearCantidad` de Motor2 (reportes) **NO VERIFICADO**: se compara con el de Pedernal al implementar | Mismo resultado |
| DT-M9 | La marca entra por el embudo único de lectura de recetas (`recetas-vigentes`) y se **clasifica en el guardián** `lectores-de-receta.test.ts` | Evita el lector que se olvida de la marca |
| DT-M10 | Guardián nuevo `test/arquitectura/formula-de-merma-unica.test.ts` (cerco de trinquete en 0): falla ante una fórmula de merma o de conversión fuera del módulo único | I11 |
| DT-M11 | «BRUTA ⇒ merma < 100»: en la aplicación **y** un disparador de refuerzo en las tres tablas de líneas (precedente: `20261001230000_auditoria_inmutable`; **NO VERIFICADO** el patrón exacto); si el dueño prefiere cero disparadores, solo la aplicación | `CHECK` no puede mirar otra tabla |
| DT-M12 | **Toda versión nueva es `BRUTA`**; el único camino a una `NETA` nueva es el «a ciegas» de scripts y pruebas (`receta-a-ciegas.ts`, ya acotado por un guardián), con la marca **explícita**, para que las caracterizaciones sigan fijando el comportamiento viejo | I5 y regresión |
| DT-M13 | La **vista previa la calcula el servidor** con las funciones puras de conversión; la confirmación es un booleano estricto en el comando del caso de uso (molde: `confirmaCantidadDesproporcionada`, `docs/diseno-guardia-de-unidad-receta-2026-11-09.md`), vale para ese pedido y esa versión esperada, y se verifica **dentro** de la transacción | I15; el cliente no decide |
| DT-M14 | La conversión es una **función pura** `convertirLineaNetaABruta({neto, merma}) → {bruto, merma}` en `Decimal`/enteros, con propiedades (`fast-check`): `bruto` dentro de 0,00005 del exacto; `|neto' − neto| ≤ bruto × 5×10⁻⁷ + 0,00005` con 4 decimales de merma; merma nueva < 100 para toda merma de 0 a 1.000 | I13 e I14 |
| DT-M15 | Los textos de la vista previa son **nuevos** y se proponen en Q-M3; **no se escriben en el código hasta que el dueño los apruebe** | Regla «lo que el dueño no pidió no entra» |


## 9. Nivel 8, 9 y 10 (acceso, consultas, pruebas, migración y operación)

### Nivel 8. Acceso
Sin claves nuevas ni cambios de piso: editar recetas = permiso actual de recetas; calibrar por sucursal = el actual; ver costos = `reporte_costos`. Pedernal: `composiciones.editar` (gerente y administrador): mismo piso.

### Nivel 9. Consultas y experiencia (375 px primero)
- Pantalla de receta: cada línea muestra **Bruto, Merma, Neto**; **se tipea el bruto** (una versión `NETA` solo se ve en el historial y, al editarla, se abre ya convertida con la **vista previa y la confirmación** de §6.2, con los textos que apruebe el dueño: Q-M3). La merma inválida se marca **en el campo** y apaga «Guardar», **sin texto al lado** (decisión del dueño del 13/11 para Pedernal). El neto se muestra con 4 decimales a lo sumo.
- Reporte de rendimiento y «Usar este valor»: ver §7.4. Reporte comparativo entre sucursales: compara **bruto** con la función única, así que mezclar versiones `NETA` y `BRUTA` en el mismo producto compara lo mismo.
- **Consultas de solo lectura por base (M1), que corren hoy en cada base (como dueño de la base o por empresa con el rol de la aplicación):**

```sql
-- Recetas: cuántas versiones, líneas y líneas con merma, y las que hoy serían inválidas en Pedernal (merma >= 100).
SELECT rv."empresaId",
       count(DISTINCT rv.id)                                      AS versiones,
       count(ri.id)                                               AS lineas,
       count(*) FILTER (WHERE ri."mermaPorcentaje" > 0)           AS lineas_con_merma,
       count(*) FILTER (WHERE ri."mermaPorcentaje" >= 100)        AS lineas_con_merma_100_o_mas
FROM "RecetaVersion" rv
LEFT JOIN "RecetaIngrediente" ri ON ri."empresaId" = rv."empresaId" AND ri."recetaVersionId" = rv.id
GROUP BY rv."empresaId" ORDER BY rv."empresaId";

-- Solo las VIGENTES (la de mayor versión de cada serie producto + sucursal): lo que hoy se vende y se costea.
WITH vig AS (
  SELECT DISTINCT ON ("empresaId", "productoId", COALESCE("sucursalId", ''))
         id, "empresaId" FROM "RecetaVersion"
  ORDER BY "empresaId", "productoId", COALESCE("sucursalId", ''), version DESC)
SELECT vig."empresaId", count(*) AS lineas_vigentes,
       count(*) FILTER (WHERE ri."mermaPorcentaje" > 0) AS vigentes_con_merma
FROM vig JOIN "RecetaIngrediente" ri ON ri."empresaId" = vig."empresaId" AND ri."recetaVersionId" = vig.id
GROUP BY vig."empresaId";

-- Calibraciones por sucursal con valor propio de cantidad o de merma.
SELECT "empresaId", count(*) FILTER (WHERE cantidad IS NOT NULL) AS con_cantidad_propia,
       count(*) FILTER (WHERE "mermaPorcentaje" IS NOT NULL)     AS con_merma_propia
FROM "RendimientoLocalIngrediente" GROUP BY "empresaId";

-- Opciones y combinaciones con merma (cuántas líneas hay que convertir, por base).
SELECT 'opcion' AS origen, "empresaId", count(*) AS lineas, count(*) FILTER (WHERE "mermaPorcentaje" > 0) AS con_merma FROM "ConsumoDeOpcion" GROUP BY "empresaId"
UNION ALL
SELECT 'combinacion', "empresaId", count(*), count(*) FILTER (WHERE "mermaPorcentaje" > 0) FROM "RecetaDeCombinacionIngrediente" GROUP BY "empresaId";
```

**Qué filas tocaría cada etapa, por base:** M0 y M1: **ninguna**. M2: **ninguna fila se escribe** (valor por defecto como metadato); el resultado de «versiones» de la primera consulta es **cuántas quedarán `NETA`**. M3a: ninguna. M3b: ninguna fila existente; solo versiones nuevas. Después de M2, la verificación del `down` es: `SELECT count(*) FROM "RecetaVersion" WHERE "baseDeCantidad" = 'BRUTA'` (y las dos tablas hermanas) = 0.

(Los nombres de columna salen de `schema.prisma`; **NO VERIFICADO** que coincidan letra por letra en la base: se prueba la consulta contra una copia antes de pasarla al dueño.)

### Nivel 10. Pruebas, oráculo de combinaciones, migración y operación

**Dimensiones cuyas combinaciones cambian dinero, stock, visibilidad o permisos (declaradas):** D1 base de la versión (`NETA`/`BRUTA`); D2 merma (0, valor intermedio, 99,99, 100 o más, 1.000 heredada); D3 origen de la línea (receta, opción, combinación); D4 calibración por sucursal (sin ella, solo cantidad, solo merma, ambas); D5 consumidor (venta, producción, costo, teórico del reporte, estimado neto, ficha de cocina, comparativo entre sucursales); D6 decimales de la unidad de stock; D7 versión con o sin anterior; D8 interruptor de M3b (apagado/encendido). **Guardián:** falla si aparece un consumidor nuevo de la receta sin clasificar en `lectores-de-receta.test.ts` o una fórmula de merma fuera de la función única.

**Oráculo (tabla escrita aparte del código; el test la recorre entera, porque son pocas combinaciones; propiedades con `fast-check`, verificado en `package.json`, para el resto):**

| Caso | Entrada | Resultado esperado |
|---|---|---|
| BRUTA, merma 10 % | bruto 300 g | neto 270 g; descuento y costo sobre 300 g |
| BRUTA, merma 20 % | bruto 1.000 g | neto 800 g |
| NETA (existente, sin editar), merma 20 % | neto 800 g | bruto 960 g (**igual que hoy**); neto 800 g |
| NETA con merma 1.000 % (heredada) | neto 10 g | bruto 110 g (igual que hoy) |
| Merma 0 en cualquier base | 500 g | bruto = neto = 500 g |
| BRUTA, merma 100 % o negativa | cualquiera | se rechaza |
| BRUTA, merma 99,99 % | bruto 100 g | neto 0,01 g |
| Redondeo del neto | bruto 0,3333, merma 10 % | 0,29997 → **0,3000** (mitad que se aleja del cero, una sola vez) |
| Calibración local en BRUTA | cantidad propia 250 g | descuenta 250 g en esa sucursal |
| «Usar este valor», NETA | bruto estimado 960 g, merma 20 % | crea versión convertida con esa línea en 960 g; **exige confirmación** |
| «Usar este valor», BRUTA | bruto estimado 960 g | escribe 960 g |
| Versión nueva con anterior NETA | neto 800 g, merma 20 % | `BRUTA`: bruto 960 g, merma 16,6667 % (4 dec.) → neto 799,9997 g; con 2 dec.: 16,67 % → 799,9680 g; **exige confirmación** |
| Conversión exacta | neto 500 g, merma 0 % | `BRUTA`: 500 g, 0 %; sin confirmación |
| Conversión | neto 250 g, merma 15 % | bruto 287,5 g; 13,0435 % → ≈ 249,9999 g |
| Conversión de merma extrema | neto 10 g, merma 1.000 % | bruto 110 g; merma 90,9091 % (< 100) |
| Conversión de calibración local | central 800 g / 20 %, sucursal solo cantidad 700 g | sucursal: cantidad 840 g, merma central convertida (16,6667 %) |
| Conversión sin confirmar | cualquiera con diferencia | se rechaza con la vista previa; no se escribe |
| Conversión con vista previa vieja | otra persona guardó antes | se rechaza por versión esperada |
| Primera versión | cualquiera | marca `BRUTA`, sin conversión |
| Marca ilegible | — | la operación falla con error; nunca se asume |

**Pruebas obligatorias por etapa:**
- **M0:** las **caracterizaciones existentes** (lista de §1) **sin cambiar una sola línea esperada**; propiedad `factor(m)` en `number` = versión `Decimal` en una grilla; el guardián `formula-de-merma-unica`; `knip` con consumidor real (los cinco archivos).
- **M2b:** ida, `down`, ida; el `down` se niega con merma de más de 2 decimales; ningún valor cambia (suma de control de `mermaPorcentaje` igual antes y después).
- **M2:** migración con ida, `down.sql`, ida (el esquema queda igual); el `down` se niega con `BRUTA` presentes; compatibilidad hacia atrás (insertar sin nombrar la columna da `NETA`).
- **M3a:** **ninguna diferencia observable**: toda la batería de regresión igual con la marca en `NETA` en todo lo existente; un lector que no lee la marca no pasa el guardián de lectores.
- **M3b:** oráculo completo; **conversión** con propiedades (`fast-check`) sobre una grilla de netos (hasta 4 decimales) y mermas (0 a 1.000 %, hasta 4 decimales): bruto dentro de 0,00005 del exacto, neto dentro de `bruto × 5×10⁻⁷ + 0,00005`, merma nueva < 100, **idempotencia** (convertir dos veces la misma versión crea una sola) y que **ninguna** versión vieja cambia una fila; **concurrencia** (dos ediciones de la misma receta a la vez; una venta mientras se guarda una versión nueva; dos calibraciones simultáneas de la misma línea); **idempotencia** (guardar dos veces la misma versión, doble clic en «Usar este valor», venta repetida: el stock no se descuenta dos veces); **aislamiento** (una empresa no ve ni afecta recetas de otra; RLS); **atomicidad** (corte a mitad de guardar: ninguna versión a medias); **E2E** a 375 px de la pantalla de receta y del reporte de rendimiento; regresión de que una receta `NETA` editada **sigue** dando su resultado.
- **Gate** (`AGENTS.md`), en la misma corrida y limpios: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Ensayo sobre copia (obligatorio antes de M2 en cada base):** (1) copia reciente de la base en una rama descartable; (2) correr las consultas de §9 y guardar el resultado; (3) aplicar M2, M2b y las tablas hermanas; (4) correr la batería de caracterizaciones y las sumas de control (conteo de versiones y de líneas, suma de `cantidad` y de `mermaPorcentaje`, suma de `MovimientoStock.cantidad` y de costos): **idénticas a las del paso 2**; (5) desplegar M3a en la copia y repetir la batería: idéntica; (6) encender M3b en la copia, crear una receta nueva, venderla y producirla, y comparar con el oráculo; (7) correr el `down` (debe negarse si hay `BRUTA`), apagar M3b, volver a probar; (8) aplicar de nuevo. **Nunca sobre la rama principal de la base de producción.**

**Verificación previa por base:** las consultas de §9 con su resultado, enviadas al dueño en el repositorio privado de documentos (este documento público no lleva los datos reales).

## 10. Preguntas de NEGOCIO

- **Q-M1 — Editar una receta vieja (cargada como neto): CONFIRMADA la dirección (2026-11-15, chat con el orquestador, opciones).** Literal: «Al editarla se convierte a bruto». No era la recomendación de este diseño (que proponía dejarla neta); se adopta la del dueño. La forma está en §6.2: versión nueva, vista previa y confirmación, versión vieja intacta.
- **Q-M2 — Opciones y combinaciones: CONFIRMADA (2026-11-15).** Literal: «La misma regla que las recetas (Recomendada)».
- **Q-M3 — ABIERTA. Textos nuevos de la vista previa de la conversión** (cambian lo que ve el cliente; el dueño debe aprobarlos). Se reutilizan los ya aprobados «Bruto», «Merma», «Neto» y «Pendiente de completar». Propuesta:
  - **T-M1** (encabezado): «Esta receta se cargó con el neto. Al guardar pasa a cargarse con el bruto; la anterior queda en el historial.»
  - **T-M2** (columnas): «Antes» y «Después».
  - **T-M3** (botón de confirmar): «Guardar y pasar a bruto».
  - **T-M4** (fila del costo): «Costo por unidad vendida».
  - **Opciones para el dueño:** **A (recomendada)** aprobar los cuatro como están; **B** corregirlos uno por uno.
  - **Si no se responde:** **M3b no se enciende** (no hay textos aprobados para la conversión; nace cerrado). M0, M1, M2, M2b y M3a no dependen de esta respuesta.

## 11. Qué hay que autorizar expresamente

**Hallazgo honesto:** ninguna versión existente se reescribe. M2 es aditiva y reversible (cubierta por la autorización permanente del 2026-11-15). Lo que **no** es solo aditivo: M2b (cambia el tipo de una columna, sin cambiar valores) y M3b (cambia cómo se guardan las recetas desde la edición en adelante, y mueve stock y costo de lo nuevo). Esas dos piden palabra expresa del dueño.

**Autorización X (encender la carga en bruto y la conversión al editar, M3b; por despliegue, nombrando las bases):**

> «Autorizo encender, en [LISTA DE BASES] y a partir del [FECHA], la carga de recetas, opciones y combinaciones en bruto (neto = bruto × (1 − merma)) y la conversión a bruto al editar una versión vieja, sabiendo que **la versión vieja no se toca**, que **la conversión me muestra antes y después y me pide confirmar**, y que **el bruto (lo que se descuenta y se costea) se conserva** mientras que el neto puede diferir en una fracción mínima que veo antes de guardar. Vi el resultado de las consultas de recuento de cada base el [FECHA], los textos de la vista previa que aprobé el [FECHA] y el ensayo sobre copia.»

**Alcance:** solo versiones nuevas y versiones convertidas al editar; **no** cambia datos ya cargados, ni costos ni ventas registradas; se puede **apagar** M3b (las ya escritas en bruto se leen bien). Vale para las bases nombradas.

**Autorización Z (ensanchar la merma a 4 decimales, M2b; por base):**

> «Autorizo cambiar, en la base [NOMBRE], el tipo de la columna de merma de las cuatro tablas de 2 a 4 decimales, sabiendo que **no cambia ningún valor ya cargado** y que se puede deshacer mientras ningún valor use más de 2 decimales. Vi el ensayo sobre copia el [FECHA].»

**Alcance:** solo el tipo de `mermaPorcentaje` en `RecetaIngrediente`, `RendimientoLocalIngrediente`, `ConsumoDeOpcion` y `RecetaDeCombinacionIngrediente`; no vale para otra base.

**Condiciones previas que se muestran junto a cada pedido:** el recuento de §9 de esa base; el resultado del ensayo (sumas de control idénticas, oráculo verde, `down` probado); una copia o respaldo reciente; quién lo despliega y cuándo; para X, los textos aprobados (Q-M3).

## 12. Etapas (la más barata primero) y supuestos

1. **M0 — función única, sin cambiar resultados.** Sin migración. **Primero y solo:** no depende de ninguna decisión pendiente.
2. **M1 — consultas de recuento por base.** Sin migración.
3. **M2 — la marca** (aditiva). Entra en la autorización permanente.
4. **M2b — merma a 4 decimales.** Autorización Z.
5. **M3a — leer la marca** en todos los consumidores (sin cambiar lo que se escribe).
6. **M3b — escribir en bruto y convertir al editar**, con vista previa y confirmación. Autorización X y textos aprobados (Q-M3).
7. **Etapas posteriores con nombre (NO pedidas):** botón explícito «pasar a bruto» sin tener que editar; sacar la merma de opciones y combinaciones (poda).

**Supuestos declarados (el dueño los corrige):** S1 las versiones vigentes que nadie edita siguen dando lo mismo que hoy; S2 una receta nueva sin versión anterior es bruta; S3 el neto es solo para mostrar y reportar, nunca se guarda como dato propio; S4 no se recalculan costos ni stock ya registrados; S5 se conserva el bruto y se acerca el neto (no al revés); S6 la vista previa no se pide cuando la conversión es exacta.


## 13. Diferencias con Pedernal (cada una con su motivo)

| Tema | Pedernal | Motor2 tras este diseño | Motivo |
|---|---|---|---|
| Base de la cantidad | Siempre bruto | Bruto en lo nuevo; neto (`NETA`) solo en el historial y en lo vigente no editado, marcado; al editar se convierte | **Datos existentes** y N-5/N-8 (dueño, 2026-11-14 y 2026-11-15) |
| Precisión de la merma | `numeric(7,4)` | `NUMERIC(7,4)` tras M2b | Sin diferencia una vez aplicada M2b (hoy `Decimal(6,2)`) |
| Rango de la merma | `0 ≤ p < 100` con `CHECK` | `< 100` en la aplicación y disparador de refuerzo para `BRUTA`; lo viejo hasta 1.000 % | **Datos existentes**; `CHECK` no mira otra tabla (DT-M11) |
| Merma en opciones y combinaciones | No existe | Existe, con la misma regla y marca (N-9) | **Datos existentes** |
| Calibración por sucursal | No existe | Existe; hereda la base de su línea | **Datos existentes** |
| Dónde decide la fórmula | Un archivo (`merma.ts`) | Una función única más guardián (M0) | Igual en la forma |
| Aritmética | Enteros exactos | Conserva `number` donde hoy lo es (M0); nuevo en `Decimal` | **Datos existentes**: reescribir no se pidió (I7) |
| Migraciones | SQL crudo | Prisma + `down.sql` | **Prisma** |
| Conversión de versiones viejas | No hay versiones viejas con otra fórmula | Versión nueva convertida con vista previa y confirmación (I13 a I15) | **Datos existentes** |

## 14. Riesgos y pendientes

- **Marcha atrás de M3b con `BRUTA` ya escritas** (§7.5): por eso M3a va antes y no se retira.
- **El neto convertido puede diferir en el cuarto decimal** del de hoy (hasta `bruto × 5×10⁻⁷`); el bruto, stock y costo se conservan. Se muestra antes de guardar (I15). Sin M2b la diferencia llega a 0,005 % del bruto.
- **Vista previa con costo incompleto:** no bloquea; muestra «pendiente de completar».
- **Un lector que se olvide de la marca** leería una versión `BRUTA` como `NETA` y descontaría de más: lo cubren el embudo único, el guardián de lectores (DT-M9) y el guardián de la fórmula (DT-M10).
- **Dinero con números de JavaScript** en `costos.ts` y los sitios de stock: sigue (no se reescribe); las funciones nuevas nacen exactas. Anotado como deuda aparte.
- **Dos fórmulas coexistiendo** mientras haya versiones `NETA` vigentes sin editar o en el historial: es el costo de no reescribir.
- **Recetas con merma ≥ 100 ya cargadas** (válidas hoy): siguen válidas como `NETA`; al editarlas se convierten y quedan < 100.
- **Textos nuevos pendientes (Q-M3):** sin su aprobación M3b no se enciende.
- **Pruebas que escriben recetas:** pasan a escribir `BRUTA`; las caracterizaciones del comportamiento viejo deben forzar `NETA` por el camino «a ciegas» (DT-M12).
- **El «sexto archivo» de la fórmula** que mencionó el encargo no se encontró (§1): si existe, M0 lo encuentra con el guardián.
- **Congelamiento de producción:** nada se aplica ni se despliega desde este documento.
- **Sugerencias (no implementadas):** botón explícito «pasar a bruto» sin editar; poda de la merma en opciones y combinaciones.
