-- Administrador de plataforma (E4, ADR-012, ADR-019; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con ensayo en una rama de Neon y respaldo previo).
-- Identidad APARTE de `User` para quien opera la plataforma: sin `empresaId`, sin vínculo con ninguna empresa (nunca entra a una). Cuatro tablas:
-- `AdminPlataforma`, y las de su ingreso (código del mail, códigos de recuperación, sesión). Solo existen para que la consola de `plataforma/` inicie sesión.
--
-- ADITIVA: solo agrega tablas. El código viejo las ignora, así que se puede aplicar por adelantado y el Instant Rollback de Vercel sigue siendo seguro.
-- Se crean en TODAS las bases (la migración es una sola), pero solo se llena la de identidad (zuluhub): en las demás quedan vacías.
--
-- Tres candados que se complementan (ENABLE sin FORCE: el dueño que migra y limpia la base de test los salta):
--  1) RLS: una única política `solo_plataforma` que deja leer y escribir ÚNICAMENTE a `motor2_plataforma` (por nombre de rol, `current_user`, para no depender de
--     que el rol exista ya en esa base: se crea a mano, base por base, con scripts/operaciones/crear-rol-motor2-plataforma.sql). Cualquier otro rol ve cero filas.
--  2) Privilegios: `motor2_app` pierde TODO sobre estas tablas (las nuevas tablas nacen con los default privileges del dueño; acá se revoca). `motor2_plataforma`
--     queda con SELECT/INSERT/UPDATE y SIN DELETE (ADR-012 §3): un administrador se desactiva, una sesión se cierra, un código se marca usado.
--  3) El email se guarda ya normalizado (CHECK): una comparación por igualdad nunca se esquiva con mayúsculas o espacios.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261009120000_admin_de_plataforma`).

-- CreateTable
CREATE TABLE "AdminPlataforma" (
    "id" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "secretoTotp" TEXT NOT NULL,
    "ultimoPasoTotp" INTEGER,
    "fallosSegundoFactor" INTEGER NOT NULL DEFAULT 0,
    "bloqueadoHasta" TIMESTAMP(3),
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminPlataforma_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AdminPlataforma_email_normalizado_check" CHECK ("email" = lower(btrim("email")) AND length("email") > 0),
    CONSTRAINT "AdminPlataforma_fallos_check" CHECK ("fallosSegundoFactor" >= 0)
);

-- CreateTable
CREATE TABLE "CodigoDeIngresoPlataforma" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "hashCodigo" TEXT NOT NULL,
    "intentosFallidos" INTEGER NOT NULL DEFAULT 0,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "venceEn" TIMESTAMP(3) NOT NULL,
    "usadoEn" TIMESTAMP(3),
    "invalidadoEn" TIMESTAMP(3),

    CONSTRAINT "CodigoDeIngresoPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "CodigoDeRecuperacionPlataforma" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "hashCodigo" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "usadoEn" TIMESTAMP(3),

    CONSTRAINT "CodigoDeRecuperacionPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "SesionPlataforma" (
    "id" TEXT NOT NULL,
    "adminId" TEXT NOT NULL,
    "hashToken" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "ultimaActividad" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "segundoFactorEn" TIMESTAMP(3),
    "cerradaEn" TIMESTAMP(3),

    CONSTRAINT "SesionPlataforma_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "AdminPlataforma_email_key" ON "AdminPlataforma"("email");

-- CreateIndex
CREATE INDEX "CodigoDeIngresoPlataforma_adminId_creadoEn_idx" ON "CodigoDeIngresoPlataforma"("adminId", "creadoEn");

-- CreateIndex
CREATE UNIQUE INDEX "CodigoDeRecuperacionPlataforma_adminId_hashCodigo_key" ON "CodigoDeRecuperacionPlataforma"("adminId", "hashCodigo");

-- CreateIndex
CREATE UNIQUE INDEX "SesionPlataforma_hashToken_key" ON "SesionPlataforma"("hashToken");

-- CreateIndex
CREATE INDEX "SesionPlataforma_adminId_idx" ON "SesionPlataforma"("adminId");

-- AddForeignKey
ALTER TABLE "CodigoDeIngresoPlataforma" ADD CONSTRAINT "CodigoDeIngresoPlataforma_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminPlataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "CodigoDeRecuperacionPlataforma" ADD CONSTRAINT "CodigoDeRecuperacionPlataforma_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminPlataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SesionPlataforma" ADD CONSTRAINT "SesionPlataforma_adminId_fkey" FOREIGN KEY ("adminId") REFERENCES "AdminPlataforma"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Candado 1) RLS
ALTER TABLE "AdminPlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "AdminPlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

ALTER TABLE "CodigoDeIngresoPlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "CodigoDeIngresoPlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

ALTER TABLE "CodigoDeRecuperacionPlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "CodigoDeRecuperacionPlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

ALTER TABLE "SesionPlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "SesionPlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

-- Candado 2) Privilegios (si los roles existen: en una base de test o recién creada pueden no estar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "AdminPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma" FROM motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "AdminPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma" FROM motor2_plataforma;
    GRANT SELECT, INSERT, UPDATE ON "AdminPlataforma", "CodigoDeIngresoPlataforma", "CodigoDeRecuperacionPlataforma", "SesionPlataforma" TO motor2_plataforma;
  END IF;
END
$$;
