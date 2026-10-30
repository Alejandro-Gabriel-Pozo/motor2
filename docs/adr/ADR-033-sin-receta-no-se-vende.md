# ADR-033: Sin receta no se vende

> Redactado el 2026-10-13 (rama `venta-exige-receta`, nacida de `main` en `b1cd4c8`). **Estado: aceptado por el dueño; implementado en el código, sin migraciones ni cambios de esquema.** El 032 es de GO-3 (combos y menú del día).

## Contexto

Hasta acá un producto de venta (PV) sin receta se vendía igual: la venta escribía su fila VENTA y no descontaba ninguna materia prima. El reporte «Ventas sin receta» (`src/server/consultas/reportes/ventas-sin-receta.ts`) existía para encontrar esas ventas después. El dueño decidió lo contrario, como regla FIJA para todo el sistema (hoy hay un solo cliente; no hay interruptor por empresa):

> «Si quiero que la venta exija receta así no se vende nada sin receta». Y antes: «menú del día… si no tiene receta, no se vende… si quieren cocinar algo que no existe deban dar de alta PV, armar su receta».

La base de producción, al decidirlo, tenía 50 PV, 0 recetas, 0 materias primas y 0 ventas: la regla no corta ninguna operación en curso; la puesta en marcha carga insumos y recetas antes de vender.

## Decisión

1. **Un PV solo se vende si tiene ORIGEN DE STOCK**, o sea de dónde sale lo que se descuenta:
   - su **receta vigente en la sucursal que vende**, con al menos un ingrediente: la EFECTIVA, con la resolución de siempre (`src/server/lecturas/catalogo/recetas-vigentes.ts`: la propia de la sucursal si la tiene habilitada en `RecetaSucursal`, si no la central). Una reventa también lleva receta: una gaseosa es «1 unidad de la botella»;
   - o **stock propio** (`seProduce`: consumió su receta al producirse; la venta resta su stock);
   - o es el **producto ancla de un adicional** (ADR-030, D-1): no tiene ni puede tener receta; su consumo es el de su opción. Se exceptúa solo el ancla VERIFICADA en la base (`anclaVerificada`, la misma que ya saltea la disponibilidad).
2. **La regla es pura y vive en un solo lugar**: `src/core/movimientos/origen-de-stock.ts` (`rechazoSinOrigenDeStock`, el mensaje y el código), reexportada por la fachada `src/core/movimientos/public.ts`.
3. **Se valida en tres lugares**, siempre dentro de la transacción SERIALIZABLE que ya existía y antes de la primera escritura:
   - **al agregar a la cuenta** (`src/server/actions/pos/casos-de-uso/agregar-items.ts`): el error temprano para el mozo, para cada ítem suelto (después de sus chequeos de producto de siempre) y para cada componente de una promo con cupos (si uno no tiene origen de stock, se rechaza la promo entera). Una lectura agrupada por pedido, no por ítem: `cargarOrigenDeStockParaVender` (`src/server/lecturas/movimientos/receta-para-vender.ts`);
   - **al cobrar** (cierre de cuenta) **y en la venta de mostrador**: la barrera final, en `armarLinea` (`src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`), con la MISMA receta que la venta ya leía para calcular el consumo (ninguna lectura nueva). Cubre la receta que se desactivó entre el pedido y el cobro.
4. **Error tipado**: `PRODUCTO_SIN_RECETA`, en el agregado de ítems, el cierre de cuenta y la venta de mostrador; el núcleo de la venta lo devuelve en `codigo` (`ResultadoVentaEnTx`). El texto nombra el producto y dice dónde se arregla: ««Milanesa» no tiene receta: armala en Catálogo → Recetas para poder venderla.» (en una promo, precedido por su título).
5. **Atomicidad e idempotencia**: el `fracaso` devuelto dentro de la transacción la confirma, por eso se valida antes de escribir: un rechazo no deja filas, ni ticket, ni el comprobante de la clave de idempotencia del agregado (el reintento con la misma clave vuelve a validar).
6. **Concurrencia**: si la sucursal vuelve a la receta central mientras se cobra, o la venta leyó la receta propia y vende con ella (con su consumo), o la leyó deshabilitada y rechaza; nunca queda una venta sin consumo ni una cuenta a medias (`test/pos/venta-exige-receta.test.ts`).

## Enmienda del 2026-10-29: las opciones elegidas cuentan como origen de stock

Decisión del dueño (2026-10-29, ventas con opciones): para una LÍNEA con opciones elegidas dentro del precio (MEDIDA, VARIANTE, INCLUIDA y la «ninguna» elegida), el origen de stock es **lo que esa línea descontaría**: se vende si se produce, si es el ancla de un adicional, si la receta base vigente tiene al menos un ingrediente **o si las opciones elegidas suman al menos un insumo**. Una base sin receta se vende, entonces, cuando lo elegido descuenta algo («Gaseosa 500 cc» sin receta propia, con «Coca» que suma 1 botella); con «Fanta», sin consumo cargado, se rechaza con el mismo código `PRODUCTO_SIN_RECETA` y un mensaje que nombra la opción y las dos formas de arreglarlo (cargarle el consumo a la opción en Catálogo → Biblioteca de opciones, o armar la receta del producto).

- **Una sola regla**: `rechazoSinOrigenDeStock` (`src/core/movimientos/origen-de-stock.ts`) suma el campo opcional `opciones` (sin él, el comportamiento es idéntico al de antes). Una REEMPLAZA con la base vacía no cuenta (no hay qué reemplazar); solo cuentan las SUMA.
- **Los dos lugares siguen**: el aviso temprano al agregar (`src/server/actions/pos/casos-de-uso/agregar-items.ts`, con `insumosSinLaBase` de `src/core/pos/linea-configurada.ts`: el mismo consumo con base vacía) y la barrera final al cobrar (`src/server/actions/movimientos/casos-de-uso/registrar-venta-en-tx.ts`), que la alimenta con los **pedidos reales** que van al libro: decisión y Kardex salen de lo mismo. Cambio de precedencia declarado: con la base vacía y un grupo obligatorio sin elegir, gana `OPCIONES_INVALIDAS` (antes ganaba `PRODUCTO_SIN_RECETA`).
- **Combos**: una entrada de combo con configuración fija sobre una base sin receta es un componente válido si lo que descuenta suma un insumo (`src/core/pos/componente-de-combo.ts`).
- **Catálogo**: el espacio del producto y el filtro «le falta: receta» usan la misma definición medida sobre el producto (alguna opción ofrecida suma un insumo): `src/server/lecturas/movimientos/origen-de-stock-del-catalogo.ts`.
- **El adicional sin consumo queda como estaba** (excepción declarada, fijada por un test): el ancla del adicional sigue exceptuada y su venta no descuenta nada. Esas ventas aparecen en «Ventas sin receta» (cada adicional es su propia operación de venta): `test/reportes/ventas-sin-receta-adicional-sin-consumo.test.ts`.
- Pruebas: `test/core/movimientos/origen-de-stock-con-opciones.test.ts` (oráculo puro de 78 casos), `test/pos/cobrar-base-sin-receta-con-opciones.test.ts` y `test/pos/venta-con-opciones-sin-receta-base.test.ts` (matriz de 24 casos, idempotencia y carreras).

## Consecuencias

- **El reporte «Ventas sin receta» se queda** como está, pero pasa a ser una **verificación**: con la regla, una venta NUEVA sin receta no puede existir, así que debería dar vacío. Puede mostrar ventas anteriores a la regla y las de productos que se producen (su venta no lleva CONSUMO: la receta se consumió al producir; el reporte no los distingue).
- **Los tests y fixtures** que vendían PV sin receta pasaron a usar una receta de reventa compartida (`test/setup/receta-de-venta.ts`, `darRecetaDeReventa`: una MP propia y 1 unidad por unidad vendida, con stock opcional). Dos caracterizaciones congeladas cambiaron y están declaradas con su motivo en `test/arquitectura/caracterizaciones-congeladas.test.ts`: `venta-con-opciones` (el flan del salón ahora consume) y `venta-matriz-ampliada` (el Agua y el Flan de reventa, y un paso nuevo R7 con un PV sin receta rechazado).
- **El conteo de consultas del agregado de ítems** tiene su quinta edición declarada (`test/pos/agregar-items-consultas.test.ts`): tres lecturas agrupadas más por pedido.
- **Sin migración**: no hay columna ni interruptor nuevo. Si un día hiciera falta vender sin receta en otro cliente, sería una decisión nueva (un ADR que reemplace a este).

## Pendientes

- **Decidido (2026-10-14): la demo La Cuadra no se mantiene; el seed queda sin adaptar y puede fallar en el tramo de desorden (PV020 sin receta).** Es el seed manual de 6 meses (`scripts/seed-demo-pizzeria-6-meses.ts`, guion `scripts/demo-seed/guion-la-cuadra.ts`); no corre en el CI.
- **GO-3, segunda tanda (combos y menú del día)**: desde GO-3 base, una promo con un cupo activo LISTA o DEL_DIA no se ofrece (`cargarPromoCartaParaAgregar` falla cerrado), así que hoy el chequeo de los componentes solo ve cupos de SECCIÓN. Es por producto, no por tipo de cupo ni por si el producto está en la carta: cuando la segunda tanda venda componentes de otros cupos (de una lista, fuera de carta o solo del POS), alcanza con que esos productos entren en la lista que lee `cargarOrigenDeStockParaVender` en `agregar-items.ts` (`productoIdsDelPedido`); un componente que no esté en esa lista se rechaza igual como «sin receta» (falla cerrado, con el nombre genérico «Un producto de la promo»), nunca se vende sin origen de stock. Y al cobrar, la barrera de `armarLinea` lo vuelve a mirar sea cual sea su origen.
