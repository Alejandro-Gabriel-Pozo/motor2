-- Reversa de crear-rol-motor2-plataforma.sql (S-13): le devuelve a motor2_app la escritura sobre `Empresa` y elimina `motor2_plataforma`.
-- Antes de correrlo, los scripts de plataforma tienen que dejar de usar PLATAFORMA_DATABASE_URL.
-- Si lo único que hace falta es devolverle la escritura de `Empresa` a la app SIN borrar el rol ni su clave, usar devolver-escritura-de-empresa-a-motor2-app.sql (M.1-C3).
-- M.1-C6: idempotente. Si el rol `motor2_plataforma` no existe (ya se quitó, o nunca se creó en esa base) no hace nada: ni el GRANT, ni DROP OWNED, ni DROP ROLE.
--   psql <conexión del dueño a la base> -1 -f scripts/operaciones/quitar-rol-motor2-plataforma.sql
-- (`-1` o el ejecutor scripts/operaciones/ejecutar-sql-de-psql.mjs: una sola transacción, nada queda a medias.)

\set ON_ERROR_STOP on

SELECT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') AS existe \gset
\if :existe
  GRANT INSERT, UPDATE, DELETE ON "Empresa" TO motor2_app;
  DROP OWNED BY motor2_plataforma;
  DROP ROLE motor2_plataforma;
\else
  SELECT 'motor2_plataforma no existe en esta base de datos: no se hizo nada' AS aviso;
\endif
