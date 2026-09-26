-- Migración de DATOS (no cambia el esquema): agrega la acción `calibrar_rendimiento_local` y la da a admin.
-- Idempotente: ON CONFLICT DO NOTHING no pisa una acción ni un permiso ya configurados. Molde de 20260924153615_permiso_carta.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('calibrar_rendimiento_local', 'Calibrar el rendimiento de las recetas en esta sucursal (cantidad y merma propias de cada ingrediente)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'calibrar_rendimiento_local', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
