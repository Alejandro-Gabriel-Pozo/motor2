-- Reversa de la migración 20261004120000_registro_de_modulos_por_empresa. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas (DIRECT_URL),
-- con `scripts/operaciones/con-env.mjs <archivo-env> -- ...`, y se marca con `prisma migrate resolve --rolled-back 20261004120000_registro_de_modulos_por_empresa`.
-- ORDEN: primero revertir el código que lee la tabla (P7/P8/P9: sin ellos el guard vuelve a ignorarla); recién después bajar la tabla. Borra el registro
-- de módulos de TODAS las empresas: si ya se editó a mano (plan parcial), esas decisiones se pierden; guardar antes `SELECT * FROM "ModuloEmpresa"`.

DROP TABLE IF EXISTS "ModuloEmpresa";
DROP FUNCTION IF EXISTS proteger_registro_de_modulos();
DROP TYPE IF EXISTS "EstadoModulo";
