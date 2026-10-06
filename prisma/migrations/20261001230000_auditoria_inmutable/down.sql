-- Reversa de 20261001230000_auditoria_inmutable: se saca el trigger y se devuelven UPDATE/DELETE a `motor2_app` (como estaban).
DROP TRIGGER IF EXISTS "RegistroAuditoria_inmutable_truncate" ON "RegistroAuditoria";
DROP TRIGGER IF EXISTS "RegistroAuditoria_inmutable_fila" ON "RegistroAuditoria";
DROP FUNCTION IF EXISTS rechazar_mutacion_de_auditoria();

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT UPDATE, DELETE ON "RegistroAuditoria" TO motor2_app;
  END IF;
END
$$;
