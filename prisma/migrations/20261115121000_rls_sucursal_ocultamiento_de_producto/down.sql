-- Reversa de 20261115121000_rls_sucursal_ocultamiento_de_producto (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261115121000_rls_sucursal_ocultamiento_de_producto`).
-- Solo borra las 4 políticas de alcance de OcultamientoProducto: la app vuelve a ver todo lo de su empresa en esa tabla (regresión de seguridad, no de datos). Se baja ANTES que 20261115120000 y que B1.

-- M.3 RLS por sucursal: reversa de las políticas (generado por test/setup/politicas-de-alcance-de-sucursal.ts).
DROP POLICY IF EXISTS alcance_sucursal_select ON "OcultamientoProducto";
DROP POLICY IF EXISTS alcance_sucursal_insert ON "OcultamientoProducto";
DROP POLICY IF EXISTS alcance_sucursal_update ON "OcultamientoProducto";
DROP POLICY IF EXISTS alcance_sucursal_delete ON "OcultamientoProducto";
