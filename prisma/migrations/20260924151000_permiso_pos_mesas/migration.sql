-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin` la acción `pos_mesas`
-- (módulo POS: ver el mapa de mesas del salón y dar de alta mesas; ver src/core/permisos/acciones.ts y docs/plan-mapa-de-mesas-2026-09-24.md,
-- paso 1b). Sin su fila en la matriz, ni el admin de una base creada antes de agregarla podría abrir /mesas.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una matriz que el
-- usuario ya ajustó a mano). Solo admin recibe fila: el resto de los roles queda «sin asignar» (ni Ver ni Editar), que es lo mismo que no
-- tener fila; se configura desde la matriz de permisos. El rol «mozo» NO se crea acá: se crea desde /administracion/roles y se le da
-- `pos_mesas` desde la matriz. Mismo molde que 20260921232000_permiso_corregir_compra.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('pos_mesas', 'Ver el mapa de mesas del salón y dar de alta mesas (POS)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'pos_mesas', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
