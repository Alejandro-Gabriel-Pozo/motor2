-- ADR-007, paso A2 (Migración 1: estructura). Instalación multiempresa-capable, activada con UNA empresa.
-- Escrita a mano sobre el diff de Prisma (`prisma migrate diff`), en el patrón de 3 pasos por tabla:
--   columna `empresaId` nullable -> backfill a la empresa por defecto -> NOT NULL + default + unicidades por empresa
--   + FK compuestas [empresaId, xId]. SIN RLS todavía (Migración 2, paso A6).
-- Reversa: down.sql (solo válida mientras haya UNA empresa: recrea las unicidades globales).

-- 1) Plataforma: Empresa y UsuarioEmpresa (sin empresaId propio; sin RLS por empresa).
CREATE TYPE "EstadoEmpresa" AS ENUM ('PROVISIONING', 'ACTIVE', 'SUSPENDED', 'DELETING');

CREATE TABLE "Empresa" (
    "id" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "cuit" TEXT,
    "zonaHoraria" TEXT NOT NULL,
    "moneda" TEXT NOT NULL,
    "estado" "EstadoEmpresa" NOT NULL DEFAULT 'PROVISIONING',
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "Empresa_pkey" PRIMARY KEY ("id")
);

CREATE TABLE "UsuarioEmpresa" (
    "id" TEXT NOT NULL,
    "usuarioId" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL,
    "rolEmpresa" TEXT,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "UsuarioEmpresa_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "Empresa_nombre_key" ON "Empresa"("nombre");
CREATE UNIQUE INDEX "Empresa_slug_key" ON "Empresa"("slug");
CREATE UNIQUE INDEX "UsuarioEmpresa_usuarioId_empresaId_key" ON "UsuarioEmpresa"("usuarioId", "empresaId");

-- 2) Empresa por defecto de esta instalación (id fijo). En producción el slug real (= CARTA_EMPRESA_SLUG vigente, D5) se
--    ajusta en el ensayo de A8 antes de activar; 'principal' es solo el valor inicial.
INSERT INTO "Empresa" ("id", "nombre", "slug", "zonaHoraria", "moneda", "estado")
VALUES ('empresa_principal', 'Empresa principal', 'principal', 'America/Argentina/Buenos_Aires', 'ARS', 'ACTIVE');

-- 3) Función de contexto (D1 = V1): empresa fijada por la transacción (app.empresa_id) o, si no hay contexto, la ÚNICA empresa
--    ACTIVE. Con dos o más empresas activas y sin contexto devuelve NULL (se equivoca hacia el lado seguro: NOT NULL falla).
CREATE FUNCTION app_empresa_actual() RETURNS text
LANGUAGE sql STABLE
AS $$
  SELECT COALESCE(
    NULLIF(current_setting('app.empresa_id', true), ''),
    (SELECT CASE WHEN count(*) = 1 THEN min("id") END FROM public."Empresa" WHERE "estado" = 'ACTIVE')
  )
$$;

-- 4) Columna nullable en las 49 tablas de dominio.
ALTER TABLE "Sucursal" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Rol" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "UsuarioSucursal" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PermisoRol" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "CapacidadSucursal" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RegistroAuditoria" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Producto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "DisponibilidadProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Insumo" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Grupo" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "CategoriaProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Unidad" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Presentacion" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Proveedor" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PagoConsignante" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "ProveedorPorProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Cliente" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RecetaVersion" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RecetaIngrediente" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "SustitutoRecetaIngrediente" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RecetaPaso" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RecetaPasoIngrediente" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "MotivoMerma" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "DestinoConsumo" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Seccion" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Operacion" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "MovimientoStock" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "ConteoFisico" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PrecioLocalProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "RendimientoLocalIngrediente" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "FrecuenciaConteoProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "StockMinimoProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "SeccionHabitualProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PromocionProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "TraspasoSucursal" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "SeccionCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "ContenidoCartaProducto" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "ItemAgrupadoCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "GeneroCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PromoCarta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PromoCartaCupo" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "SucursalPublica" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "TemaCartaSucursal" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Mesa" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "Cuenta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "PromoCuenta" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "CuentaItem" ADD COLUMN "empresaId" TEXT;
ALTER TABLE "EjemplarBoleta" ADD COLUMN "empresaId" TEXT;

-- 5) Backfill: toda fila existente pertenece a la empresa por defecto.
UPDATE "Sucursal" SET "empresaId" = 'empresa_principal';
UPDATE "Rol" SET "empresaId" = 'empresa_principal';
UPDATE "UsuarioSucursal" SET "empresaId" = 'empresa_principal';
UPDATE "PermisoRol" SET "empresaId" = 'empresa_principal';
UPDATE "CapacidadSucursal" SET "empresaId" = 'empresa_principal';
UPDATE "RegistroAuditoria" SET "empresaId" = 'empresa_principal';
UPDATE "Producto" SET "empresaId" = 'empresa_principal';
UPDATE "DisponibilidadProducto" SET "empresaId" = 'empresa_principal';
UPDATE "Insumo" SET "empresaId" = 'empresa_principal';
UPDATE "Grupo" SET "empresaId" = 'empresa_principal';
UPDATE "CategoriaProducto" SET "empresaId" = 'empresa_principal';
UPDATE "Unidad" SET "empresaId" = 'empresa_principal';
UPDATE "Presentacion" SET "empresaId" = 'empresa_principal';
UPDATE "Proveedor" SET "empresaId" = 'empresa_principal';
UPDATE "PagoConsignante" SET "empresaId" = 'empresa_principal';
UPDATE "ProveedorPorProducto" SET "empresaId" = 'empresa_principal';
UPDATE "Cliente" SET "empresaId" = 'empresa_principal';
UPDATE "RecetaVersion" SET "empresaId" = 'empresa_principal';
UPDATE "RecetaIngrediente" SET "empresaId" = 'empresa_principal';
UPDATE "SustitutoRecetaIngrediente" SET "empresaId" = 'empresa_principal';
UPDATE "RecetaPaso" SET "empresaId" = 'empresa_principal';
UPDATE "RecetaPasoIngrediente" SET "empresaId" = 'empresa_principal';
UPDATE "MotivoMerma" SET "empresaId" = 'empresa_principal';
UPDATE "DestinoConsumo" SET "empresaId" = 'empresa_principal';
UPDATE "Seccion" SET "empresaId" = 'empresa_principal';
UPDATE "Operacion" SET "empresaId" = 'empresa_principal';
UPDATE "MovimientoStock" SET "empresaId" = 'empresa_principal';
UPDATE "ConteoFisico" SET "empresaId" = 'empresa_principal';
UPDATE "PrecioLocalProducto" SET "empresaId" = 'empresa_principal';
UPDATE "RendimientoLocalIngrediente" SET "empresaId" = 'empresa_principal';
UPDATE "FrecuenciaConteoProducto" SET "empresaId" = 'empresa_principal';
UPDATE "StockMinimoProducto" SET "empresaId" = 'empresa_principal';
UPDATE "SeccionHabitualProducto" SET "empresaId" = 'empresa_principal';
UPDATE "PromocionProducto" SET "empresaId" = 'empresa_principal';
UPDATE "TraspasoSucursal" SET "empresaId" = 'empresa_principal';
UPDATE "SeccionCarta" SET "empresaId" = 'empresa_principal';
UPDATE "ContenidoCartaProducto" SET "empresaId" = 'empresa_principal';
UPDATE "ItemAgrupadoCarta" SET "empresaId" = 'empresa_principal';
UPDATE "GeneroCarta" SET "empresaId" = 'empresa_principal';
UPDATE "OpcionItemAgrupadoCarta" SET "empresaId" = 'empresa_principal';
UPDATE "PromoCarta" SET "empresaId" = 'empresa_principal';
UPDATE "PromoCartaCupo" SET "empresaId" = 'empresa_principal';
UPDATE "SucursalPublica" SET "empresaId" = 'empresa_principal';
UPDATE "TemaCartaSucursal" SET "empresaId" = 'empresa_principal';
UPDATE "Mesa" SET "empresaId" = 'empresa_principal';
UPDATE "Cuenta" SET "empresaId" = 'empresa_principal';
UPDATE "PromoCuenta" SET "empresaId" = 'empresa_principal';
UPDATE "CuentaItem" SET "empresaId" = 'empresa_principal';
UPDATE "EjemplarBoleta" SET "empresaId" = 'empresa_principal';

-- 6) NOT NULL + default (los `create` existentes no pasan empresaId).
ALTER TABLE "Sucursal" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Rol" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "UsuarioSucursal" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PermisoRol" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "CapacidadSucursal" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RegistroAuditoria" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Producto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "DisponibilidadProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Insumo" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Grupo" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "CategoriaProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Unidad" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Presentacion" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Proveedor" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PagoConsignante" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "ProveedorPorProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Cliente" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RecetaVersion" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RecetaIngrediente" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "SustitutoRecetaIngrediente" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RecetaPaso" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RecetaPasoIngrediente" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "MotivoMerma" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "DestinoConsumo" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Seccion" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Operacion" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "MovimientoStock" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "ConteoFisico" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PrecioLocalProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "RendimientoLocalIngrediente" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "FrecuenciaConteoProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "StockMinimoProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "SeccionHabitualProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PromocionProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "TraspasoSucursal" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "SeccionCarta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "ContenidoCartaProducto" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "ItemAgrupadoCarta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "GeneroCarta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "OpcionItemAgrupadoCarta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PromoCarta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PromoCartaCupo" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "SucursalPublica" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "TemaCartaSucursal" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Mesa" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "Cuenta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "PromoCuenta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "CuentaItem" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();
ALTER TABLE "EjemplarBoleta" ALTER COLUMN "empresaId" SET NOT NULL, ALTER COLUMN "empresaId" SET DEFAULT app_empresa_actual();

-- 7) Unicidades por empresa (incluida @@unique([empresaId, id]), el destino de las FK compuestas).
CREATE UNIQUE INDEX "Sucursal_empresaId_nombre_key" ON "Sucursal"("empresaId", "nombre");
CREATE UNIQUE INDEX "Sucursal_empresaId_id_key" ON "Sucursal"("empresaId", "id");
CREATE UNIQUE INDEX "Rol_empresaId_nombre_key" ON "Rol"("empresaId", "nombre");
CREATE UNIQUE INDEX "Rol_empresaId_id_key" ON "Rol"("empresaId", "id");
CREATE UNIQUE INDEX "UsuarioSucursal_empresaId_id_key" ON "UsuarioSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "PermisoRol_empresaId_id_key" ON "PermisoRol"("empresaId", "id");
CREATE UNIQUE INDEX "CapacidadSucursal_empresaId_id_key" ON "CapacidadSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "RegistroAuditoria_empresaId_id_key" ON "RegistroAuditoria"("empresaId", "id");
CREATE UNIQUE INDEX "Producto_empresaId_codigo_key" ON "Producto"("empresaId", "codigo");
CREATE UNIQUE INDEX "Producto_empresaId_id_key" ON "Producto"("empresaId", "id");
CREATE UNIQUE INDEX "DisponibilidadProducto_empresaId_id_key" ON "DisponibilidadProducto"("empresaId", "id");
CREATE UNIQUE INDEX "Insumo_empresaId_nombre_key" ON "Insumo"("empresaId", "nombre");
CREATE UNIQUE INDEX "Insumo_empresaId_id_key" ON "Insumo"("empresaId", "id");
CREATE UNIQUE INDEX "Grupo_empresaId_nombre_key" ON "Grupo"("empresaId", "nombre");
CREATE UNIQUE INDEX "Grupo_empresaId_id_key" ON "Grupo"("empresaId", "id");
CREATE UNIQUE INDEX "CategoriaProducto_empresaId_nombre_key" ON "CategoriaProducto"("empresaId", "nombre");
CREATE UNIQUE INDEX "CategoriaProducto_empresaId_id_key" ON "CategoriaProducto"("empresaId", "id");
CREATE UNIQUE INDEX "Unidad_empresaId_nombre_key" ON "Unidad"("empresaId", "nombre");
CREATE UNIQUE INDEX "Unidad_empresaId_id_key" ON "Unidad"("empresaId", "id");
CREATE UNIQUE INDEX "Presentacion_empresaId_id_key" ON "Presentacion"("empresaId", "id");
CREATE UNIQUE INDEX "Proveedor_empresaId_codigo_key" ON "Proveedor"("empresaId", "codigo");
CREATE UNIQUE INDEX "Proveedor_empresaId_nombre_key" ON "Proveedor"("empresaId", "nombre");
CREATE UNIQUE INDEX "Proveedor_empresaId_id_key" ON "Proveedor"("empresaId", "id");
CREATE UNIQUE INDEX "PagoConsignante_empresaId_id_key" ON "PagoConsignante"("empresaId", "id");
CREATE UNIQUE INDEX "ProveedorPorProducto_empresaId_id_key" ON "ProveedorPorProducto"("empresaId", "id");
CREATE UNIQUE INDEX "Cliente_empresaId_nombre_key" ON "Cliente"("empresaId", "nombre");
CREATE UNIQUE INDEX "Cliente_empresaId_id_key" ON "Cliente"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaVersion_empresaId_id_key" ON "RecetaVersion"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaIngrediente_empresaId_id_key" ON "RecetaIngrediente"("empresaId", "id");
CREATE UNIQUE INDEX "SustitutoRecetaIngrediente_empresaId_id_key" ON "SustitutoRecetaIngrediente"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaPaso_empresaId_id_key" ON "RecetaPaso"("empresaId", "id");
CREATE UNIQUE INDEX "RecetaPasoIngrediente_empresaId_id_key" ON "RecetaPasoIngrediente"("empresaId", "id");
CREATE UNIQUE INDEX "MotivoMerma_empresaId_nombre_key" ON "MotivoMerma"("empresaId", "nombre");
CREATE UNIQUE INDEX "MotivoMerma_empresaId_id_key" ON "MotivoMerma"("empresaId", "id");
CREATE UNIQUE INDEX "DestinoConsumo_empresaId_nombre_key" ON "DestinoConsumo"("empresaId", "nombre");
CREATE UNIQUE INDEX "DestinoConsumo_empresaId_id_key" ON "DestinoConsumo"("empresaId", "id");
CREATE UNIQUE INDEX "Seccion_empresaId_id_key" ON "Seccion"("empresaId", "id");
CREATE UNIQUE INDEX "Operacion_empresaId_id_key" ON "Operacion"("empresaId", "id");
CREATE UNIQUE INDEX "MovimientoStock_empresaId_id_key" ON "MovimientoStock"("empresaId", "id");
CREATE UNIQUE INDEX "ConteoFisico_empresaId_id_key" ON "ConteoFisico"("empresaId", "id");
CREATE UNIQUE INDEX "PrecioLocalProducto_empresaId_id_key" ON "PrecioLocalProducto"("empresaId", "id");
CREATE UNIQUE INDEX "RendimientoLocalIngrediente_empresaId_id_key" ON "RendimientoLocalIngrediente"("empresaId", "id");
CREATE UNIQUE INDEX "FrecuenciaConteoProducto_empresaId_id_key" ON "FrecuenciaConteoProducto"("empresaId", "id");
CREATE UNIQUE INDEX "StockMinimoProducto_empresaId_id_key" ON "StockMinimoProducto"("empresaId", "id");
CREATE UNIQUE INDEX "SeccionHabitualProducto_empresaId_id_key" ON "SeccionHabitualProducto"("empresaId", "id");
CREATE UNIQUE INDEX "PromocionProducto_empresaId_id_key" ON "PromocionProducto"("empresaId", "id");
CREATE UNIQUE INDEX "TraspasoSucursal_empresaId_id_key" ON "TraspasoSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "SeccionCarta_empresaId_nombre_key" ON "SeccionCarta"("empresaId", "nombre");
CREATE UNIQUE INDEX "SeccionCarta_empresaId_id_key" ON "SeccionCarta"("empresaId", "id");
CREATE UNIQUE INDEX "ContenidoCartaProducto_empresaId_productoId_key" ON "ContenidoCartaProducto"("empresaId", "productoId");
CREATE UNIQUE INDEX "ContenidoCartaProducto_empresaId_id_key" ON "ContenidoCartaProducto"("empresaId", "id");
CREATE UNIQUE INDEX "ItemAgrupadoCarta_empresaId_nombre_key" ON "ItemAgrupadoCarta"("empresaId", "nombre");
CREATE UNIQUE INDEX "ItemAgrupadoCarta_empresaId_id_key" ON "ItemAgrupadoCarta"("empresaId", "id");
CREATE UNIQUE INDEX "GeneroCarta_empresaId_nombre_key" ON "GeneroCarta"("empresaId", "nombre");
CREATE UNIQUE INDEX "GeneroCarta_empresaId_id_key" ON "GeneroCarta"("empresaId", "id");
CREATE UNIQUE INDEX "OpcionItemAgrupadoCarta_empresaId_productoId_key" ON "OpcionItemAgrupadoCarta"("empresaId", "productoId");
CREATE UNIQUE INDEX "OpcionItemAgrupadoCarta_empresaId_id_key" ON "OpcionItemAgrupadoCarta"("empresaId", "id");
CREATE UNIQUE INDEX "PromoCarta_empresaId_id_key" ON "PromoCarta"("empresaId", "id");
CREATE UNIQUE INDEX "PromoCartaCupo_empresaId_id_key" ON "PromoCartaCupo"("empresaId", "id");
CREATE UNIQUE INDEX "SucursalPublica_empresaId_sucursalId_key" ON "SucursalPublica"("empresaId", "sucursalId");
CREATE UNIQUE INDEX "SucursalPublica_empresaId_slug_key" ON "SucursalPublica"("empresaId", "slug");
CREATE UNIQUE INDEX "SucursalPublica_empresaId_id_key" ON "SucursalPublica"("empresaId", "id");
CREATE UNIQUE INDEX "TemaCartaSucursal_empresaId_sucursalId_key" ON "TemaCartaSucursal"("empresaId", "sucursalId");
CREATE UNIQUE INDEX "TemaCartaSucursal_empresaId_id_key" ON "TemaCartaSucursal"("empresaId", "id");
CREATE UNIQUE INDEX "Mesa_empresaId_id_key" ON "Mesa"("empresaId", "id");
CREATE UNIQUE INDEX "Cuenta_empresaId_id_key" ON "Cuenta"("empresaId", "id");
CREATE UNIQUE INDEX "PromoCuenta_empresaId_id_key" ON "PromoCuenta"("empresaId", "id");
CREATE UNIQUE INDEX "CuentaItem_empresaId_id_key" ON "CuentaItem"("empresaId", "id");
CREATE UNIQUE INDEX "EjemplarBoleta_empresaId_id_key" ON "EjemplarBoleta"("empresaId", "id");

-- 8) Índices manuales (no representables en schema.prisma): el mismo nombre, ahora por empresa.
DROP INDEX "Producto_nombre_lower_key";
DROP INDEX "Proveedor_nombre_lower_key";
DROP INDEX "Insumo_nombre_lower_key";
DROP INDEX "CategoriaProducto_nombre_lower_key";
DROP INDEX "Unidad_nombre_lower_key";
DROP INDEX "Grupo_nombre_lower_key";
DROP INDEX "CapacidadSucursal_accionClave_default_key";
CREATE UNIQUE INDEX "Producto_nombre_lower_key" ON "Producto" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "Proveedor_nombre_lower_key" ON "Proveedor" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "Insumo_nombre_lower_key" ON "Insumo" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "CategoriaProducto_nombre_lower_key" ON "CategoriaProducto" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "Unidad_nombre_lower_key" ON "Unidad" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "Grupo_nombre_lower_key" ON "Grupo" ("empresaId", lower("nombre"));
CREATE UNIQUE INDEX "CapacidadSucursal_accionClave_default_key" ON "CapacidadSucursal" ("empresaId", "accionClave") WHERE "sucursalId" IS NULL;

-- 9) Se sueltan las FK simples y las unicidades globales que reemplazan las de arriba.
ALTER TABLE "UsuarioSucursal" DROP CONSTRAINT "UsuarioSucursal_sucursalId_fkey";
ALTER TABLE "UsuarioSucursal" DROP CONSTRAINT "UsuarioSucursal_rolId_fkey";
ALTER TABLE "PermisoRol" DROP CONSTRAINT "PermisoRol_rolId_fkey";
ALTER TABLE "CapacidadSucursal" DROP CONSTRAINT "CapacidadSucursal_sucursalId_fkey";
ALTER TABLE "RegistroAuditoria" DROP CONSTRAINT "RegistroAuditoria_sucursalId_fkey";
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_categoriaId_fkey";
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_unidadCompraId_fkey";
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_unidadStockId_fkey";
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_insumoId_fkey";
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_proveedorConsignacionId_fkey";
ALTER TABLE "DisponibilidadProducto" DROP CONSTRAINT "DisponibilidadProducto_sucursalId_fkey";
ALTER TABLE "DisponibilidadProducto" DROP CONSTRAINT "DisponibilidadProducto_productoId_fkey";
ALTER TABLE "Insumo" DROP CONSTRAINT "Insumo_grupoId_fkey";
ALTER TABLE "Grupo" DROP CONSTRAINT "Grupo_grupoPadreId_fkey";
ALTER TABLE "Presentacion" DROP CONSTRAINT "Presentacion_productoId_fkey";
ALTER TABLE "Presentacion" DROP CONSTRAINT "Presentacion_unidadCompraId_fkey";
ALTER TABLE "PagoConsignante" DROP CONSTRAINT "PagoConsignante_sucursalId_fkey";
ALTER TABLE "PagoConsignante" DROP CONSTRAINT "PagoConsignante_proveedorId_fkey";
ALTER TABLE "ProveedorPorProducto" DROP CONSTRAINT "ProveedorPorProducto_productoId_fkey";
ALTER TABLE "ProveedorPorProducto" DROP CONSTRAINT "ProveedorPorProducto_proveedorId_fkey";
ALTER TABLE "ProveedorPorProducto" DROP CONSTRAINT "ProveedorPorProducto_unidadCompraId_fkey";
ALTER TABLE "RecetaVersion" DROP CONSTRAINT "RecetaVersion_productoId_fkey";
ALTER TABLE "RecetaVersion" DROP CONSTRAINT "RecetaVersion_rendimientoUnidadId_fkey";
ALTER TABLE "RecetaVersion" DROP CONSTRAINT "RecetaVersion_racionUnidadId_fkey";
ALTER TABLE "RecetaIngrediente" DROP CONSTRAINT "RecetaIngrediente_recetaVersionId_fkey";
ALTER TABLE "RecetaIngrediente" DROP CONSTRAINT "RecetaIngrediente_insumoProductoId_fkey";
ALTER TABLE "RecetaIngrediente" DROP CONSTRAINT "RecetaIngrediente_unidadId_fkey";
ALTER TABLE "SustitutoRecetaIngrediente" DROP CONSTRAINT "SustitutoRecetaIngrediente_recetaIngredienteId_fkey";
ALTER TABLE "SustitutoRecetaIngrediente" DROP CONSTRAINT "SustitutoRecetaIngrediente_insumoSustitutoId_fkey";
ALTER TABLE "RecetaPaso" DROP CONSTRAINT "RecetaPaso_recetaVersionId_fkey";
ALTER TABLE "RecetaPasoIngrediente" DROP CONSTRAINT "RecetaPasoIngrediente_recetaPasoId_fkey";
ALTER TABLE "RecetaPasoIngrediente" DROP CONSTRAINT "RecetaPasoIngrediente_recetaIngredienteId_fkey";
ALTER TABLE "Seccion" DROP CONSTRAINT "Seccion_sucursalId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_sucursalId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_proveedorId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_clienteId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_promoCuentaId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_seccionDestinoId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_motivoId_fkey";
ALTER TABLE "Operacion" DROP CONSTRAINT "Operacion_destinoId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_operacionId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_productoId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_seccionId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_conteoFisicoId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_traspasoSucursalId_fkey";
ALTER TABLE "MovimientoStock" DROP CONSTRAINT "MovimientoStock_sustituyeAProductoId_fkey";
ALTER TABLE "ConteoFisico" DROP CONSTRAINT "ConteoFisico_sucursalId_fkey";
ALTER TABLE "ConteoFisico" DROP CONSTRAINT "ConteoFisico_productoId_fkey";
ALTER TABLE "ConteoFisico" DROP CONSTRAINT "ConteoFisico_seccionId_fkey";
ALTER TABLE "PrecioLocalProducto" DROP CONSTRAINT "PrecioLocalProducto_sucursalId_fkey";
ALTER TABLE "PrecioLocalProducto" DROP CONSTRAINT "PrecioLocalProducto_productoId_fkey";
ALTER TABLE "RendimientoLocalIngrediente" DROP CONSTRAINT "RendimientoLocalIngrediente_recetaIngredienteId_fkey";
ALTER TABLE "RendimientoLocalIngrediente" DROP CONSTRAINT "RendimientoLocalIngrediente_sucursalId_fkey";
ALTER TABLE "FrecuenciaConteoProducto" DROP CONSTRAINT "FrecuenciaConteoProducto_sucursalId_fkey";
ALTER TABLE "FrecuenciaConteoProducto" DROP CONSTRAINT "FrecuenciaConteoProducto_productoId_fkey";
ALTER TABLE "StockMinimoProducto" DROP CONSTRAINT "StockMinimoProducto_sucursalId_fkey";
ALTER TABLE "StockMinimoProducto" DROP CONSTRAINT "StockMinimoProducto_productoId_fkey";
ALTER TABLE "StockMinimoProducto" DROP CONSTRAINT "StockMinimoProducto_seccionId_fkey";
ALTER TABLE "SeccionHabitualProducto" DROP CONSTRAINT "SeccionHabitualProducto_sucursalId_fkey";
ALTER TABLE "SeccionHabitualProducto" DROP CONSTRAINT "SeccionHabitualProducto_productoId_fkey";
ALTER TABLE "SeccionHabitualProducto" DROP CONSTRAINT "SeccionHabitualProducto_seccionId_fkey";
ALTER TABLE "PromocionProducto" DROP CONSTRAINT "PromocionProducto_sucursalId_fkey";
ALTER TABLE "PromocionProducto" DROP CONSTRAINT "PromocionProducto_productoId_fkey";
ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT "TraspasoSucursal_origenSucursalId_fkey";
ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT "TraspasoSucursal_destinoSucursalId_fkey";
ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT "TraspasoSucursal_productoId_fkey";
ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT "TraspasoSucursal_seccionOrigenId_fkey";
ALTER TABLE "TraspasoSucursal" DROP CONSTRAINT "TraspasoSucursal_seccionDestinoId_fkey";
ALTER TABLE "ContenidoCartaProducto" DROP CONSTRAINT "ContenidoCartaProducto_productoId_fkey";
ALTER TABLE "ContenidoCartaProducto" DROP CONSTRAINT "ContenidoCartaProducto_seccionCartaId_fkey";
ALTER TABLE "ContenidoCartaProducto" DROP CONSTRAINT "ContenidoCartaProducto_generoCartaId_fkey";
ALTER TABLE "ItemAgrupadoCarta" DROP CONSTRAINT "ItemAgrupadoCarta_seccionCartaId_fkey";
ALTER TABLE "ItemAgrupadoCarta" DROP CONSTRAINT "ItemAgrupadoCarta_generoCartaId_fkey";
ALTER TABLE "OpcionItemAgrupadoCarta" DROP CONSTRAINT "OpcionItemAgrupadoCarta_itemAgrupadoCartaId_fkey";
ALTER TABLE "OpcionItemAgrupadoCarta" DROP CONSTRAINT "OpcionItemAgrupadoCarta_productoId_fkey";
ALTER TABLE "PromoCarta" DROP CONSTRAINT "PromoCarta_sucursalId_fkey";
ALTER TABLE "PromoCarta" DROP CONSTRAINT "PromoCarta_seccionCartaId_fkey";
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT "PromoCartaCupo_promoCartaId_fkey";
ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT "PromoCartaCupo_seccionCartaId_fkey";
ALTER TABLE "SucursalPublica" DROP CONSTRAINT "SucursalPublica_sucursalId_fkey";
ALTER TABLE "TemaCartaSucursal" DROP CONSTRAINT "TemaCartaSucursal_sucursalId_fkey";
ALTER TABLE "Mesa" DROP CONSTRAINT "Mesa_sucursalId_fkey";
ALTER TABLE "Cuenta" DROP CONSTRAINT "Cuenta_mesaId_fkey";
ALTER TABLE "Cuenta" DROP CONSTRAINT "Cuenta_clienteId_fkey";
ALTER TABLE "PromoCuenta" DROP CONSTRAINT "PromoCuenta_cuentaId_fkey";
ALTER TABLE "PromoCuenta" DROP CONSTRAINT "PromoCuenta_promoCartaId_fkey";
ALTER TABLE "CuentaItem" DROP CONSTRAINT "CuentaItem_cuentaId_fkey";
ALTER TABLE "CuentaItem" DROP CONSTRAINT "CuentaItem_productoId_fkey";
ALTER TABLE "CuentaItem" DROP CONSTRAINT "CuentaItem_anulaAItemId_fkey";
ALTER TABLE "CuentaItem" DROP CONSTRAINT "CuentaItem_operacionId_fkey";
ALTER TABLE "CuentaItem" DROP CONSTRAINT "CuentaItem_promoCuentaId_fkey";
ALTER TABLE "EjemplarBoleta" DROP CONSTRAINT "EjemplarBoleta_sucursalId_fkey";
ALTER TABLE "EjemplarBoleta" DROP CONSTRAINT "EjemplarBoleta_cuentaId_fkey";
ALTER TABLE "EjemplarBoleta" DROP CONSTRAINT "EjemplarBoleta_corrigeAId_fkey";
DROP INDEX "Sucursal_nombre_key";
DROP INDEX "Rol_nombre_key";
DROP INDEX "Producto_codigo_key";
DROP INDEX "Insumo_nombre_key";
DROP INDEX "Grupo_nombre_key";
DROP INDEX "CategoriaProducto_nombre_key";
DROP INDEX "Unidad_nombre_key";
DROP INDEX "Proveedor_codigo_key";
DROP INDEX "Proveedor_nombre_key";
DROP INDEX "Cliente_nombre_key";
DROP INDEX "MotivoMerma_nombre_key";
DROP INDEX "DestinoConsumo_nombre_key";
DROP INDEX "SeccionCarta_nombre_key";
DROP INDEX "ContenidoCartaProducto_productoId_key";
DROP INDEX "ItemAgrupadoCarta_nombre_key";
DROP INDEX "GeneroCarta_nombre_key";
DROP INDEX "OpcionItemAgrupadoCarta_productoId_key";
DROP INDEX "SucursalPublica_sucursalId_key";
DROP INDEX "SucursalPublica_slug_key";
DROP INDEX "TemaCartaSucursal_sucursalId_key";

-- 10) FK a Empresa y FK compuestas [empresaId, xId] -> [empresaId, id] (D4: todas las FK entre tablas por empresa).
ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Rol" ADD CONSTRAINT "Rol_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsuarioSucursal" ADD CONSTRAINT "UsuarioSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermisoRol" ADD CONSTRAINT "PermisoRol_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapacidadSucursal" ADD CONSTRAINT "CapacidadSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegistroAuditoria" ADD CONSTRAINT "RegistroAuditoria_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Grupo" ADD CONSTRAINT "Grupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CategoriaProducto" ADD CONSTRAINT "CategoriaProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Unidad" ADD CONSTRAINT "Unidad_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorPorProducto" ADD CONSTRAINT "ProveedorPorProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaIngrediente" ADD CONSTRAINT "RecetaIngrediente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaPaso" ADD CONSTRAINT "RecetaPaso_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaPasoIngrediente" ADD CONSTRAINT "RecetaPasoIngrediente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MotivoMerma" ADD CONSTRAINT "MotivoMerma_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DestinoConsumo" ADD CONSTRAINT "DestinoConsumo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Seccion" ADD CONSTRAINT "Seccion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConteoFisico" ADD CONSTRAINT "ConteoFisico_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalProducto" ADD CONSTRAINT "PrecioLocalProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SeccionCarta" ADD CONSTRAINT "SeccionCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "GeneroCarta" ADD CONSTRAINT "GeneroCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SucursalPublica" ADD CONSTRAINT "SucursalPublica_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemaCartaSucursal" ADD CONSTRAINT "TemaCartaSucursal_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsuarioSucursal" ADD CONSTRAINT "UsuarioSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsuarioSucursal" ADD CONSTRAINT "UsuarioSucursal_empresaId_rolId_fkey" FOREIGN KEY ("empresaId", "rolId") REFERENCES "Rol"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PermisoRol" ADD CONSTRAINT "PermisoRol_empresaId_rolId_fkey" FOREIGN KEY ("empresaId", "rolId") REFERENCES "Rol"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CapacidadSucursal" ADD CONSTRAINT "CapacidadSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RegistroAuditoria" ADD CONSTRAINT "RegistroAuditoria_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_categoriaId_fkey" FOREIGN KEY ("empresaId", "categoriaId") REFERENCES "CategoriaProducto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_unidadCompraId_fkey" FOREIGN KEY ("empresaId", "unidadCompraId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_unidadStockId_fkey" FOREIGN KEY ("empresaId", "unidadStockId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_insumoId_fkey" FOREIGN KEY ("empresaId", "insumoId") REFERENCES "Insumo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_empresaId_proveedorConsignacionId_fkey" FOREIGN KEY ("empresaId", "proveedorConsignacionId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "DisponibilidadProducto" ADD CONSTRAINT "DisponibilidadProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_empresaId_grupoId_fkey" FOREIGN KEY ("empresaId", "grupoId") REFERENCES "Grupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Grupo" ADD CONSTRAINT "Grupo_empresaId_grupoPadreId_fkey" FOREIGN KEY ("empresaId", "grupoPadreId") REFERENCES "Grupo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_empresaId_unidadCompraId_fkey" FOREIGN KEY ("empresaId", "unidadCompraId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PagoConsignante" ADD CONSTRAINT "PagoConsignante_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorPorProducto" ADD CONSTRAINT "ProveedorPorProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorPorProducto" ADD CONSTRAINT "ProveedorPorProducto_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ProveedorPorProducto" ADD CONSTRAINT "ProveedorPorProducto_empresaId_unidadCompraId_fkey" FOREIGN KEY ("empresaId", "unidadCompraId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_empresaId_rendimientoUnidadId_fkey" FOREIGN KEY ("empresaId", "rendimientoUnidadId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaVersion" ADD CONSTRAINT "RecetaVersion_empresaId_racionUnidadId_fkey" FOREIGN KEY ("empresaId", "racionUnidadId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaIngrediente" ADD CONSTRAINT "RecetaIngrediente_empresaId_recetaVersionId_fkey" FOREIGN KEY ("empresaId", "recetaVersionId") REFERENCES "RecetaVersion"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecetaIngrediente" ADD CONSTRAINT "RecetaIngrediente_empresaId_insumoProductoId_fkey" FOREIGN KEY ("empresaId", "insumoProductoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaIngrediente" ADD CONSTRAINT "RecetaIngrediente_empresaId_unidadId_fkey" FOREIGN KEY ("empresaId", "unidadId") REFERENCES "Unidad"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_empresaId_recetaIngredienteId_fkey" FOREIGN KEY ("empresaId", "recetaIngredienteId") REFERENCES "RecetaIngrediente"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "SustitutoRecetaIngrediente" ADD CONSTRAINT "SustitutoRecetaIngrediente_empresaId_insumoSustitutoId_fkey" FOREIGN KEY ("empresaId", "insumoSustitutoId") REFERENCES "Insumo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RecetaPaso" ADD CONSTRAINT "RecetaPaso_empresaId_recetaVersionId_fkey" FOREIGN KEY ("empresaId", "recetaVersionId") REFERENCES "RecetaVersion"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecetaPasoIngrediente" ADD CONSTRAINT "RecetaPasoIngrediente_empresaId_recetaPasoId_fkey" FOREIGN KEY ("empresaId", "recetaPasoId") REFERENCES "RecetaPaso"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RecetaPasoIngrediente" ADD CONSTRAINT "RecetaPasoIngrediente_empresaId_recetaIngredienteId_fkey" FOREIGN KEY ("empresaId", "recetaIngredienteId") REFERENCES "RecetaIngrediente"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "Seccion" ADD CONSTRAINT "Seccion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId", "clienteId") REFERENCES "Cliente"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_promoCuentaId_fkey" FOREIGN KEY ("empresaId", "promoCuentaId") REFERENCES "PromoCuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_seccionDestinoId_fkey" FOREIGN KEY ("empresaId", "seccionDestinoId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_motivoId_fkey" FOREIGN KEY ("empresaId", "motivoId") REFERENCES "MotivoMerma"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Operacion" ADD CONSTRAINT "Operacion_empresaId_destinoId_fkey" FOREIGN KEY ("empresaId", "destinoId") REFERENCES "DestinoConsumo"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_operacionId_fkey" FOREIGN KEY ("empresaId", "operacionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_seccionId_fkey" FOREIGN KEY ("empresaId", "seccionId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_conteoFisicoId_fkey" FOREIGN KEY ("empresaId", "conteoFisicoId") REFERENCES "ConteoFisico"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_traspasoSucursalId_fkey" FOREIGN KEY ("empresaId", "traspasoSucursalId") REFERENCES "TraspasoSucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "MovimientoStock" ADD CONSTRAINT "MovimientoStock_empresaId_sustituyeAProductoId_fkey" FOREIGN KEY ("empresaId", "sustituyeAProductoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConteoFisico" ADD CONSTRAINT "ConteoFisico_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConteoFisico" ADD CONSTRAINT "ConteoFisico_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ConteoFisico" ADD CONSTRAINT "ConteoFisico_empresaId_seccionId_fkey" FOREIGN KEY ("empresaId", "seccionId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalProducto" ADD CONSTRAINT "PrecioLocalProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PrecioLocalProducto" ADD CONSTRAINT "PrecioLocalProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_empresaId_recetaIngredienteId_fkey" FOREIGN KEY ("empresaId", "recetaIngredienteId") REFERENCES "RecetaIngrediente"("empresaId", "id") ON DELETE CASCADE ON UPDATE CASCADE;
ALTER TABLE "RendimientoLocalIngrediente" ADD CONSTRAINT "RendimientoLocalIngrediente_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "FrecuenciaConteoProducto" ADD CONSTRAINT "FrecuenciaConteoProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "StockMinimoProducto" ADD CONSTRAINT "StockMinimoProducto_empresaId_seccionId_fkey" FOREIGN KEY ("empresaId", "seccionId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SeccionHabitualProducto" ADD CONSTRAINT "SeccionHabitualProducto_empresaId_seccionId_fkey" FOREIGN KEY ("empresaId", "seccionId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromocionProducto" ADD CONSTRAINT "PromocionProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_origenSucursalId_fkey" FOREIGN KEY ("empresaId", "origenSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_destinoSucursalId_fkey" FOREIGN KEY ("empresaId", "destinoSucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_seccionOrigenId_fkey" FOREIGN KEY ("empresaId", "seccionOrigenId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TraspasoSucursal" ADD CONSTRAINT "TraspasoSucursal_empresaId_seccionDestinoId_fkey" FOREIGN KEY ("empresaId", "seccionDestinoId") REFERENCES "Seccion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ContenidoCartaProducto" ADD CONSTRAINT "ContenidoCartaProducto_empresaId_generoCartaId_fkey" FOREIGN KEY ("empresaId", "generoCartaId") REFERENCES "GeneroCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "ItemAgrupadoCarta" ADD CONSTRAINT "ItemAgrupadoCarta_empresaId_generoCartaId_fkey" FOREIGN KEY ("empresaId", "generoCartaId") REFERENCES "GeneroCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_empresaId_itemAgrupadoCartaId_fkey" FOREIGN KEY ("empresaId", "itemAgrupadoCartaId") REFERENCES "ItemAgrupadoCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "OpcionItemAgrupadoCarta" ADD CONSTRAINT "OpcionItemAgrupadoCarta_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCarta" ADD CONSTRAINT "PromoCarta_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_empresaId_promoCartaId_fkey" FOREIGN KEY ("empresaId", "promoCartaId") REFERENCES "PromoCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCartaCupo" ADD CONSTRAINT "PromoCartaCupo_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "SucursalPublica" ADD CONSTRAINT "SucursalPublica_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "TemaCartaSucursal" ADD CONSTRAINT "TemaCartaSucursal_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Mesa" ADD CONSTRAINT "Mesa_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_mesaId_fkey" FOREIGN KEY ("empresaId", "mesaId") REFERENCES "Mesa"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "Cuenta" ADD CONSTRAINT "Cuenta_empresaId_clienteId_fkey" FOREIGN KEY ("empresaId", "clienteId") REFERENCES "Cliente"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PromoCuenta" ADD CONSTRAINT "PromoCuenta_empresaId_promoCartaId_fkey" FOREIGN KEY ("empresaId", "promoCartaId") REFERENCES "PromoCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_productoId_fkey" FOREIGN KEY ("empresaId", "productoId") REFERENCES "Producto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_anulaAItemId_fkey" FOREIGN KEY ("empresaId", "anulaAItemId") REFERENCES "CuentaItem"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_operacionId_fkey" FOREIGN KEY ("empresaId", "operacionId") REFERENCES "Operacion"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_empresaId_promoCuentaId_fkey" FOREIGN KEY ("empresaId", "promoCuentaId") REFERENCES "PromoCuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_empresaId_cuentaId_fkey" FOREIGN KEY ("empresaId", "cuentaId") REFERENCES "Cuenta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "EjemplarBoleta" ADD CONSTRAINT "EjemplarBoleta_empresaId_corrigeAId_fkey" FOREIGN KEY ("empresaId", "corrigeAId") REFERENCES "EjemplarBoleta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_usuarioId_fkey" FOREIGN KEY ("usuarioId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- 11) Membresías: cada usuario con alguna UsuarioSucursal pasa a pertenecer a la empresa por defecto (rolEmpresa NULL: hoy no
--     existe el concepto de gerente de empresa; se asigna a mano o con el script crear-empresa).
INSERT INTO "UsuarioEmpresa" ("id", "usuarioId", "empresaId", "rolEmpresa", "activo")
SELECT gen_random_uuid()::text, us."usuarioId", 'empresa_principal', NULL, bool_or(us."activo")
FROM "UsuarioSucursal" us
GROUP BY us."usuarioId";

-- 12) Permisos para el rol de ejecución, si existe (lo crea scripts/operaciones/crear-rol-motor2-app.sql, fuera de las migraciones).
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    GRANT SELECT, INSERT, UPDATE, DELETE ON "Empresa", "UsuarioEmpresa" TO motor2_app;
  END IF;
END
$$;
