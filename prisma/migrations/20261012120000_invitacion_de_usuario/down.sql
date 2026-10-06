-- Reversa de 20261012120000_invitacion_de_usuario. Como dueño, a mano.
-- ADVERTENCIA: se pierden las invitaciones de usuario y de vinculación (los enlaces ya enviados dejan de servir) y sus sucursales. Antes: guardar
-- `SELECT id, "empresaId", email, "rolEmpresa", estado FROM "Invitacion" WHERE "rolEmpresa" <> 'gerente'`. Volver primero el código (Instant Rollback) y recién después correr esto.
-- Después: `prisma migrate resolve --rolled-back 20261012120000_invitacion_de_usuario`.
DROP TABLE IF EXISTS "InvitacionSucursal";
DROP FUNCTION IF EXISTS proteger_invitacion_sucursal();

DELETE FROM "Invitacion" WHERE "rolEmpresa" <> 'gerente';

ALTER TABLE "Invitacion" DROP CONSTRAINT IF EXISTS "Invitacion_cuit_solo_gerente_check";
ALTER TABLE "Invitacion" DROP CONSTRAINT IF EXISTS "Invitacion_invitador_check";
ALTER TABLE "Invitacion" DROP CONSTRAINT IF EXISTS "Invitacion_invitadoPorId_fkey";
DROP INDEX IF EXISTS "Invitacion_empresaId_id_key";
ALTER TABLE "Invitacion" DROP COLUMN IF EXISTS "invitadoPorId";
ALTER TABLE "Invitacion" DROP CONSTRAINT "Invitacion_rol_check";
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_rol_check" CHECK ("rolEmpresa" = 'gerente');

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE INSERT ON "Invitacion" FROM motor2_app;
    REVOKE UPDATE ("hashToken", "venceEn", "enviadaEn", "revocadaEn") ON "Invitacion" FROM motor2_app;
  END IF;
END
$$;

-- La función anterior (E5): la máquina de estados solo para gerente.
CREATE OR REPLACE FUNCTION proteger_invitacion() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;

  IF current_user = 'motor2_plataforma' THEN
    IF TG_OP = 'INSERT' AND NEW."estado" = 'PENDIENTE' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE'
       AND OLD."estado" = 'PENDIENTE'
       AND NEW."estado" IN ('PENDIENTE', 'REVOCADA')
       AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa"
       AND NEW."aceptadaEn" IS NULL AND NEW."aceptadaPorId" IS NULL AND NEW."cuitDeclarado" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invitacion: % no permitido para la plataforma (solo crear PENDIENTE, reenviar o revocar una PENDIENTE)', TG_OP;
  END IF;

  IF TG_OP = 'UPDATE'
     AND OLD."estado" = 'PENDIENTE' AND NEW."estado" = 'ACEPTADA'
     AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa"
     AND NEW."hashToken" = OLD."hashToken" AND NEW."venceEn" = OLD."venceEn" AND NEW."creadaEn" = OLD."creadaEn"
     AND NEW."enviadaEn" IS NOT DISTINCT FROM OLD."enviadaEn" AND NEW."revocadaEn" IS NOT DISTINCT FROM OLD."revocadaEn" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invitacion: % no permitido para el rol % (solo se puede aceptar una PENDIENTE)', TG_OP, current_user;
END;
$$;
