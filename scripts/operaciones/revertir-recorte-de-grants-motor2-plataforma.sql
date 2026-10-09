-- Reversa del recorte de grants de `crear-rol-motor2-plataforma.sql` (S-35, «grants = uso»): le devuelve a `motor2_plataforma` lo que tenía ANTES del recorte.
--   · INSERT y UPDATE sobre "User" (el primer gerente se creaba con un upsert desde el rol de plataforma; hoy llega por la invitación y lo incorpora la app).
--   · INSERT sobre "UsuarioEmpresa" y "UsuarioSucursal".
--   · SELECT e INSERT sobre "RegistroAuditoria" (S-33, actor de los scripts de plataforma: los cambios de módulos y de política dejaron de escribirla; auditan en "AuditoriaPlataforma").
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR; paso manual, NO es una migración. Nada del código actual de plataforma usa estos privilegios: se vuelve a este estado solo si una
-- versión anterior de la consola lo necesitara (por eso existe). Para volver a recortar: correr de nuevo `crear-rol-motor2-plataforma.sql` (parte de cero y revoca todo antes de dar).
--   psql <conexión del dueño a la base> -f scripts/operaciones/revertir-recorte-de-grants-motor2-plataforma.sql

\set ON_ERROR_STOP on

GRANT INSERT, UPDATE ON "User" TO motor2_plataforma;
GRANT INSERT ON "UsuarioEmpresa", "UsuarioSucursal" TO motor2_plataforma;
-- UsuarioSucursal no tenía SELECT en el recorte: el estado anterior le daba SELECT, INSERT.
GRANT SELECT ON "UsuarioSucursal" TO motor2_plataforma;
-- S-33: los cambios de módulos y de política dejaron de escribir "RegistroAuditoria" y GT-20 pidió quitarle el privilegio; esta línea se lo devuelve (para volver a una versión anterior
-- de los scripts: `git revert` del commit de S-33 «actor de plataforma»).
GRANT SELECT, INSERT ON "RegistroAuditoria" TO motor2_plataforma;

SELECT table_name AS tabla, string_agg(privilege_type, ', ' ORDER BY privilege_type) AS privilegios_de_motor2_plataforma
  FROM information_schema.role_table_grants WHERE grantee = 'motor2_plataforma' GROUP BY table_name ORDER BY 1;
