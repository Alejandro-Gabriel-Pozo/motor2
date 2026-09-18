# Pivote 6 — Auditoría administrativa implementada (A3, 2026-09-18)

**Contexto**: `docs/auditoria-motor2-pivotes-2026-09-16.md` (Pivote 6) encontró que `Producto`/`PrecioLocalProducto`/`PermisoRol`/`CapacidadSucursal`/`Rol` no dejaban ningún rastro de quién cambió qué y cuándo — ni siquiera un `updatedAt` genérico. Quedó cerrado con candidato **A3** (agregar auditoría administrativa), condicionado a que el usuario definiera si el alcance necesario era regulatorio (reconstruir valores históricos) o solo control interno (saber quién tocó algo). El usuario confirmó (2026-09-18): **ambos son necesarios**.

## Diseño: registro genérico por campo, no versionado de fila completa

Se evaluó explícitamente la alternativa de versionar la fila completa en cada edición (mismo patrón que `RecetaVersion`) contra guardar solo el campo que cambió (`campo`, `valorAnterior`, `valorNuevo`). Se eligió lo segundo porque los campos auditados acá son valores escalares sueltos que cambian de forma independiente (un precio, un booleano de permiso) — a diferencia de una receta (ingredientes+pasos+cabecera, que se editan como una unidad), no hay ninguna estructura compuesta que versionar. El registro por campo ya guarda las dos puntas (antes/después) en la misma fila, así que alcanza para reconstruir el valor vigente en cualquier momento pasado (ordenando por `creadoEn`) sin necesitar un JOIN contra una "versión" ni replay de eventos — cubre el caso regulatorio (reconstrucción histórica) con la misma estructura que ya cubre control interno (quién/cuándo).

**Importante, aclarado explícitamente al usuario**: esto es trazabilidad de negocio, no reemplaza backups/recuperación ante desastre — eso lo sigue cubriendo la infraestructura (Neon point-in-time recovery/branches), no este registro.

## Qué se agregó

### Schema (`prisma/schema.prisma`, migración `20260918131558_registro_auditoria_administrativa`)

Nuevo modelo `RegistroAuditoria` — append-only, sin FK real a `entidadId` (referencia liviana: apunta a modelos distintos según `entidad`, y tiene que sobrevivir aunque la fila referenciada se borre en el futuro). `descripcion` ya viene armada y legible al momento de escribir.

### Núcleo (`src/core/permisos/auditoria.ts`)

- `registrarCambioAuditado(db, cambio)` — punto único de escritura (mismo criterio que `conPermiso`/`conTransaccionSerializable`: nunca una copia divergente por Server Action). No-op si el valor no cambió (evita ruido de un `update` que reescribe el mismo valor).
- `listarRegistrosAuditoria(filtro, db)` — más reciente primero, paginado por cursor, filtrable por entidad.

### Server Actions instrumentadas (los campos de mayor impacto de negocio, per el hallazgo original)

- `actualizarProducto` (catálogo) — `precioVenta`, `precioConsignacion`.
- `setPrecioLocalProducto` (movimientos) — `precio`, `habilitado`.
- `actualizarPermiso` (permisos) — `puedeEditar`, `puedeVer` por rol×acción.
- `actualizarCapacidad` (permisos) — `habilitado` por acción×sucursal.
- `actualizarActivoRol` (permisos) — `activo` del rol.

Ninguna otra lógica de estas funciones cambió — el registro se agrega después de la escritura real, con los valores ya conocidos (`existente` se lee antes del `update`/`upsert` en cada una).

### Nueva Accion + página

- `ver_auditoria` (nueva `AccionClave`, admin-only en la semilla) — mismo patrón que `comparar_precios` (gate de "ver" a nivel página, no de mutación).
- `/administracion/auditoria` — página de solo lectura, filtrable por entidad, con `TablaReporte` (orden + export, igual que el resto de `/reportes/*`; era CSV cuando se implementó y pasó a Excel `.xlsx` el 2026-09-18). Link agregado al sidebar.

## ⚠️ Paso de deploy pendiente (no es código, es operación)

`ver_auditoria` es una `Accion` nueva. El seed (`prisma/seed.ts`) es idempotente pero **no se corre automáticamente** en `npm run build` (`prisma generate && prisma migrate deploy && next build` — sin `db:seed`). Sin re-sembrar, la tabla `Accion`/`PermisoRol` no tiene la fila nueva y **nadie, ni siquiera admin, puede ver la página** (`requierePermisoVer` deniega por defecto si no hay `PermisoRol` — mismo comportamiento ya aceptado por el proyecto para toda Accion agregada después del lanzamiento inicial, ej. `pagar_consignante`, `anular_venta`). Correr `npm run db:seed` contra el ambiente de destino después de aplicar esta migración.

## Verificación

- `tsc --noEmit`: limpio.
- `eslint .`: 0 errores, 0 warnings.
- `next build`: compila, `/administracion/auditoria` aparece en el árbol de rutas.
- Suite completa: **58/58 archivos, 371/371 tests** (362 preexistentes + 9 nuevos en `test/permisos/auditoria.test.ts`, cubriendo el helper core y las 5 Server Actions instrumentadas).
- `test/setup/test-db.ts` (`limpiarBaseDeTest`) actualizado: `registroAuditoria.deleteMany()` antes de `user.deleteMany()` (FK).

## Estado

**Pivote 6: CERRADO end-to-end.** A1 (Kardex) ya estaba resuelto sin cambios; A3 (administración) queda implementado con ambos alcances que pidió el usuario (control interno + reconstrucción histórica), en el mismo diseño.
