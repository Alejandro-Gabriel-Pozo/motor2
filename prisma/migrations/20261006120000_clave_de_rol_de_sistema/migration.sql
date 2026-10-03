-- Clave estable de los roles de sistema (bloque G, paso G1; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base).
-- Hoy el código sabe «cuál es el rol administrador» comparando el NOMBRE ("admin"), y el nombre es un dato que alguien podría renombrar (bloque G3). La
-- clave separa las dos cosas: el nombre es lo que se muestra, la clave es lo que el código compara.
--
-- ADITIVA: agrega una columna que admite NULL, un CHECK de formato y un índice único. El código viejo no la nombra, así que se puede aplicar por
-- adelantado (junto con P4, en la misma ventana de cada base) y el Instant Rollback de Vercel sigue siendo seguro. NADA del código actual la LEE todavía:
-- solo los puntos que crean los roles de sistema (alta de empresa, seed) la escriben; el guard y la política de gobierno la usarán en G2.
--
-- 1) `clave` TEXT NULL: null en un rol creado a mano. Formato en minúsculas (`^[a-z][a-z0-9_]*$`), igual que se guarda el nombre.
-- 2) Único por empresa: a lo sumo un rol por clave. Postgres trata los NULL como distintos, así que los roles sin clave no chocan entre sí.
-- 3) Backfill desde los nombres actuales: el rol llamado «admin» recibe la clave «admin» y el llamado «operador», «operador». Cualquier otro rol queda en
--    NULL (no es de sistema). Idempotente. Corre como dueño (el RLS de `Rol` no lo alcanza: ENABLE sin FORCE).
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261006120000_clave_de_rol_de_sistema`).

-- AlterTable
ALTER TABLE "Rol" ADD COLUMN IF NOT EXISTS "clave" TEXT;

-- Formato de la clave
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Rol_clave_formato_check' AND conrelid = to_regclass('public."Rol"')) THEN
    ALTER TABLE "Rol" ADD CONSTRAINT "Rol_clave_formato_check" CHECK ("clave" IS NULL OR "clave" ~ '^[a-z][a-z0-9_]*$');
  END IF;
END
$$;

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Rol_empresaId_clave_key" ON "Rol"("empresaId", "clave");

-- Backfill
UPDATE "Rol" SET "clave" = "nombre" WHERE "nombre" IN ('admin', 'operador') AND "clave" IS NULL;
