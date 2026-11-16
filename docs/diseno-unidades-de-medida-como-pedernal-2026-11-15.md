# Diseño: unidades de medida como Pedernal (14 fijas, conversión exacta, las existentes «a la más parecida») — 2026-11-15

> Diseño en papel, escalera de 10 niveles (`AGENTS.md`). **No se escribió código, ni migraciones, ni se tocó ninguna base.** El nivel 6 es un **esquema PROPUESTO: no se migra hasta confirmar los niveles 1 a 5.** Documento público: redacción genérica, sin nombres de clientes, cifras reales ni identificadores de bases.
>
> **Marcas.** **VERIFICADO** (archivo:línea): lo leí en el código. **CONFIRMADA**: lo dijo el dueño, con cita. **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**.
> **Fuentes.** Motor2: `origin/main` `b36de06`. Pedernal: repositorio `ZuluHub-ERP` `243432a` (código leído: `src/primitivas/unidades/unidades.ts`, `convertir-cantidad.ts`, `src/capacidades/vocabulario/unidades-de-medida.ts`, `migraciones/0025_catalogo.sql`) y `ZuluHub-docs` `b179a9f` (ficha `conceptos/unidad-de-medida.md`, `presentacion-de-compra.md`).
> **Pieza hermana:** `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` (comparten la regla de cantidades y el orden de entrega).
> **No confundir:** «unidad de medida» (kg, litro) no es la «unidad de negocio» del diseño `docs/diseno-categoria-unidad-y-rubro-2026-11-06.md`.

---

## 0. Resumen para el dueño

**Qué hay hoy.** Cada empresa tiene su propia lista de unidades. Las que el sistema siembra son cinco (kg, g, l, ml, unidad) y cualquier persona con el permiso `unidades` puede crear más («caja», «pack», «docena»…). Cada unidad tiene una de tres «magnitudes» (peso, volumen, cantidad) y unos decimales que se pueden cambiar. **El sistema no sabe que 1 kg son 1.000 g**: esa relación solo existe como una lista de dos pares escrita por nombre en la pantalla de recetas. La conversión entre unidades de compra y de stock la tipea una persona producto por producto (el «factor»).

**Qué hace Pedernal.** Una lista **cerrada de 14 unidades** (unidad, gramo, kilogramo, tonelada, mililitro, litro, metro cúbico, milímetro, centímetro, metro, centímetro cuadrado, metro cuadrado, minuto, hora), cada una con su dimensión y un factor entero a la unidad base de su dimensión. Convertir entre dos unidades de la misma dimensión es **exacto o se rechaza, nunca redondea**.

**Lo que se propone (la forma más barata).** **No reescribir ninguna fila que ya apunta a una unidad.** A cada unidad que la empresa ya tiene se le **anota a cuál de las 14 equivale** (una columna nueva, vacía al principio). Las que no tienen una equivalente clara quedan **«pendiente de completar»** y siguen funcionando exactamente como hoy. Nada se borra, ningún número cambia, ninguna cantidad se convierte. Lo que ve la persona pasa a ser la lista de 14 con los nombres de Pedernal.

**Por qué no «re-apuntar» todo a 14 filas nuevas.** Habría que cambiar la unidad en 12 tablas, varias de las cuales **solo se agregan** (movimientos de stock, renglones de factura, versiones de receta). Reescribirlas contradice esa regla y no se puede deshacer limpio. La alternativa recomendada logra el mismo resultado visible sin tocarlas.

| Etapa | Qué | Migración | Quién autoriza |
|---|---|---|---|
| **U0** | La lista de 14 y la conversión exacta como código puro y probado, más la consulta y el informe de solo lectura que cuentan qué tocaría la equivalencia en cada base | **Ninguna** | Nadie: es código sin efecto sobre datos |
| **U1** | Una columna `Unidad.codigoFijo` (vacía) con su restricción | **Aditiva y reversible** (`down.sql`) | Autorización permanente del 2026-11-15 |
| **U1b** | **Rellenar** esa columna base por base con la tabla de equivalencias revisada | **Escribe datos existentes** (solo la columna nueva) | **Autorización EXPRESA, por base, con ensayo** (§11) |
| **U2** | El código lee la equivalencia: nombres de las 14, conversión exacta, guardia de unidad por factor; las empresas nuevas nacen con las 14; se cierra crear unidades a mano | Ninguna | Se despliega con la tabla ya rellenada |
| **U3** | Agregar a las empresas existentes las unidades de las 14 que les falten | Inserciones aditivas | Autorización expresa (se agrupa con U1b) |

**Qué NO entra (no se pidió):** fusionar unidades duplicadas, cambiar la unidad de un producto, renombrar presentaciones, peso variable, porciones. Quedan como etapas posteriores con nombre (§12).

---

## 1. Nivel 1. Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| N-1 | Motor2 igual a Pedernal en todo: mismo resultado y misma forma, salvo lo que imponen Prisma, RLS o los datos ya existentes | Dueño, 2026-11-13: «Necesitamos ser iguales en todo… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» (regla permanente de `AGENTS.md`) | CONFIRMADA |
| N-2 | Estado final de las unidades: las 14 fijas de Pedernal | Dueño, 2026-11-15, chat con el orquestador: «Igual a pedernal» (fecha confirmada por el orquestador; el plan de paridad la registra en el bloque del 14/11; fuente: `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Preguntas de datos del plan de paridad») | CONFIRMADA |
| N-3 | Las unidades que cada empresa ya creó se pasan a la más parecida de las 14 | Dueño, 2026-11-15, chat con el orquestador: «Convertir cada una a la más parecida» (misma fuente). **No autoriza ninguna migración que reescriba datos** | CONFIRMADA |
| N-4 | Los nombres que se ven son los de la maqueta de productos de Pedernal | Dueño (de Pedernal), 2026-11-13, T2a: «las 14 unidades se muestran con los nombres de la maqueta de productos» (`decisiones-del-dueno-2026-11.md`, fila del 13/11) | CONFIRMADA (Pedernal) |
| N-5 | Orden de las etapas: «Primero la opción más barata»; este tema reescribe datos y necesita autorización expresa por base y con ensayo | `AGENTS.md`; encargo del orquestador | CONFIRMADA |

**Fuera de alcance (no se pidió):** la unidad de venta separada de la de stock, el nombre de las presentaciones de compra, el peso variable, las porciones, fusionar duplicadas, el rediseño de la pantalla de unidades más allá de cerrar el alta a mano. Cualquiera de ellas es sugerencia, no código.

**Inventario de lo que ya existe (VERIFICADO en `origin/main`).**

- **Modelo.** `Unidad` por empresa, con RLS: `nombre`, `magnitud` (`PESO|VOLUMEN|CANTIDAD`, enum `MagnitudUnidad`), `activa`, `decimales` (0 a 6), únicos `(empresaId, nombre)` (`prisma/schema.prisma:592-616`). **No tiene factor ni relación con otras unidades.**
- **Quién la referencia (clave foránea `(empresaId, id)`):** `Producto.unidadStockId` (obligatoria) y `unidadCompraId` + `factorConversion` (`:371-376`); `Presentacion` (`:620-632`); `ProveedorPorProducto` (`:731`); `RecetaIngrediente.unidadId` (`:862`); `RecetaVersion.rendimientoUnidadId` y `racionUnidadId` (`:807-816`); `ConsumoDeOpcion.unidadId` (`:3674`); `RecetaDeCombinacionIngrediente.unidadId` (`:3947`); `MovimientoStock.unidadCompraId` con `cantidadCompra` (`:1421-1426`); `FacturaProveedorRenglon.unidadCompraId` (`:2855`). Son **diez referencias en nueve modelos**; las de movimientos, renglones de factura, versiones de receta y versiones de opción son tablas que solo se agregan.
- **Siembra:** `src/core/features/empresa/siembra-de-empresa.ts:10-20` y `prisma/seed.ts:92-100`: kg y l con 2 decimales, g, ml y unidad con 0.
- **Alta a mano:** `src/server/actions/catalogo/unidades.ts` (`crearUnidad`, permiso `unidades`), caso de uso `crear-unidad.ts`, guardia `src/core/features/catalogo/unidades.guard.ts`; pantalla `src/app/(app)/catalogo/unidades/page.tsx`; cambio de decimales con rechazo si un producto «se produce» queda con un paso que ya no entra (`actualizar-decimales-unidad.ts:37`).
- **La relación kg↔g por nombre:** `PARES_DE_UNIDADES` en `src/core/catalogo/lectura-de-cantidad.ts:17-20`, usada también por la guardia de unidad (`src/core/catalogo/guardia-de-unidad.ts:33-36`, umbral por magnitud ×1000 si la unidad se llama «g» o «ml») y por `unidadesDeLectura`.
- **Redondeo de cantidades:** el stock se redondea a `Unidad.decimales` de la unidad de stock (`armar-linea-de-movimiento.ts:76,173,185,198`; `registrar-movimiento.ts:139-144`). Es la diferencia de fondo con Pedernal (§5, I3).
- **Conversión de compra:** `convertirCantidadAUnidadDeStock(cantidad, factor, decimales)` (`src/core/movimientos/transiciones.ts`, exportada por `public.ts`; usada en `armar-linea-de-movimiento.ts:173`), con el factor tipeado por producto. Compras con unidad en otra magnitud exigen «peso real» (`src/core/features/compras/compra.guard.ts:35-49`).
- **Consumidores de lectura:** 44 archivos de `src/server/consultas`, `src/server/lecturas` y `src/app` nombran `unidadStock` o `unidadCompra` (cuenta de `grep`; el detalle se arma con `Explore` al implementar U2).
- **Importadores:** no encontré ningún importador que lea unidades por nombre en `src/` (`grep` de «importar/importaci»: solo tablas y vistas previas). Los scripts de demostración (`scripts/seed-demo-*`, `scripts/demo-seed/`) crean unidades por nombre: se actualizan en U2. NO VERIFICADO que no exista una carga por planilla fuera de `src/`.
- **Pedernal (VERIFICADO leyendo el código):** tabla global `unidad_de_medida` sembrada, de solo inserción, con `id`, `dimension`, `simbolo`, `factor_a_base` (entero), `es_base` y restricciones (`0025_catalogo.sql:97-115`); primitiva `UNIDADES` y `convertirCantidad` (aritmética entera `bigint`: dimensión, exactitud, rango, en ese orden, a 4 decimales, `numeric(18,4)`); `Record<CodigoDeUnidad, ClaveDeTexto>` que obliga a que toda unidad tenga nombre; la unidad base del producto **no cambia nunca** (disparador `producto_unidad_inmutable`); la presentación de compra («caja de 12») es un **nombre + cantidad en la unidad base**, no una unidad.

---

## 2. Nivel 2. Actores y contexto

- **Quien administra el catálogo** (permiso `unidades` hoy; en Pedernal las unidades no las crea nadie: son una lista cerrada). Después de este cambio no crea unidades; **elige** entre las 14.
- **La plataforma / el alta de empresa** (siembra): hoy 5 unidades; pasa a 14.
- **El dueño**: revisa y autoriza la tabla de equivalencias de cada base antes de U1b.
- **Cada empresa es un cliente aislado** (RLS, `app_empresa_actual()`): la tabla de equivalencias y su aplicación son por empresa y por base; ninguna empresa ve ni afecta a otra.
- **Producción y bases de prueba:** hay más de una base. Las cifras de qué filas se tocan se cuentan **en cada una** con la consulta de §9.

## 3. Nivel 3. Casos de uso

| # | Caso de uso | Etapa |
|---|---|---|
| CU-1 | Elegir la unidad de stock y la de compra de un producto **dentro de las 14** | U2 |
| CU-2 | Ver las unidades existentes ya con el nombre de la equivalente (la unidad «kg» se ve «Kilogramo») y el nombre original conservado | U2 |
| CU-3 | Una unidad sin equivalente clara se ve «pendiente de completar», sigue funcionando como hoy, y se resuelve de a una | U1b/U2 |
| CU-4 | Convertir una cantidad entre unidades de la misma dimensión de forma exacta o rechazarla | U0/U2 |
| CU-5 | Una empresa nueva nace con las 14 | U2 |
| CU-6 | Crear una unidad a mano: **cerrado** (no existe en Pedernal) | U2 |
| CU-7 | Informe de solo lectura: qué unidades tendrían equivalente, cuáles no, y qué filas dependen de cada una | U0 |

## 4. Nivel 4. Conceptos y ciclo de vida

**Las 14 (copia exacta de Pedernal; los factores no cambian nunca).**

| Código | Dimensión | Factor a la base | Nombre que se ve | Símbolo |
|---|---|---|---|---|
| UNIDAD | CONTEO | 1 (base) | Unidad | u |
| GRAMO / KILOGRAMO / TONELADA | MASA | 1 (base) / 1.000 / 1.000.000 | Gramo / Kilogramo / Tonelada | g / kg / t |
| MILILITRO / LITRO / METRO_CUBICO | VOLUMEN | 1 (base) / 1.000 / 1.000.000 | Mililitro / Litro / Metro cúbico | ml / l / m3 |
| MILIMETRO / CENTIMETRO / METRO | LONGITUD | 1 (base) / 10 / 1.000 | Milímetro / Centímetro / Metro | mm / cm / m |
| CENTIMETRO_CUADRADO / METRO_CUADRADO | SUPERFICIE | 1 (base) / 10.000 | Centímetro cuadrado / Metro cuadrado | cm2 / m2 |
| MINUTO / HORA | TIEMPO | 1 (base) / 60 | Minuto / Hora | min / h |

**Estados de una unidad de la empresa (PROPUESTA).**

- **SIN_EQUIVALENTE** (`codigoFijo` vacío): estado de partida de toda unidad existente. Funciona como hoy; se muestra «pendiente de completar» y su nombre original.
- **CON_EQUIVALENTE** (`codigoFijo` con uno de los 14): se muestra el nombre de la equivalente; el nombre original queda guardado (es la columna `nombre` de siempre, que **no se toca**).
- No hay vuelta atrás automática: pasar de CON a SIN o cambiar de código es una acción explícita y auditada (I7).

**Qué significa «la más parecida» (PROPUESTA):** una unidad existente es **equivalente** a una de las 14 solo si 1 de la vieja = 1 de la nueva, en la misma dimensión. Eso cubre kg, kilo, gr, g, l, lt, ml, cc, «unidad», «un», «u». **Todo lo que no sea exactamente 1 a 1** («docena» = 12, «par» = 2, «media docena») **no se convierte**: quedaría una cantidad distinta de la que se cargó. Esas, y las que no tienen dimensión clara, quedan «pendiente de completar».

**Qué pasa con «caja», «pack», «bolsa», «botella»** (unidades de compra que no son medidas). En Pedernal son **presentaciones** (nombre + cantidad en la unidad base), no unidades. En Motor2 hoy son una unidad con un factor al stock. La más parecida de las 14 es **UNIDAD** (1 caja = 1 de conteo; el contenido sigue en el `factorConversion` del producto). La cantidad cargada («3 cajas») y el stock resultante (3 × 4,5 kg) **no cambian**. Lo que se pierde es solo el *nombre* «caja» en pantalla; por eso el nombre original se conserva y la pantalla puede seguir mostrándolo junto a la unidad. **CONFIRMADA por el dueño (Q-U2, 2026-11-15).**

## 5. Nivel 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | Los factores de las 14 **no cambian nunca** (cambiar uno revaluaría la historia en silencio). Una prueba compara el código con la restricción de la base | PROPUESTA (CONFIRMADA en Pedernal) |
| I2 | **La conversión entre unidades de la misma dimensión es exacta o se rechaza**: `DIMENSION_DISTINTA`, `CONVERSION_NO_EXACTA`, `FUERA_DE_RANGO`, en ese orden. Entero `bigint`, sin `number`, sin reloj ni azar | PROPUESTA (CONFIRMADA en Pedernal, «decisión 21 y 92» según el código; NO VERIFICADO el texto del dueño) |
| I3 | **Diferencia declarada con Pedernal:** Pedernal guarda todas las cantidades con 4 decimales y nunca redondea; Motor2 redondea el stock a `Unidad.decimales` de la unidad de stock (kg 2, g 0, etc.) **y esas cantidades ya están guardadas así**. Motivo: **datos existentes** (reescribir la precisión cambiaría stock y costos históricos). Esta etapa **no toca** los decimales de las unidades que ya existen; las unidades nuevas (U3 y empresas nuevas) nacen con los decimales de la siembra actual | PROPUESTA (se declara; no se pide al dueño) |
| I4 | **Una equivalencia solo se asigna entre unidades de la misma dimensión y de relación 1 a 1.** Nunca una que cambie la cantidad | PROPUESTA |
| I5 | **Nada se pierde:** el nombre original, el `id` de la unidad, los decimales y toda fila que la referencia quedan idénticos. El cambio es una columna nueva | PROPUESTA |
| I6 | **Nace cerrado:** sin equivalencia declarada la unidad es «pendiente de completar»; el sistema nunca adivina (por nombre en tiempo de ejecución, tampoco) | PROPUESTA (regla del 2026-11-11, `AGENTS.md`) |
| I7 | Asignar, cambiar o quitar una equivalencia es una acción con permiso en el servidor, atómica con su registro de auditoría (quién, cuándo, de qué a qué), idempotente (repetirla no deja un registro nuevo) | PROPUESTA |
| I8 | **Coherencia del factor:** si la unidad de compra y la de stock de un producto son de la misma dimensión, su `factorConversion` tiene que coincidir con el cociente de la tabla (kg→g = 1.000). Si no coincide, **no se corrige solo**: se marca «pendiente de revisar» y se cuenta | PROPUESTA |
| I9 | Aislamiento: el rellenado y las lecturas filtran por empresa; una empresa jamás usa la equivalencia de otra | VERIFICADO (RLS en `Unidad`, `20260929120000_multiempresa_rls`) |
| I10 | Dinero: el costo por unidad de stock, el stock y los totales valorizados **no cambian**; se verifican con una suma de control antes y después (§9) | PROPUESTA |
| I11 | Las 14 son una lista cerrada con `CHECK` en la base; una unidad nueva de la lista es una migración, no una pantalla | PROPUESTA |

## 6. Nivel 6. Historia y persistencia — **ESQUEMA PROPUESTO: no se migra hasta confirmar los niveles 1 a 5**

### 6.1 U1: una columna, aditiva y reversible

```sql
-- migration.sql (PROPUESTA, no aplicar)
ALTER TABLE "Unidad" ADD COLUMN "codigoFijo" TEXT;
ALTER TABLE "Unidad" ADD CONSTRAINT "Unidad_codigoFijo_chk" CHECK ("codigoFijo" IS NULL OR "codigoFijo" IN
  ('UNIDAD','GRAMO','KILOGRAMO','TONELADA','MILILITRO','LITRO','METRO_CUBICO','MILIMETRO','CENTIMETRO','METRO',
   'CENTIMETRO_CUADRADO','METRO_CUADRADO','MINUTO','HORA'));

-- down.sql (PROPUESTA): no destructiva respecto de los datos de negocio; solo borra la anotación
ALTER TABLE "Unidad" DROP CONSTRAINT IF EXISTS "Unidad_codigoFijo_chk";
ALTER TABLE "Unidad" DROP COLUMN IF EXISTS "codigoFijo";
```

- Sin índice único: dos unidades de una empresa pueden ser equivalentes a la misma (por ejemplo «kg» y «Kilo»). Fusionarlas es una etapa posterior que nadie pidió.
- **Sin tabla nueva** (el factor y la dimensión viven en código, como en Pedernal, y una prueba los compara con el `CHECK`). Una tabla «a ciegas» que nadie escribe queda descartada (`AGENTS.md`).
- **Magnitud:** el enum `MagnitudUnidad` tiene tres valores; las 14 tienen seis dimensiones. **Decisión técnica DT-U2** (§8): U2/U3 necesitan valores nuevos en el enum para sembrar metro, metro cuadrado, hora, etc. `ALTER TYPE … ADD VALUE` es aditivo pero **Postgres no permite sacar un valor de un enum**: el `down.sql` lo deja (valores sin uso, inertes) y lo declara.
- Metadatos del cambio: es una columna nullable sin valor por defecto (cambio instantáneo, sin reescribir la tabla).

### 6.2 U1b: rellenar (escribe datos existentes, solo la columna nueva)

Un script de operaciones por base, a la manera de `scripts/operaciones/m0-iva-condicion-de-la-empresa.sql` (precedente verificado: SQL a mano, como dueño de la base, en una transacción). Recibe la **tabla de equivalencias ya revisada para esa base** (empresa, id de la unidad, código) y:

1. Verifica antes: que la unidad existe, que su magnitud es compatible con la dimensión del código (PESO→MASA, VOLUMEN→VOLUMEN, CANTIDAD→CONTEO) y que `codigoFijo` está vacío.
2. `UPDATE "Unidad" SET "codigoFijo" = … WHERE id = … AND "codigoFijo" IS NULL` (idempotente: repetirlo no cambia nada).
3. Deja un registro de auditoría por unidad (el mecanismo exacto —`registrarCambioAuditado` desde un script— **NO VERIFICADO**; se resuelve al implementar, y si no se puede, el propio script registra qué cambió en su salida firmada).
4. Reversa: `UPDATE "Unidad" SET "codigoFijo" = NULL WHERE "codigoFijo" IS NOT NULL AND id IN (lista del script)`.

**La regla por nombre es solo de la propuesta, no del script:** el script no adivina; ejecuta la lista que el dueño revisó. La propuesta de la lista sale de U0 (informe de solo lectura), con esta tabla:

| Nombre normalizado (sin mayúsculas, sin puntos) + magnitud | Propuesta |
|---|---|
| kg, kilo, kilos, kilogramo(s) + PESO | KILOGRAMO |
| g, gr, grs, gramo(s) + PESO | GRAMO |
| l, lt, lts, litro(s) + VOLUMEN | LITRO |
| ml, cc, mililitro(s) + VOLUMEN | MILILITRO |
| unidad, un, u, unid, unidades + CANTIDAD | UNIDAD |
| caja, pack, bolsa, botella, lata, paquete, bandeja, atado… + CANTIDAD | UNIDAD (Q-U2 CONFIRMADA: «a Unidad») |
| cualquier nombre con otro cociente (docena, par…) + CANTIDAD | **pendiente de completar** (red de seguridad; Q-U1: no se crea nada y se usa la lista de Pedernal) |
| cualquier otro nombre, o magnitud que no calza con el nombre (p. ej. «kg» con magnitud CANTIDAD) | **pendiente de completar** |

### 6.3 U3: completar las 14 en las empresas existentes

Insertar, por empresa, las unidades de las 14 que **ninguna de sus unidades ya cubre**, con el nombre de Pedernal y los decimales de la siembra. Respeta el único `(empresaId, nombre)`: si ya existe una unidad con ese nombre exacto y sin equivalencia, **no se inserta ni se pisa**: se asigna la equivalencia a la existente (en U1b) o se omite y se cuenta. `down`: borrar solo las filas insertadas y sin ninguna referencia (se identifican por una marca en el script, no por el nombre).

### 6.4 Lo que se evaluó y se descartó

- **Re-apuntar las diez referencias a filas nuevas y desactivar las viejas** (opción B). Descartada: reescribe tablas que solo se agregan, no es reversible sin una copia completa y tocaría todo lo valorizado. Solo se reconsidera si el dueño pide eliminar las unidades viejas (etapa posterior).
- **Tabla global `UnidadDeMedida` como Pedernal.** Descartada por ahora: Motor2 tiene claves foráneas compuestas `(empresaId, id)` hacia `Unidad` en nueve modelos (motivo: **Prisma y los datos existentes**, no criterio). La columna logra el mismo resultado visible. Diferencia declarada.
- **Derivar la equivalencia por nombre en tiempo de ejecución** (sin tocar la base). Descartada: es exactamente la forma frágil que hoy tiene `PARES_DE_UNIDADES` y viola I6 (adivinar).

## 7. Nivel 7. Atomicidad y concurrencia — «¿qué pasa si…?»

### 7.1 Asignar o cambiar la equivalencia de una unidad (U1b y luego U2)

| Situación | Resultado |
|---|---|
| Repetición / doble clic / script corrido dos veces | Una sola asignación; la segunda no escribe ni audita (`WHERE "codigoFijo" IS NULL` o mismo valor) |
| Concurrencia (dos administradores asignan códigos distintos a la misma unidad) | Gana el primero; el segundo recibe «ya tiene equivalencia» y no pisa (condición en el `UPDATE`) |
| Concurrencia con una venta o una compra que usa esa unidad | No hay conflicto: la fila de la unidad no se bloquea para lectura y los movimientos no cambian |
| Tiempo (se asigna con movimientos ya cargados) | Los movimientos históricos quedan idénticos; solo cambia cómo se rotula la unidad |
| Incertidumbre (la unidad podría ser «caja» o «docena») | Queda «pendiente de completar»; nunca se asigna por parecido de nombre |
| Reintento tras un corte | Idempotente: el script parte de lo que ya está asignado |
| Error parcial (cae en la mitad) | **Todo o nada**: una transacción por base; sin asignaciones a medias |
| Datos faltantes (unidad sin magnitud compatible) | Se omite y se cuenta; la corrida termina distinto de cero si hay filas rechazadas, para que se revise |
| Cambio de permisos durante la corrida | El script corre como dueño de la base (autorización expresa); la pantalla de U2 verifica `unidades` en el servidor en cada pedido |

### 7.2 Convertir una cantidad (U0/U2)

| Situación | Resultado |
|---|---|
| Misma dimensión, cociente entero que cabe en 4 decimales | Resultado exacto |
| 1 g a toneladas (0,000001) | `CONVERSION_NO_EXACTA`: se rechaza, no se redondea |
| Otra dimensión (kg con litros) | `DIMENSION_DISTINTA` |
| Resultado fuera de `numeric(18,4)` | `FUERA_DE_RANGO` |
| Unidad sin equivalencia | No hay conversión; el flujo actual (factor tipeado) sigue igual; se muestra «pendiente de completar» |
| Concurrencia | Función pura: no hay estado |

### 7.3 Crear una unidad a mano (U2)

| Situación | Resultado |
|---|---|
| Alguien arma el pedido a mano | El servidor lo rechaza (la acción deja de aceptar altas), **después** de verificar el permiso `unidades`, sin texto nuevo |
| Se quiere volver a abrir | Un interruptor reversible en `src/core/` (molde: `ESTA_BIEN_ASI_VISIBLE`); no hay datos que tocar |

### 7.4 Alta de una empresa nueva (U2)

Sembrar las 14 en la **misma transacción** del alta de la empresa (hoy siembra 5, `siembra-de-empresa.ts`): o nace con las 14 o no nace. Repetir el alta no duplica (único `(empresaId, nombre)` y `upsert`, como hoy en `prisma/seed.ts:99-100`).

## 8. Decisiones técnicas (sin pregunta al dueño; PROPUESTAS, el orquestador las acepta o corrige)

| # | Decisión | Motivo |
|---|---|---|
| DT-U1 | La equivalencia es una **columna** en `Unidad`, no una tabla ni una reescritura | Nueve modelos la referencian con clave compuesta; varios son solo-agregar |
| DT-U2 | Ampliar `MagnitudUnidad` con `LONGITUD`, `SUPERFICIE`, `TIEMPO` en una migración **aparte** (la de U3), no en U1 | `ADD VALUE` no se deshace; si el dueño no quiere esas dimensiones el resto sigue funcionando. Hasta entonces la dimensión sale del `codigoFijo`, no de `magnitud` |
| DT-U3 | Los factores y las dimensiones viven en código (`src/core/…`), con una prueba que los compara con el `CHECK` de la base | Como Pedernal (copia en código + prueba); sin tabla sin escritor |
| DT-U4 | **Los decimales de las unidades existentes no se tocan** (I3). Las 14 nuevas nacen con los decimales actuales de la siembra | Datos existentes |
| DT-U5 | La guardia de unidad y la lectura en vivo pasan de `PARES_DE_UNIDADES` por nombre a **factor de la tabla** cuando la unidad tiene equivalencia; sin equivalencia, siguen como hoy | Quita la adivinanza por nombre sin romper lo existente |
| DT-U6 | Aritmética de unidades en `bigint`/`Decimal`, nunca `number` (regla de dinero y cantidades) | Preferencias del proyecto |
| DT-U7 | Auditar con `registrarCambioAuditado` (`Unidad.codigoFijo`, del anterior al nuevo), como `actualizar-decimales-unidad.ts` | Convención del proyecto |

## 9. Nivel 8, 9 y 10 (acceso, consultas, pruebas, migración y operación)

### Nivel 8. Acceso
Sin claves nuevas. Asignar o cambiar una equivalencia: `unidades` (el permiso de hoy, verificado en `unidades.ts`). Elegir una unidad en un producto: el permiso de editar productos de hoy. Ver: el de siempre.

### Nivel 9. Consultas y experiencia (375 px primero)
- El desplegable de unidades de producto, receta, presentación y compra ofrece las **14** con los nombres de Pedernal (ya aprobados), agrupadas por dimensión; las empresas existentes ven además las suyas «pendientes» marcadas «Pendiente de completar» hasta resolverlas.
- La pantalla `/catalogo/unidades` pasa de «crear» a **resolver pendientes**: lista cada unidad sin equivalencia con un selector de las 14. **Textos nuevos: ninguno propuesto** («Pendiente de completar» ya está aprobado); cualquier otro lo aprueba el dueño.
- **Informe de solo lectura (U0)** `scripts/operaciones/unidades-informe-de-equivalencias.sql` (a escribir al implementar; **la consulta de abajo ya es de solo lectura y corre en cada base**):

```sql
-- Solo lectura. Una fila por unidad: qué propone la regla de §6.2 y cuántas filas dependen de ella.
SELECT u."empresaId", u.id, u.nombre, u.magnitud, u.decimales, u.activa,
       (SELECT count(*) FROM "Producto"                 p WHERE p."empresaId"=u."empresaId" AND p."unidadStockId"  = u.id) AS prod_stock,
       (SELECT count(*) FROM "Producto"                 p WHERE p."empresaId"=u."empresaId" AND p."unidadCompraId" = u.id) AS prod_compra,
       (SELECT count(*) FROM "Presentacion"             x WHERE x."empresaId"=u."empresaId" AND x."unidadCompraId" = u.id) AS presentaciones,
       (SELECT count(*) FROM "ProveedorPorProducto"     x WHERE x."empresaId"=u."empresaId" AND x."unidadCompraId" = u.id) AS prov_x_prod,
       (SELECT count(*) FROM "RecetaIngrediente"        x WHERE x."empresaId"=u."empresaId" AND x."unidadId"       = u.id) AS receta_ing,
       (SELECT count(*) FROM "RecetaVersion"            x WHERE x."empresaId"=u."empresaId" AND (x."rendimientoUnidadId"=u.id OR x."racionUnidadId"=u.id)) AS receta_cab,
       (SELECT count(*) FROM "ConsumoDeOpcion"          x WHERE x."empresaId"=u."empresaId" AND x."unidadId"       = u.id) AS consumo_opcion,
       (SELECT count(*) FROM "RecetaDeCombinacionIngrediente" x WHERE x."empresaId"=u."empresaId" AND x."unidadId" = u.id) AS combinacion_ing,
       (SELECT count(*) FROM "MovimientoStock"          x WHERE x."empresaId"=u."empresaId" AND x."unidadCompraId" = u.id) AS movimientos,
       (SELECT count(*) FROM "FacturaProveedorRenglon"  x WHERE x."empresaId"=u."empresaId" AND x."unidadCompraId" = u.id) AS renglones_factura
FROM "Unidad" u ORDER BY u."empresaId", u.magnitud, u.nombre;
```

Corre como dueño de la base (evade RLS) o por empresa con el rol de la aplicación. Para **cuántas filas tocaría U1b en cada base**: el total de unidades con propuesta ≠ pendiente (una fila por unidad, no por dependiente). Para **cuántas filas quedan sin tocar**: el resto. Los nombres de columna de la consulta se verifican contra `schema.prisma` al escribir el script (**NO VERIFICADO** que cada tabla tenga exactamente esos nombres en la base; el esquema Prisma los muestra tal cual).

- **Coherencia del factor (I8), de solo lectura:**

```sql
-- Productos cuya unidad de compra y de stock tienen la MISMA magnitud y cuyo factor no es 1.
-- (Cuando ambas tengan equivalencia se compara con el cociente de la tabla; antes de U1b se listan para revisar.)
SELECT p."empresaId", p.id, p.nombre, us.nombre AS unidad_stock, uc.nombre AS unidad_compra, p."factorConversion"
FROM "Producto" p
JOIN "Unidad" us ON us."empresaId"=p."empresaId" AND us.id=p."unidadStockId"
JOIN "Unidad" uc ON uc."empresaId"=p."empresaId" AND uc.id=p."unidadCompraId"
WHERE us.magnitud = uc.magnitud AND p."factorConversion" <> 1;
```

- **Suma de control (I10), antes y después de U1b:** por empresa, `count(*)` y la suma de `cantidad` y de `precioTotal` de `MovimientoStock`, la suma de `Presentacion.factorConversion` y de `Producto.factorConversion`, y el conteo de `RecetaIngrediente`. **Tienen que ser idénticas** (U1b no escribe en ninguna de esas tablas; la prueba confirma que es así).

### Nivel 10. Pruebas, oráculo de combinaciones, migración y operación

**Dimensiones cuyas combinaciones cambian dinero, stock, visibilidad o permisos (declaradas):** D1 código de unidad (los 14); D2 estado de la unidad (SIN_EQUIVALENTE / CON_EQUIVALENTE); D3 relación entre unidad de compra y de stock (misma dimensión, otra dimensión, sin equivalencia en alguna); D4 decimales de la unidad de stock (0 a 6); D5 empresa existente / empresa nueva; D6 interruptor de «crear a mano» (cerrado/abierto). **Guardián:** falla si aparece un código nuevo en la lista de 14 o un valor nuevo de `MagnitudUnidad` sin declarar si afecta (regla del 2026-10-28).

**Oráculo (tabla escrita aparte del código; muestra a completar al implementar):**

| Caso | Entrada | Resultado esperado |
|---|---|---|
| Conversión exacta | 2,5 KILOGRAMO → GRAMO | 2.500 GRAMO |
| Conversión exacta | 1.500 MILILITRO → LITRO | 1,5 LITRO |
| No exacta | 1 GRAMO → TONELADA | `CONVERSION_NO_EXACTA` |
| Otra dimensión | 1 KILOGRAMO → LITRO | `DIMENSION_DISTINTA` |
| Fuera de rango | 10^17 TONELADA → GRAMO | `FUERA_DE_RANGO` |
| Equivalencia | «kg» + PESO | KILOGRAMO |
| Equivalencia | «docena» + CANTIDAD | pendiente (no 1 a 1) |
| Equivalencia | «kg» + CANTIDAD | pendiente (magnitud no calza) |
| Equivalencia | «caja» + CANTIDAD | UNIDAD (Q-U2 confirmada) |
| Coherencia | compra «kg», stock «g», factor 1.000 | coherente; factor 900 → «pendiente de revisar» |
| Stock | 3 «caja» × factor 4,5 kg, antes y después de U1b | 13,5 kg en los dos |
| Decimales | unidad con 0 decimales, 0,4 | se redondea como hoy (I3); no cambia con la etapa |

**Pruebas obligatorias (al implementar cada etapa):** unidad pura con **propiedades** (`fast-check`, verificado en `package.json`): `convertir(convertir(x, a, b), b, a) = x` cuando ambas son exactas; la tabla del código coincide con el `CHECK`; **regresión** de todo lo que usa unidades (venta `cerrar-cuenta.ts`, producción `armar-linea-de-movimiento.ts`, recetas, compras, traspasos, conteos, reportes `rendimiento-recetas*`) con las **caracterizaciones existentes** (`test/reportes/caracterizacion/…golden…`, `test/movimientos/caracterizacion/`, `test/catalogo/caracterizacion/`) **sin cambiar una sola línea esperada**; **concurrencia** (dos asignaciones simultáneas a la misma unidad; una venta mientras se asigna); **idempotencia** (asignar dos veces, correr U1b dos veces, alta de empresa repetida); **aislamiento** (la asignación de una empresa no afecta a otra; RLS); **atomicidad** (corte a mitad del script de U1b: nada asignado); **migración** con ida, `down.sql`, ida (el esquema queda igual) y prueba de que `down` no toca ningún dato de negocio; **E2E** a 375 px del alta de producto y de la pantalla de pendientes.

**Gate** (`AGENTS.md`), en la misma corrida y limpios: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto` (0 hallazgos; la primitiva de U0 necesita un consumidor: el informe o la guardia de unidad), `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Ensayo sobre copia (obligatorio antes de U1b en cada base):** (1) copia reciente de la base en una rama descartable; (2) correr la consulta de §9 y guardar el resultado; (3) aplicar U1 y U1b en la copia; (4) correr las sumas de control: idénticas; (5) correr la batería de caracterizaciones contra la copia; (6) correr el `down` y el script de reversa y verificar que el esquema y las sumas vuelven al punto de partida; (7) volver a aplicar. Recién con todo verde se pide la autorización de esa base. **Nunca sobre la rama principal de la base de producción.**

**Verificación previa por base:** la consulta de §9 y el listado de equivalencias propuestas, enviados al dueño para su revisión (en el repositorio privado de documentos, con los datos reales; **este documento público no los lleva**).

## 10. Preguntas de NEGOCIO (resueltas por el dueño el 2026-11-15)

> Respuestas del dueño en el chat con el orquestador, 2026-11-15. No queda ninguna pregunta de negocio abierta en esta pieza.

- **Q-U1 — Unidades sin equivalente 1 a 1 (docena, par, media docena): CONFIRMADA.** Literal: «Nadid creo nada asi que usar lo de pedernal». Se usa la lista de Pedernal tal cual: no se crea ninguna unidad nueva ni se convierte con cociente. **Hecho verificado en solo lectura por el orquestador sobre una copia reciente de una base** (sin nombres ni cifras de clientes): las unidades existentes son las cinco sembradas (unidad, g, kg, l, ml) y los productos usan «unidad» como unidad de stock; **no hay docena, par ni envases**. Consecuencia: la regla «lo que no es 1 a 1 queda pendiente» sigue como red de seguridad para otras bases, pero deja de ser un caso a diseñar.
- **Q-U2 — Envases («caja», «pack», «bolsa», «botella»): CONFIRMADA.** Literal: «A UNIDAD, con el nombre original visible (Recomendada)». Se pasan a UNIDAD; el nombre original sigue visible; el contenido queda en el factor del producto.
- **Q-U3 — Empresas existentes: CONFIRMADA en dirección.** Literal: «Sí, se agregan las 14 sin borrar nada (Recomendada)». Aplicarlo en cada base queda para el despliegue, con **autorización expresa por base, copia de respaldo y ensayo** (§11).

## 11. Qué hay que autorizar expresamente

Esta pieza **escribe datos existentes** (la columna nueva de cada unidad). La autorización permanente del 2026-11-15 cubre migraciones **aditivas y reversibles**: U1 (la columna) entra ahí; **U1b y U3 no**.

**Texto exacto de la autorización que el dueño tendría que dar (una por base):**

> «Autorizo aplicar en la base [NOMBRE DE LA BASE] el rellenado de la columna `codigoFijo` de las unidades de medida y la incorporación de las unidades de las 14 que falten, **según la tabla de equivalencias que revisé el [FECHA]**, con la copia ya ensayada, y sé que se puede deshacer con el script de reversa.»

**Alcance de esa autorización:** solo la columna `Unidad.codigoFijo` y, en U3, filas nuevas de `Unidad`; **no** autoriza cambiar decimales, nombres, factores, cantidades, ni re-apuntar ninguna referencia; **no** vale para otra base; **no** vale si la tabla de equivalencias cambia después de revisada (hay que volver a pedirla).

**Condiciones previas que se muestran junto al pedido:** consulta de §9 de esa base; lista propuesta y las pendientes; resultado del ensayo sobre copia (sumas de control iguales y reversa probada); copia o respaldo reciente; quién lo corre y cuándo.

## 12. Etapas (la más barata primero) y supuestos

1. **U0 — código puro y consulta de solo lectura.** Sin migración. Primero.
2. **U1 — la columna.** Aditiva; entra en la autorización permanente.
3. **U1b — rellenar por base.** Autorización expresa y ensayo.
4. **U2 — el código lee la equivalencia, se cierra el alta a mano, las empresas nuevas nacen con 14.** Sin migración; después de U1b (si se despliega antes, las unidades se ven «pendientes» y todo funciona como hoy).
5. **U3 — completar las 14 en las empresas existentes** (con DT-U2 si el dueño quiere longitud, superficie y tiempo). Autorización expresa.
6. **Etapas posteriores con nombre (NO pedidas):** fusionar equivalentes duplicadas; nombres de presentaciones; unidad de venta separada; cambiar una unidad mal cargada (en Pedernal la propuesta es crear el producto correcto y desactivar el equivocado).

**Supuestos declarados (el dueño los corrige):** S1 los decimales de las unidades existentes no se tocan; S2 la lista de 14 es la de Pedernal sin agregar ni quitar; S3 no se toca ninguna cantidad ni factor ya cargado; S4 (resuelto) la fecha de las respuestas del dueño es 2026-11-15.

## 13. Diferencias con Pedernal (cada una con su motivo)

| Tema | Pedernal | Motor2 tras este diseño | Motivo |
|---|---|---|---|
| Dónde vive la lista | Tabla global sembrada, solo inserción | Columna `codigoFijo` + `CHECK` + constante en código | **Prisma y datos existentes**: nueve modelos con clave compuesta a `Unidad` |
| Cantidades | 4 decimales, nunca redondea | Se redondea a `Unidad.decimales` en lo ya guardado | **Datos existentes** (I3) |
| Unidad base inmutable | Disparador en la base | Sin cambio en esta etapa (no se verificó la regla actual de Motor2) | NO VERIFICADO: queda anotado, no se pidió |
| Presentación de compra | Nombre + cantidad en unidad base | Unidad de compra + factor por producto (sin nombre) | No se pidió; etapa posterior |
| Unidades a mano | No existen | Cerradas por interruptor; las viejas quedan | Datos existentes |

## 14. Riesgos y pendientes

- **«Caja» → UNIDAD pierde el nombre en pantalla** (Q-U2, confirmada): se conserva el original.
- **Equivalencias mal asignadas** son el riesgo central: por eso la lista la revisa el dueño por base y hay reversa probada.
- **Dos unidades equivalentes a la misma** (kg y Kilo): conviven; fusionarlas es otra etapa.
- **Factores incoherentes con la tabla** (I8): se listan, no se corrigen.
- **Enum de magnitud no reversible** (DT-U2): se declara.
- **Mezcla de sistemas durante la transición** (unas unidades con equivalencia, otras sin): todo sigue funcionando porque la lectura nueva solo actúa cuando hay equivalencia.
- **Congelamiento de producción:** nada se aplica ni se despliega desde este documento.
- **Sugerencias (no implementadas):** fusionar duplicadas; nombre de presentación; peso variable por presentación.
