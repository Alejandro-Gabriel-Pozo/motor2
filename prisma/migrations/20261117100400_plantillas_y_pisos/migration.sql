-- Plantillas de rol, versiones y pisos de plataforma (roles propios, etapa EB-1; decisión del dueño 2026-11-17: «Sí, como Pedernal, etapa posterior (Recomendada)»). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base.
-- ADITIVA: agrega 4 tablas y funciones; no toca ninguna tabla existente. El código viejo las ignora. NADA del guard ni de las pantallas las lee todavía (el guard se conecta en EB-3): aplicarla no cambia lo que ve ni puede hacer ninguna empresa.
--
--   PlantillaDeRol      las tres plantillas (GERENTE, ADMINISTRADOR, OPERADOR). Global. GERENTE existe pero NO lleva versiones.
--   VersionDePlantilla  qué acciones puede VER y cuáles EDITAR una plantilla (Editar ⊆ Ver). SOLO SE AGREGA (número consecutivo por plantilla; la vigente se CALCULA: la de número mayor). Solo ADMINISTRADOR y OPERADOR.
--   PisoDePlataforma    el piso de una acción: SOLO_GERENTE o TODOS_LOS_ROLES. Sin fila = sin piso. Cambia de tipo (sube `version`), nunca de acción, y no se borra.
--   AccionIntroducida   las acciones del catálogo que la plataforma ya conoce (ya sumadas a las plantillas y con piso). Solo se agrega.
--
-- Diferencias con Pedernal (0061_permisos_configurables), declaradas en docs/diseno-roles-propios-versiones-plantillas-pisos-2026-11-17.md (D-A a D-N). La más importante: en Pedernal ninguna plantilla puede llevar una acción SOLO_GERENTE; en Motor2
-- ADMINISTRADOR v1 lleva las 12 del gobierno de la empresa (respuesta (b) del dueño), así que el control de SOLO_GERENTE aplica a OPERADOR (y, en EB-2, a los roles propios), no a ADMINISTRADOR.
--
-- Privilegios y candados (igual que Plan / VersionDePlan): `motor2_app` pierde todo; `motor2_plataforma` lee las cuatro y escribe sin DELETE ni TRUNCATE. El dueño queda exento de `proteger_plantillas_y_pisos` (migra y limpia la base de test: puede TRUNCATE);
-- los triggers «solo se agrega» no exceptúan ni al dueño: ningún UPDATE ni DELETE de una versión, una plantilla o una acción introducida, ni DELETE de un piso.
--
-- SEMILLA (entre los marcadores, generada por código desde el catálogo de acciones; un test la compara con el generador): las 3 plantillas, los pisos por equivalencia de nivel (SOLO_GERENTE a las acciones de nivel gerente y administrador de sistema),
-- la versión 1 de ADMINISTRADOR y de OPERADOR (Ver = Editar, igual que la matriz de fábrica) y todas las claves como ya introducidas. Idempotente.
-- Reversa: down.sql (a mano, como dueño; después `prisma migrate resolve --rolled-back 20261117100400_plantillas_y_pisos`).

-- 0) Formas permitidas de una clave de acción y de una lista de claves (lo que se PERMITE, no lo que se prohíbe).
CREATE FUNCTION clave_de_accion_valida(p text) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $f$
  SELECT p IS NOT NULL AND p ~ '^[a-z][a-z0-9_]{1,79}$'
$f$;

CREATE FUNCTION claves_de_accion_validas(p text[]) RETURNS boolean
LANGUAGE sql IMMUTABLE
SET search_path = pg_catalog, public, pg_temp
AS $f$
  SELECT p IS NOT NULL
    AND coalesce(array_ndims(p), 1) = 1
    AND cardinality(p) <= 1000
    AND cardinality(p) = (SELECT count(DISTINCT x) FROM unnest(p) AS x)
    AND NOT EXISTS (SELECT 1 FROM unnest(p) AS x WHERE NOT clave_de_accion_valida(x))
$f$;

-- 1) Tablas
CREATE TABLE "PlantillaDeRol" (
    "id" UUID NOT NULL,
    "clave" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "PlantillaDeRol_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PlantillaDeRol_clave_check" CHECK ("clave" IN ('GERENTE', 'ADMINISTRADOR', 'OPERADOR'))
);
CREATE UNIQUE INDEX "PlantillaDeRol_clave_key" ON "PlantillaDeRol"("clave");

CREATE TABLE "VersionDePlantilla" (
    "id" UUID NOT NULL,
    "plantillaClave" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "accionesVer" TEXT[] NOT NULL,
    "accionesEditar" TEXT[] NOT NULL,
    "autor" TEXT NOT NULL,
    "claveIdempotencia" UUID NOT NULL,
    "payloadHash" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "VersionDePlantilla_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "VersionDePlantilla_plantilla_check" CHECK ("plantillaClave" IN ('ADMINISTRADOR', 'OPERADOR')),
    CONSTRAINT "VersionDePlantilla_numero_check" CHECK ("numero" >= 1),
    CONSTRAINT "VersionDePlantilla_acciones_ver_check" CHECK (claves_de_accion_validas("accionesVer")),
    CONSTRAINT "VersionDePlantilla_acciones_editar_check" CHECK (claves_de_accion_validas("accionesEditar")),
    CONSTRAINT "VersionDePlantilla_editar_en_ver_check" CHECK ("accionesEditar" <@ "accionesVer"),
    CONSTRAINT "VersionDePlantilla_autor_check" CHECK (length(btrim("autor")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "VersionDePlantilla_claveIdempotencia_key" ON "VersionDePlantilla"("claveIdempotencia");
CREATE UNIQUE INDEX "VersionDePlantilla_plantillaClave_numero_key" ON "VersionDePlantilla"("plantillaClave", "numero");
ALTER TABLE "VersionDePlantilla" ADD CONSTRAINT "VersionDePlantilla_plantillaClave_fkey" FOREIGN KEY ("plantillaClave") REFERENCES "PlantillaDeRol"("clave") ON DELETE RESTRICT ON UPDATE RESTRICT;

CREATE TABLE "PisoDePlataforma" (
    "id" UUID NOT NULL,
    "accionClave" TEXT NOT NULL,
    "tipo" TEXT NOT NULL,
    "autor" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "PisoDePlataforma_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "PisoDePlataforma_accion_check" CHECK (clave_de_accion_valida("accionClave")),
    CONSTRAINT "PisoDePlataforma_tipo_check" CHECK ("tipo" IN ('SOLO_GERENTE', 'TODOS_LOS_ROLES')),
    CONSTRAINT "PisoDePlataforma_version_check" CHECK ("version" >= 1),
    CONSTRAINT "PisoDePlataforma_autor_check" CHECK (length(btrim("autor")) BETWEEN 1 AND 200)
);
CREATE UNIQUE INDEX "PisoDePlataforma_accionClave_key" ON "PisoDePlataforma"("accionClave");

CREATE TABLE "AccionIntroducida" (
    "id" UUID NOT NULL,
    "accionClave" TEXT NOT NULL,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT now(),

    CONSTRAINT "AccionIntroducida_pkey" PRIMARY KEY ("id"),
    CONSTRAINT "AccionIntroducida_accion_check" CHECK (clave_de_accion_valida("accionClave"))
);
CREATE UNIQUE INDEX "AccionIntroducida_accionClave_key" ON "AccionIntroducida"("accionClave");

-- 2) RLS: solo la plataforma (global, sin empresa). Sin FORCE: el dueño migra y limpia la base de test.
ALTER TABLE "PlantillaDeRol" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "PlantillaDeRol" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');
ALTER TABLE "VersionDePlantilla" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "VersionDePlantilla" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');
ALTER TABLE "PisoDePlataforma" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "PisoDePlataforma" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');
ALTER TABLE "AccionIntroducida" ENABLE ROW LEVEL SECURITY;
CREATE POLICY solo_plataforma ON "AccionIntroducida" FOR ALL
  USING (current_user = 'motor2_plataforma') WITH CHECK (current_user = 'motor2_plataforma');

-- 3) Privilegios (si los roles existen). Nadie recibe DELETE ni TRUNCATE.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PlantillaDeRol", "VersionDePlantilla", "PisoDePlataforma", "AccionIntroducida" FROM motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PlantillaDeRol", "VersionDePlantilla", "PisoDePlataforma", "AccionIntroducida" FROM motor2_plataforma;
    GRANT SELECT ON "PlantillaDeRol" TO motor2_plataforma;
    GRANT SELECT, INSERT ON "VersionDePlantilla", "AccionIntroducida" TO motor2_plataforma;
    GRANT SELECT, INSERT, UPDATE ON "PisoDePlataforma" TO motor2_plataforma;
  END IF;
END
$$;

-- 4) Candados. El dueño queda exento; `motor2_plataforma` solo INSERT en versiones, pisos y acciones introducidas y UPDATE en pisos; cualquier otro, nada.
CREATE FUNCTION proteger_plantillas_y_pisos() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF pg_has_role(current_user, (SELECT c.relowner FROM pg_class c WHERE c.oid = TG_RELID), 'USAGE') THEN
    IF TG_OP = 'UPDATE' OR TG_OP = 'INSERT' THEN RETURN NEW; END IF;
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NULL;
  END IF;
  IF current_user = 'motor2_plataforma' AND (
       (TG_OP = 'INSERT' AND TG_TABLE_NAME IN ('VersionDePlantilla', 'PisoDePlataforma', 'AccionIntroducida'))
       OR (TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'PisoDePlataforma')
     ) THEN
    RETURN NEW;
  END IF;
  RAISE EXCEPTION '% solo lo escribe la plataforma: % no permitido para el rol %', TG_TABLE_NAME, TG_OP, current_user
    USING ERRCODE = 'insufficient_privilege';
END
$$;

CREATE TRIGGER "PlantillaDeRol_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "PlantillaDeRol"
  FOR EACH ROW EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "PlantillaDeRol_solo_plataforma_truncate" BEFORE TRUNCATE ON "PlantillaDeRol"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "VersionDePlantilla_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "VersionDePlantilla"
  FOR EACH ROW EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "VersionDePlantilla_solo_plataforma_truncate" BEFORE TRUNCATE ON "VersionDePlantilla"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "PisoDePlataforma_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "PisoDePlataforma"
  FOR EACH ROW EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "PisoDePlataforma_solo_plataforma_truncate" BEFORE TRUNCATE ON "PisoDePlataforma"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "AccionIntroducida_solo_plataforma_fila" BEFORE INSERT OR UPDATE OR DELETE ON "AccionIntroducida"
  FOR EACH ROW EXECUTE FUNCTION proteger_plantillas_y_pisos();
CREATE TRIGGER "AccionIntroducida_solo_plataforma_truncate" BEFORE TRUNCATE ON "AccionIntroducida"
  FOR EACH STATEMENT EXECUTE FUNCTION proteger_plantillas_y_pisos();

-- 5) Solo se agrega: ni el dueño actualiza ni borra una plantilla, una versión o una acción introducida; un piso no se borra (su tipo sí cambia, ver 8).
CREATE FUNCTION solo_se_agrega_plantillas_y_pisos() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION '% solo se agrega: % no permitido', TG_TABLE_NAME, TG_OP USING ERRCODE = 'integrity_constraint_violation';
END
$$;

CREATE TRIGGER "PlantillaDeRol_solo_se_agrega" BEFORE UPDATE OR DELETE ON "PlantillaDeRol"
  FOR EACH ROW EXECUTE FUNCTION solo_se_agrega_plantillas_y_pisos();
CREATE TRIGGER "VersionDePlantilla_solo_se_agrega" BEFORE UPDATE OR DELETE ON "VersionDePlantilla"
  FOR EACH ROW EXECUTE FUNCTION solo_se_agrega_plantillas_y_pisos();
CREATE TRIGGER "AccionIntroducida_solo_se_agrega" BEFORE UPDATE OR DELETE ON "AccionIntroducida"
  FOR EACH ROW EXECUTE FUNCTION solo_se_agrega_plantillas_y_pisos();
CREATE TRIGGER "PisoDePlataforma_no_se_borra" BEFORE DELETE ON "PisoDePlataforma"
  FOR EACH ROW EXECUTE FUNCTION solo_se_agrega_plantillas_y_pisos();

-- 6) ¿Una lista de acciones cumple los pisos de la plataforma? Devuelve '' si cumple, o el motivo. Fail-closed: sin ningún piso legible se rechaza (no se publica a ciegas).
--    SOLO_GERENTE se controla en toda plantilla MENOS ADMINISTRADOR (lleva las del gobierno de la empresa, diferencia D-E); TODOS_LOS_ROLES se controla en todas.
CREATE FUNCTION incumplimiento_de_pisos(p_destino text, p_acciones text[]) RETURNS text
LANGUAGE plpgsql STABLE
AS $$
DECLARE
  sobrantes text;
  faltantes text;
BEGIN
  IF NOT EXISTS (SELECT 1 FROM "PisoDePlataforma") THEN
    RETURN 'no se pueden leer los pisos de la plataforma';
  END IF;
  IF p_destino IS DISTINCT FROM 'ADMINISTRADOR' THEN
    SELECT string_agg("accionClave", ', ' ORDER BY "accionClave") INTO sobrantes
    FROM "PisoDePlataforma" WHERE "tipo" = 'SOLO_GERENTE' AND "accionClave" = ANY (p_acciones);
    IF sobrantes IS NOT NULL THEN
      RETURN 'acciones de piso SOLO_GERENTE: ' || sobrantes;
    END IF;
  END IF;
  SELECT string_agg("accionClave", ', ' ORDER BY "accionClave") INTO faltantes
  FROM "PisoDePlataforma" WHERE "tipo" = 'TODOS_LOS_ROLES' AND NOT ("accionClave" = ANY (p_acciones));
  IF faltantes IS NOT NULL THEN
    RETURN 'faltan acciones de piso TODOS_LOS_ROLES: ' || faltantes;
  END IF;
  RETURN '';
END
$$;

-- 7) Alta de una versión: el número es el SIGUIENTE al mayor de la plantilla y la lista cumple los pisos. (Dos altas a la vez con el mismo número las frena el índice único; la aplicación además serializa con un candado.)
CREATE FUNCTION alta_de_version_de_plantilla() RETURNS trigger
LANGUAGE plpgsql
AS $$
DECLARE
  siguiente integer;
  incumple text;
BEGIN
  SELECT COALESCE(max("numero"), 0) + 1 INTO siguiente FROM "VersionDePlantilla" WHERE "plantillaClave" = NEW."plantillaClave";
  IF NEW."numero" IS DISTINCT FROM siguiente THEN
    RAISE EXCEPTION 'El número de la versión tiene que ser el siguiente de la plantilla (%).', siguiente
      USING ERRCODE = 'check_violation', CONSTRAINT = 'VersionDePlantilla_numero_invalido';
  END IF;
  incumple := incumplimiento_de_pisos(NEW."plantillaClave", NEW."accionesVer");
  IF incumple <> '' THEN
    RAISE EXCEPTION 'La versión no cumple los pisos de la plataforma: %', incumple
      USING ERRCODE = 'check_violation', CONSTRAINT = 'VersionDePlantilla_pisos';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "VersionDePlantilla_alta" BEFORE INSERT ON "VersionDePlantilla"
  FOR EACH ROW EXECUTE FUNCTION alta_de_version_de_plantilla();

-- 8) Un piso cambia de TIPO, nunca de acción: id, acción y alta no se tocan; cada cambio sube `version` y `actualizadoEn`.
CREATE FUNCTION cambio_de_piso_de_plataforma() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."accionClave" IS DISTINCT FROM OLD."accionClave" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'Un piso cambia de tipo, nunca de acción'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'PisoDePlataforma_inmutable';
  END IF;
  NEW."version" := OLD."version" + 1;
  NEW."actualizadoEn" := now();
  RETURN NEW;
END
$$;
CREATE TRIGGER "PisoDePlataforma_cambio" BEFORE UPDATE ON "PisoDePlataforma"
  FOR EACH ROW EXECUTE FUNCTION cambio_de_piso_de_plataforma();

-- 9) Semilla de la migración
-- >>> SEMILLA GENERADA >>>
INSERT INTO "PlantillaDeRol" ("id", "clave") VALUES
  ('00000000-0000-4000-8000-0000000c0001', 'GERENTE'),
  ('00000000-0000-4000-8000-0000000c0002', 'ADMINISTRADOR'),
  ('00000000-0000-4000-8000-0000000c0003', 'OPERADOR')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PisoDePlataforma" ("id", "accionClave", "tipo", "autor") VALUES
  (gen_random_uuid(), 'activar_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'activar_usuario_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'alta_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'apagar_cuenta_empresa', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'capacidades_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'gestion_permisos', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'gestion_roles', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'gestion_usuarios', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'notas_usuario_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'renombrar_rol', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'renombrar_sucursal', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'traspasar_gerencia', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'ver_auditoria', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos'),
  (gen_random_uuid(), 'ver_auditoria_empresa', 'SOLO_GERENTE', 'migracion:plantillas_y_pisos')
ON CONFLICT ("accionClave") DO NOTHING;

INSERT INTO "VersionDePlantilla" ("id", "plantillaClave", "numero", "accionesVer", "accionesEditar", "autor", "claveIdempotencia", "payloadHash")
SELECT '00000000-0000-4000-8000-0000000c0011', 'ADMINISTRADOR', 1,
  ARRAY['activar_sucursal', 'activar_usuario_sucursal', 'alta_producto', 'alta_sucursal', 'anular_compra', 'anular_venta', 'apagar_cuenta_empresa', 'caja_abrir_sesion', 'caja_anular_movimiento_ajeno', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_ver', 'calibrar_rendimiento_local', 'cancelar_conteo', 'capacidades_sucursal', 'carta_contenido_producto', 'carta_copiar_de_sucursal', 'carta_generos', 'carta_items_agrupados', 'carta_portal', 'carta_producto_descuento', 'carta_promo_activar', 'carta_promo_definir', 'carta_promo_precio_local', 'carta_secciones', 'carta_tema', 'carta_ver', 'categoria_alta', 'categorias', 'clientes', 'cobrar_cuenta', 'comparar_precios', 'compra_controlar_recepcion', 'compra_recibir', 'compra_repartir', 'conteo_frecuencia', 'conteo_resolver_pendiente', 'corregir_compra', 'declarar_pago_compra', 'gestion_permisos', 'gestion_roles', 'gestion_usuarios', 'grupos_familia', 'guardar_receta', 'insumo_alta', 'insumo_renombrar_fusionar', 'insumos_mezclados', 'margen_objetivo_editar', 'motivos_destino_consumo', 'motivos_merma', 'notas_usuario_sucursal', 'opcion_apagar_en_sucursal', 'opciones_definir', 'pagar_consignante', 'partes_desactivar', 'partes_editar', 'partes_ver', 'pos_abrir_cuenta', 'pos_alta_mesa', 'pos_anular_item', 'pos_asignar_cliente', 'pos_cerrar_cuenta', 'pos_emitir_ticket_corregido', 'pos_enviar_a_cocina', 'pos_liberar_mesa', 'pos_mesas', 'pos_tomar_pedido', 'precio_local', 'proceso_ajuste', 'proceso_compra', 'proceso_consumo', 'proceso_control', 'proceso_devolucion_cliente', 'proceso_devolucion_consignacion', 'proceso_devolucion_proveedor', 'proceso_merma', 'proceso_produccion', 'proceso_transferencia', 'proceso_venta', 'producto_asignar_insumo', 'producto_campos_sensibles', 'producto_disponibilidad', 'producto_editar', 'producto_opciones_admitidas', 'producto_presentaciones', 'producto_sincronizar_precio_carta', 'producto_ver_catalogo', 'promo_menu_del_dia', 'proveedor_alta', 'proveedores', 'receta_sucursal_copiar', 'receta_sucursal_editar', 'receta_sucursal_volver_central', 'renombrar_rol', 'renombrar_sucursal', 'reporte_categorias', 'reporte_compras', 'reporte_consolidado', 'reporte_conteos', 'reporte_costos', 'reporte_descuentos_clientes', 'reporte_descuentos_productos', 'reporte_devoluciones', 'reporte_diferencias', 'reporte_historial', 'reporte_historial_importes', 'reporte_huecos_catalogo', 'reporte_insumos_sin_receta', 'reporte_margen_promociones', 'reporte_perdidas', 'reporte_periodo', 'reporte_rendimiento_recetas', 'reporte_rendimiento_sucursal', 'reporte_resumen', 'reporte_rotacion_mesas', 'reporte_salud', 'reporte_sin_receta', 'reporte_tickets', 'reporte_trazabilidad', 'reporte_valuacion', 'reporte_vencimientos', 'reporte_ventas_por_seccion', 'secciones', 'stock_minimo', 'stock_reclasificar', 'stock_seccion_habitual', 'traspaso_aceptar', 'traspaso_aprobar', 'traspaso_cancelar_solicitud', 'traspaso_confirmar_reingreso', 'traspaso_enviar_directo', 'traspaso_rechazar_envio', 'traspaso_rechazar_solicitud', 'traspaso_solicitar', 'traspaso_ver_bandeja', 'unidades', 'ver_auditoria', 'ver_stock']::text[],
  ARRAY['activar_sucursal', 'activar_usuario_sucursal', 'alta_producto', 'alta_sucursal', 'anular_compra', 'anular_venta', 'apagar_cuenta_empresa', 'caja_abrir_sesion', 'caja_anular_movimiento_ajeno', 'caja_cerrar_sesion', 'caja_mover_efectivo', 'caja_ver', 'calibrar_rendimiento_local', 'cancelar_conteo', 'capacidades_sucursal', 'carta_contenido_producto', 'carta_copiar_de_sucursal', 'carta_generos', 'carta_items_agrupados', 'carta_portal', 'carta_producto_descuento', 'carta_promo_activar', 'carta_promo_definir', 'carta_promo_precio_local', 'carta_secciones', 'carta_tema', 'carta_ver', 'categoria_alta', 'categorias', 'clientes', 'cobrar_cuenta', 'comparar_precios', 'compra_controlar_recepcion', 'compra_recibir', 'compra_repartir', 'conteo_frecuencia', 'conteo_resolver_pendiente', 'corregir_compra', 'declarar_pago_compra', 'gestion_permisos', 'gestion_roles', 'gestion_usuarios', 'grupos_familia', 'guardar_receta', 'insumo_alta', 'insumo_renombrar_fusionar', 'insumos_mezclados', 'margen_objetivo_editar', 'motivos_destino_consumo', 'motivos_merma', 'notas_usuario_sucursal', 'opcion_apagar_en_sucursal', 'opciones_definir', 'pagar_consignante', 'partes_desactivar', 'partes_editar', 'partes_ver', 'pos_abrir_cuenta', 'pos_alta_mesa', 'pos_anular_item', 'pos_asignar_cliente', 'pos_cerrar_cuenta', 'pos_emitir_ticket_corregido', 'pos_enviar_a_cocina', 'pos_liberar_mesa', 'pos_mesas', 'pos_tomar_pedido', 'precio_local', 'proceso_ajuste', 'proceso_compra', 'proceso_consumo', 'proceso_control', 'proceso_devolucion_cliente', 'proceso_devolucion_consignacion', 'proceso_devolucion_proveedor', 'proceso_merma', 'proceso_produccion', 'proceso_transferencia', 'proceso_venta', 'producto_asignar_insumo', 'producto_campos_sensibles', 'producto_disponibilidad', 'producto_editar', 'producto_opciones_admitidas', 'producto_presentaciones', 'producto_sincronizar_precio_carta', 'producto_ver_catalogo', 'promo_menu_del_dia', 'proveedor_alta', 'proveedores', 'receta_sucursal_copiar', 'receta_sucursal_editar', 'receta_sucursal_volver_central', 'renombrar_rol', 'renombrar_sucursal', 'reporte_categorias', 'reporte_compras', 'reporte_consolidado', 'reporte_conteos', 'reporte_costos', 'reporte_descuentos_clientes', 'reporte_descuentos_productos', 'reporte_devoluciones', 'reporte_diferencias', 'reporte_historial', 'reporte_historial_importes', 'reporte_huecos_catalogo', 'reporte_insumos_sin_receta', 'reporte_margen_promociones', 'reporte_perdidas', 'reporte_periodo', 'reporte_rendimiento_recetas', 'reporte_rendimiento_sucursal', 'reporte_resumen', 'reporte_rotacion_mesas', 'reporte_salud', 'reporte_sin_receta', 'reporte_tickets', 'reporte_trazabilidad', 'reporte_valuacion', 'reporte_vencimientos', 'reporte_ventas_por_seccion', 'secciones', 'stock_minimo', 'stock_reclasificar', 'stock_seccion_habitual', 'traspaso_aceptar', 'traspaso_aprobar', 'traspaso_cancelar_solicitud', 'traspaso_confirmar_reingreso', 'traspaso_enviar_directo', 'traspaso_rechazar_envio', 'traspaso_rechazar_solicitud', 'traspaso_solicitar', 'traspaso_ver_bandeja', 'unidades', 'ver_auditoria', 'ver_stock']::text[],
  'migracion:plantillas_y_pisos', '00000000-0000-4000-8000-0000000c0012', 'semilla-eb1'
WHERE NOT EXISTS (SELECT 1 FROM "VersionDePlantilla" WHERE "plantillaClave" = 'ADMINISTRADOR');

INSERT INTO "VersionDePlantilla" ("id", "plantillaClave", "numero", "accionesVer", "accionesEditar", "autor", "claveIdempotencia", "payloadHash")
SELECT '00000000-0000-4000-8000-0000000c0021', 'OPERADOR', 1,
  ARRAY['alta_producto', 'categoria_alta', 'compra_controlar_recepcion', 'conteo_frecuencia', 'conteo_resolver_pendiente', 'insumo_alta', 'opcion_apagar_en_sucursal', 'partes_editar', 'partes_ver', 'proceso_compra', 'proceso_consumo', 'proceso_control', 'proceso_devolucion_cliente', 'proceso_devolucion_consignacion', 'proceso_devolucion_proveedor', 'proceso_merma', 'proceso_produccion', 'proceso_transferencia', 'proceso_venta', 'producto_asignar_insumo', 'producto_disponibilidad', 'producto_editar', 'producto_presentaciones', 'producto_ver_catalogo', 'proveedor_alta', 'reporte_conteos', 'stock_reclasificar', 'traspaso_aceptar', 'traspaso_aprobar', 'traspaso_cancelar_solicitud', 'traspaso_confirmar_reingreso', 'traspaso_enviar_directo', 'traspaso_rechazar_envio', 'traspaso_rechazar_solicitud', 'traspaso_solicitar', 'traspaso_ver_bandeja', 'ver_stock']::text[],
  ARRAY['alta_producto', 'categoria_alta', 'compra_controlar_recepcion', 'conteo_frecuencia', 'conteo_resolver_pendiente', 'insumo_alta', 'opcion_apagar_en_sucursal', 'partes_editar', 'partes_ver', 'proceso_compra', 'proceso_consumo', 'proceso_control', 'proceso_devolucion_cliente', 'proceso_devolucion_consignacion', 'proceso_devolucion_proveedor', 'proceso_merma', 'proceso_produccion', 'proceso_transferencia', 'proceso_venta', 'producto_asignar_insumo', 'producto_disponibilidad', 'producto_editar', 'producto_presentaciones', 'producto_ver_catalogo', 'proveedor_alta', 'reporte_conteos', 'stock_reclasificar', 'traspaso_aceptar', 'traspaso_aprobar', 'traspaso_cancelar_solicitud', 'traspaso_confirmar_reingreso', 'traspaso_enviar_directo', 'traspaso_rechazar_envio', 'traspaso_rechazar_solicitud', 'traspaso_solicitar', 'traspaso_ver_bandeja', 'ver_stock']::text[],
  'migracion:plantillas_y_pisos', '00000000-0000-4000-8000-0000000c0022', 'semilla-eb1'
WHERE NOT EXISTS (SELECT 1 FROM "VersionDePlantilla" WHERE "plantillaClave" = 'OPERADOR');

INSERT INTO "AccionIntroducida" ("id", "accionClave") VALUES
  (gen_random_uuid(), 'activar_sucursal'),
  (gen_random_uuid(), 'activar_usuario_sucursal'),
  (gen_random_uuid(), 'alta_producto'),
  (gen_random_uuid(), 'alta_sucursal'),
  (gen_random_uuid(), 'anular_compra'),
  (gen_random_uuid(), 'anular_venta'),
  (gen_random_uuid(), 'apagar_cuenta_empresa'),
  (gen_random_uuid(), 'caja_abrir_sesion'),
  (gen_random_uuid(), 'caja_anular_movimiento_ajeno'),
  (gen_random_uuid(), 'caja_cerrar_sesion'),
  (gen_random_uuid(), 'caja_mover_efectivo'),
  (gen_random_uuid(), 'caja_ver'),
  (gen_random_uuid(), 'calibrar_rendimiento_local'),
  (gen_random_uuid(), 'cancelar_conteo'),
  (gen_random_uuid(), 'capacidades_sucursal'),
  (gen_random_uuid(), 'carta_contenido_producto'),
  (gen_random_uuid(), 'carta_copiar_de_sucursal'),
  (gen_random_uuid(), 'carta_generos'),
  (gen_random_uuid(), 'carta_items_agrupados'),
  (gen_random_uuid(), 'carta_portal'),
  (gen_random_uuid(), 'carta_producto_descuento'),
  (gen_random_uuid(), 'carta_promo_activar'),
  (gen_random_uuid(), 'carta_promo_definir'),
  (gen_random_uuid(), 'carta_promo_precio_local'),
  (gen_random_uuid(), 'carta_secciones'),
  (gen_random_uuid(), 'carta_tema'),
  (gen_random_uuid(), 'carta_ver'),
  (gen_random_uuid(), 'categoria_alta'),
  (gen_random_uuid(), 'categorias'),
  (gen_random_uuid(), 'clientes'),
  (gen_random_uuid(), 'cobrar_cuenta'),
  (gen_random_uuid(), 'comparar_precios'),
  (gen_random_uuid(), 'compra_controlar_recepcion'),
  (gen_random_uuid(), 'compra_recibir'),
  (gen_random_uuid(), 'compra_repartir'),
  (gen_random_uuid(), 'conteo_frecuencia'),
  (gen_random_uuid(), 'conteo_resolver_pendiente'),
  (gen_random_uuid(), 'corregir_compra'),
  (gen_random_uuid(), 'declarar_pago_compra'),
  (gen_random_uuid(), 'gestion_permisos'),
  (gen_random_uuid(), 'gestion_roles'),
  (gen_random_uuid(), 'gestion_usuarios'),
  (gen_random_uuid(), 'grupos_familia'),
  (gen_random_uuid(), 'guardar_receta'),
  (gen_random_uuid(), 'insumo_alta'),
  (gen_random_uuid(), 'insumo_renombrar_fusionar'),
  (gen_random_uuid(), 'insumos_mezclados'),
  (gen_random_uuid(), 'margen_objetivo_editar'),
  (gen_random_uuid(), 'motivos_destino_consumo'),
  (gen_random_uuid(), 'motivos_merma'),
  (gen_random_uuid(), 'notas_usuario_sucursal'),
  (gen_random_uuid(), 'opcion_apagar_en_sucursal'),
  (gen_random_uuid(), 'opciones_definir'),
  (gen_random_uuid(), 'pagar_consignante'),
  (gen_random_uuid(), 'partes_desactivar'),
  (gen_random_uuid(), 'partes_editar'),
  (gen_random_uuid(), 'partes_ver'),
  (gen_random_uuid(), 'pos_abrir_cuenta'),
  (gen_random_uuid(), 'pos_alta_mesa'),
  (gen_random_uuid(), 'pos_anular_item'),
  (gen_random_uuid(), 'pos_asignar_cliente'),
  (gen_random_uuid(), 'pos_cerrar_cuenta'),
  (gen_random_uuid(), 'pos_emitir_ticket_corregido'),
  (gen_random_uuid(), 'pos_enviar_a_cocina'),
  (gen_random_uuid(), 'pos_liberar_mesa'),
  (gen_random_uuid(), 'pos_mesas'),
  (gen_random_uuid(), 'pos_tomar_pedido'),
  (gen_random_uuid(), 'precio_local'),
  (gen_random_uuid(), 'proceso_ajuste'),
  (gen_random_uuid(), 'proceso_compra'),
  (gen_random_uuid(), 'proceso_consumo'),
  (gen_random_uuid(), 'proceso_control'),
  (gen_random_uuid(), 'proceso_devolucion_cliente'),
  (gen_random_uuid(), 'proceso_devolucion_consignacion'),
  (gen_random_uuid(), 'proceso_devolucion_proveedor'),
  (gen_random_uuid(), 'proceso_merma'),
  (gen_random_uuid(), 'proceso_produccion'),
  (gen_random_uuid(), 'proceso_transferencia'),
  (gen_random_uuid(), 'proceso_venta'),
  (gen_random_uuid(), 'producto_asignar_insumo'),
  (gen_random_uuid(), 'producto_campos_sensibles'),
  (gen_random_uuid(), 'producto_disponibilidad'),
  (gen_random_uuid(), 'producto_editar'),
  (gen_random_uuid(), 'producto_opciones_admitidas'),
  (gen_random_uuid(), 'producto_presentaciones'),
  (gen_random_uuid(), 'producto_sincronizar_precio_carta'),
  (gen_random_uuid(), 'producto_ver_catalogo'),
  (gen_random_uuid(), 'promo_menu_del_dia'),
  (gen_random_uuid(), 'proveedor_alta'),
  (gen_random_uuid(), 'proveedores'),
  (gen_random_uuid(), 'receta_sucursal_copiar'),
  (gen_random_uuid(), 'receta_sucursal_editar'),
  (gen_random_uuid(), 'receta_sucursal_volver_central'),
  (gen_random_uuid(), 'renombrar_rol'),
  (gen_random_uuid(), 'renombrar_sucursal'),
  (gen_random_uuid(), 'reporte_categorias'),
  (gen_random_uuid(), 'reporte_compras'),
  (gen_random_uuid(), 'reporte_consolidado'),
  (gen_random_uuid(), 'reporte_conteos'),
  (gen_random_uuid(), 'reporte_costos'),
  (gen_random_uuid(), 'reporte_descuentos_clientes'),
  (gen_random_uuid(), 'reporte_descuentos_productos'),
  (gen_random_uuid(), 'reporte_devoluciones'),
  (gen_random_uuid(), 'reporte_diferencias'),
  (gen_random_uuid(), 'reporte_historial'),
  (gen_random_uuid(), 'reporte_historial_importes'),
  (gen_random_uuid(), 'reporte_huecos_catalogo'),
  (gen_random_uuid(), 'reporte_insumos_sin_receta'),
  (gen_random_uuid(), 'reporte_margen_promociones'),
  (gen_random_uuid(), 'reporte_perdidas'),
  (gen_random_uuid(), 'reporte_periodo'),
  (gen_random_uuid(), 'reporte_rendimiento_recetas'),
  (gen_random_uuid(), 'reporte_rendimiento_sucursal'),
  (gen_random_uuid(), 'reporte_resumen'),
  (gen_random_uuid(), 'reporte_rotacion_mesas'),
  (gen_random_uuid(), 'reporte_salud'),
  (gen_random_uuid(), 'reporte_sin_receta'),
  (gen_random_uuid(), 'reporte_tickets'),
  (gen_random_uuid(), 'reporte_trazabilidad'),
  (gen_random_uuid(), 'reporte_valuacion'),
  (gen_random_uuid(), 'reporte_vencimientos'),
  (gen_random_uuid(), 'reporte_ventas_por_seccion'),
  (gen_random_uuid(), 'secciones'),
  (gen_random_uuid(), 'stock_minimo'),
  (gen_random_uuid(), 'stock_reclasificar'),
  (gen_random_uuid(), 'stock_seccion_habitual'),
  (gen_random_uuid(), 'traspasar_gerencia'),
  (gen_random_uuid(), 'traspaso_aceptar'),
  (gen_random_uuid(), 'traspaso_aprobar'),
  (gen_random_uuid(), 'traspaso_cancelar_solicitud'),
  (gen_random_uuid(), 'traspaso_confirmar_reingreso'),
  (gen_random_uuid(), 'traspaso_enviar_directo'),
  (gen_random_uuid(), 'traspaso_rechazar_envio'),
  (gen_random_uuid(), 'traspaso_rechazar_solicitud'),
  (gen_random_uuid(), 'traspaso_solicitar'),
  (gen_random_uuid(), 'traspaso_ver_bandeja'),
  (gen_random_uuid(), 'unidades'),
  (gen_random_uuid(), 'ver_auditoria'),
  (gen_random_uuid(), 'ver_auditoria_empresa'),
  (gen_random_uuid(), 'ver_stock')
ON CONFLICT ("accionClave") DO NOTHING;
-- <<< SEMILLA GENERADA <<<
