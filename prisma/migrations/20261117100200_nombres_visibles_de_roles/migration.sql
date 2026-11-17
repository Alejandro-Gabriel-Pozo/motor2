-- Nombres visibles de los roles de fábrica: «operador» pasa a «empleado» y «admin» a «administrador» (plan de roles y permisos, P3). SOLO cambia `Rol.nombre`; la clave (`Rol.clave` = 'operador' / 'admin') no se toca.
-- Se busca por CLAVE estable, nunca por nombre, y solo si el rol todavía tiene el nombre de fábrica (los que la empresa renombró a mano no se tocan). Si la empresa ya tiene OTRO rol llamado
-- 'empleado' / 'administrador', ese rol de fábrica se saltea (no se pisa ni se duplica el nombre). Aditiva y reversible (down.sql).
UPDATE "Rol" r SET "nombre" = 'empleado'
WHERE r."clave" = 'operador' AND r."nombre" = 'operador'
  AND NOT EXISTS (SELECT 1 FROM "Rol" o WHERE o."empresaId" = r."empresaId" AND o."id" <> r."id" AND lower(o."nombre") = 'empleado');

UPDATE "Rol" r SET "nombre" = 'administrador'
WHERE r."clave" = 'admin' AND r."nombre" = 'admin'
  AND NOT EXISTS (SELECT 1 FROM "Rol" o WHERE o."empresaId" = r."empresaId" AND o."id" <> r."id" AND lower(o."nombre") = 'administrador');
