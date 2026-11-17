-- Compras, guarda de apagado de la recepción separada (docs/diseno-compras-guarda-de-apagado-2026-11-17.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real, base por base, con respaldo y ensayo en una rama de Neon).
-- Decisión del dueño, 2026-11-17: «3.-lo recomendado por ahora» → el sistema NO deja apagar el módulo `recepcion_de_compras` mientras haya compras pendientes de recibir. Disparador aprobado por el orquestador (2026-11-17) como barrera de BASE: la guarda
-- vale para cualquier camino que escriba `ModuloEmpresa` (la consola, el script de emergencia, un UPDATE a mano, el techo del plan cuando se conecte), no solo para el caso de uso.
--
-- QUÉ DECIDE LA BASE (tres piezas, todas aditivas; no tocan ninguna fila, columna ni índice):
--   a) `compras_pendientes_de_recepcion(empresa)`: cuenta las partes `PENDIENTE` de facturas NO anuladas de TODAS las sucursales de la empresa y arma la lista de sucursales. SECURITY DEFINER con `search_path` fijo: lee sin pasar por la RLS por sucursal
--      (la consola corre como `motor2_plataforma`, que NO tiene ningún permiso sobre `FacturaProveedorSucursal`, y la app solo ve sus sucursales). Solo lee. EXECUTE revocado a PUBLIC: no es una consulta que cualquier rol pueda hacerle a otra empresa;
--      la usan las dos funciones de disparador, que son del dueño.
--   b) Disparador BEFORE UPDATE sobre `ModuloEmpresa`: al pasar `recepcion_de_compras` de ACTIVO a INACTIVO (o al cambiarle el módulo o la empresa a la fila, que lo apagaría igual) con pendientes, rechaza con SQLSTATE 23514 y la restricción
--      `ModuloEmpresa_recepcion_pendientes_chk`; el mensaje lleva la cantidad y las sucursales (`GUARDA_APAGADO_RECEPCION|N|sucursales`) para que las dos vías que apagan lo traduzcan. Falla cerrado: fuera de READ COMMITTED no se puede apagar
--      (la cuenta no vería una compra recién confirmada). Convive con los disparadores existentes de `ModuloEmpresa` (`ModuloEmpresa_solo_plataforma_*`, 20261004120000): son independientes y los dos rechazan, ninguno cambia la fila.
--   c) Disparador BEFORE INSERT sobre `FacturaProveedorSucursal` cuando `estadoRecepcion = 'PENDIENTE'`: toma `FOR SHARE` la fila ACTIVA de `recepcion_de_compras` de la empresa; si no hay, rechaza (23514, `FacturaProveedorSucursal_modulo_recepcion_chk`).
--      Cierra la carrera «apagar vs cargar una pendiente»: el apagado (UPDATE de la fila) y el FOR SHARE chocan, así que o gana la carga (el apagado, que cuenta DESPUÉS de tomar la fila, ve la pendiente y se rechaza) o gana el apagado (la carga ve el módulo
--      apagado y se rechaza). Nunca quedan el módulo apagado y una pendiente viva. SECURITY DEFINER: `motor2_app` solo tiene SELECT sobre `ModuloEmpresa` y un FOR SHARE exige además un privilegio de escritura.
--
-- PERMISOS: no se agrega ningún GRANT. `motor2_plataforma` sigue sin permisos sobre `FacturaProveedorSucursal` (lo vigila test/arquitectura/grants-igual-a-uso.test.ts); el conteo vive solo en la función del dueño.
-- COSTO: un bloqueo compartido y una lectura por índice en cada carga de una parte pendiente (solo con la recepción separada encendida). Bajo carga: NO VERIFICADO.
-- LÍMITE CONOCIDO: borrar la fila de `ModuloEmpresa` (DELETE) no pasa por acá: solo el dueño puede borrarla (la plataforma no tiene DELETE) y desactivar es siempre un UPDATE (ADR-012 §3).
-- ADITIVA: el código anterior no lo nota (sin pendientes y con el módulo encendido no rechaza nada). Se puede aplicar por adelantado y el Instant Rollback de Vercel sigue siendo seguro.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117125000_compras_guarda_de_apagado`).

-- a) La cuenta de pendientes de una empresa.
CREATE FUNCTION compras_pendientes_de_recepcion(p_empresa text, OUT cantidad integer, OUT sucursales text) RETURNS record
LANGUAGE sql
STABLE
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
  SELECT count(*)::integer,
         COALESCE(string_agg(DISTINCT regexp_replace(s."nombre", '[[:cntrl:]]', ' ', 'g'), ', ' ORDER BY regexp_replace(s."nombre", '[[:cntrl:]]', ' ', 'g')), '')
    FROM public."FacturaProveedorSucursal" p
    JOIN public."FacturaProveedor" f ON f."empresaId" = p."empresaId" AND f."id" = p."facturaProveedorId"
    JOIN public."Sucursal" s ON s."empresaId" = p."empresaId" AND s."id" = p."sucursalId"
   WHERE p."empresaId" = p_empresa AND p."estadoRecepcion" = 'PENDIENTE' AND f."anuladaEn" IS NULL
$$;
REVOKE ALL ON FUNCTION compras_pendientes_de_recepcion(text) FROM PUBLIC;

-- b) Apagar la recepción separada con compras pendientes.
CREATE FUNCTION modulo_empresa_guarda_de_apagado_recepcion() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
DECLARE
  v_cantidad integer;
  v_sucursales text;
BEGIN
  -- Solo importa la fila de la recepción separada que estaba ACTIVA y deja de estarlo: pasa a INACTIVO o cambia de módulo o de empresa (lo mismo que apagarla).
  IF OLD."modulo" <> 'recepcion_de_compras' OR OLD."estado" <> 'ACTIVO'
     OR (NEW."estado" = 'ACTIVO' AND NEW."modulo" = OLD."modulo" AND NEW."empresaId" = OLD."empresaId") THEN
    RETURN NEW;
  END IF;
  -- La cuenta ve lo que está CONFIRMADO en este momento solo en READ COMMITTED (cada consulta toma su foto). En otro nivel podría no ver una compra recién confirmada: ante la duda, no se apaga.
  IF current_setting('transaction_isolation') <> 'read committed' THEN
    RAISE EXCEPTION 'GUARDA_APAGADO_RECEPCION|0|no se puede comprobar si hay compras pendientes fuera de READ COMMITTED'
      USING ERRCODE = '23514', CONSTRAINT = 'ModuloEmpresa_recepcion_pendientes_chk', TABLE = 'ModuloEmpresa';
  END IF;
  -- La fila ya está tomada por este UPDATE; se toma de nuevo A PROPÓSITO antes de contar: una carga de pendiente que tenga el FOR SHARE (disparador c) se espera acá, y lo que cuenta lo que sigue ya la ve confirmada.
  PERFORM 1 FROM public."ModuloEmpresa" WHERE "id" = OLD."id" FOR NO KEY UPDATE;
  SELECT c.cantidad, c.sucursales INTO v_cantidad, v_sucursales FROM compras_pendientes_de_recepcion(OLD."empresaId") c;
  IF v_cantidad IS NULL OR v_cantidad > 0 THEN
    RAISE EXCEPTION 'GUARDA_APAGADO_RECEPCION|%|%', COALESCE(v_cantidad, 0), COALESCE(v_sucursales, '')
      USING ERRCODE = '23514', CONSTRAINT = 'ModuloEmpresa_recepcion_pendientes_chk', TABLE = 'ModuloEmpresa';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION modulo_empresa_guarda_de_apagado_recepcion() FROM PUBLIC;

CREATE TRIGGER "ModuloEmpresa_recepcion_pendientes_chk"
  BEFORE UPDATE ON "ModuloEmpresa"
  FOR EACH ROW EXECUTE FUNCTION modulo_empresa_guarda_de_apagado_recepcion();

-- c) Cargar una parte pendiente con el módulo apagado (o mientras lo apagan).
CREATE FUNCTION factura_proveedor_sucursal_guarda_de_modulo_recepcion() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  PERFORM 1 FROM public."ModuloEmpresa" WHERE "empresaId" = NEW."empresaId" AND "modulo" = 'recepcion_de_compras' AND "estado" = 'ACTIVO' FOR SHARE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'una parte de compra no puede nacer pendiente de recibir con la recepción separada apagada'
      USING ERRCODE = '23514', CONSTRAINT = 'FacturaProveedorSucursal_modulo_recepcion_chk', TABLE = 'FacturaProveedorSucursal';
  END IF;
  RETURN NEW;
END
$$;
REVOKE ALL ON FUNCTION factura_proveedor_sucursal_guarda_de_modulo_recepcion() FROM PUBLIC;

CREATE TRIGGER "FacturaProveedorSucursal_modulo_recepcion_chk"
  BEFORE INSERT ON "FacturaProveedorSucursal"
  FOR EACH ROW WHEN (NEW."estadoRecepcion" = 'PENDIENTE')
  EXECUTE FUNCTION factura_proveedor_sucursal_guarda_de_modulo_recepcion();
