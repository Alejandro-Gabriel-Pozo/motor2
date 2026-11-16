-- Migración de DATOS (no cambia el esquema) — Compras, etapa OC (docs/diseno-compras-n3b-n4-etapas-2026-11-16.md §«Etapa OC»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia):
-- alta de tres claves del módulo `ordenes_de_compra` (nace apagado: mientras tanto las claves no hacen nada). Decisión del dueño (Pedernal, 2026-11-16, DDD:5A, y Motor2 vía el orquestador general): crear, pedir, cerrar y anular una orden de compra
-- lo hace quien administra o gerencia, no el operador; configurar el control de exceso: solo gerente y administrador.
--   orden_de_compra_gestionar  EMPRESA  piso administrador  semilla admin           (crear, pedir, anular y cerrar una orden)
--   compras_configurar         EMPRESA  piso administrador  semilla admin           (el nivel del control `compras.recepcion_excede_la_orden`)
--   orden_de_compra_ver        EMPRESA  piso operario       semilla admin y operador (ver las órdenes y elegir una al cargar una compra; solo lectura)
-- Se siembra a los roles de clave `admin` (y `operador` para ver) de cada empresa (por la clave estable, nunca por el nombre): lo mismo que recibe una empresa que nace HOY (la semilla de `ACCIONES`). Un rol propio no recibe nada (el gerente lo delega
-- en la matriz de permisos, sin migración). Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS). El `ON CONFLICT` no pisa una fila ya
-- configurada. NO se copia `CapacidadSucursal` (son claves de empresa). Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('orden_de_compra_gestionar', 'Crear, pedir, anular y cerrar las órdenes de compra a proveedores'),
  ('compras_configurar', 'Configurar los controles de compras de la empresa (recibir más de lo pedido en una orden)'),
  ('orden_de_compra_ver', 'Ver las órdenes de compra a proveedores y elegir una al cargar una compra')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('orden_de_compra_gestionar'), ('compras_configurar'), ('orden_de_compra_ver')) AS a ("clave")
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'orden_de_compra_ver', true, true
FROM "Rol" r
WHERE r."clave" = 'operador'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
