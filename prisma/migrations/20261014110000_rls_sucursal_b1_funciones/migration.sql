-- RLS por sucursal, B1: funciones del alcance de la transacción (Paquete 1; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Crea app_sucursales_lectura() y app_sucursales_escritura() (text[], STABLE, SECURITY INVOKER): leen las variables locales a la transacción app.sucursales_lectura / app.sucursales_escritura
-- y devuelven NULL si falta o está vacía (falla cerrado: sin alcance no se ve ni se escribe ninguna fila). Las políticas de B2 a B6 las usan.
-- No cambia ningún comportamiento por sí sola: sin políticas que las llamen, las funciones no filtran nada. NO es destructiva. Se aplica ANTES de B2 a B6.
-- El SQL es EXACTAMENTE la salida de sqlDeFuncionesDeAlcance() (test/setup/politicas-de-alcance-de-sucursal.ts); test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Junto con esta migración, el código pasa EXIGIR_ROL_DE_LA_APP a true (src/server/sesion/base.ts): la app se niega a operar con un rol que no sea motor2_app (ni miembro). Antes de aplicar, confirmar
-- que el usuario de DATABASE_URL de la base es motor2_app.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261014110000_rls_sucursal_b1_funciones`). VA ÚLTIMA en la reversa:
-- bajar antes B6, B5, B4, B3 y B2 (una política en uso impide borrar la función).

-- M.3 RLS por sucursal: funciones del alcance de la transacción (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- Devuelven NULL si la variable falta o está vacía: sin alcance no se ve ni se escribe ninguna fila (falla cerrado).
CREATE OR REPLACE FUNCTION app_sucursales_escritura() RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ',')
$$;

COMMENT ON FUNCTION app_sucursales_escritura() IS 'M.3: sucursales donde la transacción puede escribir (app.sucursales_escritura, local a la transacción) y NULL sin alcance.';

CREATE OR REPLACE FUNCTION app_sucursales_lectura() RETURNS text[]
LANGUAGE sql STABLE
AS $$
  SELECT NULLIF(
    COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_lectura', true), ''), ','), '{}'::text[])
    || COALESCE(string_to_array(NULLIF(current_setting('app.sucursales_escritura', true), ''), ','), '{}'::text[]),
    '{}'::text[])
$$;

COMMENT ON FUNCTION app_sucursales_lectura() IS 'M.3: sucursales que la transacción puede leer = lectura (app.sucursales_lectura) más escritura, y NULL sin alcance.';
