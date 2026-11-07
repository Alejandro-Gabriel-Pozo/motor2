# Maqueta E1: «Corregir una línea» con «cuántas unidades quitar»

Rama temporal `alegp/tmp-capturas-e1` (no se mergea, sin PR). Son capturas de la **pantalla real del sistema** (servidor de producción `next start`, código del PR 3 de E1 apilado sobre #204) sobre una **base local descartable** (`motor2_e2e`, Postgres 16 local) con los datos reales de la empresa. Todo se operó por las pantallas (no con SQL). Celular = 375 px, escala 2. Guiones en `herramientas/` (`sembrar-datos-reales.ts` y `caso-quitar-unidades.ts mesa|mostrador`).

## Qué es real y qué no (declarado)
- **Real (leído de producción en la maqueta anterior):** nombres y precios de venta de los 23 productos (Cerveza Patagonia $14.000, Brownie $10.000, Café $4.000, Capuccino $8.000, Flan casero $9.000…), las sucursales, Mesa 1 (SALÓN) y el puesto 0 (MOSTRADOR).
- **NO real:**
  - Se operó en «Varvarco» (no se sabe en cuál sucursal está la Mesa 1 real).
  - **Stock inicial de EJEMPLO** para poder vender: Cerveza Patagonia 24, Brownie 20, Café 200, Capuccino 100, Flan casero 20. No son los reales.
  - **Recetas:** sus recetas reales no se pasaron; los productos llevan el sustituto «… (reventa)» 1:1 (el sistema exige receta para vender).
  - Costos de compra: ninguno cargado (la venta queda con costo vacío = «sin dato»).
  - Usuario `gerente@maqueta.local` (rol admin), la clave de sesión y el secreto del servidor son descartables y viven solo en la base y el entorno locales (no hay `.env` ni secretos en esta rama).
- **No se pudo mostrar:** la nota «pendiente de completar: corregir unidades de líneas con adicionales» (el mundo real no tiene adicionales cargados). El texto está en el código (`corregir-linea.tsx`) y se prueba en `test/pos/lineas-corregibles.test.ts`.

## Caso 1 — Mesa 1: 2 Cerveza Patagonia + 1 Brownie + 2 Café = $46.000 → se quita 1 Cerveza → $32.000
| Archivo | Muestra |
|---|---|
| `e1-mesa-1-antes-cuenta-cerrada` | ANTES: «Cuentas cerradas: N.º 1-A · $46.000» con el botón «Corregir una línea» |
| `e1-mesa-2-dialogo-elegir-linea` | El diálogo: las tres líneas con su importe |
| `e1-mesa-3-linea-elegida` | Elegida la Cerveza (2 unidades): aparece «¿Qué corregís de esa línea?» |
| `e1-mesa-4-quitando-1-unidad` | «Quitar solo algunas unidades», − / + (1 de 2), «Queda 1 × Cerveza Patagonia ($14.000) y vuelve al stock 1 unidad», total hoy $46.000 → corregido $32.000 |
| `e1-mesa-5-con-motivo` | Con el motivo «La mesa tomó una sola cerveza» |
| `e1-mesa-6-despues-aviso` | Justo después de confirmar |
| `e1-mesa-7-despues-recargado` | DESPUÉS: «N.º 1-B · $32.000» |
| `e1-mesa-8-reporte-tickets` | Reporte: 1-B «Corrección de N.º 1-A» con 1 Cerveza, $32.000; 1-A «Reemplazada por N.º 1-B» $46.000 (el original sigue igual) |

Lo que quedó en la base (verificado después): 1 venta nueva que reemplaza a la original (`reemplazaAOperacionId`), la original marcada con el motivo, su contra-asiento, auditoría «unidadesVendidas 2 → 1», y el stock de la cerveza 24 − 2 + 1 = **23**.

## Caso 2 — Mostrador (puesto 0): 1 Capuccino $8.000 + 1 Flan casero $9.000 = $17.000 → se corrige el Flan → $8.000
Serie `e1-mostrador-1…8` (mismos pasos). Ahí las líneas son de 1 unidad, así que el diálogo no ofrece «cuántas unidades» (solo la línea entera) y el ticket pasa de 2-A $17.000 a 2-B $8.000.

## Toques (de la corrección, sin contar cargar el pedido)
- **Ahora (medido con el guion):** 3 toques + 1 campo (motivo) en UNA pantalla: «Corregir una línea» → elegir la línea → «Corregir e imprimir» (la cantidad a quitar arranca en 1).
- **Antes** (según el guion de la maqueta anterior, `caso-pos.ts`): 7 toques + 1 campo en 3 pantallas (Reportes → Tickets, Trazabilidad → «Anular venta» → «Sí, anular», volver a la mesa → «Emitir el ticket corregido» → «Emitir e imprimir»), y **no se podía** corregir «1 de 2»: se anulaba la línea entera.
