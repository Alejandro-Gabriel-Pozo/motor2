# Maqueta E0 · PR3 (#203): buscador de Trazabilidad y «Corregir este movimiento»

Rama temporal `alegp/tmp-capturas-e0-pr3` (no se mergea; solo imágenes). Pantalla **real** del sistema (build de producción con el código de #203) sobre una base local descartable con los datos reales de la empresa (sucursal Varvarco; Brownie $10.000). La venta se hizo por las pantallas (Mostrador: 1 Brownie). Celular 375 px y escritorio 1280 px, escala 2.

No es real: el Brownie lleva un insumo sustituto «Brownie (reventa)» 1:1 (la receta real no se cargó), por eso la venta tiene dos movimientos: CONSUMO del insumo y VENTA del producto.

| Archivo | Muestra |
|---|---|
| 70-trazabilidad-0-buscar-brownie | Trazabilidad → «Buscar por producto»: Brownie |
| 70-trazabilidad-1-resultado-venta-rotulada | La venta aparece como **VENTA** (antes salía como «CONSUMO», el rótulo del insumo, y parecía que no se listaban ventas) |
| 71-corregir-movimiento-0-operacion-con-enlace | «Ver operación» en celular: la tabla es más ancha que la pantalla y «Corregir este movimiento» queda **a la derecha, fuera de vista** |
| 72-celular-tabla-desplazada-a-la-derecha | La misma tabla desplazada: «Corregir este movimiento» en cada fila |
| 73-escritorio-operacion-con-enlace | Escritorio: el enlace se ve sin desplazar |
| 71-corregir-movimiento-1-ajuste-prellenado | El Ajuste que abre desde una fila: aviso «Estás corrigiendo un movimiento de MP_REV_PV_BROWNIE — Brownie (reventa)…», insumo prellenado, depósito del original y detalle «Corrección del movimiento de CONSUMO del 2026-11-07 · operación …» (la cantidad la completa la persona) |

## A tener en cuenta
- En celular el enlace no se ve de entrada (hay que desplazar la tabla): es el comportamiento de la tabla de Trazabilidad hoy. Alternativa barata si se prefiere: poner la columna «Corregir» primera o debajo del producto. No está hecho (no se tocó el código de #203).
- Solo ve el enlace quien tiene `proceso_ajuste` (Editar); el gerente de la maqueta es administrador.
