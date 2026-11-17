-- Migración de DATOS (no cambia el esquema) — Compras, etapa N3-b (docs/diseno-compras-n3b-n4-etapas-2026-11-16.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia):
-- alta de la clave `compra_controlar_recepcion` (registrar el control de cada línea de una compra pendiente de recibir). Decisión del dueño (2026-11-16, relatada por el orquestador general): «Como Pedernal: también el operador»:
--   compra_controlar_recepcion  recepcion_de_compras  SUCURSAL  piso operario  semilla admin y operador (como `proceso_compra`)
-- Confirmar la recepción sigue siendo `compra_recibir` (gerente y administrador): esta migración no la toca.
-- Se siembra a los roles de clave `admin` y `operador` de cada empresa (por la clave estable, nunca por el nombre): lo mismo que recibe una empresa que nace HOY (la semilla de `ACCIONES`). Un rol propio no recibe nada
-- (el gerente la delega en la matriz de permisos, sin migración). El módulo `recepcion_de_compras` nace apagado: mientras tanto la clave no hace nada.
-- Fase EXPANDIR y aditiva: el código anterior ignora la clave nueva, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS). El `ON CONFLICT` no pisa
-- una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('compra_controlar_recepcion', 'Registrar el control de la mercadería de una compra pendiente de recibir en la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'compra_controlar_recepcion', true, true
FROM "Rol" r
WHERE r."clave" IN ('admin', 'operador')
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
