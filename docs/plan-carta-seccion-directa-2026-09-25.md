# Plan: la carta ubica cada ítem directo en su Sección — se elimina la indirección por Categoría de producto

Plan escrito el 2026-09-25, sobre `485cfe7` de `claude/merge-menu-inventory-repos-5ot8uc` (M1-M8 de la agrupación de ítems, ya implementado y pusheado, sin llegar a `main` ni a Neon). Revisa dos decisiones YA IMPLEMENTADAS pero NUNCA mergeadas a `main` — es seguro reabrirlas porque no tocaron producción.

## Por qué (decisión del dueño, 2026-09-25)

Dos hallazgos verificados contra el código real llevaron a esto:

1. **La imagen por ítem no hace nada.** El endpoint de motor2 manda `ItemCartaV1.imagenUrl` de cada ítem, pero `restaurant-menu-design/lib/carta-motor2.ts:137-143` (el mapper que arma lo que se dibuja) SOLO copia `SeccionCartaV1.imagenUrl` (la de la sección) — la de cada ítem individual nunca se usa. Decisión del dueño: *"la imagen debe ser de la sección y ya"*.
2. **La indirección por Categoría de producto no corresponde al modelo real.** El dueño pensó "sección → ítem" (como la sheet: una columna `categoria` = sección, una columna `platillo` = ítem, sin nivel intermedio). Lo que se implementó en el plan de carta-catálogo original (`docs/plan-carta-catalogo-2026-09-24.md`, D4) fue "sección → categoría de producto → ítem", reusando la Categoría de Catálogo para ubicar en la carta. Decisión del dueño: *"los productos que no tengan ítem agrupado van a sección y ya"* — es decir, tanto un producto suelto como un ítem agrupado eligen su sección DIRECTO, sin Categoría en el medio.

`CategoriaProducto` sigue existiendo igual que siempre para Catálogo (rubro comercial, reportes internos) — lo único que se elimina es su uso para UBICAR algo en la carta.

## A. Qué cambia (verificado contra el código real)

1. **`CategoriaSeccionCarta` (la tabla puente) queda sin ningún uso** y se elimina. Hoy la usan: `src/core/carta/reporte-secciones.ts` (reagrupa "ventas por categoría" en secciones), `src/server/actions/carta/secciones.ts` (`asignarCategoriaASeccionCarta`), la pantalla `/catalogo/carta` (bloque "Categorías en esta sección"), y quedan referencias en al menos 12 archivos de test (`carta-solo-lectura`, `acciones-carta`, `acciones-items-agrupados`, `admin-items-agrupados`, `api-carta-agrupados`, `items-agrupados-consulta`, `menu-consulta`, `reporte-secciones`, `sincronizar-precio-grupo`, specs e2e de `carta-admin`/`carta-items-agrupados`/`api-carta*`/`accesibilidad`/`sincronizar-precio-grupo`, y `test-db.ts`).
2. **`ContenidoCartaProducto`** pasa a tener `seccionCartaId` (FK directa a `SeccionCarta`, obligatoria cuando `visibleEnCarta = true`) en vez de heredar la sección de `Producto.categoriaId`. Se elimina la columna `imagenUrl` (punto 1 de arriba).
3. **`ItemAgrupadoCarta`** cambia `categoriaId` → `seccionCartaId` (ya acordado en el mensaje anterior). Se elimina la columna `imagenUrl`.
4. **Orden dentro de la sección, simplificado.** Hoy: `ordenCategoria` (orden de la categoría en la sección) → nombre de categoría → `ordenContenido` → nombre del ítem. Sin categoría intermedia, pasa a ser directo: `orden` (de `ContenidoCartaProducto`/`ItemAgrupadoCarta`) → nombre del ítem. Esto además SIMPLIFICA `armar-menu.ts`: se elimina el mapa `ubicacionPorCategoria` y toda la lógica de "categoría dentro de la sección".
5. **`ItemCartaV1.categoria`** (el campo del contrato, hoy "nombre de la CategoriaProducto del PV") sigue existiendo tal cual para un PV suelto (informativo, confirmado que restaurant-menu-design no lo renderiza — solo lo exige como string no nulo en su guardia de forma). Para un ítem agrupado, que ya no tiene Categoría, pasa a llevar el nombre de la SECCIÓN — sigue siendo un string no vacío, no rompe la guardia de forma del otro repo, y no hace falta subir `version`.
6. **`ItemCartaV1.imagenUrl`** se mantiene en el contrato (para no romper la guardia de forma de restaurant-menu-design, que exige la clave) pero pasa a emitirse SIEMPRE `null` — no hay de dónde sacarlo. No hace falta tocar restaurant-menu-design (ya ignora ese campo).
7. **Reporte "Ventas por sección de carta" (`reporte-secciones.ts`) necesita rehacerse a nivel de PRODUCTO, no de categoría.** Hoy reagrupa el reporte de "ventas por categoría" vía la tabla puente (una categoría → una sección). Sin la tabla puente, dos productos de la misma categoría podrían estar en secciones distintas (o uno visible y otro no) — la única fuente honesta de "en qué sección de carta se ve este producto" es su propio `ContenidoCartaProducto.seccionCartaId` (o, si es una opción de un ítem agrupado, la sección del `ItemAgrupadoCarta`). El reporte nuevo agrupa `rep.ventas.porProducto` (ya existe, lo usa `generarReporteVentasPorCategoria`) por la sección real de CADA producto, no por su categoría. Un producto sin `ContenidoCartaProducto` visible y sin agrupar cae en "Sin sección" — más correcto que hoy, porque hoy un producto invisible en la carta pero con categoría mapeada igual contaba en una sección.
8. **Pantalla `/catalogo/carta`:** se elimina el bloque "Categorías en esta sección" (y `asignarCategoriaASeccionCarta`). El bloque de contenido de producto (`ContenidoProducto`) suma un select de Sección de carta (obligatorio si "Se muestra en la carta" está tildado) y pierde el campo de imagen.
9. **Pantalla `/catalogo/carta/agrupados`:** el formulario de ítem agrupado cambia su select de "Categoría" por uno de "Sección de carta", y pierde el campo de imagen (ya decidido en el mensaje anterior).

## B. Decisiones de diseño

| # | Decisión | Recomendación |
|---|---|---|
| DA1 | ¿Se borra `CategoriaSeccionCarta` o se deja sin usar? | **Se borra** (modelo + tabla + las dos acciones que la escriben). Nada la va a leer nunca más; dejarla sin usar es una trampa para quien la encuentre después. |
| DA2 | `ContenidoCartaProducto.seccionCartaId`: ¿obligatoria siempre, o solo si `visibleEnCarta`? | **Se valida en la Server Action:** si `visibleEnCarta = true`, `seccionCartaId` es obligatoria. Si `visibleEnCarta = false`, se guarda igual (por si se vuelve a activar después) pero no se exige. En la base queda `String?` (nullable) para permitir ese caso. |
| DA3 | Migración de datos de lo ya cargado en las bases LOCALES de prueba (M1-M8) | Estas tablas solo tienen datos de prueba en `motor2_agrupados`/`motor2_agrupados_e2e` (bases descartables, nunca Neon). **Se recrean desde cero** (drop + create), no hace falta backfill. |
| DA4 | Reporte por sección: ¿cambia su forma pública (`ReporteVentasPorSeccion`)? | **No.** Mismo shape (`porSeccion`, `pvSinCategoria`, `categoriasSinSeccion`... revisar si `categoriasSinSeccion` sigue teniendo sentido o pasa a ser `productosSinSeccion`, ver M en detalle). Cambia SOLO cómo se calcula internamente. |

## C. Pasos (REQUIERE AUTORIZACIÓN EXPRESA para M1 — migración de schema, solo contra bases locales `motor2_agrupados`/`motor2_agrupados_e2e`, nunca Neon)

- **M1 (schema):** `ContenidoCartaProducto` gana `seccionCartaId String?` (FK a `SeccionCarta`) y pierde `imagenUrl`. `ItemAgrupadoCarta` cambia `categoriaId`→`seccionCartaId` (FK a `SeccionCarta`) y pierde `imagenUrl`. Se borra `CategoriaSeccionCarta`. Actualizar `test-db.ts` y `carta-solo-lectura.test.ts` (ya no hay 8 tablas de carta con esa puente contada aparte — recontar).
- **M2:** `armar-menu.ts` — sacar `ubicacionPorCategoria`/`ordenCategoria`; ordenar directo por `orden` → nombre dentro de cada sección; `imagenUrl` del ítem siempre `null`; `categoria` del agrupado = nombre de su sección.
- **M3:** `menu-consulta.ts`/`admin-consulta.ts` — leer `seccionCartaId` directo en vez de la cadena categoría→puente→sección.
- **M4:** `src/server/actions/carta/secciones.ts` — borrar `asignarCategoriaASeccionCarta`. `src/server/actions/carta/contenido-producto.ts` (o donde esté `guardarContenidoCartaProducto`) — sumar `seccionCartaId`, validarla si `visibleEnCarta`, sacar `imagenUrl`. `src/server/actions/carta/items-agrupados.ts` — `guardarItemAgrupadoCarta` cambia `categoriaId`→`seccionCartaId`, sin validar contra ninguna categoría; sacar `imagenUrl`. Sacar el aviso de D4 del plan de agrupación (la categoría de la opción cae en otra sección) — ya no aplica, no hay categoría de por medio.
- **M5:** `reporte-secciones.ts` — reescribir `generarReporteVentasPorSeccion` para agrupar por la sección real de cada producto (`ContenidoCartaProducto.seccionCartaId` / sección del ítem agrupado si es una opción), no por categoría.
- **M6:** pantallas `/catalogo/carta` (sacar bloque de categorías-por-sección, sumar select de sección + sacar imagen en `ContenidoProducto`) y `/catalogo/carta/agrupados` (select de sección en vez de categoría, sacar imagen).
- **M7:** reescribir los ~18 archivos de test que hoy referencian `categoriaSeccionCarta`/la ubicación por categoría, con los mismos casos pero contra el modelo nuevo.

## D. Verificación end-to-end obligatoria

Misma tabla que los planes anteriores de este proyecto: línea de base antes de empezar, `npx tsc --noEmit`, `npm run lint`, `npm test` (suite entera, Postgres real, conteo ≥ línea de base), `npm run build` (migración solo contra base local), `npm run test:e2e` (suite entera, conteo ≥ línea de base). Cierre: todos en verde en la misma corrida, después del último commit. Mirar con atención especial los specs de reportes por sección y accesibilidad de las dos pantallas tocadas.
