# Diseño: el costo viaja con el traspaso (etapa E2 del circuito de abastecimiento), 2026-10-27

Estado: **niveles 1 a 5 respaldados por decisiones CONFIRMADAS del dueño (2026-10-27)**; lo marcado PROPUESTA o PENDIENTE espera su palabra. Etapa E2 de `docs/diseno-circuito-de-abastecimiento-2026-10-27.md` (§4) y regla V-T1. Rama `alegp/carril-x` (sobre `alegp/carril-e`, E1: clave de reintento obligatoria en `registrarMovimiento`). ADR: `docs/adr/ADR-040-el-costo-viaja-con-el-traspaso.md`.

**La migración de esta etapa (`prisma/migrations/20261027120000_traspaso_costo_unitario_origen`) está escrita y ensayada SOLO en la base local (subir, bajar, subir). No está aplicada en ninguna base real: aplicarla lo decide el dueño, base por base, con respaldo y ensayo.**

## 0. Inventario de lo que ya existe (verificado en el código, no en documentos)

- **Traspaso entre sucursales** (`TraspasoSucursal`, `prisma/schema.prisma`): fila ENTRE_SUCURSALES (se ve y se escribe desde el origen o el destino, ADR-028). Estados `SOLICITADA → ENVIADA → ACEPTADA` o `ENVIADA → RECHAZADA_DESTINO → CERRADA` (reingreso). Cuatro escrituras de Kardex, todas por un único escritor, `src/server/persistencia/traspasos/escribir-movimiento-de-traspaso.ts`, que hasta hoy escribía `precioTotal: 0` y `precioPorUnidadStock: 0`:
  1. **aprobación de una solicitud** (PULL, origen envía): `src/server/actions/traspasos/casos-de-uso/aprobar-y-enviar-traspaso.ts` → `escribirAprobacionDeTraspaso` (`escribir-aprobacion-de-traspaso.ts`), SALIDA en el origen;
  2. **envío directo** (PUSH): `crear-envio-directo-de-traspaso.ts` → `escribirEnvioDirectoDeTraspaso` (`escribir-creacion-de-traspaso.ts`), SALIDA en el origen;
  3. **aceptación** (destino): `aceptar-traspaso.ts` → `escribirAceptacionDeTraspaso` (`escribir-entrada-de-traspaso.ts`), ENTRADA en el destino, con clave de reintento I3;
  4. **reingreso** (origen, tras el rechazo del destino): `confirmar-reingreso-de-traspaso.ts` → `escribirReingresoDeTraspaso`, REINGRESO en el origen, con I3.
  El envío y el reingreso van en una transacción SERIALIZABLE con reintento (`conTransaccionSerializable`); el índice `MovimientoStock_traspaso_paso_unico_key` deja una sola línea por paso y por traspaso. Rechazar un envío (`escribir-rechazo-de-envio.ts`) y cancelar o rechazar una solicitud no escriben Kardex.
- **Costo de reposición**: `obtenerCostoActualPorMPDeSucursales` / `obtenerCostoActualPorMP` (`src/server/lecturas/reportes/comun.ts`): la COMPRA vigente más reciente de cada producto en cada sucursal, `precioPorUnidadStock > 0`, `anuladaEn IS NULL`, orden `fecha DESC, id DESC`. Una sola implementación (O.38b). La usan Costos y márgenes (food cost), Valuación, Pérdidas, Devoluciones, Rendimiento de recetas, Período (margen nominal), el Consolidado y **la venta** (costo congelado `costoUnitarioVenta`, dentro de su transacción, `registrar-venta-en-tx.ts`).
- **Costo reconstruido por día** (`src/server/consultas/reportes/costo-historico.ts` + `src/core/reportes/costo-historico.ts`): mismas reglas, «la más reciente hasta ese día», para el margen real de ventas sin costo congelado.
- **Lo que NO usa el costo de reposición y sigue filtrando COMPRA** (no debe cambiar): Período (compras, `totalGastado`, gasto por insumo: `src/core/reportes/periodo-compras.ts`), ratio compras/ventas (`periodo-ratio.ts`), precios de compra (`periodo-precios.ts`), compras registradas, sugerencia clase A, ofertas de proveedor (`ofertas-de-proveedor.ts`, es por proveedor). «Diferencias» no usa costo. El historial de un producto muestra el importe de cada línea (con la clave `reporte_historial_importes`; sin ella el dinero se quita en `quitarDineroDeEventos`) y solo suma VENTA.
- **Reglas de la base que ya existen** (`20261002160000_reglas_en_la_base_operacion_movimiento`): `MovimientoStock_precios_no_negativos_chk` (precio por unidad ≥ 0; importe ≥ 0 salvo AJUSTE y LIQUIDACION) y `MovimientoStock_traspaso_solo_en_traspasos_chk`. Una salida de traspaso con importe positivo las cumple.
- **Alcance por sucursal (ADR-028)**: `MovimientoStock` es HEREDADA de `Seccion` (la ve solo la sucursal de la sección). El destino NO puede leer la salida del origen. `lecturaDeVerificacionEnLaEmpresa` ensancha la lectura a la empresa solo para controles cuyo resultado es un sí/no o un mensaje (`src/server/acceso/alcance.ts`).
- **motor2-docs**: el plan unificado (`_planes/plan-unificado-gastos-compras-y-ventas.md`) no contempla el costo en el traspaso y dice que el costo de reposición «no cambia» (contradicción 3.1 del diseño del circuito, resuelta por el dueño el 2026-10-27). No hay otro plan ni ADR sobre esto.

## 1. Propósito y alcance — CONFIRMADA

Que la sucursal que recibe mercadería por traspaso tenga costo, margen y valuación. Hoy, si una sucursal compra y reparte (compra mixta, CONFIRMADA), la que recibe queda sin costo. **Entra**: copiar el costo del origen al enviar, valorizar las tres líneas del traspaso y que el costo de reposición del destino considere el traspaso recibido (V-T1). **No entra** (CONFIRMADA): mover el gasto (la plata); eso es la factura repartida de E3a. **No entra** (PROPUESTA): pantallas nuevas; recalcular datos viejos; costear el stock «en tránsito».

## 2. Actores y contexto — CONFIRMADA (sin cambios)

Operario u operador del origen (envía: claves `traspaso_aprobar`, `traspaso_enviar_directo`; confirma el reingreso: `traspaso_confirmar_reingreso`) y del destino (acepta o rechaza: `traspaso_aceptar`, `traspaso_rechazar`). El administrador ve costos en los reportes (piso `administrador`). No hay actores ni claves nuevas.

## 3. Casos de uso — CONFIRMADA

1. Enviar (aprobar una solicitud o envío directo): además de la salida de stock, **fija el costo unitario del origen en el traspaso** (`costoUnitarioOrigen`) y valoriza la salida con él.
2. Aceptar: la entrada del destino se valoriza con la COPIA guardada en el traspaso (no con el costo del origen de ese momento).
3. Confirmar el reingreso: la vuelta al origen se valoriza con la misma copia.
4. Leer el costo de reposición (todos los reportes de costo y la venta): la entrada valorizada local más reciente, sea COMPRA o traspaso recibido (V-T1).

## 4. Conceptos y ciclo de vida

- **Costo unitario de origen** (`TraspasoSucursal.costoUnitarioOrigen`, DECIMAL(14,4), NULL): copia del costo de reposición del origen en el instante del envío. CONFIRMADA (columna autorizada). Ciclo: NULL al crear una solicitud; se escribe UNA vez al pasar a ENVIADA (aprobación o envío directo); no se modifica después (PROPUESTA: nadie la edita; no hay pantalla ni caso de uso que la toque).
- **NULL = «pendiente de completar»**: el origen no tenía costo conocido. Nunca se inventa 0. Los traspasos anteriores a la migración quedan en NULL (sin relleno, CONFIRMADA por regla del dueño de migraciones aditivas).
- **Línea valorizada del traspaso**: `precioPorUnidadStock` = la copia exacta; `precioTotal` = `importeDeLinea(|cantidad|, copia)` (decimal exacto, un solo redondeo a centavos, `src/core/moneda.ts`). Sin copia: las dos en 0, la convención de siempre de «sin precio» que los lectores excluyen con `> 0`.
- **Costo de reposición (V-T1)**: CONFIRMADA. La entrada valorizada (`precioPorUnidadStock > 0`) local más reciente, COMPRA o `TRANSFERENCIA_ENTRADA_SUCURSAL`. El REINGRESO se excluye (CONFIRMADA en el diseño del circuito): devolver al origen lo que salió no es una reposición nueva.

## 5. Invariantes y políticas

| # | Invariante / política | Estado |
|---|---|---|
| I1 | La entrada del destino y el reingreso llevan EXACTAMENTE el costo copiado al enviar; una compra posterior en el origen no lo cambia. | CONFIRMADA (columna) |
| I2 | El traspaso mueve stock y costo, NUNCA gasto: Período, `totalGastado`, gasto por insumo y el ratio compras/ventas siguen filtrando COMPRA. | CONFIRMADA |
| I3 | Sin costo en el origen, el traspaso funciona igual y el destino queda «pendiente de completar» (NULL en el traspaso, 0 en las líneas, excluido por `> 0`). | CONFIRMADA (regla de producto: lo que falta no se inventa) |
| I4 | `costoUnitarioOrigen` ≥ 0 o NULL (CHECK en la base). | CONFIRMADA |
| I5 | Una entrada sin costo NO borra el costo anterior del destino: si el destino tenía una compra o un traspaso valorizado antes, ese sigue siendo su costo (mismo comportamiento que una compra cargada sin precio hoy). | PROPUESTA (consecuencia de V-T1 con «valorizada»; ver pregunta P2) |
| I6 | «Más reciente» se mide por la fecha del hecho (`Operacion.fecha`): la del traspaso es el instante de la aceptación; una compra cargada después con fecha anterior NO le gana. | PROPUESTA (es el criterio de siempre del costo de reposición) |
| I7 | Datos viejos: los traspasos y líneas anteriores quedan en 0/NULL; no se recalcula nada hacia atrás. | CONFIRMADA (sin relleno) |
| I8 | El costo copiado lo ve el administrador en los reportes del destino; el operario no lo ve en la bandeja de traspasos (la consulta no lo pide). | PROPUESTA (campo sensible de piso `administrador`, guardián GT-1) |

## 6. Historia y persistencia (compuerta: niveles 1 a 5 cubiertos por decisiones CONFIRMADAS)

- **Una sola columna aditiva**: `TraspasoSucursal.costoUnitarioOrigen DECIMAL(14,4) NULL` con `CHECK ("costoUnitarioOrigen" IS NULL OR "costoUnitarioOrigen" >= 0)` (`TraspasoSucursal_costo_unitario_origen_no_negativo_chk`). Misma precisión que `MovimientoStock.precioPorUnidadStock`: la copia es exacta, sin redondeo. Sin default, sin relleno, sin índice (no se busca por costo), sin GRANT nuevo (`motor2_app` tiene privilegios de tabla), sin política nueva (la RLS de `TraspasoSucursal` es por fila).
- **Variante A descartada** (sin migración: escribir el costo en la salida del origen y que la aceptación lo lea de ahí). La salida es una línea de `MovimientoStock` del origen (HEREDADA de su sección): con la RLS por sucursal el destino no la ve. Leerla exigiría abrir la aceptación con `lecturaDeVerificacionEnLaEmpresa`, cuyo contrato es que lo leído NO sale como dato (solo un sí/no o un mensaje); traer un importe de otra sucursal y escribirlo en el Kardex del destino es un ensanche nuevo que exige una excepción en ADR-028 y en sus guardianes. La variante B pone la copia en la fila que ya es de las dos puntas (`TraspasoSucursal`, ENTRE_SUCURSALES) y no ensancha nada. Elegida B (recomendada en el diseño del circuito y autorizada por el dueño).
- Historia: la copia no se edita; la salida, la entrada y el reingreso son el rastro (el Kardex solo agrega).
- Puntos de extensión previstos: si mañana se quiere mostrar «costo traído de la sucursal X» en la valuación, la fila del traspaso y la línea ya tienen todo lo necesario (PENDIENTE de producto, sin migración).

## 7. Atomicidad y concurrencia

- El costo se lee DENTRO de la misma transacción SERIALIZABLE que escribe la salida y el traspaso ENVIADO (una sola lectura por producto, `obtenerCostoActualDeProducto`, la misma SQL de V-T1 acotada al producto). La copia, la salida y el cambio de estado se escriben juntos o no se escribe nada.
- La aceptación y el reingreso leen la copia del traspaso dentro de su transacción (con el guard de estado y la clave I3), así que dos aceptaciones simultáneas nunca leen copias distintas: hay una sola copia y la segunda aceptación ve el traspaso ya ACEPTADO (o choca con el paso único y reintenta).

## 8. Acceso e interfaces

Sin claves, permisos ni pantallas nuevas. Firmas de persistencia: `escribirMovimientoDeTraspaso`, `escribirSalidaDeTraspaso`, `escribirAprobacionDeTraspaso`, `escribirEnvioDirectoDeTraspaso` y la entrada (`EntradaDeStockAEscribir`) reciben `costoUnitarioOrigen: number | null`; `cargarTraspaso` lo devuelve. Núcleo puro: `valorizarLineaDeTraspaso` (`src/core/stock/costo-del-traspaso.ts`). Lectura: `obtenerCostoActualDeProducto` (`src/server/lecturas/reportes/comun.ts`). El campo se declara sensible (piso `administrador`) en `test/arquitectura/guardas/campos-sensibles.ts`.

## 9. Consultas y experiencia

- **Cambian (el destino pasa a tener costo)**: Valuación, Costos y márgenes (food cost), costo congelado de la venta, Pérdidas, Devoluciones, Rendimiento de recetas (costo del pool), Consolidado, Período (solo el margen nominal, que usa el costo de reposición), margen real reconstruido.
- **No cambian**: compras del período, `totalGastado`, gasto por insumo, ratio compras/ventas, precios de compra, compras registradas, sugerencia clase A, ofertas de proveedor, Diferencias.
- El historial de un producto muestra ahora el importe de las líneas de traspaso (con la clave de importes); no las suma.
- Textos: Valuación y Costos decían «sin ninguna compra registrada» / «no tiene compra registrada»; pasan a «sin costo conocido (ni compra ni traspaso con costo): pendiente de completar». La columna «Proveedor» de Valuación queda vacía cuando el costo vino por traspaso (PENDIENTE de producto: mostrar «traspaso de <sucursal>»).

## 10. Pruebas, migración y operación

- Migración aditiva y reversible con `down.sql` (no destructiva: aborta si hay costos copiados, porque bajarla los perdería; ver su encabezado). Prueba: `test/persistencia/migracion-traspaso-costo-unitario-origen.test.ts` (subir, CHECK, bajar con datos aborta, bajar, subir).
- Pruebas de comportamiento: `test/traspasos/costo-en-el-traspaso.test.ts` (ver §12) y `test/reportes/costo-en-el-traspaso-reportes.test.ts` (línea de base: lo que no debe cambiar).
- Orden de despliegue (PROPUESTA): primero la migración, después el código (el código nuevo escribe la columna). El código viejo con la columna nueva no se entera (no la lee ni la escribe).
- Reversa: volver el código y recién después correr `down.sql`.

## 11. ¿Qué pasa si…?

| Situación | Enviar (aprobar o envío directo) | Aceptar | Confirmar reingreso |
|---|---|---|---|
| **Repetición** (doble clic, reenvío) | Aprobar dos veces: el segundo ve el traspaso ya ENVIADO (guard de estado) y no escribe; la copia queda la del primero. El envío directo no tiene I3 (decisión M11c): un duplicado es OTRO traspaso con su propia copia y se deshace con rechazo + reingreso. | Misma clave I3 → mismo mensaje, cero filas nuevas; sin clave, el segundo ve ACEPTADA y rechaza. | Ídem aceptar (I3 + guard de estado). |
| **Concurrencia** | Una compra en el origen mientras se envía: las dos son SERIALIZABLE; el envío toma el costo anterior o el nuevo según cuál quede antes en el orden serial; si Postgres ve un ciclo aborta una y `conTransaccionSerializable` la reintenta. Nunca un costo «a medias». | 8 aceptaciones a la vez con la misma clave: una sola entrada (I3 + paso único); todas leen la MISMA copia. | Dos reingresos a la vez: el paso único deja uno; el otro ve CERRADA. |
| **Tiempo** | La copia es el costo del instante del envío. Si la mercadería tarda días en aceptarse, entra al destino con ese costo y con la fecha de la aceptación. | La fecha de la entrada (y por lo tanto su lugar en «la más reciente») es la de la aceptación. | El reingreso no compite por el costo de reposición (excluido de V-T1). |
| **Incertidumbre** (no sé si se grabó) | Reintentar aprobar da «ya está ENVIADA»; la bandeja muestra el estado. | Reintentar con la misma clave devuelve el resultado original. | Ídem. |
| **Reintento** por conflicto serializable | Se relee el costo en el reintento (todo dentro de la transacción). | Se relee la copia (la misma). | Ídem. |
| **Error parcial** | La copia, la salida y el estado van en la misma transacción: o todo o nada. | Entrada, estado y resultado I3 en una transacción. | Ídem. |
| **Datos faltantes** | Origen sin costo conocido: el envío sigue; copia NULL; salida a 0. Traspaso viejo (anterior a la migración) ya ENVIADO: copia NULL. | Copia NULL → entrada a 0 → destino «pendiente de completar» (conserva su costo anterior si tenía, I5). | Copia NULL → reingreso a 0. |
| **Cambio de permisos** | Sin cambios: las claves se validan como hoy, antes del caso de uso. Perder la clave a mitad: el servidor rechaza. | Ídem. | Ídem. |
| **Otra empresa / sucursal ajena** | La RLS no deja ver ni escribir un traspaso de otra empresa ni ajeno a las dos puntas; el costo se lee filtrando por la sucursal del actor. | El guard de transición exige ser el destino. | El guard exige ser el origen. |

## 12. Escalera de producto (lo que ve el cliente; se cruza con la de diseño en el nivel 5)

N0 traspaso sin costo (hasta hoy) · **N1 (esta etapa)**: el traspaso lleva el costo del origen; el destino tiene costo, margen y valuación; lo que falta se ve como «pendiente de completar» · N2 (PENDIENTE): mostrar el origen del costo («traspaso de X») y avisar al enviar sin costo · N3: valorizar el stock en tránsito · N4: costo promedio ponderado u otro método (fuera del alcance; hoy el método es «la entrada más reciente»).

## 13. Preguntas PENDIENTES (con recomendación)

- **P1. Stock en tránsito** (ENVIADA sin aceptar): no está en la valuación de ninguna de las dos sucursales. Recomendación: dejarlo así en E2 y, si importa, mostrarlo aparte (N3).
- **P2. Entrada sin costo**: ¿debe «borrar» el costo anterior del destino o conservarlo? Recomendación: conservarlo (I5), igual que una compra sin precio hoy; el reporte sigue marcando lo que no tiene costo.
- **P3. Envío sin costo**: ¿avisar al operario del origen que manda algo sin costo conocido? Recomendación: sí, en N2, como aviso (sin bloquear).
- **P4. Aplicación a bases reales**: la migración NO se aplicó a ninguna. Recomendación: aplicarla con respaldo y ensayo en una rama de Neon antes que el código, base por base.

## 14. Evidencia (línea de base, pruebas y mutaciones)

Se completa al cerrar la etapa (ver abajo, «Cierre de E2»).
