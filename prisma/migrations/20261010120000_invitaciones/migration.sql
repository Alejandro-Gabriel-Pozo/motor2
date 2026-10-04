-- Invitaciones (E5, ADR-012 §6, ADR-020; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con ensayo en una rama de Neon y respaldo previo).
-- La plataforma da de alta una empresa en PROVISIONING y le manda al futuro gerente un enlace de un solo uso. Esta tabla guarda esa invitación: SOLO el hash
-- del token (nunca el token), a quién va, cuándo vence y en qué estado está. «Vencida» NO es un estado guardado: es una PENDIENTE cuyo `venceEn` ya pasó
-- (src/core/features/empresa/invitacion.ts), así no hace falta ningún cron.
--
-- ADITIVA: solo agrega una tabla, un tipo, una función y un trigger. El código viejo la ignora, así que se puede aplicar por adelantado y el Instant Rollback
-- de Vercel sigue siendo seguro.
--
-- Candados que se complementan (ENABLE sin FORCE: el dueño que migra y limpia la base de test los salta):
--  1) RLS, tres políticas:
--     a) `aislamiento_empresa` (FOR ALL): la de siempre, solo la empresa del contexto (`app.empresa_id`). Es la que deja a la app aceptar DENTRO de la empresa.
--     b) `lectura_por_token` (FOR SELECT): la app, que todavía no tiene empresa, lee UNA fila si conoce el hash (`app.invitacion_hash`, local a la
--        transacción, lo fija `dbDeInvitacion`). Sin hash válido no se ve ninguna fila. Mismo patrón que `lectura_propia_usuario`.
--     c) `escritura_plataforma` (FOR ALL): `motor2_plataforma` lee y escribe todas (lista, reenvía, revoca). Se compara por nombre de rol, no con
--        `TO motor2_plataforma`, para no depender de que el rol exista ya en esa base.
--  2) Privilegios: `motor2_app` pierde todo y recupera SELECT más UPDATE solo de las columnas con las que se acepta (estado, aceptadaEn, aceptadaPorId,
--     cuitDeclarado): no puede cambiar email, hash, vencimiento ni empresa, ni insertar ni borrar. `motor2_plataforma`: SELECT, INSERT, UPDATE, sin DELETE.
--  3) Trigger `proteger_invitacion()`: la máquina de estados por rol. El dueño pasa. `motor2_plataforma` solo puede insertar PENDIENTE y, desde PENDIENTE,
--     dejarla PENDIENTE (rotar el token al reenviar, marcar el envío) o REVOCADA, sin tocar lo de la aceptación. Cualquier otro rol solo puede pasar
--     PENDIENTE → ACEPTADA, sin tocar nada más que `aceptada*` y `cuitDeclarado`. El trigger NO mira el reloj: el vencimiento lo controla el código con su
--     `ahora` (para que los tests puedan mover el reloj).
--  4) Índices únicos parciales a mano (Prisma no los expresa): una sola invitación PENDIENTE por (empresa, email) y una sola PENDIENTE de gerente por empresa.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261010120000_invitaciones`).

-- CreateEnum
CREATE TYPE "EstadoInvitacion" AS ENUM ('PENDIENTE', 'ACEPTADA', 'REVOCADA');

-- CreateTable
CREATE TABLE "Invitacion" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "email" TEXT NOT NULL,
    "rolEmpresa" TEXT NOT NULL,
    "hashToken" TEXT NOT NULL,
    "estado" "EstadoInvitacion" NOT NULL DEFAULT 'PENDIENTE',
    "venceEn" TIMESTAMP(3) NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "enviadaEn" TIMESTAMP(3),
    "aceptadaEn" TIMESTAMP(3),
    "aceptadaPorId" TEXT,
    "cuitDeclarado" TEXT,
    "revocadaEn" TIMESTAMP(3),

    CONSTRAINT "Invitacion_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "Invitacion_email_canonico_check" CHECK ("email" = lower(btrim("email")) AND length("email") > 0),
    CONSTRAINT "Invitacion_rol_check" CHECK ("rolEmpresa" = 'gerente'),
    CONSTRAINT "Invitacion_hash_check" CHECK ("hashToken" ~ '^[0-9a-f]{64}$'),
    CONSTRAINT "Invitacion_cuit_check" CHECK ("cuitDeclarado" IS NULL OR "cuitDeclarado" ~ '^[0-9]{11}$'),
    CONSTRAINT "Invitacion_aceptada_coherente_check" CHECK (("estado" = 'ACEPTADA') = ("aceptadaEn" IS NOT NULL AND "aceptadaPorId" IS NOT NULL)),
    CONSTRAINT "Invitacion_revocada_coherente_check" CHECK (("estado" = 'REVOCADA') = ("revocadaEn" IS NOT NULL)),
    CONSTRAINT "Invitacion_cuit_solo_aceptada_check" CHECK ("cuitDeclarado" IS NULL OR "estado" = 'ACEPTADA')
);

-- CreateIndex
CREATE UNIQUE INDEX "Invitacion_hashToken_key" ON "Invitacion"("hashToken");

-- CreateIndex
CREATE INDEX "Invitacion_empresaId_creadaEn_idx" ON "Invitacion"("empresaId", "creadaEn");

-- Índices parciales (a mano, como "UsuarioEmpresa_empresaId_gerente_key")
CREATE UNIQUE INDEX "Invitacion_empresaId_email_pendiente_key" ON "Invitacion"("empresaId", "email") WHERE "estado" = 'PENDIENTE';
CREATE UNIQUE INDEX "Invitacion_empresaId_gerente_pendiente_key" ON "Invitacion"("empresaId") WHERE "estado" = 'PENDIENTE' AND "rolEmpresa" = 'gerente';

-- AddForeignKey
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_aceptadaPorId_fkey" FOREIGN KEY ("aceptadaPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Candado 1) RLS
ALTER TABLE "Invitacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Invitacion"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY lectura_por_token ON "Invitacion" FOR SELECT
  USING ("hashToken" = NULLIF(current_setting('app.invitacion_hash', true), ''));
CREATE POLICY escritura_plataforma ON "Invitacion" FOR ALL
  USING (current_user = 'motor2_plataforma')
  WITH CHECK (current_user = 'motor2_plataforma');

-- Candado 2) Privilegios (si los roles existen: en una base de test o recién creada pueden no estar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "Invitacion" FROM motor2_app;
    GRANT SELECT ON "Invitacion" TO motor2_app;
    GRANT UPDATE ("estado", "aceptadaEn", "aceptadaPorId", "cuitDeclarado") ON "Invitacion" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "Invitacion" FROM motor2_plataforma;
    GRANT SELECT, INSERT, UPDATE ON "Invitacion" TO motor2_plataforma;
  END IF;
END
$$;

-- Candado 3) Trigger: la máquina de estados por rol
CREATE FUNCTION proteger_invitacion() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- El dueño de la tabla (migra, corrige, limpia la base de test) queda exento a propósito: un dueño siempre puede apagar un trigger.
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

  -- Cualquier otro rol (la app): únicamente aceptar una PENDIENTE, sin tocar nada más que lo de la aceptación.
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

CREATE TRIGGER "Invitacion_proteger_fila"
  BEFORE INSERT OR UPDATE OR DELETE ON "Invitacion"
  FOR EACH ROW EXECUTE FUNCTION proteger_invitacion();

CREATE TRIGGER "Invitacion_proteger_truncate"
  BEFORE TRUNCATE ON "Invitacion"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_invitacion();
