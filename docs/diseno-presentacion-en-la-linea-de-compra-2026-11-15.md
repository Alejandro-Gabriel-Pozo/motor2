# Diseño: la línea de compra y la oferta apuntan a la presentación (etapa «d» de presentaciones) — 2026-11-15

Estado del documento: **DISEÑO EN PAPEL. No se migra ni se programa nada de esto.** Escalera de diseño de 10 niveles (`AGENTS.md`, «Diseño de módulos y features nuevos»): niveles 1 a 5 completos con su estado; nivel 6 solo como **PROPUESTA**; compuerta: no se diseñan ni migran tablas sin los niveles 1 a 5 **confirmados**.
Estados: **CONFIRMADA** (dicha por el dueño, con cita), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Lo verificado en el código real lleva `archivo:línea` o nombre exacto; lo demás queda NO VERIFICADO.
Tipos de cambios de código: Sonnet escribe, este documento solo planifica (regla del 2026-11-04).

## 0. Por qué existe este documento

- **CONFIRMADA** (dueño, 2026-11-13, chat con el orquestador): «El de Pedernal: presentación por producto (Recomendada)»: «caja x6» y «caja x12» son dos presentaciones del mismo producto, con nombres distintos y la **misma** unidad «caja»; la oferta del proveedor apunta a la presentación. El diseño del 03/11 (envase por proveedor) queda revocado.
- **CONFIRMADA** (dueño, 2026-11-14): «Rechazarlo y pedir otro nombre (Recomendada)» y el texto aprobado «Ya existe una presentación con ese nombre y otra cantidad. Usá otro nombre.» (T8).
- Etapas ya construidas (rama `presentacion-por-producto-a-migracion`, PR #304, y a2-1): (a) columnas `nombre`, `pesoVariable`, `version` en `Presentacion` con único por nombre; (a2-1) el único (producto, unidad) pasó a índice común y la línea de compra **falla cerrado** si hay dos presentaciones activas con la misma unidad.
- **El hueco que este documento cierra:** hoy la línea de compra identifica la presentación **solo por la unidad** (`MovimientoStock.unidadCompraId`; `cargarPresentacionActiva` en `src/server/persistencia/movimientos/cargar-linea-de-movimiento.ts`). Mientras sea así, «caja x6» y «caja x12» con la misma unidad no pueden convivir en compras: se rechazan. Para que convivan, **la línea tiene que decir a qué presentación se refiere**. Eso cambia el motor de compras (dinero y stock) y por eso va con diseño aparte.

## 1. Propósito y alcance

**Propósito (PROPUESTA):** que una compra pueda registrar de qué presentación es cada línea («2 cajas x12», no «2 cajas»), de modo que el stock que entra y el costo por unidad de stock salgan de la cantidad **de esa presentación**, nunca de una elección ambigua.

**Dentro:** línea de compra simple (`MovimientoStock`), renglón de factura de proveedor (`FacturaProveedorRenglon`), oferta/vínculo proveedor↔producto (`ProveedorPorProducto`), carrito de proveedor, Compra por pasos, devolución a proveedor (misma conversión), lecturas por unidad.

**Fuera (no se construye acá):** clases comprables insumo y reventa (decisión 2 del §8 de `diseno-productos-igual-a-pedernal-2026-11-13.md`); borrar `Producto.unidadCompraId`/`factorConversion` (destructivo, etapa posterior); pesaje con peso real nuevo (ya existe `pesoReal` en la línea, no cambia); recepciones al estilo Pedernal (`linea_de_recepcion`) — Motor2 no tiene recepción separada de la compra.

**Necesidad que resuelve** (regla de poda): el dueño pidió presentación por producto con cantidades fijas (2026-11-13, cita arriba). Sin esta etapa, la decisión queda a medias: se pueden crear presentaciones pero no comprar con las que comparten unidad. **Alternativa más barata** (regla «primero la opción más barata»): no hacer nada y obligar a que cada presentación use una unidad distinta («caja12» y «caja6» como unidades). Sirve hoy y no toca el motor, pero **contradice la decisión del dueño** (es justo lo que Pedernal evita) y llena el catálogo de unidades de embalaje. **PROPUESTA:** si el dueño no necesita todavía comprar con dos presentaciones de la misma unidad, esta etapa se **posterga** y la a2-1 alcanza (rechaza con seguridad).

## 2. Actores y contexto

| Actor | Qué hace | Permiso hoy (verificado) |
|---|---|---|
| Quien registra una compra | Elige producto, presentación, cantidad y precio | `proceso_compra` (`registrarMovimiento`) |
| Quien carga una factura de proveedor | Reparte renglones entre secciones | `registrarFacturaProveedor` (`registrar-factura-proveedor.ts`) |
| Quien administra productos | Crea/edita/desactiva presentaciones | `producto_presentaciones` + `producto_campos_sensibles` para el factor (M.2) |
| Sistema (anulaciones, ajustes) | Anula una compra, regenera el Kardex | caso de uso de anulación (NO VERIFICADO el nombre exacto) |

Contexto: multiempresa con RLS por empresa; compras por sucursal. **CONFIRMADA** (dueño, 2026-11-14): el permiso de la presentación se queda el de hoy («Dejar el permiso de hoy y anotar la diferencia (Recomendada)»).

## 3. Casos de uso

1. **Comprar con una presentación** (línea simple): producto + presentación + cantidad de presentaciones + precio total → entra stock = cantidad × cantidad de la presentación, costo por unidad de stock = precio ÷ stock que entra.
2. **Comprar con la presentación por defecto** (sin presentación elegida): como hoy (`Producto.unidadCompraId`/`factorConversion`). Compras anteriores sin presentación siguen válidas.
3. **Cargar una factura de proveedor** con renglones por presentación.
4. **Anular una compra** hecha con una presentación (el Kardex solo agrega; no se reescribe).
5. **Devolución a proveedor** con presentación (mismo cálculo, signo contrario).
6. **Ver la oferta/vínculo** del proveedor por presentación (carrito, comparativa, ficha del proveedor).
7. **Compra por pasos / precarga del carrito**: ofrecer las presentaciones activas del producto.

Cada caso con su tabla «qué pasa si…» en §5.4.

## 4. Conceptos y ciclo de vida

- **Presentación** (ya existe, etapas a y a2-1): `id`, producto, `nombre` único por producto (sin mayúsculas), `unidadCompraId`, `factorConversion` (cantidad fija en la unidad base; con `pesoVariable` es el aproximado), `activa`, `version`. Ciclo: activa ⇄ inactiva; **nunca se borra**; la cantidad **no se edita** una vez usada (regla ya vigente: `FACTOR_CON_USO`).
- **Línea de compra**: hoy guarda `unidadCompraId` + `cantidadCompra` (pendiente de completar en compras viejas). **PROPUESTA:** además guarda `presentacionId` (nullable). `null` = «pendiente de completar» (compra anterior, o compra con la presentación por defecto): **nunca se inventa**.
- **Oferta/vínculo** (`ProveedorPorProducto`): único hoy por (producto, proveedor, unidad de compra). **PROPUESTA:** pasa a poder apuntar a una presentación (`presentacionId` nullable). Se escribe como hoy: la propia compra lo hace con un upsert atómico (`upsertProveedorPorProducto`).
- **Fuente de verdad del factor:** una sola. Con `presentacionId`, el factor sale de la presentación **al registrar** y **se copia congelado** a la línea (el stock y el costo ya se guardan en unidad base; la compra ya hecha no se reescribe si la presentación cambia después).

## 5. Invariantes y políticas

### 5.1 Invariantes (todas PROPUESTA salvo marca)

- **I1** Una línea de compra con `presentacionId` tiene la **misma unidad** que esa presentación (FK/CHECK compuesto o validación del servidor + CHECK).
- **I2** Una línea con presentación trae **siempre** el factor congelado y el stock entra convertido a unidad base. **Nunca entra «la caja»** (decisión 92, ya vigente).
- **I3** La conversión es exacta dentro de la misma magnitud y **nunca entre magnitudes** (decisión 92; ya vigente: `guardPesoRealPorMagnitud`).
- **I4** Compras sin presentación siguen como hoy (**compatibilidad hacia atrás**); no se obliga a nadie a elegir presentación.
- **I5** Una presentación **inactiva** no se ofrece ni se acepta en compras nuevas; las compras viejas con ella se leen igual.
- **I6** La línea con `presentacionId` pertenece al mismo producto y la misma empresa que la presentación (FK compuesta por `empresaId`).
- **I7** Aislamiento entre empresas por RLS (como hoy).
- **I8** El Kardex solo agrega: anular una compra genera movimientos nuevos, nunca edita el `presentacionId` ni el factor guardados.
- **I9 (puente a2-1)** Mientras la línea **no** traiga `presentacionId`, dos activas con la misma unidad se **rechazan** en compras (ya construido).

### 5.2 Políticas de decisión abiertas

- **Q1 (negocio, PENDIENTE):** si una línea llega con unidad pero sin presentación y el producto tiene **una** sola presentación activa con esa unidad, ¿se asume esa presentación (como hoy) o se exige elegirla? **Recomendación:** se asume solo si hay una sola; con dos o más se rechaza (I9). Es lo que ya hace `cargarPresentacionActiva` y no cambia el comportamiento visible hoy.
- **Q2 (negocio, PENDIENTE):** ¿el precio de una compra por presentación se compara por unidad base entre presentaciones del mismo proveedor? **Recomendación:** sí, por `precioPorUnidadStock` derivado del Kardex (como la comparativa de hoy); no se agregan columnas de precio.
- **Q3 (técnica, PENDIENTE):** clave de la oferta: ¿(producto, proveedor, presentación) con `NULLS NOT DISTINCT` como Pedernal (`oferta_unica_uk`), o mantener (producto, proveedor, unidad) y sumar `presentacionId` como dato? **Recomendación:** la de Pedernal, en una etapa posterior a la de la línea (ver §10).

### 5.3 Comandos y su tabla «¿qué pasa si…?»

Para cada comando se cubren: repetición, concurrencia, tiempo, incertidumbre, reintento, error parcial, datos faltantes, cambio de permisos.

**C-1 Registrar una compra con presentación** (`registrarMovimiento`, proceso COMPRA)

| Caso | Resultado esperado |
|---|---|
| Repetición (clic doble, reintento) | `claveIdempotencia` + único por clave (como hoy): una sola operación; el segundo envío devuelve lo ya registrado |
| Dos compras simultáneas del mismo producto/presentación | Independientes; cada una entra con su factor congelado; el vínculo se actualiza con el upsert atómico (la fecha más nueva gana) |
| La presentación se desactiva entre la pantalla y el envío | Se rechaza en el servidor con motivo (I5); no entra nada |
| El factor de la presentación cambia entre la lectura y la escritura | No puede: con uso, `FACTOR_CON_USO`; sin uso, se lee dentro de la misma transacción (`SELECT … FOR UPDATE` de la presentación) y se congela |
| Datos faltantes (sin presentación y sin unidad) | Compra con la unidad por defecto del producto (I4) |
| Presentación de otro producto o de otra empresa | Se rechaza en el servidor (I6/I7); nunca se confía en el id que manda el frontend |
| Cantidad ≤ 0, decimales de más, precio inválido | Se rechaza (guardas de hoy: `guardLineaCompra`) |
| Peso variable | Cantidad aproximada solo para pedir; el stock entra por el **peso real** (decisión 70; `guardPesoRealPorMagnitud`) |
| Error a mitad (falla el vínculo o el Kardex) | Todo o nada: una transacción; no queda stock sin vínculo ni al revés |
| Cambio de permisos entre pantalla y envío | `proceso_compra` se vuelve a chequear en el servidor |
| Dos presentaciones activas con la misma unidad y la línea **sin** `presentacionId` | Rechazo cerrado (I9, ya construido) |

**C-2 Cargar factura de proveedor con renglones por presentación** (`registrarFacturaProveedor`): mismas filas que C-1 más: renglón con `presentacionId` y unidad distinta → se rechaza (I1); repartir el renglón entre secciones conserva la presentación; el reintento no duplica (único de la factura).

**C-3 Anular una compra con presentación:** genera el AJUSTE inverso con el mismo factor congelado (I8); anular dos veces → una sola anulación (idempotente por la operación); si la presentación se desactivó o cambió después, **la anulación igual funciona** (usa lo congelado).

**C-4 Devolución a proveedor con presentación:** como C-1 con signo contrario; el stock sale convertido; si no alcanza stock, se rechaza.

**C-5 Leer ofertas/vínculos por presentación** (carrito, comparativa): solo lectura; sin permisos para el proveedor o producto, no se devuelve nada; presentaciones inactivas no se ofrecen (I5).

## 6. Historia y persistencia — **PROPUESTA, NO migrar hasta confirmar niveles 1 a 5**

Todo aditivo y reversible, con `down.sql`:

- **6.1** `MovimientoStock.presentacionId text NULL` con FK compuesta `(empresaId, presentacionId) → Presentacion(empresaId, id)` y CHECK: si hay `presentacionId`, hay `unidadCompraId` y `cantidadCompra` (van juntos). Un trigger o FK compuesta extendida garantiza I1 (misma unidad): una opción es agregar `unique (empresaId, id, unidadCompraId)` en `Presentacion` y la FK `(empresaId, presentacionId, unidadCompraId)`. **NO VERIFICADO** si esa FK compuesta de tres columnas convive con las existentes de `Movimiento`.
- **6.2** `FacturaProveedorRenglon.presentacionId text NULL`, mismo criterio.
- **6.3** `ProveedorPorProducto.presentacionId text NULL` (etapa posterior, Q3); la clave de la oferta cambia solo cuando se resuelva Q3.
- **6.4** `Presentacion`: `unique (empresaId, id, unidadCompraId)` para sostener la FK de 6.1/6.2.
- El factor **no** se copia a una columna nueva: el stock (`cantidad`) y el costo ya se guardan en unidad base; el dato de «de qué presentación» alcanza para explicar la línea. **PROPUESTA** a confirmar: ¿conviene guardar el factor usado? (Pedernal guarda `cantidad_en_stock` y la presentación, no el factor.)
- Historial que solo agrega: no hay UPDATE sobre estas columnas (Kardex); grants como hoy.
- Lo que **no** se toca: `Producto.unidadCompraId`, `Producto.factorConversion`, `Presentacion.unidadCompraId`, la unicidad del nombre.

## 7. Atomicidad y concurrencia (PROPUESTA)

- Una compra = una transacción: Kardex + vínculo + auditoría juntos (como hoy). La presentación se lee con `FOR UPDATE` o `FOR SHARE` dentro de la transacción para que ni el factor ni la actividad cambien entre la lectura y la escritura.
- Desactivar una presentación mientras se compra: la transacción de la compra ve el estado confirmado; una de las dos gana; nunca queda una compra con una presentación inactiva escrita después de apagarse (la lectura bloquea).
- Idempotencia: la clave de la operación (como hoy) más los únicos de la factura; el upsert del vínculo es una sola sentencia atómica.
- Dos altas de presentaciones del mismo producto: ya sostenido por el bloqueo del producto (a2-1) y el único del nombre.

## 8. Acceso e interfaces (PROPUESTA)

- La pantalla de Compra y la Compra por pasos ofrecen **presentaciones por nombre** («Caja x12 — 12 kg») en lugar de unidades sueltas; el servidor valida de nuevo (I6, I5).
- El interruptor `PRESENTACIONES_VISIBLES` sigue mandando: apagado, no se ofrece ninguna y una línea ya cargada con `presentacionId` se sigue resolviendo (no se cambia en silencio cuánto stock entra).
- Textos nuevos: **requieren aprobación del dueño**; no se agrega ninguno sin ella. Los de Pedernal ya aprobados el 09/11 («Presentación», «Cantidad en la unidad base», «Agregar presentación») se reutilizan.

## 9. Consultas y experiencia

- Lecturas por unidad que hoy suponen «una presentación por unidad» y hay que revisar (**lista inicial, NO VERIFICADA al detalle**): `listarPresentaciones` y `obtenerDatosDeCompraDelProducto` (`src/server/actions/catalogo/productos.ts`), `src/server/lecturas/catalogo/ofertas-de-proveedor.ts`, `src/server/lecturas/catalogo/historia-de-producto.ts` (`presentacionTieneUso`: hoy mira el vínculo por unidad), `src/core/compras/carga-por-pasos.ts`, `panel-compra-por-pasos.tsx`, `panel-movimiento-form.tsx`, `src/app/(app)/catalogo/proveedores/[id]/page.tsx`, `src/app/(app)/catalogo/productos/[id]/compra/page.tsx`.
- `presentacionTieneUso` hoy responde «¿hay un vínculo con esta unidad?»: con dos presentaciones de la misma unidad **deja de ser exacto**; pasa a mirar `presentacionId` de las líneas o del vínculo.
- Compras viejas (sin `presentacionId`) se muestran como «pendiente de completar», no se les inventa presentación.

## 10. Pruebas, migración y operación

### 10.1 Combinaciones (regla del 2026-10-28)

**Dimensiones cuyas combinaciones cambian dinero, stock o permisos:** (1) presentación: ninguna / una activa / una inactiva / de otro producto; (2) unidad de la línea: igual / distinta a la de la presentación; (3) peso variable: sí / no; (4) misma unidad compartida por dos presentaciones: sí / no; (5) interruptor de presentaciones: encendido / apagado; (6) proceso: COMPRA / DEVOLUCION_PROVEEDOR / anulación; (7) permiso `proceso_compra`: sí / no.

**Oráculo legible (a escribir en `test/movimientos/oraculo-presentacion-en-la-linea.ts`, aparte del código):** una tabla de reglas esperadas por combinación (p. ej. «dos presentaciones activas de la misma unidad + línea con `presentacionId` = ok y factor de esa presentación»; «… + línea sin `presentacionId` = rechazo»; «presentación inactiva = rechazo»; «unidad distinta a la de la presentación = rechazo»; «sin presentación = como hoy»). Un test recorre **todas** las combinaciones (son pocas: exhaustivo) y un guardián falla si aparece una dimensión nueva sin declarar.

### 10.2 Pruebas obligatorias por etapa

Concurrencia (dos compras simultáneas; desactivar mientras se compra), idempotencia (la misma compra dos veces), atomicidad (falla el vínculo → no queda Kardex), aislamiento entre empresas, autorización, regresión de **costo idéntico** para compras sin presentación (golden), subir/bajar/subir de cada migración y que `down.sql` se frene si hay datos que se perderían.

### 10.3 Plan de migración de pruebas y archivos que mencionan `unidadCompraId`

Inventario verificado el 2026-11-15 (`grep -rl unidadCompraId`): **30 archivos de `src/`** y **~70 de `test/`**. Casi todos **no cambian**: mencionan la unidad de compra por defecto del producto o la unidad de la línea, que se quedan. Cambian solo:

| Grupo | Archivos (lista inicial) | Qué cambia |
|---|---|---|
| Resolución de la presentación en la línea | `cargar-linea-de-movimiento.ts`, `armar-linea-de-movimiento.ts`, `armar-filas-de-movimiento.ts`, `movimiento.schema.ts` | La línea trae `presentacionId` opcional; se resuelve por id; I9 pasa de «rechazo por ambigüedad» a «ok con id» |
| Factura de proveedor | `registrar-factura-proveedor.ts`, `escribir-factura-proveedor.ts` | Renglón con `presentacionId` |
| Vínculo/oferta | `upsert-proveedor-por-producto.ts`, `registrar-vinculo-de-compra-en-tx.ts`, `ofertas-de-proveedor.ts`, `historia-de-producto.ts` | Etapa posterior (Q3) |
| Pantallas | `panel-compra-por-pasos.tsx`, `panel-movimiento-form.tsx`, `carga-por-pasos.ts`, `gestion-presentaciones.tsx` | Elegir por presentación |
| Pruebas | `test/movimientos` (10 archivos con `unidadCompraId`), `test/catalogo` (27), `test/e2e` (8), goldens de caracterización (`test/movimientos/caracterizacion`, `test/catalogo/caracterizacion`, `test/persistencia/__golden__`) | Se **agregan** casos; los existentes sin presentación deben seguir **idénticos** (red de seguridad: costo y stock sin cambio) |

Los goldens que fijan «apagado» o el costo de compras sin presentación **no se regeneran** salvo cambio deliberado y declarado.

### 10.4 Orden de etapas (más barata primero)

1. **d0 — Nada** (ya hecho en a2-1): el sistema es seguro; dos presentaciones con la misma unidad se rechazan en compras. Si el dueño no necesita comprar con ellas todavía, **se puede parar acá**.
2. **d1 — Línea simple:** migración 6.1 + 6.4 (aditiva), la línea acepta `presentacionId` opcional, resolución por id, I1 y pruebas; sin tocar factura ni vínculo; pantalla sigue apagada. Cambia dinero/stock: golden de costo idéntico obligatorio.
3. **d2 — Factura de proveedor:** migración 6.2, renglón con presentación.
4. **d3 — Pantallas** de Compra y Compra por pasos con presentaciones por nombre (detrás del interruptor).
5. **d4 — Vínculo/oferta por presentación** (Q3, migración 6.3): solo si hace falta; **recién entonces** se puede retirar la restricción de unidad en las lecturas.
6. **d5 — Encender** `PRESENTACIONES_VISIBLES` (revisando los tests de congelación y los golden que hoy fijan «apagado»).
Cada paso es un PR; cada migración **requiere autorización expresa** del dueño para aplicarse en bases reales (backup y ensayo en copia de Neon, nunca la rama principal).

### 10.5 Operación y reversión

d1 a d4: columnas nuevas opcionales; revertir es poner el interruptor en `false` y, si hace falta, `down.sql` (idempotente, se frena si perdería datos). Ninguna compra ya hecha se reescribe.

## 11. Diferencias con Pedernal (declaradas)

| Tema | Pedernal | Motor2 (propuesto) | Motivo |
|---|---|---|---|
| Línea de compra | `linea_de_recepcion` con `presentacion_id` (nullable), `unidad_de_compra_id`, `cantidad_de_compra`, `de_peso_variable`, `peso_real`, `cantidad_en_stock` | `MovimientoStock` con `presentacionId` (nullable) + `unidadCompraId`/`cantidadCompra` que ya existen | Motor2 no separa recepción y compra (datos existentes) |
| Oferta | `oferta_de_proveedor` con clave (empresa, proveedor, producto, presentación) y `NULLS NOT DISTINCT`; la actualiza la propia compra | `ProveedorPorProducto` con clave por unidad; se mueve a presentación solo en d4 | Datos existentes en producción; PROPUESTA |
| Factor en la línea | Guarda `cantidad_en_stock` (convertida) | Guarda `cantidad` convertida (ya existe) | Igual en resultado |

## 12. Preguntas de NEGOCIO abiertas (una por una)

1. **¿Hace falta ya comprar con dos presentaciones de la misma unidad («caja x6» y «caja x12»)?** Si no, se queda en d0 (seguro) y esto no se construye. (Q1 y Q2 de §5.2 se resuelven con las recomendaciones, salvo objeción del dueño.)

Las demás (Q3) son técnicas y las decide quien implementa con aprobación del orquestador.

## 13. NO VERIFICADO (a comprobar antes de d1)

- Que una FK compuesta `(empresaId, presentacionId, unidadCompraId)` sea viable con las FK de `MovimientoStock` ya existentes (§6.1).
- El nombre exacto del caso de uso de anulación de compras y cómo recompone la unidad.
- Qué lecturas de `src/` suponen «una presentación por unidad» más allá de la lista de §9.
- Qué reportes (stock, costos) usan `unidadCompraId` de la línea.
- Que `presentacionTieneUso` es el único lugar que infiere uso de la presentación por (producto, unidad).
