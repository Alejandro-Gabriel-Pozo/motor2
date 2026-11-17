-- COMPRAS, RECEPCIÓN SEPARADA, etapa N3-a (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo).
-- Diseño: docs/diseno-compras-paridad-escalera-2026-11-16.md, §Nivel 6 «N3-a»; decisiones del dueño del 2026-11-16: «Compras: recepción separada (primera etapa)» e «Ya, con interruptor por empresa».
--
-- Qué hace: UNA sola sentencia de privilegio. Una parte de factura nace PENDIENTE (sin compra ni stock: `operacionId` NULL) y la CONFIRMACIÓN de la recepción le fija, en el mismo UPDATE que la pasa a RECIBIDA, la compra (`operacionId`) que
-- recién entonces se escribe. Hoy `motor2_app` solo tiene UPDATE de `estadoRecepcion`, `recibidaEn` y `recibidaPorId` (migración 20261016101500): falta `operacionId`.
--
-- Nada más cambia: ni columnas, ni CHECK, ni índices, ni disparadores, ni políticas (la política de UPDATE por sucursal de la migración 20261016102000 ya cubre la fila de la parte). La unicidad (empresaId, operacionId) y su clave
-- foránea compuesta a `Operacion` siguen: dos partes no pueden reclamar la misma compra. ADITIVA y reversible (down.sql: REVOKE de esa columna). El código anterior no escribe la columna: no hay efecto hasta que se encienda el módulo
-- `recepcion_de_compras` en una empresa.
--
-- Si el rol no existe (una base de test o recién creada puede no tenerlo) no hace nada, como las migraciones anteriores de privilegios.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE ("operacionId") ON "FacturaProveedorSucursal" TO motor2_app;
  END IF;
END
$$;
