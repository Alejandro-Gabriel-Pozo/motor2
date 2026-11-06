# Inventario del módulo CATÁLOGO Y OPCIONES (2026-11-06)

**Estado:** inventario de SOLO LECTURA sobre `main` (`50c1153`); no se tocó código, tests ni migraciones. Pasos P1..Pn = PROPUESTA (el dueño no nombró los flujos de este módulo: PENDIENTE). Lo no comprobado va como NO VERIFICADO. Alimenta el catálogo común de `session_01FWp2khZQzz6smR9NEeR2ww`. Diseño de partida: `origin/alegp/diseno-flujos-y-pasos:docs/diseno-flujos-y-pasos-2026-11-06.md`.

Clase del guardián = lo declarado en `test/arquitectura/guardas/columnas-de-significado.ts` (G) o en la línea de base `cercos/linea-de-base/columnas-de-significado.json` (D = deuda sin declarar). Modelos en alcance del guardián de este módulo: Producto, DisponibilidadProducto, PrecioLocalProducto, DescuentoProductoSucursal (dinero), GrupoDeOpciones, OpcionDeGrupo, VersionDeOpcion, ProductoAdmiteGrupo, ProductoAdmiteOpcion, PrecioLocalDeOpcion, OpcionApagadaEnSucursal, ConsumoDeOpcion (stock), Unidad e Insumo (stock). **Fuera de alcance** (sin guardián): Grupo, CategoriaProducto, Presentacion (`columnas-de-significado.ts:31`).

## 1. FLUJOS (PROPUESTA)

| Flujo | Finalidad | Pasos (columnas) | Para qué sirve el paso |
|---|---|---|---|
| F1 Producto de catálogo | Que exista algo que se compra, se produce o se vende | P1 Existe: `Producto.codigo, nombre, tipo, unidadStockId, factorConversion`. P2 Se compra: `unidadCompraId, insumoId, categoriaId, observaciones`, `Presentacion.*`, `alicuotaIvaCompra`. P3 Se produce: `seProduce` (+ receta, fuera de módulo). P4 Consignación: `esConsignacion, proveedorConsignacionId, precioConsignacion` | Poder moverlo en stock y comprarlo |
| F2 Producto vendible | Que se pueda cobrar en una sucursal | V1 Precio: `precioVenta, alicuotaIvaVenta, pasoVenta, modoDeVenta`. V2 Precio local: `PrecioLocalProducto.precio/habilitado`. V3 Disponible: `DisponibilidadProducto.disponible`. V4 Descuento: `DescuentoProductoSucursal.porcentaje`. (V5 carta: otro módulo) | Cobrar al precio correcto y que aparezca en la sucursal |
| F3 Opciones de venta | Vender un producto configurable (tamaño, variante, incluida, adicional) con precio y consumo correctos | O1 Grupo: `GrupoDeOpciones.nombre, tipo, cantidadMinima/Maxima, prefijoEnCarta`. O2 Opción: `OpcionDeGrupo.nombre, orden, esNinguna, productoId, descripcionEnCarta` + `VersionDeOpcion.*` + `ConsumoDeOpcion.*`. O3 Admisión en el producto: `ProductoAdmiteGrupo.*`, `ProductoAdmiteOpcion.*`. O4 Sucursal: `PrecioLocalDeOpcion.*`, `OpcionApagadaEnSucursal.apagada`. Lo cobrado (`OpcionElegidaEnLinea`) es de Ventas | Que el POS ofrezca, cobre y descuente stock lo elegido |
| F4 Insumos y unidades | Agrupar productos que son «lo mismo» para stock y compras | `Unidad.nombre/magnitud/decimales/activa`; `Insumo.nombre/grupoId/activo`; `Grupo.nombre/grupoPadreId/activo` | Comparar precios y stock entre productos equivalentes |

Receta (`RecetaVersion`, `RecetaSucursal`, `RendimientoLocalIngrediente`) y proveedor (`Proveedor`, `ProveedorPorProducto`) viven en estas carpetas pero **no** están en el alcance pedido: ver §8.

## 2. COLUMNAS

Escritor = archivo de persistencia/caso de uso; lectores = muestra (no exhaustivo, salvo donde dice «único»). `—` = no encontrado.

| modelo.columna | flujo/paso | para qué | escritor | lectores | clase | observación |
|---|---|---|---|---|---|---|
| Producto.codigo/nombre | F1·P1 | clave y nombre | `persistencia/catalogo/productos.ts:53,62` | 155/621 archivos | ninguna (clave) | — |
| Producto.tipo | F1·P1 | MP/PV: decide elegibilidad | `productos.ts:53` (inmutable) | 320 archivos | **D** (enum sin declarar) | decide receta y venta |
| Producto.precioVenta | F2·V1 | precio de lista con IVA | `productos.ts:62,70` | 51 archivos | fuera (Decimal; lo cubre escrituras-auditadas) | **doble sentido**: con `modoDeVenta=BASE_CONFIGURABLE` «se conserva pero no se cobra» (`schema.prisma:~380`) |
| Producto.modoDeVenta | F2·V1 | DIRECTO/BASE | `actualizar-producto.ts:229` | 45 archivos | G dinero | — |
| Producto.alicuotaIvaVenta | F2·V1 | IVA de venta | **sin escritor** en `src/` (grep: solo lectores `lecturas/carta/componentes-de-promo.ts:62`, `core/fiscal/*`, `core/pos/alicuotas-de-combo.ts`) | 5 archivos | G dinero | **sin escritor**: queda siempre NULL; V1 nunca se completa |
| Producto.alicuotaIvaCompra | F1·P2 | IVA de compra | **sin escritor** | solo un comentario en `core/fiscal/iva.ts:5` | **ciega** (no está en G ni en D; NO VERIFICADO por qué el detector no la ve) | **colgada**: sin escritor ni lector |
| Producto.pasoVenta | F2·V1 | venta fraccionada | `actualizar-producto.ts` (valida `core/catalogo/venta-fraccionada.ts`) | 22 archivos | ciega (Decimal) | — |
| Producto.seProduce | F1·P3 | elegibilidad de receta | `actualizar-producto.ts` | 55 archivos | G stock | — |
| Producto.unidadStockId/factorConversion/unidadCompraId | F1·P1/P2 | conversión compra→stock | `productos.ts:53,62`; `Presentacion` alternativas | 41/19/28 archivos | ciega (FK/Decimal) | **dos fuentes** de «cómo se compra»: columnas del producto + `Presentacion` + `ProveedorPorProducto.unidadCompraId` (§4) |
| Producto.esConsignacion | F1·P4 | deuda con consignante | `actualizar-producto.ts` | 21 archivos | G dinero | — |
| Producto.proveedorConsignacionId / precioConsignacion | F1·P4 | a quién y cuánto | `actualizar-producto.ts` | 16/14 archivos | ciega | solo tiene sentido con `esConsignacion` (NO VERIFICADO que haya CHECK) |
| Producto.insumoId | F1·P2 | agrupar en Insumo | `productos.ts:90`, `insumos.ts:52` (fusión) | 33 archivos | ciega (FK) | solo MP (validación en aplicación, no en base) |
| Producto.categoriaId, observaciones | F1·P2 | rubro; nota libre | `productos.ts:62` | 21 / 16 archivos | ciega | `observaciones`: único lector ficha `productos/[id]/page.tsx:171` |
| DisponibilidadProducto.disponible | F2·V3 | ofrecer en sucursal (fila ausente = no) | `productos.ts:83,130`; `persistencia/auth/sucursales.ts:36` | `lecturas/catalogo/disponibilidad.ts` | G visibilidad | **3 escritores** en 2 módulos; fila `false` ≡ sin fila (a propósito) |
| PrecioLocalProducto.precio/habilitado | F2·V2 | precio por sucursal | `persistencia/catalogo/precio-local.ts:37` (único) | `lecturas/catalogo/precio-local.ts:43` (+ test de único lugar) | G dinero (`habilitado`); precio fuera (Decimal) | dos condiciones: capacidad `precio_local` de la sucursal **y** fila habilitada |
| DescuentoProductoSucursal.porcentaje | F2·V4 | descuento por sucursal | `persistencia/carta/descuento-producto.ts:22` (**módulo Carta**) | `lecturas/carta/descuentos.ts`, `lecturas/pos/selector-carta.ts:118` | fuera (Decimal) | modelo del catálogo, **escrito por Carta** (§8) |
| GrupoDeOpciones.nombre/cantidadMinima/Maxima/activo/version | F3·O1 | definir el grupo | `persistencia/catalogo/opciones-de-venta.ts:28,39,51` | `lecturas/catalogo/opciones-de-venta.ts` | G visibilidad (`activo`); `version` ninguna | — |
| GrupoDeOpciones.tipo | F3·O1 | MEDIDA/VARIANTE/INCLUIDA/ADICIONAL | idem :28 (inmutable) | validar-configuracion, componer-precio | **D** | decide precio y stock y está sin declarar |
| GrupoDeOpciones.prefijoEnCarta | F3·O1 | «De» → «De carne» | `editar-grupo-de-opciones.ts` | solo la carta (`core/opciones/lectura-en-carta.ts`) | **D** | cosmético, igual hay que declararlo |
| OpcionDeGrupo.nombre/orden/activa/version | F3·O2 | opción | `opciones-de-venta.ts:64,87,103` | muchos | G visibilidad (`activa`) | — |
| OpcionDeGrupo.esNinguna | F3·O2 | opción «Ninguna» | `:64` (inmutable) | `validar-opciones-elegidas.ts` | **D** | cambia qué se cobra/descuenta |
| OpcionDeGrupo.productoId | F3·O2 | ancla del ADICIONAL | `:64` + `crearProductoAnclaDeAdicional` (`productos.ts:144`) | — NO VERIFICADO | ciega (FK) | crea un `Producto` oculto por cada ADICIONAL |
| OpcionDeGrupo.descripcionEnCarta | F3·O2 | texto de carta | `editar-opcion-de-grupo.ts` | solo carta (test `descripcion-de-opcion-solo-en-la-carta`) | G visibilidad | — |
| VersionDeOpcion.tipoDeDiferencia/diferenciaPrecio/porcentaje/factorEscala | F3·O2 | precio y escala | `opciones-de-venta.ts:119` (solo INSERT) | `core/opciones/version-vigente.ts`, 5 lectores (§3) | G dinero (`tipoDeDiferencia`) | derivada «vigente = número mayor», sin flag |
| VersionDeOpcion.numero | F3·O2 | orden de versiones | idem | idem | **D** | cuál rige = la mayor; sin declarar |
| ConsumoDeOpcion.efecto/escalaConLaMedida | F3·O2 | qué descuenta | `opciones-de-venta.ts:133` | `core/movimientos/plan-de-la-venta.ts` NO VERIFICADO | G stock | — |
| ProductoAdmiteGrupo.activo/seMuestraEnCarta/modoPrecio/version | F3·O3 | qué grupos admite | `opciones-de-venta.ts:170,175` | `lecturas/catalogo/opciones-de-venta.ts:152` | G (vis./vis./dinero/ninguna) | `seMuestraEnCarta` es DECISIÓN; la carta la respeta solo si el grupo no cambia precio (`seOcultaEnLaCarta`): **doble sentido** |
| ProductoAdmiteOpcion.activo/tipoDeDiferencia/precioAbsoluto | F3·O3 | precio de lista de la opción en el producto | `opciones-de-venta.ts:184,193` | idem | G | `precioAbsoluto` Decimal fuera |
| ProductoAdmiteOpcion.cantidadMaxima | F3·O3 | unidades por venta | idem | — NO VERIFICADO | **D** | — |
| PrecioLocalDeOpcion.precio/habilitado | F3·O4 | grilla por sucursal | `persistencia/catalogo/opciones-por-sucursal.ts:29` | `lecturas/catalogo/precio-local-de-opciones.ts` | G dinero | **tercera** capa de precio (§4) |
| OpcionApagadaEnSucursal.apagada | F3·O4 | se acabó hoy | `opciones-por-sucursal.ts:17` | `validarOpcionesElegidas` | G visibilidad | — |
| Unidad.nombre/decimales | F4 | catálogo cerrado | `persistencia/catalogo/unidades.ts:19,32` | ubicuo | ninguna/ciega | `decimales` baja revalida productos (`actualizar-decimales-unidad.ts`) |
| Unidad.magnitud / Unidad.activa | F4 | default de decimales / habilitar | `unidades.ts:19,26` | — | **D** (ambas, tabla de stock) | `magnitud` «solo organizativo» según schema: sin lector que decida (NO VERIFICADO) |
| Insumo.nombre/grupoId; Insumo.activo | F4 | agrupar | `persistencia/catalogo/insumos.ts:15,41,47` | — | **D** (`activo`) | — |
| Presentacion.* ; Grupo.*; CategoriaProducto.* | F1/F4 | diccionarios | `productos.ts:102,116`; `grupos.ts`; `categorias-producto.ts` | — | **fuera** (diccionarios) | `activa/activo` sin guardián |

## 3. FUNCIONES Y PRIMITIVAS

| Nombre | Archivo | Qué hace | Copias/variantes | ¿Fuente única declarada? |
|---|---|---|---|---|
| `precioDeCarta(precioVenta, local)` | `core/carta/armar-menu.ts:294` | local habilitado ? local : global | Misma expresión escrita a mano: `consultas/carta/vista-previa-de-un-producto.ts:30`, `consultas/catalogo/opciones-de-venta.ts:143,299` (`?? precioVenta`), `core/reportes/comun.ts:103`, y `resolverPrecioVenta` (`lecturas/movimientos/precio-venta.ts:15`) | Parcial: `precio-local-en-un-solo-lugar.test.ts` fija **quién lee la tabla**, no la regla de fallback |
| `preciosLocalesVigentes` / `filtrarPreciosLocalesVigentes` | `lecturas/catalogo/precio-local.ts:43` / `core/catalogo/precio-local.ts` | capacidad + fila habilitada | — | Sí (test) |
| `resolverDisponibilidad` / `whereDisponibleEn` | `core/catalogo/disponibilidad-producto.ts:27` / `…-consulta.ts` | fila ausente = no | dos formas (valor y `where`) | Sí (`disponibilidad-en-un-solo-lugar.test.ts`) |
| `nombreDeCarta` | `core/carta/armar-menu.ts:289` | nombre en carta o interno | 4 copias según diseño de partida (en otros módulos) | No |
| `versionVigente` | `core/opciones/version-vigente.ts` | versión de número mayor | SQL `DISTINCT ON … numero DESC` en `lecturas/opciones/opciones-para-vender.ts`, `lecturas/carta/opciones.ts` (NO VERIFICADO su forma) | Sí: `lectores-de-version-de-opcion.test.ts` |
| `componerPrecioDeLinea` | `core/opciones/componer-precio-de-linea.ts:210` | precio de la línea configurada | `leerPrecioDeOpcion` (:87) y `leerPrecioDeFilaDeAdmision` lo reutilizan (no copian) | Sí (declarado en el docstring) |
| `esFactorValido` / `redondeo` `Math.round(x*10^n)/10^n` | `validar-configuracion.ts:70,85`; `venta-fraccionada.ts:35,94`; `cambio-de-precio.ts:22` | redondeos propios | 3 redondeos sueltos en el módulo | No (primitiva de redondeo sin declarar) |
| Normalizador de nombre | `core/catalogo/no-comestibles.ts:22` (`normalize("NFD")`) | sacar acentos | variantes en otros módulos (NO VERIFICADO) | No |
| `core/precios/sincronizacion.ts` | 91 líneas | sincronizar precio entre sucursales | **código sin usar en producción**: solo lo importa `test/core/precios-sincronizacion.test.ts`; su docstring dice que `GrupoSincroPrecio*` y `PrecioLocalProducto.sincronizado` «TODAVÍA NO EXISTEN» en el esquema | — |
| `creariaCiclo` | `lecturas/catalogo/grupos.ts:16` | evita ciclos en `Grupo` | el schema dice que vive en `src/core/catalogo/grupo.ts` (no existe; hoy `cadena-de-grupos.ts`) | Sí, pero doc desactualizada |

## 4. FUENTES DE VERDAD

| Hecho | Lugares | Quién manda | Intencional/accidental |
|---|---|---|---|
| Precio que se cobra un producto | `Producto.precioVenta` → `PrecioLocalProducto` (si capacidad) → `DescuentoProductoSucursal` → opciones (`ProductoAdmiteOpcion.precioAbsoluto` → `PrecioLocalDeOpcion` → `VersionDeOpcion`) | `componerPrecioDeLinea` + `preciosLocalesVigentes` | Intencional (capas), pero el fallback global/local está **copiado 5 veces** (accidental) |
| Precio de una BASE_CONFIGURABLE | `precioVenta` (conservado, bloqueado) y precio por opción | opciones | Accidental: dos números vivos, uno muerto |
| Cómo se compra un producto | `Producto.unidadCompraId+factorConversion`, `Presentacion`, `ProveedorPorProducto.unidadCompraId` | NO VERIFICADO | Probable accidental |
| Si un producto está disponible | `DisponibilidadProducto` (fila ausente=no, `false`=no) | `resolverDisponibilidad` | Intencional (rastro de auditoría) |
| Si una opción se ofrece | `GrupoDeOpciones.activo`, `ProductoAdmiteGrupo.activo`, `OpcionDeGrupo.activa`, `ProductoAdmiteOpcion.activo`, `OpcionApagadaEnSucursal.apagada`, `PrecioLocalDeOpcion.habilitado`; `ProductoAdmiteGrupo.seMuestraEnCarta` (solo carta) | `validarOpcionesElegidas` al vender; lectores de carta/POS re-derivan (4 lectores: `lecturas/opciones/opciones-para-vender.ts`, `lecturas/carta/opciones.ts`, `consultas/catalogo/opciones-de-venta.ts`, core) | 6 interruptores de niveles distintos (empresa/producto/sucursal): intencional; el cruce entre lectores NO VERIFICADO |
| Rol del grupo (qué muestra la carta) | `GrupoDeOpciones.tipo` + cantidades + `modoPrecio` + `seMuestraEnCarta` | `rolDelGrupo` (`lectura-en-carta.ts:59`) | Intencional |
| Vigencia de una opción | solo `VersionDeOpcion.numero` | derivada | Intencional (historia que solo agrega) |
| Qué grupos admite un producto | `ProductoAdmiteGrupo` y, redundante, `ProductoAdmiteOpcion` por opción | admisión de grupo | Accidental NO VERIFICADO |
| Qué es «activo» de un Producto | no hay `Producto.activo` (retirado); salida = `DisponibilidadProducto` en todas | `estaDisponibleEnAlguna` | Intencional |
| Descuentos de producto | `DescuentoProductoSucursal` (modelo catálogo, escrito por Carta) | Carta | Cruce (§8) |

## 5. ESCRITURAS

| Caso de uso | Qué escribe | ¿De más? | Intencional |
|---|---|---|---|
| `dar-de-alta-producto` / `…-rapido` | `Producto` + `DisponibilidadProducto` (todas o la del alta) | No: siembra a propósito (fila ausente=no) | Intencional; **sin auditoría** (`@sideEffects Ninguno`, excepciones declaradas) |
| `crear-opcion-de-grupo` (ADICIONAL) | `OpcionDeGrupo` + `Producto` ancla (`productos.ts:144`) + versión + consumos | El ancla es un producto real sin disponibilidad (oculto) | Intencional (ADR GO-1) |
| `actualizar-producto` | `Producto` + 1 fila de auditoría **por campo** (`precioVenta, precioConsignacion, pasoVenta, modoDeVenta, factorConversion, unidadStockId, …`) | No | Intencional (trazabilidad) |
| `guardar-precio-local-en-tx` | `PrecioLocalProducto` upsert + 2 auditorías (`precio`, `habilitado`) | Escribe la auditoría de `habilitado` aunque no cambie (NO VERIFICADO) | Probable accidental |
| `sincronizar-precio-grupo-carta` / `sincronizar-precio-local-grupo-carta` | `Producto.precioVenta` / `PrecioLocalProducto` de N productos hermanos | Dos casos de uso casi gemelos (global y local) | Intencional (dos ejes), código parecido |
| `agregar-version-de-opcion` | `VersionDeOpcion` + `ConsumoDeOpcion*` (solo INSERT) | Una versión nueva aunque no cambie el contenido: `contenidoDeVersionIgual` (`validar-configuracion.ts:229`) lo evita | Intencional |
| `fijar-admision-de-grupo-en-producto` / `vincular-grupo-en-producto` | `ProductoAdmiteGrupo` + `ProductoAdmiteOpcion` | NO VERIFICADO | — |
| `fijar-disponibilidad-de-hoy` | `DisponibilidadProducto` por lote, orden por id | No (idempotente por estado) | Intencional |
| `crear-sucursal` (módulo Auth) | `DisponibilidadProducto.createMany` con los productos «universales» | Escritura de otro módulo sobre tabla del catálogo | Intencional, cruce (§8) |

## 6. INVARIANTES

| Regla | Documento | Test |
|---|---|---|
| Fila ausente = no disponible; una sola definición | `core/catalogo/disponibilidad-producto.ts:1-14`, `plan-disponibilidad-por-sucursal-2026-09-23.md` | `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts`, `test/catalogo/disponibilidad-producto*.test.ts` |
| Un solo lector de `PrecioLocalProducto` y de la capacidad | `precio-local-en-un-solo-lugar.test.ts:7-24` | ese test |
| Escritores de precio con valor visto | ADR ola «precio y carta» | `test/arquitectura/cerco-escritores-de-precio-con-visto.test.ts` |
| Versión de opción: solo se agrega; vigente = número mayor | schema `VersionDeOpcion` | `lectores-de-version-de-opcion.test.ts`, `test/catalogo/opciones-versiones*.test.ts` |
| Base configurable: precio por opción, `precioVenta` bloqueado | ADR-035 | `test/catalogo/base-configurable-invariante.test.ts`, `modo-de-venta*.test.ts` |
| Venta exige opciones obligatorias | `diseno-ventas-con-opciones-2026-10-29.md` | `venta-exige-opciones-obligatorias.test.ts`, `test/opciones/opciones-para-vender.test.ts` |
| Descripción de opción solo en la carta | `diseno-descripcion-de-opciones-y-carta-b-2026-11-04.md` | `descripcion-de-opcion-solo-en-la-carta.test.ts` |
| Concurrencia de grupos, admisión, versiones, archivo, sucursal | control optimista `version` | `test/catalogo/opciones-*-concurrencia.test.ts` (5 archivos) |
| Auditoría atómica de precio y opciones | A3/M10 | `precio-auditoria-atomica.test.ts`, `opciones-auditoria-atomica.test.ts`, `catalogo-auditoria-atomica.test.ts` |
| Venta fraccionada: el paso no amplía precisión de stock | `plan-venta-fraccionada-2026-09-26.md` | `test/catalogo/venta-fraccionada.test.ts` |
| Columnas de significado declaradas | AGENTS.md «Combinaciones» | `cerco-columnas-de-significado.test.ts` |
| Combinaciones de precio×modo×capacidad×disponibilidad (oráculo escrito aparte) | `mapa-cobertura-de-combinaciones-2026-10-28.md` | NO VERIFICADO que haya un test que recorra todas |
| `alicuotaIvaVenta` se declara en el alta de un PV | schema comentario «Etapa C» | **sin test** (y sin escritor) |
| CHECK de enteros/Decimal de opciones (cantidades 0..10, factor ≤ 10, etc.) | schema | Solo vive en migraciones; test de paridad tipos↔CHECK mencionado en el schema (NO VERIFICADO dónde) |
| Evitar ciclos en `Grupo` | schema | `test/catalogo/cadenas-de-grupos-consultas.test.ts` (NO VERIFICADO que cubra el ciclo) |

## 7. DEUDA

| Ítem | ¿Vencimiento? | Dónde |
|---|---|---|
| 9 columnas del módulo sin declarar: `Producto.tipo, Unidad.activa, Unidad.magnitud, Insumo.activo, GrupoDeOpciones.tipo, GrupoDeOpciones.prefijoEnCarta, OpcionDeGrupo.esNinguna, ProductoAdmiteOpcion.cantidadMaxima, VersionDeOpcion.numero` | No (meta «bajar a 0», sin fecha) | `cercos/linea-de-base/columnas-de-significado.json` (82 en total) |
| `fijar-disponibilidad-de-hoy.ts` sin cubrir por guardianes | No | `cercos/linea-de-base/casos-de-uso-en-guardianes.json` |
| Controles a mano: `opciones/[grupoId]/campos-de-version.tsx`, `editor-de-consumos.tsx`, `recetas/[productoId]/page.tsx`, `receta-de-la-sucursal.tsx` | «bajar hacia 0 en la Fase 6» (sin fecha) | `controles-a-mano.json` |
| `inputmode` a mano: `margen-objetivo/page.tsx`, `opciones/[grupoId]/page.tsx`, `opciones/alta-de-grupo.tsx`, `productos/[id]/opciones/admision-de-grupo.tsx` | «lote 6.33» (sin fecha) | `inputmode-numerico-a-mano.json` |
| `unidades/page.tsx` con `type=number` | «lote 6.33» | `campo-type-number.json` |
| Columna `ProductoAdmiteGrupo.ejeDeCombinacion` retirada del modelo pero viva en la base «hasta la migración de retiro» | No | schema `~3715`; `migrations/20261021110000_go3a_combinaciones` |
| `core/precios/sincronizacion.ts` (código huérfano) | No | §3 |
| Comentarios del schema desactualizados: «Nada de `src/` la escribe todavía» en `GrupoDeOpciones`, `ProductoAdmiteGrupo`, `ProductoAdmiteOpcion`, `PrecioLocalDeOpcion`, `OpcionApagadaEnSucursal` (hoy sí hay escritores) y `src/core/catalogo/grupo.ts` | No | `prisma/schema.prisma` |
| `Producto.alicuotaIvaVenta/Compra` sin escritor | No | §2 |

## 8. INTERFACES con otros módulos (no inventariadas)

- **Carta**: escribe `DescuentoProductoSucursal` (`persistencia/carta/descuento-producto.ts`); lee `precioVenta`, `PrecioLocalProducto`, opciones y `ProductoAdmiteGrupo.seMuestraEnCarta`; `ContenidoCartaProducto.nombreEnCarta` decide el nombre visible.
- **Ventas / POS**: lee precio, descuentos, opciones y consumos; escribe la foto `OpcionElegidaEnLinea` (`plan-de-la-venta`, `registrar-venta`).
- **Stock / Movimientos**: lee `Producto.unidadStockId/factorConversion/seProduce`, `ConsumoDeOpcion`; `Unidad` e `Insumo` están clasificados como «stock».
- **Compras y proveedores**: `ProveedorPorProducto`, `Proveedor`, `registrar-vinculo-de-compra-en-tx`, `ofertas-de-proveedor`, comparativa de precios (`core/catalogo/comparativa-de-precios.ts`).
- **Recetas**: `RecetaVersion/RecetaSucursal/RendimientoLocalIngrediente` viven en `actions/catalogo/recetas*.ts` pero son de otro inventario.
- **Auth/Sucursales**: `persistencia/auth/sucursales.ts:36` escribe `DisponibilidadProducto`.
- **Reportes**: `core/reportes/comun.ts:103` re-implementa el fallback de precio; `margen-objetivo` (`CategoriaProducto`, `MargenObjetivo`).

## 9. NO VERIFICADO

- Si `Producto.alicuotaIvaCompra` queda fuera del guardián por el lector del esquema o por otra razón.
- Lectores reales de `Unidad.magnitud`, `OpcionDeGrupo.productoId`, `ProductoAdmiteOpcion.cantidadMaxima`, `ProductoAdmiteGrupo.orden/cantidadMinima`.
- Si los 4 lectores de «opción ofrecida» comparten criterio (activa ∧ admitida ∧ no apagada ∧ grupo activo).
- Si hay un test que recorra la matriz precio×capacidad×modo×disponibilidad contra un oráculo escrito aparte.
- Si `guardarPrecioLocalEnTx` audita `habilitado` cuando no cambió.
- Lectores por SQL crudo (solo se buscó `prisma.*`, `INSERT/UPDATE "Tabla"`: 0 SQL crudo escritor en `src/` para estas tablas).
- Conteos de uso por archivo (`grep -w` sobre `src/`): sobrecuentan nombres genéricos (`nombre`, `tipo`, `codigo`).
- Que el CHECK `Producto_alicuotaIvaVenta_check` impida valores fuera de lista (migración no abierta).
- Que `knip` tolere `core/precios/sincronizacion.ts` por estar importado solo desde un test (no se corrió el gate).
