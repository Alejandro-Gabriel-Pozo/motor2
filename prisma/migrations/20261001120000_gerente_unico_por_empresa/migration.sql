-- Migración de DATOS (no cambia el esquema): cada empresa tiene UN solo gerente (`UsuarioEmpresa.rolEmpresa = 'gerente'`), decisión del dueño
-- (2026-09-30): la jerarquía es operario < administrador < gerente (uno por empresa) < plataforma. La regla se hace cumplir en el código
-- (nunca queda la empresa sin gerente ni con dos; el traspaso lo hace el gerente o la plataforma). El índice único en la base es una fase
-- posterior (cambia el esquema, necesita autorización expresa).
--
-- 1) Si una empresa ya tiene más de un gerente (un dato anterior a la regla), queda el más antiguo; los demás pasan a no tener rol de empresa.
-- 2) Si una empresa no tiene ninguno, lo es quien la creó: su admin activo más antiguo (la primera pertenencia de sucursal con el rol admin
--    activo, de una persona con la pertenencia a la empresa activa). En desarrollo es alepogabriel@gmail.com.
--
-- Corre como dueño de las tablas (sin RLS): las dos sentencias agrupan por `empresaId`, nada cruza de una empresa a otra. Idempotente: una
-- segunda corrida no encuentra nada que cambiar.

UPDATE "UsuarioEmpresa" ue
SET "rolEmpresa" = NULL
WHERE ue."rolEmpresa" = 'gerente'
  AND EXISTS (
    SELECT 1 FROM "UsuarioEmpresa" otro
    WHERE otro."empresaId" = ue."empresaId"
      AND otro."rolEmpresa" = 'gerente'
      AND (otro."creadoEn", otro."id") < (ue."creadoEn", ue."id")
  );

UPDATE "UsuarioEmpresa" ue
SET "rolEmpresa" = 'gerente'
FROM (
  SELECT DISTINCT ON (us."empresaId") us."empresaId", us."usuarioId"
  FROM "UsuarioSucursal" us
  JOIN "Rol" r ON r."id" = us."rolId" AND r."empresaId" = us."empresaId"
  JOIN "UsuarioEmpresa" pert ON pert."usuarioId" = us."usuarioId" AND pert."empresaId" = us."empresaId" AND pert."activo"
  WHERE us."activo" AND r."nombre" = 'admin' AND r."activo"
  ORDER BY us."empresaId", us."creadoEn" ASC, us."id" ASC
) candidato
WHERE ue."usuarioId" = candidato."usuarioId"
  AND ue."empresaId" = candidato."empresaId"
  AND NOT EXISTS (
    SELECT 1 FROM "UsuarioEmpresa" g
    WHERE g."empresaId" = ue."empresaId" AND g."rolEmpresa" = 'gerente'
  );
