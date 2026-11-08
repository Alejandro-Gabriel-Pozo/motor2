# Ficha de receta: cómo está HOY (main)

Capturas de la pantalla real del sistema (build de producción, `next start`) sobre una base local descartable. Producción no se tocó.

## Archivos
- `1-listado-recetas-375/1280.png`: Catálogo → Recetas.
- `2-ficha-receta-375/1280.png`: `/catalogo/recetas/[productoId]` completa (ficha técnica, ingredientes, método de preparación, receta por sucursal).
- `3-historial-versiones-375/1280.png`: `/historial`, versión 2 vigente y versión 1.
- `4-impresion-ficha-receta-A4.pdf` y `4-impresion-A4-pagina-1/2.png`: lo que sale con Ctrl+P (`emulateMedia print`, A4, 2 páginas).

## Datos de maqueta (declarados)
- Reales (leídos en una pasada anterior): sucursales, usuario gerente@maqueta.local (admin), productos de carta y precios.
- **Inventados para esta captura**: la receta «Milanesa con papas fritas» (PV, $18.000), sus 6 ingredientes y cantidades (bife de nalga 0,2 kg, huevo, pan rallado, aceite, papa, sal), 3 pasos, ficha técnica, equipamiento, merma, y el sustituto «Peceto» del bife. Producción tiene 0 recetas.
- La v2 salió editando por pantalla la cantidad del bife (0,2 → 0,22 kg).
- Las MP se dejaron disponibles en todas las sucursales (si no, la pantalla muestra avisos de «no disponible en…» por mi siembra).

## Hallazgo de impresión
- Código: no hay botón «Imprimir» ni PDF de recetas. `window.print`/`data-imprimible` solo existen en la comanda/ticket del POS (`src/app/(pos)/mesas/[mesaId]/imprimir.tsx`) y en la carta pública (`navegacion-carta.tsx`). En `globals.css` hay `@media print` solo para la carta y los tickets; ninguno alcanza al catálogo.
- Ctrl+P en la receta (PDF): se imprime el menú lateral y la barra superior (usuario, selector de sucursal, «Salir»), las pestañas (cortadas a la derecha, el chip «Pendiente» queda cortado), y todos los enlaces/botones de edición («Editar», «Quitar», «Subir/Bajar», «+ Agregar», «Crear receta propia…»). El contenido es legible, pero ocupa 2 hojas con un corte feo (la página 2 empieza con un hueco blanco con el menú lateral cortado) y la ficha no tiene un formato pensado para cocina.
