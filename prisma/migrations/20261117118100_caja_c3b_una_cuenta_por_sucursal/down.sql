-- Reversa de 20261117118100_caja_c3b_una_cuenta_por_sucursal (A MANO, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117118100_caja_c3b_una_cuenta_por_sucursal`).
-- Solo borra el índice único parcial: la sucursal vuelve a poder tener varias cuentas activas. No pierde ningún dato. Bajarla dos veces no falla.
DROP INDEX IF EXISTS "CuentaDeCobro_una_activa_por_sucursal_key";
