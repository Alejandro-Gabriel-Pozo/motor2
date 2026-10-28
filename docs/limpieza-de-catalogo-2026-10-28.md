# Limpieza del catálogo y las opciones de `stockhneuquen` (2026-10-28)

Pedido del dueño: «hacerme un proceso de limpieza de la base de datos con las opciones creadas y los productos del catálogo, así empiezo de 0 sin ruido». Alcance confirmado por el dueño: borrar productos, opciones y todo lo que cuelga de ellos; **mantener** las secciones de la carta (8), los géneros (2), las unidades (5), las categorías (2), las mesas (incluido el puesto Mostrador), las sucursales, los usuarios, los roles y permisos, los motivos de merma, los destinos de consumo y el historial de auditoría (no se borra).

## Estado antes (lectura de producción, rama `main` de Neon `inventario-api`)
Productos 52; disponibilidad de productos 312; grupos de opciones 11, opciones 31, versiones 47; admisiones de grupo 10 y de opción 33; contenido de carta 17; ítem agrupado 1 (3 opciones); promos 2 (2 cupos, 2 sucursales); cuentas de prueba del POS 3 (8 líneas, 1 promo de cuenta, 2 agregados). Sin datos operativos: 0 movimientos de stock, 0 operaciones, 0 recetas, 0 proveedores, 0 insumos. Sin disparadores que bloqueen el borrado (solo `CuentaItem_opciones_chk`); el rol dueño no tiene RLS forzada.

## Procedimiento
1. Respaldo: rama de Neon `respaldo-pre-limpieza-catalogo-20261028` (`br-still-hall-af3izpcr`).
2. Ensayo en la rama `ensayo-limpieza-catalogo-20261028` (`br-empty-wave-afp4sg0c`): ejecutado el 2026-10-28; la transacción terminó y la verificación interna (que no queden filas de lo borrado y que lo que se conserva no cambie) pasó. Resultado: productos 0, grupos de opciones 0, promos 0, cuentas 0; secciones 8, géneros 2, unidades 5, categorías 2, mesas 2 (1 mostrador), auditoría 522, usuarios por sucursal 16, permisos 226, migraciones 149.
3. Producción: UNA transacción (`lock_timeout` 10 s), en este orden por dependencias: `AgregadoDeCuenta`, `CuentaItem`, `PromoCuenta`, `Cuenta`, `PromoCartaCupo`, `PromoCartaSucursal`, `PromoCarta`, `OpcionItemAgrupadoCarta`, `ItemAgrupadoCarta`, `ContenidoCartaProducto`, `ProductoAdmiteOpcion`, `ProductoAdmiteGrupo`, `VersionDeOpcion`, `OpcionDeGrupo`, `GrupoDeOpciones`, `DisponibilidadProducto`, `Producto`; y un bloque final que revierte todo si queda alguna fila de lo borrado o si cambia el número de filas de lo conservado.
4. Vuelta atrás: restaurar desde la rama de respaldo (los datos borrados solo se recuperan de ahí).

## Estado
Ensayo hecho; producción NO tocada a la fecha de este documento (espera la autorización expresa del dueño).
