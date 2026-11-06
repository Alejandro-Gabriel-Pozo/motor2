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
| 6 | recetas-produccion | `recetas-produccion.md` | esperando | — | — | — | — | — |
| 7 | acceso-usuarios-permisos-plataforma | `acceso-usuarios-permisos-plataforma.md` | esperando | — | — | — | — | — |
| 8 | reportes-fiscal | `reportes-fiscal.md` | esperando | — | — | — | — | — |
| 9 | ui-y-pruebas | `ui-y-pruebas.md` | esperando | — | — | — | — | — |
