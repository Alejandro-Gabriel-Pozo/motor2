-- Reversa de la migración 20261006120000_clave_de_rol_de_sistema. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas (DIRECT_URL),
-- con `scripts/operaciones/con-env.mjs <archivo-env> -- ...`, y se marca con `prisma migrate resolve --rolled-back 20261006120000_clave_de_rol_de_sistema`.
-- ORDEN: primero revertir el código que lee o escribe `Rol.clave` (G1 en adelante); recién después sacar la columna. No se pierde información: la clave de
-- un rol de sistema es su nombre actual, y se vuelve a calcular al volver a aplicar la migración.

DROP INDEX IF EXISTS "Rol_empresaId_clave_key";
ALTER TABLE "Rol" DROP CONSTRAINT IF EXISTS "Rol_clave_formato_check";
ALTER TABLE "Rol" DROP COLUMN IF EXISTS "clave";
