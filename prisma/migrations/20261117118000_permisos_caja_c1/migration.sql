-- Migración de DATOS (no cambia el esquema) — Caja y cobro, etapa C1, PR-B (docs/diseno-caja-c1-pr-b-permisos-acciones-y-consultas-2026-11-16.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia): alta de las seis claves
-- de la caja, todas de SUCURSAL y con la semilla en SOLO el rol de clave `admin` («todo nace cerrado», 2026-11-11):
--   caja_ver                      salon  SUCURSAL  piso operario       solo ver  ver el estado de la caja, la sesión, los movimientos y las cuentas sin cobrar
--   caja_abrir_sesion             salon  SUCURSAL  piso operario                 abrir la caja con su fondo inicial
--   caja_cerrar_sesion            salon  SUCURSAL  piso administrador            cerrar la caja con el arqueo
--   caja_mover_efectivo           salon  SUCURSAL  piso administrador            ingreso o egreso manual de efectivo y anular los propios
--   caja_anular_movimiento_ajeno  salon  SUCURSAL  piso administrador            anular un movimiento hecho por otra persona
--   cobrar_cuenta                 salon  SUCURSAL  piso operario                 cobrar una cuenta cerrada
-- Es lo que una empresa que nace HOY recibe del alta (la semilla `rolesEditarSemilla` de `ACCIONES`): SOLO el rol `admin` de cada empresa (por la clave estable, nunca por el nombre). Nadie más recibe nada (ni el operador ni un rol propio): el gerente las delega
-- en la matriz de permisos a quien quiera, sin migración (el piso de ver, abrir y cobrar permite que un operario las tenga). El módulo `salon` es PROVISORIO (el catálogo de módulos todavía no tiene `caja`); cambiarlo después no toca esta migración (el módulo
-- no se guarda en `Accion` ni en `PermisoRol`).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS, y `app_empresa_actual()` devuelve NULL sin contexto).
-- El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano
-- además de la semilla). Va DESPUÉS de las tablas de la caja (20261117110000 y 20261117111000) por orden de aplicación, aunque no depende de ellas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('caja_ver', 'Ver el estado de la caja, la sesión, los movimientos y las cuentas sin cobrar'),
  ('caja_abrir_sesion', 'Abrir la caja de la sucursal con su fondo inicial'),
  ('caja_cerrar_sesion', 'Cerrar la caja de la sucursal con el arqueo'),
  ('caja_mover_efectivo', 'Registrar un ingreso o un egreso manual de efectivo y anular los propios'),
  ('caja_anular_movimiento_ajeno', 'Anular un movimiento de efectivo hecho por otra persona'),
  ('cobrar_cuenta', 'Cobrar una cuenta cerrada con los medios de pago')
ON CONFLICT ("clave") DO NOTHING;

-- Las seis: solo el administrador de sistema de cada empresa.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('caja_ver'), ('caja_abrir_sesion'), ('caja_cerrar_sesion'), ('caja_mover_efectivo'), ('caja_anular_movimiento_ajeno'), ('cobrar_cuenta')) AS a("clave")
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
