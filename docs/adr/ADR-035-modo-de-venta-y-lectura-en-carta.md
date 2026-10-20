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

- Las ventas pasadas no se tocan (las fotos `CuentaItem` y `OpcionElegidaEnLinea` están congeladas) y marcar base un producto cuyo guardado repite la opción más barata no cambia ningún precio cobrado ni mostrado (`test/catalogo/modo-de-venta-cobro.test.ts`). La caracterización de precio y carta de la Fase 0 no se mueve.
- El margen de una base en el reporte de costos es «Por opción», sin margen. El ajuste masivo «Precios» de la carta está apagado (`PRECIOS_EDITABLES`) y no se tocó.
- Marcar Pizzas y Milanesas como base en producción se hace A MANO desde la pantalla del producto; los prefijos («De», «Con») y el renombre de esos grupos son un paso aparte del dueño.

## Carta pareja (Fase 5, 2026-10-20)

> Fase 5 de la ola «precio y carta». **Estado: implementado en el código (tanda A: pasos 1, 2, 5, 6, 7 y la columna M1; tanda B: pasos 3, 4, 8, 9, 10 y 12). Las capturas antes y después (paso 13) esperan la aprobación del dueño antes de fusionar; la aprobación se anota acá.** La columna `ContenidoCartaProducto.mostrarNombreArriba` (migración `prisma/migrations/20261021140000_contenido_carta_mostrar_nombre_arriba/migration.sql`) es aditiva y REQUIERE AUTORIZACIÓN EXPRESA para aplicarse en una base real.

### Contexto

La carta pública mostraba cada producto con opciones con piezas sueltas (CARTA-B y CARTA-C del ADR-030: la lista de tamaños, la línea «Adicionales:» y las pastillas) y con una letra distinta según tuviera opciones o no. Las pizzas salían con el encabezado «Pizzas» y una lista; la milanesa no podía decir «De carne / De pollo» con el precio de cada combinación; nada se imprimía bien (las listas con scroll se cortaban).

### Decisión

1. **Una sola proyección por producto, resuelta en el SERVIDOR** (`src/core/carta/presentacion-en-carta.ts`, con la tabla de precios de la regla de la venta: `tablaDePreciosParaLaCarta` en `src/core/pos/precio-de-configuracion.ts`). El papel de cada grupo y su orden son los mismos para la carta y el POS (`src/core/opciones/lectura-en-carta.ts`). Cuatro FORMAS, desde datos declarados (el modo, el papel del grupo, el prefijo y el interruptor; nunca comparando nombres):
   - **simple**: sin ejes (el bife): el nombre y su precio, con lo que se lee debajo;
   - **columnas**: un producto directo con un tamaño que define el precio (el café): una fila de una TANDA de productos consecutivos que comparten el mismo grupo (`grupoId`), con «–» donde un producto no ofrece un tamaño;
   - **tabla**: dos ejes (la milanesa: Simple | Napolitana × De carne / De pollo); una base de dos ejes sale SIEMPRE así (DEC-11); las filas no se juntan aunque cuesten igual (DEC-10);
   - **lista**: un eje en filas; una BASE de un eje sale OCULTA por defecto (cada opción como un plato: «Pizza muzzarella $18.000», DEC-11) y con el nombre arriba si su interruptor «Mostrar el nombre arriba» está prendido.
   Con más de 3 columnas, cae a lista. Lo que la carta no puede leer con el precio exacto (un tercer grupo que cambia el precio; un recargo dentro del precio con descuento de producto) no toma forma y queda en el diagnóstico interno.
2. **Lo que se lee DEBAJO del plato** (DEC-07): una línea por grupo, en el orden del producto: una elección sin costo («Guarnicion: ensalada, papas fritas o puré»; una variante sin costo y sin prefijo va acá) y lo que suma o resta («Extras: extra de papas +$2.000»; el recargo de un adicional nunca lleva el descuento de producto). Un solo texto para la carta y la vista previa (`src/core/carta/texto-de-la-carta.ts`).
3. **La carta pública solo crece** (`src/core/carta/carta-publica.ts`, campo por campo): `presentacion` por ítem, `tandas` por sección y `seccionesImpresas` (la carta completa del papel); la lista cerrada de claves la vigila `test/carta/salida-publica-inventariada.test.ts`. La versión de la forma va en la clave del caché («carta-pareja-2»).
4. **Dibujo por forma** (`src/components/carta-publica/seccion.tsx`): tablas reales (`<table>`, `<th scope="col">`, `<th scope="row">`; el nombre de una tabla es un `h3` en la celda de la esquina, nunca dentro de un `th`), «–» con «no se ofrece» para el lector de pantalla, «−x %» una vez (sin tachar celda por celda), sin «desde». Se retiraron la lista de tamaños, las pastillas y la línea «Adicionales:» propias: lo que no tiene forma se dibuja con las mismas piezas (`test/carta/carta-publica-formas.test.tsx`).
5. **Escala de letra única** (DEC-35, `src/core/carta/escala.ts`): un ROL por texto con un solo tamaño y peso, el mismo para todo ítem: Producto 19 px, Opción 16 px, Aclaración 14 px, Etiqueta 12 px (los tags); el tema de la sucursal solo puede pedir más (`max(piso, tema)`), la Opción no tiene clave de tema. Ningún componente de la carta escribe un tamaño: la regla `carta-publica-tipografia` de `test/arquitectura/cerco-tipografia.test.ts` es dura (cero).
6. **Impresión** (DEC-20): la carta sale entera (se liberan las listas con scroll; un plato o una tabla no se parten; los rótulos se repiten), en puntos (12/11/10/9 pt, sin el tema), COMPLETA (sin lo «agotado hoy»: si hoy hay algo agotado, el servidor arma aparte la carta como si nada lo estuviera) y con un pie «Precios vigentes al dd/mm/aaaa · <dirección pública>». **Sin QR** (decisión del dueño: la dirección va en texto; el paso 11 queda cerrado así) (`test/carta/impresion.test.tsx`).
7. **La vista previa «Va a mostrar» de «Agregar a la carta»** usa la misma forma (`test/carta/vista-previa-de-la-forma.test.ts`).

### Consecuencias

- El precio cobrado no cambia: cada celda sale de la misma regla que el cobro (la paridad la fija `test/pos/tabla-de-precios-para-la-carta.test.ts`) y el golden de cobro de la Fase 0 no se movió.
- Cambio visual en todas las cartas: los nombres sin opciones pasan de unos 14 a 19 px y las descripciones de 11 a 14 px. Por eso se aprueba con capturas.
- `grupos` y `opcionesSinCosto` se siguen emitiendo: los consume el dibujo de lo que no tiene forma (9b no se hizo).
- Límites: un plato ENTERO «sin stock hoy» no entra en el papel (la disponibilidad del producto no distingue «sin stock hoy» de «no se vende acá»); la base oculta pierde la descripción, los tags y la ★ del producto base (lo avisa el diagnóstico interno); la impresión solo se probó en Chromium.
- Aprobación de las capturas (paso 13): pendiente.

