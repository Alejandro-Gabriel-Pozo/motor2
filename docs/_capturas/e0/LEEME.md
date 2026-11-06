# Maqueta E0 · PR2: «Corregir una línea» (Cuentas cerradas)

Rama temporal `alegp/tmp-capturas-e0` (no se mergea). Capturas de la **pantalla real del sistema** (servidor de producción `next start` con el código del PR #196) sobre una **base local descartable** con los datos reales de la empresa (sucursales Oficinas NQNTUR, Varvarco, Huinganco, Manzano Amargo, Las Ovejas y Los Miches; proveedor CORDECC; Mesa 1 SALÓN y puesto 0 MOSTRADOR; precios reales: Cerveza Patagonia $14.000, Brownie $10.000, Café $4.000, Capuccino $8.000, Flan casero $9.000). Celular 375 px, escala 2. Todo se operó por las pantallas, nada por SQL.

Para comparar el «antes» (recorrido de hoy, 3 pantallas): `docs/_capturas/correcciones/20-mesa-*` y `30-mostrador-*` en la rama `alegp/tmp-capturas-correcciones`.

## Qué NO es real (declarado, igual que la maqueta anterior)
- Se operó en «Varvarco» (no se sabe en qué sucursal está la Mesa 1 real).
- Brownie, Café, Capuccino y Flan casero llevan un insumo sustituto «… (reventa)» 1:1 con stock, porque sus recetas reales no se pasaron (el sistema no vende sin receta).
- Usuario `gerente@maqueta.local`, rol admin (el mozo no tiene `anular_venta`: el botón le sale deshabilitado con su motivo; no se probó en pantalla).

## Toques
| | Antes (hoy) | Después (PR2) |
|---|---|---|
| Pantallas | 3 (Reportes → Tickets, Trazabilidad, mesa) | **1** (la propia fila de «Cuentas cerradas») |
| Toques | 8 toques + 1 texto | **3 toques + 1 texto** (Corregir una línea → tocar la línea → Corregir e imprimir; el texto es el motivo) |
| Puede quedar a medias | Sí (anulada y sin ticket corregido) | No (una sola transacción: todo o nada) |
| Motivo | al final, en otro paso | en el mismo diálogo |

Medido: tras confirmar, la fila de la cuenta mostró el ejemplar B y el total nuevo **~180 ms** después del aviso, sin recargar (mesa y mostrador).

## Caso 1 — Mesa 1 (SALÓN): 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000 → se corrige la línea del Brownie → $36.000
| Archivo | Muestra |
|---|---|
| 50-mesa-0-antes-cuenta-cerrada | Recién cerrada: N.º 1-A, $46.000, botón nuevo «Corregir una línea» |
| 50-mesa-1-dialogo-abierto | El diálogo: las 3 líneas con su importe, total del ticket hoy, motivo |
| 50-mesa-2-linea-elegida | Brownie elegido ($10.000) |
| 50-mesa-3-motivo-escrito | Motivo «El cliente devolvió el brownie» |
| 50-mesa-4-despues-sin-recargar | Sin recargar: aviso «Ticket N.º 1-B emitida: reemplaza a N.º 1-A», fila 1-B $36.000 |
| 50-mesa-5-despues-recargado | Lo mismo tras recargar |
| 50-mesa-6-reporte-tickets | Reporte de tickets: los dos ejemplares del mismo número |

## Caso 2 — Mostrador (puesto 0): 1 Capuccino + 1 Flan casero = $17.000 → se corrige el Flan → $8.000
Mismos seis archivos con prefijo `60-mostrador-`. Después de corregir queda una sola línea vigente: «Corregir una línea» pasa a deshabilitado y su `title` dice por qué («Es la única línea que sigue vendida: para anular toda la venta usá «Anular venta» en Trazabilidad»).

## Qué se ve que conviene mirar
- La anulación y el ticket salen de una sola vez; el aviso concatena los dos mensajes de siempre («Ticket N.º 1-B emitida… Venta anulada. Se revirtieron 2 movimiento(s) de stock.»).
- Lo que ya se imprimió (1-A) no se toca: el 1-B es otro papel con el mismo número.
- Una promo se corrige entera (una sola línea en la lista) y un adicional va con su producto: cubierto por tests, no tiene captura (no hay promos cargadas en esta base).
