-- Paquete 5, M7.4: migración de DATOS (no cambia el esquema) (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): las TRES claves de los centros de costos y su siembra al rol `admin` de cada empresa.
--   centros_costos             empresa   piso administrador  semilla admin   administrar planes, centros y en qué sucursal aplica cada plan
--   distribucion_costos        sucursal  piso administrador  semilla admin   distribuir (y corregir) un gasto de la sucursal entre centros
--   reporte_gastos_por_unidad  sucursal  piso administrador  semilla admin   ver el reporte de gastos por unidad de negocio
-- Como la migración de los gastos (M4.5): las claves viven en la base desde M7 y entran a `ACCIONES` recién en la Etapa C (el módulo `centros_de_costos` está en desarrollo y test/arquitectura/acciones-con-modulo.test.ts prohíbe acciones de un módulo en desarrollo).
-- El `empresaId` de cada fila nueva sale de la fila del rol (la migración corre como dueño y `app_empresa_actual()` devuelve NULL). Sin copia de otras claves ni de `CapacidadSucursal`. ON CONFLICT no pisa lo que el gerente ya tocó.
-- Una empresa que nace entre M7 y la Etapa C no recibe las filas (el alta siembra desde ACCIONES): volver a correr el 2.º INSERT (idempotente) con su propia autorización.
-- Reversa: down.sql, ABORTA si la configuración cambió (delegaciones, cambios del admin o capacidades por sucursal sobre estas claves); con la semilla pura borra las tres claves y sus filas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('centros_costos', 'Administrar los planes y centros de costos de la empresa'),
  ('distribucion_costos', 'Distribuir los gastos de la sucursal entre centros de costos'),
  ('reporte_gastos_por_unidad', 'Ver el reporte de gastos por unidad de negocio de la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", k.clave, true, true
FROM "Rol" r
CROSS JOIN (VALUES ('centros_costos'), ('distribucion_costos'), ('reporte_gastos_por_unidad')) AS k(clave)
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
