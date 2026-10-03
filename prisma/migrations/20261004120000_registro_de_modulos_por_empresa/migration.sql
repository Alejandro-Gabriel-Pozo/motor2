-- Registro de módulos por empresa (bloque 5A, paso P4; ADR-011, ADR-014, ADR-015; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base).
-- Qué módulos existen y de qué dependen es CÓDIGO (`src/core/modulos`); esta tabla solo dice cuáles de los 9 VENDIBLES tiene cada empresa. Fijo
-- (Administración) y soportes (Catálogo, Proveedores, Clientes básicos) NO tienen fila: se calculan. `modulo` es TEXT validado en código a propósito.
--
-- ADITIVA: solo agrega una tabla, un tipo, una función y un trigger. El código viejo la ignora, así que se puede aplicar por adelantado (paso O1) y el
-- Instant Rollback de Vercel sigue siendo seguro. Nada del código actual la lee todavía (la conexión del guard es el paso P7).
--
-- 1) Tabla y tipo, con los nombres que Prisma espera (`prisma migrate diff` contra el schema da vacío). Sin default de `empresaId`: escribe la plataforma
--    y siempre indica la empresa.
-- 2) Tres candados de escritura que se complementan (ENABLE sin FORCE: el dueño que migra y limpia la base de test los salta):
--    a) RLS: `aislamiento_empresa` (FOR SELECT) deja LEER solo la empresa del contexto; `escritura_plataforma` (FOR ALL) deja leer y escribir todo
--       únicamente a `motor2_plataforma`. Se compara por nombre de rol (`current_user`), no con `TO motor2_plataforma`, para que la migración no dependa de
--       que el rol exista ya en esa base (se crea a mano, base por base: scripts/operaciones/crear-rol-motor2-plataforma.sql) ni del orden de los pasos.
--    b) Privilegios: `motor2_app` pierde INSERT/UPDATE/DELETE (solo lee); `motor2_plataforma` queda con SELECT/INSERT/UPDATE y SIN DELETE (ADR-012 §3:
--       desactivar un módulo es un UPDATE de `estado`, no un borrado).
--    c) Trigger BEFORE INSERT/UPDATE/DELETE/TRUNCATE que rechaza a cualquier rol que no sea el dueño de la tabla o `motor2_plataforma` (y a éste, DELETE y
--       TRUNCATE). Si un GRANT futuro (`GRANT ... ON ALL TABLES`, un default privilege, otro rol) le devolviera el permiso a `motor2_app`, el trigger sigue frenando.
--    El dueño queda exento A PROPÓSITO (migra, corrige datos, limpia la base de test); un dueño siempre puede apagar un trigger, bloquearlo sería teatro.
--    Las acciones referenciales (ON UPDATE CASCADE desde Empresa) corren con los privilegios del dueño: no se ven afectadas.
-- 3) Backfill: los 9 vendibles en ACTIVO para TODA empresa existente, en cualquier estado (nadie pierde funcionalidad al activarse el guard). Las empresas
--    que se creen después NO reciben filas: el alta no las siembra (decisión del bloque 5A) y las activa la plataforma. Idempotente.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261004120000_registro_de_modulos_por_empresa`).

-- CreateEnum
CREATE TYPE "EstadoModulo" AS ENUM ('ACTIVO', 'INACTIVO');

-- CreateTable
CREATE TABLE "ModuloEmpresa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "modulo" TEXT NOT NULL,
    "estado" "EstadoModulo" NOT NULL DEFAULT 'ACTIVO',
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModuloEmpresa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "ModuloEmpresa_modulo_no_vacio_check" CHECK (length(btrim("modulo")) > 0)
);

-- CreateIndex
CREATE UNIQUE INDEX "ModuloEmpresa_empresaId_modulo_key" ON "ModuloEmpresa"("empresaId", "modulo");

-- AddForeignKey
ALTER TABLE "ModuloEmpresa" ADD CONSTRAINT "ModuloEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Candado a) RLS
ALTER TABLE "ModuloEmpresa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ModuloEmpresa" FOR SELECT
  USING ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY escritura_plataforma ON "ModuloEmpresa" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

-- Candado b) Privilegios (si los roles existen: en una base de test o recién creada pueden no estar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE INSERT, UPDATE, DELETE, TRUNCATE ON "ModuloEmpresa" FROM motor2_app;
    GRANT SELECT ON "ModuloEmpresa" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE DELETE, TRUNCATE ON "ModuloEmpresa" FROM motor2_plataforma;
    GRANT SELECT, INSERT, UPDATE ON "ModuloEmpresa" TO motor2_plataforma;
  END IF;
END
$$;

-- Candado c) Trigger
CREATE FUNCTION proteger_registro_de_modulos() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  IF current_user = 'motor2_plataforma' AND (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'ModuloEmpresa solo lo escribe la plataforma: % no permitido para el rol %', TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "ModuloEmpresa_solo_plataforma_fila"
  BEFORE INSERT OR UPDATE OR DELETE ON "ModuloEmpresa"
  FOR EACH ROW EXECUTE FUNCTION proteger_registro_de_modulos();

CREATE TRIGGER "ModuloEmpresa_solo_plataforma_truncate"
  BEFORE TRUNCATE ON "ModuloEmpresa"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_registro_de_modulos();

-- Backfill: los 9 vendibles (los mismos de `MODULOS` con tipo "vendible"; un test compara las dos listas) en ACTIVO para toda empresa.
INSERT INTO "ModuloEmpresa" ("id", "empresaId", "modulo", "estado")
SELECT gen_random_uuid()::text, e."id", m."modulo", 'ACTIVO'
FROM "Empresa" e
CROSS JOIN (VALUES
  ('stock'), ('compras'), ('traspasos'), ('consignacion'), ('recetas'), ('produccion'), ('carta'), ('promociones'), ('salon')
) AS m("modulo")
ON CONFLICT ("empresaId", "modulo") DO NOTHING;
