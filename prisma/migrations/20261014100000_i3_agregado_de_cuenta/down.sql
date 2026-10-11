-- Reversa de 20261014100000_i3_agregado_de_cuenta. DESTRUCTIVA: se pierden los comprobantes de idempotencia del salón (contar las filas antes: `SELECT count(*) FROM "AgregadoDeCuenta"`).
-- A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1 -f down.sql`; después `npx prisma migrate resolve --rolled-back 20261014100000_i3_agregado_de_cuenta`.
-- Si ya están las políticas de alcance de sucursal de B4, bajar B4 ANTES de esta (la reversa de B4 las borra).
DROP TABLE IF EXISTS "AgregadoDeCuenta";
