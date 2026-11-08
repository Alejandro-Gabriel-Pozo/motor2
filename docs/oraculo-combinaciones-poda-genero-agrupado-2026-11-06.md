# Oráculo de combinaciones — poda de «género de carta» e «ítem agrupado» (2026-11-06)

**Decisión del dueño (2026-11-06):** «ocultá género e ítem agrupado». **Necesidad:** `GeneroCarta` e `ItemAgrupadoCarta` resuelven el mismo problema que las **opciones de venta** (agrupar, ordenar y dar variantes de un producto en la carta; «las marcas se resuelven con opciones»). En producción hay 0 ítems agrupados y géneros sin productos (según el dueño: Agua, Agua saborizada, Huinganco): no hay datos que perder.

**Forma:** un interruptor reversible, `GENERO_E_ITEM_AGRUPADO_VISIBLE` (`src/core/carta/genero-e-item-agrupado.ts`), **apagado** en producción. Una sola constante para los dos conceptos porque comparten flujo (el ítem agrupado hereda el género, el POS los junta en la misma carpeta, el formulario del producto y la pantalla de agrupados ofrecen el género en el mismo lugar). **No se borra nada** (tablas, filas, claves de permiso); para volver: poner `true`.

Este documento es la versión legible de `test/carta/genero-e-item-agrupado.oraculo.ts` (el que recorre el test `genero-e-item-agrupado-combinaciones.test.ts`). Si cambia una regla, cambian los dos.

## Dimensiones

| Dimensión | Valores |
|---|---|
| Interruptor | apagado · encendido |
| Datos | sin · con (un género y un ítem agrupado cargados) |
| Superficie (etapa 1, servidor) | carta pública · selector del POS · 9 acciones de escritura |
| Superficie (etapa 2, pantallas) | pantallas de administración · menú y enlaces · matriz de permisos |

## Reglas

| # | Regla |
|---|---|
| R1 | **Apagado**, toda acción de escritura de géneros / ítems agrupados / «aplicar el mismo precio a los hermanos» responde *rechazada* con el mensaje del interruptor, con o sin datos, y **no cambia nada** (repetirla da lo mismo). |
| R2 | **Encendido**, ninguna acción responde ese mensaje: hace lo de siempre. |
| R3 | **Apagado**, la carta pública y el POS **ignoran** la estructura: ni ítem agrupado ni carpeta de género. Las opciones con contenido visible salen sueltas en su sección; las que no, quedan «fuera de carta». Sin errores. |
| R4 | **Encendido**, se arman el ítem agrupado (con sus opciones) y las carpetas de género, como antes. |
| R5 | **Sin datos**, el interruptor no cambia nada de lo que se ve. |
| R6 | **Apagado**, guardar el contenido de un producto **no pisa** el género que ya tenía (queda guardado para cuando se encienda) y un género pedido a mano se ignora. |

## Acciones de escritura gobernadas (9)

`guardarGeneroCarta`, `actualizarActivoGeneroCarta`, `guardarItemAgrupadoCarta`, `actualizarActivoItemAgrupadoCarta`, `agregarOpcionItemAgrupadoCarta`, `actualizarOrdenOpcionItemAgrupadoCarta`, `quitarOpcionItemAgrupadoCarta`, `sincronizarPrecioGrupoCarta`, `sincronizarPrecioLocalGrupoCarta`.
El permiso sigue siendo lo primero (quien no lo tiene recibe el rechazo de siempre; no se delata el interruptor).

## Carta sembrada (datos reales del dueño)

Sección **Bebidas**: Café $4.000, Capuccino $8.000, Cerveza Patagonia $14.000 (los tres con contenido visible) y Cerveza Huinganco $14.000 (sin contenido). Sección **Postres**: Brownie $10.000.
«Con datos»: género *Agua* en el Café; ítem agrupado *Cerveza* (las dos cervezas, mismo precio) con el género *Huinganco*; género *Agua saborizada* sin productos.

| Interruptor · datos | Carta pública — Bebidas | POS — Bebidas | POS — fuera de carta |
|---|---|---|---|
| apagado · sin | Café, Capuccino, Cerveza Patagonia | Café, Capuccino, Cerveza Patagonia | Cerveza Huinganco |
| apagado · con | Café, Capuccino, Cerveza Patagonia | Café, Capuccino, Cerveza Patagonia | Cerveza Huinganco |
| encendido · sin | Café, Capuccino, Cerveza Patagonia | Café, Capuccino, Cerveza Patagonia | Cerveza Huinganco |
| encendido · con | Café, Capuccino, **Cerveza** (opciones: Huinganco, Patagonia) | Capuccino, carpeta **Agua** {Café}, carpeta **Huinganco** {agrupado Cerveza [Huinganco, Patagonia]} | — |

Postres: Brownie en todos los casos.

## Guardianes (fallan si aparece una dimensión sin declarar)

1. Toda acción que exporta `generos.ts` o `items-agrupados.ts` está en la lista de 9, y cada una de las 9 rechaza con el interruptor apagado.
2. Toda columna o relación de `GeneroCarta`, `ItemAgrupadoCarta` y `OpcionItemAgrupadoCarta` en `prisma/schema.prisma` está declarada (afecta / no afecta).
3. Todo archivo de `src/` que toca esas tablas está clasificado (*aplica* — y entonces lee el interruptor —, *por la acción*, *pantalla etapa 2* o *sin efecto* con motivo).

## Líneas ocultas que se podrían borrar más adelante (con autorización expresa del dueño)

Pantallas `carta/agrupados/page.tsx` (~401 líneas) y `carta/parametrizacion/generos/page.tsx` (~140), acciones `generos.ts` + `items-agrupados.ts` y sus 7 casos de uso, `persistencia/carta/{generos,items-agrupados}.ts`, las ramas de agrupados/géneros de `armar-menu.ts`, `core/pos/selector-carta.ts`, `consultas/carta/admin.ts` y `mantenimiento.ts`, las claves de permiso `carta_generos` y `carta_items_agrupados`, y las tablas `GeneroCarta`, `ItemAgrupadoCarta`, `OpcionItemAgrupadoCarta` (+ `ContenidoCartaProducto.generoCartaId`). Borrarlas es una etapa aparte (migración destructiva): no se hace sin aviso y OK del dueño.
