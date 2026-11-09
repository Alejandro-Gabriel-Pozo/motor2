# Capturas del estilo de planilla (2026-11-09)

Rama temporal: solo PNG y este LEEME. Nada de `.env`, bases ni dumps. Se borra al aprobarse el PR (rama `alegp/estructura-planilla`, base `alegp/estructura-1366x768`).

Pantallas: `/catalogo/productos` (lista con filtros y acciones por fila) y `/catalogo/opciones` (Biblioteca de opciones).
Tamaños: 1366×768 (escritorio) y 390 px de ancho (celular; recortado a los primeros 1700 px de la página), escala ×2.
`antes-*` = rama base `alegp/estructura-1366x768`; `despues-*` = `alegp/estructura-planilla` (commit f350c70).

## De dónde salen los datos
- Reales de la empresa del dueño, leídos de producción en SOLO LECTURA (Neon, proyecto morning-field-10188884): 47 productos de venta (código, nombre, precio, modo de venta), 25 grupos de opciones (nombre, tipo, prefijo), 27 vínculos producto-grupo, cantidad de opciones activas por grupo, 6 sucursales y la disponibilidad de cada producto (todos en las 6).
- Cargados en una base Postgres LOCAL descartable (`motor2_e2e`); no se escribió nada en producción.
- NO son reales: los NOMBRES de las opciones sueltas (se cargaron como «<grupo> 1», «<grupo> 2»…) porque estas dos pantallas solo muestran cuántas hay; y el usuario de sesión (`e2e-admin@local.test`, rol admin), que es el de pruebas.
- La sucursal activa es «Oficinas NQNTUR».
