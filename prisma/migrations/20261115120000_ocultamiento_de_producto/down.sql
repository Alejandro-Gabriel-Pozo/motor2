-- Reversa de 20261115120000_ocultamiento_de_producto («Ocultar» como Pedernal, E3a). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261115120000_ocultamiento_de_producto`.
-- Bajar ANTES 20261115121000_rls_sucursal_ocultamiento_de_producto (sus políticas cuelgan de la tabla; DROP TABLE las arrastra, pero la reversa de esa migración es la que deja el registro limpio).
-- ABORTA si hay filas: se perderían las marcas de ocultar cargadas (la auditoría las conserva, pero no se podría reconstruir el estado). Con la tabla vacía el estado resultante es el de antes de la migración: todo visible.
-- Bajarla dos veces no falla: si la tabla ya no está, no hay nada que contar.
DO $$
DECLARE
  marcas bigint;
BEGIN
  marcas := 0;
  IF to_regclass('"OcultamientoProducto"') IS NOT NULL THEN SELECT count(*) INTO marcas FROM "OcultamientoProducto"; END IF;
  IF marcas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261115120000_ocultamiento_de_producto: hay % marca(s) de ocultar cargadas', marcas;
  END IF;
END
$$;

DROP TABLE IF EXISTS "OcultamientoProducto";
