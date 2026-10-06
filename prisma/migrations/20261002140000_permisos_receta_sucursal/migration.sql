-- Migración de DATOS (no cambia el esquema): da de alta las tres acciones de la receta propia de una sucursal (decisión del dueño, 2026-10-02;
-- ADR-009), una clave por acción (ADR-008), todas de contexto SUCURSAL y nivel administrador:
--   `receta_sucursal_editar`, `receta_sucursal_copiar`, `receta_sucursal_volver_central`.
-- Quedan asignadas a los roles «admin» de CADA empresa (Ver y Editar); el operador no las recibe. Después se editan tildando en la matriz.
-- `r."empresaId"` explícito: la migración corre como dueño de las tablas (sin RLS), y el default `app_empresa_actual()` no aplica ahí.
-- Idempotente: ON CONFLICT DO NOTHING no pisa una acción ni un permiso ya configurados.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('receta_sucursal_editar', 'Crear o editar la receta propia de esta sucursal'),
  ('receta_sucursal_copiar', 'Copiar a esta sucursal la receta propia de otra sucursal'),
  ('receta_sucursal_volver_central', 'Volver la receta de esta sucursal a la central')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES
  ('receta_sucursal_editar'),
  ('receta_sucursal_copiar'),
  ('receta_sucursal_volver_central')
) AS a("clave")
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
