-- Reversa de 20261117170000_guarda_de_apagado_recepcion_separada (Compras, guarda de apagado de la recepción separada). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117170000_guarda_de_apagado_recepcion_separada`.
-- Sin datos que migrar: solo quita los dos disparadores y las tres funciones. Bajarla dos veces no falla. Al bajarla, vuelve el límite de antes: la plataforma PUEDE apagar la recepción separada con compras pendientes (quedarían sin forma de recibirse hasta volver a encenderla).
DROP TRIGGER IF EXISTS "FacturaProveedorSucursal_modulo_recepcion_chk" ON "FacturaProveedorSucursal";
DROP TRIGGER IF EXISTS "ModuloEmpresa_recepcion_pendientes_chk" ON "ModuloEmpresa";
DROP FUNCTION IF EXISTS factura_proveedor_sucursal_guarda_de_modulo_recepcion();
DROP FUNCTION IF EXISTS modulo_empresa_guarda_de_apagado_recepcion();
DROP FUNCTION IF EXISTS compras_pendientes_de_recepcion(text);
