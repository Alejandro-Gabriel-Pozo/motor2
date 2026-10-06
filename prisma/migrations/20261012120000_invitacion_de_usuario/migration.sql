-- Invitación de usuario (E8, ADR-024; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon).
-- Sin `allowDangerousEmailAccountLinking`, un User que ya existe no puede entrar con Google. Para sumar gente a una empresa se agrega la invitación POR USUARIO: un gestor con
-- `gestion_usuarios` invita a un email, la persona acepta con SU cuenta de Google y recién ahí se crean sus membresías. Esta migración habilita eso en `Invitacion` y agrega
-- las sucursales (y el rol en cada una) que da cada invitación.
--
-- Tres TIPOS de invitación, en la columna `rolEmpresa` que ya existe (sigue siendo TEXT NOT NULL: así el código anterior, tras un Instant Rollback, no rompe al leer filas):
--   `gerente`      la de E5 (la crea la plataforma; abre la vía 3 del login con la empresa en alta y se acepta con el CUIT).
--   `usuario`      sumar a alguien que NO es miembro de la empresa (la crea un gestor de la app; trae sucursales y roles en `InvitacionSucursal`).
--   `vinculacion`  vincular la cuenta de Google de un User que YA es miembro y todavía no entró (un precargado). No abre ninguna vía de ingreso.
--
-- ADITIVA en lo funcional: el código anterior nunca inserta ni lee estas filas. La consola filtra `rolEmpresa = 'gerente'` ANTES de esta migración (E8 paso 2).
--
-- Cambios:
--  1) `Invitacion`: el CHECK de tipo admite los tres; `invitadoPorId` (FK a User, obligatorio salvo en `gerente`); el CUIT solo existe en las de `gerente`; índice único
--     (empresaId, id) para la clave foránea compuesta de la tabla hija.
--  2) `InvitacionSucursal` (nueva): una fila por sucursal y rol de una invitación `usuario`. Claves foráneas COMPUESTAS por empresa: invitación, sucursal y rol son de la misma
--     empresa por construcción. RLS `aislamiento_empresa`. La app inserta y actualiza (rol, notas, quién otorgó), sin DELETE; la plataforma no la toca. Un trigger exige que la
--     madre sea una `usuario` PENDIENTE y prohíbe mover la fila a otra invitación, sucursal o empresa.
--  3) Privilegios de `motor2_app` sobre `Invitacion`: ahora también INSERT y UPDATE de las columnas con las que se rota, se anota el envío y se revoca (sin DELETE).
--  4) `proteger_invitacion()`: la app solo inserta/rota/revoca invitaciones `usuario` y `vinculacion` y acepta cualquiera (como antes); `motor2_plataforma` queda limitada a `gerente`.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261012120000_invitacion_de_usuario`).

-- 1) Invitacion
ALTER TABLE "Invitacion" DROP CONSTRAINT "Invitacion_rol_check";
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_rol_check" CHECK ("rolEmpresa" IN ('gerente', 'usuario', 'vinculacion'));

ALTER TABLE "Invitacion" ADD COLUMN "invitadoPorId" TEXT;
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_invitadoPorId_fkey" FOREIGN KEY ("invitadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_invitador_check" CHECK (("rolEmpresa" = 'gerente') = ("invitadoPorId" IS NULL));
ALTER TABLE "Invitacion" ADD CONSTRAINT "Invitacion_cuit_solo_gerente_check" CHECK ("cuitDeclarado" IS NULL OR "rolEmpresa" = 'gerente');

CREATE UNIQUE INDEX "Invitacion_empresaId_id_key" ON "Invitacion"("empresaId", "id");

-- 2) InvitacionSucursal
CREATE TABLE "InvitacionSucursal" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "invitacionId" TEXT NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "rolId" TEXT NOT NULL,
    "notas" TEXT,
    "invitadoPorId" TEXT NOT NULL,
    "creadaEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "InvitacionSucursal_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "InvitacionSucursal_invitacionId_sucursalId_key" ON "InvitacionSucursal"("invitacionId", "sucursalId");

ALTER TABLE "InvitacionSucursal" ADD CONSTRAINT "InvitacionSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvitacionSucursal" ADD CONSTRAINT "InvitacionSucursal_empresaId_invitacionId_fkey" FOREIGN KEY ("empresaId", "invitacionId") REFERENCES "Invitacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvitacionSucursal" ADD CONSTRAINT "InvitacionSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvitacionSucursal" ADD CONSTRAINT "InvitacionSucursal_empresaId_rolId_fkey" FOREIGN KEY ("empresaId", "rolId") REFERENCES "Rol"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "InvitacionSucursal" ADD CONSTRAINT "InvitacionSucursal_invitadoPorId_fkey" FOREIGN KEY ("invitadoPorId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "InvitacionSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "InvitacionSucursal"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- 3) Privilegios (si los roles existen: en una base de test o recién creada pueden no estar)
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT INSERT ON "Invitacion" TO motor2_app;
    GRANT UPDATE ("hashToken", "venceEn", "enviadaEn", "revocadaEn", "invitadoPorId") ON "Invitacion" TO motor2_app;
    REVOKE ALL ON "InvitacionSucursal" FROM motor2_app;
    GRANT SELECT, INSERT ON "InvitacionSucursal" TO motor2_app;
    GRANT UPDATE ("rolId", "notas", "invitadoPorId") ON "InvitacionSucursal" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "InvitacionSucursal" FROM motor2_plataforma;
  END IF;
END
$$;

-- 4) Trigger de la máquina de estados, ahora por TIPO de invitación
CREATE OR REPLACE FUNCTION proteger_invitacion() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  -- El dueño de la tabla (migra, corrige, limpia la base de test) queda exento a propósito: un dueño siempre puede apagar un trigger.
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;

  -- La plataforma solo maneja las invitaciones de gerente.
  IF current_user = 'motor2_plataforma' THEN
    IF TG_OP = 'INSERT' AND NEW."estado" = 'PENDIENTE' AND NEW."rolEmpresa" = 'gerente' THEN RETURN NEW; END IF;
    IF TG_OP = 'UPDATE'
       AND OLD."rolEmpresa" = 'gerente'
       AND OLD."estado" = 'PENDIENTE'
       AND NEW."estado" IN ('PENDIENTE', 'REVOCADA')
       AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa"
       AND NEW."aceptadaEn" IS NULL AND NEW."aceptadaPorId" IS NULL AND NEW."cuitDeclarado" IS NULL THEN
      RETURN NEW;
    END IF;
    RAISE EXCEPTION 'Invitacion: % no permitido para la plataforma (solo crear PENDIENTE de gerente, reenviar o revocar una PENDIENTE de gerente)', TG_OP;
  END IF;

  -- Cualquier otro rol (la app).
  -- Crear: solo invitaciones de usuario o de vinculación, PENDIENTES, con quién invita y sin marcas de aceptación, revocación, envío ni CUIT.
  IF TG_OP = 'INSERT'
     AND NEW."rolEmpresa" IN ('usuario', 'vinculacion') AND NEW."estado" = 'PENDIENTE' AND NEW."invitadoPorId" IS NOT NULL
     AND NEW."aceptadaEn" IS NULL AND NEW."aceptadaPorId" IS NULL AND NEW."cuitDeclarado" IS NULL
     AND NEW."revocadaEn" IS NULL AND NEW."enviadaEn" IS NULL THEN
    RETURN NEW;
  END IF;
  -- Rotar el token / anotar el envío / volver a firmar: PENDIENTE → PENDIENTE, sin tocar quién, a dónde ni el tipo.
  IF TG_OP = 'UPDATE'
     AND OLD."rolEmpresa" IN ('usuario', 'vinculacion') AND OLD."estado" = 'PENDIENTE' AND NEW."estado" = 'PENDIENTE'
     AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa" AND NEW."creadaEn" = OLD."creadaEn"
     AND NEW."invitadoPorId" IS NOT NULL
     AND NEW."aceptadaEn" IS NULL AND NEW."aceptadaPorId" IS NULL AND NEW."cuitDeclarado" IS NULL AND NEW."revocadaEn" IS NULL THEN
    RETURN NEW;
  END IF;
  -- Revocar: PENDIENTE → REVOCADA, sin tocar el token, el vencimiento ni lo demás.
  IF TG_OP = 'UPDATE'
     AND OLD."rolEmpresa" IN ('usuario', 'vinculacion') AND OLD."estado" = 'PENDIENTE' AND NEW."estado" = 'REVOCADA'
     AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa" AND NEW."creadaEn" = OLD."creadaEn"
     AND NEW."hashToken" = OLD."hashToken" AND NEW."venceEn" = OLD."venceEn" AND NEW."invitadoPorId" IS NOT DISTINCT FROM OLD."invitadoPorId"
     AND NEW."enviadaEn" IS NOT DISTINCT FROM OLD."enviadaEn"
     AND NEW."aceptadaEn" IS NULL AND NEW."aceptadaPorId" IS NULL AND NEW."cuitDeclarado" IS NULL THEN
    RETURN NEW;
  END IF;
  -- Aceptar: PENDIENTE → ACEPTADA (cualquier tipo), sin tocar nada más que lo de la aceptación.
  IF TG_OP = 'UPDATE'
     AND OLD."estado" = 'PENDIENTE' AND NEW."estado" = 'ACEPTADA'
     AND NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."email" = OLD."email" AND NEW."rolEmpresa" = OLD."rolEmpresa"
     AND NEW."hashToken" = OLD."hashToken" AND NEW."venceEn" = OLD."venceEn" AND NEW."creadaEn" = OLD."creadaEn"
     AND NEW."invitadoPorId" IS NOT DISTINCT FROM OLD."invitadoPorId"
     AND NEW."enviadaEn" IS NOT DISTINCT FROM OLD."enviadaEn" AND NEW."revocadaEn" IS NOT DISTINCT FROM OLD."revocadaEn" THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'Invitacion: % no permitido para el rol %', TG_OP, current_user;
END;
$$;

-- Trigger de la tabla hija: solo mientras la invitación madre es una `usuario` PENDIENTE; la fila no se mueve de invitación, sucursal ni empresa.
CREATE FUNCTION proteger_invitacion_sucursal() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  madre_ok boolean;
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;

  IF TG_OP = 'INSERT' OR TG_OP = 'UPDATE' THEN
    SELECT (i."estado" = 'PENDIENTE' AND i."rolEmpresa" = 'usuario') INTO madre_ok
      FROM "Invitacion" i WHERE i."empresaId" = NEW."empresaId" AND i."id" = NEW."invitacionId";
    IF madre_ok IS NOT TRUE THEN
      RAISE EXCEPTION 'InvitacionSucursal: la invitación no es una de usuario PENDIENTE';
    END IF;
    IF TG_OP = 'UPDATE' AND NOT (NEW."id" = OLD."id" AND NEW."empresaId" = OLD."empresaId" AND NEW."invitacionId" = OLD."invitacionId" AND NEW."sucursalId" = OLD."sucursalId" AND NEW."creadaEn" = OLD."creadaEn") THEN
      RAISE EXCEPTION 'InvitacionSucursal: no se puede mover la fila de invitación, sucursal ni empresa';
    END IF;
    RETURN NEW;
  END IF;
  RAISE EXCEPTION 'InvitacionSucursal: % no permitido', TG_OP;
END;
$$;

CREATE TRIGGER "InvitacionSucursal_proteger_fila"
  BEFORE INSERT OR UPDATE OR DELETE ON "InvitacionSucursal"
  FOR EACH ROW EXECUTE FUNCTION proteger_invitacion_sucursal();

CREATE TRIGGER "InvitacionSucursal_proteger_truncate"
  BEFORE TRUNCATE ON "InvitacionSucursal"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_invitacion_sucursal();
