-- Fase A — carta multisucursal (alcance TODAS/SUCURSALES) y sincronización
-- de precios entre sucursales (plan del panel, 2.4/2.5). Igual patrón de 3
-- pasos que la migración de Empresa/UsuarioEmpresa: columna nullable ->
-- backfill -> NOT NULL. El backfill usa `(SELECT id FROM "Empresa" LIMIT 1)`
-- a propósito, no un id hardcodeado: la invariante de Fase A es que existe
-- EXACTAMENTE una empresa (plan 2.7, "no se crea una segunda empresa real
-- hasta terminar la Fase B"), así que cualquiera sea su id, es la correcta.
-- Si esa invariante no se cumple (más de una fila en Empresa), la migración
-- debe fallar de forma visible, no adivinar — por eso el chequeo explícito
-- al principio.

BEGIN;

-- 0. Salvaguarda: esta migración asume una sola empresa (Fase A). Si en
--    algún momento se corre con más de una, aborta en vez de backfillear
--    en silencio hacia una empresa arbitraria.
DO $$
BEGIN
  IF (SELECT count(*) FROM "Empresa") <> 1 THEN
    RAISE EXCEPTION 'Se esperaba exactamente 1 fila en Empresa antes de esta migración (Fase A), se encontraron %', (SELECT count(*) FROM "Empresa");
  END IF;
END $$;

-- 1. Catálogo de alcance.
CREATE TYPE "AlcanceCarta" AS ENUM ('TODAS', 'SUCURSALES');

-- 2. Columnas nullable primero (no rompen filas existentes).
ALTER TABLE "SeccionCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "SeccionCarta" ADD COLUMN "alcance" "AlcanceCarta" NOT NULL DEFAULT 'TODAS';

ALTER TABLE "ItemAgrupadoCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "ItemAgrupadoCarta" ADD COLUMN "alcance" "AlcanceCarta" NOT NULL DEFAULT 'TODAS';

ALTER TABLE "GeneroCarta" ADD COLUMN "empresaId" TEXT;

ALTER TABLE "PromoCarta" ADD COLUMN "empresaId" TEXT;

ALTER TABLE "PrecioLocalProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PrecioLocalProducto" ADD COLUMN "sincronizado" BOOLEAN NOT NULL DEFAULT false;

-- 3. Backfill: toda fila existente va a la única Empresa (default TODAS ya
--    quedó puesto arriba para Seccion/ItemAgrupado — no cambia lo que ve
--    nadie hoy).
UPDATE "SeccionCarta" SET "empresaId" = (SELECT id FROM "Empresa" LIMIT 1) WHERE "empresaId" IS NULL;
UPDATE "ItemAgrupadoCarta" SET "empresaId" = (SELECT id FROM "Empresa" LIMIT 1) WHERE "empresaId" IS NULL;
UPDATE "GeneroCarta" SET "empresaId" = (SELECT id FROM "Empresa" LIMIT 1) WHERE "empresaId" IS NULL;
UPDATE "PromoCarta" SET "empresaId" = (SELECT id FROM "Empresa" LIMIT 1) WHERE "empresaId" IS NULL;
UPDATE "PrecioLocalProducto" SET "empresaId" = (SELECT id FROM "Empresa" LIMIT 1) WHERE "empresaId" IS NULL;

-- 4. NOT NULL + FK + índices, recién con todo backfilleado.
ALTER TABLE "SeccionCarta" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "SeccionCarta" ADD CONSTRAINT "SeccionCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");
DROP INDEX "SeccionCarta_nombre_key";
CREATE UNIQUE INDEX "SeccionCarta_empresaId_id_key" ON "SeccionCarta"("empresaId", "id");
CREATE UNIQUE INDEX "SeccionCarta_empresaId_nombre_key" ON "SeccionCarta"("empresaId", "nombre");

ALTER TABLE "ItemAgrupadoCarta" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");
DROP INDEX "ItemAgrupadoCarta_nombre_key";
CREATE UNIQUE INDEX "ItemAgrupadoCarta_empresaId_id_key" ON "ItemAgrupadoCarta"("empresaId", "id");
CREATE UNIQUE INDEX "ItemAgrupadoCarta_empresaId_nombre_key" ON "ItemAgrupadoCarta"("empresaId", "nombre");

ALTER TABLE "GeneroCarta" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "GeneroCarta" ADD CONSTRAINT "GeneroCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");
DROP INDEX "GeneroCarta_nombre_key";
CREATE UNIQUE INDEX "GeneroCarta_empresaId_nombre_key" ON "GeneroCarta"("empresaId", "nombre");

ALTER TABLE "PromoCarta" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");
CREATE UNIQUE INDEX "PromoCarta_empresaId_id_key" ON "PromoCarta"("empresaId", "id");

ALTER TABLE "PrecioLocalProducto" ALTER COLUMN "empresaId" SET NOT NULL;
ALTER TABLE "PrecioLocalProducto" ADD CONSTRAINT "PrecioLocalProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id");
CREATE UNIQUE INDEX "PrecioLocalProducto_empresaId_id_key" ON "PrecioLocalProducto"("empresaId", "id");

-- 5. Tablas puente nuevas (carta multisucursal). Vacías al nacer: nadie
--    tiene alcance=SUCURSALES todavía (todo quedó en TODAS arriba).
CREATE TABLE "SeccionCartaSucursal" (
    "empresaId" TEXT NOT NULL,
    "seccionCartaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    CONSTRAINT "SeccionCartaSucursal_pkey" PRIMARY KEY ("seccionCartaId", "sucursalId"),
    CONSTRAINT "SeccionCartaSucursal_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id"),
    CONSTRAINT "SeccionCartaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id")
);

CREATE TABLE "ItemAgrupadoCartaSucursal" (
    "empresaId" TEXT NOT NULL,
    "itemAgrupadoCartaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    CONSTRAINT "ItemAgrupadoCartaSucursal_pkey" PRIMARY KEY ("itemAgrupadoCartaId", "sucursalId"),
    CONSTRAINT "ItemAgrupadoCartaSucursal_empresaId_itemAgrupadoCartaId_fkey" FOREIGN KEY ("empresaId", "itemAgrupadoCartaId") REFERENCES "ItemAgrupadoCarta"("empresaId", "id"),
    CONSTRAINT "ItemAgrupadoCartaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id")
);

-- 6. Puente de promos: backfill con la fila de origen de cada PromoCarta
--    (su `sucursalId` actual) — así "compartir/dejar de compartir" (C13)
--    arranca desde el estado de hoy, no desde cero.
CREATE TABLE "PromoCartaSucursal" (
    "empresaId" TEXT NOT NULL,
    "promoCartaId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    CONSTRAINT "PromoCartaSucursal_pkey" PRIMARY KEY ("promoCartaId", "sucursalId"),
    CONSTRAINT "PromoCartaSucursal_empresaId_promoCartaId_fkey" FOREIGN KEY ("empresaId", "promoCartaId") REFERENCES "PromoCarta"("empresaId", "id"),
    CONSTRAINT "PromoCartaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id")
);

INSERT INTO "PromoCartaSucursal" ("empresaId", "promoCartaId", "sucursalId")
SELECT "empresaId", "id", "sucursalId" FROM "PromoCarta";

-- 7. Sincronización de precios: catálogo de grupos, vacío al nacer (nadie
--    sincroniza nada por default — feature apagada, sincronizado=false ya
--    quedó en el paso 2).
CREATE TABLE "GrupoSincroPrecio" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    CONSTRAINT "GrupoSincroPrecio_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "GrupoSincroPrecio_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id")
);
CREATE UNIQUE INDEX "GrupoSincroPrecio_empresaId_id_key" ON "GrupoSincroPrecio"("empresaId", "id");

CREATE TABLE "GrupoSincroPrecioSucursal" (
    "empresaId" TEXT NOT NULL,
    "grupoId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    CONSTRAINT "GrupoSincroPrecioSucursal_pkey" PRIMARY KEY ("grupoId", "sucursalId"),
    CONSTRAINT "GrupoSincroPrecioSucursal_empresaId_grupoId_fkey" FOREIGN KEY ("empresaId", "grupoId") REFERENCES "GrupoSincroPrecio"("empresaId", "id"),
    CONSTRAINT "GrupoSincroPrecioSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id")
);
CREATE UNIQUE INDEX "GrupoSincroPrecioSucursal_empresaId_sucursalId_key" ON "GrupoSincroPrecioSucursal"("empresaId", "sucursalId");
CREATE UNIQUE INDEX "GrupoSincroPrecioSucursal_sucursalId_key" ON "GrupoSincroPrecioSucursal"("sucursalId");

COMMIT;
