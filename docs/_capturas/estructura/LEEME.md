# Capturas: estructura de pantalla 1366×768 (maqueta, NO se mergea)

PR borrador (rama `alegp/estructura-1366x768`, etapa E-A). Diseño: `docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md`.

**DATOS DE MAQUETA** (producción tiene 0 recetas y 0 ventas; la maqueta no tiene ventas): empresa «Maqueta Gastronomía» en una base local descartable, sucursal Varvarco, «Milanesa con papas fritas» ($18.000) con receta de 6 ingredientes y 3 pasos, 7 grupos de opciones, proveedores (Frigorífico Los Álamos, Fresli S.A., etc.). Usuario gerente@maqueta.local (admin). Son las pantallas REALES del sistema (`next dev`; sin el distintivo de desarrollo). Los reportes sin ventas muestran el filtro y el estado vacío: su alto con datos reales será mayor.

Nombre de archivo: `<antes|despues>-<pantalla>-<tamaño>-<arriba|con-scroll>.png`. «arriba» = recién abierta; «con-scroll» = desplazada 500 px (en el DESPUÉS se ve que el encabezado y el menú quedan fijos y, en Opciones, las acciones «+ Nuevo grupo / Agregar un grupo existente» quedan a la vista).

Pantallas: 1 estructura con pantalla corta (Inicio) · 2 estructura con pantalla larga (Permisos, SIN adaptar: solo recibe el shell) · 3 pestaña Opciones y precio de Milanesa (adaptada) · 4 Receta de Milanesa (adaptada) · 5 reporte con tabla ancha (Rendimiento real de recetas, sin adaptar).
Tamaños: 1366×768 (principal), 1280×720 y 390×844 (celular). Alto en «pantallas de 768 px».

| Pantalla | Tamaño | Alto antes (÷768 px) | Alto después (÷768 px) | Qué se desplaza después |
|---|---|---|---|---|
| 1-estructura-corta-inicio | 1366x768 | 1 | 1 | solo el área de contenido; encabezado y menú fijos |
| 2-estructura-larga-permisos | 1366x768 | 10.86 | 10.79 | solo el área de contenido; encabezado y menú fijos |
| 3-opciones-del-producto-milanesa | 1366x768 | 6.62 | 5.32 | solo el área de contenido; encabezado y menú fijos |
| 4-receta-milanesa | 1366x768 | 1.85 | 1.27 | solo el área de contenido; encabezado y menú fijos |
| 5-reporte-tabla-ancha-rendimiento | 1366x768 | 3.34 | 1.48 | solo el área de contenido; encabezado y menú fijos |
| 1-estructura-corta-inicio | 1280x720 | 0.94 | 0.94 | solo el área de contenido; encabezado y menú fijos |
| 2-estructura-larga-permisos | 1280x720 | 10.88 | 10.81 | solo el área de contenido; encabezado y menú fijos |
| 3-opciones-del-producto-milanesa | 1280x720 | 6.62 | 5.4 | solo el área de contenido; encabezado y menú fijos |
| 4-receta-milanesa | 1280x720 | 1.85 | 1.3 | solo el área de contenido; encabezado y menú fijos |
| 5-reporte-tabla-ancha-rendimiento | 1280x720 | 3.69 | 1.48 | solo el área de contenido; encabezado y menú fijos |
| 1-estructura-corta-inicio | 390x844 | 1.45 | 1.45 | el documento (celular, igual que antes) |
| 2-estructura-larga-permisos | 390x844 | 12.97 | 12.97 | el documento (celular, igual que antes) |
| 3-opciones-del-producto-milanesa | 390x844 | 9.8 | 9.54 | el documento (celular, igual que antes) |
| 4-receta-milanesa | 390x844 | 2.49 | 2.46 | el documento (celular, igual que antes) |
| 5-reporte-tabla-ancha-rendimiento | 390x844 | 6.52 | 6.51 | el documento (celular, igual que antes) |

Lectura honesta: Opciones baja de 6,6 a 5,3 pantallas (las tarjetas de cada grupo son altas por sí mismas: el siguiente paso es plegarlas, etapa E-B/E-E) y Receta de 1,85 a 1,27. La estructura común no achica las pantallas que no se adaptan (2 y 5): solo fija encabezado y menú. En celular no hay mejora de alto ni empeora (el relleno baja de 24 a 16 px; el selector de sucursal pasa a 44 px).
