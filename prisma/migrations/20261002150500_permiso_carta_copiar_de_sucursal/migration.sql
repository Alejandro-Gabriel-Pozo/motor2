-- Migración de DATOS (no cambia el esquema): da de alta la acción de copiar a la sucursal activa la carta propia de otra sucursal (decisión del dueño,
-- 2026-10-02; ADR-009 C4), UNA clave por acción (ADR-008), de contexto SUCURSAL y nivel administrador: `carta_copiar_de_sucursal`.
-- Queda asignada a los roles «admin» de CADA empresa (Ver y Editar); el operador no la recibe. Después se edita tildando en la matriz.
-- `r."empresaId"` explícito: la migración corre como dueño de las tablas (sin RLS), y el default `app_empresa_actual()` no aplica ahí.
-- Idempotente: ON CONFLICT DO NOTHING no pisa una acción ni un permiso ya configurados.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('carta_copiar_de_sucursal', 'Copiar a esta sucursal la carta propia de otra sucursal (solo sobre una carta vacía)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'carta_copiar_de_sucursal', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
