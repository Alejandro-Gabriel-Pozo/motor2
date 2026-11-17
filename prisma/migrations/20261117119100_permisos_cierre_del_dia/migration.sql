-- Migración de DATOS (no cambia el esquema) — Caja y cobro, cierre del día, etapa A, permisos (docs/diseno-caja-cierre-del-dia-acciones-y-permisos-2026-11-17.md §4, tabla confirmada por el dueño el 2026-11-17, «ok pedernal»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia): alta de las siete claves
-- del cierre del día, todas de SUCURSAL y con la semilla en SOLO el rol de clave `admin` («todo nace cerrado», 2026-11-11):
--   caja_jornada_ver                 salon  SUCURSAL  piso operario       solo ver  ver la jornada, sus controles, la lista de jornadas y la conciliación
--   caja_jornada_iniciar_auditoria   salon  SUCURSAL  piso operario                 empezar el cierre del día
--   caja_jornada_cancelar_auditoria  salon  SUCURSAL  piso operario                 cancelar el cierre del día
--   caja_jornada_cerrar              salon  SUCURSAL  piso operario                 cerrar el día de la caja
--   caja_corregir_medio_de_cobro     salon  SUCURSAL  piso operario                 corregir el medio de pago de un cobro durante el cierre del día
--   caja_declarar_total              salon  SUCURSAL  piso operario                 declarar el total de un medio de pago y dar el conforme general (comparte la clave, como Pedernal)
--   caja_registrar_ajuste            salon  SUCURSAL  piso administrador            registrar un ajuste sobre un día ya cerrado
-- Es lo que una empresa que nace HOY recibe del alta (la semilla `rolesEditarSemilla` de `ACCIONES`): SOLO el rol `admin` de cada empresa (por la clave estable, nunca por el nombre). Nadie más recibe nada (ni el operador ni un rol propio): el gerente las delega en la matriz de
-- permisos, sin migración (el piso permite que un operario tenga las seis primeras; `caja_registrar_ajuste` nunca). El módulo `salon` es PROVISORIO (igual que las seis de la caja de la migración 20261117118000); cambiarlo después no toca esta migración (el módulo no se guarda en `Accion` ni en `PermisoRol`).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS, y `app_empresa_actual()` devuelve NULL sin contexto).
-- El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano
-- además de la semilla). Va DESPUÉS de 20261117119000_caja_c1b_en_cierre y de las tablas de la caja por orden de aplicación, aunque no depende de ellas.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('caja_jornada_ver', 'Ver la jornada del día, sus controles, la lista de jornadas y la conciliación'),
  ('caja_jornada_iniciar_auditoria', 'Empezar el cierre del día'),
  ('caja_jornada_cancelar_auditoria', 'Cancelar el cierre del día'),
  ('caja_jornada_cerrar', 'Cerrar el día de la caja'),
  ('caja_corregir_medio_de_cobro', 'Corregir el medio de pago de un cobro durante el cierre del día'),
  ('caja_declarar_total', 'Declarar el total de un medio de pago y dar el conforme general del día'),
  ('caja_registrar_ajuste', 'Registrar un ajuste sobre un día ya cerrado')
ON CONFLICT ("clave") DO NOTHING;

-- Las siete: solo el administrador de sistema de cada empresa.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('caja_jornada_ver'), ('caja_jornada_iniciar_auditoria'), ('caja_jornada_cancelar_auditoria'), ('caja_jornada_cerrar'), ('caja_corregir_medio_de_cobro'), ('caja_declarar_total'), ('caja_registrar_ajuste')) AS a("clave")
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
