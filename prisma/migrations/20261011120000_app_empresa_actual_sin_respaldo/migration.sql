-- app_empresa_actual() sin respaldo (ADR-022; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con ensayo en una rama de Neon y respaldo previo).
-- Antes: la empresa fijada por la transacción (`app.empresa_id`) o, sin contexto, la ÚNICA empresa ACTIVE (migración 20260929100000_multiempresa_estructura, paso 3).
-- Ahora: SOLO la empresa fijada por la transacción. Sin contexto es NULL: el DEFAULT de `empresaId` (53 tablas) hace fallar el alta por NOT NULL y las políticas
-- `aislamiento_empresa` (56 tablas) no muestran nada. Una instalación puede tener cualquier cantidad de empresas activas sin que cambie ningún comportamiento.
--
-- NO es aditiva: el código desplegado antes de `dbDeUsuario` (commit 8f22f96) dependía del respaldo para el login. Cualquier despliegue posterior no lo usa, así que el
-- Instant Rollback es seguro hacia ellos. Mantiene nombre, firma y volatilidad: los DEFAULT y las políticas siguen apuntando a la función sin cambios (`prisma migrate diff` da vacío).
-- Reversa: down.sql (una sentencia; después `prisma migrate resolve --rolled-back 20261011120000_app_empresa_actual_sin_respaldo`).
CREATE OR REPLACE FUNCTION app_empresa_actual() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(current_setting('app.empresa_id', true), '')
$$;

COMMENT ON FUNCTION app_empresa_actual() IS 'ADR-022: empresa del contexto (app.empresa_id, local a la transacción); NULL sin contexto. Sin respaldo de «la única empresa activa».';
