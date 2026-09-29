-- Fase A — ADR-005: TokenCartaEmpresa, acceso al portal de carta por
-- empresa. Tabla nueva, sin backfill (no hay tokens previos: CARTA_API_TOKEN
-- hoy es una variable de entorno, no una fila de esta tabla — migrar el
-- valor actual a una fila real es una decisión operativa aparte, no de esta
-- migración).

BEGIN;

CREATE TABLE "TokenCartaEmpresa" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revocadoEn" TIMESTAMP(3),
    CONSTRAINT "TokenCartaEmpresa_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "TokenCartaEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
);

CREATE UNIQUE INDEX "TokenCartaEmpresa_tokenHash_key" ON "TokenCartaEmpresa"("tokenHash");
CREATE INDEX "TokenCartaEmpresa_empresaId_idx" ON "TokenCartaEmpresa"("empresaId");

COMMIT;
