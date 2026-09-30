-- Reversa de portal_carta_empresa. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20260930120000_portal_carta_empresa/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Pierde la config de apariencia del portal cargada; el portal vuelve a los defaults del catálogo.

DROP POLICY IF EXISTS aislamiento_empresa ON "PortalCartaEmpresa";
DROP TABLE "PortalCartaEmpresa";
