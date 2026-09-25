-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin` la acción `pos_tomar_pedido`
-- (módulo POS: abrir la cuenta de una mesa, agregar y quitar ítems sin enviar, enviarlos a cocina y liberar una mesa sin consumo; ver
-- src/core/permisos/acciones.ts y docs/plan-tomar-pedido-2026-09-25.md, B4). Sin su fila en la matriz, ni el admin de una base creada antes de
-- agregarla podría tomar un pedido.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una matriz que el
-- usuario ya ajustó a mano). Solo admin recibe fila: el resto de los roles queda «sin asignar» (ni Ver ni Editar), que es lo mismo que no
-- tener fila; se configura desde la matriz de permisos (el rol «mozo» se arma ahí). Mismo molde que 20260924151000_permiso_pos_mesas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('pos_tomar_pedido', 'Tomar pedidos en el salón: abrir la cuenta de una mesa, agregar y quitar ítems sin enviar, enviarlos a cocina y liberar una mesa sin consumo (POS)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'pos_tomar_pedido', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
