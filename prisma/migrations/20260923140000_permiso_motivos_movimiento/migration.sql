-- Migración de DATOS (no cambia el esquema): agrega al catálogo de acciones y a la matriz de permisos de `admin` la acción `motivos_movimiento`
-- (ver src/core/permisos/acciones.ts) — el permiso que va a gatear la administración de los catálogos nuevos de Motivos de merma y Destinos
-- de consumo (docs del plan de "motivos de Consumo/Merma como catálogo administrable", 2026-09-23). Sin su fila en la matriz, ni el admin de
-- una base creada antes de agregarla podría usarla.
--
-- Idempotente: no pisa nada. `ON CONFLICT DO NOTHING` deja intacta una acción o un permiso que ya exista (por ejemplo una matriz que el
-- usuario ya ajustó a mano). Solo admin recibe fila: el resto de los roles queda «sin asignar» (ni Ver ni Editar), que es lo mismo que no
-- tener fila; se configura desde la matriz de permisos. Mismo molde que 20260921230200_permiso_anular_compra.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('motivos_movimiento', 'Administrar los catálogos de Motivos de merma y Destinos de consumo')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."id", 'motivos_movimiento', true, true
FROM "Rol" r
WHERE r."nombre" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
