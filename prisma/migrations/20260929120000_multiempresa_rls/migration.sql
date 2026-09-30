-- ADR-007 A6, Migración 2: aislamiento por empresa con RLS (Postgres 16+; probado en 17).
--
-- Política en las 49 tablas de dominio con "empresaId". Quedan SIN política las 7 globales (User, Account, Session,
-- VerificationToken, Accion, IndicePrecio, CotizacionDolar) y las 2 de plataforma: Empresa (la lee app_empresa_actual()) y
-- UsuarioEmpresa (la pertenencia que se consulta ANTES de tener una empresa).
--
-- ENABLE (sin FORCE): el dueño de las tablas (migraciones, limpieza de tests) las salta; el rol de ejecución `motor2_app`
-- (sin superusuario, sin BYPASSRLS, no dueño) queda sujeto a la política. Una sola política FOR ALL: USING filtra lo que se lee /
-- actualiza / borra y WITH CHECK rechaza insertar o mover una fila a otra empresa. (SELECT app_empresa_actual()) hace que el
-- planificador la evalúe una vez por consulta (InitPlan) y no por fila.
--
-- Sin contexto (app.empresa_id sin fijar): con UNA empresa ACTIVE la función devuelve esa (instalación de hoy); con dos o más
-- devuelve NULL y la comparación no da verdadero: no se ve ni se inserta nada (falla hacia el lado seguro).
--
-- Los GRANT de `motor2_app` no cambian (ya cubren todas las tablas, A0 y migración 1). Reversa: down.sql.

ALTER TABLE "CapacidadSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CapacidadSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "CategoriaProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CategoriaProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Cliente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Cliente" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ContenidoCartaProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ContenidoCartaProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ConteoFisico" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ConteoFisico" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Cuenta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Cuenta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "CuentaItem" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "CuentaItem" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "DestinoConsumo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "DestinoConsumo" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "DisponibilidadProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "DisponibilidadProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "EjemplarBoleta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "EjemplarBoleta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "FrecuenciaConteoProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "FrecuenciaConteoProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "GeneroCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "GeneroCarta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Grupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Grupo" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Insumo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Insumo" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ItemAgrupadoCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ItemAgrupadoCarta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Mesa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Mesa" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "MotivoMerma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "MotivoMerma" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "MovimientoStock" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "MovimientoStock" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "OpcionItemAgrupadoCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "OpcionItemAgrupadoCarta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Operacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Operacion" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PagoConsignante" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PagoConsignante" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PermisoRol" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PermisoRol" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PrecioLocalProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PrecioLocalProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Presentacion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Presentacion" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Producto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Producto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PromoCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromoCarta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PromoCartaCupo" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromoCartaCupo" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PromoCuenta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromoCuenta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PromocionProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PromocionProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Proveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Proveedor" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "ProveedorPorProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ProveedorPorProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaIngrediente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaIngrediente" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaPaso" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaPaso" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaPasoIngrediente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaPasoIngrediente" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RecetaVersion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RecetaVersion" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RegistroAuditoria" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RegistroAuditoria" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "RendimientoLocalIngrediente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "RendimientoLocalIngrediente" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Rol" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Rol" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Seccion" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Seccion" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "SeccionCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "SeccionCarta" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "SeccionHabitualProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "SeccionHabitualProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "StockMinimoProducto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "StockMinimoProducto" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Sucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Sucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "SucursalPublica" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "SucursalPublica" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "SustitutoRecetaIngrediente" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "SustitutoRecetaIngrediente" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "TemaCartaSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "TemaCartaSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "TraspasoSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "TraspasoSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "Unidad" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "Unidad" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "UsuarioSucursal" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "UsuarioSucursal" USING ("empresaId" = (SELECT app_empresa_actual())) WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
