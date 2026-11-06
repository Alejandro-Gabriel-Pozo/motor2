# Maqueta: ocultar las presentaciones de compra (PR #191)

Rama temporal `alegp/tmp-capturas-poda-presentaciones` (no se mergea). Capturas de la **pantalla real del sistema** (servidor de producción `next start`, construido una vez con el interruptor `PRESENTACIONES_VISIBLES = true` = ANTES y otra con `false` = DESPUÉS) sobre una **base local descartable** con los datos reales de la empresa (sucursales, proveedor CORDECC, Cerveza Patagonia y Agua 500 cc con su precio de venta). Celular = 375 px, escala 2. Guiones en `herramientas/`.

## Qué NO es real (declarado)
- **Producción tiene 0 presentaciones.** Para poder mostrar el ANTES, se cargó en la base local, SOLO PARA MOSTRAR, una unidad «caja» y una presentación de ejemplo «caja ×24» en el insumo «Cerveza Patagonia (reventa)». El DESPUÉS corre sobre la MISMA base, con esa presentación todavía existiendo: la pantalla no la muestra y el dato no se tocó.
- Cerveza Patagonia se compra como insumo «Cerveza Patagonia (reventa)» (el sistema no admite dos productos con el mismo nombre ni compra productos de venta), igual que en las maquetas anteriores.
- Sucursal «Varvarco» (supuesto declarado), usuario `gerente@maqueta.local` (rol admin).

## Capturas
| Archivo | Muestra |
|---|---|
| 1-antes-editar-insumo-cerveza-patagonia | Catálogo → insumo → Datos: bloque «Presentaciones de compra alternativas» con «caja ×24», «Desactivar» y el alta de otra |
| 1-despues-editar-insumo-cerveza-patagonia | Misma pantalla: el bloque ya no está |
| 2-antes-… / 2-despues-ficha-insumo-cerveza-patagonia | Ficha (Resumen): la sección «Presentaciones de compra» aparece antes y no después |
| 3-antes-… / 3-despues-compra-paso2-cerveza-patagonia | Compra, paso 2, Cerveza elegida: antes el desplegable «UM» ofrece la caja; después solo la unidad por defecto |

## Qué pasa en el sistema (PR #191)
Sin migración y sin tocar datos. Con el interruptor apagado el servidor rechaza crear o activar/desactivar presentaciones y las lecturas no devuelven ninguna. Para volver a encenderlo: `true`.
