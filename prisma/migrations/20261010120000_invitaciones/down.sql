-- Reversa de 20261010120000_invitaciones: borra la tabla, el trigger, la función y el tipo. Como dueño, a mano.
-- ADVERTENCIA: se pierden las invitaciones pendientes (los enlaces ya enviados dejan de servir) y los CUIT declarados por los gerentes que aceptaron.
-- Antes: guardar `SELECT id, "empresaId", email, estado, "cuitDeclarado" FROM "Invitacion"`. Volver primero el código (Instant Rollback) y recién después correr esto.
-- Después: `prisma migrate resolve --rolled-back 20261010120000_invitaciones`.
DROP TABLE IF EXISTS "Invitacion";
DROP FUNCTION IF EXISTS proteger_invitacion();
DROP TYPE IF EXISTS "EstadoInvitacion";
