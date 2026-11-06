-- Migración de DATOS (no cambia el esquema) — Pagos X0 (docs/diseno-pagos-x0-2026-11-04.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alta de la clave `declarar_pago_compra`.
--
--   declarar_pago_compra   compras  EMPRESA  piso operario  clase O  semilla admin   declarar y anular el pago de una factura de proveedor
--
-- Es DINERO: no se reusa `proceso_compra` (quien carga la compra no tiene por qué confirmar el pago). De fábrica la tiene SOLO el rol `admin` de cada empresa (igual que `compra_repartir`); el gerente se la asigna en la matriz de permisos a
-- quien confirme los pagos, sin migración. Es de EMPRESA porque la factura es un documento de la empresa (ADR-029).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora la clave nueva, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS, y `app_empresa_actual()` devuelve
-- NULL sin contexto). El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). Una empresa dada de alta DESPUÉS de esta migración recibe
-- la fila por el alta normal (la clave está en `ACCIONES`).
-- Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano sobre la clave además del admin sembrado).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('declarar_pago_compra', 'Declarar y anular el pago de una factura de proveedor')
ON CONFLICT ("clave") DO NOTHING;

-- El rol administrador de sistema de cada empresa (por su clave estable, no por el nombre).
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'declarar_pago_compra', true, true
FROM "Rol" r
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
