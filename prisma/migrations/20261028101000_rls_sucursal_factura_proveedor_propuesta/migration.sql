-- E3a-M (ADR-041): RLS por sucursal de la propuesta de parte y de sus renglones. REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon); el dueño la autorizó el 2026-10-28 SOLO en bases locales.
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en cada tabla, con alcance ENTRE_SUCURSALES (origen = la sucursal que carga la factura, destino = la que acepta): las ven y las escriben las
-- dos puntas y nadie más. Se combinan con AND con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna fila (falla cerrado). Requiere B1 y 20261028100000_factura_proveedor_propuesta.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance(["FacturaProveedorPropuesta", "FacturaProveedorPropuestaRenglon"]) (test/setup/politicas-de-alcance-de-sucursal.ts); lo exige test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261028101000_rls_sucursal_factura_proveedor_propuesta`). No es destructiva. Se baja ANTES que 20261028100000.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- FacturaProveedorPropuesta
CREATE POLICY alcance_sucursal_select ON "FacturaProveedorPropuesta" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "FacturaProveedorPropuesta" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "FacturaProveedorPropuesta" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "FacturaProveedorPropuesta" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));

-- FacturaProveedorPropuestaRenglon
CREATE POLICY alcance_sucursal_select ON "FacturaProveedorPropuestaRenglon" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_lectura())::text[])));
CREATE POLICY alcance_sucursal_insert ON "FacturaProveedorPropuestaRenglon" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_update ON "FacturaProveedorPropuestaRenglon" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])))
  WITH CHECK (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
CREATE POLICY alcance_sucursal_delete ON "FacturaProveedorPropuestaRenglon" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("origenSucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR "destinoSucursalId" = ANY((SELECT app_sucursales_escritura())::text[])));
