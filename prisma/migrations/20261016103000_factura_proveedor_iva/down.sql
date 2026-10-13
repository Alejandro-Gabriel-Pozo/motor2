-- Reversa de 20261016103000_factura_proveedor_iva (Paquete 3, M3d). DESTRUCTIVA si ya hay datos nuevos: se pierden los tributos de las facturas, el desglose de IVA (neto, IVA, alícuota e IVA computable) de renglones y cabeceras, la
-- condición de IVA copiada en cada cabecera y el valor de la perilla `Empresa.llevaIvaDeCompras` (las facturas, los renglones y el Kardex NO se tocan).
-- Antes de bajar, contar y guardar lo que dé más de 0:
--   SELECT count(*) FROM "FacturaProveedorTributo";
--   SELECT count(*) FROM "FacturaProveedorRenglon" WHERE "importeNeto" IS NOT NULL OR "alicuotaIva" IS NOT NULL OR "importeIvaComputable" <> 0;
--   SELECT count(*) FROM "FacturaProveedor" WHERE "importeNeto" IS NOT NULL OR "condicionIvaEmpresa" IS NOT NULL;
--   SELECT id, "llevaIvaDeCompras" FROM "Empresa" WHERE "llevaIvaDeCompras";
-- Recomendación: bajar M3d solo ANTES de desplegar la Etapa C (con todo en su valor por defecto no se pierde nada).
-- Es la ÚLTIMA de M3 que se subió, así que es la PRIMERA que se baja (antes de M3c, M3b y M3a). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después
-- `npx prisma migrate resolve --rolled-back 20261016103000_factura_proveedor_iva`. Idempotente (IF EXISTS).

DROP TABLE IF EXISTS "FacturaProveedorTributo";

ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_iva_computable_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_alicuota_sin_iva_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_neto_mas_iva_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_desglose_no_negativo_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_desglose_pareo_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon" DROP CONSTRAINT IF EXISTS "FacturaProveedorRenglon_alicuota_iva_chk";
ALTER TABLE IF EXISTS "FacturaProveedorRenglon"
  DROP COLUMN IF EXISTS "importeIvaComputable",
  DROP COLUMN IF EXISTS "importeIva",
  DROP COLUMN IF EXISTS "importeNeto",
  DROP COLUMN IF EXISTS "alicuotaIva";

ALTER TABLE IF EXISTS "FacturaProveedor" DROP CONSTRAINT IF EXISTS "FacturaProveedor_desglose_dentro_del_total_chk";
ALTER TABLE IF EXISTS "FacturaProveedor" DROP CONSTRAINT IF EXISTS "FacturaProveedor_desglose_no_negativo_chk";
ALTER TABLE IF EXISTS "FacturaProveedor" DROP CONSTRAINT IF EXISTS "FacturaProveedor_desglose_pareo_chk";
ALTER TABLE IF EXISTS "FacturaProveedor" DROP CONSTRAINT IF EXISTS "FacturaProveedor_condicion_iva_empresa_chk";
ALTER TABLE IF EXISTS "FacturaProveedor"
  DROP COLUMN IF EXISTS "importeIva",
  DROP COLUMN IF EXISTS "importeNeto",
  DROP COLUMN IF EXISTS "condicionIvaEmpresa";

ALTER TABLE IF EXISTS "Empresa" DROP COLUMN IF EXISTS "llevaIvaDeCompras";
