-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin` la acción `pos_cerrar_cuenta`
-- (módulo POS: cerrar la cuenta de una mesa — registra la venta en el stock y libera la mesa; ver src/core/permisos/acciones.ts y
-- docs/plan-tomar-pedido-2026-09-25.md, B4/B5). Un mozo con `pos_tomar_pedido` no cobra: se le da esta acción aparte desde la matriz.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una matriz que el
-- usuario ya ajustó a mano). Solo admin recibe fila: el resto de los roles queda «sin asignar» (ni Ver ni Editar), que es lo mismo que no
-- tener fila; se configura desde la matriz de permisos. Mismo molde que 20260924151000_permiso_pos_mesas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('pos_cerrar_cuenta', 'Cerrar la cuenta de una mesa: registra la venta en el stock y libera la mesa (POS)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'pos_cerrar_cuenta', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
