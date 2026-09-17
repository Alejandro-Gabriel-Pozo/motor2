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

**Pivote 1: CERRADO.** Candidato confirmado: **C2 — Ajustar `con-reintento.ts`** para que reconozca también `DriverAdapterError({kind:"TransactionWriteConflict"})`, no solo `PrismaClientKnownRequestError` código `P2034`. No se encontró ningún caso que requiera C3 (rediseño). Queda como plan de implementación pendiente de autorización (ver §6).

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

**Pivote 5: CERRADO (con hallazgos).** Candidato: **R2 — Optimizar consultas** para `obtenerReportePorPeriodo` (filtrar más en la query, no traer todo a memoria) y `obtenerHistorialProducto` (aplicar `desde`/`hasta` en el `where`, no después). No se encontró evidencia que justifique R4/R5 (proyección de saldo o `StockBalance`) — la agregación base es rápida; el problema está en 2 reportes específicos, no en el modelo de datos.

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

**Ningún código de producción fue modificado en esta etapa** — todo lo anterior es evidencia (pruebas nuevas en `test/auditoria/` + el script de benchmark en `scripts/`). Los cambios de código correspondientes a los candidatos C2 (Pivote 1) e I3 (Pivote 2) requieren un plan de implementación formal (seguí la Sección 13 de la instrucción) y autorización explícita antes de tocar `con-reintento.ts`, `movimientos.ts` o el schema.
