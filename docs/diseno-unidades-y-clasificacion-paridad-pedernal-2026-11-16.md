# Frente 2 — Unidades y clasificación: paridad con Pedernal (Fase 1, solo documentos) — 2026-11-16

> **Fase 1 del programa de paridad. SOLO DOCUMENTOS: no se escribió código, ni migraciones, ni se tocó ninguna base; no se abrió ninguna DEC.** Contrato: `_coordinacion/mapa-de-carriles-2026-11-16.md` (repositorio privado `motor2-docs`).
>
> **Este es el documento de entrada (resumen, estado, etapas, carril, dependencias y preguntas).** El detalle está en dos piezas hermanas:
> - `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16-auditoria.md`: tabla «igual / difiere / falta» contra el código real de los dos lados, e inventario de las migraciones de igualación y su estado.
> - `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16-fracciones.md` **(nuevo)**: etapa R4, fracciones y unidad de venta separada.
> - `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16-escalera.md`: niveles 1 a 5 con el estado de cada decisión y la tabla «¿qué pasa si…?» por comando.
>
> **Actualización 2026-11-16 (tras el merge de #324).** El dueño respondió dos cosas (citas en §8): **departamento en la cuenta: «Sí, ya»** y **redondeo de cantidades: «Pasar a cuenta exacta como Pedernal»**. Además el orquestador general decidió que **clases de producto y «unir pares» quedan en este frente** y que **porciones / unidad de venta separada (Pedernal 0051) NO se toman**. Los cambios están marcados «(actualizado)».
>
> **Marcas.** **VERIFICADO** (lo leí en el código, con ruta): código de Motor2 `main` `903c0f6d` y de Pedernal `ZuluHub-ERP` `ad4a9a4` (2026-11-16 11:36 -0300; docs `125e09e`). **CONFIRMADA**: la dijo el dueño, con cita y fecha (cuando la cita me llega por un documento y no por el chat, lo digo). **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**.
> Este repositorio es público: sin nombres de clientes, cifras reales ni identificadores de bases.

---

## 0. Resumen para el dueño

**Pedido de este frente (CONFIRMADA).** Dueño, 2026-11-16: «Sí, las migraciones van a estar aprobadas cuando ya tengamos todo el código igual. En realidad a nosotros nos falta caja, que tiene que ver con el cobro. **Las unidades de clasificación**, el tema de datos, planes y perillas…» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Paridad con Pedernal: qué falta y cómo se trabaja»). Lectura (la mía; el dueño la corrige): «unidades de clasificación» = **las unidades de medida y la clasificación del producto**. Si quiso decir otra cosa, dígalo: es la primera pregunta de §8.

**Dónde estamos, en una línea.** Casi todo el trabajo de este frente **ya está diseñado y confirmado por el dueño en piezas anteriores** (unidades, merma, clasificación, clases, presentaciones); en código hay **solo los cimientos sin efecto**; **ninguna migración de este frente existe como archivo** y las que reescriben datos siguen sin autorización. Lo que faltaba era ordenarlo, contrastarlo con la versión vigente de Pedernal y declarar carriles. Eso es este PR.

| Tema | Diseño | Código hoy (VERIFICADO) | Falta |
|---|---|---|---|
| Unidades de medida (las 14 de Pedernal, conversión exacta) | `docs/diseno-unidades-de-medida-como-pedernal-2026-11-15.md`, niveles 1 a 5 y respuestas Q-U1 a Q-U3 confirmadas | **U0 hecho** (#299): `src/core/catalogo/unidades-de-medida.ts` (las 14, `bigint`, `convertirCantidadExacta`) **sin conectar a ninguna pantalla, tabla ni cálculo** | U1 (columna), U1b (rellenar por base), U2 (leer), U3 (completar las 14) |
| Merma sobre el bruto | `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md`, Q-M1 a Q-M3 confirmadas | **M0 hecho** (#297): una sola función `src/core/catalogo/merma.ts` + guardián `test/arquitectura/formula-de-merma-unica.test.ts` | M1 a M3b |
| Presentaciones de compra | `docs/diseno-presentacion-en-la-linea-de-compra-2026-11-15.md` (d1 a d5 **en reserva**, no se construyen) | Etapas a y a2-1 (#304, #309): columnas en `Presentacion`, falla cerrada con dos activas de la misma unidad; interruptor `PRESENTACIONES_VISIBLES = false` (`src/core/catalogo/presentaciones-visibles.ts:13`) | Nada pedido (Pedernal tampoco compra con dos presentaciones de la misma unidad) |
| Clasificación comercial (departamento → categoría, 4 niveles) | `docs/diseno-clasificacion-comercial-igual-a-pedernal-2026-11-13.md` (E1 a E3) | **Nada**: `CategoriaProducto` sigue plana (`prisma/schema.prisma:591`), sin `padreId` | E1 árbol, E2 vínculo con vigencia, E3 camino en el renglón de venta; **0048 (departamento en la cuenta) sin decidir** |
| Clases de producto (5 de Pedernal) y «unir pares» | `docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md` (E0 a E6; unión par por par = E6) | **Nada**: `enum TipoProducto { MP PV }` (`schema.prisma:339`) | E1 a E6 |

**Hallazgos nuevos de esta auditoría (cambian lo que se creía):**

1. **U0 y M0 ya están en `main`** (los diseños de 2026-11-15 hablaban de ellos como futuros). Las etapas siguientes arrancan desde ahí, no desde cero.
2. **«Unir pares» no existe en Pedernal** (búsqueda sin resultados en `ZuluHub-ERP` y `ZuluHub-docs`). Es **una operación propia de Motor2** para llegar al resultado de Pedernal: Pedernal modela la reventa como **un solo producto**; Motor2 hoy la modela como **dos** (una materia prima + un producto vendible con receta 1 a 1). Unir los pares es la forma de igualar; reescribe datos (§5 de la auditoría).
3. **La clasificación de Pedernal tiene backend completo pero NO tiene pantalla** (`apps/web` sin ruta de clasificación; solo la maqueta `clasificacion.html`). El diseño de Motor2 del 2026-11-13 daba por hecho que había pantallas aprobadas: la «forma» a igualar en pantalla es la **maqueta**, no una pantalla real. Marca de riesgo para el frente 6.
4. **La unidad de compra en Pedernal no es del producto**: se elige **en cada línea de recepción** (`linea_de_recepcion.unidad_de_compra_id`); Pedernal no tiene `unidadCompraId` en producto. Motor2 sí (`Producto.unidadCompraId` + `factorConversion`). Diferencia de forma que ninguna pieza anterior declaraba; pertenece al frente 5 (compras) y se avisa (§7).
5. **Merma: Pedernal la tiene apagada de base** (perilla `composiciones_con_perdida`, `src/capacidades/planes/perillas.ts:60-65`, `encendida:false`) y solo en la receta; Motor2 la tiene siempre encendida y además en opciones y combinaciones. Diferencia por datos existentes, ya declarada para opciones y combinaciones; **la perilla es nueva** y es del frente 4.
6. **(actualizado) Redondeo de cantidades: DECIDIDO por el dueño.** `redondearACantidadDeUnidad` redondea con números de coma flotante (`src/core/movimientos/transiciones.ts:173`: `Math.round(cantidad * 10**dec) / 10**dec`). Dueño, 2026-11-16: «Pasar a cuenta exacta como Pedernal» → **CONFIRMADA**. Entra en este frente como etapa **A1b** (§1), **medida primero**. Queda **una pregunta de alcance** (P2, §8): qué hace con `Unidad.decimales`.

---

## 1. Qué se propone (la forma más barata, regla del 2026-10-27)

El orden sale de «lo más barato primero» y de que **las migraciones se aprueban recién cuando todo el código esté igual** (dueño, 2026-11-16, cita arriba): primero lo que **no toca datos**, después lo aditivo y reversible, al final lo que reescribe y exige autorización por base.

| Etapa | Qué | Toca datos | Estado |
|---|---|---|---|
| **A0** (hecha) | Unidades U0 y merma M0: código puro y función única | No | En `main` (#299, #297) |
| **A1** | Consultas de **solo lectura** por base: unidades y equivalencias propuestas (U0 del diseño), recetas y líneas con merma (M1), categorías y productos, pares compra+venta (clases §11.3.9) | No | PROPUESTA, sin pedido nuevo: ya diseñadas |
| **A1b** (actualizado) | **Cantidad exacta con 4 decimales fijos en el stock NUEVO**, como Pedernal: `redondearACantidadDeUnidad` (`transiciones.ts:173`) pasa a `Decimal` y los puntos de llamada dejan de redondear a `Unidad.decimales` y redondean a **4** (detalle en §8). **Sin migración y sin reescribir filas existentes**: las columnas de cantidad ya son `Decimal(14,4)` (**V**: `MovimientoStock.cantidad` `schema.prisma:1419`, `saldoSistema` `:1571`, `RecetaIngrediente.cantidad` `:964`, `CuentaItem.cantidad` `:2500`, `cantidadStock` de factura `:2947` y `:3072`, entre otras). **Antes de aplicar:** medir el efecto en el Kardex con la copia de solo lectura, regenerar los `golden` con motivo declarado, coordinar con el frente 3 (primitiva exacta) | No (código), **cambia resultados de stock nuevo** | **CONFIRMADA** («4 decimales fijos como Pedernal», 2026-11-16) |
| **A2** | Aditivas y reversibles, **con `down.sql`**, solo escritas y llevadas a `main` (no aplicadas): `Unidad.codigoFijo` (U1), `baseDeCantidad` en las tres tablas de versiones (M2), árbol en `CategoriaProducto` (E1), `ProductoClasificacion` (E2), columna `Producto.clase` (clases E1) | Esquema, no filas | PROPUESTA; **no se escriben hasta que el dueño confirme los niveles 1 a 5 de cada una** (compuerta) |
| **R4** (actualizado) | Fracciones 2/4/8 y, unidad de venta separada (**confirmada (b)**): ver `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16-fracciones.md`. E0 hecha (#302); E1 a E5 diseñadas; E1b, E2 y E5 piden autorización expresa por base | Esquema + datos (E1b) | Ratificada (2026-11-16); **no escrita** |
| **A3** | El código lee lo nuevo (U2, M3a, pantallas de clasificación y selector) | No | Después de A2; la pantalla es del frente 6 |
| **A4** | **Reescriben datos o cambian tipos**, **«requiere autorización expresa por base, con respaldo y ensayo»**: U1b (rellenar `codigoFijo`), U3 (agregar las 14 a empresas existentes), M2b (merma de 2 a 4 decimales), M3b (cargar en bruto y convertir al editar, sin migración pero cambia stock y costo de lo nuevo), clases E1b (relleno parcial) y E6 (**unir pares**), E3 de clasificación (camino en `CuentaItem` **y departamento en `Cuenta`** (actualizado): aditivas, pero la reversión destruye lo sellado) | **Sí** | Nada aplicado; congelamiento vigente |

**Lo que NO entra (nadie lo pidió; sugerencias, no código):** fusionar unidades duplicadas; renombrar presentaciones; (actualizado) **porciones y unidad de venta separada (Pedernal 0051, R4) ENTRAN** como etapa propia: dueño, 2026-11-16, «Sí, como Pedernal (2, 4 y 8)» (ver `…-fracciones.md`); filtro de productos por clasificación; reportes por departamento; responsable de departamento.

---

## 2. Carril de escritura (declaración exacta, Fase 2)

> En Fase 1 este frente escribe **solo** `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16*.md`. Lo que sigue es lo que se pide para Fase 2; cada ruta cita su necesidad (§1 de la escalera).

**Carpetas (propias):**

- `src/core/catalogo/unidades-de-medida.ts` y sus pruebas (`test/catalogo/unidades-de-medida*.ts`, `test/arquitectura/unidades-de-medida-dimensiones.test.ts`).
- `src/core/catalogo/guardia-de-unidad.ts`, `src/core/catalogo/lectura-de-cantidad.ts` (hoy `PARES_DE_UNIDADES` por nombre; pasa a factor de la tabla, DT-U5).
- `src/core/catalogo/merma.ts` y su guardián `test/arquitectura/formula-de-merma-unica.test.ts`.
- `src/core/features/catalogo/unidades.guard.ts`, `src/server/actions/catalogo/unidades.ts`, `src/server/actions/catalogo/casos-de-uso/{crear-unidad,actualizar-activa-unidad,actualizar-decimales-unidad}.ts`, `src/server/persistencia/catalogo/unidades.ts`, `src/app/(app)/catalogo/unidades/**`.
- Archivos nuevos de clasificación bajo `src/core/catalogo/clasificacion/**`, `src/server/actions/catalogo/casos-de-uso/clasificacion*.ts`, `src/server/persistencia/catalogo/clasificacion*.ts` (nombres a confirmar con los guardianes de arquitectura al implementar).
- `scripts/operaciones/unidades-*.sql`, `merma-*.sql`, `clasificacion-*.sql`, `clases-*.sql` (consultas y operaciones por base).
- Diseños: `docs/diseno-unidades-y-clasificacion-*`, y las piezas ya escritas de unidades, merma, clasificación y clases (solo para mantenerlas al día).

**Modelos de `prisma/schema.prisma` que este frente edita (solo estos y avisa; el archivo es zona restringida y entra por turno):**

| Modelo | Cambio | Etapa |
|---|---|---|
| `Unidad` | columna `codigoFijo` (+ CHECK de 14 valores) | U1 |
| `CategoriaProducto` | `padreId`, `nombreClave`, `version`, `creadoEn`, `actualizadoEn`, único nuevo | E1 |
| `ProductoClasificacion` (nuevo) | vínculo de solo inserción | E2 |
| `RecetaVersion`, `VersionDeOpcion`, `RecetaDeCombinacionVersion` | columna `baseDeCantidad` | M2 |
| `RecetaIngrediente`, `RendimientoLocalIngrediente`, `ConsumoDeOpcion`, `RecetaDeCombinacionIngrediente` | `mermaPorcentaje` de `Decimal(6,2)` a `(7,4)` | M2b |

**Modelos que se tocan pero NO son solo míos (se piden por turno al orquestador general; ver §3):** `CuentaItem` (E3: dos columnas del camino), `Cuenta` (**0048 confirmado**, entra con E3: se pide el turno al orquestador general), `Producto` (columna de clase y, si se retira, `categoriaId`), `MovimientoStock` y `Presentacion` (no se tocan: ver §3).

**Zona restringida que se pide al orquestador general** (nada se edita en concurrencia): numeración de migraciones y `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts`; `test/modulos/__golden__/*` y `caracterizaciones-congeladas` si una prueba de caracterización cambia (por diseño **no deberían cambiar**: las migraciones de A2 no alteran ningún resultado); `src/core/permisos/acciones.ts` (clasificación **no suma clave**, usa las existentes: ver escalera §5); `src/core/textos/*` (textos nuevos: ninguno propuesto; los aprobados de unidades, merma y clasificación se reutilizan); `docs/registro-de-decisiones.md` (no abro DEC); `knip.jsonc` si la primitiva `unidades-de-medida.ts` queda sin consumidor al cerrar una etapa.

**Timestamps de migración:** se reservan por frente al pasar a Fase 2. No se asigna ninguno acá.

---

## 3. Dependencias con los otros frentes y con las corrientes en curso

> Lo que sigue es lo que **este frente avisa u ofrece**; lo que otra sesión pida a cambio es información, no orden. Los mensajes a los frentes 3, 5 y 6 salen junto con este PR.

| Con | Qué hay en común | Contrato propuesto |
|---|---|---|
| **Frente 5 COMPRAS** (`…kh2bayQURHmaJULuc6`) | `Presentacion`, `Producto.unidadCompraId`/`factorConversion`, `MovimientoStock.unidadCompraId`, `FacturaProveedorRenglon.unidadCompraId`: **todas referencian `Unidad`**; la conversión de compra usa `convertirCantidadAUnidadDeStock` (`transiciones.ts:193`) | **Yo ofrezco** `convertirCantidadExacta` y `UNIDADES_DE_MEDIDA` (`src/core/catalogo/unidades-de-medida.ts`, ya en `main`) y la columna `Unidad.codigoFijo`. **Ellos son dueños** de `Presentacion` y de las líneas de compra; yo no los edito. Aviso: Pedernal elige la unidad **por línea de recepción**, no por producto: si compras rediseña la línea, que no dependa de `Producto.unidadCompraId`. |
| **Frente 3 DATOS** (`…kfrA1HP5aCRYMqYak9`) | Primitiva de cantidad y redondeo: Pedernal guarda cantidades con 4 decimales y no redondea; Motor2 redondea al `Unidad.decimales` y con `number` (`transiciones.ts:173`); `timestamptz` y ids que manda la app (cuando creo `ProductoClasificacion`, nace con la forma de Pedernal: id de la app, `solo inserción` por disparador) | **Pido** que la regla «tabla NUEVA nace con la forma de Pedernal» (E5 del plan de paridad) la declaren ellos y yo la sigo. **Pregunta abierta para ellos:** ¿`redondearACantidadDeUnidad` pasa a enteros/`Decimal`? Hasta que respondan no lo toco. |
| **Frente 6 PANTALLAS** (`…kk5PrAyuuNP3Ufwf9V`) | Pantalla de unidades (pasa de «crear» a «resolver pendientes»), pantalla y selector de clasificación (maqueta, **no hay pantalla real en Pedernal**), ficha del producto (clase, clasificación), «Pendiente de completar» | **Yo ofrezco** los casos de uso y las lecturas; **ellos son dueños** de `src/app/**` de la ficha y de la pantalla nueva. La pantalla de unidades `src/app/(app)/catalogo/unidades/**` la propongo como mía (cambia con U2); si quieren absorberla, lo hablamos. |
| **Frente 4 PLANES y PERILLAS** (`…kimyKRo3i4pWzavWoj`) | La perilla `composiciones_con_perdida` de Pedernal (apagada de base) no existe en Motor2; el tope de niveles de clasificación es una constante **fijada por la plataforma y no reducible** (función de la base) | **Pregunta para ellos:** ¿la merma en Motor2 pasa a perilla o queda siempre encendida (hoy es así y hay datos)? Hasta que el dueño decida, **queda siempre encendida** (diferencia declarada). |
| **Frente 1 CAJA** (`…khLytEXE6qWCg18UkK`) | Ninguna fila común hoy. `CuentaItem` (camino en el renglón, E3) es de ventas, que ellos pueden tocar | Aviso si escriben en `CuentaItem`/`Cuenta`: E3 pide dos columnas ahí; se coordina el turno de `schema.prisma`. |
| **Ocultar** (`…khnmfSfh88wNWCu66B`) | Toca `Producto` y `MovimientoStock` (disparador de existencia) | No se pisa: clases agrega una columna a `Producto` **después** de que Ocultar cierre su etapa. |
| **Roles P1 Parte** (`…kg16mmRbJwGpsiMpHA`) | Permisos; clasificación **no suma claves** | Sin choque. |
| **Textos** (`…kipcKtTwtYF9fwRY4H`) | Los textos nuevos de unidades, merma y clasificación van por su catálogo T1 | Ya aprobados por el dueño: «Pendiente de completar», T-M1 a T-M4, «Clasificación comercial», «Departamento», «Categoría», «Crear», «Renombrar», «Mover», «Cambiar», «Primero desactivá lo que tiene adentro.», T7. Ninguno nuevo. |

---

## 4. Migraciones de igualación: inventario y estado

El detalle (qué reescribe, qué se puede revertir, cómo se ensaya) está en la pieza de auditoría, §5. **Resumen:** **ninguna de las migraciones de este frente existe como archivo en `prisma/migrations`** (las únicas relacionadas, `20261115150000` y `20261115151000`, son aditivas de presentaciones y ya están en `main`); todas están en diseño. Las que **reescriben datos o endurecen** y por eso piden «**autorización expresa por base, con respaldo y ensayo**»: U1b, U3, M2b, M3b, clases E1b, **E6 (unir pares)** y el camino en la venta (E3, por su reversión destructiva). Las de otros frentes que figuran en el mismo inventario (costo y precio mayores que cero; poda de promos, tiempo 2) **no son de este frente** y se listan solo para que nadie las confunda.

---

## 5. Compuerta y estado de decisiones

Nivel 6 (tablas) **no se diseña de nuevo acá**: las propuestas de esquema ya están en las piezas hermanas y siguen **PROPUESTAS**; no se migra nada hasta que el dueño confirme los niveles 1 a 5 de este documento (compuerta del programa). Los niveles 1 a 5 y sus estados están en la pieza de escalera. De las decisiones, **las que el dueño ya dijo con cita** son CONFIRMADAS; las **asumidas por un orquestador** (P1, P2, P3, P7 de clasificación; DT de unidades y merma) figuran como PROPUESTA hasta que el dueño las valide.

## 6. Qué cambia respecto de las piezas anteriores (para no discutir dos veces)

- Se **cierra** la pieza de unidades en U0; se agrega que el **informe de equivalencias** es la etapa A1 y no hace falta escribirlo antes de que el dueño confirme.
- Se **agrega** el inventario de migraciones y el mapa de carriles (no existían).
- Se **corrige** la descripción de Pedernal: la clasificación **no tiene pantalla real**; «unir pares» **no es de Pedernal**; la unidad de compra **es por línea**.
- No se cambia **ninguna** decisión del dueño ni ningún esquema propuesto.

## 7. Preguntas a otros frentes y al orquestador general (no son preguntas al dueño)

1. **(Resuelta, actualizado)** R4 (porciones, Pedernal 0051): el dueño dijo «Sí, como Pedernal (2, 4 y 8)» → **entra como etapa propia** (pieza `…-fracciones.md`). Queda **una** pregunta al dueño sobre la unidad de venta separada (choca con la respuesta del 15/11: ver esa pieza §4).
2. **(Resuelta)** Las **clases de producto** y «unir pares» **quedan en este frente** (decidido por el orquestador general).
3. **(Resuelta)** Redondeo: lo decidió el dueño (§8). **Coordinar con el frente 3 la edición de `transiciones.ts`** (zona de stock): él da la primitiva de cantidad exacta; yo aplico en mi carril tras medir.
4. **Frente 4:** ¿la merma pasa a perilla?
5. **Frente 5:** la unidad de compra por línea (como Pedernal) en lugar de por producto.

## 8. Decisiones del dueño y preguntas (una por vez)

**Respondidas (CONFIRMADAS; fuente: `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Fase 1 de los frentes»; la cita me llega por el orquestador general):**

- **P1. Departamento en la cuenta de venta (Pedernal 0048).** Dueño, 2026-11-16: «Sí, ya». **CONFIRMADA** la opción (c): el «Departamento» se fija en la cuenta al abrirla (no cambia después; vender un producto de otro departamento **no se bloquea**; el selector se oculta con 0 o 1 departamentos, como en Pedernal) y **entra con E3**. Es una columna anulable en `Cuenta` (aditiva) y **zona restringida**: se pide por turno al orquestador general. Consecuencia: E3 pasa a ser la etapa más delicada (toca `Cuenta` y `CuentaItem`, tablas muy usadas por mostrador y mesas) y exige pruebas de regresión de ventas (precio, descuento de stock y foto de la línea idénticos). Los textos del selector son los ya aprobados en Pedernal; **ninguno nuevo se inventa acá**.
- **P2 anterior (redondeo).** Dueño, 2026-11-16: «Pasar a cuenta exacta como Pedernal». **CONFIRMADA**: `redondearACantidadDeUnidad` pasa a aritmética exacta con 4 decimales. Procedimiento fijado por el orquestador general: **medir el efecto en el Kardex con la copia de solo lectura, regenerar los `golden` con el motivo declarado, coordinar `transiciones.ts` con el frente 3**.

- **P2. Decimales del stock.** Dueño, 2026-11-16: «4 decimales fijos como Pedernal» (registrada en `motor2-docs`, «tercera tanda»; la cita llega por el orquestador general). **CONFIRMADA** la opción (b): el **stock nuevo** guarda 4 decimales fijos, **no** «los de cada unidad». Alcance y efectos en §8b.

**Fila de espera:**
- **P2b (respondida).** Unidad de venta separada: «También en otra unidad, como Pedernal» (2026-11-16) → **CONFIRMADA (b)**, etapa E5 después de las 14 unidades; ver la pieza de fracciones §4.
- **P3.** Confirmar «en bloque» las asunciones de clasificación solo del orquestador: diseño del 06/11 («unidad → rubro») reemplazado, vínculo producto → nodo de solo inserción, `CategoriaProducto` ampliada en lugar de tabla nueva.
- **P4.** ¿Merma a perilla? (solo si el frente 4 la necesita; hoy el frente 4 **no** la crea).
- **P5.** Por base: unidades o pares que no entren en la regla (con el informe en la mano).

## 8b. P2 en detalle: qué cambia y qué no (A1b)

**Hecho verificado.** Todas las columnas de cantidad de stock ya son `Decimal(14,4)`; lo que impone «los decimales de cada unidad» es **código de aplicación**, no el esquema. Por eso **no cambia la escala de ninguna columna** y **no hace falta migración**. Lo existente queda como está (sus valores ya estaban redondeados a los decimales de su unidad); **solo rige para lo que se registre desde A1b**. Eso coincide con lo que dijo el dueño («stock nuevo»); **si se quisiera reescribir lo viejo, sería otra decisión con autorización expresa por base** (no está pedido).

**Qué toca (V, `grep` de `redondearACantidadDeUnidad`):** 14 puntos de llamada en 11 archivos que hoy pasan `Unidad.decimales`: `armar-linea-de-movimiento.ts:190,203`, `registrar-movimiento.ts:144`, `registrar-conteo-fisico.ts:130`, `resolver-conteo-pendiente.ts:62`, `armar-filas-de-movimiento.ts:112`, `reparto-de-stock.ts:114,126`, `plan-de-la-venta.ts:151-152`, `filas-de-venta.ts:98`, `cantidad-pedido.ts:53,58` (más los que ya usan 4: `origen-venta.ts:67`, `reparto-de-stock.ts:54`, y `arrastre-redondeo.ts`, que usa 8 por dentro). Son archivos de **stock y de punto de venta**: se coordinan con el frente 3 (zona de stock) y se avisa al 1 y al 6.

**Qué sigue igual y qué deja de tener sentido (se declara, no se poda sin aviso):**
- `Unidad.decimales` deja de gobernar el stock: queda como dato sin lector → **candidata a poda** (ocultar y después borrar, con aviso al dueño). **No se borra ahora.**
- `actualizarDecimalesUnidad` y la guardia R3 de `validarPasoVenta` (el paso de un producto «que se produce» no puede ser más fino que `Unidad.decimales`) pierden su motivo; **coordinar con R4** (fracciones: paso 0,125 es de 3 decimales y cabe en 4).
- El **arrastre de redondeo** (Task #27) existe porque se redondeaba a pocos decimales; con 4 sigue haciendo falta cuando el consumo exacto tiene más de 4 (⅓), pero rara vez. **Se conserva.**
- **Entrada de datos:** hoy `validarCantidad` rechaza más decimales que los de la unidad (`src/core/datos/cantidad.ts`); con 4 fijos admitiría hasta 4. **Supuesto declarado (el dueño lo corrige):** la entrada pasa a aceptar hasta 4 decimales, como Pedernal; es lo que hace consistente «4 fijos».

**Antes de aplicar (procedimiento fijado por el orquestador general):** (1) medir el efecto en el Kardex con la copia de solo lectura, **comparando antes y después** sobre el mismo conjunto de movimientos (cantidades, saldos, costos por unidad de stock y valuación); (2) **declarar el motivo** de cada `golden` que cambie (`test/movimientos/caracterizacion`, `test/reportes/caracterizacion/…golden…`, `test/recetas/caracterizacion-consumo-y-costo.test.ts`, `test/movimientos/venta-caracterizacion-consumo.test.ts`) y regenerarlos; (3) el cambio se mergea solo con la medición adjunta. **NO VERIFICADO** cuántos movimientos reales cambiarían (no leí ninguna base).

**«¿Qué pasa si…?» (A1b):** *repetición*: la misma operación con la misma clave sigue siendo idempotente (la clave de idempotencia no cambia). *Concurrencia*: dos ventas simultáneas del mismo producto siguen serializadas por el bloqueo existente; la cuenta exacta no agrega carrera. *Tiempo*: movimientos viejos con 2 decimales y nuevos con 4 conviven en el mismo saldo (suma exacta, sin coma flotante). *Incertidumbre*: un consumo con más de 4 decimales se redondea **una sola vez** a 4 con la regla del empate que se aleja del cero (la de Pedernal) y el resto va al arrastre. *Error parcial*: todo en la misma transacción que la venta o el movimiento (ya así). *Datos faltantes*: unidad sin decimales → ya no importa (4 fijos). *Permisos*: sin cambio.

## 9. Sugerencias (no implementadas)

Fusionar unidades equivalentes duplicadas; nombre de presentación y peso variable (reservadas); filtro de la lista de productos por clasificación; reporte de ventas por departamento; pantalla de gestión de pares (solo si aparecen muchos en alguna base).

## 10. Riesgos y pendientes

- **Nada de esto se aplica a ninguna base**: congelamiento vigente; cada reescritura pide palabra expresa del dueño **por base**, con respaldo y ensayo en copia (nunca la principal).
- **Datos reales NO verificados por mí** (solo por el orquestador, copia de solo lectura, relatado en las piezas anteriores: base con las cinco unidades sembradas, sin recetas y con dos categorías planas sin productos). **No vale para otras bases**: se recuenta en cada una (etapa A1).
- Pedernal cambia todos los días: `git fetch` otra vez antes de pasar a Fase 2.
- **Clon de Pedernal de un solo commit** (`git log` inútil): lo que cambió «desde el 13/11» se toma de `novedades-para-motor2.md` y de los archivos, **no** de commits. NO VERIFICADO por PR.
- Pedernal: **faltan 0035, 0039 y 0040** en la secuencia de migraciones y **no están 0059 en adelante** (las novedades hablan de 0060, 0061 y 0063 aprobadas o sin mergear): NO VERIFICADO qué contienen y si tocan unidades o clasificación.
- **Código de Pedernal NO leído:** casos de uso y consultas de clasificación en detalle, el sellado del camino al vender, el selector de la ficha, el resto de `novedades-para-motor2.md` (252 líneas, solo leí las filas de este frente).
