-- Migración de DATOS (no cambia el esquema): partición de las claves de administración (decisión del dueño, 2026-09-30: UNA clave por acción).
--   gestion_permisos -> gestion_roles                                  (crear, activar y desactivar roles)
--   gestion_usuarios -> activar_usuario_sucursal, notas_usuario_sucursal (sucursal) y apagar_cuenta_empresa (empresa)
--   alta_sucursal    -> activar_sucursal y renombrar_sucursal          (empresa)
-- Además se da de alta `ver_auditoria_empresa`, de piso GERENTE: no tiene padre (antes era un `esGerenteDeEmpresa` suelto en la pantalla de
-- Auditoría), así que no se copia nada y ningún rol la recibe; la tiene solo el gerente de la empresa, sin pasar por la matriz.
--
-- Fase EXPANDIR: los padres NO se retiran (siguen en el catálogo con un alcance menor y una descripción nueva). Quienes ya podían hacer una
-- acción siguen pudiendo: a cada rol (y a cada capacidad de sucursal) se le copia, para cada clave nueva, lo que ya tenía en el padre. Se copia
-- con el `empresaId` de la fila de origen (la migración corre como dueño, sin RLS: no hay empresa activa de la que tomar el default).
-- Idempotente y sin pisar nada: lo que ya exista para (rol, acción) o (acción, sucursal) queda intacto.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('gestion_roles', 'Crear, activar y desactivar roles'),
  ('activar_usuario_sucursal', 'Activar o desactivar a un usuario en la sucursal'),
  ('notas_usuario_sucursal', 'Editar las notas de un usuario en la sucursal'),
  ('apagar_cuenta_empresa', 'Apagar o reactivar la cuenta de un usuario en toda la empresa'),
  ('activar_sucursal', 'Activar o desactivar una sucursal'),
  ('renombrar_sucursal', 'Renombrar una sucursal'),
  ('ver_auditoria_empresa', 'Ver las filas de auditoría de la empresa (las que no son de una sucursal)')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('gestion_permisos', 'gestion_roles'),
  ('gestion_usuarios', 'activar_usuario_sucursal'),
  ('gestion_usuarios', 'notas_usuario_sucursal'),
  ('gestion_usuarios', 'apagar_cuenta_empresa'),
  ('alta_sucursal', 'activar_sucursal'),
  ('alta_sucursal', 'renombrar_sucursal')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('gestion_permisos', 'gestion_roles'),
  ('gestion_usuarios', 'activar_usuario_sucursal'),
  ('gestion_usuarios', 'notas_usuario_sucursal'),
  ('gestion_usuarios', 'apagar_cuenta_empresa'),
  ('alta_sucursal', 'activar_sucursal'),
  ('alta_sucursal', 'renombrar_sucursal')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);

-- Los padres cuyo alcance se achicó cambian de descripción.
UPDATE "Accion" SET "descripcion" = 'Agregar usuarios a la sucursal y cambiarles el rol' WHERE "clave" = 'gestion_usuarios';

UPDATE "Accion" SET "descripcion" = 'Gestionar la matriz de permisos de los roles' WHERE "clave" = 'gestion_permisos';

UPDATE "Accion" SET "descripcion" = 'Ver el registro de auditoría administrativa de la sucursal (precios y permisos)' WHERE "clave" = 'ver_auditoria';
