-- Migración de DATOS (no cambia el esquema): partición de la clave de permisos `editar_producto` (decisión del dueño, 2026-09-30: UNA clave por acción).
-- Era la última clave «mixta»: sus tres acciones (editar un producto, asignar un insumo a una materia prima y sincronizar el precio de un ítem
-- agrupado de la carta) tocan datos de TODA la empresa, así que las tres claves nuevas son de contexto empresa. La disponibilidad por sucursal ya
-- tenía la suya (`producto_disponibilidad`).
--
-- Fase EXPANDIR: la clave padre (`editar_producto`) queda RETIRADA del catálogo del código pero NO se borra (sigue con su fila de `Accion`,
-- `PermisoRol` y `CapacidadSucursal` hasta la fase de contracción). Quienes ya podían hacer la acción siguen pudiendo: a cada rol (y a cada
-- capacidad de sucursal) se le copia, para cada clave nueva, lo que ya tenía en el padre. Se copia con el `empresaId` de la fila de origen (la
-- migración corre como dueño, sin RLS: no hay empresa activa de la que tomar el default). Idempotente y sin pisar nada: lo que ya exista para
-- (rol, acción) o (acción, sucursal) queda intacto.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('producto_editar', 'Editar un producto existente'),
  ('producto_asignar_insumo', 'Asignar un insumo a una materia prima ya existente (asistente de hermanar)'),
  ('producto_sincronizar_precio_carta', 'Aplicar el mismo precio de venta a los productos de un ítem agrupado de la carta')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('editar_producto', 'producto_editar'),
  ('editar_producto', 'producto_asignar_insumo'),
  ('editar_producto', 'producto_sincronizar_precio_carta')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('editar_producto', 'producto_editar'),
  ('editar_producto', 'producto_asignar_insumo'),
  ('editar_producto', 'producto_sincronizar_precio_carta')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
