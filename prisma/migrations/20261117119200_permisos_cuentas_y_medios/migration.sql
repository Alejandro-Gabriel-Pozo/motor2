-- Migración de DATOS (no cambia el esquema) — Caja y cobro, etapa B, permisos de las cuentas de cobro y los medios de pago (docs/diseno-caja-cuentas-de-cobro-y-medios-acciones-y-permisos-2026-11-17.md §4 y §10, decisiones Q-B1 y Q-B3 CONFIRMADAS por delegación del dueño en Pedernal el 2026-11-17; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia): alta de las ocho claves
-- de administración de la caja, todas de SUCURSAL, de piso operario (PISOS-65, dueño 2026-11-17) y con la semilla en SOLO el rol de clave `admin` («todo nace cerrado», 2026-11-11):
--   caja_medio_de_pago_crear         salon  SUCURSAL  piso operario   dar de alta un medio de pago                                  (Pedernal: medios_de_pago.crear)
--   caja_medio_de_pago_editar        salon  SUCURSAL  piso operario   editar un medio: su nombre y qué datos pide al cobrar         (medios_de_pago.editar)
--   caja_medio_de_pago_reactivar     salon  SUCURSAL  piso operario   reactivar un medio desactivado                              (medios_de_pago.reactivar)
--   caja_medio_de_pago_desactivar    salon  SUCURSAL  piso operario   desactivar un medio (el efectivo no se desactiva)           (medios_de_pago.desactivar)
--   caja_cuenta_de_cobro_crear       salon  SUCURSAL  piso operario   dar de alta una cuenta de cobro                             (cuentas_de_cobro.crear)
--   caja_cuenta_de_cobro_editar      salon  SUCURSAL  piso operario   editar una cuenta de cobro: nombre, identificador y sucursal (cuentas_de_cobro.editar)
--   caja_cuenta_de_cobro_reactivar   salon  SUCURSAL  piso operario   reactivar una cuenta de cobro desactivada                   (cuentas_de_cobro.reactivar)
--   caja_cuenta_de_cobro_desactivar  salon  SUCURSAL  piso operario   desactivar una cuenta de cobro                              (cuentas_de_cobro.desactivar)
-- Es lo que una empresa que nace HOY recibe del alta (la semilla `rolesEditarSemilla` de `ACCIONES`): SOLO el rol `admin` de cada empresa (por la clave estable, nunca por el nombre). Nadie más recibe nada (ni el operador ni un rol propio): el gerente las delega en la matriz de permisos, sin migración (el piso operario lo permite).
-- Las lecturas de administración NO traen clave nueva: van con `caja_ver` (Q-B2). El módulo `salon` es PROVISORIO (igual que las de la caja de las migraciones 20261117118000 y 20261117119100); cambiarlo después no toca esta migración (el módulo no se guarda en `Accion` ni en `PermisoRol`).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS, y `app_empresa_actual()` devuelve NULL sin contexto).
-- El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano
-- además de la semilla). Va DESPUÉS de 20261117119100_permisos_cierre_del_dia por orden de aplicación, aunque no depende de ella.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('caja_medio_de_pago_crear', 'Dar de alta un medio de pago'),
  ('caja_medio_de_pago_editar', 'Editar un medio de pago: su nombre y qué datos pide al cobrar'),
  ('caja_medio_de_pago_reactivar', 'Reactivar un medio de pago desactivado'),
  ('caja_medio_de_pago_desactivar', 'Desactivar un medio de pago (el efectivo no se desactiva)'),
  ('caja_cuenta_de_cobro_crear', 'Dar de alta una cuenta de cobro'),
  ('caja_cuenta_de_cobro_editar', 'Editar una cuenta de cobro: su nombre, su identificador y su sucursal'),
  ('caja_cuenta_de_cobro_reactivar', 'Reactivar una cuenta de cobro desactivada'),
  ('caja_cuenta_de_cobro_desactivar', 'Desactivar una cuenta de cobro')
ON CONFLICT ("clave") DO NOTHING;

-- Las ocho: solo el administrador de sistema de cada empresa.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('caja_medio_de_pago_crear'), ('caja_medio_de_pago_editar'), ('caja_medio_de_pago_reactivar'), ('caja_medio_de_pago_desactivar'), ('caja_cuenta_de_cobro_crear'), ('caja_cuenta_de_cobro_editar'), ('caja_cuenta_de_cobro_reactivar'), ('caja_cuenta_de_cobro_desactivar')) AS a("clave")
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
