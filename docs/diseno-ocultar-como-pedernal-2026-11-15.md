# Diseño: «Ocultar» como Pedernal, y lo actual pasa a llamarse «Desactivar» — 2026-11-15

Estado: **diseño en papel. Sin código, sin migraciones, sin tocar ninguna base.** Escalera de diseño de 10 niveles (`AGENTS.md`, «Diseño de módulos y features nuevos»). Niveles 1 a 5 con estados; el nivel 6 va **solo como esquema PROPUESTO**, marcado «PROPUESTA, no se migra hasta confirmar niveles 1 a 5».

Estados: **CONFIRMADA** (dicha por el dueño, con cita y fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Marcas: **(V)** verificado en el código; **(DOC)** solo de un documento.

Fotos: Motor2 `origin/main` `e327b8f` (2026-11-15). Pedernal: código `ZuluHub-ERP` `fe8926e` (2026-11-15 03:01 -03:00); documentos `ZuluHub-docs` `b0a2c5c` (2026-11-15). Plan de paridad (`motor2-docs`, rama `alegp/stoic-davinci-185dm4`): `_planes/plan-de-paridad-con-pedernal-2026-11-14.md`, secciones «Deltas con lo ya construido» y «Precisiones a pedido del orquestador». Redacción genérica (repositorio público): Empresa B, Producto A, Sucursal 1; sin nombres de negocio, cifras ni ids de bases.

## Para el dueño, en diez líneas

1. Hoy Motor2 tiene **una sola marca por sucursal**: «disponible». Un producto sin marca **no está disponible**. Esa marca pasa a llamarse **Desactivar**; no cambia su comportamiento ni los datos.
2. Se suma **Ocultar**, una marca **nueva e independiente**, como Pedernal: **sin marca = visible**; se oculta **en una sucursal o en toda la empresa**.
3. Un producto **oculto** no sale en la carta, no se carga en una venta (salón o mostrador), no se cuenta y **no recibe existencia** (compra, producción, traspaso entrante, ajuste que suma).
4. Lo ya cargado **se puede cobrar**; restar existencia sigue permitido; **anular una venta** de un producto oculto **se rechaza** (primero se vuelve a mostrar). Esto cierra el hueco que hoy tiene `anularVentaEnTx`.
5. **No se puede ocultar** un producto con existencia distinta de cero (también negativa). Mostrar no tiene condiciones.
6. Son **cuatro combinaciones** posibles (activo o desactivado × visible u oculto); Ocultar y Desactivar no se pisan.
7. Una tabla nueva y **una sola migración aditiva** con `down.sql` (autorización permanente del 2026-11-15). Las demás etapas **no migran**.
8. Lo más barato primero: cambiar el texto a «Desactivar» (sin migración). El hueco de `anularVentaEnTx` se cierra **solo para productos ocultos** (P-2 respondida: lo desactivado se sigue permitiendo, como Pedernal).
9. Una diferencia con Pedernal que **no se puede igualar**: Motor2 no tiene «conteo abierto con cargas» (cada conteo es un registro suelto). Va declarada en §10.4 con su motivo.
10. Las **tres preguntas de negocio** del final quedaron **respondidas el 2026-11-15** (todas con la opción recomendada, salvo que P-2 fue la opción B de este documento: ver «Respuestas del dueño»).

---

## 0. Decisiones del dueño que usa este diseño

| # | Fecha | Texto literal | Fuente | Qué fija | Estado |
|---|---|---|---|---|---|
| O-1 | 2026-11-15 | «Lo actual pasa a llamarse Desactivar y se suma Ocultar como Pedernal (Recomendada)» | chat del dueño con el orquestador; `motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Ocultar y tres defectos de las capturas» | Lo actual → «Desactivar» sin cambiar su comportamiento; se suma «Ocultar» como Pedernal; independiente de Desactivar; por local o toda la empresa; sin fila = visible | **CONFIRMADA** |
| O-2 | 2026-11-15 | (la etiqueta de la opción A, «Como Pedernal», tal como la relata el plan: «el operador solo en sus locales, toda la empresa solo gerente y administrador; visible por defecto») | plan de paridad, «Precisiones…», pregunta «Ocultar en Motor2» | Permisos de Ocultar: operador en sus locales; toda la empresa solo rol de gerencia | **CONFIRMADA en dirección** (el dueño eligió la opción; el detalle de permisos es el texto de la opción, no una frase suya). La traducción a los roles de Motor2 quedó en O-10 |
| O-3 | 2026-11-15 | «…bloquea si hay existencia distinta de cero o un conteo abierto; un oculto no admite líneas nuevas en mostrador y salón, deja cobrar lo ya cargado y no suma existencia» | mismo archivo de decisiones (relato del orquestador) | El comportamiento de Ocultar | **CONFIRMADA en dirección**; «conteo abierto» no existe tal cual en Motor2 (ver §4.6) |
| O-4 | 2026-11-12 | «si podría ser ocultar en toda la empresa y por sucursal y obviamente oculto vs desactivo que no son excluyentes; sería que no aparezca ni en conteos, ni en carta/pos; si tenía stock no debería dejar, al igual que el desactivar» | `ZuluHub-docs`, `11-especificaciones/carta-real-especificacion.md` (Revisión 3) | Es la decisión **de Pedernal** que Motor2 copia | **CONFIRMADA (Pedernal)**; ratificada para Motor2 el 2026-11-15 (E6, «Sí, copiar a Pedernal en esas cinco (Recomendada)») |
| O-5 | 2026-11-13 | «Anular una venta cuyo producto quedó oculto: se rechaza («Este producto está oculto.»); para anular, primero se vuelve a mostrar el producto (la anulación devuelve existencia, y un oculto no recibe existencia).» | `ZuluHub-docs`, `decisiones-del-dueno-2026-11.md:115` | Anular con producto oculto se rechaza | **CONFIRMADA (Pedernal)**; para Motor2 vale por el plan E6 y por O-6 |
| O-6 | 2026-11-15 | «se arregla el hueco de `anularVentaEnTx` dentro de esta pieza» | relato del orquestador (mismo archivo de decisiones) | El hueco se corrige **en esta pieza**, no aparte | **CONFIRMADA en dirección**; qué cubre (¿también Desactivado?) es la pregunta 2 |
| O-7 | 2026-11-13 | «Necesitamos ser iguales en todo. Por la salvedad de que nosotros usamos Prisma… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma.» | `AGENTS.md`, «Paridad con Pedernal» | Mismo resultado y misma forma; toda diferencia con motivo | **CONFIRMADA** |
| O-8 | 2026-11-15 | «Y mientras las autorizaciones tengan down.sql, vamos…» | mismo archivo de decisiones | Migraciones **aditivas y reversibles** de etapas ratificadas: se escriben y llevan a `main` sin pedir una por una; **aplicar en bases reales sigue congelado** | **CONFIRMADA** (lectura del orquestador, a corregir por el dueño) |
| O-9 | 2026-11-11 | «yo creo una promoción y nace sin ninguna sección tildada… Esto me asegura de que toda decisión sea adrede. Lo mismo con el código» | `AGENTS.md`, «Todo nace cerrado» | Denegar por defecto: ante duda o error el sistema cierra | **CONFIRMADA** |
| O-10 | 2026-11-15 | «Solo administración (Recomendada)» | chat del dueño con el orquestador (relatado por el orquestador; respuesta a P-1) | Ocultar en toda la empresa: solo administración (`admin`); el operador solo en sus sucursales | **CONFIRMADA** |
| O-11 | 2026-11-15 | «Permitir, igual que Pedernal (Recomendada)» | ídem (respuesta a P-2; es la opción B de este documento) | Anular una venta con producto **Desactivado** se sigue permitiendo; **solo** se rechaza cuando el producto está **Oculto**. El hueco de desactivado **no se cierra** | **CONFIRMADA** |
| O-12 | 2026-11-15 | «Sigue con Desactivar por ahora (Recomendada)» | ídem (respuesta a P-3) | La pantalla de mantenimiento de la carta («Sin stock hoy») sigue usando Desactivar | **CONFIRMADA** («por ahora»: pasar a Ocultar sería otro pedido) |

**Qué NO hay (después de O-10 a O-12):** ninguna decisión del dueño sobre el nombre interno de la tabla, sobre la pantalla donde vive el botón ni sobre los textos nuevos de error. Van como PROPUESTA o decisión técnica.

---

## Inventario: lo que ya existe con otro nombre (verificado en el código, `e327b8f`)

| Qué | Dónde | Qué hace hoy |
|---|---|---|
| **`DisponibilidadProducto`** (V) | `prisma/schema.prisma:495`; núcleo puro `src/core/catalogo/disponibilidad-producto.ts` | Una fila por (sucursal, producto) con `disponible`. **Sin fila = NO disponible** (`resolverDisponibilidad`). Sin versión ni actor; sucursal obligatoria. Es lo que pasa a llamarse **Desactivar** |
| `productoDisponibleEn` y lectores por lote (V) | `src/server/lecturas/catalogo/disponibilidad.ts` | Lectura de una fila / varias sucursales |
| `whereDisponibleEn` (V) | `src/core/catalogo/disponibilidad-producto-consulta.ts` | **El único lugar** que escribe el filtro Prisma «disponible acá»; lo fija `test/arquitectura/disponibilidad-en-un-solo-lugar.test.ts`. Lo usan carta, selector POS, consolidado, valuación, rendimiento de recetas, ofertas de proveedor, etc. |
| Caso de uso de Desactivar (V) | `src/server/actions/catalogo/casos-de-uso/actualizar-disponibilidad-producto.ts` | Permiso `producto_disponibilidad` (contexto sucursal, roles `admin` y `operador`); escribe **solo en la sucursal activa**; al desactivar **bloquea** con receta vigente de un plato disponible o saldo en alguna sección de esa sucursal (`dependenciasParaDesactivar`); al activar un PV a $0 exige la clave de campos sensibles; una base de venta por opción exige su regla; un producto ancla de adicional no se activa. Auditoría con `registrarCambioAuditado` (entidad `DisponibilidadProducto`). Repetir no audita |
| Desactivar de varios a la vez (V) | `fijar-disponibilidad-de-hoy.ts`, pantalla `src/app/(app)/carta/` | La pantalla de mantenimiento de la carta («En carta» / «Sin stock hoy») **usa la misma marca**: apagar un producto hoy es Desactivar |
| Dónde se **rechaza** un producto no disponible (V) | `armar-linea-de-movimiento.ts:97` (todo movimiento de stock), `registrar-venta-en-tx.ts:72,119,156`, `agregar-items.ts:146` (salón, cuenta y mostrador-cuenta), `registrar-conteo-fisico.ts:105`, `reclasificar-stock.ts:102`, `aceptar-propuesta-de-factura.ts:70`, `producto-transferible.ts:30` (traspaso) | Mensaje ««{nombre}» no está disponible en «{sucursal}».» |
| **Hueco** (V) | `src/server/actions/movimientos/casos-de-uso/anular-venta.ts:75-130` | `anularVentaEnTx` arma la reversión desde las líneas de la venta (`construirReversionDeVenta`, `src/core/movimientos/anulaciones.ts:189`) y la escribe **sin consultar la disponibilidad** (no hay ninguna referencia a «disponib» en el archivo). Devuelve existencia a un producto no disponible |
| «Oculto» con **otro significado** (V) | `ContenidoCartaProducto.visibleEnCarta`, `OpcionElegidaEnLinea.ocultaEnCarta`, grupos con `seMuestraEnCarta = false`, `docs/diseno-ticket-respeta-lo-oculto-2026-11-04.md` | «Oculto» hoy es **de contenido de la carta** (el producto está en la carta pero no se dibuja un renglón u opción). **No es Ocultar.** Riesgo de vocabulario (§10.5) |
| Escritores de movimientos de stock (V) | `escribir-movimiento-de-stock.ts`, `escribir-contra-asiento.ts`, `escribir-movimiento-de-traspaso.ts`, `registrar-conteo-fisico.ts` | Los **cuatro** archivos que hacen `movimientoStock.create*`: el embudo natural para el control de «no suma existencia» |
| Conteo (V) | modelo `ConteoFisico` (`prisma/schema.prisma:1452`), `EstadoConteo` = `RESUELTO / PENDIENTE / DESCARTADO / CANCELADO` | **No hay «conteo abierto con cargas»**: cada conteo es un registro con producto, sección y saldo del momento. Qué significa exactamente `PENDIENTE` (¿diferencia sin resolver?) **NO VERIFICADO** |
| Permiso (V) | `src/core/permisos/acciones.ts:238`, `producto_disponibilidad` | Contexto `sucursal`, nivel mínimo operario, edición semilla `admin` y `operador`. Los roles semilla son **solo `admin` y `operador`** (no hay «gerente» separado) |
| RLS por sucursal (V) | migraciones `20261014*_rls_sucursal_b*`, funciones `app_sucursales_lectura()` / `app_sucursales_escritura()` | Una política restrictiva por comando. Precedente de fila **de empresa y de sucursal en la misma tabla**: `RecetaVersion` (`sucursalId` nulo = receta central), política B6 con `OR "sucursalId" IS NULL` |
| Guardianes que un modelo por sucursal debe satisfacer (V) | `test/arquitectura/semantica-sin-fila.test.ts` (cada modelo con `sucursalId` declara qué significa «sin fila»), `cerco-dueno-unico-por-modelo.test.ts`, `escrituras-auditadas.test.ts`, `ensanches-de-alcance.test.ts`, `escrituras-en-sucursal-desde-empresa.test.ts`, `caracterizaciones-congeladas.test.ts` | Un modelo nuevo rompe estos tests hasta que se declara (es a propósito) |

**Conclusión del inventario (confirmada con evidencia):** la marca actual **no alcanza** para Ocultar: tiene el sentido contrario (activación: sin fila = no), no tiene alcance de empresa, versión ni actor, y su regla de bloqueo mira receta y saldo, no conteos. Se reutiliza lo que sirve: el patrón de auditoría, el bloqueo de la fila del producto (`tomarFilaDeProducto`, `FOR UPDATE`), el lector de saldos de `dependenciasParaDesactivar`, el rechazo en cada punto de venta y movimiento, y el precedente de `RecetaVersion` para RLS con fila de empresa.

**Cómo es en Pedernal (V, `fe8926e`):** migración `0043_carta_publica.sql:111-124` (`disponibilidad_de_producto`: `empresa_id, producto_id, sucursal_id` nulo = empresa, `oculto`, `actualizado_por`, `actualizado_en`, `version`; dos índices únicos parciales; sin `DELETE`; independiente de `producto.activo`, decisión D2 del archivo); `0049_producto_oculto_en_stock.sql` (dos disparadores: un renglón que **suma** existencia —saldo final por encima de cero— a un producto oculto en la sucursal del depósito se rechaza, y un registro de conteo de un oculto se rechaza); `casos-de-uso/ocultar-producto.ts` (fija un **estado**, no alterna; bloquea el producto `FOR UPDATE`; **escribe la fila y recién entonces** pregunta a stock; si hay existencia distinta de cero o conteo abierto con cargas, **revierte la fila**; mostrar sin condiciones; auditoría una entrada por cambio); `cotizar-para-vender.ts:89` (`PRODUCTO_OCULTO` al cargar una línea **nueva**); `armarOcultarProducto` exige `vidrieras.marcar_disponibilidad` y, para la empresa, además `vidrieras.editar` y alcance total. Pruebas: `test/integracion/producto-oculto-en-ventas.test.ts`, `salon-oculto.test.ts`, `stock-producto-oculto.test.ts`.

**Qué hace Pedernal al anular (V, con una precisión):** `reversion-y-entrada.ts` revierte la salida con renglones de cantidad opuesta; la **regla** de «anular un oculto se rechaza» no está escrita en ese caso de uso: **la impone el disparador de 0049** (el renglón de la anulación suma existencia a un producto oculto). Consecuencia: se rechaza solo si el saldo final queda por encima de cero (una venta que dejó el saldo negativo se puede anular hasta cero). Pedernal **no** rechaza anular por un producto *desactivado* (no hay ninguna comprobación de `activo` en la reversión: verificado leyendo `src/modulos/stock`).

---

## Nivel 1 — Propósito y alcance

**Propósito (O-1, O-4):** que un negocio pueda **sacar un producto de la operación de un día para otro sin desactivarlo**: que no aparezca en la carta, ni en el salón o mostrador, ni en los conteos, y que no reciba existencia, en una sucursal o en toda la empresa, y **volver a mostrarlo** cuando quiera. **Desactivar** sigue siendo «este producto no se usa acá» (la marca de hoy).

**Necesidad (poda):** pedida por el dueño el 2026-11-12 (Pedernal, cita en O-4) y ratificada para Motor2 el 2026-11-15 (O-1). Fuente escrita: `carta-real-especificacion.md` Revisión 3 y las decisiones del 2026-11-15. No hay una forma más barata con lo que existe: el 2026-11-12 el dueño pidió explícitamente que fueran **dos** marcas independientes («oculto vs desactivo que no son excluyentes»); con una sola marca no se pueden tener los dos estados.

**Dentro de alcance (CONFIRMADA salvo marca):**
- Renombrar la marca actual a «Desactivar» (texto; O-1).
- Marca nueva «Ocultar / Volver a mostrar» por (producto, alcance), con alcance **sucursal** o **empresa**; sin fila = visible.
- Que carta pública, POS (salón, cuenta, mostrador), venta directa, conteos y movimientos que suman existencia respeten la marca.
- Cerrar el hueco de `anularVentaEnTx` **para productos ocultos** (O-6, O-11; lo desactivado se sigue permitiendo).

**Fuera de alcance (no se pidió; PROPUESTA de dejarlo afuera):**
- Un «agotado automático» según el stock (Pedernal tampoco lo hace).
- Cambiar qué hace Desactivar (O-1 dice explícitamente que no cambia).
- Ocultar opciones, grupos, secciones o promos (son otros modelos con su propio «visible/oculto»).
- Reportes, valuación, stock consolidado: **no cambian** con Ocultar (PROPUESTA igual a Pedernal: la lista de lugares afectados es carta, POS/venta, conteo y suma de existencia; ver §10.2).
- Mostrar el historial de quién ocultó qué en una pantalla propia (la auditoría ya lo guarda; la pantalla sería otra etapa).
- Renombrar el modelo o la tabla de la marca actual (§10.3).

## Nivel 2 — Actores y contexto

| Actor | Qué hace | Contexto | Estado |
|---|---|---|---|
| Operador | Oculta y vuelve a mostrar **en las sucursales donde trabaja** | Sucursal activa | PROPUESTA de mapa: reutiliza `producto_disponibilidad` (Editar). Pedernal: `vidrieras.marcar_disponibilidad` para los tres roles. **CONFIRMADA en dirección** (O-2) |
| Administrador (`admin`) | Oculta y muestra en **cualquier sucursal** y **en toda la empresa** | Empresa | **CONFIRMADA en dirección** (O-2); **CONFIRMADA** (O-10: solo `admin`) |
| Mozo / cajero | Solo **sufre** la marca: no ve el producto en el selector; una línea nueva se rechaza con un mensaje claro | Sucursal | CONFIRMADA (O-3) |
| Sistema (movimientos de stock, conteos, anulación, carta pública) | Lee la marca y rechaza o filtra | Servidor | CONFIRMADA (O-3, O-5) |
| Cliente final (carta pública) | No ve el producto oculto; sin aviso de «oculto» | Público | CONFIRMADA (O-4) |

**Aislamiento y autorización (siempre en el servidor):** la empresa sale de la sesión; la sucursal se valida contra el alcance de la transacción y contra RLS; el id de producto o sucursal que mande el cliente nunca se acepta sin verificar que existe **en esa empresa** (FK compuesta). Un id de otra empresa o inexistente da «no encontrado», sin revelar que existe.

## Nivel 3 — Casos de uso

| # | Caso | Quién | Qué hace | Estado |
|---|---|---|---|---|
| CU-1 | **Ocultar** un producto en una sucursal | Operador con acceso a esa sucursal, admin | Fija «oculto = sí» para (producto, sucursal); rechaza con existencia distinta de cero | CONFIRMADA (O-3) |
| CU-2 | **Ocultar** un producto en toda la empresa | Admin | Fija «oculto = sí» para (producto, empresa); rechaza si **cualquier** sucursal tiene existencia distinta de cero | CONFIRMADA (O-1, O-4) |
| CU-3 | **Volver a mostrar** (sucursal o empresa) | Los mismos | Fija «oculto = no»; sin condiciones | CONFIRMADA (O-4) |
| CU-4 | Agregar una línea nueva a una cuenta (salón, cuenta, mostrador) o vender directo | Mozo, cajero | Si el producto está oculto en esa sucursal → rechazo «Este producto está oculto.» | CONFIRMADA (O-3); texto PROPUESTA (el de Pedernal) |
| CU-5 | **Cobrar** una cuenta con una línea ya cargada de un producto luego ocultado | Cajero | Se cobra con el precio congelado; la existencia **resta** (puede quedar negativa) | CONFIRMADA (O-3) |
| CU-6 | **Anular** una venta (o una línea) de un producto oculto | Quien anula | Si el producto oculto recibiría existencia por encima de cero → «Este producto está oculto.»; primero se vuelve a mostrar | CONFIRMADA (O-5, O-6) |
| CU-7 | Entrada, compra, producción, traspaso entrante, ajuste que **suma** a un producto oculto | Stock | Rechazo `PRODUCTO_OCULTO`; restar o corregir un negativo hasta cero se permite | CONFIRMADA (O-3) |
| CU-8 | **Contar** un producto oculto | Stock | Rechazo; la lista de lo que se puede contar no lo ofrece | CONFIRMADA (O-4); qué listas existen es NO VERIFICADO (§4.6) |
| CU-9 | Ver la carta pública | Cliente | El producto oculto no sale; el cambio es inmediato (se lee en cada visita) | CONFIRMADA (O-4) |
| CU-10 | Ver en la ficha del producto «Activo / Oculto» por sucursal y empresa | Quien edita productos | Lectura; con el botón si tiene permiso | PROPUESTA (§8) |
| CU-11 | **Desactivar / Activar** (la marca de hoy) | Operador, admin | Igual que hoy | CONFIRMADA (O-1) |

## Nivel 4 — Conceptos y ciclo de vida

**4.1 La marca.** Una fila = «el producto P está oculto (o se volvió a mostrar) en el alcance X». **Alcance** = una sucursal o toda la empresa. **Sin fila = visible** (denegar por defecto aplica a *abrir* cosas nuevas; acá la fila «oculta» es la que cierra: por eso la ausencia es el estado normal, igual que Pedernal; PROPUESTA de familia `optout` en el registro de semántica de «sin fila», §6).

**4.2 Regla de lectura única (CONFIRMADA, Pedernal `§3.2b`):** un producto está **oculto en la sucursal S** si hay una fila **de la empresa** con `oculto` **o** una fila **de S** con `oculto`. **Una sucursal no puede mostrar lo que la empresa oculta** (la pantalla dice «oculto en toda la empresa»). Un local creado **después** hereda el ocultamiento de la empresa (es una regla, no una copia: por eso no hace falta tocar `crearSucursalConAdmin`).

**4.3 Estados y transiciones** (por alcance):

```
 (sin fila = visible) --ocultar--> OCULTO --mostrar--> VISIBLE (fila con oculto=no)
        ^                              |                      |
        +---------- nunca se borra la fila (el historial está en la auditoría) --+
```
- `ocultar` solo si no hay existencia distinta de cero en el alcance. `mostrar` siempre.
- Fijar el estado en el que ya está = «ya estaba»: no escribe ni audita (idempotencia por estado).

**4.4 Desactivar × Ocultar (las cuatro combinaciones existen, O-1):**

| | **Activo en la sucursal** (hay fila con `disponible`) | **Desactivado** (sin fila o `disponible = no`) |
|---|---|---|
| **Visible** | Aparece y opera (como hoy) | No aparece ni opera (como hoy) |
| **Oculto** | No aparece en carta/POS/conteos; no recibe existencia; lo ya cargado se cobra; restar permitido | Ídem; el producto sigue desactivado |

**4.5 Qué NO cambia Ocultar:** nombre, precios, recetas, categoría, `DisponibilidadProducto` (Desactivar). La marca es independiente.

**4.6 «Conteo abierto» en Motor2 (diferencia declarada, §10.4):** Pedernal bloquea ocultar si hay «un conteo abierto con cargas del producto». En Motor2 no existe esa figura: cada `ConteoFisico` es un registro suelto. **PROPUESTA:** en Motor2 se traduce a «**existencia distinta de cero** en el alcance» (que es la regla fuerte, la que el dueño dijo con palabras: «si tenía stock no debería dejar») y, **solo si se verifica** que un `ConteoFisico` en estado `PENDIENTE` es un conteo cargado sin resolver, a «no hay un `ConteoFisico` `PENDIENTE` de ese producto en el alcance». **NO VERIFICADO** qué es `PENDIENTE`; hasta verificarlo, la regla de conteo **no se implementa** y la diferencia queda declarada (no se inventa).

## Nivel 5 — Invariantes y políticas

| # | Invariante / política | Estado |
|---|---|---|
| I-1 | **Independencia:** cambiar Ocultar no toca Desactivar ni nada del producto, y al revés | CONFIRMADA (O-1) |
| I-2 | **Sin fila = visible.** Una sucursal sin fila propia ni fila de empresa ve el producto como siempre | CONFIRMADA (O-1) |
| I-3 | **Regla de lectura:** oculto en S = fila de empresa con `oculto` **o** fila de S con `oculto` | CONFIRMADA (Pedernal, O-4) |
| I-4 | **Un oculto no tiene existencia distinta de cero** en su alcance. Se hace cumplir en dos puntos: al ocultar (acción) y al sumar existencia (control en los escritores de stock). Nunca queda «oculto y con existencia nueva» aunque dos personas lo intenten a la vez | CONFIRMADA (O-3, O-4); mecanismo PROPUESTA (§7) |
| I-5 | **Suma es suma:** se rechaza un movimiento que deja el saldo del producto **por encima de cero**; restar y corregir un negativo hasta cero **se permiten** (una venta ya cargada que se cobra después de ocultar deja saldo negativo, y devolverlo no es sumar existencia a un oculto) | CONFIRMADA (Pedernal 0049, O-3) |
| I-6 | **Líneas nuevas no; lo ya cargado sí:** se rechaza agregar una línea nueva de un oculto; una cuenta abierta con la línea ya cargada se cobra con su precio congelado; unir y dividir cuentas con un producto ocultado después **sigue funcionando** | CONFIRMADA (O-3; pruebas de Pedernal `salon-oculto`) |
| I-7 | **Anular con oculto:** la anulación (que devuelve existencia) se rechaza si algún producto devuelto está oculto en la sucursal **y** quedaría con saldo por encima de cero; no hay excepción por quien anula | CONFIRMADA (O-5, O-6); el «saldo por encima de cero» es el mecanismo de Pedernal (**decisión técnica 1**) |
| I-8 | **Fijar un estado, no alternar:** dos veces seguidas da el mismo resultado (`yaEstaba`), sin escribir ni auditar | CONFIRMADA (Pedernal, regla de idempotencia del usuario) |
| I-9 | **Toda escritura deja rastro:** quién (persona), cuándo (reloj inyectado), qué cambió (antes/después, alcance); no se borra la fila: «mostrar» pone `oculto = no` | CONFIRMADA (O-9, trazabilidad) |
| I-10 | **Aislamiento:** un producto o sucursal de otra empresa nunca se ve ni se escribe; una sucursal fuera del alcance del operador tampoco | CONFIRMADA (regla permanente) |
| I-11 | **Quién oculta para toda la empresa:** solo `admin` con alcance total; el operador solo en sus sucursales | **CONFIRMADA** (O-2, O-10) |
| I-12 | **Una sola definición de «oculto en esta sucursal»** en el código (un lector, un filtro Prisma, un guardián que prohíba escribirlo a mano), igual que `whereDisponibleEn` | PROPUESTA (patrón existente del proyecto) |
| I-13 | **Falla cerrado:** si la lectura de la marca falla, no se agrega la línea ni se suma existencia (no se asume «visible») | PROPUESTA (O-9) |
| I-14 | **Desactivar no cambia** (reglas, mensajes de bloqueo, permisos, auditoría, D4, ancla, base) salvo el **nombre visible** | CONFIRMADA (O-1) |
| I-15 | **El producto ancla de un adicional** se trata como cualquier producto salvo prueba en contrario (hoy no tiene disponibilidad a propósito) | PENDIENTE técnica; **NO VERIFICADO** si conviene rechazar ocultarlo |

---

## Nivel 6 — Historia y persistencia (**PROPUESTA, no se migra hasta confirmar niveles 1 a 5**)

Una sola tabla nueva. **Nombre propuesto `OcultamientoProducto`** (no `disponibilidad_de_producto`): en Motor2 ya existe `DisponibilidadProducto` con el sentido contrario; dos modelos casi homónimos con significados opuestos son una trampa (§10.4, diferencia D-1).

```prisma
/// PROPUESTA, no se migra hasta confirmar niveles 1 a 5. «Ocultar» como Pedernal: una fila por (producto, alcance). `sucursalId` nulo = toda la empresa.
/// Sin fila = visible (familia optout). Independiente de `DisponibilidadProducto` (Desactivar). Nunca se borra: «volver a mostrar» pone `oculto = false`.
model OcultamientoProducto {
  id             String    @id            // lo manda la aplicación (uuid): es la idempotencia del alta (forma E5, a confirmar: pregunta técnica 3)
  empresaId      String    @default(dbgenerated("app_empresa_actual()"))
  empresa        Empresa   @relation(fields: [empresaId], references: [id])
  productoId     String
  producto       Producto  @relation(fields: [empresaId, productoId], references: [empresaId, id])
  sucursalId     String?   // NULL = toda la empresa
  sucursal       Sucursal? @relation(fields: [empresaId, sucursalId], references: [empresaId, id])
  oculto         Boolean
  actualizadoPor String                  // User.id; NOT NULL (trazabilidad)
  actualizadoEn  DateTime  @db.Timestamptz  // reloj inyectado de la acción
  version        Int       @default(1)   // +1 en cada cambio de estado (control de versión)
  creadoEn       DateTime  @default(now()) @db.Timestamptz

  @@unique([empresaId, id])
}
```

Lo que el esquema Prisma **no** puede expresar y va a mano en la migración (precedente: `RecetaVersion`, «índices únicos parciales a mano»):
- `CREATE UNIQUE INDEX … ON "OcultamientoProducto" ("empresaId","productoId") WHERE "sucursalId" IS NULL;` (una marca de empresa por producto).
- `CREATE UNIQUE INDEX … ON "OcultamientoProducto" ("empresaId","productoId","sucursalId") WHERE "sucursalId" IS NOT NULL;` (una por local). Garantizan que **dos personas que ocultan a la vez nunca dejan dos filas**: la escritura es `INSERT … ON CONFLICT DO UPDATE`.
- `CHECK ("version" >= 1)`.
- RLS activa y forzada, **una política por comando** (SELECT, INSERT, UPDATE; **sin DELETE**): fila con `sucursalId` → alcance de lectura/escritura de sucursal; fila de empresa (`sucursalId` nulo) → visible para toda la empresa y escribible solo con el control de alcance total del caso de uso (**NO VERIFICADO**: Motor2 no tiene hoy una función SQL de «alcance total»; el precedente `RecetaVersion` usa `OR "sucursalId" IS NULL`; **decisión técnica 2**).
- Sin `ON DELETE CASCADE`. Sin `DELETE` ni `TRUNCATE` para la app.

**Historia:** la tabla guarda el **estado vigente** (con `version`); la historia completa es la auditoría (`registrarCambioAuditado`, un registro por cambio, antes/después, alcance). «No se borra, se anula»: mostrar = otra escritura, nunca un `DELETE`.

**Migración (PROPUESTA):** `prisma/migrations/<fecha>_ocultamiento_de_producto/migration.sql` + `down.sql` revisado. **Aditiva** (una tabla nueva y sus índices y políticas; no toca ninguna fila ni columna existente). `down.sql`: `DROP TABLE "OcultamientoProducto"` (pierde las marcas cargadas: **declarado**; el estado resultante es «todo visible», que es el de antes de la migración; por eso es reversible en estado aunque no en datos). Compatible hacia atrás: el código viejo no lee la tabla, no se rompe. Aplicar en bases reales **sigue congelado** (O-8).

**Dos disparadores opcionales como Pedernal 0049** (renglón que suma a un oculto; registro de conteo de un oculto): **PROPUESTA de etapa aparte**, sin autorización hasta confirmar la decisión técnica 4. No hacen falta para empezar.

---

## Nivel 7 — Atomicidad y concurrencia

**Ocultar (una transacción, fijar el estado):**
1. Autorizar (permiso y alcance) → validar ids (formato, existencia **en la empresa**).
2. **Bloquear la fila del producto** (`tomarFilaDeProducto`, `FOR UPDATE`; patrón existente): ocultar y desactivar a la vez, o dos ocultar, se ponen en fila.
3. Leer la marca actual; si ya está en ese estado → «ya estaba» (sin escribir ni auditar).
4. **Escribir la fila primero** (`INSERT … ON CONFLICT DO UPDATE`, `version + 1`) y **recién entonces** leer la existencia del alcance (como Pedernal): si es distinta de cero → error y **la transacción se revierte** (la fila y la auditoría desaparecen).
5. Auditoría en la misma transacción.

**El cruce delicado (ocultar vs. entrada de stock a la vez).** Pedernal lo resuelve con transacciones serializables y disparadores. Motor2 trabaja en READ COMMITTED en la mayoría de los casos; un control «leo si está oculto, después escribo» **no alcanza solo**: dos transacciones pueden pasar a la vez (una ve «visible», la otra ve «sin existencia»). **PROPUESTA (decisión técnica 5, a validar con la prueba de concurrencia antes de elegir):** los escritores de movimientos que **suman** existencia toman la fila del producto con **`FOR SHARE`** antes de leer la marca, y ocultar la toma con `FOR UPDATE`: o ocultar entra primero (y la entrada ve «oculto» y se rechaza) o la entrada entra primero (y ocultar ve la existencia y se rechaza). Nunca queda «oculto con existencia nueva». Alternativa: ejecutar ambos lados en SERIALIZABLE (como ya hace `anularVentaEnTx`). La elección la decide la prueba de concurrencia, no la opinión.

**Cierre de una cuenta vs. ocultar:** no hay cruce que resolver para el dinero: lo ya cargado se cobra siempre (I-6) y la resta de existencia está permitida (I-5).

### Tabla «¿qué pasa si…?»

| Comando | Repetición (clic doble, reintento) | Concurrencia | Tiempo | Incertidumbre / reintento tras corte | Error parcial | Datos faltantes | Cambio de permisos |
|---|---|---|---|---|---|---|---|
| **Ocultar** (CU-1/2) | Segunda vez: «ya estaba», sin escribir ni auditar | Dos ocultar a la vez: la fila de producto los pone en fila; el segundo ve «ya estaba». Ocultar + entrada de stock: ver arriba (`FOR UPDATE`/`FOR SHARE` o serializable); ocultar + desactivar: en fila por la fila del producto | La hora la pone el reloj de la acción, no el cliente | Un corte antes del commit no deja nada; reintentar es seguro (fija estado) | Si falla la comprobación de existencia o la auditoría, **se revierte todo** (la fila no queda) | Producto o sucursal inexistente, de otra empresa o fuera de alcance: «no encontrado»; sucursal inactiva: se rechaza (como `exigirSucursalAbierta` de Pedernal; **NO VERIFICADO** el equivalente de Motor2) | Se evalúa en **cada** llamada; si le sacan el permiso, la próxima se rechaza; lo ya hecho no se revierte |
| **Mostrar** (CU-3) | «ya estaba» | Mostrar vs. ocultar a la vez: gana el último en tomar la fila; ambos terminan en un estado válido | Ídem | Seguro de reintentar | Idéntico | Si la sucursal fue desactivada, se puede mostrar (no hay condiciones) | Ídem |
| **Agregar línea nueva** (CU-4) | Es una línea nueva con su id de línea; el mismo id repetido ya lo resuelve la idempotencia de `agregarItems` (sin cambios) | Ocultar a la vez que se agrega: o se agrega o se rechaza con «oculto»; nunca una línea a medias (misma transacción que lee la marca) | La marca se lee **en el momento de agregar**; no se revalida lo ya cargado | Un reintento tras corte da lo mismo que el primero | Una línea rechazada no deja nada; en una promo con varias líneas, **todo o nada** (comportamiento actual de `agregarItems`) | Falla la lectura de la marca → **no agrega** (falla cerrado) | Si cambió el permiso de vender, lo decide `agregarItems` como hoy |
| **Cobrar cuenta con línea ya cargada** (CU-5) | Igual que hoy (idempotencia de cierre) | Ocultar a la vez: el cobro **no** mira la marca | Precio congelado de la línea | Igual que hoy | Igual que hoy | — | Igual que hoy |
| **Anular venta** (CU-6) | La anulación ya es idempotente por estado (`YA_ANULADA`); un rechazo por oculto no escribe nada | Anular vs. ocultar a la vez: la anulación corre **serializable** (ya lo hace); ocultar se pone en fila por producto | La marca se lee dentro de la transacción de anular | Reintentar tras corte: mismo resultado | Si **un** producto de la venta (o de sus hermanas, o adicionales) está oculto: **se rechaza toda la anulación antes de escribir** (todo o nada) | Producto sin fila de marca = visible | Anular conserva su permiso actual; **no** se agrega un permiso |
| **Entrada que suma** (CU-7) | La clave de reintento de movimientos ya lo cubre | Ver «cruce delicado» | Reloj del movimiento | Idem | Todo el movimiento o nada (ya es así); un renglón rechazado rechaza el movimiento | — | Idem |
| **Contar** (CU-8) | Ya lo cubre la clave de idempotencia del conteo | Contar vs. ocultar: ocultar rechaza con existencia ≠ 0 | — | — | — | — | — |

---

## Nivel 8 — Acceso e interfaces

**8.1 Permisos (mapa PROPUESTA; la regla «solo administración para la empresa» está CONFIRMADA, O-10).** Pedernal usa dos acciones; Motor2 tiene su propio catálogo. **Primero la opción más barata:** reutilizar `producto_disponibilidad` (Editar) para ocultar y mostrar **en una sucursal** (operador y admin, como hoy para Desactivar); y para **toda la empresa** exigir, además de esa clave, el **rol de gerencia con alcance total** (hoy `admin`). Una clave nueva (por ejemplo para «ocultar en toda la empresa») sería una migración de datos (como `20261104111000_permiso_declarar_pago_compra`) y se evita (O-10: solo `admin`, sin permiso nuevo).

**8.2 Dónde está el botón (PROPUESTA, la opción más barata).** En la **ficha del producto**, en la misma tabla por sucursal donde hoy están «Disponible: Sí/No» y el botón Activar/Desactivar (`src/app/(app)/catalogo/productos/[id]/page.tsx`): la columna «Disponible» pasa a **«Activo»** y se suma **«Oculto»** con su botón «Ocultar / Volver a mostrar»; una fila o un bloque «Toda la empresa» para el alcance de empresa. Una sucursal que ve «oculto en toda la empresa» no tiene botón para mostrar. **Pantalla propia o integración en la carta: no** (no se pidió). Maqueta: por regla del 2026-11-05 se arma con la pantalla real sobre una base descartable cuando llegue el código.

**8.3 Textos (PROPUESTA; los de Pedernal cuando existen).** «Este producto está oculto.» (rechazo de línea nueva y de anulación, O-5); «oculto en toda la empresa» (sucursal que no puede mostrar); error al ocultar con existencia: «No se puede ocultar «{nombre}»: tiene existencia (…). Dejala en cero con un ajuste antes de ocultarlo.» (estructura del mensaje de `TIENE_DEPENDENCIAS`, **NO VERIFICADO** el texto exacto de Pedernal: leer `ZuluHub-docs` antes de escribirlo). Los textos de «Desactivar»: ver etapa E1.

**8.4 Lectores (una sola definición, I-12).** Un puro `ocultoPor(filas, sucursalId)` (copia del `ocultoPor` de Pedernal `src/modulos/catalogo/dominio/carta-publica.ts`) y un `whereNoOcultoEn(sucursalId)` junto a `whereDisponibleEn`; un guardián que prohíba escribir la relación a mano fuera de ese archivo (como `disponibilidad-en-un-solo-lugar.test.ts`).

**8.5 Qué lugares leen la marca** (inventariados en el código; **NO VERIFICADO** que no haya otros — el guardián de combinaciones del nivel 10 los obliga a declararse):

| Lugar | Archivo | Cambio propuesto |
|---|---|---|
| Carta pública | `src/server/lecturas/carta/menu.ts` (`whereDisponibleEn`) | Agregar `whereNoOcultoEn` |
| Selector del salón y buscador del POS | `src/server/lecturas/pos/selector-carta.ts` y el buscador con `soloDisponibles` | Ídem |
| Agregar ítems (salón, cuenta, mostrador-cuenta) | `src/server/actions/pos/casos-de-uso/agregar-items.ts:146` | Rechazo para líneas **nuevas** |
| Venta directa de mostrador | `registrar-venta-en-tx.ts` (llamada desde `venta.ts`) | Ver pregunta técnica 6: **NO se rechaza al cobrar** una línea ya cargada; **sí** si es una venta directa nueva |
| Conteos | `registrar-conteo-fisico.ts:105` y las listas de qué contar (`FrecuenciaConteoProducto`) | Rechazo y exclusión de la lista (qué listas existen: NO VERIFICADO) |
| Movimientos que suman | `armar-linea-de-movimiento.ts` y los cuatro escritores | Rechazo con saldo final > 0 |
| Anulación | `anular-venta.ts` (hueco, ver E5) | Rechazo (I-7) |
| Reclasificar, traspaso (destino), aceptar propuesta de factura | `reclasificar-stock.ts:102`, `producto-transferible.ts`, `aceptar-propuesta-de-factura.ts:70` | Suman existencia al destino: mismo control |
| **No cambian** | consolidado, valuación, rendimiento de recetas, reportes, ofertas de proveedor | Sin cambio (Pedernal no los lista) |

## Nivel 9 — Consultas y experiencia

- **Ficha del producto:** por sucursal, «Activo: Sí/No» y «Oculto: Sí/No/oculto por la empresa»; quién y cuándo lo cambió por última vez (de la fila: `actualizadoPor`, `actualizadoEn`).
- **Lista de productos:** el filtro de «visibles/ocultos» **no se agrega** (no se pidió); una columna «Oculto» solo si el dueño la pide (PROPUESTA de no hacerlo).
- **Carta, salón, mostrador:** el producto oculto simplemente **no aparece** (sin mensaje); un rechazo de línea nueva dice «Este producto está oculto.».
- **Conteo:** no aparece en la lista de lo que se puede contar.
- **Estado «pendiente de completar»:** no aplica (no hay dato que inventar: sin fila = visible).
- **Móvil (375 px):** la tabla de la ficha debe seguir usable; se verifica con captura sobre datos reales al construir (regla del 2026-11-05).
- **Rendimiento:** una lectura adicional por producto y sucursal; en listados se resuelve con **un** `none/some` por consulta (como `whereDisponibleEn`), sin N+1.

## Nivel 10 — Pruebas, migración y operación

### 10.1 Etapas de implementación, la más barata primero

| Etapa | Qué | ¿Migra? | Depende de | Estado |
|---|---|---|---|---|
| **E0** | Confirmar la lectura de niveles 1 a 5 (las tres preguntas de negocio ya están respondidas, O-10 a O-12) | No | — | PENDIENTE del dueño (niveles 1 a 5); preguntas CONFIRMADAS |
| **E1** | **Vocabulario «Desactivar»**: encabezado y botón de la ficha, descripción del permiso `producto_disponibilidad` («Marcar un producto como disponible o no disponible» → «Activar o desactivar un producto en una sucursal»), mensajes («no está disponible en «X»» → «está desactivado en «X»» en los puntos del inventario), pantalla de mantenimiento de la carta solo (P-3: sigue con Desactivar «por ahora», O-12: no se toca). Regenerar con motivo declarado los goldens que lo fijan (`caracterizaciones-congeladas`, `test/carta`, `test/reportes`) | **No** | E0 (el texto exacto de cada mensaje) | PROPUESTA; el cambio de nombre es CONFIRMADA (O-1) |
| ~~E1b~~ | ~~Hueco para el producto desactivado en `anularVentaEnTx`~~ | — | — | **SIN EFECTO** (O-11: lo desactivado se sigue permitiendo, como Pedernal) |
| **E2** | **Núcleo puro y oráculo**: `ocultoPor`, `decidirSobreProducto` (función pura con las dimensiones del §10.2), la tabla oráculo escrita aparte del código y el test que recorre **todas** las combinaciones. Sin tabla ni pantalla | **No** | E0 | PROPUESTA |
| **E3** | **Tabla `OcultamientoProducto`** (nivel 6) + RLS + registro en los guardianes + acción Ocultar/Mostrar con auditoría + columna «Oculto» y botón en la ficha | **Sí** (una, aditiva, con `down.sql`) | E0 y niveles 1 a 5 confirmados | PROPUESTA; autorización de la regla del 2026-11-15 (O-8) |
| **E4** | **Venta**: rechazo de línea nueva en `agregarItems` y venta directa; carta pública y selectores filtran | No | E3 | PROPUESTA |
| **E5** | **Stock**: control de «suma existencia» en los escritores, conteo, traspaso destino, reclasificar, propuesta de factura; **anulación (hueco para oculto)**; comprobación de existencia al ocultar; bloqueo `FOR SHARE`/`FOR UPDATE` | No | E3 | PROPUESTA |
| **E6** (opcional) | Dos disparadores en la base como Pedernal 0049 | **Sí** (aditiva, con `down.sql`) | E5 + decisión técnica 4 | PROPUESTA, sin fecha |

E1 y E2 se pueden hacer **antes** de tener la tabla y no migran. La única migración obligatoria es E3.

### 10.2 Combinaciones (regla del 2026-10-28): dimensiones y oráculo

**Dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock** (todas declaradas; el guardián de más abajo obliga a declarar cualquier dimensión nueva):

| Dimensión | Valores |
|---|---|
| D1. Desactivar (`DisponibilidadProducto`) | activo / desactivado (incluye «sin fila») |
| D2. Ocultar, efectivo en la sucursal | ninguno / solo el local / solo la empresa / local y empresa (colapsa en «oculto» o «no», pero se recorren los cuatro) |
| D3. Existencia del producto en el alcance | cero / mayor que cero / negativa |
| D4. Conteo registrado sin resolver (solo si se verifica §4.6) | no / sí |
| D5. Receta vigente de un plato disponible que lo usa | no / sí |
| D6. Operación | agregar línea nueva en salón · agregar línea nueva en cuenta de mostrador · venta directa de mostrador · cobrar línea ya cargada · anular venta · entrada que suma · salida que resta · corregir un negativo hasta cero · contar · carta pública · selector del POS · ocultar · mostrar · desactivar · activar |
| D7. Quién | operador de ese local / operador de otro local / admin con alcance total / sin permiso |

Recorrido: 2 × 4 × 3 × 2 × 2 × 15 = **1.440 combinaciones** de D1 a D6 (más D7 por operación): **exhaustivo** sobre la función pura (milisegundos); en la base real, una **muestra por pares** y los casos de las pruebas de integración (no se corre el producto cartesiano contra la base).

**Oráculo (tabla de reglas esperadas, escrita aparte del código; resumen):**

| Regla | Operación | Condición | Resultado esperado |
|---|---|---|---|
| R-1 | Carta pública, selector POS | D1 = activo **y** D2 = ninguno | Aparece |
| R-2 | Carta pública, selector POS | D1 = desactivado **o** D2 ≠ ninguno | No aparece |
| R-3 | Agregar línea nueva (salón, cuenta, directa) | D2 ≠ ninguno | Rechazo «Este producto está oculto.» (gana sobre «no disponible» si D1 también lo impide: **decisión técnica 7**) |
| R-4 | Agregar línea nueva | D2 = ninguno **y** D1 = desactivado | Rechazo «está desactivado» (como hoy) |
| R-5 | Cobrar línea ya cargada | cualquier D2 | Se cobra; la existencia resta (D1 = desactivado sigue rechazando **como hoy**: Desactivar no cambia, O-1) |
| R-6 | Entrada que suma | D2 ≠ ninguno **y** saldo final > 0 | Rechazo |
| R-7 | Salida que resta / corregir negativo hasta cero | cualquier D2 | Permitido |
| R-8 | Anular venta | D2 ≠ ninguno **y** el producto devuelto quedaría con saldo > 0 | Rechazo «Este producto está oculto.» |
| R-9 | Anular venta | D1 = desactivado, D2 = ninguno | **Se permite** (O-11, igual que Pedernal); el hueco de desactivado **no se cierra** |
| R-10 | Contar | D2 ≠ ninguno | Rechazo; no aparece en la lista |
| R-11 | Ocultar | D3 ≠ cero en el alcance | Rechazo por existencia; no queda fila |
| R-12 | Ocultar | D3 = cero | Se oculta (con permiso) |
| R-13 | Ocultar en la empresa | D7 ≠ admin con alcance total | Rechazo por permiso |
| R-14 | Ocultar en un local | D7 = operador de otro local | Rechazo por alcance |
| R-15 | Mostrar | cualquiera | Permitido; si la empresa lo oculta, un local no puede mostrar |
| R-16 | Desactivar | D3 ≠ cero **o** D5 = sí | Bloqueo (**como hoy**, no cambia) |
| R-17 | Ocultar | D5 = sí | **Permitido** (Ocultar no mira recetas; Desactivar sí) |
| R-18 | Independencia | cualquier cambio de D2 | D1 queda igual, y al revés |

**Guardián de dimensiones nuevas:** un test del estilo de `semantica-sin-fila.test.ts` que falle si aparece (a) una columna o relación nueva en `OcultamientoProducto` o en `DisponibilidadProducto`, (b) un archivo nuevo de `src/` que lea la marca o llame a `productoDisponibleEn` y no figure en la tabla de §8.5, (c) un valor nuevo de D6, **sin declarar si afecta o no**.

### 10.3 Pruebas

| Tipo | Qué | Dónde |
|---|---|---|
| Puras | `ocultoPor` (empresa y local, hereda un local nuevo, un local no muestra lo que oculta la empresa); `decidirSobreProducto` exhaustivo contra la tabla oráculo (1.440) | `test/catalogo/` y `test/core/` |
| Integración (base de pruebas) | Ocultar con existencia positiva y negativa (rechaza, **no queda fila ni auditoría**); ocultar sin existencia; mostrar; «ya estaba» (sin auditar); producto de otra empresa; sucursal fuera de alcance; operador oculta en otro local → rechazo; operador oculta en la empresa → rechazo | `test/catalogo/ocultar-producto.test.ts` |
| Venta | Línea nueva de un oculto (local y empresa) rechazada y **sin dejar nada**; lo ya cargado se cobra; unir y dividir cuentas con un producto ocultado después sigue funcionando; mostrar de nuevo reabre; ocultar en un local no toca otros ni otra empresa | `test/pos/producto-oculto-en-ventas.test.ts` |
| Stock | Entrada, compra, producción, traspaso entrante y ajuste positivo rechazados; salidas y corrección de negativo permitidas; un oculto no se cuenta; ocultar en un local no frena a los otros | `test/stock/producto-oculto-en-stock.test.ts` |
| **Anulación (el hueco)** | Anular la venta de un producto ocultado después: rechazo y **nada escrito** (ni reversión ni auditoría); anular con saldo negativo que no pasa de cero: permitido; venta con hermanas y adicionales: se rechaza **toda** la anulación; tras «mostrar» la anulación pasa; **con Desactivado (y no oculto): se permite** (O-11) | `test/movimientos/anular-venta-producto-oculto.test.ts` |
| **Concurrencia** | (a) ocultar vs. entrada que suma, en paralelo y repetido: nunca queda oculto con existencia nueva (una de las dos pierde); (b) dos ocultar a la vez: una fila, un registro de auditoría; (c) ocultar vs. desactivar; (d) ocultar vs. agregar línea: «se agregó» o «oculto», nunca a medias; (e) anular vs. ocultar | `test/concurrencia/` |
| **Idempotencia** | Ocultar dos veces seguidas y desde dos pestañas: un solo cambio, un solo registro; anular dos veces: el comportamiento de hoy | idem |
| Aislamiento / RLS | La tabla sin alcance no se ve ni se escribe; una empresa no ve la marca de otra; una sucursal fuera del alcance no se escribe; fila de empresa visible en todas las sucursales | `test/aislamiento/` |
| Guardianes | `semantica-sin-fila` (nueva entrada, familia `optout`), `cerco-dueno-unico-por-modelo` (línea de base), `escrituras-auditadas`, `ensanches-de-alcance`, «un solo lugar» para `whereNoOcultoEn`, dimensiones nuevas (§10.2), `migraciones` (la migración trae su `down.sql`) | `test/arquitectura/` |
| Migración | Aplicar y revertir sobre una copia descartable: sin errores, sin tocar filas ajenas, `down.sql` deja el esquema de antes | procedimiento de `docs/deploy-con-migraciones.md` |

### 10.4 Diferencias declaradas con Pedernal (cada una con su motivo)

| # | Diferencia | Motivo | Estado |
|---|---|---|---|
| D-1 | Nombre de la tabla: `OcultamientoProducto` (Pedernal: `disponibilidad_de_producto`) | Motor2 ya tiene `DisponibilidadProducto` con el sentido **contrario** (sin fila = no); renombrarla toca decenas de archivos, políticas RLS y pruebas fijadas, y no cambia el comportamiento que pidió el dueño (O-1) | PROPUESTA (pregunta técnica 8) |
| D-2 | Desactivar es **por sucursal** (Motor2) y global en el producto (Pedernal: `producto.activo`) | Es lo ya construido y el dueño pidió que no cambie (O-1) | CONFIRMADA |
| D-3 | «Conteo abierto con cargas» no se puede igualar | Motor2 no tiene esa figura (§4.6); se traduce a existencia distinta de cero y, si se verifica, a conteo sin resolver | PROPUESTA; **NO VERIFICADO** |
| D-4 | Permisos: Pedernal `vidrieras.marcar_disponibilidad` y `vidrieras.editar` con tres roles; Motor2 `producto_disponibilidad` con `admin` y `operador` | Catálogo de permisos propio de Motor2 | PROPUESTA (§8.1, O-10) |
| D-5 | El control de «suma existencia» corre **en el código** de los escritores primero; Pedernal lo tiene además como disparadores en la base | Prisma y la forma del código de Motor2; los disparadores quedan como etapa E6 opcional | PROPUESTA (decisión técnica 4) |
| D-6 | `version` la sube la acción (Pedernal: un disparador) | Evitar un disparador más; igual resultado | PROPUESTA (decisión técnica 3) |
| D-7 | Un solo mensaje por regla; Desactivar sigue bloqueando por receta y saldo (Pedernal: por existencia y conteo) | Es lo ya construido (O-1) | CONFIRMADA |

### 10.5 Riesgos

1. **Vocabulario:** hoy «oculto» en Motor2 (carta, ticket) significa otra cosa. Si no se cuida, el cliente confunde «oculto en la carta» con «Ocultar». Mitigación: el botón y los mensajes dicen **«Ocultar»** y **«oculto»** solo para esta marca; los textos de contenido de carta no se tocan (no se pidió).
2. **Concurrencia en READ COMMITTED:** si se implementa solo «leo y rechazo», queda la carrera del nivel 7. Por eso la prueba de concurrencia (a) es **obligatoria** antes de dar E5 por hecha.
3. **Un lugar que lee disponibilidad y nadie declaró:** el guardián de dimensiones lo detecta.
4. **Goldens:** E1 cambia textos fijados en pruebas de caracterización; se regeneran **con motivo declarado**, nunca a ciegas.
5. **Pantalla de mantenimiento de la carta** usa Desactivar como «agotado hoy»; el dueño dijo que siga así «por ahora» (O-12). Pasarla a Ocultar (como el «agotar de un toque» de Pedernal) sería otro pedido.
6. **Anular una venta ya cobrada** de un producto que se ocultó después queda **bloqueada hasta volver a mostrar** (decisión de Pedernal, O-5): es una molestia buscada; el mensaje debe decir qué hacer.

### 10.6 Cómo lo probaría el dueño (cuando se construya, sin leer código)

1. Ocultá el Producto A **sin existencia** en la Sucursal 1: tiene que desaparecer de la carta, del salón y de la lista de conteos de esa sucursal, y seguir apareciendo en la Sucursal 2.
2. Intentá ocultar un producto **con existencia**: te tiene que decir que primero la dejes en cero, y **no** quedar oculto.
3. Abrí una cuenta con el Producto A, ocultalo desde otra pestaña y cobrá la cuenta: se cobra normal.
4. Intentá agregar el Producto A a otra cuenta: «Este producto está oculto.».
5. Anulá esa venta: «Este producto está oculto.»; volvelo a mostrar y anulá de nuevo: pasa.
6. Hacé clic **dos veces seguidas** en «Ocultar»: no pasa nada raro ni se duplica nada.
7. Ocultalo desde **dos pestañas a la vez**: una dice «ya estaba»; hay un solo cambio en la auditoría.

---

## Respuestas del dueño a las preguntas de negocio (2026-11-15)

Las tres preguntas que este documento dejó abiertas quedaron **respondidas el 2026-11-15** (chat del dueño con el orquestador; opciones elegidas; relatado por el orquestador):

- **P-1 (permisos de empresa):** «Solo administración (Recomendada)». **CONFIRMADA** (O-10): solo `admin` oculta en toda la empresa; el operador, solo en sus sucursales; sin permiso nuevo.
- **P-2 (anular con producto Desactivado):** «Permitir, igual que Pedernal (Recomendada)». **CONFIRMADA** (O-11). Es la opción B del borrador de este documento: solo se bloquea anular cuando el producto está **Oculto**; el hueco de desactivado **no se cierra** (la etapa E1b queda sin efecto).
- **P-3 (pantalla «Sin stock hoy»):** «Sigue con Desactivar por ahora (Recomendada)». **CONFIRMADA** (O-12).

**Preguntas de negocio abiertas hoy: ninguna.** Siguen abiertas las decisiones técnicas de abajo (no se le preguntan al dueño).

## Decisiones técnicas (con recomendación; no se le preguntan al dueño)

1. **Anular con oculto: «saldo final por encima de cero» o «siempre».** Recomendación: **como Pedernal** (rechaza solo si el producto quedaría con saldo > 0; una venta que dejó el saldo negativo se puede anular hasta cero), porque es el mecanismo real de 0049 y evita atrapar al cajero en un caso sin salida.
2. **RLS de la fila de empresa:** política con `OR "sucursalId" IS NULL` para leer (precedente `RecetaVersion`) y control de alcance total **en el caso de uso** para escribir; una función SQL de «alcance total» solo si una prueba de aislamiento muestra un hueco. NO VERIFICADO que haga falta.
3. **Forma de la tabla nueva (E5 del plan):** id de la aplicación (uuid), fechas con zona, `version` subida por la acción, no se borra. El plan declara que **no hay decisión del dueño que diga «uuid» o «timestamptz» como tales**: se sigue la ratificación en dirección del 2026-11-15 («E5 forma de los datos nuevos»); si el dueño la corrige, se ajusta.
4. **Disparadores en la base (como 0049):** recomendación, **no en la primera entrega**; primero el control en código en los cuatro escritores y las pruebas de concurrencia. Si la prueba muestra que READ COMMITTED no alcanza, pasan a ser obligatorios (E6).
5. **Mecanismo del cruce ocultar vs. entrada:** `FOR UPDATE` en ocultar y `FOR SHARE` en los escritores que suman, **o** SERIALIZABLE en ambos; lo decide la prueba de concurrencia (a) del §10.3.
6. **Venta directa de mostrador (`registrarVenta`) vs. línea ya cargada:** el rechazo va en el **alta de la línea** (`agregarItems`, venta directa nueva), **no** en `registrarVentaEnTx` cuando se cierra una cuenta (ahí la línea ya está cargada y se cobra, I-6). Hay que separar los dos usos de `registrarVentaEnTx` (viene de la cuenta o de la venta directa); **NO VERIFICADO** si hoy se distinguen.
7. **Qué mensaje gana si un producto está a la vez Desactivado y Oculto:** recomendación, **el de desactivado** (es la regla más fuerte y la de hoy; Ocultar no se muestra si ya no opera por Desactivar).
8. **Nombre interno del modelo:** `OcultamientoProducto` y dejar `DisponibilidadProducto` con su nombre; renombrar la tabla vieja a algo como `DesactivacionProducto` sería una migración con efecto en RLS y guardianes y **no cambia lo que ve el dueño**; queda como etapa posterior con nombre si algún día confunde.
9. **`conteo abierto` (§4.6):** no implementar hasta verificar qué es `EstadoConteo.PENDIENTE`; hoy la regla de existencia cubre el pedido.
10. **Ancla de adicional (I-15):** tratar como cualquier producto; si la prueba muestra que ocultarla rompe una venta por adicional, se rechaza ocultarla con el mismo criterio que activarla.

## Lo que se verificó y lo que no

**Verificado (V):** el modelo y la semántica de `DisponibilidadProducto`; el caso de uso de Desactivar y su permiso; los puntos que rechazan un producto no disponible; el hueco de `anularVentaEnTx`; los cuatro escritores de movimientos; `ConteoFisico` y su ausencia de «conteo abierto»; los guardianes de arquitectura que obligan a declarar un modelo nuevo; el precedente de RLS con fila de empresa; en Pedernal, `0043`, `0049`, `ocultar-producto.ts`, `cotizar-para-vender.ts`, que anular un oculto lo rechaza **el disparador**, y que no hay rechazo por desactivado; en los documentos de Pedernal, la Revisión 3 de la carta real y la decisión del 2026-11-13.

**NO VERIFICADO:** qué es `EstadoConteo.PENDIENTE`; si existe una lista de «qué contar» que haya que filtrar; el equivalente en Motor2 de «sucursal abierta»; si la venta directa y el cierre de cuenta comparten el punto de rechazo (decisión técnica 6); el texto exacto del error de Pedernal al ocultar con existencia; si hace falta una función de «alcance total» en SQL; cuántos goldens fijan los textos de «no disponible».
