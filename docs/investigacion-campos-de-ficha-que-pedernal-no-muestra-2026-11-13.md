# Investigación: campos de la ficha de producto de Motor2 que Pedernal no muestra (2026-11-13)

> Solo documento. No se tocó código, ni migraciones, ni ninguna base.
>
> **Pedido** (dueño, 2026-11-13, chat con el orquestador, literal): sobre hermanar, consignación, observaciones, factor de conversión y producto de respaldo (el de los adicionales), «Habría que ver qué resuelven y por qué Pedernal no las tiene...».
>
> **Cómo se verificó.** Motor2: código real de este repositorio, con archivo:línea. Pedernal: `zuluhub-docs` al día (`git fetch` a las 22:59 UTC del 13/11, commit `80828e9`). **No pude leer el código de Pedernal** (`ZuluHub-ERP`: el `add_repo` fue denegado en mi sesión): lo que cito de su código viene de las fichas de `zuluhub-docs`, marcado **(ficha de Pedernal)**. Datos de producción: no tengo acceso; ningún conteo de filas de estos campos está verificado (**NO VERIFICADO**; recontar antes de decidir una poda).
>
> **Regla de poda del dueño (2026-10-28, AGENTS.md):** una opción se oculta con un interruptor reversible y recién después se borra, con aviso, si no viene del producto original ni resuelve una necesidad. «Un cero de uso en producción es evidencia débil mientras haya pocos datos reales: la que manda es la necesidad.»

## 0. Resumen (una tabla)

| Campo (ficha de Motor2) | Qué resuelve hoy | ¿Pedernal lo resuelve en otro lugar? | Si se saca de la ficha | Recomendación |
|---|---|---|---|---|
| **Hermanar** (asignar el **Insumo**) | Reúne la misma materia prima comprada a distintos proveedores bajo otro nombre/código: pool de stock «por familia», sustitutos en receta, comparativa de precios | **Sí, distinto**: un solo producto con «ofertas de proveedor» (decisión 70) | Se rompe el stock por familia, los sustitutos de receta y la comparativa de precios | **Mantener**; el equivalente de Pedernal es un rediseño de compras, no un movimiento de campo |
| **Consignación** (tilde, proveedor, precio) | Costo y deuda con el proveedor al vender o consumir; reporte y pagos al consignante | **No**: «solo se deja el lugar», fuera de la primera versión (decisión 54) | Se rompen la liquidación en la venta, el reporte y el pago al consignante | **Mantener** (ya está protegida por permiso); no ocultar mientras haya una necesidad declarada |
| **Observaciones** | Texto libre (hasta 500) que solo se muestra en el detalle y se copia al duplicar | **No** hay campo equivalente en el producto (no encontré decisión) | No se rompe nada (sin lógica); se pierde el texto cargado | **Mantener por ahora** (costo cero); candidata a poda si el dueño la quiere igual a Pedernal |
| **Factor de conversión** (con unidad de compra) | Cuántas unidades de stock trae una unidad de compra: convierte cantidad y costo de cada compra | **Sí, distinto**: «presentación de compra» (nombre + cantidad fija en la unidad base), decisión 92 | Se rompe la carga de compras y el costo por unidad | **Mantener**; el rediseño ya está en papel y hay que reconciliarlo con Pedernal |
| **Producto de respaldo** (ancla del adicional) | Es el producto interno que hace que un adicional se venda y descuente stock como línea hija | **Sí, distinto**: el adicional lleva recargo y «qué consume» (insumo + cantidad), sin producto | Se rompe el descuento de stock y el precio de los adicionales | **Mantener** (lo maneja el sistema; no es un campo que se edite); diseñar el equivalente solo si se hace la paridad de opciones |

---

## 1. Hermanar (el Insumo del producto)

**Qué es en Motor2 (VERIFICADO).** `Producto.insumoId` (`prisma/schema.prisma:383-384`) apunta a un `Insumo` (`schema.prisma:512`, «nombre interno histórico “Familia”»: de cara al usuario es «Insumo»), que cuelga de un nodo de Grupo. El asistente `src/components/catalogo/asistente-hermanar.tsx` lo presenta como «hermanar una MP nueva con una que ya existe comprada a otro proveedor bajo otro nombre/código» (se hizo «a pedido explícito del usuario: “no me parece que sea intuitivo”»). **Quién lo usa:** el stock «por familia» (`src/core/stock/por-familia.ts`, `src/app/(app)/stock/por-familia/page.tsx`), los sustitutos de una línea de receta cuando ella y sus hermanas se agotan en la venta (`SustitutoRecetaIngrediente`, `schema.prisma:~870`; `src/core/catalogo/receta-validacion.ts:33-37`), el origen de una venta (`src/server/persistencia/movimientos/cargar-origen-de-venta.ts`, `src/core/movimientos/origen-venta-datos.ts`), la comparativa de precios por insumo (`src/server/lecturas/catalogo/ofertas-de-proveedor.ts:238-241`), el reporte «huecos de catálogo» (`src/core/reportes/huecos-catalogo.ts`) y los avisos de stock de la carta (`src/server/consultas/carta/avisos-de-stock.ts`). Son al menos 18 archivos de `src/` que mencionan `insumoId`.

**Qué hace Pedernal (ficha de Pedernal).** No hay «hermanar»: el dueño decidió el 08/11 (decisión 70, `catalogo-y-niveles-maqueta.md:1360`) que la misma materia prima de varios proveedores es **un solo artículo, «como un pool»**: la existencia es un pool por artículo y al usarla no se elige proveedor; para la compra, **cada proveedor tiene su información** (oferta de proveedor: `presentacion-de-compra.md`, «no es la oferta de un proveedor, otra tabla»; `ERP:migraciones/0037_compras.sql:156` según la ficha). `articulo-de-stock.md`: «Uno solo por producto y sin distinguir proveedor». O sea: Pedernal evita el problema de origen (dos productos que son lo mismo); Motor2 lo resuelve **después**, uniéndolos.

**Qué se rompería si se saca de la ficha de Motor2:** el stock por familia, los sustitutos de receta (cuando se agota una materia prima se reemplaza por otra del mismo insumo), la comparativa de precios entre proveedores y el reporte de huecos. Mientras haya dos productos con el mismo contenido y distinto proveedor, no hay otra forma de reunirlos.

**Recomendación: mantener.** Sacar el campo sin el equivalente deja datos huérfanos. Para «ser iguales a Pedernal» hay que **diseñar el equivalente** (un producto, varias ofertas de proveedor) y migrar los productos hermanados (migración de datos, requiere autorización expresa). Costo: alto (toca compras, stock, recetas y reportes). Alternativa barata: dejar el asistente como está y no sumar nada. **NO VERIFICADO:** cuántos insumos con más de un producto hay hoy en producción.

---

## 2. Consignación (tilde, proveedor y precio)

**Qué es en Motor2 (VERIFICADO).** `Producto.esConsignacion`, `proveedorConsignacionId`, `precioConsignacion` (`schema.prisma:418-421`). En el formulario de producto el costo de consignación es de quien tiene `pagar_consignante` en alguna sucursal (`producto-form.tsx:80,165-169`, decisión S-12/D8 del dueño). **Quién lo usa:** la venta y el consumo escriben una línea `LIQUIDACION_CONSIGNACION` (`schema.prisma:954,983-984,1289-1293`; `src/server/actions/movimientos/casos-de-uso/armar-linea-de-movimiento.ts`, `src/core/movimientos/armar-filas-de-movimiento.ts`, `filas-de-venta.ts`), el reporte de consignación (`src/server/consultas/reportes/consignacion.ts`, `src/core/reportes/consignacion.ts`), los pagos al consignante (`PagoConsignante`, `schema.prisma:673`; `src/server/persistencia/reportes/pago-consignante.ts`), la anulación de una venta (`cargar-venta-para-anular.ts`) y el duplicado de producto. Son 25 archivos de `src/` que mencionan alguno de los tres campos.

**Qué hace Pedernal (ficha de Pedernal / documentos).** **Descartada de la primera versión**: decisión 54 (dueño, 08/11, «54 ok ver»): «solo se deja el lugar (propietario y condición de tenencia en el movimiento)… no se liquida automáticamente al proveedor, no se genera deuda, no se calcula costo propio… se construye cuando haya un cliente que la use»; D55 (el costo y la obligación nacen según lo pactado, por defecto al vender o consumir; el tratamiento fiscal lo define el contador) y D56 (la regla de qué stock se usa se declara por ítem) quedan «al construir». El estudio de factibilidad (`migracion-de-motor2-a-pedernal-factibilidad.md:79,92,173`) la lista como brecha de Motor2 que Pedernal descartó: «4 a 8 tramos + especificación». **Dato del dueño, con reserva:** el 11/11 le dijo a la sesión padre de Pedernal «excepto el tema de consignaciones, que ese sistema pase para acá» (`decisiones-del-dueno-2026-11.md:35`), cita **relatada y no confirmada** por el dueño: la propia fila dice «NO CONFIRMADA».

**Qué se rompería si se saca:** la liquidación al vender, el reporte y los pagos al consignante: es dinero que se le debe a un tercero.

**Recomendación: mantener, como está** (ya protegida por permiso). No ocultarla: hay una necesidad declarada por el dueño (el 11/11 la excluyó de «lo que se pasa a Pedernal» por ser un sistema que sigue en Motor2). Si el dueño quisiera «igual a Pedernal», habría que **no tenerla** y eso es destructivo (datos de consignación, dinero pendiente): requiere recontar y aviso previo. **NO VERIFICADO:** cuántos productos consignados y cuántos pagos existen en producción.

---

## 3. Observaciones

**Qué es en Motor2 (VERIFICADO).** `Producto.observaciones` (`schema.prisma:378`), texto libre de hasta 500 caracteres. Solo hay tres usos: se carga en el formulario (`producto-form.tsx:171`), se **muestra** en el detalle del producto como «Observaciones» (`src/app/(app)/catalogo/productos/[id]/page.tsx:198-200`) y se **copia** al duplicar un producto (`src/server/actions/catalogo/casos-de-uso/duplicar-producto.ts:200`). **Ninguna regla, reporte ni cálculo la lee.** La auditoría de Motor2 la menciona sin audit (`observaciones` entre los campos que no se auditan, según el catálogo de primitivas).

**Qué hace Pedernal.** No encontré ningún campo equivalente en el producto de Pedernal ni una decisión que lo descarte: las apariciones de «observaciones» en `zuluhub-docs` son de recepción de compra y de lote («con observaciones», cuarentena) y no tienen relación. **No hay decisión localizada: NO VERIFICADO si fue una decisión o un faltante.**

**Qué se rompería si se saca:** nada en el sistema; se pierde el texto cargado.

**Recomendación: mantener por ahora** (costo cero y sin lógica asociada) y **proponer la poda si el dueño quiere la ficha igual a la de Pedernal**: ocultar con un interruptor reversible (el molde de `DESCUENTO_POR_PRODUCTO_VISIBLE` / `ESTA_BIEN_ASI_VISIBLE`), sin migración y sin borrar la columna, y borrar recién con aviso. Hay que recontar cuántos productos tienen texto. Es la candidata más clara a poda de las cinco.

---

## 4. Factor de conversión (y unidad de compra)

**Qué es en Motor2 (VERIFICADO).** `Producto.factorConversion` (`schema.prisma:376`, `Decimal(14,4)`, por defecto 1) con `unidadCompraId`: «unidades de stock por unidad de compra» (`producto-form.tsx:330-349`). Es uno de los cuatro **campos sensibles** que protege `producto_campos_sensibles` (precio de venta, factor y las dos unidades; `producto-form.tsx:53,86`): sin la clave el alta fija factor 1 y sin unidad de compra. Además existen las **presentaciones alternativas** con su propio factor (`schema.prisma:619-628`, `gestion-presentaciones.tsx`, `agregar-presentacion-alternativa.ts`). **Quién lo usa:** el armado de cada línea de compra y movimiento (`armar-linea-de-movimiento.ts`, `cargar-linea-de-movimiento.ts`: convierte cantidad y costo a la unidad de stock), las ofertas de proveedor (`ofertas-de-proveedor.ts`), la opción de un grupo (`crear-opcion-de-grupo.ts`), el alta rápida y el duplicado. 22 archivos de `src/` lo mencionan.

**Qué hace Pedernal (ficha de Pedernal).** **Sí lo resuelve, con otro modelo:** el producto tiene **una unidad base** (que no cambia nunca) y varias **presentaciones de compra** («caja de 12», «bolsa 25 kg»), cada una con un nombre y una cantidad fija en la unidad base; al recibir, al stock entra la cantidad convertida, nunca «la caja» (decisión 92, `catalogo-y-niveles-maqueta.md:1382`; `presentacion-de-compra.md`). En pantalla: «Presentación», «Cantidad en la unidad base», «Agregar presentación» (textos aprobados el 09/11). No hay «unidad de compra» ni «factor» en el producto.

**Hallazgo de Motor2 propio:** `docs/diseno-envase-de-compra-en-el-vinculo-2026-11-03.md` (CONFIRMADA por el dueño el 03/11, opción C) ya había decidido que el envase viva **en el vínculo proveedor × materia prima**, con una columna nueva y migración (a autorizar). **Es otro modelo que el de Pedernal** (presentación por producto): si se persigue la paridad hay que **reconciliar los dos diseños** antes de construir cualquiera. **NO VERIFICADO:** si ese diseño llegó a implementarse (no lo busqué en el código).

**Qué se rompería si se saca de la ficha:** la carga de compras (no habría cómo convertir la caja a kilos) y el costo por unidad de stock de cada compra.

**Recomendación: mantener.** No es un campo opcional; sin él se rompe el costo. Lo que corresponde es **diseñar el equivalente de Pedernal** (presentaciones por producto) y decidir su relación con el diseño del 03/11. Costo: medio (compras y catálogo; migración de datos si se cambia el modelo).

---

## 5. Producto de respaldo (el «ancla» de los adicionales)

**Qué es en Motor2 (VERIFICADO).** `OpcionDeGrupo.productoId` (`schema.prisma:3587`, «GO-1») es el **producto ANCLA** de una opción de un grupo **ADICIONAL**: «el producto que se vende y descuenta stock como línea hija», único por empresa, inmutable, oculto por defecto («sin filas de disponibilidad queda oculto»). Del lado del producto: `Producto.opcionQueRespalda` (`schema.prisma:446-447`). **No es un campo que alguien edite en la ficha**: el sistema lo crea al dar de alta un adicional (`src/components/catalogo/nueva-opcion-en-el-grupo.tsx:30,55`: «la unidad de su producto de respaldo (un adicional)»), y la ficha del producto de respaldo queda **bloqueada** para casi todo: no se puede agregar a la carta (`agregar-producto-a-la-carta.ts:54`), duplicar (`duplicar-producto.ts:121-125`), cambiar disponibilidad (`actualizar-disponibilidad-producto.ts:85`), darle receta (`guardar-version-de-receta.ts:95`), admitirle grupos (`fijar-admision-de-grupo-en-producto.ts:94`) ni crearle grupos (`crear-grupo-en-el-producto.ts:90`); todas con el código `ES_ANCLA_DE_ADICIONAL`. Se ve en listas y filtros (`src/server/lecturas/catalogo/filtros-de-productos.ts`, `opciones-de-venta.ts`, `espacio-del-producto.ts`). **Dónde lo ve el dueño exactamente: NO VERIFICADO** (el pedido dice «el de los adicionales» en la ficha; en el código aparece como producto bloqueado y como unidad pedida al crear un extra).

**Qué hace Pedernal (ficha de Pedernal).** **Lo resuelve sin producto:** un **adicional** es una clase de grupo de opciones que «suma un recargo por cada opción elegida» y cada opción puede declarar **qué consume** (insumo + cantidad + «escala con la medida») en `consumo_de_opcion` (`grupo-de-opciones.md`, `escala-con-la-medida-y-consumo-por-opcion.md`, `ERP:migraciones/0025_catalogo.sql:263-275` según la ficha); el dueño decidió el 12/11 que **una opción puede consumir un elaborado** (decisión 179). El consumo del catálogo «hoy es solo dato» y el módulo de stock lo lee aparte (ficha de Pedernal). No hay producto ancla ni nada equivalente.

**Qué se rompería si se saca:** el descuento de stock de los adicionales como línea hija de la venta y su precio por sucursal (Motor2 los modela como un producto vendible oculto).

**Recomendación: mantener** (es infraestructura interna que maneja el sistema; el dueño no la carga) y **no moverla**. Para la paridad con Pedernal habría que **diseñar el equivalente** (consumo por opción sin producto ancla) como parte de una paridad de opciones: es un rediseño grande (venta, stock, carta, reportes) y no hay datos que lo justifiquen todavía. Costo: alto. **NO VERIFICADO:** cuántos adicionales existen en producción.

---

## 6. Qué hace falta saber antes de decidir

1. **Conteos en producción** de las cinco cosas (insumos con más de un producto, productos consignados y pagos, productos con observaciones, presentaciones alternativas, adicionales): el orquestador ya leyó la copia del 12/11 para otras tablas; faltan estas.
2. **Dónde ve el dueño el «producto de respaldo»** (pantalla exacta).
3. **Si el diseño del envase en el vínculo (03/11) se implementó** y cómo se reconcilia con las presentaciones de Pedernal.
4. **Código de Pedernal:** confirmar con `ZuluHub-ERP` lo que acá viene de fichas (no pude leerlo).

**Decisiones del dueño que el orquestador puede preguntar** (una por campo, con la recomendación de arriba): observaciones (¿ocultar con interruptor, como Pedernal?), y para hermanar, factor de conversión y producto de respaldo (¿se diseña el equivalente de Pedernal o se mantiene lo de Motor2?). Consignación: no se pregunta mientras el dueño no pida lo contrario.
