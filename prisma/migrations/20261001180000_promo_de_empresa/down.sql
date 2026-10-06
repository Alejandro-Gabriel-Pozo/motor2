-- Reversa de la migración 20261001180000_promo_de_empresa. NO la corre Prisma: se aplica a mano como DUEÑO de las tablas:
--   psql "$DIRECT_URL" -v ON_ERROR_STOP=1 -f prisma/migrations/20261001180000_promo_de_empresa/down.sql
-- y se borra la fila de `_prisma_migrations` de esta migración (o se usa `prisma migrate resolve --rolled-back`).
-- Solo es reversible sin pérdida mientras cada promo esté en UNA sola sucursal (como antes de la migración): si alguna promo está activada en
-- varias sucursales, o en ninguna, la reversa se aborta con un mensaje. La marca de reporte `PromocionProducto` vuelve vacía y
-- `Sucursal.promocionesHabilitadas` vuelve en false.

DO $$
BEGIN
  IF EXISTS (
    SELECT 1 FROM "PromoCarta" p
    WHERE (SELECT count(*) FROM "PromoCartaSucursal" s WHERE s."promoCartaId" = p."id") <> 1
  ) THEN
    RAISE EXCEPTION 'Hay promos en varias sucursales o en ninguna: no se puede volver al modelo de una promo por sucursal sin perder datos.';
  END IF;
END
$$;

ALTER TABLE "PromoCarta" ADD COLUMN "sucursalId" TEXT;
UPDATE "PromoCarta" p SET "sucursalId" = s."sucursalId", "activa" = s."activa" FROM "PromoCartaSucursal" s WHERE s."promoCartaId" = p."id";
ALTER TABLE "PromoCarta" ALTER COLUMN "sucursalId" SET NOT NULL;
DROP INDEX "PromoCarta_activa_idx";
CREATE INDEX "PromoCarta_sucursalId_activa_idx" ON "PromoCarta"("sucursalId", "activa");
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

DROP POLICY IF EXISTS aislamiento_empresa ON "PromoCartaSucursal";
DROP TABLE "PromoCartaSucursal";

ALTER TABLE "Sucursal" ADD COLUMN "promocionesHabilitadas" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE "PromocionProducto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "productoId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "PromocionProducto_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX "PromocionProducto_sucursalId_productoId_key" ON "PromocionProducto"("sucursalId", "productoId");
CREATE UNIQUE INDEX "PromocionProducto_empresaId_id_key" ON "PromocionProducto"("empresaId", "id");
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromocionProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

DELETE FROM "CapacidadSucursal" WHERE "accionClave" IN ('carta_promo_definir', 'carta_promo_activar', 'carta_promo_precio_local');
DELETE FROM "PermisoRol" WHERE "accionClave" IN ('carta_promo_definir', 'carta_promo_activar', 'carta_promo_precio_local');
DELETE FROM "Accion" WHERE "clave" IN ('carta_promo_definir', 'carta_promo_activar', 'carta_promo_precio_local');
