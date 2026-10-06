-- Portal de la carta pública con mapa: config de apariencia del portal por empresa (src/core/carta/portal.ts, CLAVES_PORTAL_V1).
-- 1 tabla nueva, PortalCartaEmpresa, 1:1 con Empresa. SIN backfill: fila ausente = el portal usa los defaults del catálogo.
-- Mismo criterio multiempresa que el resto de las tablas de dominio (ADR-007): "empresaId" con default app_empresa_actual()
-- y política aislamiento_empresa (ENABLE sin FORCE: el dueño de la tabla la salta, el rol motor2_app queda sujeto).
-- Reversa: down.sql.

-- CreateTable
CREATE TABLE "PortalCartaEmpresa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "valores" JSONB NOT NULL DEFAULT '{}',
    "actualizadoEn" TIMESTAMP(3) NOT NULL,

    CONSTRAINT "PortalCartaEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalCartaEmpresa_empresaId_key" ON "PortalCartaEmpresa"("empresaId");

-- AddForeignKey
ALTER TABLE "PortalCartaEmpresa" ADD CONSTRAINT "PortalCartaEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aislamiento por empresa (RLS)
ALTER TABLE "PortalCartaEmpresa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PortalCartaEmpresa" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Permisos para el rol de ejecución, si existe (los default privileges del dueño ya lo cubren; esto lo deja explícito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PortalCartaEmpresa" TO motor2_app;
  END IF;
END
$$;
