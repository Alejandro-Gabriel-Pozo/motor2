# Capturas: estructura de pantalla 1366×768 (maqueta, NO se mergea)

PR borrador #219 (rama `alegp/estructura-1366x768`, etapa E-A), recapturadas sobre la base ACTUAL de main (con la ficha de cocina, PR #215; la rama se actualizó con main). Diseño: `docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md`. Aclaración: `docs/pendientes-sesion-2026-11-08.md` y la ficha de cocina SÍ están en main (una versión anterior de este LEEME decía lo contrario por una base vieja).

**DATOS DE MAQUETA** (producción tiene 0 recetas y 0 ventas; la maqueta no tiene ventas): empresa «Maqueta Gastronomía» en una base local descartable, sucursal Varvarco, «Milanesa con papas fritas» ($18.000) con receta de 6 ingredientes y 3 pasos, 7 grupos de opciones, proveedores (Frigorífico Los Álamos, Fresli S.A., etc.). Usuario gerente@maqueta.local (admin). Pantallas REALES del sistema (`next dev`, sin el distintivo de desarrollo). Los reportes sin ventas muestran filtro y estado vacío: su alto con datos reales será mayor.

Nombre: `<antes|despues>-<pantalla>-<tamaño>-<arriba|con-scroll>.png`. «arriba» = recién abierta; «con-scroll» = desplazada 500 px (en el DESPUÉS: encabezado y menú fijos y, en Opciones, las acciones «+ Nuevo grupo / Agregar un grupo existente» a la vista).

Pantallas: 1 estructura con pantalla corta (Inicio) · 2 estructura con pantalla larga (Permisos, SIN adaptar: solo recibe el shell) · 3 Opciones y precio de Milanesa (adaptada) · 4 Receta de Milanesa (adaptada; trae el enlace «Ficha de cocina») · 5 reporte con tabla ancha (Rendimiento real de recetas, sin adaptar) · 6 ficha de cocina en pantalla · **7 ficha de cocina IMPRESA (A4, emulación de impresión de Chromium, `...-7-ficha-de-cocina-impresa-A4-hoja-1.png`): ANTES y DESPUÉS son equivalentes y salen COMPLETAS en 1 hoja, sin menú ni encabezado** (prueba de que el shell de alto fijo no cortó la impresión; hay además un e2e que lo exige).
Tamaños: 1366×768 (principal), 1280×720 y 390×844 (celular). Alto en «pantallas de 768 px».

| Pantalla | Tamaño | Alto antes (÷768 px) | Alto después (÷768 px) | Qué se desplaza después |
|---|---|---|---|---|
| 1-estructura-corta-inicio | 1366x768 | 1 | 1 | solo el área de contenido; encabezado y menú fijos |
| 2-estructura-larga-permisos | 1366x768 | 10.88 | 10.81 | solo el área de contenido; encabezado y menú fijos |
| 3-opciones-del-producto-milanesa | 1366x768 | 6.74 | 5.45 | solo el área de contenido; encabezado y menú fijos |
| 4-receta-milanesa | 1366x768 | 1.85 | 1.27 | solo el área de contenido; encabezado y menú fijos |
| 5-reporte-tabla-ancha-rendimiento | 1366x768 | 3.34 | 1.48 | solo el área de contenido; encabezado y menú fijos |
| 6-ficha-de-cocina-en-pantalla | 1366x768 | 1.29 | 1.22 | solo el área de contenido; encabezado y menú fijos |
| 1-estructura-corta-inicio | 1280x720 | 0.94 | 0.94 | solo el área de contenido; encabezado y menú fijos |
| 2-estructura-larga-permisos | 1280x720 | 10.88 | 10.81 | solo el área de contenido; encabezado y menú fijos |
| 3-opciones-del-producto-milanesa | 1280x720 | 6.74 | 5.52 | solo el área de contenido; encabezado y menú fijos |
| 4-receta-milanesa | 1280x720 | 1.85 | 1.3 | solo el área de contenido; encabezado y menú fijos |
| 5-reporte-tabla-ancha-rendimiento | 1280x720 | 3.69 | 1.48 | solo el área de contenido; encabezado y menú fijos |
| 6-ficha-de-cocina-en-pantalla | 1280x720 | 1.29 | 1.22 | solo el área de contenido; encabezado y menú fijos |
| 1-estructura-corta-inicio | 390x844 | 1.45 | 1.45 | el documento (celular, igual que antes) |
| 2-estructura-larga-permisos | 390x844 | 12.99 | 12.97 | el documento (celular, igual que antes) |
| 3-opciones-del-producto-milanesa | 390x844 | 10.03 | 9.77 | el documento (celular, igual que antes) |
| 4-receta-milanesa | 390x844 | 2.52 | 2.52 | el documento (celular, igual que antes) |
| 5-reporte-tabla-ancha-rendimiento | 390x844 | 6.52 | 6.51 | el documento (celular, igual que antes) |
| 6-ficha-de-cocina-en-pantalla | 390x844 | 1.46 | 1.46 | el documento (celular, igual que antes) |

Lectura honesta: Opciones baja de 6,6 a 5,4 pantallas (cada tarjeta de grupo es alta por sí misma: el siguiente paso es plegarlas, E-I/E-B) y Receta de 1,85 a 1,27. Lo que no se adapta (2 y 5) solo gana encabezado y menú fijos. En celular el alto no mejora ni empeora (relleno 24→16 px; el selector de sucursal pasa a 44 px).
