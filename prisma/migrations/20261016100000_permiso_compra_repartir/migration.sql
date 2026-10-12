-- Migración de DATOS (no cambia el esquema) — Paquete 3, M3a (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): alta de la clave `compra_repartir`.
-- Con ella se reparte una factura de proveedor entre sucursales (FR2.2/FR2.3) y se atienden las facturas «pendientes de reparto» (P7=b del cuestionario del 2026-10-11). Es una clave de EMPRESA (la factura
-- repartida es un documento de la empresa, ADR-029), de piso administrador; cada sucursal destino además exige `proceso_compra` en ella (lo valida el caso de uso de la Etapa C).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora la clave nueva, así que se puede aplicar antes del deploy sin romper nada. Esta migración NO cambia ningún comportamiento por sí sola: ningún caso de uso
-- la pide todavía (Etapa C). Hasta entonces `test/arquitectura/toda-accion-se-usa.test.ts` la tiene en las reservadas.
--
-- D3 del dueño (2026-10-12): se le da al rol de clave de sistema `admin` de cada empresa, con Ver y Editar, y a nadie más (igual que `producto_campos_sensibles`, M.2). No se COPIA desde ninguna otra clave: hoy
-- nadie reparte facturas, así que nadie pierde nada. Sin ella, las facturas pendientes de reparto quedarían invisibles (solo las ve quien tiene esta clave).
--
-- Se inserta con el `empresaId` de la fila del rol: la migración corre como DUEÑO (sin RLS) y `app_empresa_actual()` devuelve NULL sin contexto de empresa, así que el default de la columna no sirve.
-- El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (una acción sin fila de capacidad está habilitada en toda sucursal).
--
-- Idempotente. Reversa: down.sql (a mano, como dueño; DESTRUCTIVA: borra la configuración de la clave).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('compra_repartir', 'Repartir una factura de proveedor entre sucursales y atender las facturas pendientes de reparto')
ON CONFLICT ("clave") DO NOTHING;

-- El rol administrador de sistema de cada empresa (por su clave estable, no por el nombre).
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", 'compra_repartir', true, true
FROM "Rol" r
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
