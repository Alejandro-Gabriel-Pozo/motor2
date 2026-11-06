# Catálogo común por módulo — índice (2026-11-06)

**Estado:** en armado. Lo nutren 9 sesiones hijas (solo lectura), una por módulo, cada una en su rama `alegp/catalogo-<modulo>`. Esta sesión auditora copia cada archivo sin reescribirlo y arma la auditoría cruzada en `docs/auditoria-catalogo-comun-2026-11-06.md`. No se implementó ningún cambio al sistema.

Diseño de partida: `docs/diseno-flujos-y-pasos-2026-11-06.md` (rama `alegp/diseno-flujos-y-pasos`, PR #165). Base: main `50c11538`.

| # | Módulo | Archivo | Estado | Flujos declarados | Columnas | Duplicados | Fuentes de verdad múltiples | Deuda sin vencimiento |
|---|---|---|---|---|---|---|---|---|
| 1 | catalogo-y-opciones | `catalogo-y-opciones.md` | recibido (rama `alegp/catalogo-catalogo-y-opciones`) | 5 (F1 producto de catálogo, F2 producto vendible, …) | 14 modelos en alcance; 9 columnas sin declarar | precio lista vs. local escrito a mano en ~5 lugares (verificado por muestreo) | precio en BASE_CONFIGURABLE (5 capas); «cómo se compra» en 3 tablas | 9 ítems, ninguno con fecha |
| 2 | carta-y-promos | `carta-y-promos.md` | esperando | — | — | — | — | — |
| 3 | salon-pos-ticket | `salon-pos-ticket.md` | esperando | — | — | — | — | — |
| 4 | stock-traspasos-consignacion | `stock-traspasos-consignacion.md` | esperando | — | — | — | — | — |
| 5 | compras-proveedores-pagos | `compras-proveedores-pagos.md` | esperando | — | — | — | — | — |
| 6 | recetas-produccion | `recetas-produccion.md` | recibido (rama `alegp/catalogo-recetas-produccion`) | 7 (F1 receta central … F6 rendimiento conciliado; F7 combinaciones RETIRADA) | RecetaIngrediente, RendimientoLocal, Sustituto y MargenObjetivo fuera del guardián | merma `cantidad×(1+merma/100)` en ~8 lugares; `redondearCantidad` ×6 | food cost por defecto en código vs. MargenObjetivo | familia GO-3a retirada sin fecha de retiro |
| 7 | acceso-usuarios-permisos-plataforma | `acceso-usuarios-permisos-plataforma.md` | recibido (rama `alegp/catalogo-acceso-usuarios-permisos-plataforma`) | 7 (F1 alta de empresa … F7 consola de plataforma) | Empresa.estado/dosPaneles, Cliente.activo sin declarar; Sucursal.maxMesasAbiertas muerta | `tieneSucursalActiva` ×2 con criterios distintos; email normalizado a mano ×9 | «puede entrar»: 6 interruptores en 5 niveles | ninguna con fecha |
| 8 | reportes-fiscal | `reportes-fiscal.md` | recibido (rama `alegp/catalogo-reportes-fiscal`) | reportes como lectores (8 familias), sin flujo propio | columnas fiscales de FacturaProveedor sin escritor | margen ×5 definiciones; `aCentavos` ×3; normalizador NFD ×6; `toLocaleString` ×143 | zona horaria: Empresa.zonaHoraria vs. ZONA_ARGENTINA por defecto | ninguna con fecha |
| 9 | ui-y-pruebas | `ui-y-pruebas.md` | esperando | — | — | — | — | — |
