-- RLS en `UsuarioEmpresa` (informe de seguridad 2026-10-01, S-13; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR). La migración 20260929120000 la dejó sin
-- política porque se lee ANTES de tener empresa (login: `obtenerContextoUsuario`, `tieneSucursalActiva`). Sin RLS, un `findUnique` sin `empresaId` o una
-- consulta mal armada ve y escribe pertenencias de OTRA empresa (ya pasó: ver el comentario de `actualizarActivoUsuarioEnEmpresa`).
--
-- Dos políticas (ENABLE sin FORCE, igual que el resto: el dueño la salta):
-- 1) `aislamiento_empresa` (FOR ALL) — la misma que las demás tablas: ver/escribir solo la empresa del contexto (`app.empresa_id`, o la única ACTIVE).
-- 2) `lectura_propia_usuario` (FOR SELECT) — además se puede LEER la pertenencia propia en cualquier empresa, con `app.usuario_id` (lo fija `dbDeUsuario`
--    para las dos lecturas que ocurren antes de tener empresa). Es solo SELECT a propósito: con FOR ALL un usuario podría insertarse o promoverse en otra empresa.
-- Sin contexto de empresa y sin usuario, con 2+ empresas activas no se ve nada (falla hacia el lado seguro).
--
-- REQUIERE el código de esta misma entrega (`dbDeUsuario` en contexto.ts y acceso.ts): desplegar el código ANTES o junto con la migración. Los GRANT no cambian. Reversa: down.sql.

ALTER TABLE "UsuarioEmpresa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "UsuarioEmpresa"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
CREATE POLICY lectura_propia_usuario ON "UsuarioEmpresa" FOR SELECT
  USING ("usuarioId" = NULLIF(current_setting('app.usuario_id', true), ''));
