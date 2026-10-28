-- Reversa de 20261028100000_factura_proveedor_propuesta (E3a-M, ADR-041). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261028100000_factura_proveedor_propuesta`.
-- Bajar ANTES 20261028101000_rls_sucursal_factura_proveedor_propuesta. ABORTA si hay filas: se perderían propuestas, sus renglones o anulaciones (el stock y las compras ya escritos no se tocan, pero se perdería qué se
-- propuso y por qué se anuló).
DO $$
DECLARE
  propuestas bigint;
  renglones bigint;
  anulaciones bigint;
BEGIN
  -- Bajarla dos veces no falla: si las tablas ya no están, no hay nada que contar.
  propuestas := 0; renglones := 0; anulaciones := 0;
  IF to_regclass('"FacturaProveedorPropuesta"') IS NOT NULL THEN SELECT count(*) INTO propuestas FROM "FacturaProveedorPropuesta"; END IF;
  IF to_regclass('"FacturaProveedorPropuestaRenglon"') IS NOT NULL THEN SELECT count(*) INTO renglones FROM "FacturaProveedorPropuestaRenglon"; END IF;
  IF to_regclass('"AnulacionDeFacturaProveedor"') IS NOT NULL THEN SELECT count(*) INTO anulaciones FROM "AnulacionDeFacturaProveedor"; END IF;
  IF propuestas > 0 OR renglones > 0 OR anulaciones > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261028100000_factura_proveedor_propuesta: hay % propuesta(s), % renglón(es) de propuesta y % anulación(es)', propuestas, renglones, anulaciones;
  END IF;
END
$$;

DROP TABLE IF EXISTS "FacturaProveedorPropuestaRenglon";
DROP TABLE IF EXISTS "FacturaProveedorPropuesta";
DROP TABLE IF EXISTS "AnulacionDeFacturaProveedor";
