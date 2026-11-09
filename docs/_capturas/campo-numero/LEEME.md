# Capturas de la regla de números de entrada (maqueta, no se mergea)

**DATOS DE MAQUETA**: no se leyó producción; nombres y precios de la empresa cargados a mano en una base local descartable. Pantallas REALES de la rama `alegp/campo-numero-entrada` (PR #222), build de producción.

| Archivo | Qué es |
|---|---|
| `1-precio-1000-*` | Promociones: «Precio» ya con 1.000,00 (sin foco) y «Orden» sin flechitas |
| `2-cantidad-entendido-*` | Receta de «Milanesa con papas fritas»: cantidad de Harina 000 con foco, tipeado «0,30» y «= 300 g» |
| `2b-importe-entendido-*` | Promociones: Precio con foco, tipeado «1234,5» (su «= …» de importe) |
| `3-aviso-del-punto-*` | Precio tras teclear «12.»: el punto se ignora, el campo queda en «12» y sale «Los decimales van con coma: 0,5» |
| `4-pegado-rechazado-*` | Cantidad de la receta, pegado «1.234» (`fill`): el campo queda en «0,30» y se ve el aviso |
| `5-entero-y-porcentaje-*` | /catalogo/unidades: «Decimales» (entero) sin flechitas |
| `5b-porcentaje-merma-*` | Campo porcentaje «Merma %» de la receta, tipeado «5,5», sin flechitas |

Tamaños: `1366` (1366×768) y `390` (390×844), deviceScaleFactor 2; capturas del bloque (formulario) o de la página completa (5).

NO verificado: teclado de celular real (solo viewport emulado). Notas: en 3 y 4 el aviso se dibuja encima de la línea «= 300 g» en la receta (4); en 390 la tabla de unidades se corta a la derecha (comportamiento real de esa pantalla). Los datos de la receta (0,22 kg bife, etc.) no se ven en estas capturas.
