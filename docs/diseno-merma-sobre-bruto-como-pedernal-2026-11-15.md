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

**Lo que se propone.**

1. **Paso previo sin migración (M0):** juntar la fórmula, que hoy está escrita **nueve veces en cinco archivos**, en una sola función, **sin cambiar ningún resultado**. Es el paso más barato y deja la mesa lista.
2. **Marcar cada versión de receta con «cómo se cargó» (M2):** una columna nueva, con valor `NETA` para todo lo que ya existe y `BRUTA` para lo nuevo. **No se reescribe ninguna receta vieja**: sigue dando el mismo costo y el mismo descuento de stock de siempre.
3. **Después (M3):** el código lee la marca y, para lo nuevo, carga el bruto.

**Por qué no convertir las recetas viejas al bruto.** El diseño anterior decía que se podía convertir sin perder nada. **No es cierto con la precisión de hoy:** 800 g con 20 % de merma sobre el neto equivale a 960 g brutos con **16,6667 %** de merma, y la columna guarda dos decimales (16,67 %): el neto resultante sería 799,97 g, no 800. Por eso la marca por versión es la opción correcta y no un parche (§6.4).

| Etapa | Qué | Migración | Quién autoriza |
|---|---|---|---|
| **M0** | Una sola función de merma, mismos resultados | **Ninguna** | Nadie: refactor puro |
| **M1** | Consulta de solo lectura: cuántas recetas, líneas y calibraciones tocaría cada base | **Ninguna** | Nadie |
| **M2** | Columna `baseDeCantidad` (`NETA` por defecto) en las tres tablas de versiones | **Aditiva y reversible** (`down.sql`) | Autorización permanente del 2026-11-15 |
| **M3a** | Todo el código **lee** la marca (sin cambiar lo que se escribe) | Ninguna | Se despliega solo |
| **M3b** | Lo nuevo se carga en bruto; la pantalla muestra «Bruto», «Merma», «Neto» | Ninguna | **Confirmación expresa del dueño de encender la carga en bruto** (§11) |

**Con el diseño recomendado, ninguna fila de receta existente se reescribe.** El encargo preveía que esta pieza reescribía datos; el análisis de abajo muestra que no hace falta y que hacerlo sería peor. Si igual se quisiera convertir las viejas, hay una autorización aparte con su texto (§11, opción Y).

---

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
| CU-9 | Editar, copiar o duplicar una receta vieja sin cambiar su resultado | M3a/M3b |

## 4. Nivel 4. Conceptos y ciclo de vida

- **Bruto:** lo que sale del stock y se costea. **Neto:** lo que llega al plato; es derivado, solo para mostrar (Pedernal: «los derivados se calculan exactos y no se tipean»). **Merma:** el porcentaje del **bruto** que se pierde.
- **Fórmulas (la base `BRUTA` es la de Pedernal; la `NETA` es la de Motor2 de hoy):**

| Base de la versión | Lo que se escribe en `cantidad` | Bruto (descuento y costo) | Neto (lo que lleva el plato) |
|---|---|---|---|
| `BRUTA` | el bruto | `cantidad` (sin cuenta) | `cantidad × (100 − merma) ÷ 100`, redondeado una vez a 4 decimales, mitad que se aleja del cero |
| `NETA` (lo existente) | el neto | `cantidad × (1 + merma ÷ 100)` (**exactamente como hoy**) | `cantidad` |

- **Marca `baseDeCantidad`:** `NETA` | `BRUTA`, **una por versión** (no por línea: una versión no mezcla bases). Ciclo de vida: nace con la versión y **no cambia nunca** (la versión es de solo agregar). Una versión nueva se marca así: **si hay una versión anterior de esa serie, hereda su marca; si no, `BRUTA`** (Q-M1). Copiar la receta central como propia o duplicar un producto copia las líneas **con su marca**.
- **Calibración por sucursal** (`RendimientoLocalIngrediente`): su `cantidad` y su `merma` están en la **base de la versión de la línea a la que cuelgan**. No lleva marca propia.
- **Opciones y combinaciones** (`ConsumoDeOpcion`, `RecetaDeCombinacionIngrediente`): decisión de negocio Q-M2.
- **Estados nuevos de datos:** ninguno más que la marca.

## 5. Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | Lo que sale del stock y se costea es el **bruto**; lo que llega al plato es el neto (solo para mostrar). Hay **una sola función** que lo decide | PROPUESTA (el criterio es CONFIRMADO: N-2 y N-3) |
| I2 | Una versión `NETA` da **el mismo costo, el mismo descuento de stock y el mismo reporte** que hoy, bit a bit en lo que hoy se calcula con números de JavaScript | PROPUESTA |
| I3 | En `BRUTA`: 0 ≤ merma < 100; con 100 o más se **rechaza** (no se acota). En `NETA` se admite lo de hoy (hasta 1.000 % en recetas, 0 a 100 en opciones): no se rechaza lo ya cargado | PROPUESTA (CONFIRMADA la parte de rechazar 100 %) |
| I4 | Merma 0: neto = bruto; las dos bases coinciden y el resultado de una receta sin merma **no cambia en ningún caso** | PROPUESTA |
| I5 | La marca no se cambia nunca; una versión nueva **hereda** la de la anterior de su serie, o `BRUTA` si es la primera. Nadie elige la marca a mano | PROPUESTA |
| I6 | **Nada se reescribe:** ninguna fila de receta, opción, combinación, movimiento de stock, costo congelado ni venta pasada cambia. Lo ya vendido y lo ya valorizado queda como está | PROPUESTA (CONFIRMADA por N-5) |
| I7 | Dinero y cantidades exactos: las funciones **nuevas** usan `Decimal` (o enteros), moneda explícita, redondeo **una sola vez al final** y a 4 decimales para el neto. Lo existente en números de JavaScript **no se reescribe** (no se pidió): la función única conserva la expresión idéntica de cada sitio (DT-M2) | PROPUESTA |
| I8 | La función de merma devuelve error, no un valor acotado, ante una merma fuera de rango en `BRUTA` | PROPUESTA (como Pedernal) |
| I9 | La calibración por sucursal respeta la base de su versión: no se mezcla una cantidad neta con una versión bruta | PROPUESTA |
| I10 | Aislamiento por empresa y permisos: sin cambios | VERIFICADO |
| I11 | Un **guardián** (cerco de trinquete en 0) falla si queda una fórmula de merma escrita fuera de la función única | PROPUESTA |
| I12 | Las recetas existentes dan el mismo resultado **desde ahora y hacia atrás**: lo que el plan de paridad dejó como pregunta («¿se recalculan los costos ya mostrados con la fórmula nueva?») queda respondido por N-5: **no**; rige solo para lo nuevo | PROPUESTA (derivada de N-5; el dueño la corrige) |

## 6. Nivel 6. Historia y persistencia — **ESQUEMA PROPUESTO: no se migra hasta confirmar los niveles 1 a 5**

### 6.1 M2: una columna por tabla de versiones, aditiva y reversible

```sql
-- migration.sql (PROPUESTA, no aplicar). Se repite para "VersionDeOpcion" y "RecetaDeCombinacionVersion" (si Q-M2 = A).
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

### 6.2 M3b: qué se escribe a partir de la activación

Versión nueva sin versión anterior en su serie → `baseDeCantidad = 'BRUTA'`, `cantidad` = bruto, `mermaPorcentaje` = el % del bruto. Versión nueva con anterior → hereda la marca y las líneas se interpretan en esa base. Nada más cambia en el esquema.

### 6.3 Lo que se evaluó y se descartó

- **Convertir las recetas existentes al bruto (opción D-ii del diseño de paridad).** Descartada: es **inexacta** (§6.4), reescribe tablas de solo agregar, y ya está decidido que no (N-5).
- **Una fecha de corte por empresa** (`mermaSobreBrutoDesde`) en vez de una marca por versión. Descartada: contradice «marcar cada receta» (N-5) y depende del reloj en el instante del corte.
- **Marca por línea.** Descartada: permitiría versiones con líneas en dos bases (más superficie de error, ningún beneficio).
- **Una tabla aparte de «cómo se cargó».** Descartada: es una columna.

### 6.4 Por qué la conversión «sin pérdida» del diseño anterior no existe a dos decimales

Para una línea neta `n` con merma `m` sobre el neto, la línea bruta equivalente es `b = n × (1 + m/100)` y `m' = 100 × m ÷ (100 + m)`.

| `n` | `m` | `b` exacto | `m'` exacto | `m'` guardado (2 decimales) | neto recalculado con `m'` guardado |
|---|---|---|---|---|---|
| 800 g | 20 % | 960 g | 16,6666… % | 16,67 % | 960 × (1 − 0,1667) = **799,968 g** (≠ 800) |
| 250 g | 15 % | 287,5 g | 13,0434… % | 13,04 % | 287,5 × 0,8696 = **250,01 g** (≠ 250) |

El **bruto** sí se puede conservar (hasta el redondeo a 4 decimales), que es lo que importa al stock y al costo; lo que deriva es el **neto mostrado** y el neto de reportes. Con la marca por versión no hay deriva: la receta vieja sigue siendo lo que era. **Esto corrige el §6 «Etapa D» del diseño de paridad del 2026-11-13.**

## 7. Nivel 7. Atomicidad y concurrencia — «¿qué pasa si…?»

### 7.1 Guardar una versión de receta (M3b)

| Situación | Resultado |
|---|---|
| Repetición / doble clic | Una sola versión (la regla vigente de versionado y de idempotencia de `guardarVersionDeRecetaCasoDeUso`; **no la modifica** este diseño) |
| Concurrencia (dos personas editan la misma receta) | Como hoy: la transacción serializable y la versión esperada; la marca se calcula **dentro de la misma transacción** leyendo la versión anterior; no hay lectura fuera de ella |
| Dos versiones simultáneas con marcas distintas | Imposible: la marca sale de la versión anterior leída en la transacción; la segunda falla por la versión esperada y reintenta leyendo la nueva |
| Merma ≥ 100 en `BRUTA` | Se rechaza **siempre en el servidor**, aunque la pantalla no lo valide, y se marca en el campo (N-4) |
| Merma ≥ 100 en `NETA` (heredada) | Se admite hasta el tope de hoy (no se rompe lo cargado) |
| Cantidad ≤ 0 | Como hoy: se rechaza |
| Error parcial | Una versión con todas sus líneas y su marca, o ninguna (como hoy) |
| Datos faltantes (merma vacía) | 0 %; neto = bruto |
| Cambio de permisos | Se verifica en el servidor (clave de recetas), como hoy |
| Versión anterior ausente | `BRUTA` |

### 7.2 Vender, producir y costear (M3a/M3b)

| Situación | Resultado |
|---|---|
| Receta `NETA` | Mismo descuento y mismo costo que hoy (I2) |
| Receta `BRUTA` | Descuenta `cantidad × unidades vendidas` y costea lo mismo; sin multiplicar por la merma |
| Una venta en curso mientras se guarda una versión nueva | Usa la versión vigente al cerrar, como hoy; la marca **viaja con la versión** que se leyó |
| Reintento de una venta | Idempotencia de la venta, sin cambios; el descuento no se duplica |
| Venta con opciones | Cada consumo se interpreta en la base de **su** versión de opción (Q-M2) |
| Receta sin marca legible (error de lectura) | **Cierra, no abre:** la operación falla con error explícito; nunca se asume `BRUTA` ni se omite la merma |

### 7.3 Calibración por sucursal

| Situación | Resultado |
|---|---|
| Calibrar cantidad o merma de una línea | Se guarda en la base de la versión de la línea; la pantalla rotula según la marca |
| Guardar una versión nueva (arrastre) | Hereda la marca de la anterior, así que los valores calibrados **siguen en la misma base** y se arrastran igual que hoy |
| Arrastre entre versiones con marcas distintas | **No ocurre** (I5: se hereda); si algún día ocurriera, se **descarta y se audita** la calibración, como ya hace hoy ante un cambio de unidad |

### 7.4 «Usar este valor» del reporte de rendimiento

| Receta | Qué escribe |
|---|---|
| `NETA` | El neto estimado (`bruto estimado ÷ (1 + merma/100)`), como hoy (`calcularCantidadEstimadaNeta`) |
| `BRUTA` | El **bruto** estimado tal cual (no hay conversión) |

Repetir el clic: una sola versión nueva (como hoy). Concurrencia: la versión esperada.

### 7.5 Despliegue y marcha atrás

| Situación | Resultado |
|---|---|
| Código viejo corriendo con M2 ya aplicado | Funciona: las versiones nuevas que escriba se marcan `NETA` por defecto, que es lo que entiende |
| Se enciende M3b y hay que volver el código atrás | **Riesgo real:** las versiones `BRUTA` ya escritas se leerían como `NETA` con el código anterior a M3a. Por eso M3a (leer) va **antes** y **no se retira** nunca; lo que se puede apagar es M3b (escribir `BRUTA`). Volver atrás de M3b deja las `BRUTA` ya escritas leyéndose bien |
| Aplicar el `down` de M2 con `BRUTA` presentes | El script se **niega** (guarda de §6.1) |

## 8. Decisiones técnicas (sin pregunta al dueño; PROPUESTAS, el orquestador las acepta o corrige)

| # | Decisión | Motivo |
|---|---|---|
| DT-M1 | Una función única de merma, **en un módulo puro de `src/core/`** (candidato `src/core/catalogo/merma.ts`, expuesto por `public.ts`); la ubicación exacta se fija con `npm run arquitectura` (**NO VERIFICADO** que `core/reportes` y `core/movimientos` puedan importarla sin una excepción) | Una sola fuente de la fórmula (como `merma.ts` de Pedernal) |
| DT-M2 | **M0 no cambia ni un bit:** la función expone el **factor** `1 + merma/100` (en `number`, para los sitios que hoy son `number`) y la versión `Decimal` (para `consumo-de-linea-configurada.ts`); cada sitio sigue multiplicando **en el mismo orden**. No se unifica la cuenta completa porque `linea-de-venta.ts:87` documenta que el orden cambia los últimos bits. Una prueba fija que las dos presentaciones coinciden en una grilla de valores | Cero cambio de resultado |
| DT-M3 | Marca como `TEXT` con `CHECK` (`NETA`/`BRUTA`), no `enum` | Reversible; convención del proyecto |
| DT-M4 | La marca vive en **las tres tablas de versiones**, no en las líneas | Una versión no mezcla bases; las líneas son de solo agregar |
| DT-M5 | `DEFAULT 'NETA'` en la base; el código nuevo escribe la marca **siempre explícita** | Compatibilidad hacia atrás y claridad |
| DT-M6 | **Orden de despliegue:** M0 → M2 → M3a (leer) → M3b (escribir `BRUTA`). Nunca al revés | Marcha atrás segura (§7.5) |
| DT-M7 | La precisión de la merma sigue en `Decimal(6,2)` (Pedernal: `numeric(7,4)`). **Diferencia declarada, motivo: datos existentes** (ensanchar la columna es otra migración que nadie pidió) | Paridad con motivo |
| DT-M8 | Neto = `bruto × (100 − merma) ÷ 100`, redondeado **una vez** a 4 decimales, mitad que se aleja del cero; igual a Pedernal. El criterio de `redondearCantidad` de Motor2 (reportes) **NO VERIFICADO**: se compara con el de Pedernal al implementar | Mismo resultado |
| DT-M9 | La marca entra por el embudo único de lectura de recetas (`recetas-vigentes`) y se **clasifica en el guardián** `lectores-de-receta.test.ts`; un lector que no la lea no pasa | Evita el lector que se olvida de la marca |
| DT-M10 | Guardián nuevo `test/arquitectura/formula-de-merma-unica.test.ts` (cerco de trinquete en 0): falla ante `(1 + …merma… / 100)` o `(100 − …)` fuera del módulo único | I11 |
| DT-M11 | La regla «BRUTA ⇒ merma < 100» en la aplicación **y** un disparador de refuerzo en las tres tablas de líneas (si el dueño prefiere cero disparadores, solo la aplicación) | `CHECK` no puede mirar otra tabla |
| DT-M12 | La marca se **hereda** de la versión anterior de la serie `(producto, sucursal)`; sin anterior, `BRUTA` | I5 y Q-M1 |
| DT-M13 | Los textos son los **ya aprobados**: «Bruto», «Merma», «Neto». En una receta `NETA` el campo que se tipea se rotula «Neto» y se muestra «Bruto» calculado; en una `BRUTA`, al revés. **Ningún texto nuevo** | Regla «lo que el dueño no pidió no entra» |

## 9. Nivel 8, 9 y 10 (acceso, consultas, pruebas, migración y operación)

### Nivel 8. Acceso
Sin claves nuevas ni cambios de piso: editar recetas = permiso actual de recetas; calibrar por sucursal = el actual; ver costos = `reporte_costos`. Pedernal: `composiciones.editar` (gerente y administrador): mismo piso.

### Nivel 9. Consultas y experiencia (375 px primero)
- Pantalla de receta: cada línea muestra **Bruto, Merma, Neto**; el campo que se tipea depende de la marca (DT-M13). La merma inválida se marca **en el campo** y apaga «Guardar», **sin texto al lado** (decisión del dueño del 13/11 para Pedernal). El neto se muestra con 4 decimales a lo sumo.
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

-- Opciones y combinaciones con merma (decide Q-M2 con datos reales).
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
| NETA (existente), merma 20 % | neto 800 g | bruto 960 g (**igual que hoy**); neto 800 g |
| NETA con merma 1.000 % (heredada) | neto 10 g | bruto 110 g (igual que hoy) |
| Merma 0 en cualquier base | 500 g | bruto = neto = 500 g |
| BRUTA, merma 100 % o negativa | cualquiera | se rechaza |
| BRUTA, merma 99,99 % | bruto 100 g | neto 0,01 g |
| Redondeo del neto | bruto 0,3333, merma 10 % | 0,29997 → **0,3000** (mitad que se aleja del cero, una sola vez) |
| Calibración local en BRUTA | cantidad propia 250 g | descuenta 250 g en esa sucursal |
| «Usar este valor», NETA | bruto estimado 960 g, merma 20 % | escribe 800 g |
| «Usar este valor», BRUTA | bruto estimado 960 g | escribe 960 g |
| Versión nueva con anterior NETA | cualquiera | marca `NETA` (hereda) |
| Primera versión | cualquiera | marca `BRUTA` |
| Marca ilegible | — | la operación falla con error; nunca se asume |

**Pruebas obligatorias por etapa:**
- **M0:** las **caracterizaciones existentes** (lista de §1) **sin cambiar una sola línea esperada**; propiedad `factor(m)` en `number` = versión `Decimal` en una grilla; el guardián `formula-de-merma-unica`; `knip` con consumidor real (los cinco archivos).
- **M2:** migración con ida, `down.sql`, ida (el esquema queda igual); el `down` se niega con `BRUTA` presentes; compatibilidad hacia atrás (insertar sin nombrar la columna da `NETA`).
- **M3a:** **ninguna diferencia observable**: toda la batería de regresión igual con la marca en `NETA` en todo lo existente; un lector que no lee la marca no pasa el guardián de lectores.
- **M3b:** oráculo completo; **concurrencia** (dos ediciones de la misma receta a la vez; una venta mientras se guarda una versión nueva; dos calibraciones simultáneas de la misma línea); **idempotencia** (guardar dos veces la misma versión, doble clic en «Usar este valor», venta repetida: el stock no se descuenta dos veces); **aislamiento** (una empresa no ve ni afecta recetas de otra; RLS); **atomicidad** (corte a mitad de guardar: ninguna versión a medias); **E2E** a 375 px de la pantalla de receta y del reporte de rendimiento; regresión de que una receta `NETA` editada **sigue** dando su resultado.
- **Gate** (`AGENTS.md`), en la misma corrida y limpios: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Ensayo sobre copia (obligatorio antes de M2 en cada base):** (1) copia reciente de la base en una rama descartable; (2) correr las consultas de §9 y guardar el resultado; (3) aplicar M2 y sus tablas hermanas; (4) correr la batería de caracterizaciones y las sumas de control (conteo de versiones y de líneas, suma de `cantidad` y de `mermaPorcentaje`, suma de `MovimientoStock.cantidad` y de costos): **idénticas a las del paso 2**; (5) desplegar M3a en la copia y repetir la batería: idéntica; (6) encender M3b en la copia, crear una receta nueva, venderla y producirla, y comparar con el oráculo; (7) correr el `down` (debe negarse si hay `BRUTA`), apagar M3b, volver a probar; (8) aplicar de nuevo. **Nunca sobre la rama principal de la base de producción.**

**Verificación previa por base:** las consultas de §9 con su resultado, enviadas al dueño en el repositorio privado de documentos (este documento público no lleva los datos reales).

## 10. Preguntas de NEGOCIO abiertas

> Cada una cambia lo que ve el cliente, el stock o el costo. Una clave por pregunta.

- **Q-M1 — Cuando alguien edita una receta vieja (cargada como neta), ¿qué pasa?**
  - **A (recomendada):** **sigue siendo `NETA`**: la versión nueva hereda cómo se cargó la anterior, y la pantalla le muestra «Neto» para tipear y «Bruto» calculado (palabras ya aprobadas). Es lo que implica «no reescribir las viejas». Las recetas nuevas, desde cero, son en bruto.
  - **B:** al guardar, el sistema la **convierte** a bruto. Conserva lo que se descuenta del stock, pero el neto mostrado puede diferir unas centésimas (§6.4). Reescribe lo que la persona cargó.
  - **C:** al editarla, la pantalla le pide **volver a cargar** el bruto de cada línea (con el valor viejo como referencia). Es lo más limpio y lo más trabajoso.
  - **Si no se responde:** rige A (no cambia nada de lo cargado).
- **Q-M2 — Los consumos de las **opciones** y de las **combinaciones** (que también tienen merma en Motor2, y no en Pedernal): ¿se cargan también en bruto?**
  - **A (recomendada):** sí, con la misma marca por versión: **una sola regla en todo el sistema**.
  - **B:** se dejan como están (neto con merma sumada): quedan **dos fórmulas para siempre** y el guardián no puede exigir una sola.
  - **Si no se responde:** rige B (no se cambia lo que no se pidió); pero la función única (M0) igual las cubre con la fórmula de hoy.
  - **Dato que ayuda a decidir:** la última consulta de §9 dice cuántas líneas de opciones y combinaciones tienen merma en cada base. Si es cero en todas, A no cuesta nada. (Sacar la merma de opciones y combinaciones, como Pedernal, sería una **poda**: se menciona como sugerencia, **no** se diseña ni se hace sin pedido.)

## 11. Qué hay que autorizar expresamente

**Hallazgo honesto:** con la opción recomendada (marca por versión, Q-M1 = A) **esta pieza no reescribe ningún dato existente.** M2 es aditiva y reversible (cubierta por la autorización permanente del 2026-11-15). Lo que sí cambia es **cómo se calculan las recetas nuevas**, y eso conviene que lo diga el dueño por escrito, porque mueve stock y costo.

**Autorización X (para encender la carga en bruto, M3b; por despliegue, nombrando las bases):**

> «Autorizo encender la carga de recetas en bruto (neto = bruto × (1 − merma)) en [LISTA DE BASES], a partir del [FECHA], sabiendo que **las recetas ya cargadas siguen dando exactamente el mismo costo y el mismo descuento de stock** y que solo las recetas nuevas se cargan en bruto. Vi el resultado de las consultas de recuento de cada base el [FECHA] y el ensayo sobre copia.»

**Alcance:** solo recetas **nuevas** (y, si Q-M2 = A, consumos nuevos de opciones y combinaciones); **no** cambia ningún dato ya cargado, ni costos ni ventas ya registradas; se puede **apagar** M3b (deja de escribirse `BRUTA`; las ya escritas se leen bien). Vale para las bases nombradas.

**Autorización Y (SOLO si el dueño elige la opción B de Q-M1, o pide convertir las recetas viejas):**

> «Autorizo convertir al bruto, en la base [NOMBRE], las [N] recetas vigentes cargadas como netas, **sabiendo que el neto mostrado puede diferir unas centésimas** y que lo que se descuenta del stock se conserva. La conversión crea una versión nueva de cada receta (la vieja queda en el historial) y se puede deshacer volviendo a vigente la versión anterior.»

**Alcance:** solo la base nombrada; se aplica receta por receta con una versión nueva (**no** reescribe la versión vieja); requiere ensayo sobre copia con el neto antes y después de cada receta; **no** incluye opciones ni combinaciones salvo que se nombren.

**Condiciones previas que se muestran junto al pedido:** el recuento de §9 de esa base; el resultado del ensayo (sumas de control idénticas, oráculo verde, `down` probado); una copia o respaldo reciente; quién lo despliega y cuándo.

## 12. Etapas (la más barata primero) y supuestos

1. **M0 — función única, sin cambiar resultados.** Sin migración. **Primero y solo.** Es la que no necesita ninguna decisión pendiente.
2. **M1 — consultas de recuento por base.** Sin migración.
3. **M2 — la marca** (aditiva). Entra en la autorización permanente.
4. **M3a — leer la marca** en todos los consumidores (sin cambiar lo que se escribe).
5. **M3b — escribir en bruto** y la pantalla de Bruto/Merma/Neto. Con la autorización X.
6. **Etapas posteriores con nombre (NO pedidas):** pasar a bruto una receta vieja con un botón explícito; ensanchar la precisión de la merma; sacar la merma de opciones y combinaciones (poda).

**Supuestos declarados (el dueño los corrige):** S1 las recetas viejas siguen siendo netas y dan lo mismo que hoy; S2 una receta nueva sin versión anterior es bruta; S3 el neto es solo para mostrar y reportar, nunca se guarda; S4 no se recalculan costos ni stock ya registrados.

## 13. Diferencias con Pedernal (cada una con su motivo)

| Tema | Pedernal | Motor2 tras este diseño | Motivo |
|---|---|---|---|
| Base de la cantidad | Siempre bruto | Bruto en lo nuevo; neto (`NETA`) en lo ya cargado, marcado | **Datos existentes** y N-5 (dueño, 2026-11-14) |
| Precisión de la merma | `numeric(7,4)` | `Decimal(6,2)` | **Datos existentes** (DT-M7) |
| Rango de la merma | `0 ≤ p < 100` con `CHECK` | `< 100` en la aplicación y disparador de refuerzo para `BRUTA`; lo viejo hasta 1.000 % | **Datos existentes**; `CHECK` no mira otra tabla (DT-M11) |
| Merma en opciones y combinaciones | No existe | Existe; Q-M2 | **Datos existentes** |
| Calibración por sucursal | No existe | Existe; hereda la base de su línea | **Datos existentes** |
| Dónde decide la fórmula | Un archivo (`merma.ts`) | Una función única más guardián (M0) | Igual en la forma |
| Aritmética | Enteros exactos | Conserva `number` donde hoy lo es (M0); nuevo en `Decimal` | **Datos existentes**: reescribir no se pidió (I7) |
| Migraciones | SQL crudo | Prisma + `down.sql` | **Prisma** |

## 14. Riesgos y pendientes

- **Marcha atrás de M3b con `BRUTA` ya escritas** (§7.5): por eso M3a va antes y no se retira.
- **Un lector que se olvide de la marca** leería una versión `BRUTA` como `NETA` y descontaría de más: lo cubren el embudo único, el guardián de lectores (DT-M9) y el guardián de la fórmula (DT-M10).
- **Dinero con números de JavaScript** en `costos.ts` y los sitios de stock: sigue (no se reescribe); anotado como deuda aparte.
- **Dos fórmulas coexistiendo** mientras haya recetas `NETA` (y para siempre si Q-M2 = B): es el costo de no reescribir.
- **Recetas con merma ≥ 100 ya cargadas** (válidas hoy): siguen válidas como `NETA`; en Pedernal serían inválidas. Diferencia declarada (§13).
- **El «sexto archivo» de la fórmula** que mencionó el encargo no se encontró (§1): si existe, M0 lo encuentra con el guardián.
- **Congelamiento de producción:** nada se aplica ni se despliega desde este documento.
- **Sugerencias (no implementadas):** botón explícito «pasar a bruto»; ensanchar la merma a 4 decimales; poda de la merma en opciones y combinaciones.
