-- Reversa de 20261016111000_renglon_sin_stock (Paquete 3, M4.2). ABORTA, sin tocar nada, si ya hay un renglón SIN_STOCK o con concepto o tipo de costo (`RAISE EXCEPTION`): esos datos no caben en el esquema de M3 y no se borran en silencio.
-- Si no hay ninguno, vuelve a poner los dos CHECK de M3 CON SUS NOMBRES (`..._naturaleza_chk` solo MERCADERIA y `..._pareo_mercaderia_chk`) y borra la clave foránea, los índices, el CHECK del tipo de costo y las dos columnas. Es DESTRUCTIVA solo en eso último
-- (las columnas nuevas, vacías por la guarda). Bajar ANTES M4.3 (la imputación referencia el índice `(empresaId, id, naturaleza)`: sin CASCADE, el DROP INDEX falla a propósito mientras M4.3 siga subida) y DESPUÉS de bajar los gastos cargados (anular no alcanza:
-- los renglones no se borran). Orden de la reversa de M4: M4.5, M4.4, M4.3, esta (M4.2) y M4.1.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql` (UNA transacción: o se vuelve todo o nada); después `npx prisma migrate resolve --rolled-back 20261016111000_renglon_sin_stock`. Idempotente.

DO $$
DECLARE
  hay integer;
BEGIN
  IF to_regclass('"FacturaProveedorRenglon"') IS NOT NULL
     AND EXISTS (SELECT 1 FROM information_schema.columns WHERE table_schema = 'public' AND table_name = 'FacturaProveedorRenglon' AND column_name = 'conceptoGastoId') THEN
    EXECUTE 'SELECT count(*) FROM "FacturaProveedorRenglon" WHERE "naturaleza" <> ''MERCADERIA'' OR "conceptoGastoId" IS NOT NULL OR "tipoDeCosto" IS NOT NULL' INTO hay;
    IF hay > 0 THEN
      RAISE EXCEPTION 'No se puede bajar M4.2: hay % renglón(es) sin stock o con concepto de gasto. Anulá esas facturas y resguardá los datos (pg_dump) antes de decidir cómo seguir.', hay;
    END IF;
  END IF;
END
$$;

ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_pareo_naturaleza_chk";
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_naturaleza_chk";
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_pareo_mercaderia_chk";
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_naturaleza_chk" CHECK ("naturaleza" IN ('MERCADERIA'));
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_pareo_mercaderia_chk"
  CHECK (
    ("naturaleza" = 'MERCADERIA' AND "productoId" IS NOT NULL AND "cantidadStock" IS NOT NULL AND "precioPorUnidadStock" IS NOT NULL AND "detalle" IS NOT NULL)
    OR ("naturaleza" <> 'MERCADERIA' AND "productoId" IS NULL AND "cantidadStock" IS NULL AND "precioPorUnidadStock" IS NULL AND "detalle" IS NULL AND "loteVencimiento" IS NULL)
  );

ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_tipo_de_costo_chk";
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey";
DROP INDEX IF EXISTS "FacturaProveedorRenglon_empresaId_id_naturaleza_key";
DROP INDEX IF EXISTS "FacturaProveedorRenglon_conceptoGastoId_idx";
ALTER TABLE "FacturaProveedorRenglon" DROP COLUMN IF EXISTS "tipoDeCosto";
ALTER TABLE "FacturaProveedorRenglon" DROP COLUMN IF EXISTS "conceptoGastoId";
