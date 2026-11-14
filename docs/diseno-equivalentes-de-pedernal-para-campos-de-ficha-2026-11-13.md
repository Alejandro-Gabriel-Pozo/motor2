# Diseño: el equivalente de Pedernal para cuatro campos de la ficha de producto (2026-11-13)

> Diseño en papel, escalera de 10 niveles (AGENTS.md), con la **compuerta**: no se diseñan ni migran tablas (nivel 6) sin tener confirmados los niveles 1 a 5. **No se escribió código, ni migraciones, ni se tocó ninguna base.** Congelamiento de producción vigente.
>
> **Marcas.** **VERIFICADO** (archivo:línea): lo leí en el código de Motor2. **CONFIRMADA**: lo dijo el dueño, con cita. **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**. Del lado de Pedernal solo leí `zuluhub-docs` (al día, commit `80828e9`, 2026-11-13 22:59 UTC): no pude leer `ZuluHub-ERP` (el `add_repo` fue denegado), así que lo que cito de su código viene de las fichas y va marcado **(ficha de Pedernal)**.
>
> Parte de `docs/investigacion-campos-de-ficha-que-pedernal-no-muestra-2026-11-13.md` (qué hace hoy cada campo, quién lo usa y qué se rompe si se saca).

## 0. Resumen para el dueño

**Lo que decidió (2026-11-13, chat con el orquestador, preguntas con opciones):** para **hermanar**, **factor de conversión**, **producto de respaldo** y **consignación** → «Pedir el equivalente de Pedernal para cada uno» (rediseño grande, **etapa con nombre, NO ahora**); para **observaciones** → «Ocultarlo con interruptor reversible (Recomendada)». **Supuesto declarado (el dueño lo corrige):** mientras esos equivalentes no existan, los cuatro campos quedan en la ficha donde están hoy (dentro de «Datos», que la sesión de productos reordena).

| Campo | Equivalente de Pedernal | Lo que Motor2 **ya tiene** | Etapa más barata | Migración |
|---|---|---|---|---|
| **Observaciones** | ninguno (se oculta) | el campo | Interruptor `OBSERVACIONES_VISIBLES = false` | **Ninguna** |
| **Hermanar** | un solo producto con **ofertas de proveedor** (decisión 70) | `ProveedorPorProducto` (la oferta ya existe, con otro nombre) | Mostrar las ofertas por producto y que comprar a otro proveedor no pida un producto nuevo | Ninguna al principio; **sí** para fusionar productos ya hermanados |
| **Factor de conversión** | **presentación de compra** (nombre + cantidad fija en la unidad base, decisión 92) — **CONFIRMADA: presentación por producto**; el diseño del 03/11 queda **REVOCADO** | `Presentacion` (por producto; **el dueño decidió hoy volver a mostrarla**) | Construir sobre `Presentacion` (§2) | **Sí**, aditiva (nombre propio, peso variable, la oferta apunta a la presentación) |
| **Producto de respaldo** | el adicional = **recargo + «qué consume»**, sin producto | `ConsumoDeOpcion` (SUMA/REEMPLAZA, versionado) ya existe | Verificar cómo descuenta hoy un adicional | **Sí** (`OpcionDeGrupo.productoId`) |
| **Consignación** | **ninguno**: Pedernal no lo tiene (decisión 54) | todo el circuito | **CONFIRMADA: se mantiene en Motor2 como está** (diferencia declarada con Pedernal) | Ninguna |

**Orden de etapas** (de lo que no migra a lo que sí): **A** observaciones (interruptor) → **B** hermanar sin migración → **C** presentación por producto → **D** adicional sin producto → **E** fusionar productos hermanados (datos) → **F** consignación (según la pregunta). Cada etapa con migración **requiere autorización expresa del dueño**, respaldo y ensayo en copia de Neon (nunca la rama principal). **Ninguna se implementa ahora.**

**Datos reales:** **NO VERIFICADO**. No tengo acceso a la copia de Neon; el orquestador contó otras tablas (categorías, objetivos, recetas) pero **no** estas. En §7 dejo las consultas de solo lectura exactas para contarlas.

---

## 1. Hermanar → pool de artículos con ofertas de proveedor (decisión 70)

### N1. Propósito y necesidad
| Necesidad | Quién y dónde | Estado |
|---|---|---|
| Que la misma materia prima de varios proveedores sea «como un pool», con el mismo nombre para el usuario «pero para la compra que pueda guardar información del proveedor», y que «nos venden por caja y cobran por kilo» | Dueño, 2026-11-08, chat; decisión 70 (`zuluhub-docs/11-especificaciones/catalogo-y-niveles-maqueta.md:1360`) | CONFIRMADA para Pedernal |
| Sobre los sustitutos por línea de Motor2: «le parecía que eran para hermanos (dos proveedores de nalga), que eso ya está resuelto y que duda de que resuelvan un problema real» | Dueño, 2026-11-08 (`catalogo-y-niveles-maqueta.md:86`) | CONFIRMADA (dato de contexto) |
| «Pedir el equivalente de Pedernal para cada uno» (no ahora) | Dueño, 2026-11-13, chat con el orquestador | CONFIRMADA |

**Alcance:** el pool y las ofertas. **Fuera:** cualquier función de compras no pedida (pedidos, órdenes, conciliación, ficha del proveedor).

### N2. Actores
Quien carga compras (la oferta nace con la compra), quien edita productos (permiso de producto actual) y administración (para fusionar). **Sin claves nuevas** (los pisos no se cambian por configuración: ADR-008, ADR-027).

### N3. Casos de uso
CU-H1 comprar la misma materia prima a **otro proveedor** sin crear otro producto: la compra crea/actualiza la **oferta**; CU-H2 ver «Proveedores del producto» con el **costo por unidad de stock** de cada uno («Más barato por unidad», Pedernal `proveedoresDelProducto`, ficha de Pedernal `e9-compras-especificacion.md:240`); CU-H3 **fusionar** dos productos ya hermanados en uno; CU-H4 retirar el asistente de «hermanar».

### N4. Conceptos y ciclo de vida
- **Pedernal (ficha de Pedernal, `e9-compras-especificacion.md:112`):** `oferta_de_proveedor`, clave `(empresa, proveedor, producto, presentación)` (`NULLS NOT DISTINCT`), con `precio_por_tipo`, `unidad_de_precio`, `ultimo_precio`, `ultimo_costo_por_unidad_de_stock`, `ultima_compra_id`, `ultima_compra_en`. **«La actualiza la propia compra»** con `INSERT … ON CONFLICT DO UPDATE … WHERE excluded.ultima_compra_en >= oferta.ultima_compra_en` (la compra más nueva gana aunque lleguen invertidas); **no hay alta manual** (S-6). El artículo de stock es **uno por producto y sin distinguir proveedor** (`articulo-de-stock.md`).
- **Motor2 (VERIFICADO, `prisma/schema.prisma:723-746`):** `ProveedorPorProducto`, clave `(productoId, proveedorId, unidadCompraId)`, con `precioUnitario` (el que cobra el proveedor en esa unidad de compra), `precioPorUnidadStock` (normalizado), `ultimaCompra` y `referenciaProveedor` (cómo llama ese proveedor al producto); se escribe con un **upsert atómico** (`INSERT … ON CONFLICT DO UPDATE`, `src/server/actions/proveedor-por-producto.ts` según el comentario del modelo: la ruta exacta **NO VERIFICADA**: el archivo no está en `src/server/actions/` de esta rama; las lecturas están en `src/server/lecturas/catalogo/ofertas-de-proveedor.ts` y `vinculos-de-proveedor.ts`). **Ya es la oferta de Pedernal con otro nombre.** Diferencias: la clave usa la **unidad de compra** (Unidad) y no una presentación; no hay `de_peso_variable`; no hay `ultima_compra_id`; **la regla «la compra más nueva gana aunque lleguen invertidas» no está verificada** en Motor2.
- **Hoy, el «hermanar» de Motor2 es otra cosa:** `Producto.insumoId` → `Insumo` (`schema.prisma:383-384,512`) reúne **productos distintos** que son lo mismo; el asistente `src/components/catalogo/asistente-hermanar.tsx` crea o reutiliza ese Insumo. Pedernal no tiene el problema porque **no crea el segundo producto**.

### N5. Invariantes y políticas (PROPUESTA; todo nace cerrado)
I-H1 una oferta por `(producto, proveedor, presentación o unidad de compra)`: lo impone la base (único). I-H2 la oferta **nace con la compra** y no hay alta manual (igual que Pedernal). I-H3 la compra que llega más vieja **no pisa** a la más nueva (a verificar o implementar). I-H4 el stock de un producto es **uno**, sin distinguir proveedor. I-H5 el costo de la receta usa el último costo de compra del pool (decisión 91; ya es la regla de Motor2: `obtenerCostoActualPorMPDeSucursales`). I-H6 fusionar dos productos **nunca reescribe** el libro de stock ni las ventas (append-only): se mueve el saldo con movimientos nuevos y el producto retirado queda **inactivo** con su historia. I-H7 aislamiento por empresa y permiso en el servidor (como hoy).

### N6. Historia y persistencia (en papel; **compuerta: no se migra hasta confirmar N1 a N5**)
- **Etapa B (sin migración):** el modelo ya existe. Cambios solo de lectura y pantalla: «Proveedores del producto» ordenado por costo por unidad de stock. La comparativa que hoy se arma por **Insumo** (`obtenerComparativaPreciosPorInsumo`, `ofertas-de-proveedor.ts:238-241`) pasa a armarse por **producto**. Para que comprar a otro proveedor no pida un producto nuevo, la pantalla de compra debe dejar **elegir el producto existente**: lo hace (selector de producto); lo que falta es **retirar la tentación de crear uno nuevo** (alta rápida): decisión de pantalla, **NO VERIFICADO** el detalle.
- **Etapa E (con migración de datos): fusionar productos hermanados.** Para cada `Insumo` con más de un `Producto`: elegir un **sobreviviente**; mover sus ofertas (`ProveedorPorProducto`: las filas del retirado pasan al sobreviviente; si chocan con la clave, gana la de `ultimaCompra` más nueva); mover el saldo de stock con **dos movimientos por producto retirado** (salida y entrada al sobreviviente, copiando el costo; **no** se toca el libro histórico); pasar a `inactivo` el retirado; **repuntar** las líneas de receta que lo usan (las recetas son append-only por versión: se crea una **versión nueva**, no se reescribe la vieja); retirar el Insumo. **Es una migración de datos destructiva en la práctica** (cambia qué producto usan las recetas y deja productos inactivos): **requiere autorización expresa**, base por base, con respaldo, **conteo previo** y ensayo en copia. Aditiva/reversible **solo si** se hace con movimientos nuevos y versiones nuevas (el `down` es otra fusión inversa: no es trivial; **declararlo**).
- **Qué pasa con `Insumo`, `Grupo` y los **sustitutos de receta** (`SustitutoRecetaIngrediente`): al haber un solo producto, el **sustituto automático por falta de stock deja de tener sentido** (el dueño ya dudaba el 08/11 de que resuelva un problema real; Pedernal: «no se aplican solas por falta de stock: eso lo resuelve el pool», `catalogo-y-niveles-maqueta.md:812`). **Candidato a poda**: se oculta con un interruptor y recién después se borra, con aviso (regla de poda 2026-10-28). **No se decide acá.**
- El stock «por familia» (`src/core/stock/por-familia.ts`) y el reporte de huecos de catálogo cambian de fuente (de Insumo a producto) o se retiran: **PENDIENTE** de decidir con el dueño qué reportes se conservan.

### N7. ¿Qué pasa si…? (por comando)
**Comprar a otro proveedor (crear/actualizar la oferta)**
| Situación | Resultado |
|---|---|
| Repetición (la misma compra dos veces) | La compra ya es idempotente por su clave; la oferta se escribe igual: no se duplica (único + upsert) |
| Concurrencia (dos compras del mismo producto y proveedor) | Una sola fila; gana la de fecha más nueva (**regla a verificar/implementar**, I-H3) |
| Tiempo (compra con fecha anterior a la última) | No pisa el precio de la oferta; la compra se registra igual |
| Incertidumbre / reintento | El reintento reescribe lo mismo |
| Error parcial | La oferta se escribe **en la misma transacción** que la compra: o todo o nada |
| Datos faltantes (sin precio) | La oferta no se actualiza con precio 0 (como la entrada valorizada: `precioPorUnidadStock > 0`, `comun.ts`) |
| Cambio de permisos | Se verifica en el servidor, como hoy |

**Fusionar dos productos hermanados (etapa E)**
| Situación | Resultado |
|---|---|
| Repetición | Segunda corrida: ya está fusionado, no hace nada (idempotente por producto retirado inactivo) |
| Concurrencia (se vende o se compra mientras se fusiona) | Se toma un candado por empresa y se fusiona **fuera de horario**; si hay movimientos en curso, la fusión se rechaza |
| Error parcial | Todo en una transacción por Insumo; si falla, no queda nada a medias |
| Stock negativo en el retirado | Se rechaza y se avisa (hay que corregirlo antes) |
| Unidades distintas entre los hermanados | Se rechaza (no se mezclan magnitudes) |
| Receta que usa al retirado | Versión nueva con el sobreviviente; la vieja queda |
| Cambio de permisos | Falla cerrada; solo administración |

### N8–N9. Pantallas y consultas (PROPUESTA)
«Proveedores del producto» en la ficha (con «Más barato por unidad»), selector de producto sin tentación de duplicar, y un reporte de «productos candidatos a fusionar» (los de un mismo Insumo). Mobile first a 375 px.

### N10. Pruebas
Dimensiones que cambian dinero o stock: ofertas por producto (1, varias) × orden de llegada de la compra (normal, invertida) × unidad de compra (igual/distinta de la de stock) × fusión (sin stock, con stock, con receta, con unidades distintas). **Oráculo** aparte del código y test exhaustivo de las combinaciones; **guardián** que falla si aparece una dimensión nueva. Concurrencia (dos compras a la vez; una venta durante la fusión), idempotencia (fusión repetida), aislamiento entre empresas, y regresión de costo y stock **idénticos antes y después**.

---

## 2. Factor de conversión → presentación de compra (decisión 92), reconciliada con el diseño del 03/11

### N1. Propósito y necesidad
| Necesidad | Quién y dónde | Estado |
|---|---|---|
| «Compro caja por 23,5 kg, pasan a mi stock los 23,5 kg; compro un pack de 12 gaseosas, pasan 12 unidades a mi stock, no el pack» | Dueño, 2026-11-09, decisión 92 (`catalogo-y-niveles-maqueta.md:1382`) | CONFIRMADA para Pedernal |
| El envase de compra vive **en el vínculo proveedor × materia prima** (opción C): «empecemos con C… etapas E1, E2, E3» | Dueño, 2026-11-03, `docs/diseno-envase-de-compra-en-el-vinculo-2026-11-03.md` | **REVOCADO el 2026-11-13** (ver abajo); nunca se construyó |
| «Falta ocultar las presentaciones» | Dueño, 2026-11-06 (`src/core/catalogo/presentaciones-visibles.ts:1-13`) | CONFIRMADA; interruptor apagado |
| **Volver a mostrar las presentaciones** (interruptor `PRESENTACIONES_VISIBLES`) | Dueño, **2026-11-13**, según el orquestador | CONFIRMADA; **manda sobre la decisión del 03/11** (dato del orquestador; en el código de mi rama el interruptor sigue en `false`) |
| **Q-F: «El de Pedernal: presentación por producto (Recomendada)»** | Dueño, 2026-11-13, chat con el orquestador, preguntas con opciones | **CONFIRMADA**: el diseño propio del 03/11 (envase por proveedor) queda **REVOCADO**; se construye la presentación por producto de Pedernal |
| «Pedir el equivalente de Pedernal» (no ahora) | Dueño, 2026-11-13, chat con el orquestador | CONFIRMADA |

### N4. Conceptos: cómo se comparan los tres modelos
| | Pedernal (ficha de Pedernal) | Motor2 hoy (VERIFICADO) | Motor2 diseño del 03/11 (en papel) |
|---|---|---|---|
| Unidad base | Del producto; no cambia nunca | `unidadStockId` | Igual |
| «Cuánto trae un envase» | `presentacion_de_producto`: `nombre`, `cantidad > 0` en la unidad base, `de_peso_variable`, `activa` (`e9-compras-especificacion.md:110`); **por producto**; «otra cantidad es otra presentación» | `Producto.unidadCompraId` + `factorConversion` (por producto) y `Presentacion` alternativas con su factor (`schema.prisma:619-628`) | Una columna con el factor **en el vínculo `ProveedorPorProducto`** (por producto y proveedor) |
| Quién la define | `productos.editar` (gerente y administrador) en la ficha | Quien tiene `producto_campos_sensibles` (`producto-form.tsx:53,86`) | Quien compra, la primera vez (**riesgo anotado en ese diseño**: hoy es permiso de administrador) |
| La oferta del proveedor | Clave incluye la **presentación** | Clave incluye la **unidad de compra** | Clave incluye la unidad de compra + el factor propio |

**Hallazgo (VERIFICADO): el diseño del 03/11 NO está implementado.** `ProveedorPorProducto` (`schema.prisma:723-746`) no tiene columna de factor; las migraciones de la rama terminan en `20261112170000_nombre_unico_sin_mayusculas` y ninguna toca el envase; `Presentacion` sigue siendo la tabla de alternativas por producto. **La Etapa E1 del 03/11 (columna del factor en el vínculo) no se construyó.**

**Conflicto RESUELTO por el dueño (2026-11-13, chat con el orquestador, preguntas con opciones): «El de Pedernal: presentación por producto (Recomendada)».** Queda **REVOCADO el diseño propio del 03/11** (envase por proveedor, `docs/diseno-envase-de-compra-en-el-vinculo-2026-11-03.md`), que **nunca se construyó** (no hay nada que deshacer), y **manda la decisión de hoy de volver a mostrar las presentaciones**. Para Pedernal, «caja x6» y «caja x12» son **dos presentaciones** del mismo producto y la oferta apunta a la presentación; el diseño del 03/11 se marca como **REEMPLAZADO** en su propio encabezado.

### N5. Invariantes (PROPUESTA)
La unidad base no cambia. La cantidad de una presentación no cambia (otra cantidad = otra presentación). Lo que entra al stock es **siempre** la cantidad convertida a la unidad base, nunca «la caja». La conversión es exacta dentro de la misma dimensión y **nunca entre dimensiones** (decisión 92). El costo por unidad de stock se calcula de la cantidad convertida. Una compra ya hecha **no se reescribe** si cambia un envase (el stock y el costo ya se guardan en unidad de stock: lo afirma el diseño del 03/11).

### N6. Historia y persistencia (en papel; compuerta)
- **Etapa C0 (sin migración): qué hace el interruptor.** Con la decisión de hoy, `PRESENTACIONES_VISIBLES` se **prende** (poner `true`) cuando se construya C1; hasta entonces sigue apagado. El texto de su comentario («el envase de compra pasa a vivir en el vínculo… Q3 opción C») queda **desactualizado** y hay que reescribirlo al implementar (cambio de código, no ahora). Lo comprueba `test/catalogo/presentaciones-interruptor.test.ts` (los dos estados).
- **Etapa C1 (la elegida): sin tabla nueva.** `Presentacion` ya existe por producto con `unidadCompraId` + `factorConversion` (`schema.prisma:619-628`); faltan: un `nombre` propio (hoy el nombre es el de la Unidad), `dePesoVariable` (cantidad aproximada solo para pedir; el stock entra por el peso real) y que la oferta apunte a la presentación (hoy `ProveedorPorProducto` apunta a la unidad de compra). Cambios **aditivos** (columnas con default, nulas en lo existente: «sin dato» no se inventa) y reversibles (`down.sql`), con ensayo en copia. **Requiere autorización expresa** del dueño. La autorización de migraciones del 03/11 («aprobadas siempre y cuando se establezca que son reversibles») valía para **ese** diseño, hoy revocado: **no se extiende** a este sin pedirla.
- **Qué pasa con `Producto.factorConversion` y `unidadCompraId`:** con el modelo elegido quedan como **la presentación por defecto** durante la transición (sin borrar); retirarlos es una etapa posterior destructiva. **No se decide acá.**

### N7. ¿Qué pasa si…? (por comando)
**Agregar una presentación**
| Situación | Resultado |
|---|---|
| Repetición (mismo nombre y cantidad) | Idempotente: ya está (único por producto) |
| Mismo nombre, otra cantidad | **Se rechaza y se pide otro nombre** (CONFIRMADA, dueño, 2026-11-14, chat con el orquestador: «Rechazarlo y pedir otro nombre (Recomendada)»). Texto del rechazo propuesto: «Ya existe una presentación con ese nombre y otra cantidad. Usá otro nombre.» (**APROBADO**, dueño, 2026-11-14, chat con el orquestador: T8, «Aprobar los 2 como están») |
| Concurrencia (dos personas agregan la misma) | Una gana (único); la otra ve que ya existe |
| Cantidad ≤ 0 o decimales fuera de la unidad | Se rechaza con el validador de cantidad |
| Unidad de otra dimensión (peso vs unidad) | Se rechaza |
| Permisos | Se verifica en el servidor. **CONFIRMADA (dueño, 2026-11-14, chat con el orquestador): «Dejar el permiso de hoy y anotar la diferencia (Recomendada)»**: sigue `producto_campos_sensibles`; **diferencia declarada** con Pedernal (gerente y administrador); no se cambia ningún piso |

**Desactivar una presentación usada en compras u ofertas**
| Situación | Resultado |
|---|---|
| Hay compras anteriores | No se reescriben; la presentación queda inactiva y ya no se ofrece |
| Hay una compra abierta que la usa | **NO VERIFICADO** (la ficha de Pedernal tampoco lo sabe, pregunta 2) |
| Interruptor apagado | El servidor rechaza crear o cambiar (comportamiento actual, `MENSAJE_PRESENTACIONES_APAGADAS`) |

**Comprar por presentación (convertir a la unidad base)**
| Situación | Resultado |
|---|---|
| Repetición / reintento | La compra ya es idempotente por su clave; la conversión es la misma |
| Línea que ya trae el id de una presentación con el interruptor apagado | Se sigue resolviendo igual (`cargarPresentacionActiva`): no se cambia en silencio cuánto stock entra |
| Presentación de peso variable | Cantidad aproximada solo para pedir; el stock entra por el **peso real** (decisión 70) |
| Error parcial | Stock, costo y oferta en la misma transacción |

### N8–N10 (resumen)
Pantalla «Cómo se compra» (textos de Pedernal ya aprobados el 09/11: «Presentación», «Cantidad en la unidad base», «Agregar presentación»; **los textos de Motor2 requieren su aprobación**). Pruebas: oráculo de conversiones (caja de 23,5 kg; pack de 12 gaseosas; dimensiones distintas rechazadas), concurrencia (dos altas), idempotencia (compra repetida), regresión de costo idéntico.

---

## 3. Producto de respaldo → el adicional como recargo + «qué consume», sin producto

### N1. Propósito y necesidad
| Necesidad | Quién y dónde | Estado |
|---|---|---|
| El adicional «suma un recargo por cada opción elegida» y cada opción declara **qué consume** (insumo + cantidad) | Decisiones 83, 138, 139 (`grupo-de-opciones.md`, `escala-con-la-medida-y-consumo-por-opcion.md`; ficha de Pedernal) | CONFIRMADA para Pedernal |
| Una opción puede consumir un **elaborado** | Dueño, 2026-11-12 (`decisiones-del-dueno-2026-11.md:91`, decisión 179) | CONFIRMADA |
| «Pedir el equivalente de Pedernal» (no ahora) | Dueño, 2026-11-13 | CONFIRMADA |

### N4. Conceptos: lo que Motor2 ya tiene y lo que sobra
- **Motor2 hoy (VERIFICADO, `schema.prisma:3585-3680`):** `OpcionDeGrupo` (con `productoId` = **ancla**, solo en un ADICIONAL, único por empresa, inmutable), `VersionDeOpcion` (precio: monto o porcentaje; solo se agrega) y `ConsumoDeOpcion` (qué suma o qué reemplaza, cuánto, merma; solo se agrega). **O sea: Motor2 ya tiene el «qué consume» de Pedernal.** Para el ADICIONAL el diseño de 11-09 dice: «solo SUMA y sin escalar (**es la línea hija del producto ancla**)» (`diseno-consumo-de-opcion-en-el-producto-2026-11-09.md:43`).
- **Qué aporta el ancla hoy:** es el **producto que se vende y descuenta stock como línea hija** (comentario del modelo): una línea de venta con su `productoId`, su precio y su stock propio. Por eso el ancla está **exceptuada** de «sin receta no se vende» (`src/core/movimientos/origen-de-stock.ts:29-32`: `seProduce || esAnclaDeAdicional || ingredientes > 0`; ADR-033) y bloqueada en seis acciones (`ES_ANCLA_DE_ADICIONAL`).
- **Pedernal (ficha de Pedernal):** el adicional es solo recargo + consumo; **no hay producto ancla**. El consumo «hoy es solo dato» en el catálogo y el módulo de stock lo lee aparte.
- **NO VERIFICADO (a verificar con `Explore` antes de diseñar el detalle):** cómo se descuenta realmente hoy el stock de un adicional: por la **línea hija del ancla**, por el **`ConsumoDeOpcion` SUMA**, o por **los dos** (riesgo de descuento doble o de dos fuentes de verdad). Es el dato que decide la migración.

### N5. Invariantes (PROPUESTA)
Un adicional lleva recargo ≥ 0,01 y un consumo SUMA sin escalar (ya lo exige `validarConsumos`). El stock de un adicional se descuenta **una sola vez**. Lo vendido antes **no cambia** (la foto de la línea ya congela el precio y las opciones: `OpcionElegidaEnLinea`). El consumo de un elaborado se permite (decisión 179). Sin producto ancla, no hay producto oculto que gestionar.

### N6. Historia y persistencia (en papel; compuerta)
- **Etapa D0 (sin migración): verificar** cómo descuenta hoy un adicional y qué datos reales hay (consultas de §7).
- **Etapa D1 (migración aditiva):** si el adicional ya consume por `ConsumoDeOpcion` y el ancla solo aporta la línea hija: **dejar de crear un ancla para los adicionales nuevos** (la columna `OpcionDeGrupo.productoId` queda NULL en los nuevos: ya es nullable), sin tocar lo existente. Requiere que la venta sepa vender un adicional sin línea hija: **cambio de código y de la regla `origen-de-stock`**, no de esquema.
- **Etapa D2 (migración de datos, destructiva en la práctica):** retirar los anclas existentes: pasar a `inactivo` el producto ancla, poner `OpcionDeGrupo.productoId = NULL` **(la columna es inmutable por diseño: «`grupoId`, `productoId` y `esNinguna` son inmutables (la app no tiene UPDATE)» y hay un `UNIQUE (empresaId, productoId)`)** — **exige una excepción documentada a la inmutabilidad** y **requiere autorización expresa**. Las ventas anteriores **conservan** su línea hija (el producto ancla queda inactivo, no se borra). **Se pierde** la trazabilidad directa opción→producto en lo nuevo.
- **Reversible:** D1 sí (se vuelve a crear ancla para los nuevos). D2 solo si se **guarda** el mapeo opción→ancla antes de anular (en una tabla de respaldo o en el `down.sql`): **declararlo**.

### N7. ¿Qué pasa si…? (por comando)
**Crear un adicional (opción con recargo y consumo)**
| Situación | Resultado |
|---|---|
| Repetición (mismo nombre en el grupo) | Se rechaza (nombre único por grupo, sin mayúsculas) |
| Concurrencia | Una gana (único); la otra ve el aviso |
| Recargo < 0,01 o sin consumo | Se rechaza (`componerPrecioDeLinea` falla cerrado) |
| Consumo que escala con la medida | Se rechaza (un adicional nunca escala) |
| Insumo de otra unidad | Se rechaza (la cantidad va en la unidad de stock del insumo) |
| Error parcial | Opción + versión + consumos en una transacción |
| Cambio de permisos | `opciones_definir`/`opciones_editar` en el servidor, como hoy |

**Vender un adicional (sin ancla, etapa D1)**
| Situación | Resultado |
|---|---|
| Doble clic / reintento | La venta es idempotente por su clave; el consumo se descuenta una vez |
| Stock insuficiente | Como hoy: aviso y pasa (decisión 85: «que pase con aviso») |
| Opción desactivada después de elegida | La línea conserva la foto; lo vendido no cambia |
| Descuento doble (ancla + consumo) | **Imposible por I5** (stock una sola vez); **a verificar** en D0 |

### N8–N10 (resumen)
La ficha del adicional pierde la unidad del «producto de respaldo» (hoy `nueva-opcion-en-el-grupo.tsx` la pide) y muestra recargo + «Qué consume». Pruebas: oráculo grupo (4 clases) × consumo (suma/reemplaza) × ancla (con/sin) × stock (suficiente/insuficiente); regresión de ventas con adicionales (precio, descuento de stock y foto idénticos); concurrencia (dos ventas del mismo adicional); idempotencia.

---

## 4. Consignación → **se mantiene en Motor2 como está (CONFIRMADA)**

**Pedernal no tiene equivalente.** Decisión 54 (dueño, 2026-11-08, «54 ok ver»): «**solo se deja el lugar** (propietario y condición de tenencia en el movimiento)… no se liquida automáticamente al proveedor, no se genera deuda, no se calcula costo propio… se construye cuando haya un cliente que la use»; D55 (cuándo nacen costo y obligación: según lo pactado, por defecto al vender o consumir; el tratamiento fiscal lo define el contador) y D56 (la regla de qué stock se usa se declara por ítem) quedan «al construir». El estudio de factibilidad (`migracion-de-motor2-a-pedernal-factibilidad.md:79,92,173`) la lista como brecha. **La cita del dueño del 11/11** («excepto el tema de consignaciones, que ese sistema pase para acá») figura **NO CONFIRMADA** allá (`decisiones-del-dueno-2026-11.md:35`).

**Lo que Motor2 tiene hoy (VERIFICADO):** `Producto.esConsignacion`, `proveedorConsignacionId`, `precioConsignacion` (`schema.prisma:418-421`), la línea `LIQUIDACION_CONSIGNACION` al vender o consumir, el reporte de consignación, `PagoConsignante` y el permiso `pagar_consignante` (S-12/D8). Son ~25 archivos de `src/`.

### Decisión del dueño (CONFIRMADA)

**2026-11-13, chat con el orquestador, preguntas con opciones: «Mantenerla en Motor2 como está (Recomendada)».** La consignación **sigue en el módulo actual de Motor2 sin cambio**; Pedernal sigue sin ella hasta que haya un cliente que la use. **Diferencia declarada con Pedernal** (por decisión del dueño, no por Prisma ni por datos existentes). No se diseña nada más.

Opciones que se presentaron (registro): **a.** mantenerla como está (**elegida**); **b.** diseñar la de Pedernal (D54-D56; «4 a 8 tramos + especificación»); **c.** retirarla de Motor2 (se pierden el costo y la deuda con el consignante, el reporte y los pagos; destructivo si hay datos).

---

## 5. Observaciones → interruptor (CONFIRMADA)

**Decisión (dueño, 2026-11-13, chat con el orquestador): «Ocultarlo con interruptor reversible (Recomendada)».**

- **Interruptor:** constante `OBSERVACIONES_VISIBLES: boolean = false` en `src/core/catalogo/`, con el molde de `PRESENTACIONES_VISIBLES`, `DESCUENTO_POR_PRODUCTO_VISIBLE` y `ESTA_BIEN_ASI_VISIBLE`; revertir = poner `true`.
- **Superficies que lo leen (VERIFICADO):** el campo del formulario (`producto-form.tsx:171`), la fila «Observaciones» del detalle (`src/app/(app)/catalogo/productos/[id]/page.tsx:198-200`) y la copia al duplicar (`duplicar-producto.ts:200`, `persistencia/catalogo/duplicar-producto.ts:25,68,92`). El servidor, apagado, **rechaza** guardar `observaciones` (`actions/catalogo/productos.ts:301`, `persistencia/catalogo/productos.ts:32`, `lecturas/catalogo/datos-de-producto.ts:86`) con un mensaje fijo **después** de verificar el permiso, y **no borra** lo ya guardado.
- **Sin migración, sin datos tocados.** El texto cargado queda en la base; al volver a prender reaparece.

| ¿Qué pasa si…? | Resultado |
|---|---|
| Se edita un producto con texto guardado | Se guarda el resto; el texto no se toca ni se muestra |
| Alguien arma a mano un pedido con `observaciones` | Rechazo con el mensaje fijo (primero permisos) |
| Se duplica un producto | No se copia el texto (apagado) |
| Se vuelve a prender | Reaparece lo guardado |
| Repetición / concurrencia / error parcial | No hay escritura: no aplica |

**Pruebas:** oráculo interruptor {apagado, prendido} × superficie {formulario, detalle, duplicado, servidor}; guardián de que ninguna superficie lo muestra apagado. **Diferencia:** hoy Pedernal no tiene el campo; no hay decisión que lo descarte (**NO VERIFICADO**): se oculta por pedido del dueño, no por una decisión de Pedernal.

---

## 6. Orden de etapas, preguntas y dependencias

**Orden (de lo que no migra a lo que sí):**
1. **A — Observaciones** (interruptor). Sin migración.
2. **B — Hermanar sin migración** (ofertas por producto, comparativa por producto). Sin migración.
3. **D0 — Verificar** cómo descuenta un adicional. Sin migración.
4. **C0 — Interruptor de presentaciones** (se prende al construir C1). Sin migración.
5. **C1 — Presentación de compra por producto** (la de Pedernal). Migración aditiva y reversible, **autorización expresa**.
6. **D1 — Adicional sin ancla para los nuevos.** Código (y regla de origen de stock); sin migración de esquema.
7. **E — Fusionar productos hermanados** y **D2 — retirar los anclas existentes.** Migración de datos: **autorización expresa**, base por base, con recuento y ensayo.
8. **F — Consignación:** sin etapa (se mantiene como está).

**Resueltas (CONFIRMADAS, dueño, 2026-11-13, chat con el orquestador):** **Q-F** → «El de Pedernal: presentación por producto (Recomendada)» (diseño del 03/11 REVOCADO); **Q-C** → «Mantenerla en Motor2 como está (Recomendada)».

**Resueltas el 2026-11-14 (CONFIRMADAS, dueño, chat con el orquestador, opciones):** ver Q-S, Q-R y la fila de presentaciones de abajo. Quedan **sin pendientes de producto** en este documento (solo los de implementación).
- **Q-S — CONFIRMADA (dueño, 2026-11-14, chat con el orquestador, opciones): «Ocultarla y después borrarla (Recomendada)».** Una vez fusionados los hermanos, los sustitutos de receta se **ocultan** (interruptor reversible) y recién después se borran, con aviso. Se ejecuta en la etapa E; **ninguna migración queda autorizada por esta respuesta**.
- **Q-R — CONFIRMADA (dueño, 2026-11-14, chat con el orquestador, opciones): «Conservar solo lo que se pueda mostrar por producto (Recomendada)».** «Stock por familia» y «huecos de catálogo» se conservan solo en lo que se pueda mostrar por producto cuando no haya Insumos. Se ejecuta en la etapa E.

**Supuestos declarados:** S1 los cuatro campos quedan en la ficha donde están hoy hasta que existan los equivalentes (el dueño lo corrige). S2 ninguna etapa con migración arranca sin autorización expresa. S3 no se agrega ninguna función que Pedernal no tenga (por eso no hay «alta manual de ofertas»). S4 **(corregido)** el diseño del 03/11 sobre el envase está REVOCADO (Q-F).

---

## 7. Datos reales (NO VERIFICADO) y cómo contarlos

No tengo acceso a Neon. **Estas consultas NO las corre esta sesión contra producción** (indicación del orquestador, 2026-11-13): las corre él, en solo lectura, sobre una copia descartable cuando haga falta. Consultas de **solo lectura** para una copia descartable de producción (nunca sobre la rama principal; el identificador de la copia está en el repositorio privado de documentos):

```sql
-- Hermanar: insumos con más de un producto (cuántos son y de cuántos productos)
SELECT i."nombre", count(*) AS productos FROM "Producto" p JOIN "Insumo" i ON i."id" = p."insumoId" GROUP BY i."id", i."nombre" HAVING count(*) > 1;
SELECT count(*) FROM "Insumo";
SELECT count(*) FROM "ProveedorPorProducto";
SELECT count(*) FROM "SustitutoRecetaIngrediente";
-- Factor / presentaciones
SELECT count(*) FROM "Presentacion";
SELECT count(*) FILTER (WHERE "factorConversion" <> 1) AS con_factor, count(*) FILTER (WHERE "unidadCompraId" IS NOT NULL) AS con_unidad_de_compra FROM "Producto";
-- Producto de respaldo / adicionales
SELECT count(*) FROM "OpcionDeGrupo" WHERE "productoId" IS NOT NULL;
SELECT count(*) FROM "ConsumoDeOpcion";
-- Consignación
SELECT count(*) FROM "Producto" WHERE "esConsignacion";
SELECT count(*) FROM "PagoConsignante";
-- Observaciones
SELECT count(*) FROM "Producto" WHERE "observaciones" IS NOT NULL AND "observaciones" <> '';
```

(Los nombres de tabla y de columna salen de `prisma/schema.prisma` de esta rama; revisar que coincidan con la base de la copia.)

---

## 8. Riesgos y pendientes

- **Comentario desactualizado:** el texto de `PRESENTACIONES_VISIBLES` aún cita la decisión del 03/11 (revocada); reescribirlo al implementar C1. La decisión de volver a mostrar las presentaciones es dato del orquestador, no verificado por mí en el código.
- **No verifiqué** cómo descuenta stock hoy un adicional (ancla, consumo o ambos): decide la migración de D.
- **Fusionar productos** toca stock, recetas y reportes: es el cambio más riesgoso de este documento; solo con recuento y ensayo en copia.
- **Todo lo de Pedernal** viene de fichas de `zuluhub-docs`, no de su código.
- **Congelamiento de producción:** nada se aplica ni se despliega.
- **Sugerencias (no implementadas):** ninguna.
