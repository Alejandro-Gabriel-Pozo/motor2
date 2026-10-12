-- RLS por sucursal, B6: receta y auditoría (Paquete 1; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Versiones de receta y registro de auditoría (con sucursal, o de la empresa entera si sucursalId es NULL) y las filas hijas de la receta (ingredientes, pasos, ingredientes de paso y sustitutos).
-- Crea 4 políticas RESTRICTIVE TO motor2_app (SELECT, INSERT, UPDATE, DELETE) en cada una de 6 tablas (24 en total), con el alcance que fija app_sucursales_lectura()/app_sucursales_escritura() (B1). Se combinan con AND
-- con aislamiento_empresa. Sin alcance en la transacción no se ve ni se escribe ninguna fila de estas tablas (falla cerrado; un INSERT da 42501). Requiere B1 aplicada y que el rol motor2_app exista
-- (scripts/operaciones/crear-rol-motor2-app.sql): sin él, CREATE POLICY falla y la migración no se aplica.
-- El código de la app fija el alcance desde A2 (src/server/sesion/base.ts). El código ANTERIOR a A2 solo fija la empresa: con estas políticas no vería filas de estas tablas.
-- NO borra ni modifica datos; solo agrega políticas. No cambia grants.
-- El SQL es EXACTAMENTE la salida de sqlDePoliticasDeAlcance([...]) para estas tablas; test/arquitectura/migraciones-de-alcance-de-sucursal.test.ts lo exige.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261014160000_rls_sucursal_b6_receta_y_auditoria`). Sin políticas la app vuelve a ver todo lo de su empresa.
-- Se baja ANTES que B1.

-- M.3 RLS por sucursal: políticas RESTRICTIVE por comando, TO motor2_app (generado por test/setup/politicas-de-alcance-de-sucursal.ts; no editar a mano).
-- RecetaIngrediente
CREATE POLICY alcance_sucursal_select ON "RecetaIngrediente" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_insert ON "RecetaIngrediente" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_update ON "RecetaIngrediente" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))))
  WITH CHECK ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_delete ON "RecetaIngrediente" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));

-- RecetaPaso
CREATE POLICY alcance_sucursal_select ON "RecetaPaso" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_insert ON "RecetaPaso" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_update ON "RecetaPaso" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))))
  WITH CHECK ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));
CREATE POLICY alcance_sucursal_delete ON "RecetaPaso" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL))));

-- RecetaPasoIngrediente
CREATE POLICY alcance_sucursal_select ON "RecetaPasoIngrediente" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_insert ON "RecetaPasoIngrediente" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_update ON "RecetaPasoIngrediente" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))))
  WITH CHECK ("recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_delete ON "RecetaPasoIngrediente" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("recetaPasoId" IN (SELECT "id" FROM "RecetaPaso" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));

-- RecetaVersion
CREATE POLICY alcance_sucursal_select ON "RecetaVersion" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_insert ON "RecetaVersion" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_update ON "RecetaVersion" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_delete ON "RecetaVersion" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));

-- RegistroAuditoria
CREATE POLICY alcance_sucursal_select ON "RegistroAuditoria" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_insert ON "RegistroAuditoria" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_update ON "RegistroAuditoria" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))
  WITH CHECK (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));
CREATE POLICY alcance_sucursal_delete ON "RegistroAuditoria" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING (("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)));

-- SustitutoRecetaIngrediente
CREATE POLICY alcance_sucursal_select ON "SustitutoRecetaIngrediente" AS RESTRICTIVE FOR SELECT TO motor2_app
  USING ("recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_lectura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_lectura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_insert ON "SustitutoRecetaIngrediente" AS RESTRICTIVE FOR INSERT TO motor2_app
  WITH CHECK ("recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_update ON "SustitutoRecetaIngrediente" AS RESTRICTIVE FOR UPDATE TO motor2_app
  USING ("recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))))
  WITH CHECK ("recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));
CREATE POLICY alcance_sucursal_delete ON "SustitutoRecetaIngrediente" AS RESTRICTIVE FOR DELETE TO motor2_app
  USING ("recetaIngredienteId" IN (SELECT "id" FROM "RecetaIngrediente" WHERE "recetaVersionId" IN (SELECT "id" FROM "RecetaVersion" WHERE ("sucursalId" = ANY((SELECT app_sucursales_escritura())::text[]) OR ("sucursalId" IS NULL AND (SELECT app_sucursales_escritura()) IS NOT NULL)))));
