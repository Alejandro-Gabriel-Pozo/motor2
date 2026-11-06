# Diseño: la categoría con dos niveles, unidad de negocio y rubro (2026-11-06)

> Documento listo para guardar como `docs/diseno-categoria-unidad-y-rubro-2026-11-06.md`. Es un diseño en papel: no se implementó nada, no se escribió código ni migraciones.
>
> **Cómo leer las marcas.** **VERIFICADO** (archivo:línea): lo leí en el código o en la documentación real (`origin/main` del 2026-11-06, commit `2ad37576`). **CONFIRMADA**: lo decidió el dueño. **PROPUESTA**: lo propone este diseño y el dueño puede corregirlo. **NO VERIFICADO**: no lo pude comprobar (por ejemplo, datos de producción).

---

## 0. Resumen para el dueño (en una página)

**Lo que pidió.** Usted quiere ver sus números en tres niveles. El primero es la **sucursal** (la hostería), que es su centro de costos. El segundo es la **unidad de negocio** dentro de la sucursal (Restaurante, Alojamiento). El tercero es el **rubro** de cada venta (Confitería, Productos regionales). Su ejemplo: «mi unidad de negocio es Restaurante, el rubro de esa venta fue Confitería, pero cuando compro va todo a Restaurante».

**Lo más barato, que se puede usar hoy sin tocar nada.** Hoy usted tiene las categorías «Restaurante» y «Hostería», y ningún producto las tiene asignadas. Si le asigna su categoría a cada uno de los 47 productos de venta (y a las materias primas), el reporte «Por categoría» que ya existe le muestra **las ventas por unidad de negocio**. No hace falta programar nada. (VERIFICADO: el formulario de producto ya tiene el selector de categoría, `src/app/(app)/catalogo/productos/producto-form.tsx:224-231`, y el reporte ya agrupa por categoría, `src/server/consultas/reportes/periodo.ts:256-269`.)

**Lo que sí requiere un cambio chico en la base.** Para tener rubros adentro de cada unidad, la categoría gana un dato opcional: **«pertenece a»**. Así, «Confitería» pertenece a «Restaurante». No se crea otro catálogo y no se usan las 5 tablas de centros de costos. Es una migración **aditiva y reversible**. **Requiere su autorización expresa** antes de aplicarla.

**Qué pasa con lo que se vende sin producto** (alojamiento, anticipos). La caja que está diseñada en papel pensaba crear otra lista, «conceptos del comprobante». Propongo **no crearla**: cada línea declarada en la factura apunta directamente al **rubro**, que es la misma categoría de dos niveles. El «Anticipo recibido» (que resta) se marca en la línea, no en una lista aparte.

**Compras.** Cada compra va a la unidad que dice **la categoría de la materia prima** que se compró. No hay que cargar ningún dato nuevo en la factura. Lo único que falta cargar es la categoría de cada materia prima. Los gastos sin mercadería (luz, alquiler) quedan **en la sucursal**, que es su centro de costos.

**Dos preguntas para usted** (§13): si un cambio de rubro o de unidad debe cambiar los reportes del pasado, y si los gastos sin mercadería se quedan en la sucursal.

---

## 1. Nivel 1. Propósito y necesidad

| # | Necesidad | Quién la pidió y dónde | Estado |
|---|---|---|---|
| N-1 | Tres niveles: sucursal (= centro de costos) → unidad de negocio → rubro | Dueño, 2026-11-06 (decisión 1) | CONFIRMADA |
| N-2 | «El centro de costo es la sucursal». Las 5 tablas de centros de costos compiten con esto | Dueño, 2026-11-06 (decisión 2) | CONFIRMADA |
| N-3 | En producción `CategoriaProducto` tiene «Restaurante» y «Hostería» (o sea, hoy hace de unidad) con 0 productos asignados; los 47 productos de venta no tienen categoría | Dueño, 2026-11-06 (decisión 3) | CONFIRMADA (dato de producción NO VERIFICADO por mí: no leí la base) |
| N-4 | El rubro sale **del producto que se vende** (de su categoría), no de la sección de la carta, porque hay ventas por fuera de la carta | Dueño, 2026-11-06 (decisiones 3 y 4) | CONFIRMADA |
| N-5 | Un solo cliente por ahora; se mantiene el multiempresa | Dueño, 2026-11-06 (decisión 5) | CONFIRMADA |
| N-6 | La caja diaria de hoy (planilla) tiene «cargos por rubro: restaurante, alojamiento, y en mostrador merchandising, productos regionales» | Dueño, 2026-11-04, `docs/diseno-caja-y-cobros-2026-11-04.md:57` | CONFIRMADA (VERIFICADO el texto) |
| N-7 | Las facturas reales traen en «Detalle»: Alojamiento, Confitería, Productos regionales, Anticipo recibido (que resta) | Dueño, 2026-11-04, `docs/diseno-caja-y-cobros-2026-11-04.md:127` | CONFIRMADA (VERIFICADO el texto) |
| N-8 | Los nombres de las unidades son datos de cada empresa y no se fijan en el código | Dueño, 2026-10-08, `motor2-docs/_planes/_decisiones-del-dueno-2026-10-08.md:13` | CONFIRMADA (VERIFICADO el texto) |

**Alcance (PROPUESTA).** Entra: categoría de dos niveles, asignar la categoría a productos, ventas por rubro y por unidad, compras por unidad, resultado por unidad, food cost objetivo por rubro o unidad, y qué hacer con las ventas sin producto cuando exista la caja. **No entra:** repartir gastos sin mercadería entre unidades (lo deja afuera la decisión «el centro de costo es la sucursal»), unidades habilitadas por sucursal, códigos para cruzar datos con el otro sistema, ni carga masiva de categorías. Si alguno hace falta, se diseña aparte con nombre propio.

---

## 2. Inventario: qué existe ya, a veces con otro nombre

| Qué | Dónde | Qué hace hoy | Qué se hace con eso |
|---|---|---|---|
| `CategoriaProducto` | VERIFICADO `prisma/schema.prisma:554-568` | Catálogo plano de la empresa: `nombre`, `activo`. El comentario dice «Sin jerarquía» (:556). Nombre único por empresa sin distinguir mayúsculas (VERIFICADO: índice `lower(nombre)`, `prisma/migrations/20260929100000_multiempresa_estructura/migration.sql:287`) | **Se reutiliza.** Es la unidad y el rubro (§5) |
| `Producto.categoriaId` | VERIFICADO `schema.prisma:367-369`, índice :461 | Opcional; vale para cualquier producto, de venta (PV) o materia prima (MP) | **Se reutiliza tal cual.** De acá salen el rubro de la venta y la unidad de la compra |
| `MargenObjetivo` | VERIFICADO `schema.prisma:571-587` | Food cost objetivo por categoría (`categoriaId`) o de toda la empresa (`categoriaId` NULL) | **Se reutiliza.** Se suma la herencia rubro → unidad → empresa en la función que lo resuelve (§7.4), sin migración |
| Lógica del objetivo | VERIFICADO `src/core/reportes/margen-objetivo.ts:24-27` | Categoría → empresa → constante `FOOD_COST_OBJETIVO_PCT` | Gana un escalón: rubro → unidad → empresa → constante |
| Reporte «Por categoría» | VERIFICADO `src/app/(app)/reportes/categorias/page.tsx`, `src/server/consultas/reportes/periodo.ts:256-269`, `src/core/reportes/periodo-categorias.ts:25-38` | Ventas del período agrupadas por el nombre **vigente** de la categoría del producto; los productos sin categoría van a «Sin categoría» (:28); lista de productos de venta sin categoría (:41-44) | **Se reutiliza.** Gana el corte por unidad y por rubro, y la leyenda «Pendiente de completar» |
| Mapa de productos de los reportes | VERIFICADO `src/core/reportes/comun.ts:25-27,56-57,104-105` | Cada producto lleva `categoriaNombre` y `categoriaId` vigentes | Gana la unidad (el padre) |
| Compras en reportes | VERIFICADO `src/core/reportes/periodo-compras.ts:112-130` | Agrupa el gasto de compras por **Grupo de insumo**, no por categoría | Se suma el corte por unidad (§7.3) |
| `Grupo` (árbol de insumos) | VERIFICADO `schema.prisma:532-547` | Árbol sin límite de niveles; los ciclos se controlan en la aplicación (`src/core/catalogo/cadena-de-grupos.ts`) | **No se usa.** Agrupa insumos para stock y «no comestibles», no unidades. Sirve de antecedente: ya hay un árbol en la casa |
| `SeccionCarta` | VERIFICADO `schema.prisma:1833-1836` | El menú que ve el cliente (Cafetería, Postres…) | **No se toca.** No es el rubro (decisión 3). Sigue su reporte «Ventas por sección» |
| La categoría en la carta pública | VERIFICADO `src/core/carta/armar-menu.ts:32-36,396` | El campo `categoria` del ítem público es informativo y no se dibuja; usa el nombre de la categoría o, si no hay, el de la sección | Sin cambio: seguirá mostrando el nombre de la categoría del producto (será el rubro o la unidad). El guardián `test/arquitectura/carta-publica-lista-cerrada.test.ts:38,167` sigue igual porque **no** se lee el padre en la carta |
| 5 tablas de centros de costos (`PlanDeCostos`, `CentroDeCostos`, `PlanDeCostosSucursal`, `DistribucionCostoVersion`, `DistribucionCostoLinea`) | VERIFICADO `schema.prisma:3424-3557`; **0 referencias en `src/`** (grep); solo `src/core/compras/aplicabilidad-de-plan-de-costos.ts` (21 líneas), usado únicamente por pruebas | Unidad de negocio como «centro» de un «plan», para repartir **gastos sin stock** por versiones | **No se usan.** Se retiran más adelante, con autorización expresa (§11, etapa R) |
| `ConceptoDeGasto` | VERIFICADO `schema.prisma:3176-3198`; 0 escritores en `src/` | Concepto de un gasto sin mercadería (luz, alquiler) | **No se toca.** Responde a otra pregunta («qué se pagó»), no a «qué unidad» |
| `ConceptoDeComprobante` + `LineaDeConceptoDeComprobante` | Solo en papel: `docs/diseno-caja-y-cobros-2026-11-04.md:263-265,286-330`; **no está en el esquema** (VERIFICADO, grep en `schema.prisma`) | Lista de conceptos declarados en la factura externa, con signo SUMA o RESTA | **Se reemplaza en papel** por la categoría de dos niveles (§7.2). No hay nada que deshacer |
| Unidad = `CentroDeCostos` en el diseño de clientes | `docs/diseno-clientes-convenios-y-facturacion-externa-2026-10-26.md:84,152,184` (PROPUESTA de ese documento) | Proponía colgar el concepto de la factura de un centro de costos | Queda superada por la decisión 2 del dueño: se cambia en ese documento cuando se toque |
| Diseño de atribución de costos | `docs/diseno-atribucion-de-costos-sucursal-y-unidad-2026-10-27.md:1-107` (todo PROPUESTA) | Etapa U1: distribuir gastos sin stock entre unidades usando las 5 tablas | **Superado** por la decisión 2. No se construye |
| Decisiones anteriores sobre unidades | `motor2-docs/_planes/_decisiones-del-dueno-2026-10-06.md:102,125,134`; `plan-distribucion-de-costos-y-servicios.md:148` (D-UN) | «Todas tienen restaurante; no hay hosterías sin hotel; la central no tiene ninguna»; códigos iguales a los del otro sistema | La unidad deja de ser un centro de costos y pasa a ser una categoría. La Central no vende, así que en ventas no tiene unidades sin que haga falta configurar nada. Los códigos para cruzar con el otro sistema quedan fuera (supuesto S7) |
| La palabra «rubro» | `motor2-docs/_planes/plan-unificado-gastos-compras-y-ventas.md:40` (C23: «tipo de costo, nunca rubro, que ya significa otras dos cosas»); `_decisiones-del-dueno-2026-10-08.md:13` (rubro = el tipo de negocio de la empresa, en la consola) | — | **Choque de nombres.** Propuesta: «Rubro» solo dentro de Catálogo › Categorías y en los reportes de ventas. El tipo de negocio de la empresa sigue llamándose «rubro de la empresa» y solo aparece en la consola |
| Permisos | VERIFICADO `src/core/permisos/acciones.ts:46,52,54,156,223` | `categorias` (empresa, administrador), `categoria_alta` (empresa, **operario**), `producto_editar` (operario), `margen_objetivo_editar` (administrador), `reporte_categorias` (sucursal, administrador) | **Sin claves nuevas** (§4) |

**Hallazgo al pasar (VERIFICADO).** El formulario de producto ofrece **también las categorías desactivadas**. `listarCategoriasProducto` lee todas sin filtrar (`src/server/actions/catalogo/categorias-producto.ts:19-22`) y el selector las muestra todas (`producto-form.tsx:226-230`). Hoy desactivar una categoría no impide asignarla. Va como regla en §6 (I7).

---

## 3. Nivel 2. Actores y permisos (sin claves nuevas)

| Actor | Qué hace | Clave que ya existe | Estado |
|---|---|---|---|
| Administración | Crea **unidades**, mueve un rubro de unidad, cambia el nivel, activa y desactiva | `categorias` (empresa, piso administrador) | PROPUESTA |
| Operario con alta de categorías | Crea **rubros** colgados de una unidad que ya existe (también desde el alta rápida del formulario de producto) | `categoria_alta` (empresa, piso operario) | PROPUESTA (supuesto S1) |
| Quien edita productos | Le asigna a un producto su rubro o su unidad | `producto_editar` / `alta_producto` | VERIFICADO que existen; PROPUESTA el uso |
| Administración | Fija el food cost objetivo por rubro, por unidad o de la empresa | `margen_objetivo_editar` | VERIFICADO que existe |
| Dueño o gerencia | Lee ventas por rubro y por unidad, compras por unidad, resultado por unidad | `reporte_categorias` (sucursal) y el reporte del período | VERIFICADO que existe; PROPUESTA el uso |

**Supuesto S1 (cambia qué puede hacer un operario).** Hoy `categoria_alta` deja que un operario cree cualquier categoría. Con los dos niveles, crear una **unidad** exige además `categorias`, que es de administración. Así un operario no puede crear una unidad de negocio nueva desde el alta rápida del producto. Lo controla el servidor; no hace falta una clave nueva.

---

## 4. Nivel 3. Casos de uso

**(a) Vender un producto.** El rubro de la venta es **la categoría del producto vendido**. Si esa categoría es un rubro, la unidad es la unidad a la que pertenece. Si el producto está asignado directo a una unidad, la venta cuenta en esa unidad como «sin rubro». Si el producto no tiene categoría, la venta va a **«Pendiente de completar»**. Da igual si se vendió por la carta, por la mesa o por mostrador: el dato sale del producto (decisión 4). La sección de carta no interviene. (PROPUESTA; regla de base CONFIRMADA)

**(b) Vender algo sin producto** (alojamiento, servicios, anticipos). Hoy **no existe**: toda línea de venta tiene un producto (VERIFICADO `schema.prisma:2394-2395`, `CuentaItem.productoId` obligatorio). Aparece cuando se construya la etapa N1 de la caja (comprobante externo). Se analizaron tres opciones:

| Opción | Qué hace | Costo | Resultado |
|---|---|---|---|
| A. La caja crea su propia lista (`ConceptoDeComprobante`) | Dos catálogos con los mismos nombres («Confitería» en categorías y en conceptos), que hay que mantener iguales a mano | Una tabla, su pantalla de alta y baja, sus pruebas, y además ligar cada concepto a una unidad | Descartada: duplica |
| B. Lista de la caja + un dato «pertenece a la categoría» | Sigue habiendo dos listas, ligadas | Lo mismo que A más una columna | Descartada: igual duplica |
| **C. La línea declarada apunta directo a la categoría (rubro o unidad) y lleva su propio signo** | Un solo catálogo. «Alojamiento» es un rubro (o una unidad) en Categorías. El «Anticipo recibido» es una línea **del mismo rubro** con signo **RESTA** | Una columna de signo en la línea (que la caja igual iba a tener) y una tabla menos | **Recomendada (PROPUESTA)** |

Por qué alcanza C: los nombres de la factura real (Alojamiento, Confitería, Productos regionales) **son rubros** (CONFIRMADA, evidencia del 2026-11-04). El anticipo no es un rubro: es plata del alojamiento que ya se facturó en la seña. Si resta **en el mismo rubro**, el total del rubro sale bien. Ejemplo: seña de $98.000 + alojamiento de $140.000 − anticipo de $98.000 = $140.000 de alojamiento (`docs/diseno-caja-y-cobros-2026-11-04.md:178`, C19). (Supuesto S2: el anticipo se carga en el rubro del cargo que adelanta.)

Para no contar dos veces: lo declarado en la factura es justamente lo que **no** vino de un ticket, porque «monto = conceptos declarados + tickets aplicados» (C19, CONFIRMADA en caja). Por eso, en «ventas por rubro», sumar las ventas por producto más las líneas declaradas no duplica nada.

**(c) Comprar.** Las compras van a la **unidad**, no al rubro (decisión 1: «cuando compro va todo a Restaurante»). Hay tres lugares posibles para el dato:

| Opción | Dato nuevo a cargar | Costo |
|---|---|---|
| Por factura (unidad en la cabecera) | Una columna nueva en `FacturaProveedor` y un dato más en cada carga | Migración y otro paso para quien carga |
| Por centro de costos | Las 5 tablas sin escritor, más pantallas de distribución | El más caro, y contradice la decisión 2 |
| **Por renglón, según la categoría de la materia prima** | **Ninguno por compra.** Solo hay que asignarle una vez a cada materia prima su unidad (o un rubro, del que se saca la unidad) | **Cero migración.** `FacturaProveedorRenglon.productoId` y `MovimientoStock` ya tienen el producto (VERIFICADO `schema.prisma:2837-2838`; el gasto de compras ya se lee por producto, `periodo-compras.ts:116-127`). **Recomendada (PROPUESTA)** |

Lo que falta cargar: la categoría de cada materia prima. Una materia prima sin categoría hace que su compra salga como «Pendiente de completar». Los gastos sin mercadería (renglones SIN_STOCK: luz, alquiler) **no tienen producto** y hoy **nadie los escribe** (VERIFICADO: 0 escritores de `ImputacionDeGasto` y de SIN_STOCK en `src/`). Cuando existan, quedan **en la sucursal**, en la fila «Gastos de la sucursal (sin unidad)». No es un pendiente (supuesto S3 / pregunta P2).

**(d) Reportes.**
- Ventas por rubro: suma por la categoría del producto vendido, más las líneas declaradas (cuando exista la caja).
- Ventas por unidad: suma de sus rubros, más lo asignado directo a la unidad («Restaurante, sin rubro»), más «Pendiente de completar» aparte. **La suma de todas las unidades más lo pendiente es igual al total vendido** (invariante I5).
- Compras por unidad: compras de mercadería según la categoría de cada materia prima, más «Pendiente de completar». Los gastos sin mercadería van en fila aparte.
- Resultado por unidad: ventas de la unidad menos compras de la unidad en el período. Se rotula «ventas menos compras de mercadería»; **no es un estado de resultados contable**. Las filas «Pendiente de completar» y «Gastos de la sucursal» se muestran y **no se reparten** (PROPUESTA).
- Food cost objetivo: se puede fijar **por rubro, por unidad o para toda la empresa, con herencia**: rubro → unidad → empresa → valor por defecto. No hace falta migración: `MargenObjetivo.categoriaId` ya acepta cualquier categoría (VERIFICADO :580-584). Solo cambia `resolverObjetivoFoodCost` (`margen-objetivo.ts:24-27`) para mirar también a la unidad (PROPUESTA).

**(e) Productos sin categoría.** Siempre se muestran como **«Pendiente de completar»**, con su importe y la lista de productos. **Nunca** se asignan solos a una unidad, ni siquiera si hay una sola, y **nunca** se ponen en cero. Hoy dice «Sin categoría» (`periodo-categorias.ts:28`); cambia solo el texto y el enlace para completarlo (PROPUESTA).

**(f) Las 5 tablas de costos y `SeccionCarta`.** Las 5 tablas: **no se tocan ahora**. Se retiran en la etapa R, con autorización expresa, en una migración aparte (§11). `SeccionCarta`: no cambia; sigue siendo el menú del cliente y tiene su propio reporte.

---

## 5. Nivel 4. Conceptos y ciclo de vida

- **Unidad de negocio**: una categoría que **no pertenece a otra** (nivel UNIDAD). Ejemplos: Restaurante, Hostería o Alojamiento. Es de la empresa: vale para todas sus sucursales (supuesto S4).
- **Rubro**: una categoría que **pertenece a una unidad** (nivel RUBRO). Ejemplos: Confitería y Productos regionales; también Alojamiento como rubro de Hostería, si usted lo arma así. Un rubro no puede tener rubros adentro: hay **dos niveles como máximo**.
- **Sucursal**: ya existe (`schema.prisma:127`). Es el centro de costos. Cada venta y cada compra ya lleva su sucursal.
- **Ciclo de vida de una categoría**: se crea activa. Se puede desactivar y volver a activar. Un rubro se puede **mover** a otra unidad. Una unidad **sin rubros** se puede convertir en rubro de otra unidad, y un rubro se puede convertir en unidad. **Nunca se borra** (la app no tiene borrado de categorías; VERIFICADO, no hay escritura de borrado en `src/server/persistencia/catalogo/categorias-producto.ts`).
- **Las dos categorías de hoy** («Restaurante» y «Hostería») quedan como **unidades** automáticamente cuando se aplique la migración, porque no tienen «pertenece a». No hay que reescribir ningún dato.

---

## 6. Nivel 5. Invariantes y políticas

| # | Regla | Quién la cuida | Estado |
|---|---|---|---|
| I1 | Una categoría tiene **a lo sumo un nivel arriba**: un rubro pertenece a una unidad, y una unidad no pertenece a nadie | La base (clave foránea con discriminador, §7) | PROPUESTA |
| I2 | La unidad de un rubro es **de la misma empresa** | La base (la clave foránea incluye `empresaId`, como en todo el esquema) | PROPUESTA |
| I3 | No se puede convertir en rubro una unidad que tiene rubros | La base (la clave foránea se lo impide) | PROPUESTA |
| I4 | El nombre es único en la empresa **entre los dos niveles**, sin distinguir mayúsculas: no puede haber dos «Confitería» en unidades distintas | La base (índice existente, VERIFICADO `20260929100000…/migration.sql:287`) | VERIFICADO el índice; PROPUESTA que siga así |
| I5 | Σ ventas por unidad + «Pendiente de completar» = total vendido del período; lo mismo para compras | La consulta y una prueba | PROPUESTA |
| I6 | Lo que no tiene categoría se muestra «Pendiente de completar», nunca se inventa | La consulta | PROPUESTA (regla del dueño, AGENTS.md) |
| I7 | Una categoría desactivada (o un rubro de una unidad desactivada) **no se ofrece** para asignar a productos nuevos ni como unidad de un rubro nuevo. **Lo ya asignado sigue contando** en los reportes | El servidor y el formulario | PROPUESTA (corrige el hallazgo del §2) |
| I8 | Crear una unidad exige `categorias`; con `categoria_alta` solo se crean rubros | El servidor | PROPUESTA (S1) |
| I9 | Los reportes leen la **categoría vigente** del producto (como hoy) | La consulta | VERIFICADO el comportamiento actual (`comun.ts:104-105`); PROPUESTA mantenerlo (pregunta P1) |
| I10 | Una línea declarada en la caja apunta a una categoría activa y lleva su signo; el signo RESTA no deja el comprobante en negativo | Base y aplicación (cuando exista la caja) | PROPUESTA |

### Escalera de producto (lo que ve el cliente, N0 a N5)

Los peldaños se suman y ninguno rompe lo ya cargado. Lo que falta se muestra «pendiente de completar».

| Peldaño | Lo que ve | Qué necesita |
|---|---|---|
| **N0 (hoy)** | Categorías planas; ventas «Sin categoría» | Nada |
| **N1** | Ventas **por unidad** (las categorías de hoy usadas como unidades); «Pendiente de completar» en lugar de «Sin categoría»; compras por unidad | Asignar categorías (configuración) y un cambio chico de código, **sin migración** |
| **N2** | **Rubros** dentro de cada unidad; ventas por rubro y por unidad; food cost objetivo con herencia | Migración aditiva (`padreId` y `nivel`) |
| **N3** | **Resultado por unidad** (ventas − compras de mercadería) con las filas aparte | Solo código |
| **N4** | Ventas **sin producto** (alojamiento, anticipos) en su rubro | La caja N1, con la línea apuntando a la categoría |
| **N5** | (Opcional) reportes del pasado **congelados** frente a cambios de categoría | Solo si P1 se responde «congelar» |

---

## 7. Nivel 6. Modelo y persistencia (en papel; se migra solo lo de la etapa que se implemente)

### 7.1 La categoría con dos niveles (etapa E2)

Se agregan **dos columnas opcionales** a `CategoriaProducto` (PROPUESTA):

| Columna | Tipo | Regla |
|---|---|---|
| `nivel` | texto, NOT NULL, por defecto `'UNIDAD'` | CHECK `nivel IN ('UNIDAD','RUBRO')` |
| `padreId` | texto, opcional | CHECK de pareo: `(nivel = 'UNIDAD') = (padreId IS NULL)` |
| `nivelDelPadre` | texto, opcional | CHECK: NULL si `padreId` es NULL; si no, siempre `'UNIDAD'`. Es la tercera columna de la clave foránea |

Más:
- Un único nuevo, `(empresaId, id, nivel)`.
- Una clave foránea `(empresaId, padreId, nivelDelPadre) → CategoriaProducto(empresaId, id, nivel)`, con `ON UPDATE RESTRICT` y `ON DELETE RESTRICT`.
- Un índice en `padreId`.

**Por qué no alcanza un CHECK.** Un CHECK de Postgres solo ve su propia fila: no puede mirar si el padre es una unidad. Por eso la regla «dos niveles como máximo» se garantiza con una **clave foránea con discriminador**: el padre tiene que existir **con** `nivel = 'UNIDAD'`, y de la misma empresa. Este molde ya existe en la casa, en `ImputacionDeGasto` con `naturalezaRenglon` fijo en `SIN_STOCK` (VERIFICADO `schema.prisma:3203-3210`). El `RESTRICT` también impide convertir en rubro una unidad que tiene rubros (I3). Se descartó un disparador (*trigger*) porque el proyecto prefiere restricciones declarativas y, para el árbol de `Grupo`, deja la regla en la aplicación (VERIFICADO `schema.prisma:528-531`).

**Costo de la decisión (poda).** `nivel` se puede deducir de `padreId`. Se guarda igual porque es lo que permite que la base imponga la regla, y el CHECK de pareo impide que se contradigan. Se declara así en el guardián (§10).

**Migración**: aditiva. Las filas existentes quedan como `UNIDAD` sin padre, sin rellenar nada. **Reversible**: el `down.sql` borra la clave foránea, el índice, los CHECK y las tres columnas; no se pierde nada salvo los rubros creados después. Antes de bajarla hay que reasignar a sus unidades los productos que tengan un rubro, o aceptar que queden como categorías planas: siguen existiendo como filas, solo pierden el «pertenece a». **Requiere autorización expresa**, base por base, con respaldo y ensayo en una rama de Neon (como `docs/diseno-una-sola-compra-2026-11-06.md` §7).

También se actualizan los comentarios del esquema: «Sin jerarquía» (:556) y «Rubro comercial» (:367).

### 7.2 Ventas sin producto (etapa E4, junto con la caja N1)

En el diseño de la caja (en papel) se cambia (PROPUESTA):
- **Se quita** `ConceptoDeComprobante`.
- `LineaDeConceptoDeComprobante` pasa a tener `categoriaId` (FK compuesta a `CategoriaProducto`) y `signo` (CHECK `SUMA`/`RESTA`, por defecto `SUMA`). Así quedan los nombres de la caja: «Alojamiento $120.000» es SUMA en el rubro Alojamiento, y «Anticipo recibido $98.000» es RESTA en el mismo rubro.
- El único parcial pasa a ser `(comprobanteId, categoriaId, signo) WHERE anuladaEn IS NULL`.

No se migra ahora: la caja todavía no existe en el esquema.

### 7.3 Compras: sin persistencia nueva

La unidad de una compra **se deduce** de la categoría de la materia prima. No se guarda en la compra.

### 7.4 Food cost: sin persistencia nueva

`MargenObjetivo` ya admite una fila por cualquier categoría. Al resolver el objetivo de un producto se busca primero el de su rubro, después el de su unidad, después el de la empresa y por último la constante.

### 7.5 Historia: ¿congelar la unidad y el rubro en la venta, o leer siempre el vigente?

| | Leer el vigente (como hoy) | Congelar en la venta |
|---|---|---|
| Qué guarda | Nada nuevo | Una copia de `categoriaId` en cada línea de venta y de compra (`MovimientoStock` u `Operacion`, tablas que se usan muchísimo; VERIFICADO `schema.prisma:1095,1302`) |
| Si corrijo la categoría de un producto | **Se corrige también el pasado.** Es lo que conviene hoy, que los 47 productos están sin asignar y se van a cargar después de vender | El pasado queda en «Pendiente de completar» para siempre, salvo que se reescriba |
| Si muevo «Confitería» de Restaurante a otra unidad | Todo lo vendido en Confitería pasa a la otra unidad, **también los meses ya cerrados** | Lo viejo queda en Restaurante |
| Costo | Cero | Una migración en las tablas más usadas, más el escritor en cada venta, compra y traspaso |
| Antecedente | Los reportes ya leen así la categoría (`comun.ts:104`) | Así se congelan el precio y el nombre del ticket (`schema.prisma:2397-2399,2421`) |

**Recomendación (PROPUESTA): leer el vigente**, y antes de mover un rubro de unidad o de cambiar el nivel, **avisar cuántas ventas del pasado van a cambiar de unidad**, pidiendo confirmación. Congelar queda como etapa N5, con nombre, si usted necesita cerrar meses. Advertencia: congelar más adelante **no recupera** la categoría que tenía una venta del pasado, porque no hay historial de cambios de categoría. Por eso queda como pregunta P1.

---

## 8. Nivel 7. Atomicidad y concurrencia: «¿qué pasa si…?» por comando

Hoy los comandos de categoría no usan transacción ni dejan auditoría (VERIFICADO `crear-categoria-producto.ts` y `actualizar-activa-categoria-producto.ts`, fichas `transaccion=NINGUNA`). Se mantiene así, porque cada comando es **una sola escritura**. Mover un rubro sí deja un registro de auditoría en la misma transacción, porque cambia de qué unidad es la plata del pasado (PROPUESTA).

### 8.1 Crear categoría (unidad o rubro)

| Situación | Qué pasa (PROPUESTA salvo marca) |
|---|---|
| Repetición (doble clic) | Ya existe con ese nombre: **se reusa**, como hoy (VERIFICADO `crear-categoria-producto.ts:28-29`). Si la existente pertenece **a otra unidad** o tiene otro nivel, **no se reusa en silencio**: se avisa «Ya existe "Confitería" en Restaurante» y no se crea nada |
| Concurrencia (dos personas crean el mismo nombre) | El índice `lower(nombre)` deja pasar una sola. La otra hoy terminaría en un error sin traducir (NO VERIFICADO el mensaje): se propone atrapar la violación del único y devolver «ya existe, se reusa» |
| Tiempo (la unidad elegida se desactivó entre abrir y guardar) | Se rechaza: «La unidad está desactivada» (I7) |
| Incertidumbre (no sé si se creó) | Reintentar es seguro: se reusa por nombre |
| Reintento | Igual que repetición |
| Error parcial | No hay: es una sola escritura |
| Datos faltantes | Un rubro sin unidad: si quien lo crea no tiene `categorias`, se rechaza «Elegí a qué unidad pertenece». El alta rápida del formulario de producto **pide la unidad** |
| Cambio de permisos (le sacan `categorias` entre abrir y guardar) | El servidor vuelve a controlar al guardar; si quería crear una unidad, se rechaza (I8) |

### 8.2 Mover un rubro de unidad, o cambiar el nivel

| Situación | Qué pasa |
|---|---|
| Repetición | Mover a la unidad donde ya está no escribe nada y responde «ya pertenece a X» |
| Concurrencia (alguien convierte en rubro la unidad destino mientras yo muevo algo hacia ella) | Postgres traba la fila del padre al controlar la clave foránea: una de las dos operaciones falla. La perdedora recibe «la unidad cambió, recargá» (garantizado por la base, PROPUESTA §7.1) |
| Concurrencia (dos personas mueven el mismo rubro a unidades distintas) | Gana la última escritura. Se propone un control optimista (comparar la unidad de antes) para que la segunda reciba «otra persona lo movió, recargá» |
| Tiempo | El aviso del pasado afectado se calcula al confirmar, no al abrir |
| Incertidumbre o reintento | Repetir con la misma unidad destino no hace nada |
| Error parcial | Una sola escritura más su auditoría, en la misma transacción: o quedan las dos o ninguna |
| Datos faltantes | Destino inexistente, de otra empresa o que no es unidad: lo rechaza la clave foránea, y el servidor lo traduce a «la unidad no existe» (molde existente: `src/core/datos/errores-de-base.ts:62-80`) |
| Cambio de permisos | Exige `categorias`; se controla al guardar |
| Unidad con rubros que se quiere pasar a rubro | Lo rechaza la base (I3); se muestra «primero mové sus N rubros» |

### 8.3 Activar o desactivar

| Situación | Qué pasa |
|---|---|
| Repetición | Escribe el mismo estado (como hoy, VERIFICADO `persistencia/catalogo/categorias-producto.ts:24`) |
| Concurrencia | Gana la última; no afecta plata |
| Desactivar una unidad con rubros activos | Se permite. Sus rubros dejan de ofrecerse para asignar (I7); lo ya asignado sigue contando |
| Datos faltantes (un id inexistente) | «No se encontró la categoría.» (VERIFICADO, O.44) |
| Cambio de permisos | `categorias`, controlado al guardar |
| Tiempo, incertidumbre, reintento, error parcial | Una sola escritura idempotente por estado |

### 8.4 Asignarle la categoría a un producto

| Situación | Qué pasa |
|---|---|
| Repetición o reintento | Escribe el mismo valor |
| Concurrencia (desactivan o mueven la categoría mientras se edita el producto) | Si se desactivó, se rechaza al guardar (I7). Si se movió de unidad, se guarda igual: el producto apunta al rubro y la unidad se deduce |
| Tiempo | Con la lectura vigente (I9), la asignación vale también para las ventas pasadas de ese producto. El formulario lo dice: «se recalculan los reportes de este producto» |
| Datos faltantes | «Sin categoría» sigue permitido: es «Pendiente de completar» |
| Error parcial | Va dentro de la escritura del producto, que ya existe |
| Cambio de permisos | `producto_editar` / `alta_producto`, como hoy |

---

## 9. Niveles 8 y 9. Pantallas y consultas (PROPUESTA)

- **Catálogo › Categorías** (`src/app/(app)/catalogo/categorias/page.tsx`): la tabla se agrupa por unidad, con sus rubros debajo. La columna «Pertenece a» muestra la unidad. Hay acciones «Mover a…» y «Activar/Desactivar», y el alta tiene un selector «Pertenece a: (ninguna, es una unidad) / Restaurante / Hostería». Se cambia el texto de :41, que hoy dice «Lácteos, Bebidas, Pizzas…».
- **Formulario de producto**: el selector agrupa por unidad (Restaurante › Confitería) y muestra solo categorías activas. El alta rápida pide la unidad.
- **Reporte «Por categoría»**: primero las unidades con su total, y adentro los rubros. Al final, «Pendiente de completar» con la lista de productos y un enlace para completarlos.
- **Reporte del período**: compras por unidad, y resultado por unidad (N3).
- **Margen objetivo**: una fila por unidad y por rubro. En el rubro se muestra «hereda de Restaurante: 32 %» cuando no tiene uno propio.
- Todo se controla del lado del servidor. Cada sucursal ve solo lo suyo, como ya hacen los reportes.
- Capturas para que usted apruebe: sobre la pantalla real con los datos reales de su empresa, a 375 px (regla del 2026-11-05).

---

## 10. Nivel 10. Pruebas, oráculo de combinaciones y guardián

### 10.1 Oráculo (tabla de reglas escrita aparte del código)

Se crea con la implementación en `docs/oraculo-combinaciones-categoria-unidad-y-rubro-AAAA-MM-DD.md` (PROPUESTA).

**Dimensiones que cambian plata o visibilidad:**

| Dimensión | Valores | ¿Afecta? |
|---|---|---|
| D1 Categoría del producto | ninguna / unidad / rubro | Sí: dónde cuenta la plata |
| D2 Tipo de producto | PV (se vende) / MP (se compra) | Sí: va a ventas o a compras |
| D3 Por dónde se vendió | carta / fuera de carta (mostrador, producto sin sección) | **No**: el oráculo afirma que da lo mismo (decisión 4) |
| D4 Estado de la categoría | activa / inactiva (incluye unidad inactiva con rubro activo) | No en reportes; sí en lo que se ofrece para asignar |
| D5 Compra | materia prima con unidad / sin categoría / renglón sin mercadería | Sí |
| D6 Origen de la venta | producto / línea declarada SUMA / línea declarada RESTA (N4) | Sí |
| D7 Food cost objetivo | con o sin objetivo propio el rubro / la unidad / la empresa (8 combinaciones) | Sí: qué porcentaje rige |

**Reglas esperadas (extracto):**

| D1 | D2 | D3 | D4 | Resultado esperado |
|---|---|---|---|---|
| rubro Confitería ⊂ Restaurante | PV | carta | activa | Venta en rubro Confitería y en unidad Restaurante |
| rubro Confitería ⊂ Restaurante | PV | fuera de carta | activa | Igual que la fila anterior |
| rubro | PV | cualquiera | **inactiva** | Igual: sigue contando |
| unidad Restaurante | PV | cualquiera | activa | Unidad Restaurante, rubro «Restaurante (sin rubro)» |
| ninguna | PV | cualquiera | — | «Pendiente de completar» (ni unidad ni rubro inventados) |
| rubro ⊂ Restaurante | MP | — | cualquiera | Compra en unidad Restaurante (no en rubro) |
| ninguna | MP | — | — | Compra en «Pendiente de completar» |
| — | renglón sin mercadería | — | — | «Gastos de la sucursal (sin unidad)» |
| D7: rubro sí / unidad sí / empresa sí | | | | Rige la del rubro |
| D7: rubro no / unidad sí | | | | Rige la de la unidad |
| D7: rubro no / unidad no / empresa no | | | | Rige `FOOD_COST_OBJETIVO_PCT` |

**Prueba**: recorre **todas** las combinaciones (son pocas: 3 × 2 × 2 × 2 en ventas y compras, más las 8 de D7) contra la tabla, sin librerías nuevas. Afirma también I5: la suma de las unidades más lo pendiente es igual al total.

### 10.2 Guardián

- `CategoriaProducto` **sale** de la lista de «diccionarios sin efecto propio» (VERIFICADO `test/arquitectura/guardas/columnas-de-significado.ts:31`): ahora decide dónde cuenta la plata.
- Se declaran:
  - `CategoriaProducto.nivel`: dinero (decide si agrupa rubros o pertenece a una unidad).
  - `CategoriaProducto.activo`: visibilidad (qué se ofrece para asignar; no cambia reportes).
  - `CategoriaProducto.nivelDelPadre`: ninguna (es la copia que sirve de discriminador de la clave foránea).
- El guardián falla si aparece otra columna sin declarar.
- Se suma la fila al mapa `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`.

### 10.3 Pruebas obligatorias (cuando se implemente)

- Migración: subir, bajar y subir de nuevo; las filas existentes quedan como UNIDAD.
- La base rechaza un rubro de un rubro, un padre de otra empresa y convertir en rubro una unidad con rubros.
- Concurrencia: crear el mismo nombre al mismo tiempo deja una sola fila; mover hacia una unidad mientras se convierte en rubro deja pasar una sola de las dos.
- Permisos: un operario no puede crear una unidad; un rol sin `categorias` no puede mover.
- Reporte: oráculo completo; I5; «Pendiente de completar».
- Food cost: las 8 combinaciones de D7.
- Prueba de caracterización de «Por categoría» antes y después, que da lo mismo mientras no haya rubros. Hay línea dorada existente en `test/reportes/caracterizacion/reportes-c0.golden.txt` (VERIFICADO que existe). Si cambia por el nuevo texto «Pendiente de completar», se actualiza a propósito.
- Mutaciones (mutar → rojo → revertir → verde) para la herencia del food cost y para I5.

---

## 11. Etapas (la más barata primero)

| Etapa | Qué | Migración | Quién y cuánto |
|---|---|---|---|
| **E0 (hoy mismo)** | Usar «Restaurante» y «Hostería» como unidades: asignarle la suya a cada uno de los 47 productos de venta y a las materias primas, desde Catálogo › Productos. El reporte «Por categoría» ya muestra ventas por unidad | **Ninguna** y **sin código** | Usted o administración, producto por producto: no hay carga masiva (VERIFICADO: el formulario edita de a uno). Cuántas materias primas hay: NO VERIFICADO |
| **E1** | «Sin categoría» pasa a «Pendiente de completar»; compras por unidad en el reporte del período; el formulario ofrece solo categorías activas (I7) | **Ninguna** | Código chico (Sonnet) |
| **E2** | Dos niveles (`nivel`, `padreId`, `nivelDelPadre`); pantalla de Categorías por unidad; mover rubro con aviso del pasado; reportes por rubro y por unidad; herencia del food cost; S1 en permisos | **Sí, aditiva y reversible. Requiere autorización expresa** | Código (Sonnet) + migración |
| **E3** | Resultado por unidad | Ninguna | Código |
| **E4** | Ventas sin producto: cuando se haga la caja N1, la línea declarada apunta a la categoría y lleva su signo; no se crea `ConceptoDeComprobante` | La de la caja N1, con una tabla menos | Cambia el diseño de caja §263-330 |
| **R (retiro)** | Quitar las 5 tablas de centros de costos, `aplicabilidad-de-plan-de-costos.ts` y sus pruebas | **Sí, destructiva. Requiere autorización expresa aparte**, con respaldo, y solo después de E2 | No ahora |
| **N5 (opcional)** | Congelar la categoría en la venta | Sí, en tablas muy usadas | Solo si P1 = «congelar» |

---

## 12. Líneas que se evitarían

Medidas con `wc -l` en el clon del 2026-11-06 (VERIFICADO):

| Qué | Líneas |
|---|---|
| Las 5 tablas en `prisma/schema.prisma` (:3424-3557) | 131 |
| Migraciones de las 5 tablas (`20261019100000`, `20261019101000`, `20261019102000`, subida y bajada) | 282 |
| Pruebas solo de esas tablas (`test/aislamiento/centros-de-costos-rls.test.ts` 181, `test/persistencia/distribucion-de-costos-concurrencia.test.ts` 290, `migracion-centros-de-costos.test.ts` 297, `distribucion-de-costos-dinero.test.ts` 237, `migracion-distribucion-de-costos.test.ts` 370, `test/core/compras-aplicabilidad-de-plan-de-costos.test.ts` 22) | 1.397 |
| Preparación de pruebas `test/setup/centros-de-costos.ts` | 177 |
| `src/core/compras/aplicabilidad-de-plan-de-costos.ts` | 21 |
| **Total que hoy se mantiene y se podría retirar en la etapa R** | **2.008** |

Además se evita lo que nunca llegó a escribirse:
- la etapa U1 del diseño de atribución (casos de uso, bandeja «Pendiente de distribuir», pantallas y claves `distribucion_costos*`, `docs/diseno-atribucion-de-costos-sucursal-y-unidad-2026-10-27.md:41,84`);
- la tabla `ConceptoDeComprobante`, con su alta y baja, su pantalla y sus pruebas. Sin medir porque no existe; estimación NO VERIFICADA del orden de cientos de líneas, comparando con `CategoriaProducto`, que tiene su página de 103 líneas más acción, caso de uso, guard, esquema y persistencia.

Hay que tocar, al retirar, las listas que nombran las tablas: `test/setup/clasificacion-de-tablas.ts:21,172`, `test/arquitectura/semantica-sin-fila.test.ts:59` y el guardián de columnas.

---

## 13. Preguntas abiertas (solo las que cambian el modelo de datos, la plata o los permisos)

**P1. Si corrijo la categoría de un producto, o muevo «Confitería» de Restaurante a otra unidad, ¿deben cambiar también los reportes de los meses pasados?**
- «Sí» (recomendado hoy): no se guarda nada nuevo y se puede completar después lo que hoy está sin asignar.
- «No, lo pasado queda como estaba»: hay que guardar la categoría en cada venta (etapa N5), y lo vendido antes de ese cambio queda como «Pendiente de completar».

Cambia el modelo de datos.

**P2. Los gastos sin mercadería (luz, alquiler, honorarios), ¿quedan en la sucursal sin pasar a ninguna unidad?** Recomendado: sí, porque «el centro de costo es la sucursal». Si alguna vez hay que repartirlos entre unidades, sería otra etapa con nombre propio. Cambia la plata por unidad.

### Supuestos declarados (usted los corrige si no es así)

- **S1.** Crear una unidad exige `categorias` (administración); un operario con `categoria_alta` solo crea rubros.
- **S2.** El «Anticipo recibido» se carga en el mismo rubro que el cargo que adelanta (por lo general, Alojamiento).
- **S3.** Las compras de mercadería van a la unidad de la categoría de la materia prima; no hace falta elegir la unidad en cada factura.
- **S4.** Las unidades son de la empresa y valen en todas las sucursales; no se habilitan sucursal por sucursal. La Central, que no vende, no muestra ventas por unidad.
- **S5.** Un producto puede asignarse directo a una unidad (sin rubro); en el reporte aparece «Restaurante (sin rubro)».
- **S6.** El nombre no se repite en la empresa, aunque esté en otra unidad o en otro nivel.
- **S7.** No hace falta un código para cruzar las unidades con el otro sistema (decisión 11 del 2026-10-06); si hace falta, es una columna aditiva más adelante.
- **S8.** La palabra «Rubro» se usa solo en Categorías y en los reportes de ventas; el tipo de negocio de la empresa sigue siendo «rubro de la empresa» en la consola.

---

## 14. Paso final obligatorio de verificación (cuando se implemente cada etapa con código: E1, E2, E3, E4, R)

**Línea de base:** antes de tocar nada, se corren los 8 comandos en `origin/main` y se anotan:
- código de salida de cada uno;
- cantidad de pruebas pasadas, falladas y salteadas de `npm test` y de `npm run test:e2e`;
- cantidad de hallazgos de `npm run analizar:muerto`.

No se corrió en este diseño (NO VERIFICADO).

En la **misma corrida**, sobre la rama terminada y con la migración aplicada en la base de pruebas cuando corresponda:

1. `npx tsc --noEmit`
2. `npm run lint`
3. `npm run arquitectura`
4. `npm run analizar:muerto`
5. `npm test`
6. `npm run build`
7. `npm run plataforma:build`
8. `npm run test:e2e`

**Criterio de éxito conjunto:**
- Los 8 terminan con código 0 en la misma corrida.
- `analizar:muerto` con **0 hallazgos**. En la etapa R, sin excepciones nuevas en `knip.jsonc` por las tablas retiradas.
- `npm test` y `test:e2e` con **0 fallas**, **ninguna prueba salteada nueva** y **al menos la misma cantidad de pruebas que la línea de base**, más las nuevas: oráculo, guardián, concurrencia, permisos y migración subir-bajar-subir.
- La caracterización de reportes da igual o cambia solo donde se cambió a propósito (el texto «Pendiente de completar»), con el motivo escrito en el commit.
- En E2 y R: la migración se ensayó en una rama de Neon, con respaldo y con la **autorización expresa** del dueño anotada antes de aplicarla en cada base.
- El informe final declara qué código escribió qué modelo: el código lo escribe Sonnet (regla del 2026-11-04).

Si cualquiera de los 8 falla, la etapa no se da por terminada. El arreglo lo hace un Sonnet y se vuelven a correr **los 8**, no solo el que falló.

---

### Archivos clave para implementar

- `/home/user/motor2/prisma/schema.prisma` (`CategoriaProducto` :554-568, `Producto.categoriaId` :367-369, `MargenObjetivo` :571-587, molde de discriminador `ImputacionDeGasto` :3203-3210, las 5 tablas :3424-3557)
- `/home/user/motor2/src/server/actions/catalogo/casos-de-uso/crear-categoria-producto.ts` y `/home/user/motor2/src/server/persistencia/catalogo/categorias-producto.ts`
- `/home/user/motor2/src/app/(app)/catalogo/categorias/page.tsx` y `/home/user/motor2/src/app/(app)/catalogo/productos/producto-form.tsx`
- `/home/user/motor2/src/core/reportes/comun.ts`, `/home/user/motor2/src/core/reportes/periodo-categorias.ts`, `/home/user/motor2/src/core/reportes/periodo-compras.ts`, `/home/user/motor2/src/core/reportes/margen-objetivo.ts`, `/home/user/motor2/src/server/consultas/reportes/periodo.ts`
- `/home/user/motor2/test/arquitectura/guardas/columnas-de-significado.ts` y `/home/user/motor2/docs/diseno-caja-y-cobros-2026-11-04.md` (§263-330, que hay que cambiar en la etapa E4)