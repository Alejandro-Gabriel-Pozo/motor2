-- Carta, portal de la empresa PR-A (docs/diseno-carta-portal-e-identidad-niveles-6-a-10-2026-11-17.md §6.1, §13; Pedernal 0077 y 0078 en su versión final del 2026-11-17). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo).
-- Decisión del dueño (2026-11-17): «Migrar todo ya» (el modelo completo de Pedernal). Mitigación confirmada: tablas nuevas primero, LECTURA DUAL (la lectura pública usa estas tablas solo si la empresa tiene su fila de `PortalDeEmpresa`; si no, `SucursalPublica` y el Json de siempre) y el
-- backfill idempotente se ensaya aparte, en una copia (NO va en esta migración). El enlace actual (slug) sigue andando.
--
-- QUÉ: TRES tablas nuevas, de la EMPRESA, y TRES funciones de validación nuevas. `PortalDeEmpresa` (una fila por empresa: el código del QR, la variante A/B, dos textos y tres colores OPCIONALES —vacío = el valor por defecto, que vive una sola vez en el código—, si se muestra el logo y la imagen
-- de fondo por partes), `PortalTarjeta` (variante A: una por sucursal, con nombre y teléfono opcionales, orden, visible y foto por partes) y `PortalZona` (variante B: un rectángulo en % sobre la imagen, uno por sucursal). Cambiar de variante NO toca lo cargado en la otra. No se toca
-- ninguna tabla ni columna existente: `SucursalPublica` y `PortalCartaEmpresa` (el Json) quedan como están.
--
-- QUÉ DECIDE LA BASE: un portal por empresa; el código (22 a 64 de `[A-Za-z0-9_-]`) ÚNICO en TODA la plataforma (excepción declarada a «toda única lleva la empresa»: es la llave pública del QR, como `portal_de_empresa_codigo_uk` de Pedernal) e INMUTABLE (los QR ya impresos
-- dejarían de andar); la variante (`A` | `B`); los textos (1 a 40 y 1 a 60; el nombre de la tarjeta 1 a 80) con la lista de permitidos del catálogo; los colores `#rrggbb` en minúsculas; el teléfono SOLO DÍGITOS de 1 a 40 (decisión del dueño, 2026-11-17: «solo números»); la imagen y las fotos
-- POR PARTES, las cinco juntas o ninguna (proveedor de la lista cerrada `CLOUDINARY`, cuenta, id público con tramos separados por «/», versión de 1 a 12 dígitos sin cero inicial, extensión jpg|jpeg|png|webp); la zona dentro de la imagen (x, y ≥ 0; ancho, alto > 0; x + ancho ≤ 100 e y + alto ≤ 100);
-- una tarjeta y una zona por (portal, sucursal); que el portal y la sucursal sean de la MISMA empresa (claves foráneas compuestas); y que la identidad de las filas no cambie. La app NO puede borrar (sin DELETE ni TRUNCATE): ocultar es `visible = false`.
-- QUÉ DECIDE EL CASO DE USO: permiso (`carta_portal`), versión esperada, «ya estaba», auditoría, que la sucursal sea de la empresa, y generar el código con 128 bits de azar.
--
-- MOLDE (docs/diseno-datos-paridad-pedernal-2026-11-16.md, E-0): `id` UUID nativo que genera la app; instantes TIMESTAMPTZ(3) que pone la aplicación (reloj inyectado); la versión la sube la aplicación (control optimista, como `FamiliaDeProducto`).
-- RLS: por EMPRESA (`aislamiento_empresa`), sin alcance de sucursal. El portal es de la empresa entera y la lectura pública lo lee con la base de la empresa, ANTES de saber a qué sucursal lleva cada tarjeta (como `SucursalPublica` y `PortalCartaEmpresa`).
-- ADITIVA: tablas y funciones nuevas; no toca ninguna fila ni columna existentes. El código anterior no las lee ni las escribe, así que se puede aplicar por adelantado y el Instant Rollback de Vercel sigue siendo seguro.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; FRENA si hay un portal cargado: su código está impreso en QR; después `prisma migrate resolve --rolled-back 20261117162000_portal_de_empresa`).

-- ---------------------------------------------------------------------------------------------
-- Funciones de validación: la copia en la base de reglas que viven UNA vez en TypeScript (una prueba espejo las compara). Los nombres son los de Pedernal (0077).
-- ---------------------------------------------------------------------------------------------
-- Texto de una línea de catálogo: lista de PERMITIDOS (letras latinas con tilde, dígitos, espacio y . , & - ' / ( ) ° + : ; " # º ª ’ “ ” – — « » ® ™ ¿ ¡ ? ! % $), sin blancos en los extremos, sin empezar con `+` ni `-`, de 1 a `p_maximo` caracteres.
-- La forma canónica (espacios repetidos colapsados) la produce el código; la base solo cierra lo que no es de la lista.
CREATE FUNCTION texto_de_catalogo_valido(t text, p_maximo integer) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN t IS NULL OR p_maximo IS NULL OR char_length(t) NOT BETWEEN 1 AND p_maximo THEN false
    ELSE t = btrim(t)
      AND t ~ '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°:;"#ºª’“”–—«»®™''¿¡?!%$][A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&/()°+:;"#ºª’“”–—«»®™''¿¡?!%$ -]*$'
  END
$$;

-- Color: `#rrggbb` en minúsculas. El CONTRASTE no se mide acá: lo aplica el código al mostrar.
CREATE FUNCTION color_de_carta_valido(t text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$ SELECT t IS NOT NULL AND t ~ '^#[0-9a-f]{6}$' $$;

-- Imagen por dirección externa: se guardan las PARTES, las cinco juntas o ninguna.
CREATE FUNCTION imagen_externa_valida(p_proveedor text, p_cuenta text, p_id_publico text, p_version text, p_extension text) RETURNS boolean LANGUAGE sql IMMUTABLE
  SET search_path = pg_catalog, public, pg_temp AS
$$
  SELECT CASE
    WHEN p_proveedor IS NULL AND p_cuenta IS NULL AND p_id_publico IS NULL AND p_version IS NULL AND p_extension IS NULL THEN true
    WHEN p_proveedor IS NULL OR p_cuenta IS NULL OR p_id_publico IS NULL OR p_version IS NULL OR p_extension IS NULL THEN false
    ELSE p_proveedor IN ('CLOUDINARY')
      AND p_cuenta ~ '^[a-z0-9_-]{1,64}$'
      AND char_length(p_id_publico) BETWEEN 1 AND 200
      AND p_id_publico ~ '^[A-Za-z0-9_-]+(/[A-Za-z0-9_-]+)*$'
      AND p_version ~ '^[1-9][0-9]{0,11}$'
      AND p_extension IN ('jpg', 'jpeg', 'png', 'webp')
  END
$$;

-- ---------------------------------------------------------------------------------------------
-- Tablas
-- ---------------------------------------------------------------------------------------------
-- CreateTable
CREATE TABLE "PortalDeEmpresa" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "codigo" TEXT NOT NULL,
    "variante" TEXT NOT NULL DEFAULT 'A',
    "lineaSuperior" TEXT,
    "titulo" TEXT,
    "colorEncabezado" TEXT,
    "colorPagina" TEXT,
    "colorDetras" TEXT,
    "logoVisible" BOOLEAN NOT NULL DEFAULT true,
    "imagenProveedor" TEXT,
    "imagenCuenta" TEXT,
    "imagenIdPublico" TEXT,
    "imagenVersion" TEXT,
    "imagenExtension" TEXT,
    "creadoPorId" TEXT NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortalDeEmpresa_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PortalTarjeta" (
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "portalId" UUID NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "orden" INTEGER NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "nombre" TEXT,
    "telefono" TEXT,
    "fotoProveedor" TEXT,
    "fotoCuenta" TEXT,
    "fotoIdPublico" TEXT,
    "fotoVersion" TEXT,
    "fotoExtension" TEXT,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortalTarjeta_pkey" PRIMARY KEY ("portalId","sucursalId")
);

-- CreateTable
CREATE TABLE "PortalZona" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "portalId" UUID NOT NULL,
    "sucursalId" TEXT NOT NULL,
    "x" DECIMAL(5,2) NOT NULL,
    "y" DECIMAL(5,2) NOT NULL,
    "ancho" DECIMAL(5,2) NOT NULL,
    "alto" DECIMAL(5,2) NOT NULL,
    "visible" BOOLEAN NOT NULL DEFAULT true,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "PortalZona_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX "PortalDeEmpresa_empresaId_key" ON "PortalDeEmpresa"("empresaId");

-- CreateIndex (EXCEPCIÓN declarada: único en toda la plataforma, sin la empresa: es la llave pública del QR)
CREATE UNIQUE INDEX "PortalDeEmpresa_codigo_key" ON "PortalDeEmpresa"("codigo");

-- CreateIndex
CREATE UNIQUE INDEX "PortalDeEmpresa_empresaId_id_key" ON "PortalDeEmpresa"("empresaId", "id");

-- CreateIndex
CREATE INDEX "PortalTarjeta_empresaId_portalId_idx" ON "PortalTarjeta"("empresaId", "portalId");

-- CreateIndex
CREATE INDEX "PortalTarjeta_empresaId_sucursalId_idx" ON "PortalTarjeta"("empresaId", "sucursalId");

-- CreateIndex
CREATE UNIQUE INDEX "PortalZona_empresaId_id_key" ON "PortalZona"("empresaId", "id");

-- CreateIndex (una zona por sucursal en cada portal)
CREATE UNIQUE INDEX "PortalZona_portalId_sucursalId_key" ON "PortalZona"("portalId", "sucursalId");

-- CreateIndex
CREATE INDEX "PortalZona_empresaId_portalId_idx" ON "PortalZona"("empresaId", "portalId");

-- CreateIndex
CREATE INDEX "PortalZona_empresaId_sucursalId_idx" ON "PortalZona"("empresaId", "sucursalId");

-- AddForeignKey
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_empresaId_portalId_fkey" FOREIGN KEY ("empresaId", "portalId") REFERENCES "PortalDeEmpresa"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_empresaId_portalId_fkey" FOREIGN KEY ("empresaId", "portalId") REFERENCES "PortalDeEmpresa"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- ---------------------------------------------------------------------------------------------
-- Reglas (CHECK con nombre)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_codigo_chk" CHECK ("codigo" ~ '^[A-Za-z0-9_-]{22,64}$');
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_variante_chk" CHECK ("variante" IN ('A', 'B'));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_lineaSuperior_chk" CHECK ("lineaSuperior" IS NULL OR texto_de_catalogo_valido("lineaSuperior", 40));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_titulo_chk" CHECK ("titulo" IS NULL OR texto_de_catalogo_valido("titulo", 60));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_colorEncabezado_chk" CHECK ("colorEncabezado" IS NULL OR color_de_carta_valido("colorEncabezado"));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_colorPagina_chk" CHECK ("colorPagina" IS NULL OR color_de_carta_valido("colorPagina"));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_colorDetras_chk" CHECK ("colorDetras" IS NULL OR color_de_carta_valido("colorDetras"));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_imagen_chk" CHECK (imagen_externa_valida("imagenProveedor", "imagenCuenta", "imagenIdPublico", "imagenVersion", "imagenExtension"));
ALTER TABLE "PortalDeEmpresa" ADD CONSTRAINT "PortalDeEmpresa_version_chk" CHECK ("version" >= 1);

ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_orden_chk" CHECK ("orden" >= 0);
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_nombre_chk" CHECK ("nombre" IS NULL OR texto_de_catalogo_valido("nombre", 80));
-- Solo DÍGITOS, de 1 a 40 (decisión del dueño, 2026-11-17: «solo números»); el servidor valida lo mismo por lista de permitidos y una prueba espejo compara los dos.
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_telefono_chk" CHECK ("telefono" IS NULL OR "telefono" ~ '^[0-9]{1,40}$');
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_foto_chk" CHECK (imagen_externa_valida("fotoProveedor", "fotoCuenta", "fotoIdPublico", "fotoVersion", "fotoExtension"));
ALTER TABLE "PortalTarjeta" ADD CONSTRAINT "PortalTarjeta_version_chk" CHECK ("version" >= 1);

ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_x_chk" CHECK ("x" >= 0 AND "x" <= 100);
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_y_chk" CHECK ("y" >= 0 AND "y" <= 100);
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_ancho_chk" CHECK ("ancho" > 0 AND "ancho" <= 100);
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_alto_chk" CHECK ("alto" > 0 AND "alto" <= 100);
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_dentro_chk" CHECK ("x" + "ancho" <= 100 AND "y" + "alto" <= 100);
ALTER TABLE "PortalZona" ADD CONSTRAINT "PortalZona_version_chk" CHECK ("version" >= 1);

-- ---------------------------------------------------------------------------------------------
-- Disparadores de identidad inmutable (las claves foráneas y el código no cambian: mover una fila a otro portal o sucursal mostraría lo que nadie pidió mostrar).
-- ---------------------------------------------------------------------------------------------
CREATE FUNCTION "PortalDeEmpresa_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW."codigo" IS DISTINCT FROM OLD."codigo" THEN
    RAISE EXCEPTION 'el código de un portal no cambia: los QR impresos dejarían de andar'
      USING ERRCODE = '23514', CONSTRAINT = 'PortalDeEmpresa_codigo_inmutable';
  END IF;
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."empresaId" IS DISTINCT FROM OLD."empresaId" OR NEW."creadoPorId" IS DISTINCT FROM OLD."creadoPorId" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'la identidad de un portal no cambia (id, empresa, autor y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'PortalDeEmpresa_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "PortalDeEmpresa_proteger" BEFORE UPDATE ON "PortalDeEmpresa" FOR EACH ROW EXECUTE FUNCTION "PortalDeEmpresa_proteger"();

CREATE FUNCTION "PortalTarjeta_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW."empresaId" IS DISTINCT FROM OLD."empresaId" OR NEW."portalId" IS DISTINCT FROM OLD."portalId" OR NEW."sucursalId" IS DISTINCT FROM OLD."sucursalId" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'la identidad de una tarjeta del portal no cambia (empresa, portal, sucursal y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'PortalTarjeta_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "PortalTarjeta_proteger" BEFORE UPDATE ON "PortalTarjeta" FOR EACH ROW EXECUTE FUNCTION "PortalTarjeta_proteger"();

CREATE FUNCTION "PortalZona_proteger"() RETURNS trigger LANGUAGE plpgsql
  SET search_path = pg_catalog, public, pg_temp AS
$$
BEGIN
  IF NEW."id" IS DISTINCT FROM OLD."id" OR NEW."empresaId" IS DISTINCT FROM OLD."empresaId" OR NEW."portalId" IS DISTINCT FROM OLD."portalId" OR NEW."sucursalId" IS DISTINCT FROM OLD."sucursalId" OR NEW."creadoEn" IS DISTINCT FROM OLD."creadoEn" THEN
    RAISE EXCEPTION 'la identidad de una zona del portal no cambia (id, empresa, portal, sucursal y fecha de alta)'
      USING ERRCODE = '23514', CONSTRAINT = 'PortalZona_identidad_inmutable';
  END IF;
  RETURN NEW;
END
$$;
CREATE TRIGGER "PortalZona_proteger" BEFORE UPDATE ON "PortalZona" FOR EACH ROW EXECUTE FUNCTION "PortalZona_proteger"();

-- ---------------------------------------------------------------------------------------------
-- RLS por empresa (no son tablas de sucursal: sin políticas de alcance)
-- ---------------------------------------------------------------------------------------------
ALTER TABLE "PortalDeEmpresa" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PortalDeEmpresa"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PortalTarjeta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PortalTarjeta"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));
ALTER TABLE "PortalZona" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PortalZona"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- ---------------------------------------------------------------------------------------------
-- Privilegios (si los roles existen): leer y agregar; cambiar SOLO las columnas que el caso de uso toca; nunca borrar. La consola de plataforma no las toca.
-- ---------------------------------------------------------------------------------------------
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PortalDeEmpresa" FROM motor2_app;
    GRANT SELECT, INSERT ON "PortalDeEmpresa" TO motor2_app;
    GRANT UPDATE ("variante", "lineaSuperior", "titulo", "colorEncabezado", "colorPagina", "colorDetras", "logoVisible", "imagenProveedor", "imagenCuenta", "imagenIdPublico", "imagenVersion", "imagenExtension", "version", "actualizadoEn") ON "PortalDeEmpresa" TO motor2_app;
    REVOKE ALL ON "PortalTarjeta" FROM motor2_app;
    GRANT SELECT, INSERT ON "PortalTarjeta" TO motor2_app;
    GRANT UPDATE ("orden", "visible", "nombre", "telefono", "fotoProveedor", "fotoCuenta", "fotoIdPublico", "fotoVersion", "fotoExtension", "version", "actualizadoEn") ON "PortalTarjeta" TO motor2_app;
    REVOKE ALL ON "PortalZona" FROM motor2_app;
    GRANT SELECT, INSERT ON "PortalZona" TO motor2_app;
    GRANT UPDATE ("x", "y", "ancho", "alto", "visible", "version", "actualizadoEn") ON "PortalZona" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PortalDeEmpresa" FROM motor2_plataforma;
    REVOKE ALL ON "PortalTarjeta" FROM motor2_plataforma;
    REVOKE ALL ON "PortalZona" FROM motor2_plataforma;
  END IF;
END
$$;
