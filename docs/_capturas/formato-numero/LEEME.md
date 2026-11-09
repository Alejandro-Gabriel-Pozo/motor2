# Capturas del formato de número de salida (maqueta, no se mergea)

**DATOS DE MAQUETA** (producción tiene 0 ventas y 0 recetas): «Milanesa con papas fritas» ($18.000) y «Jugo Fresli naranja» ($3.500), con bife de nalga, huevo, aceite de girasol, papa, sal fina y pan rallado, y 8 compras a «Frigorífico Los Andes», «Verdulería Don Pepe» y «Distribuidora Fresli», cargadas en una base local descartable (los precios de compra son supuestos de la maqueta). Pantallas REALES del sistema: ANTES = `origin/main` (d231db21), DESPUÉS = rama `alegp/formato-de-numero-salida`.

| Pantalla | Antes | Después |
|---|---|---|
| Receta (ingredientes) | `1-receta-antes-*` | `1-receta-despues-*` |
| Costos y márgenes (reporte con tabla) | `2-reporte-costos-antes-*` | `2-reporte-costos-despues-*` |
| Compras registradas | `3-compras-registradas-antes-*` | `3-compras-registradas-despues-*` |
| Ficha de cocina en pantalla | `4-ficha-de-cocina-antes-*` | `4-ficha-de-cocina-despues-*` |

Anchos 1366 (×768) y 390 (×844), deviceScaleFactor 2, página completa. Se ocultó el indicador de desarrollo de Next.
Qué mirar: «0.22» (punto) pasa a «0,22 kg» (coma, unidad pegada, alineado a la derecha); el dinero sale siempre con 2 decimales («$ 3.500,00»).
