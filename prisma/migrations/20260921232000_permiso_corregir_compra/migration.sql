-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin` la acción `corregir_compra`
-- (K1b, corregir el proveedor, el N.º de factura o el detalle de una compra ya confirmada; ver src/core/permisos/acciones.ts). Sin su fila en la
-- matriz, ni el admin de una base creada antes de agregarla podría usarla.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una matriz que el
-- usuario ya ajustó a mano). Solo admin recibe fila: el resto de los roles queda «sin asignar» (ni Ver ni Editar), que es lo mismo que no
-- tener fila; se configura desde la matriz de permisos. Mismo molde que 20260921230200_permiso_anular_compra.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('corregir_compra', 'Corregir el proveedor, el N.º de factura o el detalle de una compra ya confirmada')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'corregir_compra', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
