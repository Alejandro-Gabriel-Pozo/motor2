# Diseño: compras que no son comida (servicios, consumibles, utensilios, blanquería y equipamiento), 2026-11-03

Estado: **BORRADOR para el dueño. Niveles 1 a 5 de la escalera de diseño completos; niveles 6 a 10 solo como ESBOZO. No se diseña ni se migra ninguna tabla hasta que el dueño confirme los niveles 1 a 5.** Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño, con fecha y fuente), PROPUESTA, PENDIENTE o NO VERIFICADA.

Pedido textual del dueño (2026-11-03): «Planificamos la parte de compras que era los servicios, lo que no es comida, etc. Para poder tener la misma estructura que en MP, pero para equipamiento, utensilios, etc. Hay que poder tener un gráfico y las tablas de relaciones y maquetas antes de implementar código. Si se puede reutilizar algo y cambiar nombre o algo, recordá la idea de no escribir código de más si no es necesario.»

Entregables que acompañan este documento (fuera del repositorio, autocontenidos): el gráfico y las tablas de relaciones (`servicios-y-bienes/relaciones-servicios-y-bienes.html`) y la maqueta navegable (`servicios-y-bienes/maqueta-servicios-y-bienes.html`).

Fuentes leídas (código de `main` en `3836bf97` y planes):
- Diseño de compras aprobado: `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` (rama `alegp/diseno-compras`): factura única con letra + punto de venta (5) + número (8), total con IVA incluido, vínculo proveedor × producto con código y descripción del proveedor en dos campos (§4.bis), ejemplares para corregir (§12), servicios y tipo de proveedor (§13), reporte pendiente (§14).
- `prisma/schema.prisma`, `src/core/catalogo/no-comestibles.ts`, `src/core/reportes/` (`comun.ts`, `periodo-compras.ts`, `costos.ts`, `valuacion.ts`), `src/core/permisos/acciones.ts`, `src/core/modulos/catalogo.ts`, `prisma/migrations/20261016111000_renglon_sin_stock`, `prisma/migrations/20261016114000_permisos_gastos`.
- `docs/diseno-circuito-de-abastecimiento-2026-10-27.md`, `docs/auditoria-circuito-de-abastecimiento-2026-10-27.md`, `docs/diseno-factura-de-proveedor-e3a-2026-10-27.md`.
- `motor2-docs/_planes/`: `plan-unificado-gastos-compras-y-ventas.md` (§1, §6.bis, §6.ter, §6.quinquies, §6.sexies C), `plan-distribucion-de-costos-y-servicios.md`, `grounding-app-main-categorias-servicios-recursos-2026-10-03.md` y su nota, `grounding-dolibarr-activos-fijos.md` (§16, §17) y adendas 1 a 3, `_decisiones-del-dueno-2026-10-06.md` (Actualizaciones 12, 16, 17, 19).
- Datos de producción (informados, no consultados): 0 materias primas, 0 insumos, 0 proveedores, 0 vínculos, 47 productos de venta. **No hay nada que migrar.**

---

## 0. Resumen para el dueño

**La idea en una línea: todo lo físico que se compra entra con la MISMA estructura que la materia prima (insumo → materia prima → lo que dice cada proveedor) y se distingue por el grupo del árbol de insumos donde lo ponés; lo que no es físico (gas, luz, flete, honorarios) es un concepto de gasto, sin stock.** Lo que cambia entre una lavandina, una olla, una sábana y una freidora no es dónde se guarda, sino **cómo sale**: la lavandina se consume, la olla y la sábana se rompen o se gastan (merma con motivo), y la freidora queda en su sector y, más adelante, tendrá su ficha por unidad con amortización (etapa BU).

**Qué se reutiliza (sin cambiar nombres en la base).**
1. **Materia prima** (`Producto` con `tipo = MP`), **insumo** (`Insumo`), **árbol de grupos** (`Grupo`) y **vínculo con el proveedor** (`ProveedorPorProducto`) para consumibles, utensilios, vajilla, blanquería y equipos. Ya existe la convención **«No comestibles»**: un producto cuyo insumo cuelga del grupo «No comestibles» (o de un hijo) queda fuera del costo de comida y del ratio compras/ventas, sin campo nuevo (`src/core/catalogo/no-comestibles.ts:1-12`). Se cuelgan de ahí los grupos «Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería» y «Equipamiento».
2. **Sectores** = `Seccion` (por sucursal, `prisma/schema.prisma:1041`); **mover de sector** = Transferencia; **rotura o baja** = Merma con motivo del catálogo `MotivoMerma` (`:993`); **uso de un consumible** = Consumo con destino `DestinoConsumo` (`:1007`); **contar** = Conteo físico. Todo eso solo agrega filas: nada se borra.
3. **Servicios** = `ConceptoDeGasto` (`:3097`) + renglón `SIN_STOCK` de la factura (`:2807`, `:2827-2829`) + `ImputacionDeGasto` por sucursal (`:3124`), ya en el esquema y aplicados, **sin ninguna pantalla todavía** (etapa E4 del circuito de abastecimiento).
4. **Tipo de proveedor** = `Proveedor.ofreceProductos` y `ofreceServicios` (`:649-650`): decide qué líneas admite la factura (§13 del diseño de compras).

**Qué se puede usar ya, sin código ni migración (etapa SB0): consumibles, utensilios, vajilla, blanquería y equipos**, cargando grupos, insumos, materias primas, secciones y motivos desde las pantallas de Catálogo y Stock que ya existen, y comprando con la Compra de hoy. **Servicios** necesita la etapa E4 (código, sin migración). **La ficha por unidad con amortización** (etapa BU) necesita tablas nuevas: **REQUIERE AUTORIZACIÓN EXPRESA** y no se pide ahora.

**Preguntas para vos (§11): cuatro.** Equipos ahora como cantidad por sector (sí/no); utensilios, vajilla y blanquería por lote sin amortizar (sí/no); en la etapa BU, la ficha del equipo nace de la compra con stock (sí/no); y la lista de «qué servicios nos factura» de cada proveedor, calculada de las facturas (sí/no).

---

## 1. Propósito y alcance

| # | Decisión | Estado |
|---|---|---|
| 1.1 | **Propósito.** Que las compras que no son comida se carguen en la misma factura de proveedor que la mercadería, con la misma estructura de catálogo que la materia prima (insumo, materia prima, vínculo con código y descripción del proveedor) para lo físico, y con concepto de gasto para lo que no es físico; que cada cosa quede asignada a una sucursal y, si es física, a un sector; y que una rotura o baja quede registrada sin borrar nada. | CONFIRMADA (pedido del 2026-11-03) |
| 1.2 | **Dentro:** servicios sin stock; consumibles no alimentarios con stock; utensilios y vajilla; blanquería; equipamiento (en esta etapa, como cantidad por sector). Ficha del proveedor con «qué le compramos». Alta de equipo por unidad, asignación a sector y baja **diseñadas en papel** (etapa BU). | PROPUESTA |
| 1.3 | **Fuera por ahora:** amortización y su asiento mensual, cierre de períodos, notas de crédito o débito sobre un bien, venta de un equipo usado (todo etapa BU y CP, ya planificadas el 2026-10-06); centros de costos (E8); cuenta corriente (E9); remito y recepción separada (fuera por el diseño de compras); alta sin factura de equipos previos. | CONFIRMADA la exclusión de equipos previos («costo hundido», `_decisiones-del-dueno-2026-10-06.md`, Actualización 12); el resto PROPUESTA |
| 1.4 | **Servicios que se VENDEN** (noche de alojamiento, spa): fuera; es otra cosa (`nota-grounding-app-main-categorias-servicios-recursos.md` §1). | PROPUESTA |
| 1.5 | **Lo más barato primero** (regla del dueño, 2026-10-27): reutilizar y configurar antes que agregar columnas, y columnas antes que tablas. | CONFIRMADA (regla) |

### 1.6 Necesidad escrita por tipo (regla de poda)

| Tipo | Quién lo pidió y dónde está escrito | Si no hay necesidad |
|---|---|---|
| Servicios | Dueño, 2026-10-05/06 (`plan-unificado` §1.2, §6.bis); diseño de compras §13; pedido del 2026-11-03 | — |
| Consumibles no alimentarios | Dueño, 2026-09-18 (packaging y limpieza fuera del costo de comida: `docs/grounding-reportes-compras-2026-09-18.md` §6, citado en `no-comestibles.ts:4`); pedido del 2026-11-03 («lo que no es comida») | — |
| Utensilios y vajilla | Pedido del 2026-11-03 («utensilios») | — |
| Equipamiento | Pedido del 2026-11-03 («equipamiento»); decisiones de bienes de uso del 2026-10-06 (dos hornos = dos bienes, amortización lineal mensual, mes siguiente) | — |
| Blanquería | Dueño, 2026-10-27 («sábanas y toallas: fuera de Compras; corresponden a activos», `docs/diseno-circuito-de-abastecimiento-2026-10-27.md:8`) | — |
| Amenities, papelería | **No están escritos.** Entran como hijos de «No comestibles» solo si el dueño los nombra; no se crean por defecto | Candidatos a no construir |
| Garantía de equipos | Dueño: «puede esperar» (Actualización 16, #12) | No se construye |
| Número de serie por equipo | No está escrito | Candidato a no construir |

---

## 2. Actores y contexto

| Actor | Qué hace | Permiso existente (clave, archivo:línea) |
|---|---|---|
| Operario o administrador de la sucursal que compra | Carga la factura con líneas de producto y de servicio | `proceso_compra` (`acciones.ts:108`); líneas de servicio: `gasto_registrar` (en la base desde `20261016114000_permisos_gastos`, fuera de `ACCIONES` hasta E4) |
| Quien da de alta el catálogo | Crea insumos y materias primas no alimentarias y las ubica en su grupo | `insumo_alta` (`:223`), `alta_producto` (`:45`), `grupos_familia` (`:48`) |
| Administrador | Árbol de grupos, secciones, motivos de merma y destinos de consumo, conceptos de gasto | `grupos_familia`, `secciones` (`:49`), `motivos_merma` (`:57`), `motivos_destino_consumo` (`:58`), `conceptos_gasto` (base) |
| Encargado del sector | Mueve un utensilio o equipo de sector, registra una rotura, cuenta | `proceso_transferencia` (`:113`), `proceso_merma` (`:114`), `proceso_control` (`:112`) |
| Administrador | Corrige una rotura mal cargada (con un ajuste, registro nuevo) | `proceso_ajuste` (`:111`, piso administrador) |
| Administrador (etapa BU) | Alta de equipo por unidad, baja y anulación de baja | Claves `bien_de_uso_*` planificadas (`grounding-dolibarr-activos-fijos.md` §16): NO existen; se crean con su migración |

Contexto: Argentina (UTC-3); pesos; empresa con varias sucursales (hosterías con restaurante); cada empresa solo ve lo suyo (RLS por `empresaId`) y cada sucursal lo de sus políticas; toda autorización se decide en el servidor.

---

## 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Cargar una factura con líneas de producto (comida o no comida) y de servicio; el tipo del proveedor decide qué líneas admite | E4 + diseño de compras etapa 1 | PROPUESTA (el criterio de §13 del diseño de compras) |
| CU2 | Primera compra de un artículo no alimentario a un proveedor: guardar su código y su descripción | Igual que la materia prima (diseño de compras CU7, I12) | CONFIRMADA (por extensión del mismo vínculo) |
| CU3 | Ver en la ficha del proveedor «qué le compramos»: productos (con su código y descripción) y servicios | SB1 | PROPUESTA |
| CU4 | Usar un consumible (limpieza de habitaciones, descartables del salón) | HOY (Consumo con destino) | HOY |
| CU5 | Asignar un utensilio, blanquería o equipo a un sector, o moverlo de sector | HOY (la compra entra a una sección; Transferencia entre secciones) | HOY |
| CU6 | Registrar una rotura, pérdida o desgaste sin borrar | HOY (Merma con motivo) | HOY |
| CU7 | Corregir una rotura mal cargada | HOY (Ajuste, registro nuevo) | HOY |
| CU8 | Contar utensilios, vajilla y blanquería cada tanto | HOY (Conteo físico y frecuencia de conteo) | HOY |
| CU9 | Ver cuánto se gastó en limpieza, utensilios, blanquería y equipos, aparte de la comida | HOY el total «no comestibles» (`periodo-compras.ts:47`); desglose por grupo en SB1 | PROPUESTA el desglose |
| CU10 | Alta de un equipo como bien de uso, una ficha por unidad, desde la compra | Etapa BU | PROPUESTA (forma) sobre CONFIRMADA (un bien por unidad) |
| CU11 | Baja de un equipo (rotura, venta, robo) y anulación de la baja | Etapa BU | PROPUESTA |

---

## 4. Conceptos y ciclo de vida

### 4.1 Taxonomía mínima (PROPUESTA), probada contra casos reales de una hostería con restaurante

| Tipo | Qué es | Casos | ¿Stock? | Sucursal / sector | ¿Se amortiza? | Cómo sale | Estructura |
|---|---|---|---|---|---|---|---|
| **(a) Servicio** | Algo que se paga y no se guarda | Gas, luz, internet, flete, honorarios del contador, mantenimiento, lavandería tercerizada, fumigación | No | Sucursal (imputación); unidad de negocio en E8 | No | No entra | Concepto de gasto + renglón sin stock |
| **(b) Consumible no alimentario** | Se gasta al usarlo | Lavandina, detergente, rollos de cocina, servilletas, bandejas y bolsas de delivery, film, papel de impresora | Sí | Sucursal y sector | No | Consumo (destino) o como ingrediente de receta (el packaging de delivery) | Insumo + materia prima + vínculo, grupo «Limpieza» o «Descartables y packaging» |
| **(c1) Utensilio y vajilla** | Se usa muchas veces y se rompe o se pierde | Ollas, sartenes, cuchillos, tablas, platos, copas, cubiertos | Sí, por cantidad | Sucursal y sector (cocina, salón, barra) | No (PROPUESTA; pregunta 2) | Merma con motivo (rotura, pérdida, desgaste) | Igual, grupo «Utensilios y vajilla» |
| **(d) Blanquería** | Textil de uso repetido, en cantidad | Sábanas, toallas, manteles, repasadores | Sí, por cantidad (lote) | Sucursal y sector (ropería, habitaciones) | No (PROPUESTA; pregunta 2) | Merma con motivo (desgaste, mancha, pérdida) | Igual, grupo «Blanquería» |
| **(c2) Equipamiento** | Máquina o mueble que dura años y vale mucho | Freidora, heladera, horno, lavavajillas, cafetera industrial, aire acondicionado | Sí, por cantidad, en esta etapa (pregunta 1) | Sucursal y sector | **Sí, en la etapa BU** (CONFIRMADA la amortización lineal mensual desde el mes siguiente, 2026-10-06) | Hoy: merma (baja). Etapa BU: alta como bien de uso y baja del bien | Igual, grupo «Equipamiento»; en BU, más una ficha por unidad |

Prueba de la taxonomía contra casos dudosos (PROPUESTA):

| Caso | Dónde cae | Por qué |
|---|---|---|
| Flete de una heladera | (a) servicio, concepto «Flete de activos» (tipo INVERSION, sugerido en `plan-unificado` §6.bis) | Se paga y no se guarda; en BU se reparte entre los equipos por valor (CONFIRMADO 2026-10-06) |
| Arreglo de la freidora | (a) servicio, concepto «Mantenimiento» | No suma un objeto nuevo |
| Repuesto (resistencia de la freidora) | (b) consumible si se guarda en depósito; (a) servicio si viene con el arreglo | Sin necesidad escrita de seguir repuestos |
| Bandeja de delivery que va en la receta | (b) consumible, ingrediente de la receta del producto de venta | Ya funciona hoy: una MP cualquiera puede ser ingrediente |
| Juego de 5 ollas | (c1), unidad de compra «juego», unidad de stock «olla», factor 5 | `Producto.factorConversion` (`schema.prisma:373`) |
| Copas que se rompen todas las semanas | (c1), merma motivo «Rotura» | El motivo es catálogo administrable, sin código |
| Equipos que ya estaban antes de motor2 | No se cargan | CONFIRMADA: «costo hundido» (Actualización 12) |
| Lavandería tercerizada de sábanas | (a) servicio | Las sábanas no cambian de dueño |

### 4.2 Conceptos

- **Grupo** (`Grupo`, árbol sin límite de niveles, `schema.prisma:534`): la familia. El grupo raíz «No comestibles» ya tiene significado en los reportes (`no-comestibles.ts:6-8`). Los cinco hijos propuestos son configuración, no código.
- **Insumo** (`Insumo`, `:509`): el concepto genérico («Freidora», «Olla», «Sábana 2 plazas»). Agrupa materias primas equivalentes de distintos proveedores, como hoy con la comida. **Es obligatorio para lo no alimentario**: sin insumo, el producto no tiene grupo y se cuenta como comida (`src/core/reportes/comun.ts:108`).
- **Materia prima** (`Producto` con `tipo = MP`, `:350`): lo concreto que se compra con **nuestro** código y nombre, unidad de stock, unidad de compra y factor, alícuota de IVA de compra (`:396`). En la pantalla se llama **«artículo»** cuando su grupo es no comestible (renombre solo de pantalla, PROPUESTA; la base no cambia).
- **Vínculo proveedor × artículo** (`ProveedorPorProducto`, `:718`): unidad de compra, último precio y lo que dice el proveedor; el diseño de compras §4.bis separa código (`codigoDelProveedor`, columna nueva de SU etapa 2) y descripción (`referenciaProveedor`, `:738`). **No se agrega nada para lo no alimentario.**
- **Sector** (`Seccion`, `:1041`): dónde está la cosa dentro de la sucursal (cocina, salón, barra, ropería, depósito).
- **Concepto de gasto** (`ConceptoDeGasto`, `:3097`): qué servicio se pagó; lleva el tipo de costo por defecto (`COSTO_DE_VENTAS`, `GASTO_OPERATIVO`, `EXTRAORDINARIO`, `INVERSION`, `RESULTADO_FINANCIERO`; CHECK en `20261016111000_renglon_sin_stock/migration.sql:35`).
- **Bien de uso** (etapa BU, NO existe): la ficha de UNA unidad de equipo (código, sector, fecha de alta en uso, valor de origen, amortización, baja). Diseñada en `grounding-dolibarr-activos-fijos.md` §16 y adendas.

### 4.3 Ciclo de vida

- **Consumible:** comprado → en stock en un sector → consumido (Consumo con destino) o usado en una receta → (opcional) contado.
- **Utensilio, vajilla, blanquería:** comprado → en stock en un sector → movido de sector (Transferencia) → roto, perdido o gastado (Merma con motivo). Una rotura mal cargada se corrige con un Ajuste (registro nuevo). Nada se borra.
- **Equipo, etapa actual:** comprado → en stock en un sector («en uso» = está en ese sector) → baja por Merma con motivo.
- **Equipo, etapa BU (PROPUESTA):** comprado → en stock («comprado, sin poner en uso») → **alta como bien de uso**: sale del stock (Consumo con destino «Alta como bien de uso») y nacen N fichas, una por unidad, en la misma operación → en uso en un sector → (cambio de sector del bien) → baja del bien (rotura, venta, robo, desuso) → la baja se puede anular con registro nuevo. Estados derivados, nunca guardados: PENDIENTE, EN_USO, DADO_DE_BAJA, ANULADO (como `grounding-dolibarr-activos-fijos.md` §16).
- **Servicio:** cargado en la factura (renglón sin stock) → imputado a una o varias sucursales → reclasificado (versión nueva, `ReclasificacionRenglon`, `:3154`) si el concepto estaba mal → anulado con la factura.

---

## 5. Reutilizar y renombrar antes que crear: opciones por tipo

Columnas: **Reutiliza** (con archivo y línea), **Cambio**, **Migración**, **Código** (estimado), **Riesgo / qué se pierde**. Toda migración: aditiva y reversible, con `down.sql`, respaldo y ensayo en una rama, **REQUIERE AUTORIZACIÓN EXPRESA**.

### 5.1 (a) Servicios

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA)** | `ConceptoDeGasto` (`:3097`), renglón `SIN_STOCK` (`:2807`, pareo `FacturaProveedorRenglon_pareo_naturaleza_chk`), `ImputacionDeGasto` (`:3124`), `ReclasificacionRenglon` (`:3154`), claves `gasto_*` y módulo `gastos` (`catalogo.ts:37`) | Es la etapa E4 tal como está planificada: ABM de conceptos con «cargar sugeridos», líneas de servicio en la carga de factura, imputación por sucursal; módulo `gastos` a «disponible»; las 7 claves a `ACCIONES` | **Ninguna** | +casos de uso, pantallas y tests de E4 (lo que E4 ya preveía; nada extra por este diseño) | Ninguno nuevo. La lista «qué servicios nos factura» sale de las facturas (pregunta 4) |
| A′ | Además, un servicio como `Producto` MP sin stock | — | — | — | **Descartada**: «un servicio NO es un producto, es un concepto» (`schema.prisma:3093`, decisión del plan); ensuciaría stock y recetas |
| B | Columna en `Proveedor` con los conceptos habituales | Lista fija por proveedor | Aditiva | +ABM | Duplica lo que ya dicen las facturas; sin necesidad escrita → **candidata a no construir** |
| C | Tabla `ProveedorPorConcepto` (análoga a `ProveedorPorProducto`) | Vínculo proveedor × concepto con código del proveedor | Tabla nueva | +escritor, lector, pantalla | Útil solo si los servicios tuvieran código del proveedor (no lo tienen: una factura de gas no trae código de artículo). **No construir** salvo que el dueño lo pida |

### 5.2 (b) Consumibles no alimentarios

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA)** | `Producto` MP + `Insumo` + `Grupo` + `ProveedorPorProducto`; convención «No comestibles» (`no-comestibles.ts`), ya leída por los reportes (`comun.ts:108`, `periodo-compras.ts:47`, `periodo-ratio.ts:57`, `costos.ts:179` y `:309`, `rendimiento-recetas.ts:456`) | Configuración: crear el grupo «No comestibles» y sus hijos «Limpieza» y «Descartables y packaging»; insumos y materias primas colgados ahí; destinos de consumo («Limpieza», «Habitaciones», «Salón») | **Ninguna** | **0 líneas** | (1) Si una materia prima no alimentaria queda sin insumo, se cuenta como comida: aviso en el alta (SB1, sin migración). (2) Mover un insumo a «No comestibles» cambia los ratios pasados (`plan-unificado`, Etapa A, :69): se avisa al mover (SB1) |
| A″ | `CategoriaProducto` (`:554`) «No comestibles» en vez del grupo | — | — | +lectores | **Descartada**: la clasificación ya vive en el grupo; tenerla también en la categoría la guarda en dos lugares (§4.bis del diseño de compras) |
| B | Valor nuevo en el enum `TipoProducto` (`:333`, hoy `MP`/`PV`) | `NC` o similar | `ALTER TYPE ... ADD VALUE`: un enum de Postgres **no se puede achicar** después (no es reversible limpio) | +decenas de `if (tipo === "MP")` a revisar en catálogo, compras, stock, recetas, reportes | Caro, poco reversible y duplica lo que ya dice el grupo |
| C | Tabla propia de consumibles | — | Tabla nueva | Duplicar compras, stock, conteo | **Descartada** |

### 5.3 (c1) Utensilios y vajilla, y (d) blanquería

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA): por lote, en stock** | Lo mismo que 5.2 + `Seccion` (sector), `MotivoMerma` («Rotura», «Pérdida», «Desgaste»), Transferencia entre secciones (`proceso_transferencia`), Conteo físico y `FrecuenciaConteoProducto` (`:1562`), Ajuste para corregir | Configuración: grupos «Utensilios y vajilla» y «Blanquería» bajo «No comestibles»; secciones «Salón», «Barra», «Ropería»; motivos de merma | **Ninguna** | **0 líneas** | Se pierde: identidad de cada pieza (no hace falta: nadie sigue «la copa n.º 37») y amortización (una olla se gasta al comprarla; ver pregunta 2). La valuación de inventario suma estos artículos (`valuacion.ts` no excluye no comestibles): desglose en SB1 |
| B: por unidad | `BienDeUso` de la etapa BU para cada sábana | — | Tablas BU | +alta masiva | **Desaconsejada**: «un bien por unidad no sirve para cientos de sábanas» (`diseno-circuito-de-abastecimiento-2026-10-27.md:28`) |
| C: «lote de bienes» (una ficha por lote con cantidad que baja con cada rotura) | Nada | Tabla de lotes y movimientos de lote | Tablas nuevas | Duplica el Kardex | **Descartada**: es reinventar el stock |

### 5.4 (c2) Equipamiento

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA para ya): cantidad por sector, en stock** | Igual que 5.3, grupo «Equipamiento» | Configuración | **Ninguna** | **0 líneas** | Se pierde hasta la etapa BU: ficha por unidad, amortización, valor contable. Dos freidoras = cantidad 2 en «Cocina». Sin conflicto con «dos hornos, dos bienes» (CONFIRMADA): en BU, una compra de 2 da 2 fichas |
| A1: gasto INVERSION sin stock | Renglón `SIN_STOCK` + concepto «Equipamiento» (tipo `INVERSION`, sugerido en `plan-unificado` §6.bis) | Configuración del concepto (con E4) | Ninguna | 0 extra sobre E4 | Se pierde **la estructura de la materia prima** (no hay producto, ni código del proveedor, ni sector): es justo lo que el dueño pidió. Queda solo para lo que no se quiere seguir. **Candidata a ocultar** si se elige A |
| B: renglón sin stock con producto | Permitir `productoId` en renglones `SIN_STOCK` de tipo INVERSION | Cambiar el CHECK de pareo | Cambio de CHECK (aditivo en lo permitido, pero toca una regla de dinero) | +validaciones | Mezcla las dos naturalezas que hoy están separadas por la base. **No recomendada** |
| **C (etapa BU): ficha por unidad** | El diseño BU0–BU8 ya aprobado en lo funcional (`plan-unificado` §6.quinquies, §6.sexies C; `grounding-dolibarr-activos-fijos.md` §16-§17, adenda 1 §2.B y §5) | `BienDeUso`, `BienDeUsoOrigen`, `AltaDeBienes`, `ParametrosAmortizacionVersion`, `BajaDeBien`, `AmortizacionAsentada`; requiere cierre de períodos (CP) | **Tablas nuevas: REQUIERE AUTORIZACIÓN EXPRESA** | Grande (BU1 a BU8) | Ajuste PROPUESTO al plan BU (pregunta 3): el origen del bien es la **compra con stock** del grupo «Equipamiento» y el alta lo saca del stock, en vez de un renglón sin stock INVERSION. Así el equipo tiene la misma estructura que la materia prima desde la compra |

**Recomendación.** Opción A para (b), (c1), (d) y (c2) ya; opción A de servicios con E4; opción C de equipos como etapa BU, con el ajuste de origen. Motivo: con **cero líneas de código y cero migraciones** el dueño puede empezar a comprar, ubicar, contar y dar de baja todo lo físico con la misma pantalla y la misma estructura que la materia prima; lo único que de verdad no existe (la ficha por unidad con amortización) ya está diseñado y se agrega después sin rehacer lo cargado.

### 5.5 Lo que ya existe con otro nombre (inventario antes de crear)

| Lo que se necesita | Ya existe como | Dónde |
|---|---|---|
| «Tipo de cosa no alimentaria» | Grupo «No comestibles» y sus descendientes | `src/core/catalogo/no-comestibles.ts:6-12` |
| «Artículo / equipo del catálogo» | Materia prima (`Producto` MP) | `schema.prisma:350`, `:358` |
| «Familia del artículo» | Insumo | `:509` |
| «Lo que dice el proveedor del artículo» | `ProveedorPorProducto` (`referenciaProveedor`; `codigoDelProveedor` en la etapa 2 del diseño de compras) | `:718`, `:738` |
| «Sector de la sucursal» | Sección | `:1041` |
| «Mover de sector» | Transferencia entre secciones | `Proceso.TRANSFERENCIA` (`:975`), `acciones.ts:113` |
| «Rotura / baja sin borrar» | Merma con motivo administrable | `Proceso.MERMA`, `MotivoMerma` (`:993`), `acciones.ts:114` |
| «Corregir una rotura» | Ajuste | `acciones.ts:111` |
| «Uso de un consumible» | Consumo con destino administrable | `DestinoConsumo` (`:1007`), `acciones.ts:110` |
| «Inventario periódico» | Conteo físico + frecuencia | `ConteoFisico` (`:1440`), `FrecuenciaConteoProducto` (`:1562`) |
| «Servicio» | Concepto de gasto + renglón sin stock + imputación | `:3097`, `:2807`, `:3124` |
| «Inversión» como tipo de costo | `INVERSION` | CHECK en `20261016111000_renglon_sin_stock/migration.sql:35` |
| «Proveedor de productos / servicios» | `ofreceProductos` / `ofreceServicios` | `:649-650` (ninguna pantalla los lee: `grep` en `src/` sin resultados) |
| «Módulo de gastos» | `gastos` («Gastos y servicios», en desarrollo) | `catalogo.ts:37`. El plan lo llamaba `servicios` y `servicio_*`: **vale el código** (`diseno-circuito-de-abastecimiento` §3.2) |
| «Bien de uso» | **No existe** en el código ni en el esquema (`grep` sin resultados); sí en los planes | `grounding-dolibarr-activos-fijos.md` §16 |

---

## 6. La misma estructura que la materia prima (PROPUESTA)

```
Grupo (árbol)                Insumo (concepto)        Materia prima / artículo         Vínculo proveedor × artículo
No comestibles               «Freidora»               MP_a1b2c3 Freidora 2 canastos    Gastronómica Patagonia: FR-2C-TK
 └ Equipamiento  ─────────▶                  ─────▶   unidad stock: unidad      ─────▶ «FREIDORA IND. 2 CANASTOS TEKNIK 220V»
                                                      alícuota compra: 21 %            unidad de compra: unidad
```

### 6.1 De quién es cada dato y dónde vive (cada dato en un solo lugar)

| Dato | De quién es | Dónde vive | ¿Se copia? |
|---|---|---|---|
| Familia (equipamiento, utensilios, blanquería, limpieza…) | del insumo | `Insumo.grupoId` → `Grupo` | No: la materia prima lo lee de su insumo |
| Si cuenta como comida | derivado del grupo | Nada: se calcula (`clasificarGruposNoComestibles`) | No |
| Nuestro código y nombre | del artículo | `Producto.codigo`, `Producto.nombre` | No |
| Unidad de stock, unidad de compra, factor | del artículo | `Producto` (`:368-373`) | No |
| Código y descripción del proveedor | del par proveedor × artículo | `ProveedorPorProducto` (dos campos, diseño de compras §4.bis) | No |
| Último precio | caché derivada | `ProveedorPorProducto.precioUnitario` | Ya existe |
| Cantidad e importe de cada compra | de la factura | renglón `MERCADERIA` + `MovimientoStock` | No |
| Sector donde está | del movimiento | `MovimientoStock.seccionId` (saldo por sección) | No |
| Concepto del servicio, tipo de costo | del renglón (copia del concepto al cargar, a propósito) | renglón `SIN_STOCK` | Sí, por diseño (`schema.prisma:2826`): cambiar el concepto después no cambia lo cargado |
| Cuánto le tocó a cada sucursal (servicio) | de la imputación | `ImputacionDeGasto.importe` | No |
| (BU) Valor de origen de cada equipo | de la ficha | `BienDeUsoOrigen.importe` (futuro) | No: se reparte una vez con `repartirImporte` (`src/core/moneda.ts`) |

### 6.2 Ejemplo (TODOS LOS DATOS SON INVENTADOS para ilustrar; hoy producción no tiene ningún proveedor ni materia prima)

| Grupo | Insumo | Nuestro código (MP) | Nuestro nombre | Proveedor (ejemplo) | Código del proveedor | Descripción del proveedor | Unidad de compra → stock |
|---|---|---|---|---|---|---|---|
| Equipamiento | Freidora | MP_a1b2c3 | Freidora 2 canastos | Gastronómica Patagonia | FR-2C-TK | FREIDORA IND. 2 CANASTOS TEKNIK 220V | unidad → unidad |
| Utensilios y vajilla | Olla | MP_d4e5f6 | Olla acero inox. 24 cm | Bazar Central | OL-ACX-5 | JGO OLLAS ACERO INOX X5 PZS | juego → olla (factor 5) |
| Utensilios y vajilla | Plato playo | MP_0a9b8c | Plato playo 27 cm blanco | Bazar Central | PL-27-BC | PLATO PLAYO PORCELANA 27CM CJ X24 | caja → plato (factor 24) |
| Blanquería | Sábana 2 plazas | MP_77e1f0 | Sábana 2 plazas 180 hilos blanca | Blanquería del Sur | SAB2P180B | SABANA 2P 180H BCA | docena → sábana (factor 12) |
| Limpieza | Lavandina | MP_5c3d2e | Lavandina 5 L | Distribuidora Andina | LAV-5000 | LAVANDINA CONCENTRADA BIDON 5LT | bidón → bidón |

| Proveedor (ejemplo) | Ofrece productos | Ofrece servicios | Concepto | Tipo de costo |
|---|---|---|---|---|
| Camuzzi Gas del Sur | No | Sí | Gas | GASTO_OPERATIVO |
| Ferretería del Sur | Sí | Sí | Flete de activos | INVERSION |

---

## 7. Invariantes y políticas

| # | Invariante | Estado |
|---|---|---|
| I1 | Todo lo que se compra entra por una factura de proveedor con número único en la empresa (letra + punto de venta de 5 + número de 8) | CONFIRMADA (diseño de compras I1-I3) |
| I2 | El importe de cada línea es el total pagado con IVA incluido, en pesos; el total de la factura es la suma de las líneas, al centavo | CONFIRMADA (diseño de compras I8, 2026-11-03) |
| I3 | Lo físico (consumibles, utensilios, vajilla, blanquería, equipos) es materia prima con insumo en un grupo; lo no físico es concepto de gasto. Nunca un servicio como producto ni un objeto como concepto | PROPUESTA (el primer tramo); CONFIRMADA la parte «un servicio no es un producto» (plan unificado) |
| I4 | Un artículo no alimentario tiene insumo, y ese insumo cuelga de «No comestibles» o de un descendiente; si no, cuenta como comida | HOY (`comun.ts:108`); el aviso al dar de alta es PROPUESTA (SB1) |
| I5 | El tipo del proveedor decide qué líneas admite la factura: solo productos, solo servicios o ambos. Si el proveedor no tiene ninguna marca de lo que se quiere cargar, se ofrece marcarla con confirmación | PROPUESTA (diseño de compras §13) |
| I6 | Lo no alimentario no entra en el costo de comida ni en el ratio compras/ventas, y sí en el «total gastado» con su total aparte | HOY (`periodo-compras.ts:46-47`, `periodo-ratio.ts:57`, `costos.ts:179`) |
| I7 | Nada se borra: rotura, pérdida, desgaste y baja son registros nuevos (Merma); corregir es otro registro (Ajuste); en BU la baja se anula con registro nuevo | HOY / CONFIRMADA (trazabilidad) |
| I8 | Una rotura no puede dejar el stock del sector negativo sin aviso | HOY con las reglas de stock vigentes (NO VERIFICADO para cada camino: se revisa en SB1) |
| I9 | Primera compra de un artículo a un proveedor: código y descripción del proveedor obligatorios | CONFIRMADA (diseño de compras I12) |
| I10 | Equipos que ya estaban antes de motor2 no se cargan | CONFIRMADA (Actualización 12) |
| I11 | (BU) Un bien por unidad: una compra de 2 freidoras da 2 fichas; el importe se reparte exacto | CONFIRMADA (Actualización 12: «dos hornos, dos bienes») |
| I12 | (BU) Amortización lineal mensual, residual cero por defecto, desde el mes siguiente al de alta en uso | CONFIRMADA (Actualización 12 y 16 #7; adenda 3 §1) |
| I13 | (BU) Un mes cerrado bloquea compras, gastos, notas y amortización | CONFIRMADA (Actualización 16 #6: «Todo») |
| I14 | (BU) Anular la factura de un equipo se rechaza si hay un bien vigente que nació de ella | CONFIRMADA (plan unificado §6.sexies C) |
| I15 | Descuento por pronto pago: concepto aparte («descuento obtenido», tipo `RESULTADO_FINANCIERO`), no baja el costo del equipo ni del artículo | CONFIRMADA (Actualización 16 #10, adenda 3) |
| I16 | Flete de un equipo: servicio «Flete de activos»; en BU se reparte entre los equipos por valor | CONFIRMADA (Actualización 12) |
| I17 | Toda acción que guarda pide confirmación explícita | CONFIRMADA (diseño de compras I11) |
| I18 | Aislamiento: cada empresa ve lo suyo; cada sucursal sus secciones, su stock y sus imputaciones | HOY (RLS) |

### 7.1 «¿Qué pasa si…?» por comando

**Cargar factura con líneas de producto y de servicio (CU1)**

| Situación | Qué pasa |
|---|---|
| Repetición | Clave de reintento obligatoria y número único: una sola factura (diseño de compras §5.3) |
| Concurrencia | Dos personas cargan el mismo número: la segunda recibe «ya está cargada» (índice único) |
| Tiempo | Fecha de emisión ≤ hoy en hora argentina; en BU, un mes cerrado manda la carga al primer día abierto mostrando las dos fechas (Actualización 16) |
| Incertidumbre | Sin respuesta, reintentar con la misma clave es seguro |
| Reintento | Misma clave = mismo resultado y mismo mensaje |
| Error parcial | Cabecera, renglones de producto y de servicio, stock, imputaciones y auditoría en una transacción: todo o nada |
| Datos faltantes | Sin insumo en un artículo no alimentario: avisa y ofrece elegirlo (no se inventa); sin concepto en una línea de servicio: no guarda; sin sección: no guarda |
| Cambio de permisos | Se revisa en el servidor: `proceso_compra` para productos, `gasto_registrar` para servicios; si perdió uno, la línea de ese tipo se rechaza y no se guarda nada |

**Registrar rotura, pérdida o desgaste (Merma, CU6)**

| Situación | Qué pasa |
|---|---|
| Repetición | Clave de reintento: una sola merma (E1 del circuito de abastecimiento) |
| Concurrencia | Dos roturas del último plato a la vez: las reglas de saldo de hoy deciden (I8, NO VERIFICADO caso por caso) |
| Tiempo | Fecha ≤ hoy; en BU, mes cerrado bloquea |
| Incertidumbre | Reintentar con la misma clave |
| Reintento | Idem |
| Error parcial | Una transacción |
| Datos faltantes | Sin motivo: no guarda |
| Cambio de permisos | `proceso_merma` en la sucursal, revisado en el servidor |

**Mover de sector (Transferencia, CU5)**

| Situación | Qué pasa |
|---|---|
| Repetición / reintento | Clave de reintento: un solo movimiento |
| Concurrencia | Dos traslados del mismo equipo: el segundo falla si no hay saldo |
| Tiempo | Fecha ≤ hoy |
| Incertidumbre | Reintentar con la misma clave |
| Error parcial | Salida y entrada en la misma transacción |
| Datos faltantes | Sin sector destino: no guarda |
| Cambio de permisos | `proceso_transferencia` en la sucursal |

**(BU, esbozo) Alta de equipo como bien de uso (CU10) y baja (CU11)**

| Situación | Alta | Baja |
|---|---|---|
| Repetición | Clave de reintento en `AltaDeBienes`: una sola alta | Un solo registro de baja vigente por bien (índice único parcial) |
| Concurrencia | Dos altas de la misma compra: la suma de orígenes no supera lo comprado (SERIALIZABLE) | Dos bajas del mismo bien: gana una |
| Tiempo | Mes cerrado: no se da de alta en ese mes; la amortización empieza el mes siguiente al de alta en uso | Mes cerrado: la baja va al primer día abierto |
| Incertidumbre | Reintentar con la misma clave | Idem |
| Reintento | Misma clave = mismo resultado | Idem |
| Error parcial | Salida de stock + N fichas + orígenes + auditoría: todo o nada | Baja + corte del plan: todo o nada |
| Datos faltantes | Sin vida útil: la ficha queda «pendiente de completar» y no amortiza hasta tenerla (PROPUESTA) | Sin motivo: no guarda |
| Cambio de permisos | `bien_de_uso_registrar` (futura) | `bien_de_uso_baja` (futura); anular la baja, `bien_de_uso_anular` |

---

## 8. Etapas, de lo más barato a lo más grande

| Etapa | Nombre | Qué se puede usar | Código | Migración |
|---|---|---|---|---|
| **SB0** | **Configurar lo no alimentario** | Ya: grupo «No comestibles» con hijos «Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería», «Equipamiento»; insumos y artículos; secciones; motivos de merma y destinos de consumo. Comprar con la Compra de hoy; ubicar, mover, contar, romper | **Ninguno** | **Ninguna** |
| SB1 | Ajustes chicos de pantalla y lectura | Aviso «sin insumo cuenta como comida» en el alta; aviso al mover un insumo a «No comestibles»; desglose del total «no comestibles» por grupo hijo en compras y en valuación; ficha del proveedor «qué le compramos»; la palabra «artículo» en vez de «materia prima» cuando el grupo es no comestible | Chico (lecturas y pantalla) | Ninguna |
| E4 | Servicios en la misma factura | Conceptos de gasto con «cargar sugeridos», líneas de servicio, imputación por sucursal, tipo de proveedor que decide las líneas | Mediano (ya planificado) | **Ninguna** (tablas aplicadas) |
| (compras, etapa 2) | Código del proveedor en su propio campo | Buscar por código exacto también para artículos | — | La pide el diseño de compras, no este. Aditiva, **REQUIERE AUTORIZACIÓN EXPRESA** |
| CP | Cierre de períodos | Requisito de BU | Mediano | Tabla nueva, **REQUIERE AUTORIZACIÓN EXPRESA** |
| BU | Bienes de uso | Ficha por unidad desde la compra, sector, amortización, baja y anulación de baja | Grande (BU0-BU8) | Tablas nuevas, **REQUIERE AUTORIZACIÓN EXPRESA**, una por una |

**Migraciones que pide ESTE diseño ahora: ninguna.**

---

## 9. Escalera de producto N0 a N5 (lo que ve el cliente, PROPUESTA)

| Peldaño | Qué ve | Etapa |
|---|---|---|
| N0 | Lo no alimentario se anota fuera del sistema | (antes) |
| N1 | Consumibles, utensilios, blanquería y equipos como artículos con stock, por sector, con roturas registradas | SB0 |
| N2 | Servicios en la misma factura, imputados a cada sucursal | E4 |
| N3 | Ficha del proveedor «qué le compramos» y totales por familia | SB1 |
| N4 | Equipos con ficha por unidad, alta en uso y baja anulable | BU2-BU7 |
| N5 | Amortización mensual asentada al cerrar el mes | BU8 + CP |

**Peldaño que sigue: N1 (solo configuración).** Formalidad y detalle son ejes separados: un cliente puede quedarse en N1 con equipos como cantidad y no subir nunca a N4. Lo cargado en N1 no se rompe al subir: en N4 el alta toma el equipo del stock. Lo que falta (vida útil, sector) se muestra «pendiente de completar», nunca se inventa.

---

## 10. Niveles 6 a 10 (ESBOZO; nada se diseña a fondo hasta que el dueño confirme 1 a 5)

**6. Historia y persistencia.** SB0, SB1 y E4: sin tablas nuevas. BU: las de `grounding-dolibarr-activos-fijos.md` §16 y adenda 1 §5, con un cambio PROPUESTO (pregunta 3): `BienDeUsoOrigen` apunta al movimiento de stock del alta (o al renglón `MERCADERIA` de la compra) en vez de a un renglón `SIN_STOCK` INVERSION, y la regla «la clasificación vigente es INVERSION» pasa a ser «el artículo es del grupo Equipamiento». Todo solo agrega; el estado se calcula.

**7. Atomicidad y concurrencia.** El molde de E3a: SERIALIZABLE con reintento, `FOR UPDATE` sobre la cabecera, claves de reintento únicas globales (ADR-028), índices únicos como árbitros. El alta de bienes (salida de stock + fichas) y la baja (baja + corte del plan) son una transacción cada una.

**8. Acceso e interfaces.** Sin claves nuevas en SB0, SB1 y E4: `proceso_compra`, `alta_producto`, `insumo_alta`, `grupos_familia`, `secciones`, `motivos_merma`, `motivos_destino_consumo`, `proceso_transferencia`, `proceso_merma`, `proceso_ajuste`, `proceso_control`, `proveedores`, `proveedor_alta` y las `gasto_*` (E4). BU: módulo `bienes_de_uso` (requiere `gastos`, no `servicios`: vale el nombre del código) y claves `bien_de_uso_*`, con su migración.

**9. Consultas y experiencia.** La carga de factura es la del diseño de compras (pasos: cabecera, líneas, sucursales, pago, confirmar); cada línea dice si es producto o servicio según el proveedor; un producto muestra su familia («Equipamiento», «Blanquería»…) leída de su grupo. Ver la maqueta.

**10. Pruebas, migración y operación.**

*Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock (regla del dueño, 2026-10-28):*

| Dimensión | Valores | Qué cambia |
|---|---|---|
| Tipo de proveedor | productos, servicios, ambos | Qué líneas admite (permiso/visibilidad) |
| Naturaleza de la línea | `MERCADERIA`, `SIN_STOCK` | Stock o imputación (stock/dinero) |
| Familia del artículo | comida, sin insumo, «No comestibles» directo, cada hijo | Costo de comida, ratio, total no comestibles, valuación (dinero) |
| Salida | consumo, merma, transferencia, conteo, ajuste, (BU) alta como bien | Stock y gasto del período |
| Permisos de quien carga | `proceso_compra` sí/no × `gasto_registrar` sí/no | Qué puede guardar |
| Módulo `gastos` | prendido / apagado | Si aparecen las líneas de servicio |
| Reparto | una sucursal / varias | Imputación y stock por sucursal |
| Tipo de costo del concepto | los 5 valores | Dónde suma el gasto |
| (BU) Estado del bien | pendiente, en uso, dado de baja, anulado | Amortización, anulación de la factura |

*Tabla de reglas esperadas (oráculo, escrita aparte del código, PROPUESTA):*

| Familia | Entra a stock | Costo de comida | Ratio compras/ventas | Total gastado | Total no comestibles | Valuación |
|---|---|---|---|---|---|---|
| Comida (o sin insumo) | Sí | Sí | Sí | Sí | No | Sí |
| Limpieza / Descartables | Sí | No | No | Sí | Sí | Sí (con desglose en SB1) |
| Utensilios y vajilla / Blanquería | Sí | No | No | Sí | Sí | Sí (con desglose) |
| Equipamiento (antes de BU) | Sí | No | No | Sí | Sí | Sí (con desglose) |
| Servicio (renglón sin stock) | No | No | No | En el reporte de gastos (E4), no en el de compras de mercadería | No | No |

Test: recorrer exhaustivamente familia × naturaleza × salida × módulo (son pocas: ~6 × 2 × 6 × 2) contra la tabla; un guardián falla si aparece un grupo raíz con nombre reservado nuevo, un valor nuevo de naturaleza o de tipo de costo sin declararlo en el oráculo. Sin librerías nuevas (`fast-check` ya está en `package.json`).

*Verificación de cada etapa con código:* los 8 comandos de `AGENTS.md` en la misma corrida, todos limpios (`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`), con cada test nuevo probado con su mutación; al final, ratio, `totalGastado`, costo y valuación dan exactamente lo mismo que antes sobre los datos existentes. SB0 no tiene código: se verifica cargando la configuración en una base local y mirando los reportes.

*Operación:* producción tiene 0 materias primas y 0 proveedores: la configuración de SB0 se carga una vez por empresa, desde las pantallas. Nada que migrar.

---

## 11. Preguntas para el dueño (una por tema, solo las que cambian datos, dinero o permisos)

1. **Equipos ahora.** ¿Te alcanza, hasta la etapa de bienes de uso, con saber **cuántos equipos hay en cada sector** (como stock: dos freidoras en «Cocina»), sin ficha por unidad ni amortización? *Recomendación: sí.* Se usa ya, sin código; cuando llegue la etapa BU, cada equipo comprado se convierte en su ficha sin recargar nada.
2. **Utensilios, vajilla y blanquería.** ¿Se manejan **por lote** (cantidad en cada sector, la rotura o el desgaste se registran como merma con motivo) y **sin amortizar** (el gasto es del mes en que se compran)? *Recomendación: sí.* Esto ajusta lo del 2026-10-27 («sábanas y toallas corresponden a activos»): serían bienes que se siguen por cantidad, no fichas por unidad, porque «un bien por unidad no sirve para cientos de sábanas».
3. **Origen de la ficha del equipo (etapa BU).** ¿La ficha del equipo nace de **la compra con stock** (el equipo entra como artículo del grupo «Equipamiento» y al ponerlo en uso sale del stock y nace su ficha), en vez de un renglón de gasto «Inversión» sin producto como decía el plan del 2026-10-06? *Recomendación: sí.* Es lo que le da al equipo la misma estructura que la materia prima (código y descripción del proveedor, sector) y no cambia nada de lo ya decidido sobre amortización.
4. **Servicios en la ficha del proveedor.** ¿Alcanza con que «qué servicios nos factura» se **calcule de sus facturas** (sin una lista fija que alguien tenga que mantener)? *Recomendación: sí.* Una lista fija no tiene necesidad escrita y duplicaría lo que dicen las facturas.

**Lo que asumo (PROPUESTA, una línea cada una):**
- Los cinco grupos hijos se llaman «Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería» y «Equipamiento»; amenities y papelería no se crean hasta que los nombres.
- Dar de alta un artículo no alimentario usa las mismas claves que una materia prima (`alta_producto`, `insumo_alta`); no hay clave nueva.
- La rotura usa `proceso_merma` (operario) y su corrección `proceso_ajuste` (administrador), como hoy.
- En pantalla, una materia prima de un grupo no comestible se llama «artículo»; la base no cambia de nombre.
- El concepto de gasto «Equipamiento» (sugerido en el plan) queda oculto si se confirma la pregunta 1: los equipos van como artículo.
- El número de serie y la garantía de los equipos no se construyen (sin necesidad escrita; garantía: «puede esperar»).

---

## 12. Qué NO está resuelto

Amortización, cierre de períodos y notas sobre bienes (etapas CP y BU, ya decididas en lo funcional); venta de un equipo usado (BU, con el emisor fiscal); centros de costos (E8); repuestos como categoría propia (sin necesidad escrita); I8 caso por caso (si la merma de hoy puede dejar saldo negativo en un sector): NO VERIFICADO, se revisa en SB1.
