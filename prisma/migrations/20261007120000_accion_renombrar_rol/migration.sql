-- Migración de DATOS (no cambia el esquema): alta de la acción `renombrar_rol` (bloque G, G3; decisión del dueño, 2026-10-03: una clave por acción,
-- «más específica» que `gestion_roles`). Cambiar el NOMBRE de un rol nunca toca su clave técnica.
-- Fase EXPANDIR y aditiva: el código anterior ignora la clave nueva, así que se puede aplicar antes del deploy sin romper nada.
-- A cada rol (y a cada capacidad de sucursal) se le copia lo que ya tenía en `gestion_roles`: quien podía crear y desactivar roles puede renombrarlos.
-- Se copia con el `empresaId` de la fila de origen (la migración corre como dueño, sin RLS). Idempotente y sin pisar nada.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('renombrar_rol', 'Cambiar el nombre de un rol (nunca su clave técnica)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('gestion_roles', 'renombrar_rol')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('gestion_roles', 'renombrar_rol')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
