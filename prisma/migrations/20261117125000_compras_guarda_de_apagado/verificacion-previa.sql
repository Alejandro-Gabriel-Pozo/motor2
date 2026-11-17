-- Verificación previa de 20261117125000_compras_guarda_de_apagado (SOLO LECTURA; correr como dueño ANTES de aplicarla en una base real y guardar la salida).
-- Resultado esperado: ni las funciones ni los disparadores existen todavía, y las tres tablas de las que cuelgan existen. Informativo y CLAVE: la migración no rechaza nada existente, pero esta consulta dice qué empresas tienen hoy el módulo APAGADO con compras
-- pendientes (el estado que desde ahora la base impide crear): si da filas, esas pendientes quedaron sin forma de recibirse y hay que decidirlo con el dueño ANTES de apagar nada más.
SELECT 'funciones_o_disparadores_ya_existen' AS control, count(*) AS cantidad FROM pg_proc WHERE proname IN ('compras_pendientes_de_recepcion', 'modulo_empresa_guarda_de_apagado_recepcion', 'factura_proveedor_sucursal_guarda_de_modulo_recepcion');
SELECT 'disparadores_ya_existen' AS control, count(*) AS cantidad FROM pg_trigger WHERE tgname IN ('ModuloEmpresa_recepcion_pendientes_chk', 'FacturaProveedorSucursal_modulo_recepcion_chk') AND NOT tgisinternal;
SELECT 'tablas_de_las_que_cuelga' AS control, count(*) AS cantidad FROM information_schema.tables WHERE table_schema = 'public' AND table_name IN ('ModuloEmpresa', 'FacturaProveedorSucursal', 'FacturaProveedor', 'Sucursal');
-- Informativo: empresas con pendientes sin anular y el módulo sin fila ACTIVA (estado «apagado con pendientes»).
SELECT p."empresaId", count(*) AS pendientes_sin_anular
  FROM "FacturaProveedorSucursal" p JOIN "FacturaProveedor" f ON f."empresaId" = p."empresaId" AND f."id" = p."facturaProveedorId"
 WHERE p."estadoRecepcion" = 'PENDIENTE' AND f."anuladaEn" IS NULL
   AND NOT EXISTS (SELECT 1 FROM "ModuloEmpresa" m WHERE m."empresaId" = p."empresaId" AND m."modulo" = 'recepcion_de_compras' AND m."estado" = 'ACTIVO')
 GROUP BY 1 ORDER BY 1;
