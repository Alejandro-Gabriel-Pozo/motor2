-- M0-IVA (Paquete 2, fase EXPANDIR; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Condición de la empresa frente al IVA: `Empresa.condicionIva`, código semántico de lista cerrada en la base (TEXT + CHECK, como `Invitacion_rol_check`): ampliar la lista es ampliar el CHECK.
-- NULL significa «no declarada»: ninguna fila existente recibe un valor deducido (sin default y sin backfill). Quien la lea tiene que FALLAR CERRADO con un error explícito, nunca suponer
-- Responsable Inscripto. Sin CHECK de obligatoriedad (ni siquiera NOT VALID: Postgres también lo evalúa al actualizar una fila vieja).
-- La carga del valor real NO es parte de esta migración: es un paso de datos aparte, con simulación primero, autorización propia y auditoría en `AuditoriaPlataforma`
-- (scripts/operaciones/m0-iva-condicion-de-la-empresa.sql). Escribe la plataforma (`motor2_plataforma`), no la propia empresa: `Empresa` no cambia de autor (guardián
-- `test/arquitectura/politica-de-empresa-solo-plataforma.test.ts`).
-- ADITIVA: el código anterior no lee ni escribe la columna. Sin RLS nuevo (`Empresa` es de clase EMPRESA) ni GRANT nuevo: `motor2_app` sigue solo con SELECT en producción y
-- `motor2_plataforma` ya tiene UPDATE de tabla sobre `Empresa`.
-- ADD COLUMN sin default solo toca el catálogo; validar el CHECK recorre las filas de `Empresa`. Aplicar sin tráfico y con `lock_timeout` corto.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261015101000_m0_iva_condicion_de_la_empresa`).

ALTER TABLE "Empresa" ADD COLUMN "condicionIva" TEXT;

ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_condicionIva_check"
  CHECK ("condicionIva" IS NULL OR "condicionIva" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'));
