-- Auditoría de plataforma (E4, ADR-012 §7, ADR-019; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con ensayo en una rama de Neon y respaldo previo).
-- Rastro de lo que hace un administrador de plataforma. `RegistroAuditoria.actorId` apunta a `User` y el administrador NO es un `User` (ADR-012 §1), así que no
-- puede registrarse ahí: esta tabla guarda `adminId` y `adminEmail` como texto, SIN FK (el administrador vive en la base de identidad; la empresa afectada, en la
-- suya), y se crea en TODAS las bases. La columna de la empresa afectada NO se llama `empresaId`: esa columna dispara las reglas de RLS por empresa.
-- Cuando la plataforma actúa sobre una empresa, escribe en la base de ESA empresa, en la misma transacción que el cambio.
--
-- ADITIVA: solo agrega una tabla. Mismos candados que las tablas de identidad (20261009120000) más el de auditoría append-only:
--  1) RLS: política `solo_plataforma` (por nombre de rol); cualquier otro rol ve cero filas. ENABLE sin FORCE: el dueño que migra y limpia la base de test la salta.
--  2) Privilegios: `motor2_app` sin nada; `motor2_plataforma` solo SELECT e INSERT.
--  3) Trigger que reutiliza `rechazar_mutacion_de_auditoria()` (migración 20261001230000): rechaza UPDATE, DELETE y TRUNCATE a cualquier rol que no sea el dueño.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261009130000_auditoria_de_plataforma`).

-- CreateTable
CREATE TABLE "AuditoriaPlataforma" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "adminEmail" TEXT NOT NULL,
    "accion" TEXT NOT NULL,
    "empresaAfectadaId" TEXT,
    "detalle" JSONB,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditoriaPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "AuditoriaPlataforma_adminId_creadoEn_idx" ON "AuditoriaPlataforma"("adminId", "creadoEn");

-- CreateIndex
CREATE INDEX "AuditoriaPlataforma_empresaAfectadaId_creadoEn_idx" ON "AuditoriaPlataforma"("empresaAfectadaId", "creadoEn");

-- Candado 1) RLS
ALTER TABLE "AuditoriaPlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "AuditoriaPlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

-- Candado 2) Privilegios (si los roles existen: en una base de test o recién creada pueden no estar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "AuditoriaPlataforma" FROM motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "AuditoriaPlataforma" FROM motor2_plataforma;
    GRANT SELECT, INSERT ON "AuditoriaPlataforma" TO motor2_plataforma;
  END IF;
END
$$;

-- Candado 3) Trigger append-only
CREATE TRIGGER "AuditoriaPlataforma_inmutable_fila"
  BEFORE UPDATE OR DELETE ON "AuditoriaPlataforma"
  FOR EACH ROW EXECUTE FUNCTION rechazar_mutacion_de_auditoria();

CREATE TRIGGER "AuditoriaPlataforma_inmutable_truncate"
  BEFORE TRUNCATE ON "AuditoriaPlataforma"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion_de_auditoria();
