-- Corrección de compras por ejemplar, etapa C0 (docs/diseno-correccion-de-compras-2026-11-06.md §13; AUTORIZADA por el dueño el 2026-11-06 para su ensayo local; aplicar en cada base real REQUIERE autorización
-- expresa, base por base, con respaldo y ensayo en una rama de Neon).
--
-- POR QUÉ: los motivos de las correcciones tienen que salir de una lista configurable (no estar escritos en el código) y poder contarse después. En vez de una tabla nueva se reutiliza el catálogo
-- `MotivoMerma` (la misma tabla, su pantalla de administración, su permiso y `Operacion.motivoId`) con UNA columna que dice dónde se ofrece cada motivo: `MERMA` (lo de siempre), `CORRECCION` o `TODOS`.
--
-- ADITIVA Y COMPATIBLE HACIA ATRÁS: la columna nace `MERMA` para todas las filas existentes, así que el desplegable de Merma no cambia para nadie. Lo único que cambia de datos existentes: el motivo «Otro»
-- (genérico, sirve para todo) pasa a `TODOS`. Además se siembran en cada empresa los motivos iniciales de corrección de compras (idempotente: ON CONFLICT DO NOTHING sobre (empresaId, nombre)); el dueño los
-- administra después desde Configuración. El código anterior sigue andando sobre la base nueva (ignora la columna y ve todos los motivos como hasta ahora, salvo los 4 nuevos, que aparecerían en Merma: por eso
-- esta migración y el código que filtra por `ambito` van JUNTOS en el mismo despliegue).
-- Reversa: down.sql.

ALTER TABLE "MotivoMerma" ADD COLUMN IF NOT EXISTS "ambito" TEXT NOT NULL DEFAULT 'MERMA';

ALTER TABLE "MotivoMerma" DROP CONSTRAINT IF EXISTS "MotivoMerma_ambito_chk";
ALTER TABLE "MotivoMerma" ADD CONSTRAINT "MotivoMerma_ambito_chk" CHECK ("ambito" IN ('MERMA', 'CORRECCION', 'TODOS')) NOT VALID;
ALTER TABLE "MotivoMerma" VALIDATE CONSTRAINT "MotivoMerma_ambito_chk";

-- «Otro» es genérico: se ofrece en Merma y en las correcciones.
UPDATE "MotivoMerma" SET "ambito" = 'TODOS' WHERE "nombre" = 'Otro' AND "ambito" = 'MERMA';

-- Motivos iniciales de corrección de compras, en cada empresa (propuestos y aceptados por el dueño el 2026-11-06; editables).
INSERT INTO "MotivoMerma" ("id", "empresaId", "nombre", "descripcion", "ambito", "activo")
SELECT md5(e."id" || m."nombre" || 'correccion-c0'), e."id", m."nombre", NULL, m."ambito", true
FROM "Empresa" e
CROSS JOIN (VALUES
  ('Error de tipeo', 'TODOS'),
  ('Faltó cargar el precio', 'CORRECCION'),
  ('Cantidad mal cargada', 'CORRECCION'),
  ('Producto equivocado', 'CORRECCION')
) AS m ("nombre", "ambito")
ON CONFLICT ("empresaId", "nombre") DO NOTHING;
