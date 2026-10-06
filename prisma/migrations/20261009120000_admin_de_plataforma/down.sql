-- Reversa de 20261009120000_admin_de_plataforma: borra las cuatro tablas (y con ellas los administradores, sus códigos y sesiones). Como dueño, a mano.
-- Antes: confirmar que nadie opera ya la consola de plataforma; los administradores hay que volver a crearlos con crear-primer-admin.ts.
-- Después: `prisma migrate resolve --rolled-back 20261009120000_admin_de_plataforma`.
DROP TABLE IF EXISTS "SesionPlataforma";
DROP TABLE IF EXISTS "CodigoDeRecuperacionPlataforma";
DROP TABLE IF EXISTS "CodigoDeIngresoPlataforma";
DROP TABLE IF EXISTS "AdminPlataforma";
