-- Promociones, un solo concepto (decisión del dueño, 2026-10-01): una "promo" es SIEMPRE la promo compuesta de la carta (PromoCarta). Se define UNA
-- vez por empresa y cada sucursal la prende o la apaga con una fila de `PromoCartaSucursal` (con precio local opcional). Un producto suelto con
-- descuento no es una promo. La marca de reporte `PromocionProducto` y el apagador `Sucursal.promocionesHabilitadas` desaparecen en todas las capas.
-- Reversa: down.sql.
--
-- 1) Tabla nueva `PromoCartaSucursal` (multiempresa como el resto: "empresaId" con default app_empresa_actual() y política aislamiento_empresa).
-- 2) Backfill: cada PromoCarta existente (que era de UNA sucursal) pasa a una fila de empresa + una `PromoCartaSucursal` en su sucursal de origen,
--    con el `activa` que tenía. La promo de empresa queda activa (el apagado de empresa no existía). No se fusionan promos de distintas sucursales
--    aunque se llamen igual: sería adivinar.
-- 3) `PromoCarta.sucursalId` se elimina.
-- 4) Se elimina la tabla `PromocionProducto` (y su RLS) y la columna `Sucursal.promocionesHabilitadas`: las marcas "combo" cargadas se pierden
--    (era un clasificador para un reporte que se retira; el historial de ventas no cambia).
-- 5) Permisos (datos): `carta_promos` (sucursal) se parte en `carta_promo_definir` (empresa), `carta_promo_activar` y `carta_promo_precio_local`
--    (sucursal). Expandir: el padre queda con su fila de `Accion` hasta la contracción, y a cada rol/capacidad se le copia lo que ya tenía. Las claves
--    `promociones_activar`, `promociones_marcar_combo` y `promociones_config` se retiran del catálogo del código (sus filas quedan hasta la contracción).

-- CreateTable
CREATE TABLE "PromoCartaSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "promoCartaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "activa" BOOLEAN NOT NULL DEFAULT true,
    "precioLocal" DECIMAL(14,2),

    CONSTRAINT "PromoCartaSucursal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PromoCartaSucursal_empresaId_id_key" ON "PromoCartaSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "PromoCartaSucursal_promoCartaId_sucursalId_key" ON "PromoCartaSucursal"("promoCartaId", "sucursalId");
CREATE INDEX "PromoCartaSucursal_sucursalId_activa_idx" ON "PromoCartaSucursal"("sucursalId", "activa");

-- AddForeignKey
ALTER TABLE "PromoCartaSucursal" ADD CONSTRAINT "PromoCartaSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCartaSucursal" ADD CONSTRAINT "PromoCartaSucursal_empresaId_promoCartaId_fkey" FOREIGN KEY ("empresaId", "promoCartaId") REFERENCES "PromoCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCartaSucursal" ADD CONSTRAINT "PromoCartaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Aislamiento por empresa (RLS)
ALTER TABLE "PromoCartaSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromoCartaSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Permisos para el rol de ejecución, si existe (los default privileges del dueño ya lo cubren; esto lo deja explícito).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "PromoCartaSucursal" TO motor2_app;
  END IF;
END
$$;

-- Backfill: la sucursal de origen de cada promo la sigue ofreciendo, con el mismo estado.
INSERT INTO "PromoCartaSucursal" ("id", "empresaId", "promoCartaId", "sucursalId", "activa")
SELECT gen_random_uuid()::text, p."empresaId", p."id", p."sucursalId", p."activa" FROM "PromoCarta" p;

-- La promo pasa a ser de la empresa: el apagado de empresa arranca encendido para todas.
UPDATE "PromoCarta" SET "activa" = true;

-- DropForeignKey / DropIndex / DropColumn
ALTER TABLE "PromoCarta" DROP CONSTRAINT "PromoCarta_empresaId_sucursalId_fkey";
DROP INDEX "PromoCarta_sucursalId_activa_idx";
ALTER TABLE "PromoCarta" DROP COLUMN "sucursalId";
CREATE INDEX "PromoCarta_activa_idx" ON "PromoCarta"("activa");

-- Baja de la marca de reporte y del apagador por sucursal.
DROP POLICY IF EXISTS aislamiento_empresa ON "PromocionProducto";
DROP TABLE "PromocionProducto";
ALTER TABLE "Sucursal" DROP COLUMN "promocionesHabilitadas";

-- Permisos (datos): partición de `carta_promos`.
INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('carta_promo_definir', 'Crear y editar las promos de la carta (de la empresa): datos, cupos y apagado general'),
  ('carta_promo_activar', 'Prender o apagar una promo de la empresa en la sucursal'),
  ('carta_promo_precio_local', 'Fijar el precio de una promo solo en la sucursal')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('carta_promos', 'carta_promo_definir'),
  ('carta_promos', 'carta_promo_activar'),
  ('carta_promos', 'carta_promo_precio_local')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('carta_promos', 'carta_promo_definir'),
  ('carta_promos', 'carta_promo_activar'),
  ('carta_promos', 'carta_promo_precio_local')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
