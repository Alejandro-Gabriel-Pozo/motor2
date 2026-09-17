# Auditoría motor2 — Entrega obligatoria: Instrucción por pivotes de decisión

Fecha: 2026-09-16. Ejecuta la "Instrucción operativa para auditar motor2 mediante pivotes de decisión". Esta entrega cubre exclusivamente: Fase 0, Fase 1, y la lista de los 6 pivotes con pregunta/riesgo/plan de verificación — **sin modificar ningún archivo de código, esquema ni dependencia**, tal como exige la instrucción.

**Me detengo al final de esta entrega y espero autorización explícita antes de ejecutar (o continuar ejecutando) los planes de verificación de cada pivote.**

---

## 1. Fase 0 — Estado inicial

Ya relevada en detalle en `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §2 (misma sesión, mismo repositorio, sin cambios de entorno desde entonces salvo los commits de esta propia auditoría). Resumen:

- Git: repo real, rama `claude/migration-plan-px7c0b`, historial completo (no es un ZIP sin `.git`). Working tree limpio salvo los commits de esta auditoría.
- Versiones: Node v22.22.2, npm 10.9.7, Next.js 16.3.5, Prisma 7.10.0, TypeScript 5.9.3, PostgreSQL 16.13 (local), Vitest 4.1.11.
- `package.json`/lockfile/scripts/migraciones/`.env.example`: relevados, sin hallazgos de secretos expuestos.
- Variables de entorno (solo nombres): `DATABASE_URL`, `NEXT_PUBLIC_SENTRY_DSN`, `ALLOWED_EMAIL_DOMAINS`, `BOOTSTRAP_ADMIN_EMAILS`, `NEXT_RUNTIME`, `NODE_ENV`.
- Limitación de entorno: todo verificado contra Postgres local (contenedor de sesión); sin acceso a Neon/producción.

No hay nada adicional que verificar en Fase 0 que no esté ya cubierto.

## 2. Fase 1 — Mapa del sistema y línea base

Ya relevada en detalle en `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §3 (mapa completo: puntos de entrada, autenticación, permisos por sucursal, catálogo, scripts/seeds, migraciones) y §3.7 (los 10 flujos de inventario, con la cadena completa UI → Server Action → permiso/contexto → validación → transacción → Operacion → MovimientoStock → reportes, para cada uno).

**Línea base de pruebas** (re-ejecutada hoy, tras agregar las pruebas de auditoría de Fase 4/5): `npx vitest run` → **51/51 archivos, 311/311 tests pasan**, contra Postgres local real, ~76s. (48 tests originales del proyecto + 15 nuevos de `test/auditoria/*`, agregados durante esta misma auditoría bajo autorización previa).

No hay nada adicional que verificar en Fase 1 que no esté ya cubierto por el documento existente.

---

## 3. Los 6 pivotes de decisión

Nota de contexto: bajo una autorización previa (revisión del informe Fase 0+1, ver `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §7), ya se ejecutó investigación real con pruebas reproducibles sobre 4 de los 6 pivotes (concurrencia, idempotencia, traspasos en tránsito, precisión numérica) — documentada en §8, §9 y §10 de ese mismo archivo. Se resume el estado de cada uno acá, reformateado al estándar de esta instrucción, y se marca explícitamente qué falta para considerar cada pivote formalmente cerrado.

### Pivote 1 — Concurrencia

**Pregunta**: ¿el mecanismo actual de transacciones, aislamiento y reintentos garantiza que dos operaciones simultáneas sobre el mismo stock produzcan un resultado correcto?

**Riesgo**: una operación concurrente legítima (stock suficiente para ambas) falla con un error no manejado en vez de tener éxito, si el reintento no cubre todos los conflictos reales de Postgres.

**Plan de verificación**: ejecutado parcialmente. Casos 1 (dos consumos simultáneos, mismo producto/sección, con y sin stock suficiente) y 5 (suma supera stock disponible) probados con Postgres real, 5+ corridas cada uno. Casos 2 (dos ventas simultáneas, misma receta), 3 (consumo simultáneo con merma/transferencia) y 4 (conflicto que fuerza reintento, aislado del motor de negocio) — parcialmente cubiertos (caso 4 reproducido de forma aislada en el diagnóstico del Hallazgo 1; casos 2 y 3 no probados todavía con el motor de negocio real).

**Estado de evidencia**: **FALLO_CONFIRMADO** (parcial) — ver Hallazgo 1 en `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §8: `conTransaccionSerializable` no reintenta todos los conflictos reales (2/5 corridas de un caso que debería tener éxito terminaron en una promesa rechazada con `DriverAdapterError`, no reconocida por el catch de `P2034`).

**Pivote de salida candidato**: **C2 — Ajustar** (la falla es local y corregible sin cambiar el modelo de stock: ampliar el reconocimiento de conflicto en `con-reintento.ts`, no se demostró necesidad de otra forma de serialización).

**Falta para cerrar**: casos 2 y 3 del plan (ventas concurrentes sobre la misma receta; consumo simultáneo con merma/transferencia) con el motor de negocio real; decisión formal sobre C2 vs. mantener.

### Pivote 2 — Idempotencia

**Pregunta**: ¿el negocio necesita impedir que un doble envío, timeout o reintento cree dos operaciones de stock para el mismo hecho?

**Riesgo**: doble carga de una operación (compra, consumo, venta, etc.) por doble-submit de UI o reintento de red, sin ninguna forma de detectarlo después del hecho.

**Plan de verificación**: ejecutado parcialmente. Caso 2 (dos requests simultáneos, mismo payload — vía COMPRA con factura duplicada) y una variante del caso 1 (doble-submit secuencial vía CONSUMO) probados con Postgres real. Casos 3 (timeout del caller tras confirmar), 4 (reintento con referencia externa — no existe ese concepto hoy fuera de nroFactura), 5 (repetición en venta/merma/producción/devolución/reclasificación más allá de CONSUMO) y 6 (reintento de aceptación/rechazo de traspaso) no probados todavía.

**Estado de evidencia**: **VERIFICADO_EN_CODIGO** (ausencia del mecanismo general) + **FALLO_CONFIRMADO** (el único guard existente, el de factura duplicada en COMPRA, es racy bajo concurrencia real — Hallazgo 2, 1/5 corridas produjo una factura duplicada real) + **FALLO_CONFIRMADO** (doble-submit secuencial en CONSUMO duplica sin ninguna protección, Escenario 3).

**Pivote de salida candidato**: no se puede elegir todavía sin decisión de negocio — ver política pendiente abajo. Con la evidencia actual, como mínimo aplica **I3 (idempotencia de operaciones manuales)** para COMPRA (dado que ya existe la intención de un guard ahí, solo que no es atómico); I2/I4 para el resto depende de qué decida el negocio.

**Falta para cerrar**: casos 3-6 del plan; y sobre todo, la política — quién decide qué operaciones deben ser idempotentes (pregunta de negocio, no de código).

### Pivote 3 — Traspasos en tránsito

**Pregunta**: ¿el estado en tránsito (salida registrada, entrada pendiente) es aceptable y recuperable para el negocio?

**Riesgo**: un traspaso queda "perdido" — ni en el Kardex de origen ni en el de destino — sin ninguna forma de detectarlo o resolverlo.

**Plan de verificación**: ejecutado parcialmente. Casos 1 (salida confirmada, entrada pendiente), 3 (rechazo del destino), 4 (reingreso posterior al rechazo) y 5 (aceptación duplicada, secuencial y con una variante concurrente vs. rechazo) probados con Postgres real — ver `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §9. Casos 2 (falla de conexión después de registrar la salida — no simulable sin inyectar una falla real a mitad de request), 6 (cancelación durante el estado en tránsito — no existe una acción de "cancelar" sobre ENVIADA, solo sobre SOLICITADA) y 7 (usuario que abandona el flujo — equivalente a caso 1, ya cubierto: el estado queda visible en la Bandeja indefinidamente hasta que alguien actúe) no probados o no aplican tal como está planteado el caso.

**Estado de evidencia**: **VERIFICADO_EN_CODIGO** — cada estado tiene actor, timestamp, permiso y movimiento asociado; las transiciones probadas fueron siempre válidas y recuperables; el guard de estado nunca permitió un doble efecto.

**Pivote de salida candidato**: **T1 — Mantener workflow** (el estado en tránsito es válido, visible en la Bandeja de ambos lados, y recuperable vía rechazo+reingreso). No se encontró evidencia que amerite T2/T3/T4.

**Falta para cerrar**: caso 6 (no aplica tal como está el código — podría reformularse como "¿debería existir cancelación de un ENVIADA?", que es más una pregunta de negocio que una prueba técnica); confirmar caso 2 con una prueba de fallo real (kill de conexión a mitad de transacción) si se considera necesario.

### Pivote 4 — Precisión numérica

**Pregunta**: ¿las conversiones de `Decimal` a `number`, los redondeos y los cálculos acumulados producen diferencias funcionalmente relevantes?

**Riesgo**: pérdida de precisión en cantidades/precios/costos que se acumula con el tiempo o en casos límite, produciendo saldos o cobros incorrectos.

**Plan de verificación**: ejecutado parcialmente. Casos 1 (cantidades a 4 decimales), 2 (conversión caja→unidad, incluyendo un caso diseñado para producir ruido real de punto flotante en JS), 3 (sumas repetidas, 50 iteraciones), 4 (merma porcentual) y 8 (diferencia entre saldo calculado y esperado, vía reconstrucción manual) probados con Postgres real — ver `docs/auditoria-motor2-fase0-fase1-2026-09-16.md` §10. Casos 5 (costos acumulados encadenados con múltiples operaciones), 6 (precios con dos decimales específicamente, vía `redondearMoneda`) y 7 (reversión de una cantidad previamente redondeada) no probados todavía. El inventario exhaustivo de "cada punto donde se convierten valores Decimal, clasificado por cantidad/precio/costo/porcentaje/presentación" (pedido explícitamente por el plan) tampoco se hizo todavía — la auditoría de Fase 0/1 solo contó *cuántas* conversiones `Number()` hay (98 en 39 archivos), no las clasificó una por una.

**Estado de evidencia**: **VERIFICADO_EN_CODIGO** — en todos los casos probados, incluyendo los diseñados específicamente para provocar el bug clásico de punto flotante, el resultado final fue exacto (el patrón "agregar en Postgres + redondear después de cada cálculo en JS" funcionó en cada caso).

**Pivote de salida candidato**: **N1 — Mantener**, con una salvedad de alcance: no se probó la combinación peor-caso (factor de conversión + merma + redondeo de moneda encadenados en una sola operación) ni cantidades con más dígitos significativos.

**Falta para cerrar**: casos 5, 6, 7 del plan; el inventario clasificado de conversiones; y decidir el umbral aceptable del negocio (pregunta de negocio explícita del plan, no resuelta todavía).

### Pivote 5 — Escalabilidad de saldos y reportes

**Pregunta**: ¿las agregaciones sobre `MovimientoStock` y los reportes actuales soportan el volumen esperado de datos?

**Riesgo**: con suficiente historial (años de movimientos, muchas sucursales/productos), las consultas de saldo y los reportes se degradan — tiempo de respuesta, memoria del servidor o del cliente.

**Plan de verificación**: **no ejecutado todavía**. Requiere primero una decisión de negocio (volumen esperado de movimientos/día, sucursales, años de historial — pregunta explícita del plan, no resuelta) antes de poder definir qué volumen usar para el benchmark. Sin esa cifra, un benchmark arbitrario mediría un escenario no representativo.

**Estado de evidencia**: **HIPÓTESIS_A_CONFIRMAR** — el informe de Fase 0/1 ya identificó que `tabla-reporte.tsx` no pagina y que los reportes cargan el dataset filtrado completo en memoria (`VERIFICADO_EN_CODIGO` como patrón), pero no hay medición de `EXPLAIN ANALYZE`, duración ni memoria con datos representativos.

**Pivote de salida candidato**: ninguno todavía — depende de la medición.

**Falta para cerrar**: la decisión de negocio sobre volumen esperado; y con esa cifra, el benchmark completo (los 8 puntos del plan: saldo por producto/sección, consolidado, por familia, alertas de mínimos, historial, reportes por período, filtros/exportaciones, consultas con fechas amplias).

### Pivote 6 — Auditoría y trazabilidad

**Pregunta**: ¿`Operacion`, `MovimientoStock`, `ConteoFisico` y `TraspasoSucursal` registran suficiente información para controlar y reconstruir las decisiones del negocio?

**Riesgo**: falta un dato puntual (quién, cuándo, por qué) para reconstruir una decisión de negocio ante una auditoría externa o un reclamo.

**Plan de verificación**: **no ejecutado como revisión sistemática todavía** — el informe de Fase 0/1 ya relevó qué campos existen por modelo (`Operacion.usuarioId/fecha/anuladaEn/anuladaPorId`, `MovimientoStock.creadoEn/detalle`, `ConteoFisico.usuarioId/fecha`, `TraspasoSucursal.creadoPorId/decididoPorOrigenId/decididoPorDestinoId/cerradoPorId`), pero no se revisó campo por campo contra la lista completa del plan (actor/sucursal/instante/proceso/producto/cantidad/unidad/motivo/referencia/estado anterior-posterior/reversión/origen/resultado del intento) para cada uno de los 7 sub-flujos que pide el plan (ajustes manuales, anulaciones, conteos, cambios de catálogo, precios, permisos, transferencias) por separado.

**Estado de evidencia**: **PARCIAL** — trazabilidad operativa fuerte para el Kardex (Operacion/MovimientoStock), pero sin revisión puntual de catálogo/precios/permisos (que no pasan por el Kardex en absoluto, y podrían no tener ningún registro de "quién cambió qué precio y cuándo" más allá de `updatedAt` implícito de Prisma, si existe).

**Pivote de salida candidato**: probablemente **A1** para el Kardex, posible **A3** para catálogo/precios/permisos si se confirma que no tienen historial — pero no se puede afirmar sin revisar esos 3 sub-flujos puntualmente.

**Falta para cerrar**: la revisión campo-por-campo de los 7 sub-flujos, particularmente catálogo/precios/permisos que no pasan por el Kardex.

---

## 4. Consolidación final (revisión del 2026-09-16)

Estado tras revisión conjunta de los 6 pivotes:

| Pivote | Estado formal | Candidato | Bloqueo real |
|---|---|---|---|
| 1. Concurrencia | **FALLO_CONFIRMADO — parcial** | C2 — Ajustar `con-reintento.ts` (localizado, sin cambiar el modelo de stock) | Solo técnico: casos 2-3 del plan (ventas concurrentes con receta, consumo + merma/transferencia simultáneos) |
| 2. Idempotencia | **VERIFICADO_EN_CODIGO (ausencia) + FALLO_CONFIRMADO** (COMPRA racy; CONSUMO sin protección alguna) | Mínimo I3 para COMPRA (constraint de DB); I2/I4 para el resto según decisión de negocio | **Decisión de negocio**: alcance, identidad de "misma operación", duración de clave, respuesta ante duplicado |
| 3. Traspasos en tránsito | **VERIFICADO_EN_CODIGO** — casi cerrado | T1 — Mantener workflow | Menor: prueba de fallo a mitad de proceso (opcional); decisión de negocio sobre cancelar un `ENVIADA` |
| 4. Precisión numérica | **PARCIAL** — sin fallo confirmado, evidencia favorable | Ninguno todavía (no corresponde elegir N1-N5 sin cerrar los pendientes) | Técnico: clasificar 98 conversiones + casos de costos acumulados/precios/reversiones; **decisión de negocio**: umbral aceptable |
| 5. Escalabilidad | **HIPÓTESIS_A_CONFIRMAR** — bloqueado | Ninguno todavía | **Decisión de negocio**: volumen de referencia (actual/esperado/crecimiento) — sin esto, cualquier benchmark es arbitrario |
| 6. Auditoría y trazabilidad | **PARCIAL** | A1 para Kardex (probable); A3 para administración (posible, sin confirmar) | Técnico: revisión campo-por-campo de los 7 sub-flujos, en particular catálogo/precios/permisos (no pasan por el Kardex) |

Ningún pivote reveló un defecto crítico de integridad de stock (ninguna pérdida, duplicación silenciosa no detectable, o sobreventa confirmada) — los fallos confirmados (Pivotes 1 y 2) son de confiabilidad/robustez y de duplicación bajo condiciones específicas, no corrupción de datos ya ocurrida en el estado actual del sistema. No corresponde detener los planes posteriores.

**Plan de cierre priorizado** (acordado):
1. Completar Concurrencia (Pivote 1) — solo técnico, sin decisión de negocio pendiente.
2. Definir política de idempotencia (Pivote 2) — requiere decisión de negocio.
3. Cerrar Traspasos (Pivote 3) — casi cerrado.
4. Completar Precisión numérica (Pivote 4) — clasificación + casos restantes, más umbral de negocio.
5. Obtener volumen de negocio para Escalabilidad (Pivote 5).
6. Revisar Auditoría administrativa (Pivote 6) — técnico, sin decisión de negocio previa necesaria para empezar.

**Decisiones de negocio pendientes, agrupadas**:
- Pivote 2 — Idempotencia: alcance (qué procesos), identidad de "misma operación", duración de la clave, comportamiento ante duplicado, alcance exacto de la unicidad de factura (sucursal/proveedor/factura sin número).
- Pivote 4 — Precisión: umbral aceptable de diferencia numérica.
- Pivote 5 — Escalabilidad: volumen de referencia (actual, esperado, y de crecimiento si es posible).
- Pivote 6 — Auditoría: nivel de auditoría administrativa requerido para catálogo/precios/permisos (¿regulatorio o solo control interno?).

---

## 5. Cierre de pivotes técnicos (2026-09-17)

Decisiones de negocio recibidas: idempotencia alcance **I3** (todas las operaciones manuales), precisión umbral **cero tolerancia** en stock/dinero, escalabilidad **escenario estándar chico-mediano**. Con esas decisiones y los pendientes puramente técnicos que quedaban, se completó lo siguiente.

### Pivote 1 — Concurrencia, casos 2 y 3 (cierre)

Pruebas nuevas en `test/auditoria/concurrencia-casos-2-3.test.ts` (4 escenarios, 6+ corridas cada uno):

- **Caso 2** (dos VENTAS simultáneas, misma receta, mismo insumo): con stock exacto para una sola venta, nunca las dos tuvieron éxito, y el saldo nunca quedó negativo. Con stock de sobra, ambas ventas tuvieron éxito en la mayoría de las corridas — pero en 1 de 6 corridas se repitió el Hallazgo 1 (el conflicto de Postgres escapó como `DriverAdapterError` no reconocido, una venta legítima falló) — **confirma que el Hallazgo 1 no es específico de `registrarMovimiento`: afecta a todo lo que use `conTransaccionSerializable`**, incluido `registrarVenta`.
- **Caso 3** (CONSUMO simultáneo con MERMA, y CONSUMO simultáneo con TRANSFERENCIA, mismo producto+sección): en ambas variantes, con stock exacto para una sola operación, nunca las dos tuvieron éxito, el saldo de origen nunca quedó negativo, y en el caso de transferencia el total del sistema (origen+destino) nunca superó lo comprado.

**Estado formal**: **FALLO_CONFIRMADO** (mismo Hallazgo 1, alcance ampliado — no es exclusivo del motor genérico de movimientos) + **VERIFICADO_EN_CODIGO** (ninguna invariante de negocio violada: nunca saldo negativo, nunca doble efecto, nunca se superó el stock real).

**Pivote 1: CERRADO.** Candidato confirmado: **C2 — Ajustar `con-reintento.ts`** para que reconozca también `DriverAdapterError({kind:"TransactionWriteConflict"})`, no solo `PrismaClientKnownRequestError` código `P2034`. No se encontró ningún caso que requiera C3 (rediseño). **IMPLEMENTADO** 2026-09-17, commit `5ff3cff` — ver §11 Plan 2 para el detalle de la verificación posterior.

### Pivote 3 — Traspasos en tránsito, caso 2 (cierre)

Prueba nueva en `test/auditoria/traspasos-en-transito.test.ts`: se replicó el mismo patrón de escritura de `crearEnvioDirectoTransferencia` (crear `TraspasoSucursal` + `MovimientoStock` dentro de una sola transacción) y se forzó un throw DESPUÉS de crear el `TraspasoSucursal` pero ANTES de escribir el `MovimientoStock` y antes del commit — simulando "la conexión se cae después de registrar la salida, antes de que se complete la escritura". Resultado: **cero filas sobrevivieron** (ni el `TraspasoSucursal` ni ningún `MovimientoStock`), el saldo quedó exactamente igual al original. La atomicidad de la transacción es real: o se escribe todo (traspaso ENVIADA + movimiento de salida juntos, recuperable desde ahí en adelante) o no se escribe nada — nunca un estado a medias.

**Estado formal**: **VERIFICADO_EN_CODIGO**.

**Pivote 3: CERRADO.** Candidato confirmado: **T1 — Mantener workflow**. La única pieza que queda es de negocio, no técnica: si además del rechazo formal el negocio quiere una acción de "cancelar" explícita sobre un traspaso `ENVIADA` (hoy no existe) — se deja registrada como pregunta abierta, no bloqueante.

### Pivote 5 — Escalabilidad (benchmark ejecutado)

Script `scripts/auditoria-benchmark-reportes.ts` (queda en el repo como herramienta reutilizable). Escenario generado: 500 movimientos/día × 3 años × 8 sucursales ≈ **551.880 `MovimientoStock` reales** (extremo bajo del rango acordado "500-1000 mov/día, 5-10 sucursales, 3-5 años", elegido para mantener el tiempo de generación manejable en esta sesión — límite de alcance explícito, no el volumen máximo del rango). Datos generados vía SQL bulk, medidos, y borrados al terminar (no quedan residuos en `motor2_test`).

| Medición | Resultado |
|---|---|
| `calcularSaldoTotal` (1 producto+sección) | 3.6ms |
| `calcularStockConsolidado` (toda la sucursal) | 128.8ms |
| `calcularStockPorFamilia` | 99.7ms |
| `calcularAlertasStock` | 105.5ms |
| `obtenerHistorialProducto` (producto con pocos movimientos) | 35.2ms |
| `obtenerHistorialProducto` (producto con ~2.000 movimientos, filtrando solo el último mes) | 27.6ms |
| `obtenerReportePorPeriodo` (rango angosto, 7 días) | 151.9ms |
| **`obtenerReportePorPeriodo` (rango amplio, 3 años)** | **2.243,7ms** |
| Plan de la agregación base (`EXPLAIN ANALYZE SUM(cantidad)`) | 0.066ms — usa el índice compuesto perfectamente |
| Memoria del proceso tras las mediciones | 333,7 MB heap / 522,4 MB RSS |

**Hallazgos**:
1. La agregación de saldo (la operación más frecuente, corre en cada validación de stock) es excelente incluso con más de medio millón de filas — el índice `[productoId, seccionId, loteVencimiento]` funciona exactamente como está documentado en el schema. **VERIFICADO_EN_CODIGO — sin problema**.
2. `obtenerReportePorPeriodo` con un rango de 3 años tardó **~15× más** que con 7 días (2.244ms vs 152ms) — un usuario pidiendo "todo el historial" de una sucursal ve una demora de más de 2 segundos con este volumen, y ese tiempo crece con más años de historial o más sucursales/movimientos. **FALLO_CONFIRMADO (rendimiento)** — no es un error de datos, es una degradación medible.
3. **Hallazgo adicional no anticipado en el plan original**: `obtenerHistorialProducto` (`src/core/reportes/historial-producto.ts:84-91`) carga el historial COMPLETO de un producto sin ningún filtro de fecha en la consulta a la base — el recorte por `desde`/`hasta` se aplica DESPUÉS, en memoria, sobre el array ya completo (comentario del propio código: "sin recortar por fecha todavía"). En este benchmark no se notó (el producto más movido solo tenía ~2.000 movimientos en 3 años), pero para un producto verdaderamente longevo (años de operación diaria) esta consulta crece sin límite, sin importar qué rango de fechas pida el usuario. **VERIFICADO_EN_CODIGO** como patrón de riesgo, mismo tipo de hallazgo que la ausencia de paginación en `tabla-reporte.tsx` ya señalada en el informe original.
4. El uso de memoria (333MB de heap) para un solo proceso corriendo estas 8 mediciones es alto pero no alarmante para un servidor típico — no se cruzó ningún límite duro en esta corrida.

**Pivote 5: CERRADO (con hallazgos).** Candidato: **R2 — Optimizar consultas** para `obtenerReportePorPeriodo` (filtrar más en la query, no traer todo a memoria) y `obtenerHistorialProducto` (aplicar `desde`/`hasta` en el `where`, no después). No se encontró evidencia que justifique R4/R5 (proyección de saldo o `StockBalance`) — la agregación base es rápida; el problema está en 2 reportes específicos, no en el modelo de datos. **IMPLEMENTADO** 2026-09-17, commit `9c52d6f` — ver §11 Plan 3 para el detalle completo, incluida una corrección importante: `obtenerReportePorPeriodo` no tenía el mismo defecto que `obtenerHistorialProducto` (SÍ filtraba por fecha) — su lentitud era por hidratación de Prisma con `include` completo, no por falta de filtro; el fix real ahí fue `select` acotado, no un cambio de query de fecha.

### Pivote 6 — Auditoría y trazabilidad, revisión campo-por-campo (cierre)

Revisión de `src/server/actions/productos.ts`, `insumos.ts`, `unidades.ts`, `categorias-producto.ts`, `precio-local.ts`, `permisos.ts`, `capacidades-sucursal.ts`, `roles.ts` y los modelos Prisma correspondientes:

| Sub-flujo | Actor registrado | Fecha de cambio | Valor anterior | Clasificación |
|---|---|---|---|---|
| Catálogo (`Producto`/`Insumo`/`Unidad`/`CategoriaProducto`/`Presentacion`) | No | No (`Producto` no tiene `updatedAt`) | No | **NO_ENCONTRADO** |
| Recetas (`RecetaVersion`) | No | Sí (`creadoEn` por versión) | Sí (append-only real) | **VERIFICADO_EN_CODIGO (parcial, sin actor)** |
| Precios (`Producto.precioVenta`/`precioConsignacion`, `PrecioLocalProducto`) | No | No | No | **NO_ENCONTRADO** |
| Permisos (`PermisoRol`, `CapacidadSucursal`, `Rol`) | No | No | No | **NO_ENCONTRADO** |

Ningún modelo de catálogo/precios/permisos tiene siquiera un `updatedAt` genérico — todas las funciones de edición (`actualizarProducto`, `setPrecioLocalProducto`, `actualizarPermiso`, `actualizarCapacidad`, etc.) sobreescriben el valor vigente directo vía `update`/`upsert`, y varias ni siquiera usan el `ctx.usuarioId` que `conPermiso` les entrega — se descarta sin registrar quién hizo el cambio. Contraste dentro del mismo código: `TraspasoSucursal.creadoPorId`/`decididoPorOrigenId`/`decididoPorDestinoId` sí registra actor por etapa — el patrón existe en el codebase, pero no se aplicó a catálogo/precios/permisos.

**Pivote 6: CERRADO.** Candidato confirmado: **A1** para el Kardex (ya verificado en Fase 1, sin cambios). Para catálogo/precios/permisos, la evidencia apunta a **A3 — Agregar auditoría administrativa** (como mínimo `actor` + `fecha` + `valor anterior` en los cambios de precio y de permisos, que son los de mayor impacto de negocio/control interno) — pero la decisión final depende de la pregunta de negocio ya registrada (§4): ¿regulatorio o solo control interno? Sin esa respuesta no corresponde diseñar la solución (podría ser tan simple como agregar `actorId`+`updatedAt` a 3-4 modelos, o requerir un historial versionado tipo `RecetaVersion` si hay necesidad de reconstruir valores intermedios).

---

## 6. Estado consolidado final

| Pivote | Estado | Cerrado | Candidato final |
|---|---|---|---|
| 1. Concurrencia | FALLO_CONFIRMADO | **Sí** | C2 — ampliar reconocimiento de conflicto en `con-reintento.ts` |
| 2. Idempotencia | FALLO_CONFIRMADO + política definida (I3) | No — falta el plan de implementación | I3 para todas las operaciones manuales (decisión de negocio ya recibida) |
| 3. Traspasos en tránsito | VERIFICADO_EN_CODIGO | **Sí** | T1 — Mantener workflow |
| 4. Precisión numérica | VERIFICADO_EN_CODIGO (casos probados) + umbral definido (cero tolerancia) | No — faltan casos 5-7 y el inventario clasificado | N1 provisional, sujeto a completar los casos restantes bajo el umbral cero-tolerancia |
| 5. Escalabilidad | FALLO_CONFIRMADO (rendimiento, 2 reportes) | **Sí** | R2 — Optimizar consultas puntuales, no `StockBalance` |
| 6. Auditoría y trazabilidad | NO_ENCONTRADO (catálogo/precios/permisos) | **Sí** | A1 Kardex (sin cambios) + A3 candidato para administración, pendiente de precisar alcance regulatorio |

Cuatro de seis pivotes (1, 3, 5, 6) quedan formalmente cerrados con un candidato técnico único y sin ambigüedad. Dos (2 y 4) tienen la decisión de negocio ya resuelta pero requieren completar trabajo técnico (planes de implementación / casos de prueba restantes) antes de poder considerarse cerrados.

*(Nota: esta tabla es un snapshot histórico, anterior al cierre completo de los Pivotes 2 y 4 y a la implementación de N3/C2/R2. El estado vigente está en §10 "Matriz de decisión final" y el resumen ejecutivo de §11/§12 más abajo.)*

**Ningún código de producción fue modificado en esta etapa** — todo lo anterior es evidencia (pruebas nuevas en `test/auditoria/` + el script de benchmark en `scripts/`). Los cambios de código correspondientes a los candidatos C2 (Pivote 1) e I3 (Pivote 2) requieren un plan de implementación formal (seguí la Sección 13 de la instrucción) y autorización explícita antes de tocar `con-reintento.ts`, `movimientos.ts` o el schema.

---

## 7. Pivote 2 — Idempotencia (cierre, 2026-09-17)

### Política de negocio recibida (completa)

| Decisión | Resolución |
|---|---|
| Alcance | **I3** — todas las operaciones manuales: COMPRA, CONSUMO, VENTA, MERMA, PRODUCCIÓN, DEVOLUCIONES, RECLASIFICACIÓN, aceptar/rechazar TRASPASO |
| Identidad de "misma operación" | Clave de idempotencia generada por el cliente (un UUID por intento de envío, estilo Stripe) — no depende de un campo de negocio distinto por proceso |
| Comportamiento ante duplicado | Devolver el resultado original, silenciosamente (no error, no efecto nuevo) |
| Retención de la clave | Para siempre, como columna en `Operacion` (ya append-only) — sin expiración ni job de limpieza |
| Unicidad de factura en COMPRA | `sucursalId + proveedorId + nroFactura` (confirma el alcance que el guard actual ya intenta lograr, sin atomicidad) |

### Verificación nueva: repetición secuencial en el resto de los procesos de la política

Prueba nueva en `test/auditoria/idempotencia-resto-de-procesos.test.ts` (5 escenarios) — confirma, con evidencia reproducible y SIN modificar código, que **ningún proceso de la política I3 tiene hoy protección contra un reenvío secuencial del mismo payload**, más allá de lo ya conocido de COMPRA (racy) y CONSUMO (sin protección):

| Proceso | Resultado del reenvío secuencial |
|---|---|
| MERMA | 2 Operaciones, descuenta el doble |
| PRODUCCIÓN | 2 Operaciones, consume el insumo el doble |
| DEVOLUCION_PROVEEDOR | 2 Operaciones — ni siquiera tiene el guard racy que COMPRA al menos intenta |
| RECLASIFICACIÓN | Se ejecuta dos veces sin ningún guard de identidad — lo único que impediría un tercer reenvío sería agotar el stock disponible, no una protección deliberada |
| VENTA | 2 Operaciones, mismo patrón que CONSUMO |
| Aceptar/rechazar TRASPASO | **Excepción**: ya probado en `traspasos-en-transito.test.ts` — el guard de estado de la máquina de estados SÍ impide una segunda aceptación (rechazada con mensaje de negocio claro, sin duplicar el movimiento). No necesita el mecanismo de clave de idempotencia para este caso puntual. |

**Casos del plan que NO pueden probarse todavía**: "reintento con la misma referencia" y "concurrencia de dos requests con la misma clave" requieren que el mecanismo de clave de idempotencia exista en el código — hoy no existe ningún campo `claveIdempotencia` en `Operacion` ni en ningún modelo. Verificarlos exige la migración correspondiente, que es justamente el cambio pendiente de autorización — quedan como **pruebas posteriores** del plan de implementación, no como verificación de línea base.

### Cierre

```text
Hallazgo: ningún proceso de la política I3 (excepto la máquina de
  estados de Traspasos, que ya protege aceptar/rechazar por otra vía)
  tiene protección alguna contra un reenvío secuencial del mismo
  payload — no solo COMPRA/CONSUMO (ya confirmado), sino también
  VENTA, MERMA, PRODUCCIÓN, DEVOLUCIONES y RECLASIFICACIÓN.

Pivote: 2 — Idempotencia

Evidencia previa reutilizada: docs/auditoria-motor2-fase0-fase1-2026-09-16.md
  §8 (Hallazgo 2: COMPRA racy bajo concurrencia real) y Escenario 3 de
  concurrencia-idempotencia.test.ts (CONSUMO sin protección secuencial).

Verificación nueva: test/auditoria/idempotencia-resto-de-procesos.test.ts
  (MERMA, PRODUCCIÓN, DEVOLUCION_PROVEEDOR, RECLASIFICACIÓN, VENTA).

Resultado: en los 5 procesos probados, el reenvío secuencial del mismo
  payload se procesó dos veces sin ningún aviso ni bloqueo. Traspasos
  (aceptar/rechazar) es la única excepción — ya protegido por su propia
  máquina de estados.

Estado de evidencia: FALLO_CONFIRMADO (ausencia de protección, en los 7
  procesos de la política salvo Traspasos) — no es una hipótesis, es
  reproducible en cada corrida.

Impacto: doble carga de stock/costo/venta ante doble-submit de UI o
  reintento de red, en cualquiera de estos procesos.

Decisión: CERRADO CON CAMBIO — I3

Alternativa elegida: I3, según la política ya definida por el negocio
  (ver tabla arriba). Requiere: (a) columna `claveIdempotencia String?`
  en `Operacion` con `@@unique([sucursalId, proceso, claveIdempotencia])`
  (nulleable para no romper flujos que todavía no la envíen durante una
  migración gradual); (b) que cada Server Action de la política reciba
  la clave del cliente y, antes de escribir, busque si ya existe una
  Operacion con esa combinación — si existe, devuelve el resultado
  original en vez de reprocesar; (c) que el chequeo de "ya existe" y la
  escritura ocurran DENTRO de la misma `conTransaccionSerializable`
  (corrige también la raíz del Hallazgo 2 — el guard de factura de
  COMPRA pasa a ser un caso particular de este mecanismo general, no uno
  aparte); (d) generar la clave en el cliente (un `crypto.randomUUID()`
  al montar cada formulario/abrir cada modal de confirmación, reenviado
  tal cual en reintentos).

¿Requiere código?: Sí — todas las Server Actions de la política I3
  (`movimientos.ts`, `venta.ts`, `reclasificacion.ts`) y sus formularios
  cliente correspondientes.

¿Requiere schema?: Sí — nueva columna + índice único en `Operacion`
  (migración).

¿Requiere dependencia?: No.

¿Requiere decisión de negocio?: No — completa, ver tabla arriba.

Pruebas pendientes (posteriores a la implementación, no de esta etapa):
  timeout posterior a confirmación; reintento con la misma clave;
  concurrencia de dos requests con la misma clave; reintento con la
  misma clave pero payload distinto (debe fallar o ignorarse, a definir
  en el plan de implementación formal).

Riesgos: migración aditiva (columna nulleable), bajo riesgo de romper
  flujos existentes durante el rollout; el mayor riesgo es de UX/alcance
  del frontend (cada formulario de los 7 procesos necesita generar y
  reenviar la clave).

Criterio de cierre: cumplido para la VERIFICACIÓN — política completa,
  evidencia de ausencia confirmada en los 7 procesos. El cierre de la
  IMPLEMENTACIÓN queda pendiente de un plan formal (Sección 13) y
  autorización explícita para tocar código/schema.
```

**Tabla de cierre (Pivote 2):**

| Pivote | Estado de partida | Verificaciones nuevas | Evidencia final | Decisión | Cambio necesario | Pendiente |
|---|---|---|---|---|---|---|
| 2. Idempotencia | FALLO_CONFIRMADO + política pendiente | 5 procesos adicionales (MERMA/PRODUCCIÓN/DEVOLUCIÓN/RECLASIFICACIÓN/VENTA) | FALLO_CONFIRMADO en 6 de 7 procesos de la política (Traspasos ya protegido) | **CERRADO CON CAMBIO — I3** | Columna + índice único en `Operacion`, clave generada en cliente, chequeo dentro de la transacción en 3 Server Actions | Plan de implementación formal + pruebas posteriores (no autorizado todavía) |

*(Nota de corrección, 2026-09-17: el cierre de arriba fue prematuro — faltaba la matriz de cobertura completa por proceso, incluyendo aceptación/rechazo/reingreso de traspaso por separado. Corregido en §8.)*

---

## 8. Pivote 2 — Matriz de cobertura completa y reglas técnicas (2026-09-17)

### Matriz de cobertura por proceso

| Proceso | Protección hoy | Clasificación | Evidencia |
|---|---|---|---|
| COMPRA | `findFirst` antes de la transacción, sin atomicidad con la escritura | **Guarda de aplicación no atómica** | Hallazgo 2, §8 arriba — 1/5 corridas produjo una factura duplicada real |
| CONSUMO | Ninguna | **Ninguna** | Escenario 3, `concurrencia-idempotencia.test.ts` |
| VENTA | Ninguna | **Ninguna** | `idempotencia-resto-de-procesos.test.ts` |
| MERMA | Ninguna | **Ninguna** | ídem |
| PRODUCCIÓN | Ninguna | **Ninguna** | ídem |
| DEVOLUCIÓN (proveedor/consignación/cliente) | Ninguna — probado directamente para `DEVOLUCION_PROVEEDOR`; `DEVOLUCION_CONSIGNACION`/`DEVOLUCION_CLIENTE` comparten exactamente el mismo camino de código (`registrarMovimiento`, sin ningún chequeo específico de proceso más allá de COMPRA) | **Ninguna** (extendido por lectura de código a las 3 variantes) | `idempotencia-resto-de-procesos.test.ts` (directo, `DEVOLUCION_PROVEEDOR`) + `movimientos.ts:220` (único chequeo de duplicado existente, condicionado a `proceso === "COMPRA"`) |
| RECLASIFICACIÓN | Ninguna — lo único que detiene un tercer reenvío es agotar el stock disponible, no una protección deliberada | **Ninguna** | ídem |
| Aceptación de traspaso | Guard de estado (`estado !== "ENVIADA"`) DENTRO de `conTransaccionSerializable` — atómico, pero responde con un ERROR explícito, no con el resultado original en silencio | **Guarda de aplicación atómica** (no es idempotencia-por-clave; es guard-de-estado, semántica distinta a la política nueva) | `traspasos-en-transito.test.ts`, "Aceptación duplicada" |
| Rechazo de traspaso | Guard de estado check-then-act, **SIN transacción** — confirmado racy: dos rechazos simultáneos con motivo distinto, los DOS responden `ok:true`, y el segundo pisa el `motivoRechazoDestino` del primero sin que nadie se entere | **Guarda de aplicación no atómica** — mismo patrón que el Hallazgo 2 de COMPRA | `traspasos-en-transito.test.ts`, "rechazo simultáneo" (nuevo, 5/5 corridas con el mismo resultado) |
| Reingreso de traspaso | Guard de estado (`estado !== "RECHAZADA_DESTINO"`) DENTRO de `conTransaccionSerializable` — misma estructura de código que Aceptación | **Guarda de aplicación atómica** (por lectura de código; no se corrió una prueba de concurrencia directa para este paso puntual — estructuralmente idéntico a Aceptación, que sí se probó) | `traspasos.ts:339-367` (código); sin prueba de concurrencia directa — gap menor, mismo patrón ya verificado |

**Ningún proceso usa hoy una constraint de base de datos** para nada de esto — ni siquiera COMPRA, cuyo guard es 100% de aplicación. Y ningún proceso implementa la semántica exacta de la política nueva (silenciar y devolver el resultado original) — los guards de estado de Traspasos responden con error, no con éxito silencioso; eso significa que incluso Aceptación/Reingreso, aunque atómicos, necesitan ajustarse para cumplir la política si se quiere un comportamiento uniforme en los 10 procesos.

**Hallazgo nuevo**: el Rechazo de traspaso tiene el mismo defecto estructural que COMPRA (check-then-act sin transacción) — no estaba identificado como tal hasta esta verificación. Impacto acotado (no toca Kardex/stock, solo pierde un `motivo` de texto), pero es el mismo patrón de riesgo.

### Reglas técnicas explícitas

**1. Misma clave con payload diferente:**

```text
misma clave + mismo payload → devolver el resultado original (política ya definida)
misma clave + payload diferente → rechazar por conflicto de idempotencia
```

Es la semántica estándar (mismo criterio que Stripe/idempotency-key REST): la clave identifica "un intento", no "cualquier request de ese usuario". Si el payload no coincide, no es un reintento — es un uso incorrecto de la clave (el cliente la reutilizó sin cambiarla). Se compara el payload completo (o un hash del mismo) contra el guardado en la primera escritura.

**2. Facturas sin número — resuelto sin necesitar una decisión de negocio nueva** (es la formalización de un comportamiento ya existente e intencional, no un cambio):

```text
factura sin número / número vacío → la constraint de unicidad de factura
  NO aplica (índice único PARCIAL: WHERE "nroFactura" IS NOT NULL) —
  mismo comportamiento que hoy ("una factura sin número no se puede
  comparar, no bloquea", movimientos.ts:220). La clave de idempotencia
  general (Regla 1) sigue protegiendo esta compra igual, aunque no
  tenga número de factura.

proveedor inexistente → ya validado hoy por FK real (Producto/Proveedor),
  no es un caso de idempotencia — un proveedorId inválido falla antes de
  llegar a este chequeo.

proveedor cambiado en un reintento → cae en la Regla 1 (mismo payload
  esperado; un proveedorId distinto es un payload distinto → conflicto de
  idempotencia, no un reintento válido).

misma factura con payload diferente (otro producto/cantidad) → la
  constraint de unicidad de factura NO compara payload — cualquier
  segunda COMPRA con el mismo sucursal+proveedor+número se rechaza
  directo, sin importar el resto del payload (ya es el comportamiento
  actual, solo se vuelve atómico). Es una regla de negocio distinta de
  la idempotencia por clave: "esta factura ya se cargó" vs. "este mismo
  intento de request ya se procesó" son dos preguntas diferentes,
  conviven como dos constraints separadas.
```

### Pivote 2: CERRADO CON CAMBIO — I3 (matriz completa)

Con la matriz de cobertura cerrada y las dos reglas técnicas resueltas, el plan de implementación queda completo:

1. `claveIdempotencia String?` + `payloadHash String?` en `Operacion`, `@@unique([sucursalId, proceso, claveIdempotencia])` (nulleable, migración aditiva).
2. Índice único parcial adicional para COMPRA: `@@unique([sucursalId, proveedorId, nroFactura])` con condición `WHERE "nroFactura" IS NOT NULL` (reemplaza el `findFirst` actual, que se puede dejar como mensaje de error amigable ANTES de intentar el insert, con la constraint como árbitro final atómico — mismo patrón que `crearConCodigoAutogenerado` ante P2002).
3. Todas las Server Actions de la política (COMPRA, CONSUMO, VENTA, MERMA, PRODUCCIÓN, 3× DEVOLUCIÓN, RECLASIFICACIÓN) reciben la clave del cliente y, dentro de `conTransaccionSerializable`, chequean existencia antes de escribir.
4. Traspasos: además de agregar la clave general, ajustar `aceptarTransferencia`/`confirmarReingresoTransferencia` para devolver el resultado original en vez de error cuando el duplicado es un reintento genuino (mismo actor, mismo traspaso, dentro de una ventana razonable) — y mover `rechazarTransferencia` a `conTransaccionSerializable` para cerrar el hallazgo nuevo (check-then-act sin transacción).
5. Frontend: cada formulario de estos 10 puntos de entrada genera `crypto.randomUUID()` una vez (al montar/abrir el modal) y lo reenvía tal cual en cualquier reintento.

No implementado — pendiente de autorización explícita para tocar código/schema.

---

## 9. Pivote 4 — Precisión numérica (cierre, 2026-09-17)

Umbral recibido: **cero tolerancia** en stock y dinero. Se completaron los 4 puntos pendientes del plan (costos acumulados, `redondearMoneda`, reversiones, clasificación de conversiones), sin repetir los casos ya cerrados (4 decimales, factor de conversión, ruido de punto flotante ya probado, sumas repetidas, reconstrucción básica de saldo).

### Clasificación de las conversiones `Number()`

147 ocurrencias totales en `src/` (no 98 — el conteo original de la Fase 0/1 estaba subestimado por el patrón de búsqueda usado entonces). Clasificadas una por una por archivo:línea, con evidencia de si el resultado se persiste/cobra/afecta stock (`crítica`) o solo se muestra (`solo_lectura`):

| | Cantidad |
|---|---|
| Críticas (participan en algo que se persiste/cobra/valida stock) | 62 |
| Solo lectura (nunca se persisten) | 85 |

Las 62 críticas se agrupan en 5 categorías: `cantidad_stock` (36), `costo` (10), `presentacion_o_conversion` (7), `precio` (5), `porcentaje` (4). Confirmado además que **todo `src/core/reportes/`** es de solo lectura (ningún reporte escribe nada — ninguna conversión ahí puede volverse un fallo de integridad, aunque sí podría mostrar un número mal calculado).

### Casos ejecutados sobre las categorías críticas de mayor riesgo

1. **Round-trip Decimal→Number→Decimal sin edición real** (señalado por la clasificación: `recetas.ts` re-lee y re-persiste TODOS los ingredientes/pasos en cada edición parcial de cabecera): 5 ediciones sucesivas de la cabecera de una receta, sin tocar el ingrediente, no lo hicieron derivar ni un centésimo (`cantidad=0.1357`, `mermaPorcentaje=4.38`, los valores de máxima precisión que el propio schema admite, exactos tras 5 round-trips). Mismo resultado agregando un ingrediente distinto. **VERIFICADO_EN_CODIGO — sin fallo.**
2. **`resolverConsumoPorFamilia`** (reparto de consumo entre "hermanos" del mismo Insumo): la suma de las partes repartidas coincide exacta con la cantidad pedida, en 2 escenarios (3 hermanos con saldos que no dividen parejo, pidiendo el total; 5 hermanos con saldos de 4 decimales, pidiendo un monto parcial que corta a mitad de uno). **VERIFICADO_EN_CODIGO — sin fallo** en la función en sí (el residuo de punto flotante que puede aparecer en la suma intermedia, del orden de 1e-15, nunca es mayor a lo que el redondeo posterior a la unidad absorbe — salvo el hallazgo del punto 4).
3. **Costos acumulados encadenados** (`calcularCostosYMargenes`, `calcularValuacionInventario`) y **`redondearMoneda`** (borde exacto de redondeo, acumulación de 8 ventas): sin diferencia contra el cálculo de referencia en centavos exactos. **VERIFICADO_EN_CODIGO — sin fallo** (ver commit `259fe9d`).
4. **Reversiones** (`anularVenta`, incluso sobre una cantidad ya redondeada a una unidad sin decimales): el neto entre operación original y reversión es exactamente cero. **VERIFICADO_EN_CODIGO — sin fallo** (ver commit `259fe9d`).

### HALLAZGO — FALLO_CONFIRMADO: PRODUCCIÓN persiste el consumo de receta sin redondear a la unidad del insumo

```text
Hallazgo: src/server/actions/movimientos.ts, la línea `cantidad: -c.cantidad`
  (consumo de receta generado por PRODUCCIÓN) persiste el valor CRUDO de
  resolverConsumoPorFamilia/calcularConsumosProduccion, sin pasar por
  redondearACantidadDeUnidad — a diferencia de venta.ts, que para el
  MISMO tipo de dato (consumo de receta) SÍ redondea
  (`cantidadRedondeada = redondearACantidadDeUnidad(c.cantidad, ...)`)
  antes de persistir.

Pivote: 4 — Precisión numérica

Evidencia previa reutilizada: ninguna — hallazgo nuevo, surgido de la
  clasificación de conversiones (observación 3 del agente: "merma % en
  cascada... probar mermas con muchos decimales").

Verificación nueva: test/auditoria/precision-produccion-sin-redondeo.test.ts
  (2 casos) — un insumo con Unidad.decimales=0 (cantidad entera
  obligatoria), receta con mermaPorcentaje=7% y cantidad=0.3, produciendo
  7 unidades del PV: cantidadSalida = 7×0.3×1.07 = 2.247 (no entero).

Resultado: vía PRODUCCIÓN, el MovimientoStock.cantidad persistido es
  EXACTAMENTE -2.247 (no -2) — un valor con decimales pese a que la
  unidad del insumo los prohíbe explícitamente (decimales:0). El mismo
  escenario armado vía VENTA (mismo insumo, misma receta, mismo cálculo
  de consumo) persiste correctamente -2 — confirma que el defecto es
  específico del camino de PRODUCCIÓN, no del cálculo de merma en sí.

Estado de evidencia: FALLO_CONFIRMADO — reproducido, no es hipótesis.

Impacto: para cualquier insumo cuya unidad tenga pocos decimales (una
  "unidad" entera, o kg/litros con 1-2 decimales) consumido vía una
  receta de un producto marcado "Se produce", el Kardex puede terminar
  con una cantidad de más decimales de los que la propia unidad permite
  — inconsistencia de datos persistidos, no solo de presentación. Bajo
  cero tolerancia, es un fallo confirmado: la diferencia aparece en lo
  que se persiste y afecta el saldo real del insumo (aunque la magnitud
  del error por movimiento es pequeña, del orden de la fracción no
  redondeada, se acumula con cada producción).

Decisión: CERRADO CON CAMBIO — N3 (cálculo crítico puntual a corregir,
  no un problema estructural de todo el sistema — el resto de los
  procesos ya redondea correctamente).

Alternativa elegida: agregar el mismo `redondearACantidadDeUnidad(c.cantidad, ...)`
  que ya usa venta.ts, en el loop de `l.consumosReceta` de
  registrarMovimiento (PRODUCCIÓN) antes de persistir — una línea,
  mismo patrón ya probado en el resto del código, sin necesidad de
  evaluar decimal.js ni ninguna herramienta nueva.

¿Requiere código?: Sí — src/server/actions/movimientos.ts (una línea,
  dentro del loop de consumosReceta).

¿Requiere schema?: No.

¿Requiere dependencia?: No.

¿Requiere decisión de negocio?: No.

Pruebas pendientes (posteriores a la corrección): re-correr
  precision-produccion-sin-redondeo.test.ts y confirmar
  Number.isInteger(cantidadPersistida) === true en el caso ya reproducido.

Riesgos: ninguno evidente — alinea PRODUCCIÓN con el comportamiento que
  ya tienen COMPRA/CONSUMO/VENTA/AJUSTE/DEVOLUCIÓN/TRANSFERENCIA.

Criterio de cierre: cumplido para la VERIFICACIÓN (reproducido, causa
  identificada, fix mínimo propuesto). Pendiente de autorización
  explícita para aplicar el cambio de código.

IMPLEMENTADO 2026-09-17 (commit `5c0fd96`, Plan 1 de §11): fix
  aplicado exactamente como se describe arriba. Test de regresión
  confirmado en rojo antes del cambio (-2.247) y en verde después
  (-2). Suite completa 56/56 archivos, 334/334 tests. venta.ts sin
  cambios. Un test preexistente (precision-numerica-y-saldo.test.ts,
  de Fase 5) dependía implícitamente del valor sin redondear vía
  `toBeCloseTo` — actualizado a la expectativa exacta. Sin cambios de
  schema/migraciones/dependencias. `tsc`/`eslint` sin errores nuevos.
```

### Estado formal del Pivote 4

```text
Pivote 4: CERRADO CON CAMBIO — N3 (implementado, commit 5c0fd96)
Casos del plan completados: costos acumulados, redondearMoneda,
  reversiones, clasificación de 147 conversiones (62 críticas / 85
  solo_lectura), más 2 casos adicionales de alto riesgo identificados
  por la propia clasificación (round-trip de receta, reparto por
  familia) — sin fallo en ninguno de esos.
Fallo confirmado: 1 (PRODUCCIÓN sin redondear consumo de receta a la
  unidad del insumo) — puntual, con fix de una línea ya identificado.
Cambio de arquitectura: no justificado (no se encontró evidencia para
  N4/N5 — Decimal en aplicación o decimal.js; el patrón actual
  "float en cálculo + redondeo explícito antes de persistir" funciona
  en el resto del sistema, con un único punto donde falta aplicarlo).
```

**Tabla de cierre (Pivote 4):**

| Pivote | Estado de partida | Verificaciones nuevas | Evidencia final | Decisión | Cambio necesario | Pendiente |
|---|---|---|---|---|---|---|
| 4. Precisión numérica | VERIFICADO_EN_CODIGO (casos base) + umbral cero-tolerancia | Costos acumulados, redondearMoneda, reversiones, clasificación de 147 conversiones, round-trip de receta, reparto por familia, PRODUCCIÓN vs VENTA | 1 FALLO_CONFIRMADO (PRODUCCIÓN sin redondear) + VERIFICADO_EN_CODIGO en el resto | **CERRADO CON CAMBIO — N3** | Agregar `redondearACantidadDeUnidad` en `movimientos.ts` (consumosReceta de PRODUCCIÓN) — 1 línea | **IMPLEMENTADO** (commit `5c0fd96`, 2026-09-17) |

---

## 10. Matriz de decisión final (2026-09-17)

Los 6 pivotes están cerrados. Esta matriz consolida el resultado, sin repetir evidencia ya documentada en §5-9 (referenciada por sección).

| Pivote | Pregunta | Evidencia | Estado | Alternativa elegida | ¿Requiere cambios? | Prioridad de implementación | Responsable de decisión |
|---|---|---|---|---|---|---|---|
| 1. Concurrencia | ¿El aislamiento/reintentos garantiza resultado correcto ante operaciones simultáneas? | 5 escenarios, 25+ corridas (§5, §6) — `con-reintento.ts` no reconoce todos los conflictos reales del driver | FALLO_CONFIRMADO (parcial) | **C2** | Sí — modificar código + agregar prueba de regresión — **IMPLEMENTADO** | 2 | Técnica (sin decisión de negocio pendiente) |
| 2. Idempotencia | ¿Debe impedirse que un doble envío/timeout/reintento duplique una operación? | Ausencia confirmada en 6/7 procesos + 2 guardas racy — COMPRA y rechazo de traspaso (§7, §8) | FALLO_CONFIRMADO | **I3** | Sí — modificar código (8 Server Actions) + modificar schema/migración + agregar pruebas | 4 (último — único que toca el modelo de persistencia) | Negocio (política ya definida) + técnica para ejecutar |
| 3. Traspasos en tránsito | ¿El estado "en tránsito" es válido, visible y recuperable? | 7 casos del plan, sin fallo salvo el hallazgo de rechazo (ya contabilizado en el paquete I3) (§6, §9) | VERIFICADO_EN_CODIGO | **T1** | No | — | Ninguno pendiente |
| 4. Precisión numérica | ¿Las conversiones Decimal→number y los cálculos acumulados producen diferencias bajo cero tolerancia? | 147 conversiones clasificadas, 12 casos ejecutados, 1 fallo puntual reproducido (§9) | FALLO_CONFIRMADO (puntual) | **N3** | Sí — modificar código (1 línea) + agregar prueba de regresión | 1 (primero — cambio más chico y acotado) — **IMPLEMENTADO** | Técnica |
| 5. Escalabilidad | ¿Las agregaciones/reportes soportan el volumen esperado (500-1000 mov/día, 5-10 sucursales, 3-5 años)? | Benchmark real con 551.880 movimientos (§8) — 2 consultas degradadas | FALLO_CONFIRMADO (rendimiento) | **R2** | Sí — modificar código (2 queries) — **IMPLEMENTADO** | 3 | Técnica |
| 6. Auditoría y trazabilidad | ¿Los modelos registran suficiente información para reconstruir decisiones de negocio? | Revisión campo-por-campo (§8) — Kardex fuerte, catálogo/precios/permisos sin ningún rastro | NO_ENCONTRADO (parcial) | **A1** (Kardex) + **A3 candidato** (administración) | No obligatorio ahora — mejora futura condicionada a una decisión de negocio | — | Negocio (alcance regulatorio vs. control interno, todavía sin definir) |

### Los 4 paquetes de cambio, en el orden acordado

```text
1. N3 — Precisión (más chico y acotado) — IMPLEMENTADO (commit 5c0fd96, 2026-09-17)
   Archivo: src/server/actions/movimientos.ts
   Cambio: 1 línea (redondearACantidadDeUnidad en consumosReceta de PRODUCCIÓN)
   Prueba de regresión: precision-produccion-sin-redondeo.test.ts, expectativas
     invertidas (confirmado rojo antes / verde después). Suite completa
     56/56 archivos, 334/334 tests. venta.ts sin cambios.

2. C2 — Concurrencia — IMPLEMENTADO (commit 5ff3cff, 2026-09-17)
   Archivo: src/core/movimientos/con-reintento.ts
   Cambio: ampliar el reconocimiento de conflicto más allá de P2034
   Prueba de regresión: concurrencia-idempotencia.test.ts,
     concurrencia-casos-2-3.test.ts — endurecidas a loop de 15
     intentos exigiendo éxito siempre (confirmado rojo antes / verde
     después, 60 intentos totales sin fallo tras el fix)

3. R2 — Escalabilidad — IMPLEMENTADO (commit 9c52d6f, 2026-09-17)
   Archivos: src/core/reportes/periodo.ts (select acotado, el filtro de
     fecha ya estaba bien), src/core/reportes/historial-producto.ts
     (saldoInicial por agregación + detalle filtrado en la query)
   Medido con un producto sintético de 30.000 movimientos: historial
     con filtro de 1 mes 1012.8ms → 85.1ms (~12x); período de 3 años
     3772.1ms → 2119.7ms (~44%). Sin índices ni migraciones nuevas.

4. I3 — Idempotencia (el más grande, separado del resto)
   Archivos: prisma/schema.prisma (migración), 8 Server Actions,
     formularios cliente correspondientes
   Cambio: columna + índice único en Operacion, clave generada en
     cliente, chequeo dentro de cada transacción, ajuste de
     rechazarTransferencia a transacción
   Plan de implementación formal (Sección 13) todavía por escribir en
     detalle antes de tocar código — es el único paquete que modifica
     contratos de varias Server Actions y el schema a la vez
```

**Auditoría: cerrada. Decisiones: tomadas. Implementación: pendiente de autorización explícita**, paquete por paquete, en el orden de arriba. No se modificó ningún archivo de producción en toda esta etapa de verificación — solo pruebas en `test/auditoria/`, el script de benchmark, y esta documentación.

---

## 11. Planes de implementación detallados (Sección 13, 2026-09-17)

**Corrección importante antes de detallar R2**: al leer `src/core/reportes/periodo.ts` línea por línea para escribir este plan, encontré que mi caracterización anterior (§9/§10, "obtenerReportePorPeriodo... no filtra por fecha") era **imprecisa**. La query SÍ filtra por fecha en el `WHERE` desde el principio (`operacion: { fecha: { gte: desde, lte: hasta } }`, `periodo.ts:66-71`) — no es el mismo defecto que `obtenerHistorialProducto`. La lentitud medida (2,24s con rango de 3 años) es proporcional a que ese rango, en el dataset del benchmark, ES literalmente todo el historial (~552.000 filas con 3 `include` anidados cada una) — un resultado grande pero correctamente filtrado, no una query rota. Lo dejo corregido acá porque la auditoría no debe sostener una caracterización menos precisa de la que el propio código sostiene, aunque ya estuviera commiteada.

### Plan 1 — N3 (Precisión numérica)

```text
1. Problema confirmado:
   PRODUCCIÓN persiste el consumo de receta (l.consumosReceta,
   movimientos.ts) sin redondearACantidadDeUnidad — a diferencia de
   VENTA, que para el mismo tipo de dato sí redondea. Reproducido:
   unidad con decimales:0 queda con -2.247 en vez de -2.

2. Comportamiento esperado:
   Mismo patrón que venta.ts: redondear cada c.cantidad a los
   decimales de la unidad de stock del insumo consumido ANTES de
   persistir la fila de MovimientoStock.

3. Archivos y tablas afectados:
   src/server/actions/movimientos.ts — loop `for (const c of
   l.consumosReceta)` (~línea 310-314). Ninguna tabla nueva; mismo
   schema.

4. Cambio mínimo:
   a) Extender el include del `tx.producto.findUnique({ where: { id:
      c.productoId } })` ya existente (usado para chequear
      esConsignacion) para traer también `unidadStock`.
   b) Calcular `const cantidadRedondeada =
      redondearACantidadDeUnidad(c.cantidad, consumido?.unidadStock
      .decimales ?? 2)` y usar `cantidadRedondeada` (no `c.cantidad`)
      en el `cantidad: -cantidadRedondeada` de la fila CONSUMO.
   c) La línea LIQUIDACION_CONSIGNACION (si esConsignacion) ya usa
      `c.cantidad` solo para calcular `precioTotal` — cambiar también
      ahí a `cantidadRedondeada` para que el importe financiero
      coincida con la cantidad real que quedó en el Kardex.

5. Comportamiento que podría cambiar:
   El valor persistido de MovimientoStock.cantidad para consumos de
   receta generados por PRODUCCIÓN, en recetas cuya cantidad×merma dé
   un resultado no exacto para la unidad del insumo. Ningún otro
   proceso se toca. Datos YA persistidos con el bug no se corrigen acá
   (no se tocan datos históricos) — quedaría como una acción separada
   si el negocio decide corregir el Kardex ya cargado vía un AJUSTE
   compensatorio, fuera de este plan.

6. Pruebas de caracterización previas:
   test/auditoria/precision-produccion-sin-redondeo.test.ts ya existe
   y documenta el comportamiento ACTUAL (falla) con
   `expect(cantidadPersistida).toBe(-2.247)`.

7. Pruebas posteriores:
   Invertir las 2 expectativas del mismo archivo:
   `expect(Number.isInteger(cantidadPersistida)).toBe(true)` y
   `expect(cantidadPersistida).toBe(-2)`. Correr la suite completa
   (56 archivos) para confirmar que ningún test existente asumía el
   valor sin redondear.

8. Migración y compatibilidad:
   Ninguna.

9. Riesgos:
   Bajos — cambio de una función, mismo patrón ya probado en
   venta.ts. Único riesgo real: que algún test o reporte dependa hoy
   (sin saberlo) del valor sin redondear — se descarta con la suite
   completa antes de commitear.

10. Rollback:
    Revertir el commit — no hay backfill de datos que deshacer (no se
    tocan filas existentes).

11. Criterio de cierre:
    precision-produccion-sin-redondeo.test.ts pasa con las
    expectativas invertidas; suite completa (56 archivos) en verde;
    `tsc`/`eslint`/`next build` limpios.
```

### Plan 2 — C2 (Concurrencia)

```text
1. Problema confirmado:
   conTransaccionSerializable (con-reintento.ts) solo reconoce
   Prisma.PrismaClientKnownRequestError con code==="P2034" como
   conflicto reintentable. Conflictos reales de Postgres (SQLSTATE
   40001/40P01) a veces llegan como DriverAdapterError({kind:
   "TransactionWriteConflict"}) — una clase distinta, no reconocida —
   y se relanzan en el primer intento sin reintentar. Reproducido en
   CONSUMO (registrarMovimiento) y VENTA (registrarVenta).

2. Comportamiento esperado:
   Cualquier conflicto de serialización/deadlock real de Postgres,
   sea cual sea la forma en que Prisma 7 + @prisma/adapter-pg lo
   expongan, se reintenta hasta maxIntentos — igual que ya pasa con
   P2034 hoy.

3. Archivos y tablas afectados:
   src/core/movimientos/con-reintento.ts (única función). Ninguna
   tabla.

4. Cambio mínimo:
   Ampliar la condición `esConflicto` para reconocer también un
   DriverAdapterError con kind "TransactionWriteConflict", sin
   agregar `@prisma/driver-adapter-utils` como dependencia directa
   (hoy es transitiva de @prisma/adapter-pg) — usar un chequeo por
   forma (duck-typing acotado): `e?.constructor?.name ===
   "DriverAdapterError" && (e as any)?.cause?.kind ===
   "TransactionWriteConflict"`, documentando en un comentario por qué
   no se usa `instanceof` (evitar atar el código a una versión
   específica del paquete transitivo) y citando el hallazgo que lo
   motiva.

5. Comportamiento que podría cambiar:
   Operaciones que HOY fallan duro (error crudo, no un mensaje de
   negocio) bajo conflicto real empiezan a reintentarse
   silenciosamente — mejora de disponibilidad, no cambia el resultado
   final de ningún caso ya cubierto por el reconocimiento de P2034.

6. Pruebas de caracterización previas:
   test/auditoria/concurrencia-idempotencia.test.ts (Escenario 1b) y
   concurrencia-casos-2-3.test.ts (Caso 2) ya existen y usan
   Promise.allSettled, TOLERANDO el rechazo actual (documentan el
   fallo con un console.log "HALLAZGO").

7. Pruebas posteriores:
   Reescribir esos 2 escenarios para usar Promise.all (no allSettled)
   y exigir que ambas operaciones legítimas concurrentes tengan éxito
   SIEMPRE — correr cada escenario 10 veces en un loop dentro del
   mismo test (no manualmente desde la terminal) para confirmar cierre
   determinístico, no solo estadístico.

8. Migración y compatibilidad:
   Ninguna.

9. Riesgos:
   Medio — el riesgo real es reintentar un error que NO sea un
   conflicto de escritura genuino (ej. un timeout de red real),
   enmascarando un problema de infraestructura distinto. Mitigación:
   acotar el chequeo exactamente al kind "TransactionWriteConflict"
   (el único mapeo de 40001/40P01 en @prisma/adapter-pg, confirmado
   por lectura de su código fuente en esta misma auditoría) — nunca
   un catch-all de cualquier DriverAdapterError.

10. Rollback:
    Revertir con-reintento.ts a la condición original (solo P2034).

11. Criterio de cierre:
    Los 2 escenarios de concurrencia corren 10/10 veces sin ningún
    rechazo espurio; suite completa en verde.

IMPLEMENTADO 2026-09-17 (commit `5ff3cff`): fix aplicado como
  `esConflictoDeEscritura(e)`, reconociendo P2034 y
  DriverAdapterError({cause.kind:"TransactionWriteConflict"}). Pruebas
  de concurrencia endurecidas a loop de 15 intentos (no 10) exigiendo
  éxito siempre — confirmadas en ROJO contra el código sin corregir
  (reprodujo el DriverAdapterError crudo en intento 8/15 y 2/15 según
  el archivo), y en VERDE después del fix: 15/15 + 3 corridas
  adicionales completas (60 intentos totales sin ningún rechazo).
  Suite completa 56/56 archivos, 334/334 tests. `tsc`/`eslint` sin
  errores nuevos (verificado contra la línea base con `git stash`).
  Diff confirmado en alcance: solo `con-reintento.ts` + 2 archivos de
  test — R2, I3, schema y `package.json` sin ningún cambio. No
  apareció ningún conflicto de otro tipo durante la implementación.
```

### Plan 3 — R2 (Escalabilidad)

```text
1. Problema confirmado:
   obtenerHistorialProducto (historial-producto.ts:84-91) carga TODO
   el historial de un producto (sin filtrar por fecha en la query) y
   recién filtra por desde/hasta DESPUÉS de calcular el saldo
   corriente sobre el array completo en memoria — crece sin límite
   con productos longevos, sea cual sea el rango pedido.
   obtenerReportePorPeriodo YA filtra correctamente por fecha en el
   WHERE (corrección de mi caracterización anterior, ver nota arriba)
   — su lentitud con rangos amplios es proporcional al volumen real
   de filas dentro del rango pedido más el costo de 3 `include`
   anidados por fila, no un filtro faltante.

2. Comportamiento esperado:
   obtenerHistorialProducto: el saldo de arranque para un rango
   [desde,hasta] se calcula con UNA agregación SUM sobre los
   movimientos ANTERIORES a `desde` (no cargando el detalle), y solo
   se cargan/iteran en detalle los eventos DENTRO del rango pedido —
   mismo resultado (saldoCorriente por evento, saldoActual final),
   sin cargar el historial completo cuando se pide un rango acotado.
   obtenerReportePorPeriodo: reducir el costo por fila (evaluar si los
   3 include anidados son necesarios para todos los consumidores, o
   si algunos pueden resolverse con una proyección de columnas más
   chica) — cambio más acotado, ya que el filtro de fecha en sí ya es
   correcto.

3. Archivos y tablas afectados:
   src/core/reportes/historial-producto.ts (cambio principal),
   src/core/reportes/periodo.ts (cambio menor/opcional). Posible
   índice nuevo: hoy Operacion tiene @@index([sucursalId, proceso,
   fecha]) (schema.prisma:60) — no cubre el patrón de
   historial-producto (filtra por MovimientoStock.productoId +
   seccion.sucursalId, sin proceso) ni el de un SUM de "todo lo
   anterior a una fecha para un producto+sección puntual". Evaluar
   @@index([productoId, seccionId]) en MovimientoStock más un índice
   de apoyo en Operacion.fecha si el EXPLAIN ANALYZE de la query
   nueva lo justifica — no agregar índices por intuición (regla
   explícita de la auditoría), decidir con evidencia de plan real.

4. Cambio mínimo:
   historial-producto.ts: separar en 2 queries — (a) `aggregate` de
   MovimientoStock con SUM(cantidad) WHERE productoId+seccionId(opc)+
   operacion.fecha < desde → saldoInicial; (b) findMany igual que hoy
   pero con operacion.fecha >= desde (y <= hasta si aplica) en el
   WHERE. Recalcular saldoCorriente arrancando desde saldoInicial en
   vez de 0. Cuando no se pasa `desde` (caso actual sin filtro), el
   comportamiento debe ser idéntico al de hoy (saldoInicial=0, se
   carga todo) — no cambia el caso ya usado desde la UI sin filtro de
   fecha, si es que existe.

5. Comportamiento que podría cambiar:
   Ninguno visible si se implementa bien — mismos saldoCorriente y
   saldoActual para el mismo producto/rango. Riesgo real: un error en
   la separación saldoInicial/detalle produciría un saldoCorriente
   incorrecto — mitigado por las pruebas de caracterización (punto 6).

6. Pruebas de caracterización previas:
   test/reportes/historial-producto.test.ts y test/reportes/
   periodo.test.ts ya existen y cubren el comportamiento funcional
   actual (incluyendo el caso ya probado de saldo corriente + conteos
   físicos mezclados en la misma línea de tiempo) — sirven de
   caracterización sin escribir nada nuevo.

7. Pruebas posteriores:
   Los mismos tests existentes deben seguir en verde SIN cambiar
   ninguna expectativa (mismo resultado funcional). Re-correr
   scripts/auditoria-benchmark-reportes.ts con el mismo escenario
   (552k movimientos) y confirmar mejora medible en el punto 5b
   (historial de producto caliente, rango de 1 mes) — hoy 27,6ms
   sobre datos ya baratos por el índice existente, pero el ahorro
   debería ser mayor en un dataset con MUCHOS más años de historial
   por producto (no representado a esta escala) — documentar la
   limitación de que el benchmark actual no estresa este caso todo lo
   posible, y considerar un producto sintético con más movimientos si
   se quiere una medición más contundente antes de cerrar.

8. Migración y compatibilidad:
   Solo si el EXPLAIN ANALYZE del punto 3 confirma que hace falta un
   índice nuevo — a decidir con evidencia real durante la
   implementación, no de antemano.

9. Riesgos:
   Medio — el cálculo de saldo corriente es el punto más delicado de
   todo el reporte (un error ahí es silencioso: números que se ven
   razonables pero están mal). Mitigar con los tests existentes +
   agregar un caso específico que compare el resultado CON filtro de
   fecha contra el resultado SIN filtro (recortado manualmente) para
   el mismo producto, confirmando que dan exactamente los mismos
   saldoCorriente en el rango común.

10. Rollback:
    Revertir los 2 archivos a la versión anterior (queries de lectura,
    sin migración que deshacer salvo que el punto 8 haya aplicado un
    índice — down migration para eso).

11. Criterio de cierre:
    Tests existentes en verde sin cambios de expectativa + el caso
    nuevo de "con filtro == sin filtro recortado" en verde; benchmark
    re-corrido con mejora medible o, si no la hay a esta escala,
    justificación explícita de por qué (dataset del benchmark no
    estresa lo suficiente este caso puntual).

IMPLEMENTADO 2026-09-17 (commit `9c52d6f`): corrección de diagnóstico
  importante antes de implementar — `obtenerReportePorPeriodo` NO
  tenía el defecto de "sin filtro de fecha" (ya filtraba en el WHERE,
  confirmado con EXPLAIN ANALYZE: 106ms de ejecución SQL real para
  ~69.000 filas). Su lentitud era por el costo de hidratación de
  Prisma Client con `include` completo — medido específicamente
  (findMany con include completo vs select acotado, mismo dataset, 3
  corridas cada uno): ~2000ms vs ~1150ms, ~45% más rápido, sin cambiar
  el filtro de fecha ni una sola fila del resultado.

  `obtenerHistorialProducto` sí tenía el defecto real (carga sin
  filtro). Fix: saldoInicial vía `aggregate` SUM(cantidad) WHERE fecha
  < desde (sin cargar detalle), detalle traído ya filtrado por
  [desde,hasta] en el WHERE, saldoCorriente arranca de saldoInicial.
  saldoActual/totalMovimientos/totalConteos calculados aparte, SIN
  filtro de fecha (agregación/count independientes) — preserva
  exactamente la invariante ya documentada en el código y visible en
  la UI ("el saldo corriente arranca del primer movimiento real, no
  del rango elegido"). Verificado con test/reportes/
  historial-producto.test.ts: 3 casos preexistentes sin cambios de
  expectativa + 3 regresiones nuevas (totalMovimientos con `desde`
  activo, solo `hasta` sin `desde`, seccionId+rango combinados).

  Medición controlada antes/después (git stash del fix, mismo dataset
  vía scripts/auditoria-benchmark-reportes.ts extendido con un
  producto sintético de 30.000 movimientos concentrados — casos 5c/5d
  nuevos del benchmark): historial con filtro de 1 mes 1012,8ms →
  85,1ms (~12×); el mismo producto SIN filtro de fecha se mantuvo casi
  igual (917,7ms → 902,3ms — correcto, ahí no hay nada que optimizar,
  necesita todo el historial igual); período de 3 años 3772,1ms →
  2119,7ms (~44%); período de 7 días sin cambio significativo (ya era
  rápido). Ningún índice ni migración fue necesario. Suite completa
  56/56 archivos, 337/337 tests. `tsc`/`eslint` sin errores nuevos.
  C2 e I3 sin cambios (diff vacío verificado en 7 archivos).

  Nota de alcance sobre el benchmark: los milisegundos de arriba salen
  de un dataset SINTÉTICO (551.880 movimientos del escenario estándar
  + 30.000 concentrados en un producto puntual, generados vía SQL
  bulk, no vía tráfico real) corriendo en este contenedor de sesión,
  no en la infraestructura de producción (Neon). Son comparativos —
  antes/después sobre el MISMO dataset, en la MISMA corrida — y
  confiables como evidencia de que el cambio reduce el costo real de
  estas dos consultas. No deben leerse como una garantía de tiempo de
  respuesta en producción (que depende de la latencia de red a Neon,
  el hardware real, y el volumen real del negocio) ni como un SLA.
```

### Plan 4 — I3 (Idempotencia) — el más grande, deliberadamente aislado

```text
1. Problema confirmado:
   6 de 7 procesos manuales (todos salvo Traspasos) no tienen NINGUNA
   protección contra reenvío/duplicación (§7); COMPRA y rechazo de
   Traspaso tienen guardas check-then-act NO atómicas, confirmadas
   racy con reproducción real (Hallazgo 2, §8, y el hallazgo de
   rechazo de traspaso, §8).

2. Comportamiento esperado (política ya definida, §7):
   Clave de idempotencia generada por el cliente; misma clave+mismo
   payload → resultado original, silencioso; misma clave+payload
   distinto → rechazo por conflicto; retención permanente atada a
   Operacion; unicidad de factura de COMPRA por sucursal+proveedor+
   número (índice único parcial, sin bloquear facturas sin número).

3. Archivos y tablas afectados:
   prisma/schema.prisma (Operacion: + claveIdempotencia String?, +
   payloadHash String?, @@unique([sucursalId, proceso,
   claveIdempotencia]); + índice único parcial para COMPRA — nueva
   migración). src/server/actions/movimientos.ts, venta.ts,
   reclasificacion.ts, traspasos.ts (las 8 Server Actions de la
   matriz de cobertura, §8, más mover rechazarTransferencia a
   conTransaccionSerializable). Formularios cliente de los 10 puntos
   de entrada (generar crypto.randomUUID() al montar/abrir cada
   modal).

4. Cambio mínimo — DECISIÓN DE DISEÑO A RESOLVER ANTES DE ESCRIBIR
   CÓDIGO (no trivial, señalada acá para que quede explícita antes de
   implementar): "devolver el resultado original" requiere decidir
   QUÉ se considera "el resultado" — hoy ningún ResultadoAccion se
   persiste en ningún lado (el mensaje de éxito se genera en memoria
   y se descarta). Dos caminos:
     (a) reconstruir el mensaje de forma determinística a partir de
         la Operacion ya existente (ej. "Se guardaron N movimiento(s)"
         con N = count de MovimientoStock de esa Operacion) — no
         requiere guardar nada nuevo más que la clave;
     (b) persistir el mensaje textual también en la columna nueva —
         más simple de implementar, algo más de storage (despreciable).
   Recomendación técnica: (a), evita una columna extra y mantiene
   `Operacion` como la única fuente de verdad — pero es una elección
   a confirmar antes de tocar código, no algo que deba decidirse
   implícitamente en el momento de escribir la Server Action.

5. Comportamiento que podría cambiar:
   Contrato de las 8 Server Actions gana un parámetro opcional
   `claveIdempotencia` — no rompe callers existentes mientras sea
   opcional (rollout gradual: primero backend acepta la clave si
   viene, LUEGO se actualiza cada formulario para enviarla). El guard
   de factura de COMPRA deja de ser un `findFirst` previo y pasa a
   ser un constraint de DB (mensaje de error cambia de forma, mismo
   contenido).

6. Pruebas de caracterización previas:
   test/auditoria/idempotencia-resto-de-procesos.test.ts,
   concurrencia-idempotencia.test.ts (Escenario 2/3),
   traspasos-en-transito.test.ts ("rechazo simultáneo") — documentan
   el comportamiento actual (duplica / racy) para los 10 procesos.

7. Pruebas posteriores (por proceso, los 10 de la matriz de §8):
   doble-submit secuencial con misma clave → 1 sola Operacion, ambas
   respuestas iguales; misma clave + payload distinto → error de
   conflicto explícito; concurrencia con misma clave (2 requests
   simultáneos) → exactamente 1 efecto, ambas respuestas coherentes;
   reintento de factura de COMPRA sin clave (compatibilidad con el
   comportamiento viejo mientras el frontend no mande la clave nueva
   en todos los formularios).

8. Migración y compatibilidad:
   Migración aditiva (columnas nulleables) — bajo riesgo de romper
   filas existentes. ADVERTENCIA que ya quedó documentada en el
   hallazgo original: antes de aplicar el índice único parcial de
   factura, correr una query de auditoría sobre datos reales
   (`GROUP BY sucursalId, proveedorId, nroFactura HAVING count(*)>1
   WHERE nroFactura IS NOT NULL`) — si existen duplicados históricos,
   la migración fallaría al crear el constraint y hay que decidir con
   el negocio cómo tratarlos (mismo criterio de la auditoría: no se
   corrigen datos históricos borrando, se documentan aparte).

9. Riesgos:
   Alto (como ya señaló el usuario) — único paquete que toca schema Y
   contrato de 8 Server Actions Y frontend a la vez. Mitigación:
   rollout gradual (clave opcional primero), y el chequeo de
   duplicados de factura ANTES de migrar (punto 8).

10. Rollback:
    Down migration (elimina columnas + índices, sin pérdida de datos
    de negocio ya que son columnas nuevas); revertir Server Actions y
    formularios en un commit separado si hace falta desactivar solo
    el frontend sin tocar el schema.

11. Criterio de cierre:
    Los 10 procesos de la matriz de cobertura (§8) pasan de
    "ninguna"/"guarda no atómica" a "idempotencia completa" verificada
    por prueba (los 4 casos del punto 7, por proceso); ningún test
    existente se rompe; auditoría de facturas duplicadas en datos
    reales sin hallazgos (o resuelta con el negocio) antes de aplicar
    el constraint de factura.
```

**Orden de implementación**: N3 → C2 → R2 → I3 (acordado). Cada paquete se implementa, prueba y commitea por separado — no se mezclan en un solo cambio.

**Estado de ejecución**: N3 **implementado** (commit `5c0fd96`, 2026-09-17). C2 **implementado** (commit `5ff3cff`, 2026-09-17). R2 **implementado** (commit `9c52d6f`, 2026-09-17) — ver detalle en el Plan 3 arriba. **I3 implementado** (2026-09-17) — ver §13, y el detalle completo en `docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md`.

*(Nota de corrección, 2026-09-17 — fase de planificación de I3: el punto 4 de este borrador contaba "8 Server Actions" y recomendaba tentativamente reconstruir el resultado desde `Operacion`, ambos condicionados a verificarse antes de implementar. Esa verificación ya se hizo — ver `docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md`, el plan formal de la fase de planificación y auditoría de datos autorizada — y corrige ambos puntos: son 6 Server Actions, no 8 (`registrarMovimiento` cubre 7 de los 10 procesos por sí sola), y la recomendación pasa a persistir el resultado (Opción B), no reconstruirlo, porque 2 de los 6 mensajes de éxito tienen lógica condicional de negocio (`avisoConversion` en `registrarMovimiento`, la cláusula de liquidación de consignación en `anularVenta`) que reconstruir implicaría duplicar esa lógica en un segundo lugar. Ese documento también identifica que `rechazarTransferencia` no crea ninguna `Operacion` y por lo tanto no puede cubrirse con la columna de idempotencia general — necesita su propio fix de atomicidad. Este borrador queda como el punto de partida original; el documento nuevo es la versión verificada y vigente.)*

---

## 12. Revisión general antes de I3 (2026-09-17)

```text
N3 ✅ implementado — commit 5c0fd96
C2 ✅ implementado — commit 5ff3cff
R2 ✅ implementado — commit 9c52d6f
I3 ⏳ pendiente de autorización
```

*(Actualizado 2026-09-17: I3 fue autorizado para su fase previa de planificación y auditoría de datos — sin autorización de código ni migraciones. Esa fase está completa, incluida la ejecución real de la auditoría de facturas duplicadas (0 conflictos, ver `docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md` §5) contra la única rama con datos reales del proyecto Neon que el usuario confirmó como motor2 (`inventario-api`, rama `demo-pizzeria-la-cuadra`) — con la salvedad de confirmar si esa rama es producción real o un ambiente demo/piloto. Ver el documento completo para las 10 precisiones contractuales adicionales resueltas (§11). La implementación de I3 sigue sin autorizar.)*

Verificación consolidada (sin repetir auditoría ni rehacer benchmarks):

| Chequeo | Resultado |
|---|---|
| Suite acumulada | **56/56 archivos, 337/337 tests** (última corrida, post-R2) |
| `tsc --noEmit` (repo completo) | Mismos errores preexistentes que antes de N3 (confirmado comparando contra el commit base `82556df`, previo a toda la auditoría) — ninguno en `movimientos.ts`, `con-reintento.ts`, `periodo.ts` ni `historial-producto.ts` |
| `eslint .` (repo completo) | **5 errores, 24 warnings — idénticos antes y después** de N3/C2/R2; ninguno en archivos tocados por esos 3 paquetes. *(Corrección, 2026-09-17: la comparación contra `82556df` citada acá se hizo con `git checkout 82556df -- .`, que no borra archivos nuevos que no existían en ese commit — quedó contaminada por los tests de la fase de investigación. Con un `git worktree` aislado, 82556df en realidad tiene solo 5 errores y 6 warnings, no 24 — ver `docs/auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md` §B para la cifra correcta y su origen real.)* |
| Working tree | Limpio, sincronizado con `origin/claude/migration-plan-px7c0b` |
| Commits | 6 commits de N3/C2/R2 (3 de código + 3 de documentación), cada uno con su propio mensaje detallado |
| Diffs dentro de alcance | Confirmado por paquete (`git show --stat`): N3 solo tocó `movimientos.ts` + 2 tests; C2 solo `con-reintento.ts` + 2 tests; R2 solo los 2 reportes + su test + el benchmark |
| Schema y migraciones | **Intactos** — `git diff --stat prisma/schema.prisma` vacío; ninguna migración nueva desde antes de esta auditoría |
| `package.json` / dependencias | Sin cambios en ningún paquete |

**Nota sobre el benchmark de R2**: los milisegundos reportados (§11 Plan 3) salen de un dataset sintético generado en este contenedor de sesión, no de producción — son evidencia comparativa (antes/después, mismo dataset, misma corrida) de que el cambio reduce el costo real de las 2 consultas, no una garantía de tiempo de respuesta en Neon ni un SLA.

**Conclusión de la revisión**: los 3 paquetes implementados (N3, C2, R2) están completos, verificados, documentados, y no dejan ningún cambio pendiente ni deuda nueva. El repositorio está en condiciones de continuar con **I3** — el plan detallado y la auditoría de facturas duplicadas en datos reales (paso previo obligatorio antes de crear el constraint, ver Plan 4 §11 punto 8) son el siguiente paso, no autorizado todavía.

---

## 13. I3 implementado (2026-09-17)

Autorización recibida tras la revisión del plan formal (`docs/auditoria-motor2-plan-i3-idempotencia-2026-09-17.md`): *"Es demo/piloto, pero autorizo implementar I3 en el código sin aplicar datos reales"* — se interpretó como: implementar schema/migración/Server Actions/frontend completos, pero la migración solo se aplicó contra la base de test local (`motor2_test`), nunca contra el proyecto Neon `inventario-api` ni ninguna de sus branches (que solo se leyeron, de solo lectura, durante la fase de auditoría — §5 del plan).

### Qué se implementó

Siguiendo exactamente el diseño del plan (schema §8, mecanismo §2-§3/§7, matriz §11.5, corrección de `rechazarTransferencia` §6.4), con una corrección de diseño real encontrada durante la implementación misma:

1. **Schema** (`prisma/schema.prisma`, migración `20260917020857_i3_idempotencia_operacion`): 3 columnas nulleables en `Operacion` (`claveIdempotencia`, `payloadHash`, `resultadoMensaje`) + `@@unique([claveIdempotencia])` global (no compuesto con `sucursalId`/`proceso` — la corrección que ya había pedido el usuario en la revisión del plan, §2.2/§11.8 del plan). Migración aditiva, generada con `prisma migrate diff` (el entorno no soporta `prisma migrate dev` no interactivo) y aplicada con `prisma migrate deploy` solo contra `motor2_test`.
2. **Mecanismo común** (`src/core/movimientos/idempotencia.ts`, nuevo): validación de formato UUID, hash SHA-256 del payload validado (incluye `sucursalId` + un identificador explícito de proceso — §11.2 del plan), chequeo de idempotencia dentro de `conTransaccionSerializable` con la regla "fail closed" de §11.3.
3. **6 Server Actions** (no 8 — corrección del plan §1 confirmada en el código): `registrarMovimiento` (7 procesos), `registrarVenta`, `reclasificarStock`, `aceptarTransferencia`, `confirmarReingresoTransferencia` reciben `claveIdempotencia` opcional y devuelven el `resultadoMensaje` persistido ante un duplicado (Opción B, §4.5 del plan).
4. **Hallazgo nuevo de implementación**: `registrarVenta` crea **una `Operacion` por línea vendida**, no una por lote (el plan no lo había señalado explícitamente) — la clave/hash/resultado del intento completo se guardan solo en la PRIMERA `Operacion` del lote; un duplicado devuelve el mensaje persistido sin tocar ninguna fila.
5. **`rechazarTransferencia`**: movido a `conTransaccionSerializable` (guarda de estado atómica, sin clave — no crea `Operacion`, §6.4 del plan) — cierra el hallazgo de "rechazo simultáneo" (§8 del documento madre).
6. **Frontend**: `crypto.randomUUID()` generado al montar cada uno de los 4 componentes de formulario (`panel-movimiento-form.tsx` cubre los 7 procesos de `registrarMovimiento`; `venta-form.tsx`; `reclasificar-form.tsx`; `bandeja.tsx` para `aceptarTransferencia`/`confirmarReingresoTransferencia`), reenviado tal cual en reintentos, renovado después de un éxito solo en los 3 formularios que se resetean en el lugar para cargar otro intento (los de la Bandeja se desmontan solos tras un éxito, no necesitan renovarlo).

### Pruebas

`test/auditoria/idempotencia-i3-mecanismo.test.ts` (nuevo, 14 tests): por cada uno de los 4 puntos de entrada distintos, los 4 casos del plan (clave nueva; mismo payload → resultado original; payload distinto → conflicto; concurrencia real con `Promise.allSettled` → exactamente 1 efecto), más formato de clave inválido y compatibilidad sin clave. `test/auditoria/traspasos-en-transito.test.ts` — el test de "rechazo simultáneo" (antes condicional, documentaba el defecto) se reescribió como regresión estricta: exactamente 1 de los 2 rechazos gana, el otro recibe un error de estado explícito.

`test/auditoria/idempotencia-resto-de-procesos.test.ts` queda **intacto** — sigue documentando correctamente el comportamiento sin clave (rollout gradual), que no cambió.

### Verificación

| Chequeo | Resultado |
|---|---|
| Suite acumulada | **57/57 archivos, 351/351 tests** (337 previos + 14 nuevos) |
| `tsc --noEmit` | Mismos errores preexistentes que la línea base (`scripts/auditoria-benchmark-reportes.ts`, `precision-costos-precios-reversiones.test.ts`, `traspasos-en-transito.test.ts`) — ninguno nuevo |
| `eslint .` | 5 errores, 22 warnings — los 5 errores son los mismos preexistentes (ninguno en archivos tocados); 2 warnings menos que la línea base, por 2 comentarios `eslint-disable` que quedaron sin uso al reemplazar `console.log` por `expect()` en el test de rechazo simultáneo (cambio esperado, no una regresión) |
| `next build` | Turbopack compila correctamente; el paso de typecheck del build falla por los mismos errores preexistentes de `scripts/`/`test/` de siempre (no relacionado con I3) |
| Diff en alcance | `git status --short`: schema, migración, 4 Server Actions, 1 módulo nuevo, 4 componentes de frontend, 2 archivos de test — nada fuera de lo previsto en el plan |
| `package.json`/dependencias | Sin cambios |
| Migración aplicada (al momento de este commit) | Solo contra `motor2_test` (local) — nunca contra Neon/`inventario-api`. Ver §14 para la migración posterior, ya autorizada y ejecutada, contra la rama demo. |
| Verificación de UI | Build + smoke test del server (`next dev`, las 4 rutas de los formularios responden 307 hacia `/login` sin error de servidor) — **no se hizo un click-through interactivo autenticado en navegador** (el entorno no tiene credenciales de OAuth configuradas); la cobertura funcional real de los 4 puntos de entrada queda en las Server Actions, probadas exhaustivamente contra Postgres real |

### Nota — flake preexistente detectado, no causado por esta implementación

Una corrida aislada de `test/auditoria/` mostró una falla intermitente en `concurrencia-idempotencia.test.ts` (assertion de "ninguna promesa debe rechazarse" bajo carrera real) — no reprodujo en 5 corridas aisladas posteriores del mismo archivo, y el archivo no fue tocado por I3 (confirmado por `git diff`, es del commit de C2). Es un test ya existente de este mismo estilo probabilístico (reintentos de `conTransaccionSerializable` bajo contención real) — se documenta por transparencia, no se investiga más a fondo por estar fuera del alcance de I3.

### Estado (al momento de este commit)

```text
N3 ✅ implementado — commit 5c0fd96
C2 ✅ implementado — commit 5ff3cff
R2 ✅ implementado — commit 9c52d6f
I3 ✅ implementado en código (2026-09-17) — migración solo aplicada local
```

---

## 14. I3 — migración aplicada en la rama demo de Neon (2026-09-17)

Autorización explícita del usuario para: (a) aplicar la migración de I3 contra `demo-pizzeria-la-cuadra` (proyecto Neon `inventario-api`) y correr ahí pruebas de humo con datos sintéticos; luego, al encontrar un bloqueo (ver abajo), autorización explícita adicional para poner al día esa rama con las migraciones previas pendientes.

### Hallazgo antes de migrar: la rama estaba 3 migraciones atrás

Al revisar el schema real de `demo-pizzeria-la-cuadra` (`information_schema.columns` + `_prisma_migrations`), la rama estaba parada en el commit del seed inicial (`8386eff`, "Agregar seed de demo... pizzería La Cuadra") — nunca se le habían aplicado las 3 migraciones posteriores ya presentes en este repo: `20260916185129_anular_venta`, `20260916194321_pago_consignante`, `20260916195006_traspaso_cancelada`. Aplicar solo I3 encima de ese schema desactualizado habría dejado la rama con `anularVenta`/`PagoConsignante`/traspaso `CANCELADA` rotos (código que asume columnas/tablas/valor de enum que no existían ahí) — un problema previo a I3, no causado por I3, pero que I3 hubiera dejado sin resolver si no se señalaba.

El usuario confirmó: **"Poner al día las 4 (recomendado)"**.

### Cómo se aplicó

El entorno de esta sesión **no tiene conectividad de red directa hacia Neon** (ni TCP plano para `prisma migrate deploy`/`DIRECT_URL`, ni WebSocket para el adapter `@prisma/adapter-neon` que usa el runtime — los dos intentos fallaron con error de red/handshake) — solo la herramienta MCP de Neon puede alcanzarlo. Por eso no se pudo correr `prisma migrate deploy` real ni la suite de Vitest apuntando a Neon; en su lugar:

1. Se creó una rama temporal (`i3-smoke-test-tmp`, hija de `demo-pizzeria-la-cuadra`) para probar sin riesgo.
2. Se aplicaron las 4 migraciones ahí (SQL de cada `migration.sql` del repo, vía la herramienta de transacciones SQL de Neon) + se insertó manualmente la fila correspondiente en `_prisma_migrations` por cada una, con el **checksum SHA-256 real del archivo** (`sha256sum prisma/migrations/<nombre>/migration.sql`, verificado primero contra una migración ya aplicada para confirmar que el método de cálculo coincide con el de Prisma) — así el historial de migraciones queda coherente para un futuro `prisma migrate deploy` real contra esa rama, no solo el schema.
3. Se corrieron 4 pruebas de humo a nivel SQL contra la rama temporal (detalle abajo) — todas OK.
4. Recién con eso verificado, se aplicaron las mismas 4 migraciones (mismo procedimiento) contra la rama REAL `demo-pizzeria-la-cuadra`.
5. Se confirmó que los datos reales de esa rama quedaron intactos (479 `Operacion` antes y después — la migración es puramente aditiva, ninguna fila se tocó).
6. Se borró la rama temporal.

### Pruebas de humo — 4 de las 5 verificadas, 1 fuera de alcance de esta sesión

| # | Prueba pedida | Resultado | Cómo se verificó |
|---|---|---|---|
| 1 | Creación de una operación nueva | ✅ OK | INSERT con `claveIdempotencia`+`payloadHash` nuevos — se escribió sin error |
| 2 | Reintento con la misma clave | ✅ OK | `SELECT ... WHERE claveIdempotencia = X` encuentra la fila, `payloadHash` coincide → exactamente la comparación que hace `chequearIdempotencia` para devolver el resultado original |
| 3 | Conflicto con payload diferente | ✅ OK | Mismo `SELECT`, hash NO coincide → detectado como distinto; además, un INSERT que intentara reusar la misma clave para una fila nueva (simulando un bug de aplicación) chocó con el índice único (`duplicate key value violates unique constraint "Operacion_claveIdempotencia_key"`) — confirma la red de seguridad a nivel DB, no solo a nivel aplicación |
| 4 | Venta con varias líneas | ✅ OK | 2 `Operacion` insertadas (1 lote de venta simulado), clave solo en la primera, `NULL` en la segunda — ambas conviven sin choque, y la búsqueda por esa clave encuentra exactamente 1 fila |
| 5 | Rechazo concurrente de transferencia | ⚠️ **NO verificable desde esta sesión** | Ver nota abajo |

**Por qué la prueba 5 (y, en general, cualquier prueba de concurrencia real contra Neon) queda pendiente**: las pruebas 1-4 son verificaciones de schema/constraint — se pueden hacer con SQL secuencial vía la herramienta de Neon. La prueba 5 (y la garantía más amplia de C2 — si `@prisma/adapter-neon` produce el mismo `DriverAdapterError`/`cause.kind === "TransactionWriteConflict"` que `@prisma/adapter-pg`, que es lo que `esConflictoDeEscritura` sabe reconocer) requiere ejecutar el código real de la aplicación (Node + Prisma Client) contra Neon — y esta sesión confirmó que **no tiene salida de red hacia Neon** (ni el puerto de Postgres plano ni el WebSocket que usa el adapter — se probaron ambos y los dos fallaron por red, no por credenciales). Solo la herramienta MCP, que corre en otra infraestructura, puede alcanzar Neon.

**Lo que esto significa en la práctica**: el schema y el índice único de I3 están correctamente aplicados y verificados en la rama demo — la garantía de "duplicado silencioso / conflicto explícito" funciona a nivel de datos. Lo que NO quedó confirmado desde esta sesión es si el mecanismo de reintento ante una carrera real (`conTransaccionSerializable` + `esConflictoDeEscritura`) se comporta igual contra Neon que contra Postgres local — es el mismo código, y Neon es Postgres real, así que no hay una razón concreta para esperar una diferencia, pero es una suposición, no una verificación. Para cerrar esta brecha hace falta correr la Server Action real (o el archivo de test `idempotencia-i3-mecanismo.test.ts`) desde un entorno con conectividad real a Neon — el propio usuario, u otra sesión con esa conectividad.

### Estado final

```text
I3 — schema en código: implementado
I3 — migración en motor2_test (local): aplicada
I3 — migración en demo-pizzeria-la-cuadra (Neon): aplicada, junto con
     las 3 migraciones previas que la rama tenía pendientes
I3 — datos reales de la rama demo: intactos (479 Operacion, sin cambios)
I3 — pruebas de humo 1-4 (schema/constraint): verificadas, OK
I3 — prueba de humo 5 (concurrencia real contra Neon): NO verificable
     desde esta sesión (sin conectividad de red a Neon) — pendiente de
     alguien con esa conectividad
I3 — migración en producción real: NO TOCADA, no forma parte de este
     proyecto Neon ni de esta autorización
```

---

## 15. Deuda técnica preexistente: flake de C2 + inventario ESLint (2026-09-17)

Tarea separada de I3, autorizada explícitamente tras la verificación de I3 en la demo Neon. Detalle completo en `docs/auditoria-motor2-deuda-tecnica-flake-eslint-2026-09-17.md`.

**Resumen**:
- **Flake de C2** (`concurrencia-idempotencia.test.ts`, "REGRESIÓN Plan C2"): investigado con 25 corridas (20 aisladas + 5 de la suite completa, ~390 sub-iteraciones del bucle de concurrencia real) — **0 reproducciones**. Se descartó con evidencia contaminación entre tests, orden de ejecución y cleanup incompleto. No se pudo confirmar la causa exacta (dos hipótesis abiertas: ruido de infraestructura del Postgres local de este contenedor, o un tipo de error de Postgres bajo contención real que `esConflictoDeEscritura` no reconoce) porque no se pudo capturar el error real de la única falla observada. **No se modificó ningún código de producción** (`con-reintento.ts` intacto) — la deuda queda documentada, explícitamente **no declarada cerrada**.
- **ESLint**: se detectó y corrigió un error metodológico propio de una comparación anterior contra el commit base (§12 de este documento usaba `git checkout 82556df -- .`, que no borra archivos nuevos — quedó contaminada; con un `git worktree` aislado, el baseline real es 5 errores/6 warnings, no 5/24). Se corrigieron los 5 errores reales (4 `react-hooks/set-state-in-effect` con el patrón de React de "ajustar estado durante el render", 1 variable muerta) y los 22 warnings (16 introducidos durante la fase de investigación de la auditoría, no por N3/C2/R2/I3 en sí; 6 preexistentes desde antes de toda la auditoría) — sin desactivar reglas globalmente ni agregar excepciones amplias. Estado final: **0 errores, 0 warnings** en todo el repo.

Commit separado del de I3, sin tocar schema/migraciones/política I3/contratos de Server Actions/Neon.
