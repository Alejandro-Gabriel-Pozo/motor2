-- Reversa de 20261009130000_auditoria_de_plataforma: borra la tabla (y con ella el rastro de plataforma que contuviera). Como dueño, a mano.
-- Antes: exportar la tabla si tiene filas que se quieran conservar. La función `rechazar_mutacion_de_auditoria()` es de la migración 20261001230000: no se toca.
-- Después: `prisma migrate resolve --rolled-back 20261009130000_auditoria_de_plataforma`.
DROP TABLE IF EXISTS "AuditoriaPlataforma";
