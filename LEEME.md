# Capturas del dinero mostrado (PR #223) — 2026-11-10

Rama temporal: solo PNG y este LEEME (sin `.env`, bases ni dumps).

- `antes-*`: `origin/main` @ 4fb4bb4d. `despues-*`: `origin/alegp/dinero-mostrado-central` @ 73e0ea6c (PR #223).
- Build de producción de cada commit (`next build` + `next start`), contra una base Postgres LOCAL descartable (`motor2_e2e`). No se escribió nada en producción.
- Tamaños: 1366×768 y 390 px de ancho (celular, recortado a los primeros 1700 px de página), escala ×2.
- Pantallas: Reportes › Período (`desde=2026-11-01&hasta=2026-11-09`), Valuación de inventario, Descuentos por cliente (mismo rango), Resumen consolidado, y la carta pública del cliente (`/carta-publica/e2e/oficinas`, página «Postres» tras avanzar 3 páginas).

## De dónde salen los datos
- REALES (producción, leídos en solo lectura): nombres, códigos y PRECIOS DE VENTA de 10 productos del catálogo de la empresa (Café $4.000, Capuccino $8.000, Brownie $10.000, Flan casero $9.000, Hamburguesa completa $26.000, Guiso de lentejas $23.000, Trucha $53.000, Porción de papas fritas $13.000, Jugo Fresli $6.000, Cerveza Corona 710 cc $11.000) y los nombres de sucursal «Oficinas NQNTUR» y «Varvarco».
- SUPUESTOS DE MAQUETA (producción tiene 0 ventas y 0 compras; estos importes NO son datos de la empresa): las compras de Harina 000 (50 kg, $38.750,50), Café en grano (12 kg, $142.800,00) y Bife de chorizo (20 kg, $236.400,75); las cantidades de las ventas de noviembre (en Oficinas NQNTUR: café 42, capuccino 18, hamburguesa 30, trucha 12, brownie 25, Corona 36; en Varvarco: café 31, guiso 14), el cliente «Hotel Manzano» con 10 % de descuento (las ventas de hamburguesa y trucha) y las recetas mínimas (café 0,02 kg, hamburguesa 0,25 kg de bife).
- El usuario de sesión (`e2e-admin@local.test`, rol admin) es el de pruebas. Las secciones de la carta («Cafetería», «Postres», «Platos», «Bebidas») son de maqueta.
- Nota: en Período, «reconstruido/parcial» sale porque las ventas de maqueta no guardan costo congelado.
