-- Verificación previa de 20261117100400_plantillas_y_pisos (plantillas, versiones y pisos de plataforma, EB-1). SOLO LEE (transacción de solo lectura). Se corre con el rol dueño en CADA base real ANTES de aprobar la migración
-- (y de nuevo DESPUÉS, comparando):
--   psql "<DIRECT_URL de la base>" -f prisma/migrations/20261117100400_plantillas_y_pisos/verificacion-previa.sql
-- Devuelve SOLO cuentas y nombres de rol (nunca nombres de empresa ni emails). Cómo leerla:
--   1. «tablas_ya_existentes» y «funciones_ya_existentes» tienen que dar 0 antes de aplicar.
--   2. «roles_presentes»: cuántos de `motor2_app` y `motor2_plataforma` existen (2 si los dos). Si falta `motor2_plataforma`, la migración no le da permisos: se los da `crear-rol-motor2-plataforma.sql` al correrlo.
--   3. «acciones_en_base»: las filas de `Accion` de esta base (la semilla de acciones; la migración NO las lee: toma las claves del catálogo del código).
-- EB-1 no cambia nada de lo que ve ni puede hacer una empresa: no hay nada que decidirle al dueño con estas cuentas, solo confirmar el estado de la base.
BEGIN READ ONLY;

SELECT (SELECT count(*) FROM pg_class WHERE relname IN ('PlantillaDeRol', 'VersionDePlantilla', 'PisoDePlataforma', 'AccionIntroducida') AND relkind = 'r') AS tablas_ya_existentes,
       (SELECT count(*) FROM pg_proc WHERE proname IN ('clave_de_accion_valida', 'claves_de_accion_validas', 'proteger_plantillas_y_pisos', 'solo_se_agrega_plantillas_y_pisos', 'incumplimiento_de_pisos', 'alta_de_version_de_plantilla', 'cambio_de_piso_de_plataforma')) AS funciones_ya_existentes,
       (SELECT count(*) FROM pg_roles WHERE rolname IN ('motor2_app', 'motor2_plataforma')) AS roles_presentes,
       (SELECT count(*) FROM "Accion") AS acciones_en_base;

-- DESPUÉS de aplicar (descomentar): 3 plantillas, 2 versiones (la 1 de ADMINISTRADOR y la 1 de OPERADOR), 14 pisos y una acción introducida por cada clave del catálogo (140).
-- SELECT (SELECT count(*) FROM "PlantillaDeRol") AS plantillas,
--        (SELECT count(*) FROM "VersionDePlantilla") AS versiones,
--        (SELECT count(*) FROM "PisoDePlataforma") AS pisos,
--        (SELECT count(*) FROM "AccionIntroducida") AS acciones_introducidas;

ROLLBACK;
