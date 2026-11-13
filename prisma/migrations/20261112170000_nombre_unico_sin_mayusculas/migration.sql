-- «NOMBRE ÚNICO SIN DISTINGUIR MAYÚSCULAS» (paso 11 de la auditoría de primitivas, docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md §8, riesgos R2 y R3; el dueño autorizó el paso el 2026-11-12:
-- «TENES MI AUTORIZACIÓN»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo):
-- la app ya rechaza un cliente o una sección de carta con el mismo nombre de otro «sin importar mayúsculas», pero la base solo lo impedía con la misma capitalización:
-- dos altas simultáneas («Pepe» y «pepe») pasaban las dos. Los índices únicos sobre lower(nombre) cierran esa carrera en la base.
--  - "Cliente": único por (empresaId, lower(nombre)).
--  - "SeccionCarta": único por (empresaId, lower(nombre)).
-- Los únicos de siempre ((empresaId, nombre)) se quedan: este es más estricto, no los reemplaza.
-- Verificado en solo lectura el 2026-11-12 contra las dos bases de producción (zuluhub y stockhneuquen): ninguna empresa tiene dos nombres iguales sin distinguir mayúsculas.
-- ADITIVA: el código anterior sigue funcionando (solo se rechaza lo que ya rechazaba, ahora también en la carrera). Si hubiera duplicados, el CREATE UNIQUE INDEX falla y la migración aborta sin dejar nada.
-- Reversa: down.sql (a mano, como dueño; idempotente).

CREATE UNIQUE INDEX "Cliente_empresaId_nombre_lower_key" ON "Cliente" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "SeccionCarta_empresaId_nombre_lower_key" ON "SeccionCarta" ("empresaId", lower("nombre"));
