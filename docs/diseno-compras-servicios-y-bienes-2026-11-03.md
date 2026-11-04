# Diseño: compras que no son comida (servicios, consumibles, utensilios, blanquería, mantenimiento y equipamiento), 2026-11-03

Estado: **BORRADOR para el dueño, segunda ronda.** Niveles 1 a 5 de la escalera de diseño completos; niveles 6 a 10 solo como ESBOZO. Ninguna tabla se diseña a fondo ni se migra hasta que el dueño confirme los niveles 1 a 5. Cada decisión lleva su estado: **CONFIRMADA** (dicha por el dueño, con fecha), **PROPUESTA**, **PENDIENTE** o **NO VERIFICADA**.

Pedido textual del dueño (2026-11-03): «Planificamos la parte de compras que era los servicios, lo que no es comida, etc. Para poder tener la misma estructura que en MP, pero para equipamiento, utensilios, etc. Hay que poder tener un gráfico y las tablas de relaciones y maquetas antes de implementar código. Si se puede reutilizar algo y cambiar nombre o algo, recordá la idea de no escribir código de más si no es necesario.»

Segunda ronda (respuestas y pedidos del dueño, 2026-11-03):
- Confirmó tres de las cuatro preguntas de la primera ronda (equipos como cantidad por sector; utensilios, vajilla y blanquería como cantidad; la ficha del equipo nace de la compra con stock). Aclaró la segunda: «lo más simple que permita saber la realidad del negocio»: **cantidades** por sector, no «lotes».
- No entendió la cuarta (servicios en la ficha del proveedor). Propuso: (a) una **lista de servicios genéricos** (electricidad, gas, agua, internet y teléfono, flete, honorarios, mantenimiento, seguridad…), idealmente con «cargar sugeridos»; (b) **más detalle por tipo de servicio**: la electricidad indica el **período** que cubre la factura (mes y año), no solo la fecha; (c) **el servicio del proveedor precargado** al elegirlo.
- Preguntó: «Si son cosas para mantenimiento (tuercas, tornillos, etc.), ¿cómo se harían? ¿Se registra el gasto, el consumo, pero no se rastrea?» Respuesta en §7 (escalera de seguimiento).

Entregables que acompañan este documento (fuera del repositorio, autocontenidos): gráfico y tablas de relaciones (`servicios-y-bienes/relaciones-servicios-y-bienes.html`) y maqueta navegable (`servicios-y-bienes/maqueta-servicios-y-bienes.html`).

Fuentes leídas (código de `main` en `3836bf97` y planes):
- Diseño de compras aprobado: `docs/diseno-compras-factura-unica-y-rechazo-2026-11-03.md` (rama `alegp/diseno-compras`): factura única con letra + punto de venta (5) + número (8), total con IVA incluido, vínculo proveedor × producto con código y descripción del proveedor en dos campos (§4.bis), ejemplares para corregir (§12), servicios y tipo de proveedor (§13), reporte pendiente (§14).
- `prisma/schema.prisma`, `src/core/catalogo/no-comestibles.ts`, `src/core/reportes/` (`comun.ts`, `periodo-compras.ts`, `costos.ts`, `valuacion.ts`), `src/core/permisos/acciones.ts`, `src/core/modulos/catalogo.ts`, `prisma/migrations/20261016111000_renglon_sin_stock`, `prisma/migrations/20261016114000_permisos_gastos`.
- `docs/diseno-circuito-de-abastecimiento-2026-10-27.md`, `docs/auditoria-circuito-de-abastecimiento-2026-10-27.md`, `docs/diseno-factura-de-proveedor-e3a-2026-10-27.md`.
- `motor2-docs/_planes/`: `plan-unificado-gastos-compras-y-ventas.md` (§1, §6.bis, §6.ter, §6.quinquies, §6.sexies C), `plan-distribucion-de-costos-y-servicios.md`, `grounding-app-main-categorias-servicios-recursos-2026-10-03.md` y su nota, `grounding-dolibarr-activos-fijos.md` (§16, §17) y adendas 1 a 3, `_decisiones-del-dueno-2026-10-06.md` (Actualizaciones 12, 16, 17, 19).
- Datos de producción (informados, no consultados): 0 materias primas, 0 insumos, 0 proveedores, 0 vínculos, 47 productos de venta. **No hay nada que migrar.**

---

## 0. Resumen para el dueño

**La idea en una línea.** Todo lo físico que se compra entra con la **misma estructura que la materia prima** (insumo → materia prima → lo que dice cada proveedor) y se distingue por el **grupo** del árbol de insumos donde lo ponés. Lo que no es físico (luz, gas, flete, honorarios) es un **servicio**: un concepto de gasto, sin stock, con su **período** y precargado según el proveedor. La lavandina, la olla, la sábana y la freidora no cambian de lugar en el sistema: cambia **cómo salen**. La lavandina se consume; la olla y la sábana se rompen o se gastan (merma con motivo); la freidora queda en su sector y, en la etapa BU, tendrá su ficha por unidad con amortización.

**Decidido (CONFIRMADO el 2026-11-03).**
1. Los equipos se llevan, hasta la etapa BU, como **cantidad en cada sector** («2 freidoras en Cocina»), sin ficha ni amortización.
2. Utensilios, vajilla y blanquería se llevan como **cantidad en cada sector** («40 toallas en Habitaciones»), sin ficha por unidad, sin amortización y sin vencimiento.
3. En la etapa BU, la ficha del equipo **nace de la compra con stock**.

**Nuevo en esta ronda (PROPUESTA).**
- **Servicios.** Una lista de servicios genéricos con «cargar sugeridos». Cada línea de servicio lleva el **período que cubre** (mes y año de inicio y de fin, para las facturas bimestrales). Al elegir el proveedor se **precarga el servicio de su última factura**: sin tabla nueva.
- **Mantenimiento** (tuercas, tornillos). Una **escalera de seguimiento** por tipo de ítem:
  - **N0, solo gasto.** Se registra la compra y no se sigue nada más.
  - **N1, stock.** Se sabe cuánto hay.
  - **N2, stock y consumo.** Se sabe además quién lo usó.

  Para la ferretería menuda recomiendo **N0**; para limpieza y descartables, **N1**; para repuestos caros o críticos, **N1**. Sin necesidad escrita, se usa el nivel más bajo.

**Qué se reutiliza (sin cambiar nombres en la base).**
- **Lo físico:** materia prima (`Producto` MP), `Insumo`, `Grupo` (convención «No comestibles», `src/core/catalogo/no-comestibles.ts:1-12`) y `ProveedorPorProducto`.
- **Lo que pasa adentro de la sucursal:** sector (`Seccion`), Transferencia, Merma con motivo, Consumo con destino y Conteo físico.
- **Los servicios:** `ConceptoDeGasto`, el renglón `SIN_STOCK` e `ImputacionDeGasto`, más el tipo de proveedor (`ofreceProductos` y `ofreceServicios`).

**Migraciones.**
- **No se pide ninguna ahora.**
- El período del servicio necesita **dos columnas aditivas** en el renglón de la factura: **REQUIERE AUTORIZACIÓN EXPRESA** (pregunta 1). Mientras no se autoricen, el período se puede escribir en la descripción.
- La etapa BU (fichas y amortización) son tablas nuevas, que se piden después.

**Respuestas del dueño del 2026-11-04 (prevalecen sobre el resto del documento donde haya diferencia):**
- **Pregunta 1 (período), CONFIRMADA y SIMPLIFICADA por el dueño:** en vez de dos campos «desde» y «hasta», **un solo mes por línea, por calendario** («atribuirle un mes»). Una columna opcional `mesDeImputacion` (fecha, primer día del mes) en `FacturaProveedorRenglon`, solo en líneas de servicio. Una factura bimestral se carga como **dos líneas**, una por mes (el sistema ya admite varias líneas por factura): es una regla de carga, no de código. Reemplaza a P2 y a E4-P (dos columnas y tres CHECK pasan a una columna y un CHECK de «primer día del mes»). Migración aditiva y reversible: **cubierta por la autorización del 2026-11-03**. No confundir con el mes de **pago**: el consumo de la luz de septiembre es de septiembre aunque se pague en octubre; el flujo de caja usa la fecha de pago (ver `docs/diseno-pagos-y-conciliacion-2026-11-03.md`, etapa X0).
- **Pregunta 2 (servicio precargado), CONFIRMADA:** alcanza con que el sistema proponga el mismo servicio que en la factura anterior de ese proveedor.
- **Pregunta 3 (ferretería y limpieza), PENDIENTE:** el dueño pidió que se la explique de nuevo en simple.

**Preguntas abiertas para vos (§13), estado al 2026-11-04: solo queda la 3.**
1. ¿Autorizás guardar el período del servicio en dos campos?
2. ¿Alcanza con que el sistema proponga el mismo servicio que la última factura de ese proveedor?
3. ¿Confirmás los niveles de seguimiento por defecto?

---

## 1. Propósito y alcance

| # | Decisión | Estado |
|---|---|---|
| 1.1 | **Propósito.** Que las compras que no son comida se carguen en la misma factura de proveedor que la mercadería. Lo físico usa la misma estructura de catálogo que la materia prima (insumo, materia prima, vínculo con código y descripción del proveedor); lo no físico es un concepto de gasto con su período. Cada cosa queda asignada a una sucursal y, si es física, a un sector. Una rotura o baja queda registrada sin borrar nada. Criterio general: **lo más simple que permita saber la realidad del negocio**. | CONFIRMADA (pedidos del 2026-11-03) |
| 1.2 | **Dentro:** servicios sin stock (con período y servicio precargado por proveedor); consumibles no alimentarios; utensilios y vajilla; blanquería; mantenimiento y ferretería (según la escalera N0-N2); equipamiento (como cantidad por sector). La ficha del proveedor dice «qué le compramos». El alta de equipo por unidad, su asignación a sector y su baja quedan **diseñadas en papel** (etapa BU). | PROPUESTA (los tipos los nombró el dueño: CONFIRMADA la lista) |
| 1.3 | **Fuera por ahora:** <br>• Amortización y su asiento mensual, cierre de períodos, notas de crédito o débito sobre un bien, venta de un equipo usado: todo etapa BU y CP, ya planificadas el 2026-10-06. <br>• Centros de costos (E8). <br>• Cuenta corriente (E9). <br>• Remito y recepción separada. <br>• Alta sin factura de equipos previos. <br>• Vencimiento en utensilios y blanquería. | CONFIRMADAS: equipos previos («costo hundido», Actualización 12) y sin vencimiento (2026-11-03). El resto: PROPUESTA |
| 1.4 | **Servicios que se VENDEN** (noche de alojamiento, spa) quedan fuera: son otra cosa (`nota-grounding-app-main-categorias-servicios-recursos.md` §1). | PROPUESTA |
| 1.5 | **Lo más barato primero** (regla del dueño, 2026-10-27): reutilizar y configurar antes que agregar columnas, y columnas antes que tablas. | CONFIRMADA (regla) |

### 1.6 Necesidad escrita por tema (regla de poda)

| Tema | Quién lo pidió y dónde está escrito | Si no hay necesidad |
|---|---|---|
| Servicios | Dueño, 2026-10-05/06 (`plan-unificado` §1.2, §6.bis); diseño de compras §13; pedido del 2026-11-03 | — |
| Lista de servicios genéricos | Dueño, 2026-11-03 (segunda ronda, punto a); «cargar sugeridos» ya estaba en `plan-unificado` §6.bis | — |
| Período del servicio (mes y año) | Dueño, 2026-11-03 (segunda ronda, punto b) | — |
| Servicio precargado por proveedor | Dueño, 2026-11-03 (segunda ronda, punto c) | — |
| Consumibles no alimentarios | Dueño, 2026-09-18 (packaging y limpieza fuera del costo de comida, `docs/grounding-reportes-compras-2026-09-18.md` §6, citado en `no-comestibles.ts:4`); pedido del 2026-11-03 | — |
| Utensilios y vajilla | Pedido del 2026-11-03 | — |
| Blanquería | Dueño, 2026-10-27 (`diseno-circuito-de-abastecimiento-2026-10-27.md:8`); como cantidad: 2026-11-03 | — |
| Mantenimiento y ferretería | Pregunta del dueño, 2026-11-03 | — |
| Equipamiento | Pedido del 2026-11-03; decisiones de bienes de uso del 2026-10-06 | — |
| Obligar el período solo en algunos servicios | No está escrito | Candidato a no construir: el período se ofrece en todas las líneas de servicio |
| Lista mantenida a mano de «servicios de cada proveedor» | No está escrita (el dueño pidió que venga precargado, no una lista) | Candidato a no construir (§6.4) |
| Amenities, papelería | No están escritos | Candidatos a no construir |
| Garantía y número de serie de equipos | Garantía: «puede esperar» (Actualización 16, #12); serie: no escrito | No se construyen |

---

## 2. Actores y contexto

| Actor | Qué hace | Permiso existente (clave, archivo:línea) |
|---|---|---|
| Operario o administrador de la sucursal que compra | Carga la factura con líneas de producto y de servicio | `proceso_compra` (`acciones.ts:108`). Las líneas de servicio usan `gasto_registrar`: está en la base desde `20261016114000_permisos_gastos`, pero fuera de `ACCIONES` hasta E4 |
| Quien da de alta el catálogo | Crea insumos y artículos no alimentarios y los ubica en su grupo | `insumo_alta` (`:223`), `alta_producto` (`:45`), `grupos_familia` (`:48`) |
| Administrador | Mantiene el árbol de grupos, las secciones, los motivos de merma, los destinos de consumo y los conceptos de gasto | `grupos_familia`, `secciones` (`:49`), `motivos_merma` (`:57`), `motivos_destino_consumo` (`:58`), `conceptos_gasto` (en la base) |
| Encargado del sector | Mueve un utensilio o equipo de sector, registra una rotura o un consumo, cuenta | `proceso_transferencia` (`:113`), `proceso_merma` (`:114`), `proceso_consumo` (`:110`), `proceso_control` (`:112`) |
| Administrador | Corrige una rotura mal cargada con un ajuste (registro nuevo) | `proceso_ajuste` (`:111`) |
| Administrador (etapa BU) | Da de alta un equipo por unidad, lo da de baja y anula la baja | Claves `bien_de_uso_*` planificadas: no existen todavía, nacen con su migración |

Contexto: Argentina (UTC-3) y pesos; empresa con varias sucursales (hosterías con restaurante). Cada empresa ve solo lo suyo (RLS por `empresaId`) y cada sucursal, lo que le permiten sus políticas. Toda autorización se decide en el servidor.

---

## 3. Casos de uso

| CU | Caso | Etapa | Estado |
|---|---|---|---|
| CU1 | Cargar una factura con líneas de producto (comida o no comida) y de servicio. El tipo del proveedor decide qué líneas admite | E4 + diseño de compras, etapa 1 | PROPUESTA |
| CU2 | Primera compra de un artículo no alimentario a un proveedor: guardar el código y la descripción del proveedor | Igual que la materia prima | CONFIRMADA (es el mismo vínculo) |
| CU3 | Cargar una factura de servicio con su **período** (mes y año desde/hasta) | E4 + E4-P | PROPUESTA (pedido CONFIRMADO; la forma está en la pregunta 1) |
| CU4 | Elegir un proveedor de servicios y que venga **precargado su servicio** | E4 | PROPUESTA (pregunta 2) |
| CU5 | «Cargar sugeridos»: crear de una vez la lista de servicios genéricos | E4 | CONFIRMADA la lista (2026-11-03); el botón, PROPUESTA |
| CU6 | Ver en la ficha del proveedor «qué le compramos»: productos y servicios | SB1 / E4 | PROPUESTA |
| CU7 | Usar un consumible (limpieza de habitaciones, descartables) | HOY (Consumo con destino) | HOY |
| CU8 | Asignar un utensilio, blanquería o equipo a un sector, o moverlo | HOY (Transferencia entre secciones) | HOY |
| CU9 | Registrar una rotura, pérdida o desgaste sin borrar | HOY (Merma con motivo) | HOY |
| CU10 | Corregir una rotura mal cargada | HOY (Ajuste) | HOY |
| CU11 | Contar utensilios, vajilla y blanquería cada tanto | HOY (Conteo físico) | HOY |
| CU12 | Comprar ferretería de mantenimiento según su nivel de seguimiento (N0, N1 o N2) | N0: E4; N1 y N2: HOY | PROPUESTA (pregunta 3) |
| CU13 | Ver cuánto se gastó en cada familia, aparte de la comida | Total «no comestibles» HOY (`periodo-compras.ts:47`); desglose en SB1 | PROPUESTA el desglose |
| CU14 | Alta de un equipo como bien de uso, una ficha por unidad, desde la compra con stock | Etapa BU | CONFIRMADA |
| CU15 | Baja de un equipo y anulación de la baja | Etapa BU | PROPUESTA |

---

## 4. Conceptos y ciclo de vida

### 4.1 Taxonomía mínima, probada contra casos reales de una hostería con restaurante

| Tipo | Qué es | Casos | ¿Stock? | Sucursal / sector | ¿Se amortiza? | Cómo sale | Estado |
|---|---|---|---|---|---|---|---|
| **(a) Servicio** | Algo que se paga y no se guarda | Electricidad, gas, agua, internet y teléfono, flete, honorarios, mantenimiento, seguridad, lavandería tercerizada | No | Sucursal (imputación); unidad de negocio en E8 | No | No entra | PROPUESTA |
| **(b) Consumible no alimentario** | Se gasta al usarlo | Lavandina, detergente, servilletas, bandejas y bolsas de delivery, film | Sí (N1 por defecto) | Sucursal y sector | No | Consumo con destino, o como ingrediente de receta | PROPUESTA |
| **(c1) Utensilio y vajilla** | Se usa muchas veces; se rompe o se pierde | Ollas, sartenes, cuchillos, platos, copas, cubiertos | Sí, **cantidad por sector** | Sucursal y sector | **No** | Merma con motivo | **CONFIRMADA** (2026-11-03) |
| **(d) Blanquería** | Textil de uso repetido | Sábanas, toallas, manteles, repasadores | Sí, **cantidad por sector** («40 toallas en Habitaciones») | Sucursal y sector | **No**; sin vencimiento | Merma con motivo | **CONFIRMADA** (2026-11-03) |
| **(e) Mantenimiento y ferretería** | Insumos para arreglar | Tornillos, tuercas, cinta, lámparas, repuestos | Según la escalera: N0 sin stock, N1 o N2 con stock | N0: sucursal; N1 y N2: sector | No | N0: no entra; N1: no se registra la salida; N2: Consumo con destino | PROPUESTA (§7) |
| **(c2) Equipamiento** | Máquina o mueble que dura años | Freidora, heladera, horno, lavavajillas, aire acondicionado | Sí, **cantidad por sector**, hasta la etapa BU | Sucursal y sector | **Sí, en la etapa BU** | Hoy: merma (baja). En BU: alta como bien de uso y baja del bien | **CONFIRMADA** (2026-11-03 y 2026-10-06) |

Casos dudosos (PROPUESTA):

| Caso | Dónde cae | Por qué |
|---|---|---|
| Flete de una heladera | (a), concepto «Flete de activos» (INVERSION) | Se paga y no se guarda. En BU se reparte entre los equipos por valor (CONFIRMADO 2026-10-06) |
| Arreglo de la freidora (mano de obra) | (a), concepto «Mantenimiento» | No suma un objeto |
| Caja de tornillos | (e) N0, concepto «Mantenimiento y repuestos» | Barato, no crítico, no falta nunca (§7) |
| Lámparas para las habitaciones | (e) N1 si se quiere saber cuántas quedan; N0 si no | Depende de si faltar es un problema |
| Resistencia de repuesto de la freidora | (e) N1 | Crítica: si falta, para la cocina |
| Juego de 5 ollas | (c1): unidad de compra «juego», unidad de stock «olla», factor 5 | `Producto.factorConversion` (`schema.prisma:373`) |
| Lavandería tercerizada | (a) | Las sábanas no cambian de dueño |
| Equipos anteriores a motor2 | No se cargan | CONFIRMADA («costo hundido») |

### 4.2 Conceptos

- **Grupo** (`Grupo`, árbol sin límite de niveles, `schema.prisma:534`): la familia. El grupo raíz «No comestibles» ya significa algo en los reportes (`no-comestibles.ts:6-8`). Sus hijos («Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería», «Equipamiento» y, solo si se usa N1, «Mantenimiento y repuestos») son configuración, no código.
- **Insumo** (`Insumo`, `:509`): el concepto genérico («Freidora», «Toalla de mano»). En lo no alimentario es **obligatorio**: sin insumo no hay grupo, y el artículo se cuenta como comida (`src/core/reportes/comun.ts:108`).
- **Artículo** = materia prima (`Producto` con `tipo = MP`, `:350`): lo que se compra, con **nuestro** código y nombre, unidad de stock, unidad de compra, factor y alícuota de IVA de compra (`:396`). «Artículo» es solo el nombre en pantalla cuando el grupo es no comestible; la base no cambia (PROPUESTA).
- **Vínculo proveedor × artículo** (`ProveedorPorProducto`, `:718`): lo que dice el proveedor (código y descripción en dos campos, según el diseño de compras §4.bis), la unidad de compra y el último precio. **No se agrega nada para lo no alimentario.**
- **Cantidad por sector**: el saldo de stock de un artículo en una sección (`MovimientoStock.seccionId`, `:1306`). Es lo que el dueño pidió con «40 toallas en Habitaciones». No es un lote ni una ficha.
- **Sector** (`Seccion`, `:1041`): cocina, salón, barra, ropería, habitaciones, depósito.
- **Servicio** = concepto de gasto (`ConceptoDeGasto`, `:3097`): electricidad, gas… Tiene código fijo, nombre y tipo de costo por defecto. Cinco valores, con CHECK en `20261016111000_renglon_sin_stock/migration.sql:35`.
- **Período del servicio** (NUEVO, PROPUESTA): el mes inicial y el mes final que cubre una línea de servicio (septiembre 2026, o septiembre-octubre 2026 si es bimestral). Es **dato de la línea**: una misma factura puede traer dos servicios con períodos distintos. **No cambia el mes en que cuenta el gasto**, que sigue siendo `FacturaProveedor.fecha`, el mismo que usará el cierre de meses (PROPUESTA).
- **Servicio habitual del proveedor** (PROPUESTA): **no se guarda**. Es el concepto de la última línea de servicio de ese proveedor, leído de sus facturas.
- **Nivel de seguimiento** (PROPUESTA): N0, N1 o N2 (§7). Tampoco se guarda en un campo: se deduce de cómo está cargado el ítem. Si es un concepto de gasto, es N0. Si es un artículo, es N1. Si además se registran sus consumos, es N2.
- **Bien de uso** (etapa BU, no existe todavía): la ficha de una unidad de equipo. Nace de la compra con stock (CONFIRMADA el 2026-11-03).

### 4.3 Ciclo de vida

- **Servicio:** se carga en la factura con concepto, período e importe → se imputa a una o varias sucursales → si el concepto estaba mal, se reclasifica (versión nueva, `ReclasificacionRenglon`, `:3154`) → se anula junto con la factura.
- **Consumible (N1):** comprado → en stock en un sector → contado. La diferencia de conteo muestra cuánto se usó. En N2, además se registra cada consumo con su destino.
- **Utensilio, vajilla, blanquería:** comprado → **cantidad** en un sector → movido de sector (Transferencia) → roto, perdido o gastado (Merma con motivo) → contado. Una rotura mal cargada se corrige con un Ajuste. Nada se borra.
- **Mantenimiento N0:** comprado como gasto del mes. Fin.
- **Equipo, hasta BU:** comprado → cantidad en un sector → baja por Merma con motivo.
- **Equipo, etapa BU (CONFIRMADA en su origen):** comprado → en stock («comprado, sin poner en uso») → **alta como bien de uso**: en la misma operación sale del stock (Consumo con destino «Alta como bien de uso») y nacen N fichas, una por unidad → en uso en un sector → baja del bien → la baja se anula con un registro nuevo. El estado se calcula, no se guarda.

---

## 5. Reutilizar y renombrar antes que crear: opciones por tipo

Columnas: **Reutiliza** (con archivo y línea), **Cambio**, **Migración**, **Código** (estimado), **Riesgo / qué se pierde**. Toda migración es aditiva y reversible, con `down.sql`, respaldo y ensayo en una rama, y **REQUIERE AUTORIZACIÓN EXPRESA**.

### 5.1 (a) Servicios: el concepto (el período y el proveedor, en §6)

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA)** | `ConceptoDeGasto` (`:3097`); renglón `SIN_STOCK` (`:2807`, pareo `FacturaProveedorRenglon_pareo_naturaleza_chk`); `ImputacionDeGasto` (`:3124`); `ReclasificacionRenglon` (`:3154`); claves `gasto_*` y módulo `gastos` (`catalogo.ts:37`) | Es la etapa E4 tal como está planificada: ABM de conceptos con «cargar sugeridos» (lista de §6.1), líneas de servicio en la factura, imputación por sucursal | **Ninguna** | Lo que E4 ya preveía | Ninguno nuevo |
| A′ | Un servicio como `Producto` MP sin stock | — | — | — | **Descartada**: «un servicio NO es un producto, es un concepto» (`schema.prisma:3093`) |

### 5.2 (b) Consumibles no alimentarios

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (RECOMENDADA)** | `Producto` MP + `Insumo` + `Grupo` + `ProveedorPorProducto`, con la convención «No comestibles», que ya leen los reportes (`comun.ts:108`, `periodo-compras.ts:47`, `periodo-ratio.ts:57`, `costos.ts:179` y `:309`, `rendimiento-recetas.ts:456`) | Configuración: crear el grupo «No comestibles» con sus hijos; cargar destinos de consumo | **Ninguna** | **0 líneas** | (1) Un artículo sin insumo se cuenta como comida: se avisa en el alta (SB1). (2) Mover un insumo a «No comestibles» cambia los ratios pasados (`plan-unificado`, Etapa A, :69): se avisa (SB1) |
| A″ | `CategoriaProducto` «No comestibles» en lugar del grupo | — | — | — | **Descartada**: la clasificación quedaría en dos lugares |
| B | Un valor nuevo en el enum `TipoProducto` (`:333`) | — | `ALTER TYPE ... ADD VALUE`: un valor de enum en Postgres no se puede quitar después | Revisar decenas de `tipo === "MP"` | Cara y poco reversible |
| C | Tabla propia de consumibles | — | Tabla nueva | Duplicar compras y stock | **Descartada** |

### 5.3 (c1) Utensilios y vajilla, y (d) blanquería

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (CONFIRMADA, 2026-11-03): cantidad por sector, en stock** | Lo de 5.2 + `Seccion`, `MotivoMerma` («Rotura», «Pérdida», «Desgaste»), Transferencia, Conteo físico y `FrecuenciaConteoProducto` (`:1562`), Ajuste para corregir | Configuración: grupos «Utensilios y vajilla» y «Blanquería»; secciones «Habitaciones», «Ropería», «Salón»; motivos de merma | **Ninguna** | **0 líneas** | Se pierde la identidad de cada pieza (no hace falta) y la amortización (decidido: no). La valuación suma estos artículos (`valuacion.ts` no excluye los no comestibles): el desglose va en SB1 |
| B: una ficha por unidad | `BienDeUso` de la etapa BU para cada sábana | — | Tablas BU | Alta masiva | **Descartada**: «un bien por unidad no sirve para cientos de sábanas» |
| C: ficha por grupo de piezas con cantidad propia | Nada | Tabla nueva con sus movimientos | Tablas nuevas | Duplica el Kardex | **Descartada**: reinventa el stock |

### 5.4 (c2) Equipamiento

| Opción | Reutiliza | Cambio | Migración | Código | Riesgo / qué se pierde |
|---|---|---|---|---|---|
| **A (CONFIRMADA, 2026-11-03): cantidad por sector, en stock** | Lo de 5.3, grupo «Equipamiento» | Configuración | **Ninguna** | **0 líneas** | Hasta BU no hay ficha por unidad ni amortización. «Dos hornos, dos bienes» se cumple en BU: una compra de 2 da 2 fichas |
| A1: gasto INVERSION sin stock | Renglón `SIN_STOCK` + concepto «Equipamiento» | Configuración (E4) | Ninguna | 0 extra | Se pierde la estructura de la materia prima. **Candidata a ocultar**: el concepto «Equipamiento» no se ofrece en «cargar sugeridos» |
| B: renglón sin stock con producto | Permitir `productoId` en un renglón `SIN_STOCK` | Cambiar el CHECK de pareo | Cambio de CHECK | Validaciones | Mezcla dos naturalezas que la base hoy separa. **No recomendada** |
| **C (etapa BU, CONFIRMADO el origen): ficha por unidad desde la compra con stock** | Diseño BU0-BU8 (`plan-unificado` §6.quinquies, §6.sexies C; `grounding-dolibarr-activos-fijos.md` §16-§17, adenda 1 §2.B y §5) | `BienDeUso`, `BienDeUsoOrigen` (apunta a la compra con stock, no a un renglón INVERSION), `AltaDeBienes`, `ParametrosAmortizacionVersion`, `BajaDeBien`, `AmortizacionAsentada`. Requiere cierre de períodos (CP) | **Tablas nuevas: REQUIERE AUTORIZACIÓN EXPRESA** | Grande | — |

### 5.5 Lo que ya existe con otro nombre (inventario antes de crear)

| Lo que se necesita | Ya existe como | Dónde |
|---|---|---|
| «Tipo de cosa no alimentaria» | Grupo «No comestibles» y sus descendientes | `src/core/catalogo/no-comestibles.ts:6-12` |
| «Artículo o equipo del catálogo» | Materia prima (`Producto` MP) | `schema.prisma:350`, `:358` |
| «Familia del artículo» | Insumo | `:509` |
| «Lo que dice el proveedor del artículo» | `ProveedorPorProducto` | `:718`, `:738` |
| «Cantidad en un sector» | Saldo de stock por sección | `MovimientoStock.seccionId` (`:1306`) |
| «Mover de sector» | Transferencia entre secciones | `Proceso.TRANSFERENCIA` (`:975`), `acciones.ts:113` |
| «Rotura o baja sin borrar» | Merma con motivo administrable | `MotivoMerma` (`:993`), `acciones.ts:114` |
| «Quién usó el tornillo» (N2) | Consumo con destino administrable | `DestinoConsumo` (`:1007`), `acciones.ts:110` |
| «Servicio» | Concepto de gasto + renglón sin stock + imputación | `:3097`, `:2807`, `:3124` |
| «Lista de servicios genéricos» | «Cargar sugeridos», planificado en E4 | `plan-unificado` §6.bis |
| «Período del servicio» | **No existe.** El renglón tiene `descripcion` (`:2808`), `conceptoGastoId` y `tipoDeCosto` (`:2827-2829`); la cabecera tiene `fecha` (el día del costo, `:2745`) y `fechaComprobante` (la fecha impresa, `:2747`) | — |
| «Servicio del proveedor» | **No existe** una tabla proveedor × concepto. Las facturas del proveedor lo dicen | — |
| «Proveedor de productos o de servicios» | `ofreceProductos` / `ofreceServicios` | `:649-650` (ninguna pantalla los lee todavía) |
| «Bien de uso» | **No existe** en el código; está diseñado en los planes | `grounding-dolibarr-activos-fijos.md` §16 |

---

## 6. Servicios: lista genérica, período y proveedor precargado (segunda ronda)

### 6.1 La lista de servicios genéricos (CONFIRMADA la lista por el dueño, 2026-11-03; el botón, PROPUESTA)

«Cargar sugeridos» (ya previsto en E4) crea en la empresa los conceptos que falten, comparando por código. Es idempotente: si se aprieta dos veces, no duplica (nota del grounding de app-main, A7). Cada empresa después los renombra o desactiva.

| Código | Nombre | Tipo de costo por defecto | Origen |
|---|---|---|---|
| ELECTRICIDAD | Electricidad | GASTO_OPERATIVO | Dueño 2026-11-03 («Luz» en el plan) |
| GAS | Gas | GASTO_OPERATIVO | Dueño 2026-11-03 |
| AGUA | Agua | GASTO_OPERATIVO | Dueño 2026-11-03 |
| INTERNET_TELEFONO | Internet y teléfono | GASTO_OPERATIVO | Dueño 2026-11-03 (el plan tenía «Internet» y «Celular» separados) |
| FLETE_MERCADERIA | Flete de mercadería | COSTO_DE_VENTAS | Plan §6.bis |
| FLETE_ACTIVOS | Flete de activos | INVERSION | Plan §6.bis |
| HONORARIOS | Honorarios | GASTO_OPERATIVO | Dueño 2026-11-03 |
| MANTENIMIENTO | Mantenimiento y repuestos | GASTO_OPERATIVO | Dueño 2026-11-03 + mantenimiento N0 (§7) |
| SEGURIDAD | Seguridad | GASTO_OPERATIVO | Dueño 2026-11-03 |
| SISTEMA | Sistema | GASTO_OPERATIVO | Plan §6.bis |
| TRANSPORTE_PERSONAS | Transporte de personas | GASTO_OPERATIVO | Plan §6.bis |
| CORREO | Correo y encomiendas | GASTO_OPERATIVO | Plan §6.bis |
| EXTRAORDINARIO | Gasto extraordinario | EXTRAORDINARIO | Plan §6.bis |
| DESCUENTO_OBTENIDO | Descuento obtenido | RESULTADO_FINANCIERO | Decisión del 2026-10-06 (#10) |

«Equipamiento» (INVERSION), que figuraba en el plan, **sale de la lista**: los equipos se compran como artículo (CONFIRMADO). Los códigos son PROPUESTA: cumplen el CHECK (mayúsculas, dígitos y guion bajo, hasta 40).

### 6.2 Período: opciones de la más barata a la más cara

| Opción | Qué es | Migración | Código | Qué se pierde / riesgo |
|---|---|---|---|---|
| P0: texto en la descripción | La pantalla tiene dos selectores (mes y año) y escribe «Período 09/2026–10/2026» al principio de `descripcion` | **Ninguna** | Chico | No se puede filtrar ni sumar por período sin leer texto. Si alguien edita la descripción a mano, el período se rompe. Sirve como puente |
| P1: reutilizar `FacturaProveedor.fecha` | Cargar como «día del costo» el primer día del período | Ninguna | Chico | **Descartada.** Mezcla dos cosas: la fecha del costo es una sola por factura y también es la del stock y la del cierre de meses. No admite un período bimestral ni dos servicios con períodos distintos. Además, cargar en un mes ya cerrado manda la factura al primer día abierto |
| **P2 (RECOMENDADA): dos columnas en el renglón** | `periodoDesde` y `periodoHasta` (fecha, siempre el primer día del mes) en `FacturaProveedorRenglon`. CHECK: las dos juntas o ninguna; desde ≤ hasta; solo en renglones `SIN_STOCK`. Opcionales | **Aditiva y reversible (2 columnas nulas + 3 CHECK, sin datos que migrar): REQUIERE AUTORIZACIÓN EXPRESA** | Chico (pantalla, validación, un lector) | Nada. Permite «gasto de luz por mes de consumo». Producción tiene 0 facturas: es el momento más barato |
| P3: período en la cabecera | Las mismas dos columnas en `FacturaProveedor` | Aditiva | Chico | Una factura con dos servicios de distinto período no se puede expresar. No recomendada |
| P4: campos por tipo de servicio | Un formulario configurable por concepto (número de medidor, kWh consumidos…) | Tablas nuevas | Grande | Sin necesidad escrita: **candidata a no construir** |

**Recomendación: P2.** Es lo único que deja **ver la realidad** («cuánto me costó la luz de septiembre») sin leer texto. Son dos columnas opcionales en una tabla que hoy está vacía en producción. Mientras no se autoricen, E4 arranca con P0 y, al llegar P2, los períodos escritos con P0 se pueden pasar a las columnas una vez, leyendo el prefijo fijo que escribió la pantalla. Regla de pantalla (PROPUESTA): el período se ofrece en **toda** línea de servicio y no es obligatorio. «Hasta» arranca igual a «Desde». «Desde» se precarga con el mes siguiente al último período de ese proveedor y concepto (derivado, sin columna). **El período no cambia el mes en que cuenta el gasto** (sigue `FacturaProveedor.fecha`).

### 6.3 Servicio precargado por proveedor: opciones de la más barata a la más cara

| Opción | Qué es | Migración | Código | Qué se pierde / riesgo |
|---|---|---|---|---|
| **S0 (RECOMENDADA): derivado de sus facturas** | Al elegir el proveedor, la línea de servicio nueva viene con el concepto de **la última línea de servicio** de ese proveedor (lectura de renglones `SIN_STOCK` no anulados, ordenados por fecha). Con dos conceptos en su historia, ofrece los dos, el último primero | **Ninguna** | Una lectura y la pantalla | En la **primera** factura de un proveedor no hay nada que precargar: se elige el concepto a mano una vez. Si se reclasifica, vale la clasificación vigente (función única ya prevista) |
| S1: concepto habitual en la ficha | Columna `conceptoGastoHabitualId` en `Proveedor`, que se elige en la ficha | Aditiva: **REQUIERE AUTORIZACIÓN EXPRESA** | Chico | Es un dato más para mantener. Sirve solo para la primera factura, y duplica lo que las facturas ya dicen |
| S2: lista por proveedor | Tabla `ProveedorConcepto` (proveedor × concepto, con orden) | Tabla nueva: **REQUIERE AUTORIZACIÓN EXPRESA** | Mediano (ABM, lector, RLS) | Sin necesidad escrita (el dueño pidió que venga precargado, no una lista). Una factura de luz no trae código de servicio: no hay «lo que dice el proveedor» que guardar. **Candidata a no construir** |

**Recomendación: S0.** Cumple «al elegir el proveedor ya viene su servicio» desde la segunda factura, sin tabla ni dato que mantener: cada factura cargada ya lo dice. Si el dueño quiere que venga precargado **desde la primera** factura, S1 es el paso siguiente, con una columna.

### 6.4 La ficha del proveedor (PROPUESTA)

- **Qué le compramos:** las casillas «productos» y «servicios» (HOY).
- **Productos:** sus vínculos (código y descripción del proveedor, nuestro artículo, familia, unidad de compra, último precio).
- **Servicios:** **calculado de sus facturas**: concepto, último período, última factura, cantidad de facturas e importe total. Sin lista que mantener (S0).

---

## 7. Mantenimiento y ferretería: escalera de seguimiento (respuesta a la pregunta del dueño)

**Respuesta corta:** sí. Para la ferretería menuda (tuercas, tornillos), lo más simple que muestra la realidad es **registrar solo el gasto** y no rastrear nada más. Se sube un escalón solo para lo que lo justifica.

### 7.1 Los tres niveles

| Nivel | Qué se registra | Cómo se carga | Qué se sabe | Qué NO se sabe | Ejemplos |
|---|---|---|---|---|---|
| **N0 · Solo gasto** | La compra, como gasto del mes de la sucursal | Línea de **servicio** con el concepto «Mantenimiento y repuestos», descripción libre («tornillos y tarugos») e importe. Sin stock | Cuánto se gasta por mes y por sucursal en mantenimiento | Cuánto queda ni quién lo usó | Tornillos, tuercas, tarugos, cinta, pegamento, pilas |
| **N1 · Stock** | La compra entra al stock de un sector y se cuenta cada tanto | Línea de **producto**: un artículo del grupo «Mantenimiento y repuestos» (o «Limpieza», etc.) | Cuánto hay en cada sector, cuánto se compró y, con el conteo, cuánto se usó (la diferencia) | En qué se usó cada unidad | Limpieza, descartables, lámparas, repuestos críticos |
| **N2 · Stock + consumo con destino** | Además, cada salida, con su destino | Igual que N1 + un Consumo con destino (catálogo `DestinoConsumo`: «Habitaciones», «Cocina», «Pileta»…) | Lo de N1 y en qué sector u obra se usó | — | Repuestos caros que se quiere cargar a un sector; materiales de una obra |

Notas sobre N2:
- La «obra» se modela como un **destino de consumo**, que es un catálogo administrable (`schema.prisma:1007`). Llevarla a centros de costos queda fuera: ADR-031 no aplica a la mercadería.
- Un reporte que sume los consumos por destino: NO VERIFICADO que exista hoy. Los movimientos se ven en «Período», «Historial de un producto» y «Trazabilidad».

### 7.2 Recomendación por tipo de ítem (PROPUESTA; pregunta 3)

| Ítem | Nivel por defecto | Por qué |
|---|---|---|
| Tornillería y ferretería menuda | **N0** | Barata, no crítica, no se roba ni falta. Contarla cuesta más de lo que vale |
| Limpieza y descartables | **N1** | Se compran seguido y faltar sí molesta. El conteo muestra cuánto se usa sin cargar cada salida |
| Utensilios, vajilla, blanquería, equipos | **N1** (salen por merma con motivo) | Confirmado: cantidades por sector |
| Repuestos caros o críticos (resistencia de la freidora, bomba de la pileta) | **N1** | Lo que importa es **saber si hay uno** antes de que se rompa |
| Repuesto o material que se quiere cargar a un sector u obra | **N2** | Solo si alguien pidió saber «cuánto se gastó en la pileta» |

### 7.3 Reglas para subir de nivel

Se sube un escalón cuando se cumple **al menos una**, y alguien lo pidió por escrito:
1. **Valor:** el ítem es caro (como referencia, que una unidad cueste más que un gasto chico de caja). El umbral exacto lo fija el dueño; no se inventa.
2. **Riesgo:** si falta, se para la operación (cocina, agua caliente, pileta).
3. **Faltantes o pérdidas:** se acabó sin aviso más de una vez, o desaparece.
4. **Pedido de saber dónde se usa:** para N2, alguien quiere el gasto por sector u obra.

**Regla de poda:** sin necesidad escrita, se usa el **nivel más bajo**. Bajar de nivel también vale: es reversible y no borra nada.

### 7.4 Cómo se pasa de un nivel a otro sin perder lo cargado

| Paso | Qué se hace | Qué pasa con lo anterior |
|---|---|---|
| N0 → N1 | Se crea el artículo (insumo en el grupo, artículo, vínculo con el proveedor). Desde ese día, la compra se carga como línea de producto. Lo que hay hoy en el estante se carga con un **conteo inicial** | Los gastos N0 anteriores **quedan como gastos**, no se reinterpretan. El reporte muestra el corte: antes, gasto de mantenimiento; después, compra de no comestibles |
| N1 → N2 | Se crean los destinos de consumo y se empiezan a registrar las salidas | Nada cambia. Lo de antes queda como diferencia de conteo |
| N2 → N1 | Se dejan de registrar las salidas | Nada se borra |
| N1 → N0 | Se marca el artículo como no disponible en la sucursal (`DisponibilidadProducto`, `:492`). Lo que queda en el estante se da de baja con un consumo o un ajuste. Las compras siguientes van como gasto | Nada se borra |

### 7.5 Qué se ve en cada reporte

| Reporte | N0 | N1 | N2 |
|---|---|---|---|
| «Compras registradas» / «Período»: total gastado | **No aparece**: es un gasto, no una compra de mercadería | Aparece | Aparece |
| Total «no comestibles» (y por grupo, en SB1) | No | Sí, en su grupo | Sí, en su grupo |
| Costo de comida y ratio de compras sobre ventas | No | No | No |
| Reporte de gastos (E4), por concepto y por sucursal | **Sí**, en «Mantenimiento y repuestos» | No | No |
| Valuación de inventario | No | Sí (desglosado en SB1) | Sí |
| Conteos, diferencias de ajuste | No | Sí | Sí |
| Consumo por destino | No | No | Sí (los movimientos; un reporte agrupado: NO VERIFICADO) |

**Consecuencia importante (PROPUESTA):** el «total que se fue en no comida» es la suma de dos reportes, el de compras (no comestibles) y el de gastos (E4). Una vista de empresa que los sume va en SB1 y no necesita migración.

---

## 8. La misma estructura que la materia prima

```
Grupo (árbol)                Insumo (concepto)        Artículo (= materia prima)       Vínculo proveedor × artículo
No comestibles               «Freidora»               MP_a1b2c3 Freidora 2 canastos    Gastronómica Patagonia: FR-2C-TK
 └ Equipamiento  ─────────▶                  ─────▶   unidad stock: unidad      ─────▶ «FREIDORA IND. 2 CANASTOS TEKNIK 220V»
```

### 8.1 De quién es cada dato y dónde vive

| Dato | De quién es | Dónde vive | ¿Se copia? |
|---|---|---|---|
| Familia | del insumo | `Insumo.grupoId` → `Grupo` | No |
| Si cuenta como comida | derivado del grupo | Se calcula (`clasificarGruposNoComestibles`) | No |
| Nuestro código y nombre, unidades, factor | del artículo | `Producto` | No |
| Código y descripción del proveedor | del par proveedor × artículo | `ProveedorPorProducto` | No |
| Cantidad e importe de cada compra | de la factura | renglón `MERCADERIA` + `MovimientoStock` | No |
| Cantidad en cada sector | de los movimientos | saldo por `seccionId` | No (se calcula) |
| Concepto del servicio y tipo de costo | del renglón | renglón `SIN_STOCK` | Sí, por diseño (`schema.prisma:2826`) |
| **Período del servicio** | **del renglón** | `periodoDesde` / `periodoHasta` (P2, nuevo) | No |
| **Servicio habitual del proveedor** | **de sus facturas** | No se guarda: se lee del último renglón de servicio (S0) | No |
| Cuánto le tocó a cada sucursal | de la imputación | `ImputacionDeGasto.importe` | No |
| (BU) Valor de origen de cada equipo | de la ficha | `BienDeUsoOrigen.importe` (futuro) | No |

### 8.2 Ejemplo (TODOS LOS DATOS SON INVENTADOS; producción no tiene proveedores ni artículos)

| Grupo | Insumo | Nuestro código | Nuestro nombre | Proveedor (ejemplo) | Código del proveedor | Descripción del proveedor | Compra → stock |
|---|---|---|---|---|---|---|---|
| Equipamiento | Freidora | MP_a1b2c3 | Freidora 2 canastos | Gastronómica Patagonia | FR-2C-TK | FREIDORA IND. 2 CANASTOS TEKNIK 220V | unidad → unidad |
| Utensilios y vajilla | Olla | MP_d4e5f6 | Olla acero inox. 24 cm | Bazar Central | OL-ACX-5 | JGO OLLAS ACERO INOX X5 PZS | juego → olla (×5) |
| Blanquería | Toalla de mano | MP_77e1f0 | Toalla de mano 500 g blanca | Blanquería del Sur | TOA-500-B | TOALLA MANO 500GR BCA | docena → toalla (×12) |
| Limpieza | Lavandina | MP_5c3d2e | Lavandina 5 L | Ferretería del Sur | LAV-5000 | LAVANDINA CONCENTRADA BIDON 5LT | bidón → bidón |
| Mantenimiento y repuestos (N1) | Resistencia freidora | MP_2b7e11 | Resistencia freidora 3000 W | Ferretería del Sur | RES-3000 | RESISTENCIA BLINDADA 3000W | unidad → unidad |

| Proveedor (ejemplo) | Productos | Servicios | Servicio precargado (S0) | Período de su última factura |
|---|---|---|---|---|
| Cooperativa Eléctrica | No | Sí | Electricidad | 09/2026 – 10/2026 (bimestral) |
| Camuzzi Gas del Sur | No | Sí | Gas | 09/2026 |
| Ferretería del Sur | Sí | Sí | Mantenimiento y repuestos (N0: tornillos) | — |

---

## 9. Invariantes y políticas

| # | Invariante | Estado |
|---|---|---|
| I1 | Todo lo que se compra entra por una factura de proveedor con número único en la empresa | CONFIRMADA (diseño de compras I1-I3) |
| I2 | El importe de cada línea es el total pagado con IVA incluido, en pesos; el total de la factura es la suma de las líneas, al centavo | CONFIRMADA (2026-11-03) |
| I3 | Lo físico es artículo (materia prima con insumo en un grupo). Lo no físico, y la ferretería en N0, es concepto de gasto. Un servicio nunca es producto | PROPUESTA; «un servicio no es un producto»: CONFIRMADA (plan unificado) |
| I4 | Un artículo no alimentario tiene un insumo que cuelga de «No comestibles»; si no, cuenta como comida | HOY (`comun.ts:108`); el aviso, PROPUESTA (SB1) |
| I5 | El tipo del proveedor decide qué líneas admite la factura | PROPUESTA (diseño de compras §13) |
| I6 | Lo no alimentario no entra en el costo de comida ni en el ratio, y sí en el total gastado (con su total aparte) | HOY |
| I7 | Utensilios, vajilla, blanquería y equipos (hasta BU) se llevan como **cantidad por sector**: sin ficha, sin amortización, sin vencimiento | **CONFIRMADA** (2026-11-03) |
| I8 | Nada se borra: rotura, pérdida y baja son registros nuevos; corregir es otro registro | HOY / CONFIRMADA |
| I9 | Una rotura no deja el stock del sector en negativo sin aviso | HOY según las reglas vigentes (NO VERIFICADO caso por caso; se revisa en SB1) |
| I10 | Primera compra de un artículo a un proveedor: código y descripción del proveedor, obligatorios | CONFIRMADA (diseño de compras I12) |
| I11 | El período de un servicio es de la línea; si está, desde ≤ hasta, los dos son primeros de mes y solo existen en líneas de servicio | PROPUESTA (P2; pregunta 1) |
| I12 | **El período no cambia el mes en que cuenta el gasto** (manda `FacturaProveedor.fecha`, que es el que usará el cierre de meses) | PROPUESTA |
| I13 | El servicio precargado es una sugerencia: quien carga lo puede cambiar, y no se guarda en ningún lado aparte de la línea | PROPUESTA (S0; pregunta 2) |
| I14 | «Cargar sugeridos» es idempotente: crea solo los conceptos que faltan, comparando por código | PROPUESTA |
| I15 | Ferretería en N0: no hay stock ni consumo; pasar a N1 no reinterpreta los gastos anteriores | PROPUESTA (pregunta 3) |
| I16 | Equipos anteriores a motor2 no se cargan | CONFIRMADA |
| I17 | (BU) Un bien por unidad, que nace de la compra con stock; el importe se reparte exacto | CONFIRMADA (2026-10-06 y 2026-11-03) |
| I18 | (BU) Amortización lineal mensual desde el mes siguiente; un mes cerrado bloquea todo; anular la factura de un equipo se rechaza si tiene un bien vigente | CONFIRMADA (2026-10-06) |
| I19 | Descuento por pronto pago: concepto «Descuento obtenido», no baja el costo | CONFIRMADA (2026-10-06) |
| I20 | Toda acción que guarda pide confirmación explícita | CONFIRMADA |
| I21 | Aislamiento por empresa y sucursal; autorización en el servidor | HOY |

### 9.1 «¿Qué pasa si…?» por comando

**Cargar factura con líneas de producto y de servicio (CU1, CU3, CU4)**

| Situación | Qué pasa |
|---|---|
| Repetición | Clave de reintento obligatoria y número único: queda una sola factura |
| Concurrencia | Dos cargas del mismo número: la segunda recibe «ya está cargada» |
| Tiempo | Fecha de emisión ≤ hoy (hora argentina). El período puede ser anterior (se paga después de consumir) y no puede ser posterior al mes de la factura más uno (PROPUESTA: una factura anticipada del mes siguiente) |
| Incertidumbre | Si no hubo respuesta, reintentar con la misma clave es seguro |
| Reintento | Misma clave = mismo resultado |
| Error parcial | Cabecera, líneas, stock, imputaciones y auditoría van en una transacción: todo o nada |
| Datos faltantes | Sin concepto en un servicio: no guarda. Sin período: guarda y muestra «período: pendiente de completar». Sin insumo en un artículo no alimentario: avisa |
| Cambio de permisos | El servidor revisa `proceso_compra` para productos y `gasto_registrar` para servicios; si falta uno, no se guarda nada |
| Precarga desactualizada | Si el último concepto del proveedor se desactivó, no se precarga y se pide elegir |

**Cargar sugeridos (CU5)**

| Situación | Qué pasa |
|---|---|
| Repetición o reintento | Solo crea los que faltan por código: la segunda vez no crea nada |
| Concurrencia | Dos administradores a la vez: el índice único `(empresa, código)` deja uno solo |
| Datos faltantes | Si un nombre ya existe con otro código, no se crea y se avisa |
| Cambio de permisos | `conceptos_gasto` en el servidor |

**Registrar rotura (Merma) y mover de sector (Transferencia)**

| Situación | Qué pasa |
|---|---|
| Repetición o reintento | Clave de reintento: queda un solo registro |
| Concurrencia | Dos roturas del último plato a la vez: deciden las reglas de saldo vigentes (I9) |
| Tiempo | Fecha ≤ hoy. En BU, un mes cerrado bloquea |
| Incertidumbre | Reintentar con la misma clave |
| Error parcial | Una transacción. En la Transferencia, salida y entrada juntas |
| Datos faltantes | Sin motivo o sin sector destino: no guarda |
| Cambio de permisos | `proceso_merma` o `proceso_transferencia` en la sucursal |

**Pasar un ítem de N0 a N1**

| Situación | Qué pasa |
|---|---|
| Repetición | El alta del artículo es única por código y nombre; el conteo inicial tiene su clave de reintento |
| Concurrencia | Una compra cargada como gasto el mismo día del cambio queda como gasto: no se reinterpreta |
| Datos faltantes | Sin conteo inicial, el stock arranca en cero y lo corrige el primer conteo |
| Cambio de permisos | `alta_producto`, `insumo_alta`, `proceso_control` |

**(BU, esbozo) Alta de equipo como bien de uso y baja del bien**

| Situación | Alta | Baja |
|---|---|---|
| Repetición | Clave de reintento en `AltaDeBienes` | Una sola baja vigente por bien |
| Concurrencia | La suma de los orígenes no supera lo comprado (SERIALIZABLE) | Gana una |
| Tiempo | Mes cerrado: no se da de alta en ese mes; la amortización empieza el mes siguiente | La baja va al primer día abierto |
| Error parcial | Salida de stock + fichas + orígenes: todo o nada | Baja + corte del plan: todo o nada |
| Datos faltantes | Sin vida útil: la ficha queda «pendiente de completar» y no amortiza | Sin motivo: no guarda |
| Cambio de permisos | `bien_de_uso_registrar` (futura) | `bien_de_uso_baja`, `bien_de_uso_anular` (futuras) |

---

## 10. Etapas, de lo más barato a lo más grande

| Etapa | Nombre | Qué se puede usar | Código | Migración |
|---|---|---|---|---|
| **SB0** | **Configurar lo no alimentario** | **Ya:** <br>• Grupo «No comestibles» con sus hijos («Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería», «Equipamiento» y, si hace falta N1, «Mantenimiento y repuestos»). <br>• Insumos y artículos; secciones («Habitaciones», «Ropería»…); motivos de merma; destinos de consumo. <br>• Comprar, ubicar por cantidad, mover, contar y romper con la Compra y el Stock de hoy | **Ninguno** | **Ninguna** |
| SB1 | Ajustes chicos de pantalla y lectura | Aviso «sin insumo cuenta como comida»; aviso al mover un insumo a «No comestibles»; desglose de «no comestibles» por grupo en compras y valuación; vista de empresa «todo lo que no es comida» (compras no comestibles + gastos de E4); ficha del proveedor «qué le compramos»; «artículo» en pantalla | Chico | Ninguna |
| **E4** | **Servicios en la misma factura** | Conceptos con «cargar sugeridos» (lista de §6.1); líneas de servicio; imputación por sucursal; tipo de proveedor que decide las líneas; **servicio precargado S0**; **período P0** (texto) mientras no esté P2; ferretería en N0 | Mediano (ya planificado) | **Ninguna** |
| **E4-P** | **Período en dos campos** | Filtrar y sumar los servicios por mes de consumo; pasar el texto P0 a las columnas, una vez | Chico | **2 columnas aditivas en `FacturaProveedorRenglon`: REQUIERE AUTORIZACIÓN EXPRESA** (pregunta 1) |
| (compras, etapa 2) | Código del proveedor en su propio campo | Buscar por código exacto | — | La pide el diseño de compras. **REQUIERE AUTORIZACIÓN EXPRESA** |
| CP | Cierre de períodos | Requisito de BU | Mediano | Tabla nueva, **REQUIERE AUTORIZACIÓN EXPRESA** |
| BU | Bienes de uso | Ficha por unidad desde la compra con stock, sector, amortización, baja y anulación de la baja | Grande | Tablas nuevas, **REQUIERE AUTORIZACIÓN EXPRESA**, una por una |

**Migraciones que pide este diseño: una sola, chica y opcional (E4-P).** Todo lo demás se usa sin migrar.

---

## 11. Escalera de producto N0 a N5 (lo que ve el cliente, PROPUESTA)

| Peldaño | Qué ve | Etapa |
|---|---|---|
| N0 | Lo no alimentario se anota fuera del sistema | (antes) |
| N1 | Consumibles, utensilios, blanquería y equipos como cantidades por sector, con roturas registradas | SB0 |
| N2 | Servicios en la misma factura, con concepto, servicio precargado y período (texto) | E4 |
| N3 | Período en campos propios; totales por familia; ficha del proveedor «qué le compramos» | E4-P + SB1 |
| N4 | Equipos con ficha por unidad, alta en uso y baja anulable | BU2-BU7 |
| N5 | Amortización mensual asentada al cerrar el mes | BU8 + CP |

**El peldaño que sigue es N1, y es solo configuración.** Esta escalera (lo que ve el cliente) es distinta de la de seguimiento de §7, que va por ítem: un cliente en N3 puede tener la tornillería en N0 y los repuestos en N1. Subir un peldaño no rompe lo cargado. Lo que falta se muestra como «pendiente de completar».

---

## 12. Niveles 6 a 10 (ESBOZO)

**6. Historia y persistencia.**
- SB0, SB1 y E4: sin tablas nuevas.
- E4-P: `FacturaProveedorRenglon.periodoDesde` y `periodoHasta` (DATE, nulas). Tres CHECK: pareo de las dos, primer día del mes y desde ≤ hasta. Más uno más: solo con `naturaleza = 'SIN_STOCK'`. El privilegio de la app sigue siendo solo INSERT (el renglón no se edita: se anula o se carga un ejemplar nuevo). `down.sql` que aborta si hay filas con período.
- BU: las tablas de `grounding-dolibarr-activos-fijos.md` §16 y adenda 1 §5, con el origen en la compra con stock (CONFIRMADO).

**7. Atomicidad y concurrencia.** El molde de E3a: SERIALIZABLE con reintento, `FOR UPDATE` sobre la cabecera, claves de reintento únicas globales e índices únicos como árbitros. La precarga S0 es solo lectura y no bloquea nada.

**8. Acceso e interfaces.**
- Sin claves nuevas en SB0, SB1, E4 ni E4-P. Se usan `proceso_compra`, `alta_producto`, `insumo_alta`, `grupos_familia`, `secciones`, `motivos_merma`, `motivos_destino_consumo`, `proceso_transferencia`, `proceso_merma`, `proceso_consumo`, `proceso_ajuste`, `proceso_control`, `proveedores` y `gasto_*`.
- Leer el último concepto de un proveedor exige lo mismo que cargar su factura: `proceso_compra` o `gasto_registrar`.
- BU: módulo `bienes_de_uso`, que requiere `gastos`, y claves `bien_de_uso_*`.

**9. Consultas y experiencia.** La carga es la del diseño de compras. En una línea de servicio: concepto (precargado), período (mes y año desde, mes y año hasta; arranca en un mes), descripción e importe. La ficha del proveedor muestra productos y servicios. Ver la maqueta.

**10. Pruebas, migración y operación.**

*Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock:*

| Dimensión | Valores | Qué cambia |
|---|---|---|
| Tipo de proveedor | productos, servicios, ambos | Qué líneas admite |
| Naturaleza de la línea | `MERCADERIA`, `SIN_STOCK` | Stock o imputación |
| Familia del artículo | comida, sin insumo, «No comestibles» directo, cada hijo | Costo de comida, ratio, total no comestibles, valuación |
| Nivel de seguimiento | N0, N1, N2 | En qué reporte aparece; si hay stock |
| Salida | consumo, merma, transferencia, conteo, ajuste, (BU) alta | Stock y gasto |
| Período | ausente, un mes, varios meses | Reporte por mes de consumo (no el mes del gasto) |
| Historia del proveedor | sin servicios previos, uno, varios, último desactivado | Qué se precarga |
| Permisos | `proceso_compra` × `gasto_registrar` | Qué puede guardar |
| Módulo `gastos` | prendido / apagado | Si aparecen las líneas de servicio |
| Reparto | una sucursal / varias | Imputación y stock |
| (BU) Estado del bien | pendiente, en uso, dado de baja, anulado | Amortización, anulación de la factura |

*Tabla de reglas esperadas (oráculo, escrita aparte del código):*

| Familia / nivel | Entra a stock | Costo de comida | Ratio | Total gastado (compras) | Total no comestibles | Reporte de gastos | Valuación |
|---|---|---|---|---|---|---|---|
| Comida (o sin insumo) | Sí | Sí | Sí | Sí | No | No | Sí |
| No comestible N1/N2 (limpieza, utensilios, blanquería, equipos, repuestos) | Sí | No | No | Sí | Sí | No | Sí (con desglose) |
| Servicio o ferretería N0 | No | No | No | No | No | Sí | No |

| Historia del proveedor | Qué se precarga |
|---|---|
| Sin servicios previos | Nada: se elige a mano |
| Un concepto previo | Ese concepto, y el período siguiente al último |
| Varios conceptos | El último primero; los demás a mano en un clic |
| El último está desactivado | Nada de ese concepto: se pide elegir |

Test: recorrer exhaustivamente las combinaciones de las tablas (son pocas) contra el oráculo. Un guardián falla si aparece un valor nuevo de naturaleza, de tipo de costo o de nivel, o una columna nueva en el renglón, sin declararlo. Sin librerías nuevas (`fast-check` ya está en `package.json`).

*Verificación de cada etapa con código:* los 8 comandos de `AGENTS.md` en la misma corrida, todos limpios, y cada test nuevo probado con su mutación. Al terminar, el ratio, `totalGastado`, el costo y la valuación tienen que dar exactamente lo mismo que antes sobre los datos existentes. SB0 no tiene código: se verifica cargando la configuración en una base local.

*Operación:* producción tiene 0 artículos, 0 proveedores y 0 facturas. La configuración de SB0 y «cargar sugeridos» se hacen una vez por empresa, desde las pantallas. E4-P no tiene datos que migrar.

---

## 13. Preguntas abiertas para el dueño (una por tema, con recomendación)

**Ya respondidas (CONFIRMADAS el 2026-11-03):**
- Equipos: cantidad por sector hasta la etapa BU.
- Utensilios, vajilla y blanquería: cantidad por sector, sin ficha, sin amortización, sin vencimiento.
- La ficha del equipo nace de la compra con stock.

**Abiertas:**

1. **Período de los servicios.** Para ver «cuánto me costó la luz de septiembre» (y no solo «la factura que llegó en octubre»), ¿autorizás agregar **dos campos opcionales** a cada línea de servicio, «desde mes/año» y «hasta mes/año» (para las facturas bimestrales)? *Recomendación: sí.* Es una migración chica, aditiva y reversible, sobre una tabla vacía en producción: **REQUIERE AUTORIZACIÓN EXPRESA**. Hasta que la autorices, el período se escribe igual en la pantalla y queda guardado como texto en la descripción.
2. **El servicio del proveedor, en simple** (reemplaza a la pregunta 4 de la primera ronda). Cuando elegís a la cooperativa eléctrica, ¿te alcanza con que el sistema **te proponga el mismo servicio que en su factura anterior** (Electricidad, y el período siguiente)? ¿O querés anotar en la ficha del proveedor cuál es su servicio **antes** de cargarle la primera factura? *Recomendación: la primera opción.* No hay que mantener ninguna lista: cada factura que cargás ya le enseña al sistema qué te factura ese proveedor. Solo la primera vez elegís «Electricidad» a mano.
3. **Mantenimiento y ferretería.** ¿Confirmás estos niveles por defecto? <br>• Tornillería y ferretería menuda: **solo gasto** («Mantenimiento y repuestos», sin stock). <br>• Limpieza, descartables y repuestos caros o críticos: **stock** (saber cuánto hay, contando cada tanto). <br>• **Stock con consumo por destino**: solo cuando alguien pida saber en qué sector u obra se usó. <br>*Recomendación: sí.* Es lo más simple que muestra la realidad del negocio, y se puede subir o bajar de nivel sin perder lo cargado.

**Lo que asumo (PROPUESTA, una línea cada una):**
- Los grupos hijos se llaman «Limpieza», «Descartables y packaging», «Utensilios y vajilla», «Blanquería», «Equipamiento» y «Mantenimiento y repuestos»; amenities y papelería no se crean hasta que los nombres.
- Los códigos de los servicios sugeridos son los de §6.1. «Equipamiento» sale de la lista.
- El período se ofrece en toda línea de servicio y no es obligatorio en ninguna.
- El período no cambia el mes en que cuenta el gasto.
- Dar de alta un artículo no alimentario usa las mismas claves que una materia prima; no hay clave nueva.
- La rotura usa `proceso_merma` y su corrección, `proceso_ajuste`, como hoy.
- En pantalla, «artículo» reemplaza a «materia prima» cuando el grupo es no comestible; la base no cambia.
- El umbral de «caro» para subir de nivel lo fija el dueño cuando haga falta; no se inventa un número.
- Número de serie y garantía de equipos: no se construyen.

---

## 14. Qué NO está resuelto

- Amortización, cierre de períodos y notas sobre bienes: etapas CP y BU, ya decididas en lo funcional.
- Venta de un equipo usado: BU, con el emisor fiscal.
- Centros de costos: E8.
- Un reporte que sume los consumos por destino (N2): NO VERIFICADO que exista hoy.
- Si una merma puede dejar saldo negativo en un sector (I9): NO VERIFICADO caso por caso.
