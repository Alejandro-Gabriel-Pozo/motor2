-- Reversa de 20261117100200_nombres_visibles_de_roles: devuelve 'empleado' → 'operador' y 'administrador' → 'admin' en los roles de fábrica (por clave). ABORTA, sin tocar nada, si alguna empresa ya tiene OTRO rol
-- con el nombre de destino ('operador' / 'admin'): no se pisa un nombre que ocupó otra cosa.
DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "Rol" r JOIN "Rol" o ON o."empresaId" = r."empresaId" AND o."id" <> r."id"
    WHERE (r."clave" = 'operador' AND r."nombre" = 'empleado' AND lower(o."nombre") = 'operador')
       OR (r."clave" = 'admin' AND r."nombre" = 'administrador' AND lower(o."nombre") = 'admin')
  ) THEN
    RAISE EXCEPTION 'No se revierte: hay empresas con otro rol llamado operador o admin; resolverlo a mano antes.';
  END IF;
  UPDATE "Rol" SET "nombre" = 'operador' WHERE "clave" = 'operador' AND "nombre" = 'empleado';
  UPDATE "Rol" SET "nombre" = 'admin' WHERE "clave" = 'admin' AND "nombre" = 'administrador';
END $$;
