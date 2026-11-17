-- Caja y cobro, etapa C3b: UNA SOLA cuenta de cobro ACTIVA por sucursal (docs/diseno-caja-c3-cuenta-de-cobro-y-marcas-2026-11-16.md, Q-C3-6). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- Decisión del dueño (2026-11-16, chat con el orquestador general): a «¿una cuenta de cobro por sucursal quiere decir una sola cuenta por sucursal, o que cada cuenta pertenece a una sucursal pudiendo haber varias?» respondió «Por ahora es lo primero».
-- Supuesto declarado (el dueño lo corrige): se puede desactivar una cuenta y crear (o reactivar) otra; las inactivas no cuentan y el historial no se borra.
--
-- QUÉ: UN índice único PARCIAL sobre "CuentaDeCobro" ("empresaId", "sucursalId") WHERE "activa". Nada más: ninguna columna, ninguna fila y ninguna función cambian. Es ADITIVA y reversible (down.sql); el código anterior sigue andando (solo se vuelve más estricto el alta).
-- No lo expresa Prisma (índice parcial): vive solo acá y se documenta en schema.prisma.
-- Si ya hay una sucursal con más de una cuenta activa la creación del índice FALLA (23505) y no cambia nada: correr ANTES verificacion-previa.sql y desactivar las sobrantes.
-- La app ya tiene los privilegios necesarios (INSERT y UPDATE de "activa" y "sucursalId" de C3): no hay GRANT nuevo.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117118100_caja_c3b_una_cuenta_por_sucursal`).

CREATE UNIQUE INDEX "CuentaDeCobro_una_activa_por_sucursal_key" ON "CuentaDeCobro"("empresaId", "sucursalId") WHERE "activa";
