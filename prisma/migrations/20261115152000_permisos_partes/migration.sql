-- Migración de DATOS (no cambia el esquema) — Parte, etapa P1 (b) (docs/diseno-parte-ficha-unica-2026-11-15.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia): alta de las tres claves
-- de la ficha única de personas y empresas (decisión del dueño D10, 2026-11-12: «Lo mismo que Pedernal»: el operario busca, da de alta y edita; solo el administrador o el gerente desactiva):
--   partes_ver         proveedores_basico  EMPRESA  piso operario       clase O  semilla admin   ver y buscar fichas
--   partes_editar      proveedores_basico  EMPRESA  piso operario       clase O  semilla admin   dar de alta y editar fichas
--   partes_desactivar  proveedores_basico  EMPRESA  piso administrador clase A  semilla admin   desactivar y reactivar fichas
-- Todo nace cerrado (2026-11-11): es lo que una empresa que nace HOY recibe del alta (la semilla de `ACCIONES`): SOLO el rol de clave `admin` de cada empresa (por la clave estable, nunca por el nombre). Nadie más recibe nada (ni el operador ni un rol propio):
-- el gerente las delega en la matriz de permisos a quien quiera, sin migración (el piso de ver y editar es el de Pedernal: un operario puede tenerlas).
--
-- Fase EXPANDIR y aditiva: el código anterior ignora las claves nuevas, así que se puede aplicar antes del deploy. Se inserta con el `empresaId` de la fila del rol (la migración corre como DUEÑO, sin RLS, y `app_empresa_actual()`
-- devuelve NULL sin contexto). El `ON CONFLICT` no pisa una fila ya configurada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal).
-- Idempotente. Reversa: down.sql (a mano, como dueño; ABORTA si alguien configuró algo a mano sobre las claves además de la semilla).

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('partes_ver', 'Ver y buscar las fichas de personas y empresas'),
  ('partes_editar', 'Dar de alta y editar fichas de personas y empresas'),
  ('partes_desactivar', 'Desactivar y reactivar fichas de personas y empresas')
ON CONFLICT ("clave") DO NOTHING;

-- Las tres: solo el administrador de sistema de cada empresa.
INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('partes_ver'), ('partes_editar'), ('partes_desactivar')) AS a("clave")
WHERE r."clave" = 'admin'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
