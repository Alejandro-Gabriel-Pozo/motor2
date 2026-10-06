-- Migración de DATOS (no cambia el esquema): partición de la clave de permisos `carta` (decisión del dueño, 2026-09-30: UNA clave por acción).
-- Cada bloque de la administración de la carta pública pasa a tener la suya, y la entrada a la pantalla Carta, una de solo lectura.
--
-- Fase EXPANDIR: la clave padre (`carta`) queda RETIRADA del catálogo del código pero NO se borra (sigue con su fila de `Accion`, `PermisoRol` y
-- `CapacidadSucursal` hasta la fase de contracción). Quienes ya podían hacer la acción siguen pudiendo: a cada rol (y a cada capacidad de
-- sucursal) se le copia, para cada clave nueva, lo que ya tenía en el padre. Se copia con el `empresaId` de la fila de origen (la migración corre
-- como dueño, sin RLS: no hay empresa activa de la que tomar el default). Idempotente y sin pisar nada: lo que ya exista para (rol, acción) o
-- (acción, sucursal) queda intacto.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('carta_ver', 'Entrar a la pantalla Carta y ver sus secciones, géneros, contenido y promos'),
  ('carta_secciones', 'Administrar las secciones de la carta pública'),
  ('carta_generos', 'Administrar los géneros de la carta pública'),
  ('carta_contenido_producto', 'Editar el contenido de carta de cada producto de venta'),
  ('carta_items_agrupados', 'Administrar los ítems agrupados de la carta pública'),
  ('carta_portal', 'Administrar el portal de sucursales de la carta pública'),
  ('carta_promos', 'Administrar las promos de la carta de la sucursal'),
  ('carta_tema', 'Administrar el tema visual de la carta de la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('carta', 'carta_ver'),
  ('carta', 'carta_secciones'),
  ('carta', 'carta_generos'),
  ('carta', 'carta_contenido_producto'),
  ('carta', 'carta_items_agrupados'),
  ('carta', 'carta_portal'),
  ('carta', 'carta_promos'),
  ('carta', 'carta_tema')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('carta', 'carta_ver'),
  ('carta', 'carta_secciones'),
  ('carta', 'carta_generos'),
  ('carta', 'carta_contenido_producto'),
  ('carta', 'carta_items_agrupados'),
  ('carta', 'carta_portal'),
  ('carta', 'carta_promos'),
  ('carta', 'carta_tema')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
