-- Migración de DATOS (no cambia el esquema): agrega `clientes` (administrar el catálogo de Clientes, admin) y `pos_asignar_cliente`
-- (Task #14, docs/plan-clientes-descuento-2026-09-26.md, D3 y punto 9).
--
-- `clientes` sigue el molde habitual del catálogo (proveedores, categorías, ...): solo admin.
--
-- `pos_asignar_cliente` NO sigue el molde de 20260925160000_permiso_pos_tomar_pedido (que le da la fila solo a 'admin' por nombre de
-- rol): D3 dice "CUALQUIER MOZO puede asignar un cliente con descuento, no solo admin — se semillea para el rol que ya tiene
-- pos_tomar_pedido". Como el rol «mozo» no existe en código (se arma desde /administracion/roles y la matriz de permisos, ver el
-- comentario de `pos_tomar_pedido` en src/core/permisos/acciones.ts), este INSERT es DINÁMICO: le da la fila a CUALQUIER rol que ya
-- tenga Editar de `pos_tomar_pedido` en ESTA base — admin de fábrica, y el rol «mozo» que cada instalación ya haya armado. Una base
-- sin ningún «mozo» armado todavía (o una nueva) solo le da la fila a admin, igual que el resto de los permisos de este molde.
--
-- Idempotente: `ON CONFLICT DO NOTHING` no pisa una acción ni un permiso ya configurados (por ejemplo si un admin ya ajustó la matriz
-- a mano después de leer esta migración en otra base).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('clientes', 'Administrar el catálogo de Clientes y su % de descuento'),
  ('pos_asignar_cliente', 'Asignar un cliente con descuento a la cuenta de una mesa (POS)')
ON CONFLICT ("clave") DO NOTHING;

-- 'clientes': solo admin.
INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'clientes', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

-- 'pos_asignar_cliente': todo rol que YA edite 'pos_tomar_pedido' (D3) — admin, y cualquier «mozo» ya armado en esta base.
INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, pr."rolId", 'pos_asignar_cliente', true, true
FROM "PermisoRol" pr
WHERE pr."accionClave" = 'pos_tomar_pedido' AND pr."puedeEditar" = true
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
