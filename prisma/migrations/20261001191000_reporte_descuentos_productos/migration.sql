-- Reporte «Descuentos de productos» (Fase 2 de "promociones, un solo concepto"): clave propia, una por reporte. Es de DATOS: no toca el schema.
-- Expandir: a cada rol se le copia lo que ya tenía en `reporte_descuentos_clientes` (el reporte hermano de descuentos), que sigue en el catálogo.
-- Reversa: down.sql.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('reporte_descuentos_productos', 'Ver el reporte «Descuentos de productos»')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('reporte_descuentos_clientes', 'reporte_descuentos_productos')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('reporte_descuentos_clientes', 'reporte_descuentos_productos')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
