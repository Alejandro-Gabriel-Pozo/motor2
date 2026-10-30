# ADR-035: Modo de venta del producto, «se lee en la carta como» y la carta pareja

> Redactado el 2026-10-20 (rama `alegp/stoic-davinci-185dm4`, Fase 4 de la ola «precio y carta», sobre el retiro de GO-3a de la Fase 3). **Estado: aceptado por el dueño (decisiones cerradas DEC-18 y DEC-34 y las de la Fase 4 del 2026-10-19); implementado en el código. Las dos migraciones son aditivas y REQUIEREN AUTORIZACIÓN EXPRESA para aplicarse en una base real.**

## Contexto

Hasta acá un producto con opciones guardaba SIEMPRE un precio propio (`Producto.precioVenta`), aunque se vendiera por tamaño con el precio final de cada tamaño cargado aparte («Pizzas» 18.000 con «Tipos de Pizza» en precio propio). Ese valor guardado no se cobraba (la medida en ABSOLUTO lo reemplaza), pero seguía decidiendo cosas: el resumen de precios componía cada opción sola sobre él (con 0, una variante sin costo desaparecía y el producto dejaba de venderse), los porcentajes de una variante se calculaban sobre él, y «quitar» el grupo de precio dejaba el producto vendiéndose suelto a ese valor. La carta, además, no tenía un dato declarado para leer una opción con su preposición («De carne», «De pollo»): lo deducía o no lo decía.

## Decisión

1. **`Producto.modoDeVenta`**, TEXT de lista cerrada (`MODOS_DE_VENTA` en `src/core/opciones/tipos.ts`, migración `prisma/migrations/20261021130000_producto_modo_de_venta/migration.sql`): `DIRECTO` (default, lo de siempre) o `BASE_CONFIGURABLE` («se vende por opción»). El CHECK de la base repite que solo un PV que no se produce puede ser base.
2. **Una base conserva su precio guardado pero no lo usa ni lo deja editar.** La regla pura vive en `src/core/opciones/modo-de-venta.ts` (`rechazoDeBaseConfigurable`): PV, no se produce, no es de consignación (decisión del dueño), no respalda un adicional, no está en un ítem agrupado de la carta, tiene al menos un grupo de medida activo en ABSOLUTO con el precio final de cada opción ofrecida (es el único camino al precio final desde que no hay eje de combinación) y no tiene diferencias en porcentaje. El mensaje base es «Falta el precio final de cada opción: …».
3. **Quién cambia el modo:** quien tiene `producto_campos_sensibles` además de `producto_editar` (opción A del dueño, sin clave nueva). Lo aplica la edición del producto (`src/server/actions/catalogo/casos-de-uso/actualizar-producto.ts`): pasar a base toma primero la fila del producto (`tomarFilaDeProducto`, `FOR UPDATE`) y valida la regla con lo leído en la misma transacción (`BASE_INVALIDA`); siendo base, otro precio se rechaza (`PRECIO_BLOQUEADO_EN_BASE`) y lo que no viene queda como estaba; volver a directo se puede siempre. Cada cambio deja su fila de auditoría (`Producto.modoDeVenta`).
4. **El precio de referencia de una base** es la medida en ABSOLUTO disponible más barata, con la grilla de la sucursal (`src/core/pos/precio-de-configuracion.ts`, `resumenDePrecios` con `esBase`). Lo usan solo la carta, el selector y las vistas previas para componer cada opción; la vista previa y el cobro no cambian (`test/pos/base-configurable-precio-de-referencia.test.ts`, propiedad con cualquier valor guardado). Sin referencia, la base no se vende: falla cerrado, nunca cae al guardado.
5. **`GrupoDeOpciones.prefijoEnCarta`** («se lee en la carta como», DEC-34; migración `prisma/migrations/20261021131000_grupo_prefijo_en_carta/migration.sql`): opcional, hasta 20 caracteres, sin espacios a los costados; solo la lee la carta (Fase 5): no entra al precio ni a la foto de la venta, y el POS y el ticket muestran grupo y opción tal cual. La tabla tiene UPDATE por columna, así que la migración da el suyo a `motor2_app`.

## Consecuencias

- Las ventas pasadas no se tocan (las fotos `CuentaItem` y `OpcionElegidaEnLinea` están congeladas) y marcar base un producto cuyo guardado repite la opción más barata no cambia ningún precio cobrado ni mostrado (`test/catalogo/modo-de-venta-cobro.test.ts`). Lo que sí cambia, por diseño (DEC-11), es la forma con que la carta lee una base (oculta, sin encabezado, en lista): el test fija que los precios y las opciones no cambian y que la forma es esa. La caracterización de precio y carta de la Fase 0 no se mueve.
- El margen de una base en el reporte de costos es «Por opción», sin margen. El ajuste masivo «Precios» de la carta está apagado (`PRECIOS_EDITABLES`) y no se tocó.
- Marcar Pizzas y Milanesas como base en producción se hace A MANO desde la pantalla del producto; los prefijos («De», «Con») y el renombre de esos grupos son un paso aparte del dueño.

## Carta pareja (Fase 5, 2026-10-20)

> Fase 5 de la ola «precio y carta». **Estado: implementado en el código (tanda A: pasos 1, 2, 5, 6, 7 y la columna M1; tanda B: pasos 3, 4, 8, 9, 10 y 12; tanda C: la jerarquía de la carta, aprobada por el dueño con maquetas y descrita en «Jerarquía de la carta (tanda C)»). Las capturas antes y después (paso 13) esperan la aprobación del dueño antes de fusionar; la aprobación se anota acá.** La columna `ContenidoCartaProducto.mostrarNombreArriba` (migración `prisma/migrations/20261021140000_contenido_carta_mostrar_nombre_arriba/migration.sql`) es aditiva y REQUIERE AUTORIZACIÓN EXPRESA para aplicarse en una base real.

### Contexto

La carta pública mostraba cada producto con opciones con piezas sueltas (CARTA-B y CARTA-C del ADR-030: la lista de tamaños, la línea «Adicionales:» y las pastillas) y con una letra distinta según tuviera opciones o no. Las pizzas salían con el encabezado «Pizzas» y una lista; la milanesa no podía decir «De carne / De pollo» con el precio de cada combinación; nada se imprimía bien (las listas con scroll se cortaban).

### Decisión

1. **Una sola proyección por producto, resuelta en el SERVIDOR** (`src/core/carta/presentacion-en-carta.ts`, con la tabla de precios de la regla de la venta: `tablaDePreciosParaLaCarta` en `src/core/pos/precio-de-configuracion.ts`). El papel de cada grupo y su orden son los mismos para la carta y el POS (`src/core/opciones/lectura-en-carta.ts`). Cuatro FORMAS, desde datos declarados (el modo, el papel del grupo, el prefijo y el interruptor; nunca comparando nombres):
   - **simple**: sin ejes (el bife): el nombre y su precio, con lo que se lee debajo;
   - **columnas**: un producto directo con un tamaño que define el precio (el café): un producto de una TANDA de productos consecutivos que comparten el mismo grupo (`grupoId`), con «–» donde un producto no ofrece un tamaño (en la sección de abajo: cada producto con SU tabla, ya no una sola tabla compartida);
   - **tabla**: dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo); una base de dos ejes sale SIEMPRE así (DEC-11); las filas no se juntan aunque cuesten igual (DEC-10);
   - **lista**: un eje en filas; una BASE de un eje sale OCULTA por defecto (cada opción como un plato: «Pizza muzzarella $18.000», DEC-11) y con el nombre arriba si su interruptor «Mostrar el nombre arriba» está prendido.
   Con más de 3 columnas, cae a lista. Lo que la carta no puede leer con el precio exacto (un tercer grupo que cambia el precio; un recargo dentro del precio con descuento de producto) no toma forma y queda en el diagnóstico interno.
2. **Lo que se lee DEBAJO del plato** (DEC-07; el dibujo de «una línea por grupo» fue reemplazado por la tanda C, que separa lo gratis de cada recargo): una línea por grupo, en el orden del producto: una elección sin costo («Guarnicion: ensalada, papas fritas o puré»; una variante sin costo y sin prefijo va acá) y lo que suma o resta («Extras: extra de papas +$2.000»; el recargo de un adicional nunca lleva el descuento de producto). Un solo texto para la carta y la vista previa (`src/core/carta/texto-de-la-carta.ts`).
3. **La carta pública solo crece** (`src/core/carta/carta-publica.ts`, campo por campo): `presentacion` por ítem, `tandas` por sección y `seccionesImpresas` (la carta completa del papel); la lista cerrada de claves la vigila `test/carta/salida-publica-inventariada.test.ts`. La versión de la forma va en la clave del caché («carta-pareja-2»; la tanda C la sube a «carta-pareja-3»).
4. **Dibujo por forma** (`src/components/carta-publica/seccion.tsx`): tablas reales (`<table>`, `<th scope="col">`, `<th scope="row">`; el nombre de una tabla es un `h3` ~~en la celda de la esquina~~ (reemplazado por la tanda C: un `h3` FUERA de la tabla, arriba, como rótulo), nunca dentro de un `th`), «–» con «no se ofrece» para el lector de pantalla, «−x %» una vez (sin tachar celda por celda), sin «desde». Se retiraron la lista de tamaños, las pastillas y la línea «Adicionales:» propias: lo que no tiene forma se dibuja con las mismas piezas (`test/carta/carta-publica-formas.test.tsx`).
5. **Escala de letra única** (DEC-35, `src/core/carta/escala.ts`): un ROL por texto con un solo tamaño y peso, el mismo para todo ítem: Producto 19 px, Opción 16 px, Aclaración 14 px, Etiqueta 12 px (los tags) y, desde la tanda C, cuatro roles más (rótulo, columna, tamaño y elección: ver la sección siguiente); el tema de la sucursal solo puede pedir más (`max(piso, tema)`), la Opción no tiene clave de tema. Ningún componente de la carta escribe un tamaño: la regla `carta-publica-tipografia` de `test/arquitectura/cerco-tipografia.test.ts` es dura (cero).
6. **Impresión** (DEC-20): la carta sale entera (se liberan las listas con scroll; un plato o una tabla no se parten; los rótulos se repiten), en puntos (12/11/10/9 pt y, desde la tanda C, 9,5/11/10,5/10,5 pt para los cuatro roles nuevos; sin el tema), COMPLETA (sin lo «agotado hoy»: si hoy hay algo agotado, el servidor arma aparte la carta como si nada lo estuviera) y con un pie «Precios vigentes al dd/mm/aaaa · <dirección pública>». **Sin QR** (decisión del dueño: la dirección va en texto; el paso 11 queda cerrado así) (`test/carta/impresion.test.tsx`).
7. **La vista previa «Va a mostrar» de «Agregar a la carta»** usa la misma forma (`test/carta/vista-previa-de-la-forma.test.ts`).

### Consecuencias

- El precio cobrado no cambia: cada celda sale de la misma regla que el cobro (la paridad la fija `test/pos/tabla-de-precios-para-la-carta.test.ts`) y el golden de cobro de la Fase 0 no se movió.
- Cambio visual en todas las cartas: los nombres sin opciones pasan de unos 14 a 19 px y las descripciones de 11 a 14 px (la de la banda de sección también, desde la tanda C). Por eso se aprueba con capturas.
- `grupos` y `opcionesSinCosto` se siguen emitiendo: los consume el dibujo de lo que no tiene forma (9b no se hizo).
- Límites: un plato ENTERO «sin stock hoy» no entra en el papel (la disponibilidad del producto no distingue «sin stock hoy» de «no se vende acá»); la base oculta pierde la descripción, los tags y la ★ del producto base (lo avisa el diagnóstico interno); la impresión solo se probó en Chromium.
- Aprobación de las capturas (paso 13): pendiente.

### Jerarquía de la carta (tanda C)

> Tanda C de la Fase 5 (commits C1 a C6, 2026-10-20/21), decidida por el dueño sobre maquetas. **Estado: implementado en el código.** Reemplaza, en lo que se opone, la tabla ÚNICA de la tanda con el nombre en su primera celda y la línea «Elegí/Extras» de una sola pieza que describían los pasos 1, 2 y 4 de arriba. No toca ningún dato ni migración, ni el precio cobrado.

#### La regla

Si la opción define QUÉ PLATO es (el tipo de carne de la milanesa, cada pizza) → las OPCIONES protagonizan (letra de plato) y el nombre «paraguas» (Milanesas, Pizzas) es un rótulo. Si la opción es solo CÓMO lo querés (el tamaño del café) → el NOMBRE protagoniza y los tamaños son chicos. Se decide por la forma, y por un único campo aditivo: `protagonista: "nombre"` en la forma `lista`, que solo pone `resolverTandas` (`presentacion-en-carta.ts`) cuando una tanda cae a lista por tener más de 3 tamaños. Sin el campo, protagonizan las opciones.

| Forma | Quién protagoniza |
|---|---|
| tabla (dos ejes) | las opciones (filas De carne / De pollo); el nombre es el rótulo |
| lista de una base con el nombre arriba (interruptor prendido) | las opciones; el nombre es el rótulo |
| lista de una base oculta (las pizzas) | las opciones; no hay nombre |
| lista de filas que definen el plato (un producto directo con filas) | las opciones; el nombre es el rótulo |
| lista de combinaciones (la tabla de más de 3 columnas, una fila por combinación) | las opciones; el nombre es el rótulo |
| lista por caída de tanda (más de 3 tamaños) | el nombre (`protagonista: "nombre"`); las filas son tamaños |
| columnas (la tanda) | el nombre; los tamaños son encabezados |
| simple (el bife) | el nombre |

#### Las tres formas de dibujo aprobadas

- **BC2** (las opciones protagonizan): el rótulo del nombre en sans de 13 px, peso 600, mayúsculas con espaciado, con una línea fina de ancho completo debajo (y, a la derecha, el «−x %» si hay descuento); las filas en serif de 19 px (rol Producto) con un separador fino (el borde de la carta) entre una y otra; los precios en 19 px (rol Precio); en la tabla de dos ejes, los encabezados de columna en 16 px, peso 600.
- **N** (el nombre protagoniza: la tanda y la lista por caída de tanda): el nombre en serif de 19 px (rol Producto) con una línea fina debajo; los encabezados de tamaño en 15 px, peso 600; los precios en 16 px (rol Opción precio). **UNA TABLA POR PRODUCTO**, con los encabezados repetidos bajo el nombre de cada uno (decisión del dueño; reemplaza la tabla única compartida con el nombre en la primera celda) y `table-fixed`: las columnas son iguales y comparten ancho en todos los productos de la tanda. La lista por caída de tanda dibuja el nombre con su línea fina y los tamaños debajo, en rol Opción, con puntitos.
- **P1** (lo que se lee debajo del plato, `GruposDeOpciones`): la etiqueta del grupo en 14 px, peso 600; lo gratis en UNA línea de 15 px (rol Elección), en texto neutro y sin verbo (C9): «ensalada · papas fritas · puré» (las opciones separadas por « · », sin prefijo) si todas las opciones del grupo son gratis, «Sin cargo: solo · cortado» o «Sin cargo: solo» si el grupo mezcla gratis y con recargo; cada recargo en SU fila (rol Opción, 16 px) con el precio a la derecha, siempre en pesos («+$200») aunque la regla sea en porcentaje. Lo que la carta no puede mostrar exacto (un recargo dentro del precio con descuento de producto) sale como antes, en una línea única («Adicionales: …», `ItemComoAntes`). La partición es `partirLaAclaracion` (`texto-de-la-carta.ts`), la misma de la vista previa de la administración.

#### La escala: cuatro roles nuevos

Pantalla y papel, en `src/core/carta/escala.ts` (variables `--carta-fs-<rol>` y `--carta-fs-<rol>-impresa`; clases `carta-rol-<rol>` en `src/app/globals.css`):

| Rol | Pantalla | Papel | Para qué |
|---|---|---|---|
| `rotulo` | 13 px, 600, mayúsculas, espaciado | 9,5 pt | el nombre paraguas (BC2) |
| `columna` | 16 px, 600 | 11 pt | encabezado de columna de la tabla de dos ejes |
| `tamano` | 15 px, 600 | 10,5 pt | encabezado de tamaño de la tanda (N) |
| `eleccion` | 15 px, 400 | 10,5 pt | la línea de lo gratis, «ensalada · papas fritas · puré» / «Sin cargo: …» (P1); toma `max(15 px, tema de la descripción)` |

Se suma la clase `carta-linea-fina` (un trazo de 1 px del color de la tinta, atenuado hacia el fondo, `color-mix` al 28 %), que usan el rótulo y el nombre protagonista. **Mínimo de 14 px** para todo texto que el cliente necesita para decidir; las únicas excepciones son el rótulo en mayúsculas de 13 px y los tags de 12 px. Por eso (C6) la descripción de la banda de sección sube de 11 a un piso de 14 px (`max(--carta-fs-aclaracion, tema)`: el tema solo puede pedir más). El cerco `carta-publica-tipografia` sigue en cero: los componentes usan las clases de los roles.

#### Datos, caché y pruebas

- **Aditivo**: `protagonista` es opcional en `PresentacionCartaV1` y en su proyección pública; la versión del caché pasa a **`carta-pareja-3`** (`VERSION_DE_LA_CARTA_EN_CACHE`), así un despliegue no sirve 60 s una carta guardada sin el campo.
- `precios.golden.txt` no cambia; `cobro-y-carta.golden.txt` cambia solo en la línea de `presentacion` de las Pizzas (suma `"protagonista":"nombre"`). Los dos son caracterizaciones congeladas: el precio cobrado no se mueve.
- La línea de base de navegador (`test/e2e/linea-de-base-precio-y-carta.spec.ts`) se regenera, porque el cambio visual es deliberado.

#### Qué decidió el dueño, y con qué evidencia

- La jerarquía BC2 y N, sobre maquetas en comparaciones lado a lado: A / B / C → BC2 (las opciones protagonistas con el nombre como rótulo); el café, A / N → N con P1.
- Las milanesas con los encabezados de columna en 16 px; el bife con P1 (la maqueta de la aclaración debajo del plato).
- El mínimo de 14 px para el texto de decisión.
- Repetir los encabezados de tamaño en cada producto de la tanda (una tabla por producto).
- Subir la descripción de la banda a 14 px (C6).
- «Elegí:» en los grupos opcionales gratis: se revisó en las capturas y se reemplazó (C9) por un texto neutro sin verbo.

#### Pendiente conocido

Resuelto en C9 (decisión del dueño): «Elegí: …» / «Incluidas: …» sugerían algo que la carta no sabe (obligatoriedad, cuántas se eligen, que vienen juntas), porque la carta pública no tiene un dato de obligatoriedad del grupo (no se emite). Ahora la línea es neutra, sin verbo: las opciones separadas por « · » si todas son gratis, o «Sin cargo: …» si el grupo mezcla. Si alguna vez hace falta decir «obligatorio» o «una sola», hace falta un dato público (no una deducción).


### Modelo unificado de la carta (2026-10-29)

> Decisión del dueño sobre maquetas (documento de diseño «Simplificar la presentación de la carta», 2026-10-29, secciones B y H). **Estado: implementado en el código.** Reemplaza, en lo que se opone, la jerarquía BC2 / N y las tandas de la tanda C de arriba. No toca ningún dato ni migración, ni el precio cobrado.

- **Un solo modelo de forma.** `PresentacionCartaV1` es `simple` (sin ejes: el nombre y su precio, con las aclaraciones debajo) o `tabla` (uno o dos ejes: `titulo`, `columnas`, `filas` con `rotulo` y `celdas`). Desaparecen `columnas`, `lista`, `encabezado`, `protagonista` y las tandas (`resolverTandas`, `TandaCartaV1`): cada producto muestra sus propios tamaños y repite sus encabezados, sin «–» compartida con el vecino.
- **Una sola jerarquía.** El nombre del producto es el título (rol Producto, con su línea fina); cada fila es una opción (rol Opción) y cada celda un precio (rol Opción precio). La única excepción es la base de un eje OCULTA (`titulo: false`), que sigue dibujando cada opción como un plato.
- **Más de 3 columnas se transpone**: el eje largo pasa a las filas y el otro, si hay, a las columnas; si los dos ejes tienen más de 3, una fila por combinación.
- **Ancho único de las columnas de precio** (`carta-col-precio`, `globals.css`): el mismo en toda la carta y alineadas a la derecha, así el Chico, el Mediano y el Grande de productos distintos quedan en la misma vertical. Un `<col>` no respeta un porcentaje en Chrome: se mide contra el contenedor (`clamp(4.5rem, 16cqw, 9rem)` con `container-type: inline-size` en el ítem).
- **Caché**: la versión pasa a **`carta-pareja-4`** (`VERSION_DE_LA_CARTA_EN_CACHE`) en el mismo commit que cambia la forma. `cobro-y-carta.golden.txt` y la línea de base de navegador cambian solo en las líneas de forma y de roles; `precios.golden.txt` y `huella-del-pos.golden.txt` no se mueven.
- **Regla de filas.** Una VARIANTE obligatoria de una sola elección es el eje de filas si tiene costo o prefijo (DEC-10) **o si el producto es DIRECTO y tiene un tamaño que define el precio** (la grilla Solo / Cortado / Lágrima × Chico / Mediano / Grande, sin un prefijo artificial); en una base, o sin tamaño, sigue siendo una aclaración. La decide `ejesDeLaCarta` y no `rolDelGrupo`, que usa el diálogo del POS para ordenar. Un producto con dos tamaños no se puede vender (`MEDIDAS_MULTIPLES`), así que no sale en la carta.
