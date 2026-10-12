-- Reversa de 20261014110000_rls_sucursal_b1_funciones. Borra app_sucursales_lectura() y app_sucursales_escritura(); no toca datos. Bajar ANTES B6, B5, B4, B3 y B2: si queda una política que las usa, el DROP falla.
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014110000_rls_sucursal_b1_funciones`.
-- Con el código nuevo publicado, bajar B2 a B6 y B1 deja la app andando: la RLS por empresa queda intacta y el código solo fija variables que, sin las funciones, nadie lee.

-- M.3 RLS por sucursal: reversa de las funciones del alcance.
DROP FUNCTION IF EXISTS app_sucursales_lectura();
DROP FUNCTION IF EXISTS app_sucursales_escritura();
