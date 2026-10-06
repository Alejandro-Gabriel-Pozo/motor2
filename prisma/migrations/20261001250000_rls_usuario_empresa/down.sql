-- Reversa de 20261001250000_rls_usuario_empresa: `UsuarioEmpresa` vuelve a quedar sin RLS (como antes).
DROP POLICY IF EXISTS lectura_propia_usuario ON "UsuarioEmpresa";
DROP POLICY IF EXISTS aislamiento_empresa ON "UsuarioEmpresa";
ALTER TABLE "UsuarioEmpresa" DISABLE ROW LEVEL SECURITY;
