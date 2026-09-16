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
