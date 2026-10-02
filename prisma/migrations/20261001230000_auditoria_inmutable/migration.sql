-- Auditoría append-only (informe de seguridad 2026-10-01, S-12; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR): `RegistroAuditoria` es el rastro de
-- quién cambió qué (precios, permisos, gerencia). Hoy el rol de ejecución `motor2_app` tiene UPDATE y DELETE sobre la tabla: un bug (o una inyección)
-- podría borrar o reescribir el rastro. La app solo hace `create` y lee (ver `registrarCambioAuditado`), así que no necesita ninguno de los dos.
--
-- Dos candados que se complementan (no cambia el esquema de Prisma, no toca datos):
-- 1) REVOKE UPDATE, DELETE a `motor2_app`. Lo corta el sistema de privilegios.
-- 2) Trigger BEFORE UPDATE/DELETE/TRUNCATE que rechaza a cualquier rol que NO sea el dueño de la tabla (ni miembro del rol dueño ni superusuario).
--    Si un GRANT futuro (un `GRANT ... ON ALL TABLES`, un default privilege, otro rol de ejecución) le devolviera el permiso, el trigger sigue frenando.
--
-- El dueño queda exento A PROPÓSITO: es quien migra (las migraciones pueden corregir datos), quien limpia la base de test (`limpiarBaseDeTest`,
-- reset de e2e) y, además, un dueño siempre puede apagar el trigger (ALTER TABLE ... DISABLE TRIGGER) o borrar el trigger: bloquearlo sería teatro.
-- La protección real contra el dueño es no usar sus credenciales en runtime (ADR-007) y rotarlas.
--
-- Las acciones referenciales (ON UPDATE CASCADE de las FK hacia User/Empresa/Sucursal) corren con los privilegios del dueño: no se ven afectadas.
-- Evaluadas y NO incluidas acá: `Operacion` (la app la actualiza a propósito: anulaciones, correcciones, mensaje de resultado) y `MovimientoStock`
-- (la app no la muta, pero ~40 tests la limpian/simulan con el rol de ejecución). Ver el documento de decisiones. Reversa: down.sql.

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE UPDATE, DELETE ON "RegistroAuditoria" FROM motor2_app;
  END IF;
END
$$;

CREATE FUNCTION rechazar_mutacion_de_auditoria() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  RAISE EXCEPTION 'RegistroAuditoria es append-only: % no permitido para el rol %', TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "RegistroAuditoria_inmutable_fila"
  BEFORE UPDATE OR DELETE ON "RegistroAuditoria"
  FOR EACH ROW EXECUTE FUNCTION rechazar_mutacion_de_auditoria();

CREATE TRIGGER "RegistroAuditoria_inmutable_truncate"
  BEFORE TRUNCATE ON "RegistroAuditoria"
  FOR EACH STATEMENT EXECUTE FUNCTION rechazar_mutacion_de_auditoria();
