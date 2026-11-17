-- Roles propios por empresa: la perilla `Empresa.rolesPropiosMax` (frente 4, etapa P2; «como pedernal,», 2026-11-16: «empresa nueva: sin roles propios hasta que el dueño suba la perilla, base 0»). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base.
-- Es el tope de roles PROPIOS (clave NULL) ACTIVOS que la empresa puede tener: crear uno nuevo o reactivar uno archivado exige `activos < rolesPropiosMax` (lo hace el servidor, en una transacción con un candado por empresa). La sube o la baja SOLO la plataforma, por `scripts/politica-empresa.ts`.
--
-- ADITIVA: agrega una columna NOT NULL DEFAULT 0 (Postgres la llena sola para las empresas existentes) y un CHECK. El código viejo la ignora, así que se puede aplicar por adelantado.
-- Efecto en el uso (declarado, no oculto): TODA empresa, incluidas las existentes, queda en 0: conserva los roles propios que ya tiene (nada se desactiva ni se edita) pero NO puede crear ni reactivar otros hasta que la plataforma suba el valor.
-- Privilegios: `motor2_plataforma` ya tiene UPDATE sobre "Empresa"; `motor2_app` sigue solo con lectura. No cambia ninguno.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261117100100_roles_propios_max`).

ALTER TABLE "Empresa" ADD COLUMN "rolesPropiosMax" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_rolesPropiosMax_check" CHECK ("rolesPropiosMax" >= 0 AND "rolesPropiosMax" <= 1000);
