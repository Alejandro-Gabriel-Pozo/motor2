# Catálogo de primitivas de negocio de Motor2

Estado: **vivo**. Nace de la auditoría de primitivas e invariantes del 2026-11-12 (PR #236, `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md` y sus anexos A y B), paso 14 del plan, pedido del dueño: «Motor2 debe tener su propio catálogo de primitivas e invariantes». El catálogo de invariantes está en `docs/catalogo-de-invariantes-motor2.md`.

«Primitiva» acá = pieza de negocio con identidad propia que se pide al cargar, se compone de otras y es referenciada por otras. **No confundir** con el cerco `primitivas-de-dominio` (`test/arquitectura/cerco-primitivas-de-dominio.test.ts`), que vigila la validación de importes y porcentajes: mismo nombre, otro concepto.

## Cómo se mantiene

- **Un modelo nuevo de `prisma/schema.prisma` se agrega a la tabla «Modelos por primitiva» de este documento** en el mismo PR, con la primitiva a la que pertenece (o una primitiva nueva, con su detalle). El guardián `test/arquitectura/catalogo-de-primitivas.test.ts` falla si un modelo del esquema no está en la tabla o si la tabla nombra un modelo que ya no existe.
- El detalle de cada primitiva (qué se pide, de qué se compone, qué la referencia, ciclo de vida, dónde vive) está inventariado para las de catálogo, carta, precios, partes, empresa, usuarios y pagos (auditoría 2026-11-12). Para stock, salón, compras, gastos y la consola quedó **pendiente de inventariar a este nivel**: figuran en la tabla de modelos, **NO VERIFICADO el detalle**.
- Este catálogo describe lo que EXISTE en el código; las primitivas que Pedernal tiene y Motor2 no (ficha de «parte», clases de producto, precio vigente por instante, etc.) están en la auditoría y en las etapas del plan.

Convenciones que valen para TODAS (verificadas, anexo A §cabecera): `empresaId` por defecto desde el contexto (`app_empresa_actual()`) + FK compuestas `(empresaId, id)` (95 únicos de ese tipo) + RLS `aislamiento_empresa`; mutación = Server Action fina → guard de formato → caso de uso con ficha `@contract/@idempotency/@transaction` → persistencia; dinero en `Decimal(14,2)`/`(14,4)` con `decimal.js`, `IMPORTE_MAXIMO = 1e12`, máximo 2 decimales, se rechaza (no se redondea); nombres de catálogo con lista de permitidos `^[\p{L}\p{N} \-.,()%&/'_]+$`, 80 caracteres; nada se borra (se desactiva o anula); auditoría por columna en `RegistroAuditoria`.

### Detalle de las primitivas inventariadas

| Primitiva | Qué es | Qué se pide al cargarla | De qué se compone | La referencian | Ciclo de vida | Dónde vive |
|---|---|---|---|---|---|---|
| **Producto** | Fuente de verdad del catálogo (compartido entre sucursales). Solo 2 clases: `MP` y `PV` (enum `TipoProducto`, inmutable). «Semielaborado» = MP con `seProduce`; «base configurable» = `modoDeVenta` | Obligatorio: nombre (≤80, permitidos), tipo, unidad de stock, factor de conversión. Opcional: código (autogenerado), categoría, unidad de compra, insumo, precio (default 0), paso de venta, consignación, observaciones (≤500) | Insumo, presentaciones (apagadas por interruptor), receta, grupos/opciones admitidos | ≥25 tablas (receta, stock, carta, cuenta, factura, precio local…) | Nunca se borra. Baja = apagar disponibilidad por sucursal (bloquea con receta vigente o saldo). El alta **no se audita**; la edición audita por columna salvo nombre, categoría, insumo, observaciones | `schema:353`, `src/core/catalogo/*`, `src/server/actions/catalogo/productos.ts`, `src/app/(app)/catalogo/productos/` |
| Variante de producto | **No existe como entidad.** «Variante» es un tipo de grupo de opciones | — | — | — | — | `src/core/opciones/tipos.ts:14` |
| **Grupo de opciones / Opción / Versión de opción** | «Elemento configurable»: 4 tipos de grupo (`MEDIDA, VARIANTE, INCLUIDA, ADICIONAL`); grupo **compartido entre productos**; versión de opción append-only con diferencia de precio MONTO o PORCENTAJE (puede ser negativa) | Grupo: nombre (único sin distinguir mayúsculas), tipo (inmutable), mínimo 0–10, máximo 1–10, prefijo en carta. Opción: nombre, orden, descripción en carta (≤120) | `ConsumoDeOpcion` (qué insumo suma o reemplaza), `ProductoAdmiteGrupo/Opcion` (admisión por producto con precio propio) | Producto, línea de cuenta (foto congelada), carta | Nunca se borran: se archivan. Versiones y consumos solo se agregan | `schema:3559-3800`, `src/core/opciones/*` |
| **Carta** | **No hay modelo «Carta».** Se arma por sucursal con sección, contenido por producto, ítem agrupado, género, promos y descuento por producto | — | `SeccionCarta` (de la empresa), `ContenidoCartaProducto`, `ItemAgrupadoCarta`, `GeneroCarta`, promos, `TemaCartaSucursal` | Carta pública, POS | Publicada por sucursal (`SucursalPublica.publicada`, nace `false`) | `schema:1840-2260` |
| Sección de carta | Agrupador de la carta | Título, descripción, imagen, orden | — | Contenido de producto, ítems | Se desactiva | `schema:1843-1850` |
| Contenido de carta del producto | Lo que dice la carta de ese producto en esa sucursal | `visibleEnCarta` (nace `false`), sección, `nombreEnCarta` (≤80), descripción (≤500), tags (≤8×30) | — | Carta | Por sucursal; el nombre en carta pasa por estados `pendiente / propio / confirmado igual al interno` | `schema:1880-1900`, `src/core/carta/nombre-en-carta.ts` |
| **Promo** | De la empresa; cada sucursal la prende con `PromoCartaSucursal`. «Toda la sección» es un cupo `SECCION` resuelto en vivo. «Solo salón» filtrado en un único lugar que falla cerrado | Título, descripción, precio, cupos | Cupos y entradas de cupo | Cuenta (copia del título) | Nace `activa=true` y pública (ver D2 en 7.2) | `schema:2018-2200`, `src/core/pos/promo-combo.ts` (en vuelo, PR #230) |
| **Receta / ficha técnica** | Append-only; la vigente es `MAX(version)`; central o por sucursal. La «ficha de cocina» **no es tabla**, es vista derivada | Ingredientes, rendimiento (en cabecera de cada versión) | `RecetaIngrediente` | Producto (PV o MP que se produce), stock | Nunca se pisa | `schema:660-760`, `docs/diseno-ficha-de-cocina-2026-11-08.md` |
| **Precio e historial** | **No hay lista de precios ni vigencia por fecha.** Hay: precio global del producto, precio local por sucursal (capacidad `precio_local`) y descuento por sucursal. El historial es la auditoría genérica (valores como texto). El precio de la línea vendida se congela | Importe 0–1e12, ≤2 decimales | — | Cuenta, carta | Cambio con «precio visto» (control optimista) en producto y local; **la promo no lo tiene** (R1) | `src/core/datos/importe.ts`, `test/arquitectura/cerco-escritores-de-precio-con-visto.test.ts` |
| **Alícuota de IVA** | 8 códigos (`IVA_0 … NO_GRAVADO`), con CHECK en la base. **Sin escritor en `src/`** | — | — | Emisión fiscal | NULL = «sin declarar» | `src/core/fiscal/iva.ts:11` |
| Unidad / Categoría («rubro») | Unidad con magnitud y decimales 0–6, **sin conversión entre unidades**. Rubro y categoría son lo mismo (`CategoriaProducto`) | Nombre | — | Producto | — | `schema:557` |
| **Cliente** | Persona o empresa con descuento fijo en la cuenta del salón. **No distingue persona de empresa** | Nombre (≤80, permitidos), descuento % (0 ≤ % < 100, 2 decimales) | — | `Cuenta`, `Operacion` | Se activa/desactiva; el % se congela en la cuenta al asignarlo | `schema:756`, `src/server/actions/clientes/` |
| **Proveedor** (y «consignante») | Quién nos vende. «Consignante» = Proveedor referenciado por `Producto.proveedorConsignacionId` | Nombre (único sin distinguir mayúsculas, ≤80), CUIT (11 dígitos, prefijo ARCA, módulo 11, único por empresa), contacto ≤120 (texto), teléfono ≤40 (sin formato), correo ≤254 (regex simple), condiciones de pago ≤200, notas ≤500, ofrece productos/servicios | `ProveedorPorProducto`, facturas, `PagoConsignante` | Compras, consignación | Se desactiva. `condicionIva` y `PuntoDeVentaDeProveedor` existen en la base sin escritor | `schema:636` |
| Vínculos entre partes, convenios | **No existen** (solo en `docs/diseno-clientes-convenios-…-2026-10-26.md`) | — | — | — | — | grep sin resultados |
| **Sucursal** | Local. Nombre, activa, `maxMesasAbiertas` (sin uso). **Sin datos fiscales, domicilio, teléfono, correo ni punto de venta** | Nombre | — | Casi todo | Se desactiva; se crea con su primer admin en transacción SERIALIZABLE | `schema:127` |
| **Empresa** (tenant) | Nombre, slug, CUIT (lo confirma la plataforma al activar), zona horaria, moneda fija ARS, estado, `condicionIva` y `llevaIvaDeCompras` (ambos sin escritor en código). **Sin razón social, domicilio ni contacto** | Lo carga la plataforma | — | Todo | Alta por solicitud en la consola `plataforma/` | `schema:2492` |
| **Marca / tema** | No son columnas: `TemaCartaSucursal.valores` (JSON, 64 claves) y `PortalCartaEmpresa.valores` (22 claves). `MARCA_PUBLICA = "Empresa B"` está escrita en el código | Colores, tipografías, tamaños | — | Carta pública | Borrador (`aplicarEnCarta=false`) o publicado | `src/core/carta/tema.ts` |
| **Medios de pago / caja / cobro** | **No existen como entidad.** Solo una lista fija de 5 medios usada para pagar facturas de proveedor. «Cerrar cuenta» vende y descuenta stock pero no cobra. La cabecera `Venta` está en el esquema y nadie la escribe | — | — | — | — | `MEDIOS_DE_PAGO` |
| **Usuarios, roles, permisos** | Lo más maduro: membresía usuario-sucursal con rol por sucursal; matriz `PermisoRol` con 137 claves y pisos de nivel; decisión: membresía → módulo → capacidad de sucursal → rol; RLS por empresa y por sucursal; invitaciones con token hasheado (7 días); 6 invariantes de gobierno; login solo con Google | — | — | Todo | — | `src/core/permisos/*` |


## Modelos por primitiva

Una fila por modelo de `prisma/schema.prisma` (112 modelos, 18 primitivas o grupos). Es la tabla que lee el guardián: la primera columna es el nombre exacto del modelo entre comillas invertidas.

| Modelo | Primitiva |
|---|---|
| `Producto` | Producto |
| `DisponibilidadProducto` | Producto |
| `Presentacion` | Producto |
| `ProveedorPorProducto` | Producto |
| `PrecioLocalProducto` | Producto |
| `StockMinimoProducto` | Producto |
| `SeccionHabitualProducto` | Producto |
| `FrecuenciaConteoProducto` | Producto |
| `DescuentoProductoSucursal` | Producto |
| `Insumo` | Insumo y agrupadores del catálogo |
| `Grupo` | Insumo y agrupadores del catálogo |
| `CategoriaProducto` | Insumo y agrupadores del catálogo |
| `MargenObjetivo` | Insumo y agrupadores del catálogo |
| `Unidad` | Insumo y agrupadores del catálogo |
| `RecetaVersion` | Receta |
| `RecetaSucursal` | Receta |
| `RecetaIngrediente` | Receta |
| `SustitutoRecetaIngrediente` | Receta |
| `RecetaPaso` | Receta |
| `RecetaPasoIngrediente` | Receta |
| `RendimientoLocalIngrediente` | Receta |
| `GrupoDeOpciones` | Opciones de venta |
| `OpcionDeGrupo` | Opciones de venta |
| `VersionDeOpcion` | Opciones de venta |
| `ConsumoDeOpcion` | Opciones de venta |
| `ProductoAdmiteGrupo` | Opciones de venta |
| `ProductoAdmiteOpcion` | Opciones de venta |
| `PrecioLocalDeOpcion` | Opciones de venta |
| `OpcionApagadaEnSucursal` | Opciones de venta |
| `OpcionElegidaEnLinea` | Opciones de venta |
| `GrupoDePrecio` | Combinaciones (retiradas, sin lector ni escritor) |
| `CombinacionDeProducto` | Combinaciones (retiradas, sin lector ni escritor) |
| `PrecioLocalDeCombinacion` | Combinaciones (retiradas, sin lector ni escritor) |
| `RecetaDeCombinacionVersion` | Combinaciones (retiradas, sin lector ni escritor) |
| `RecetaDeCombinacionIngrediente` | Combinaciones (retiradas, sin lector ni escritor) |
| `CombinacionEnLinea` | Combinaciones (retiradas, sin lector ni escritor) |
| `SeccionCarta` | Carta |
| `ContenidoCartaProducto` | Carta |
| `ItemAgrupadoCarta` | Carta |
| `GeneroCarta` | Carta |
| `OpcionItemAgrupadoCarta` | Carta |
| `SucursalPublica` | Carta |
| `TemaCartaSucursal` | Carta |
| `PortalCartaEmpresa` | Carta |
| `PromoCarta` | Promo |
| `PromoCartaSucursal` | Promo |
| `PromoCartaCupo` | Promo |
| `EntradaDeCupo` | Promo |
| `OpcionDeEntradaDeCupo` | Promo |
| `EntradaDelDiaDeCupo` | Promo |
| `PromoCuenta` | Promo |
| `Cliente` | Cliente |
| `Proveedor` | Proveedor y consignación |
| `PagoConsignante` | Proveedor y consignación |
| `PuntoDeVentaDeProveedor` | Proveedor y consignación |
| `Empresa` | Empresa y sucursal |
| `Sucursal` | Empresa y sucursal |
| `ModuloEmpresa` | Empresa y sucursal |
| `User` | Usuarios, roles y permisos |
| `Account` | Usuarios, roles y permisos |
| `Session` | Usuarios, roles y permisos |
| `VerificationToken` | Usuarios, roles y permisos |
| `UsuarioSucursal` | Usuarios, roles y permisos |
| `UsuarioEmpresa` | Usuarios, roles y permisos |
| `Rol` | Usuarios, roles y permisos |
| `Accion` | Usuarios, roles y permisos |
| `PermisoRol` | Usuarios, roles y permisos |
| `CapacidadSucursal` | Usuarios, roles y permisos |
| `Invitacion` | Usuarios, roles y permisos |
| `InvitacionSucursal` | Usuarios, roles y permisos |
| `AdminPlataforma` | Consola de plataforma |
| `CodigoDeIngresoPlataforma` | Consola de plataforma |
| `CodigoDeRecuperacionPlataforma` | Consola de plataforma |
| `SesionPlataforma` | Consola de plataforma |
| `AuditoriaPlataforma` | Consola de plataforma |
| `RegistroAuditoria` | Auditoría |
| `Operacion` | Stock y movimientos |
| `MovimientoStock` | Stock y movimientos |
| `ConteoFisico` | Stock y movimientos |
| `TraspasoSucursal` | Stock y movimientos |
| `Seccion` | Stock y movimientos |
| `MotivoMerma` | Stock y movimientos |
| `DestinoConsumo` | Stock y movimientos |
| `Mesa` | Salón, cuenta y venta |
| `Cuenta` | Salón, cuenta y venta |
| `CuentaItem` | Salón, cuenta y venta |
| `AgregadoDeCuenta` | Salón, cuenta y venta |
| `EjemplarTicket` | Salón, cuenta y venta |
| `Venta` | Salón, cuenta y venta |
| `FacturaProveedor` | Compras (factura de proveedor, pagos y notas de crédito) |
| `FacturaProveedorRenglon` | Compras (factura de proveedor, pagos y notas de crédito) |
| `FacturaProveedorSucursal` | Compras (factura de proveedor, pagos y notas de crédito) |
| `FacturaProveedorPropuesta` | Compras (factura de proveedor, pagos y notas de crédito) |
| `FacturaProveedorPropuestaRenglon` | Compras (factura de proveedor, pagos y notas de crédito) |
| `AnulacionDeFacturaProveedor` | Compras (factura de proveedor, pagos y notas de crédito) |
| `PagoDeFacturaProveedor` | Compras (factura de proveedor, pagos y notas de crédito) |
| `AnulacionDePagoDeFacturaProveedor` | Compras (factura de proveedor, pagos y notas de crédito) |
| `FacturaProveedorTributo` | Compras (factura de proveedor, pagos y notas de crédito) |
| `NotaCreditoProveedor` | Compras (factura de proveedor, pagos y notas de crédito) |
| `NotaCreditoProveedorLinea` | Compras (factura de proveedor, pagos y notas de crédito) |
| `NotaCreditoProveedorImputacion` | Compras (factura de proveedor, pagos y notas de crédito) |
| `NotaCreditoProveedorTributo` | Compras (factura de proveedor, pagos y notas de crédito) |
| `ConceptoDeGasto` | Gastos y centros de costos (sin escritor en src) |
| `ImputacionDeGasto` | Gastos y centros de costos (sin escritor en src) |
| `ReclasificacionRenglon` | Gastos y centros de costos (sin escritor en src) |
| `PlanDeCostos` | Gastos y centros de costos (sin escritor en src) |
| `CentroDeCostos` | Gastos y centros de costos (sin escritor en src) |
| `PlanDeCostosSucursal` | Gastos y centros de costos (sin escritor en src) |
| `DistribucionCostoVersion` | Gastos y centros de costos (sin escritor en src) |
| `DistribucionCostoLinea` | Gastos y centros de costos (sin escritor en src) |
| `IndicePrecio` | Cotizaciones e índices |
| `CotizacionDolar` | Cotizaciones e índices |
