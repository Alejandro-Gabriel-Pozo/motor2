# Frente 2 — Auditoría de unidades y clasificación contra Pedernal (2026-11-16)

> Pieza hermana de `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md` (entrada). **Solo lectura: no se escribió código ni migraciones.**
> **Fuentes.** Motor2: `main` `903c0f6d`, leído en `src/` y `prisma/schema.prisma` (no contra documentos). Pedernal: `ZuluHub-ERP` `ad4a9a4` (2026-11-16 11:36 -0300; **clon de un solo commit**, sin historia) y `ZuluHub-docs` `125e09e`. La lectura de código la hicieron dos subagentes de lectura y **yo reverifiqué** las afirmaciones que cargan peso (marcadas **V**); lo que solo viene del informe de un agente va como **(agente)**; lo que nadie leyó, **NO VERIFICADO**.
> **Columna Estado:** **IGUAL** · **DIFIERE EN RESULTADO** · **DIFIERE EN FORMA** · **FALTA EN MOTOR2** · **FALTA EN PEDERNAL** · **NO VERIFICADO**. «Motivo» = Prisma, RLS, datos existentes, o decisión del dueño con cita.

## 1. Unidades de medida

| # | Pedernal (vigente) | Motor2 (código real) | Estado | Motivo / nota |
|---|---|---|---|---|
| 1 | Lista cerrada de **14** unidades, 6 dimensiones, factor entero a la base; tabla global `unidad_de_medida` (`migraciones/0025_catalogo.sql:101-114`), de solo inserción (**V**: `src/primitivas/unidades/unidades.ts:9-24`) | La **lista de 14 existe en código** pero **desconectada**: `src/core/catalogo/unidades-de-medida.ts` (#299), factores `bigint`, usada solo por tests y un guardián (**V**: `grep` de importadores). Las unidades **reales** son filas `Unidad` por empresa, nombre libre (`schema.prisma:626-652`) | **DIFIERE EN RESULTADO** (la lista no gobierna nada) | Datos existentes (nueve modelos referencian `Unidad` con clave compuesta) |
| 2 | Dimensiones: CONTEO, MASA, VOLUMEN, LONGITUD, SUPERFICIE, TIEMPO | `enum MagnitudUnidad { PESO VOLUMEN CANTIDAD }` (`schema.prisma:344`); sin longitud, superficie ni tiempo | **DIFIERE EN FORMA** | Ampliar el enum es aditivo pero **no se puede revertir** (DT-U2 del diseño) |
| 3 | Unidades las crea la plataforma; **ninguna empresa crea unidades** | Cada empresa crea las suyas: `crearUnidad` (`src/server/actions/catalogo/unidades.ts:41`), permiso `unidades` (piso administrador; `acciones.ts:61`) | **DIFIERE EN RESULTADO** | Se cierra en U2 (Q-U1 y N-2) |
| 4 | Siembra: las 14 (migración) | Siembra de empresa: **5** (kg, g, l, ml, unidad; `src/core/features/empresa/siembra-de-empresa.ts:10-20`; **V** por el agente y el diseño) | **FALTA EN MOTOR2** (9 unidades) | U2/U3 |
| 5 | `convertirCantidad`: aritmética entera `bigint`, **nunca redondea**; errores `DIMENSION_DISTINTA`, `CONVERSION_NO_EXACTA`, `FUERA_DE_RANGO` (`convertir-cantidad.ts`; **V** de la lista, **(agente)** del orden de controles) | `convertirCantidadExacta` idéntica en espíritu (**V**: archivo existe, `bigint`, 4 decimales, `CONVERSION_NO_EXACTA`) **pero sin consumidor**. La conversión que corre hoy es `convertirCantidadAUnidadDeStock` (`transiciones.ts:193`, `decimal.js`, **redondea** a `Unidad.decimales`) | **IGUAL** (la primitiva) / **DIFIERE EN RESULTADO** (lo que corre) | Datos existentes: las cantidades guardadas ya están redondeadas por unidad |
| 6 | Cantidades: siempre 4 decimales, `numeric(18,4)`; **no redondea** | `Decimal(14,4)` en columnas; el dominio usa `number`; `redondearACantidadDeUnidad` = `Math.round(c*10^d)/10^d` en **coma flotante** (**V**: `transiciones.ts:173`), usada en venta, producción, conteo y filas de venta | **DIFIERE EN RESULTADO y en forma** | Datos existentes. **Riesgo anotado**: regla «cantidades exactas». Se decide con el frente 3 |
| 7 | La unidad base de un producto **no cambia nunca** (disparador `producto_unidad_inmutable`; 0025:334-345) | **NO VERIFICADO** si Motor2 impide cambiar `unidadStockId` | **NO VERIFICADO** | No se pidió; el diseño de unidades ya lo declaró NO VERIFICADO |
| 8 | **No hay unidad de compra en el producto**; se elige **por línea** de recepción (`linea_de_recepcion.unidad_de_compra_id`, `0037_compras.sql:224`; **(agente)**). El producto trae `unidad_base_id` y `unidad_de_venta_id` (misma dimensión) con `paso_minimo` (0025:155-174) | `Producto.unidadStockId` (obligatoria) y `unidadCompraId` + `factorConversion` (`schema.prisma:356+`); unidad de venta **separada: no existe** (`pasoVenta` decimal libre) | **DIFIERE EN FORMA** y **FALTA EN MOTOR2** (unidad de venta) | Lo primero es del frente 5; lo segundo es R4 del plan de paridad (porciones, 0051), **no del pedido de este frente** |
| 9 | Relación kg↔g: **la tabla**; no hay nada por nombre | `PARES_DE_UNIDADES` **por nombre** (`lectura-de-cantidad.ts`, kg/g y l/ml, factor 1000, `number`); lo usan la lectura en vivo y la guardia (`guardia-de-unidad.ts`; umbrales PESO 5, VOLUMEN 5, CANTIDAD 50, ×1000 si es la unidad menor) | **DIFIERE EN FORMA** | DT-U5 del diseño: pasar a factor cuando hay equivalencia |
| 10 | No existe guardia de plausibilidad de cantidad | Existe (pedida por el dueño el 2026-11-09) | **FALTA EN PEDERNAL** | Se conserva; no se poda (hay necesidad escrita) |
| 11 | Presentación de compra: **nombre + cantidad en la unidad base**; `presentacion_de_producto` (0037:138-154: `nombre`, `nombre_clave`, `cantidad numeric(18,4)`, `de_peso_variable`, `activa`, `version`; la cantidad **no se edita**; **V** de existencia, columnas **(agente)**) | `Presentacion` (`schema.prisma:654-677`): `unidadCompraId`, `factorConversion Decimal(14,4)`, `activa`, `nombre?`, `pesoVariable`, `version` (#304). Índice común por (producto, unidad) desde #309; con **dos activas de la misma unidad la compra falla cerrada** (`PRESENTACION_AMBIGUA`) | **DIFIERE EN FORMA** | Prisma y datos; el dueño: «Como lo hace pedernal?» → d1 a d5 **no se construyen** (diseño de línea de compra, 2026-11-15) |
| 12 | La compra apunta a la presentación (`oferta_de_proveedor.presentacion_id`; `calcular-linea.ts`) | La línea guarda **solo la unidad** (`MovimientoStock.unidadCompraId`, migración `20261104100000`); **no apunta a `Presentacion`** | **DIFIERE EN FORMA** | Es el hueco que d1 a d5 cerraban; no se construye (decisión citada arriba) |
| 13 | «Perilla» de presentaciones: no existe | Interruptor **constante** `PRESENTACIONES_VISIBLES: boolean = false` (**V**: `src/core/catalogo/presentaciones-visibles.ts:13`). **No hay perilla en el esquema** (corrige el encargo, que la llamaba «perilla apagada») | **IGUAL en resultado** | — |

## 2. Merma

| # | Pedernal | Motor2 | Estado | Motivo / nota |
|---|---|---|---|---|
| 1 | Receta guarda el **bruto**; descuento y costo usan el bruto; **neto = bruto × (100 − p) ÷ 100** solo para mostrar, un solo redondeo a 4 decimales (`src/modulos/stock/dominio/merma.ts`; **(agente)**, coincide con `novedades-para-motor2` #294) | La receta carga el **neto**; bruto = neto × (1 + p/100) (**V**: `src/core/catalogo/merma.ts`, una sola función desde #297; 9 expresiones antes, 5 archivos) | **DIFIERE EN RESULTADO** (800 g con 20 %: 960 g en Motor2, 1.000 g en Pedernal) | N-2 a N-4 confirmadas (dueño 2026-11-13) |
| 2 | `perdida numeric(7,4)`, `CHECK 0 ≤ p < 100` (`0030_stock.sql:281`; **V**) | `Decimal(6,2)` en `RecetaIngrediente` (`schema.prisma:953-975`); validación hasta **1.000 %** en recetas, 0–100 en opciones | **DIFIERE EN RESULTADO** | M2b (4 decimales) y la regla `< 100` en lo nuevo |
| 3 | Merma solo en **una** tabla (componente de composición) y **solo con la perilla `composiciones_con_perdida`**, de base **apagada** (`perillas.ts:60-65`; `composicion.ts:90-91` devuelve `FUNCION_NO_INCLUIDA`) | **Tres** tablas con merma (`RecetaIngrediente`, `RendimientoLocalIngrediente`, `ConsumoDeOpcion`; la cuarta, de combinaciones, es de GO-3a, retirado) y **sin perilla** | **DIFIERE EN FORMA** | Datos existentes (opciones, Q-M2 confirmada); la perilla es del frente 4 |
| 4 | Marca de «cómo se cargó»: no hace falta (siempre bruto) | **No existe**; el diseño propone `baseDeCantidad` (`NETA`/`BRUTA`) en las dos tablas de versiones, de solo agregar (la de combinaciones es de GO-3a, retirado) | **FALTA EN MOTOR2** (propio) | N-5 confirmada: «no reescribir las viejas» |
| 5 | Calibración por sucursal: no existe | Existe (`RendimientoLocalIngrediente`) | **FALTA EN PEDERNAL** | Se conserva |
| 6 | Costo de la receta = Σ costo × bruto ÷ rinde, sin reaplicar la merma (`costo-de-receta.ts:8`) | Costo con `cantidad × factorDeMerma × costoUnitario` en `number` (`src/core/reportes/costos.ts:62,159,311`) | **DIFIERE EN RESULTADO** (consecuencia de #1) | Se resuelve con M3 |
| 7 | — | `MotivoMerma` (catálogo de motivos de una salida de stock `proceso_merma`) | otra cosa con el mismo nombre (merma **A/C/D** de la ficha de Pedernal) | Fuera de alcance |

## 3. Clasificación comercial

| # | Pedernal | Motor2 | Estado | Motivo / nota |
|---|---|---|---|---|
| 1 | `nodo_de_clasificacion` (0045): árbol, `padre_id`, único `(empresa, padre, nombre_clave)` NULLS NOT DISTINCT, tope **4** en la base (`tope_de_niveles_de_clasificacion()`), sin ciclos, no se borra (**V** de existencia; detalle **(agente)** y referencia del orquestador `59e47a40`) | `CategoriaProducto` **plana**: `nombre`, `activo`, único `(empresaId, nombre)` (`schema.prisma:591-603`); **V**: sin `padreId` | **FALTA EN MOTOR2** | E1 del diseño: ampliar la tabla (datos existentes) |
| 2 | Vínculo producto→nodo de solo inserción con vigencia (0046) | `Producto.categoriaId` **mutable** (`schema.prisma:371`); historial solo en `RegistroAuditoria` | **FALTA EN MOTOR2** | E2 |
| 3 | El renglón de venta **congela** el camino (0047: `linea_cuenta.departamento_id` + `camino_de_clasificacion jsonb`, solo insertar) | `CuentaItem` congela precio, `nombreEnTicket`, `nombreDeCocina`, **no** la clasificación (**(agente)**: **V** del reporte por categoría que lee la categoría **vigente**: reclasificar reescribe la historia de los reportes) | **FALTA EN MOTOR2** | E3 |
| 4 | Departamento en la cuenta (0048, `cuenta_consumo.departamento_id`, DEC-0365) | No existe | **FALTA EN MOTOR2** | **Sin pedido**: pregunta P1 (§8 de la entrada) |
| 5 | Permisos: **sin clave propia**, `productos.editar` (**(agente)**: `clasificacion.ts:69`) | Árbol = `categorias` (piso administrador); clasificar en la ficha = permiso de hoy | **DIFIERE EN RESULTADO** (permisos) | **CONFIRMADA**, dueño 2026-11-14: «Árbol: administración y gerencia; clasificar en la ficha: como hoy» |
| 6 | Auditoría con acciones `CLASIFICACION_NODO_*` | Hoy las categorías **no se auditan** (`categorias-producto.ts:5`) | **DIFIERE EN FORMA** | Formato de `RegistroAuditoria` ya construido |
| 7 | **No hay pantalla real** de clasificación (**V** parcial por el agente: `apps/web` sin ruta; solo la maqueta `clasificacion.html`); las páginas de catálogo son productos y secciones | No hay pantalla | **FALTA EN LOS DOS** | Corrige el diseño del 13/11; la forma a igualar es la maqueta |
| 8 | Reversión de 0045 a 0048 en `migraciones/reversiones/` (**V**: existen 0045 a 0058 y `reversiones`) | `down.sql` por migración | **IGUAL en resultado** | Prisma |
| 9 | Árbol aparte de **insumos** | `Grupo` (árbol de insumos, sin tope; `creariaCicloEnArbol`, `schema.prisma:571`) | **FALTA EN PEDERNAL** (no es lo mismo) | No se toca; no se pidió |

## 4. Clases de producto y «unir pares»

| # | Pedernal | Motor2 | Estado | Motivo / nota |
|---|---|---|---|---|
| 1 | 5 clases (materia prima, insumo, reventa, elaborado, vendible); la clase no se cambia | `enum TipoProducto { MP PV }` (**V**, `schema.prisma:339`) + `seProduce`; se derivan 3 de 5 | **FALTA EN MOTOR2** | E1 a E4 del diseño de clases (confirmado en dirección: «Sí, copiar a Pedernal en esas cinco», 2026-11-15) |
| 2 | La **reventa es UN producto** (con su propio stock, sin receta 1:1) | Reventa hoy = **par** materia prima + vendible con receta 1:1 | **DIFIERE EN FORMA** | «Unirlos par por par» CONFIRMADA en dirección (dueño, 2026-11-15, vía el diseño de clases §11.2) |
| 3 | «Unir pares» | — | **FALTA EN PEDERNAL** (no existe) | Operación **propia de Motor2** para igualar el resultado (E6): crea el producto REVENTA y **desactiva** el par (no cambia la clase); costo del nuevo «arranca vacío hasta la primera compra, avisado» (CONFIRMADA 2026-11-15) |

## 5. Migraciones de igualación: inventario y estado (nada aplicado)

> «Estado» = lo que hay hoy. **Ninguna** de la lista de abajo existe como archivo en `prisma/migrations` (**V**: `grep` de `codigoFijo`, `baseDeCantidad`, `ProductoClasificacion` y `padreId` de categoría: solo aparece `codigoFijo` en `unidades-de-medida.ts`, como texto de comentario del código puro). Las dos últimas migraciones del directorio son `20261115170000_nombre_de_cocina` y anteriores; **posterior a ella: ninguna** (**(agente)**).

| Pieza | Qué hace | Reescribe datos | Reversible | Estado | Autorización |
|---|---|---|---|---|---|
| **U1** `Unidad.codigoFijo` | Columna anulable + CHECK de 14 valores | No (solo esquema) | Sí (`down.sql`) | Diseño; **no escrita** | Permanente (aditiva) del 2026-11-15, **cuando se escriba** |
| **U1b** rellenar `codigoFijo` | `UPDATE` de la columna nueva por base con la tabla revisada | **Sí** (solo la columna nueva) | Sí (script de reversa) | Diseño | **Expresa, por base, con respaldo y ensayo** |
| **U3** completar las 14 | `INSERT` de las unidades que falten | Inserta filas | Sí (solo filas sin referencias) | Diseño | **Expresa, por base** |
| **DT-U2** ampliar `MagnitudUnidad` | Valores nuevos del enum | No | **No** (Postgres no saca valores) | Diseño | Aviso al dueño: no se deshace |
| **M2** `baseDeCantidad` ×2 | Columna `NOT NULL DEFAULT 'NETA'` + CHECK | No (todo queda `NETA`) | Sí, con freno si hay `BRUTA` | Diseño | Permanente (aditiva) |
| **M2b** merma a 4 decimales ×3 | `ALTER TYPE` de la columna | Cambia el tipo, **no los valores** | Solo si ningún valor usa más de 2 decimales | Diseño | **Expresa, por base** (texto Z) |
| **M3b** cargar en bruto y convertir al editar | Sin migración: cambia lo que se guarda desde la edición; **mueve stock y costo de lo nuevo** | Versión **nueva** convertida (la vieja no se toca) | Se puede apagar; lo escrito en bruto se lee bien | Diseño | **Expresa**, por despliegue (texto X) |
| **E1 clasificación** árbol | Columnas en `CategoriaProducto`, relleno de `nombreClave`, **cambia el único** `(empresaId, nombre)` → `(empresaId, padreId, nombreClave)`, disparadores | Calcula `nombreClave` de filas existentes | Sí; el `down.sql` recrea el único y falla si hay nombres repetidos entre hermanos distintos; **pierde la jerarquía** nueva | Diseño | **Expresa** (el diseño lo marca; modifica un único sobre datos reales) |
| **E2 clasificación** vínculo | Tabla nueva de solo inserción | No | Sí | Diseño | Permanente |
| **E3 clasificación** camino en `CuentaItem` | 2 columnas anulables, solo al insertar | No (las ventas anteriores quedan `NULL`) | La reversión **destruye** lo sellado | Diseño | **Expresa** (aviso aparte) |
| **0048** departamento en `Cuenta` | 1 columna anulable | No | Sí | **Sin pedido** | Pregunta P1 |
| **Clases E1** columna `clase` + relleno parcial | Columna anulable + CHECK, rellena solo lo seguro | **Sí** (relleno) | Sí (borra la anotación) | Diseño | **Expresa, por base** para el relleno |
| **Clases E6** unir pares | Crea el producto REVENTA, reapunta recetas, **desactiva** el par (una transacción por par) | **Sí** | Parcial: stock, costo y recetas reapuntadas | Diseño | **Expresa, por base, par por par, con informe** |

**De otros frentes en el mismo inventario (no son de este frente; se listan para no confundir):** «costo y precio mayores que cero» (R5; aprieta CHECK de `MovimientoStock`/`FacturaProveedorRenglon`; pasar 0 a nulo reescribe: frentes 5/3); «poda de promos, tiempo 2» (migración **destructiva**: borra vigencia, menú del día y dos campos; dueño 2026-11-13 «OK, poda antes»; frente 6); marca de oculto y nombre de cocina (Ocultar y Pantallas). **NO VERIFICADO** el estado de código de esas.

## 6. Qué no se pudo comprobar

- **Pedernal:** detalle de casos de uso y consultas de clasificación; el sellado del camino al vender; si la ficha de producto expone el selector; contenido de `0035`, `0039`, `0040` (no están) y de `0059` en adelante; resto de `novedades-para-motor2.md`; qué cambió «desde el 13/11» por commit (clon de un solo commit).
- **Motor2:** migración base de `Unidad`, `CategoriaProducto` y `Grupo` (anteriores al directorio leído); tipos exactos de `RendimientoLocalIngrediente`; permiso de `MotivoMerma`; si existe disparador que impida cambiar la unidad de stock de un producto con movimientos; si se corrió algún test (no se corrió ninguno).
- **Datos reales de cualquier base:** no se leyó ninguna. Las cifras de las piezas anteriores las relató el orquestador sobre **una** copia; hay que recontar en cada base (etapa A1).
