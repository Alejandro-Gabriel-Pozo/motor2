# ADR-009: Qué significa «no hay fila» en los datos por sucursal

> Redactado el 2026-10-01. Es el ítem 10 de `docs/pendientes-sesion-2026-09-30.md` (unificar la semántica de «sin fila»). Esta primera
> tanda NO cambia comportamiento: documenta lo que el código hace hoy, lo ordena en familias, lo protege con guardianes y deja anotadas las
> diferencias que son inconsistencias para decidirlas aparte. Complementa ADR-008 (quién puede hacer qué); acá se decide qué significa la
> ausencia de un dato por sucursal.

## Contexto

Varias tablas guardan un dato «por sucursal» con una fila opcional: disponibilidad de un producto, precio local, mínimo de stock, descuento,
capacidad, etc. Cada lector tiene que decidir qué pasa cuando la fila NO existe, y hoy esa decisión vive repartida. Las diferencias no son
un error en sí (una capacidad sin fila vale «sí», una disponibilidad sin fila vale «no», y ambas son correctas para su caso), pero sin una
regla escrita es fácil que un lector nuevo invente la semántica contraria y aparezca una inconsistencia que ningún test ve.

## Decisión

Toda tabla por sucursal pertenece a UNA de cinco familias, cada una con un único significado de la ausencia y un único «embudo» (el archivo
donde se resuelve). Un lector no interpreta la ausencia por su cuenta: usa el embudo.

| Familia | Sin fila significa | Modelos (embudo) |
|---|---|---|
| **opt-in** | NO (no disponible / no ofrecida / no publicada) | `DisponibilidadProducto` (`core/catalogo/disponibilidad-producto.ts`), `PromoCartaSucursal` (`core/carta/promo-sucursal.ts`), `SucursalPublica` (`core/carta/publica-consulta.ts`) |
| **override** | vale el valor de la empresa | `PrecioLocalProducto` (`core/catalogo/precio-local.ts`), `RendimientoLocalIngrediente` (`core/catalogo/rendimiento-local.ts`), `TemaCartaSucursal` (`core/carta/publica-consulta.ts`), el `precioLocal` de `PromoCartaSucursal` |
| **ajuste opcional** | no aplica (sin descuento, sin mínimo, sin frecuencia, sin sección habitual) | `DescuentoProductoSucursal` (`core/carta/descuento-producto-consulta.ts`), `StockMinimoProducto` (`core/stock/stock-minimo.ts`), `FrecuenciaConteoProducto` (`core/stock/frecuencia-conteo.ts`), `SeccionHabitualProducto` (`core/stock/seccion-habitual.ts`) |
| **opt-out** | SÍ (habilitado) | `CapacidadSucursal` (`core/permisos/capacidades-sucursal.ts`) |
| **propio** | no aplica: la fila ES el dato de la sucursal (membresía, historia, mesas, secciones de stock) | `UsuarioSucursal`, `RegistroAuditoria`, `PagoConsignante`, `Seccion`, `Operacion`, `ConteoFisico`, `Mesa`, `EjemplarBoleta` |

Las futuras tablas por sucursal ya decididas (receta propia por sucursal, carta propia por sucursal) entran así: la receta propia es
**override** (sin fila propia rige la receta de la empresa, y se puede copiar de otra sucursal); la carta propia es **opt-in** (una sucursal
sin carta propia no muestra nada hasta que se la arma o se la copia).

## Cómo se hace cumplir

- `test/arquitectura/semantica-sin-fila.test.ts`: lee `prisma/schema.prisma` y exige que TODO modelo con `sucursalId` tenga familia, embudo
  existente y motivo en el registro. Un modelo por sucursal nuevo rompe el test hasta que alguien decide su semántica.
- `test/core/semantica-sin-fila.test.ts` y `test/carta/promo-sucursal.test.ts`: caracterizan la ausencia en cada resolver (una familia por
  bloque). Cambiar una semántica los pone en rojo.
- `test/arquitectura/promo-sucursal-en-un-solo-lugar.test.ts`: nadie escribe a mano el filtro de promos por sucursal ni lee
  `PromoCartaSucursal` directo.
- `test/arquitectura/descuento-producto-en-un-solo-lugar.test.ts` y `carta-estructura-lectores-inventariados.test.ts` ya cubren el descuento
  y la estructura de la carta.

## Diferencias por diseño vs. inconsistencias

Por diseño (correctas, no se tocan): la asimetría entre familias de arriba; el `0` es un mínimo de stock real (gana sobre el global); un
precio local deshabilitado equivale a no tenerlo; una fila de sucursal apagada (`activa=false`) equivale a no tener fila.

| # | Inconsistencia | Estado |
|---|---|---|
| R1 | Apagar la capacidad `precio_local` no gatea el `precioLocal` de la promo ni el descuento por producto (sí gatea el precio local de producto). | **Abierta, decide el dueño**: ¿la capacidad apaga también promo y descuento, o son conceptos separados? |
| R2 | `core/reportes/comun.ts` marca `disponible: true` cuando el reporte no trae el mapa de disponibilidad (sin sucursal en contexto), aunque la semántica de disponibilidad es opt-in. | **Abierta, espera respuesta del dueño**: qué debe mostrar un reporte sin sucursal. |
| R3 | `items-agrupados`: el descuento de producto se busca en cualquier sucursal, el precio local solo en la activa. | **Abierta**: se revisa junto con la carta propia por sucursal (carta corrida 2). |
| R4 | Lectores duplicados sin guardián: la prioridad del mínimo (sección sobre global) estaba escrita dos veces y el filtro de «sección habitual vigente» otras dos. | **Resuelta**: `elegirMinimo` (`core/stock/stock-minimo.ts`, usada por `resolverStockMinimo` y `calcularAlertasStock`) y `whereSeccionHabitualVigente` (`core/stock/seccion-habitual.ts`, usada por `cargarHabituales` y `obtenerSeccionHabitualEnSucursal`). Sin cambio de comportamiento. |

## Consecuencias

- La ausencia deja de ser una decisión implícita de cada lector: se consulta el embudo de la familia.
- Un modelo por sucursal nuevo obliga a elegir familia antes de mergear.
- Los embudos de cada familia pueden crecer (p. ej. la capacidad por sucursal) sin tocar a los lectores.
- No cambia el schema ni el comportamiento observable.
