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
| **opt-in** | NO (no disponible / no ofrecida / no publicada) | `DisponibilidadProducto` (`core/catalogo/disponibilidad-producto.ts`), `PromoCartaSucursal` (`core/carta/promo-sucursal.ts`), `SucursalPublica` (`server/lecturas/carta/publica.ts`), la estructura de la carta propia: `ContenidoCartaProducto`, `GeneroCarta`, `ItemAgrupadoCarta` y `OpcionItemAgrupadoCarta` (`core/carta/carta-de-sucursal.ts`) |
| **override** | vale el valor de la empresa | `PrecioLocalProducto` (`core/catalogo/precio-local.ts`), `RendimientoLocalIngrediente` (`core/catalogo/rendimiento-local.ts`), `RecetaSucursal` + las versiones propias de `RecetaVersion` (`sucursalId` no nulo; `core/catalogo/recetas-vigentes.ts`), `TemaCartaSucursal` (`server/lecturas/carta/publica.ts`), el `precioLocal` de `PromoCartaSucursal` |
| **ajuste opcional** | no aplica (sin descuento, sin mínimo, sin frecuencia, sin sección habitual) | `DescuentoProductoSucursal` (`server/lecturas/carta/descuentos.ts`), `StockMinimoProducto` (`core/stock/stock-minimo.ts`), `FrecuenciaConteoProducto` (`core/stock/frecuencia-conteo.ts`), `SeccionHabitualProducto` (`core/stock/seccion-habitual.ts`) |
| **opt-out** | SÍ (habilitado) | `CapacidadSucursal` (`core/permisos/capacidades-sucursal.ts`) |
| **propio** | no aplica: la fila ES el dato de la sucursal (membresía, historia, mesas, secciones de stock) | `UsuarioSucursal`, `RegistroAuditoria`, `PagoConsignante`, `Seccion`, `Operacion`, `ConteoFisico`, `Mesa`, `EjemplarBoleta` |

La **receta propia por sucursal** (implementada, R3/R4) es **override**: sin fila `RecetaSucursal` habilitada rige la receta de la empresa (la serie
central de `RecetaVersion`, `sucursalId` nulo, más las calibraciones por sucursal). Con la fila habilitada rige la serie propia de la sucursal
(`RecetaVersion.sucursalId` = la sucursal, numerada por su cuenta), y las calibraciones se conservan pero no aplican. «Volver a la central» deshabilita
la fila — las versiones propias quedan como historial —, y una receta propia se puede copiar de la propia de otra sucursal, con confirmación.
El embudo es `core/catalogo/recetas-vigentes.ts` (el alcance `alcanceDeSucursal` resuelve la efectiva; `ALCANCE_CENTRAL` lee solo la central); el aviso
«la central cambió» sale de `basadaEnVersionId` y nunca se aplica solo. La **carta propia por sucursal** (implementada, 2026-10-03; decisión del dueño, esquema autorizado) es **opt-in**: una sucursal sin carta propia no muestra
nada (ni la carta pública ni el selector del POS) hasta que la arma o la copia de otra. Es de la sucursal el CONTENIDO de cada producto, los GÉNEROS, los
ÍTEMS AGRUPADOS con sus opciones y el ORDEN; las SECCIONES siguen siendo de la empresa, y las promos y los cupos no cambian. Cada lector filtra con
`whereCartaDeSucursal(sucursalId)` (`core/carta/carta-de-sucursal.ts`, devuelve `{ sucursalId }`), y el guardián `carta-estructura-lectores-inventariados`
exige el filtro inline en cada lectura. «Copiar de otra sucursal» (acción `carta_copiar_de_sucursal`, contexto sucursal, nivel administrador, una clave por
acción) solo se ofrece sobre una carta VACÍA y con confirmación: copia contenido, géneros e ítems agrupados remapeando los vínculos entre ellos, deja la
de origen intacta y queda auditada (`CartaSucursal`); después cada sucursal edita la suya. Las claves de edición de la carta (`carta_secciones`,
`carta_generos`, `carta_contenido_producto`, `carta_items_agrupados`) siguen siendo de contexto empresa y sus acciones escriben en la sucursal ACTIVA.
Migración de datos: la carta que ya existía se dejó en UNA sola sucursal por empresa (la publicada más antigua; si no hay, la primera activa; si no, la
primera), las demás empiezan sin carta; una empresa sin sucursales pierde su estructura, que no era alcanzable desde ninguna pantalla.

## Cómo se hace cumplir

- `test/arquitectura/semantica-sin-fila.test.ts`: lee `prisma/schema.prisma` y exige que TODO modelo con `sucursalId` tenga familia, embudo
  existente y motivo en el registro. Un modelo por sucursal nuevo rompe el test hasta que alguien decide su semántica.
- `test/core/semantica-sin-fila.test.ts` y `test/carta/promo-sucursal.test.ts`: caracterizan la ausencia en cada resolver (una familia por
  bloque). Cambiar una semántica los pone en rojo.
- `test/arquitectura/promo-sucursal-en-un-solo-lugar.test.ts`: nadie escribe a mano el filtro de promos por sucursal ni lee
  `PromoCartaSucursal` directo.
- `test/arquitectura/descuento-producto-en-un-solo-lugar.test.ts` y `carta-estructura-lectores-inventariados.test.ts` ya cubren el descuento
  y la estructura de la carta. `test/carta/carta-propia-por-sucursal.test.ts` (escrituras, copia, permisos y aislamiento entre empresas),
  `test/carta/migracion-carta-propia-por-sucursal.test.ts` (los datos existentes) y `test/e2e/carta-propia-copiar.spec.ts` (estado vacío accesible y copia).

## Diferencias por diseño vs. inconsistencias

Por diseño (correctas, no se tocan): la asimetría entre familias de arriba; el `0` es un mínimo de stock real (gana sobre el global); un
precio local deshabilitado equivale a no tenerlo; una fila de sucursal apagada (`activa=false`) equivale a no tener fila.

| # | Inconsistencia | Estado |
|---|---|---|
| R1 | Apagar la capacidad `precio_local` no gatea el `precioLocal` de la promo ni el descuento por producto (sí gatea el precio local de producto). | **Resuelta (2026-10-01, decisión del dueño)**: apagar `precio_local` también apaga el precio local de la promo y el descuento de producto — rige el precio de la empresa / de lista. Un solo embudo, `precioLocalActivoEn` (`server/lecturas/catalogo/precio-local.ts`), lo leen la carta pública, el selector del POS, el alta de la promo, el alta de ítems y el admin; lo configurado no se borra (al reactivar vuelve a regir) y el admin avisa «no rige: precio local apagado». Guardianes: `precio-local-en-un-solo-lugar` y `precio-local-apagado-promo-descuento`. |
| R2 | `core/reportes/comun.ts` marca `disponible: true` cuando el reporte no trae el mapa de disponibilidad (sin sucursal en contexto), aunque la semántica de disponibilidad es opt-in. | **Resuelta (2026-10-01, decisión del dueño)**: sin sucursal, `disponible` es «disponible en ALGUNA sucursal» (`disponibilidadEnAlgunaSucursal`, el mismo criterio que `whereDisponibleEnAlguna`); ya no un `true` fijo. Fijado por `test/reportes/comun-disponible-sin-sucursal.test.ts` y el guardián `disponibilidad-en-un-solo-lugar`. |
| R3 | `items-agrupados`: el descuento de producto se busca en cualquier sucursal, el precio local solo en la activa. | **Por diseño (2026-10-02, decisión del dueño)**: agrupar exige que el producto no tenga descuento en NINGUNA sucursal (un renglón agrupado muestra un solo precio), mientras que el precio local se compara solo en la sucursal activa; si una sucursal tiene un precio local distinto, su carta muestra el MAYOR y el admin de esa sucursal lo avisa (`agrupadosConPreciosDistintos`). Fijado por dos tests de caracterización en `test/carta/acciones-items-agrupados.test.ts`. Con la carta propia por sucursal (2026-10-03) el ítem agrupado es de la sucursal; la regla de los descuentos y el precio local no cambió. |
| R4 | Lectores duplicados sin guardián: la prioridad del mínimo (sección sobre global) estaba escrita dos veces y el filtro de «sección habitual vigente» otras dos. | **Resuelta**: `elegirMinimo` (`core/stock/stock-minimo.ts`, usada por `resolverStockMinimo` y `calcularAlertasStock`) y `whereSeccionHabitualVigente` (`core/stock/seccion-habitual.ts`, usada por `cargarHabituales` y `obtenerSeccionHabitualEnSucursal`). Sin cambio de comportamiento. |

## Consecuencias

- La ausencia deja de ser una decisión implícita de cada lector: se consulta el embudo de la familia.
- Un modelo por sucursal nuevo obliga a elegir familia antes de mergear.
- Los embudos de cada familia pueden crecer (p. ej. la capacidad por sucursal) sin tocar a los lectores.
- La primera tanda no cambió el schema ni el comportamiento observable; la carta propia por sucursal sí cambia ambos (migración `20261002150000_carta_propia_por_sucursal`, con `down.sql`).
- **Nota (2026-10-08, S-07 del plan de endurecimiento de seguridad, fila O.56 de `docs/pureza-integracion.md`):** copiar la receta propia o la carta propia de OTRA sucursal exige que quien copia tenga membresía vigente en la sucursal de origen y el «Ver» de esa clave allá (`receta_sucursal_copiar` para la receta, `carta_ver` para la carta), y que el origen esté activo (`leerOrigenDeCopia`, `src/server/acceso/origen-de-copia.ts`). Antes el origen se buscaba solo por id bajo la RLS de empresa, que separa empresas y no sucursales, y se leía como «por diseño» desde cualquier sucursal de la empresa; con la regla del dueño «dentro de la empresa la sucursal es el punto débil» eso deja de valer. Las listas de lo copiable solo ofrecen las sucursales visibles para el usuario.
