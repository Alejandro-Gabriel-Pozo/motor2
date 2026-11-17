-- Nombres con la lista de permitidos de Pedernal TAMBIÉN en la base (frente 3, etapa E-3 paso 2; `docs/diseno-datos-paridad-pedernal-2026-11-16.md` N5-4 y `docs/e1-recuento-de-textos-y-cuit-2026-11-15.md`).
-- REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon). Aplicarlas en bases reales sigue congelado (solo al desplegar).
--
-- (No confundir con `texto_de_ficha_valido(text, integer)` de la migración de Parte: otra función, otra forma.)
-- QUÉ: una función `nombre_de_ficha_valido(texto, máximo, exigir_letra, con_signos)` que dice si un texto YA ESTÁ en su forma canónica y cumple la ficha (igual que `src/core/datos/texto-de-catalogo.ts`: solo letras latinas, dígitos y los signos
-- permitidos; sin espacios en los bordes ni dobles; en NFC; sin `+`/`-` al empezar; largo; al menos una letra si la ficha lo exige) y un CHECK por columna de nombre cuyo código YA aplica esa ficha (tabla
-- `test/arquitectura/nombres-puntos-declarados.ts`). El código sigue normalizando antes de guardar (recorta, NFC, colapsa espacios): el CHECK solo rechaza lo que se colara por otro camino.
-- NO REESCRIBE DATOS: el recuento de solo lectura del 2026-11-17 sobre la única base con datos (2 empresas, 1 sucursal, 2 roles, 1 sección de carta) no encontró ningún nombre fuera de la lista. Si en otra base hubiera
-- alguno, la migración ABORTA entera nombrando tabla y cantidad (una sola transacción) y se resuelve a mano con el dueño: nunca se corrige en silencio.
-- Lo que NO cubre esta tanda: Unidad, Seccion, MotivoMerma, DestinoConsumo, Grupo, ItemAgrupadoCarta, GeneroCarta, nombreEnCarta y descripciones de opciones (siguen con la regla en el código; tanda siguiente con su propio recuento).
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117190000_nombres_con_ficha_check`). No pierde datos.

CREATE FUNCTION nombre_de_ficha_valido(v text, maximo integer, exigir_letra boolean, con_signos boolean) RETURNS boolean
  LANGUAGE sql IMMUTABLE PARALLEL SAFE
  SET search_path = pg_catalog, pg_temp
AS $$
  SELECT v IS NOT NULL
     AND v <> ''
     AND char_length(v) <= maximo
     AND v IS NFC NORMALIZED
     AND v !~ '^ | $'
     AND v !~ '  '
     AND v !~ '^[+-]'
     AND v ~ (CASE WHEN con_signos
                   THEN '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+¿¡?!%$-]+$'
                   ELSE '^[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ0-9 .,&()°:;"#ºª’“”–—«»®™''/+-]+$' END)
     AND (NOT exigir_letra OR v ~ '[A-Za-zÀ-ÖØ-öø-ÿŠšŒœŽžŸ]')
$$;

DO $$
DECLARE
  v_malas text := '';
  v_n bigint;
BEGIN
  SELECT count(*) INTO v_n FROM "Producto" WHERE NOT nombre_de_ficha_valido("nombre", 120, true, true);
  IF v_n > 0 THEN v_malas := v_malas || ' Producto.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "Insumo" WHERE NOT nombre_de_ficha_valido("nombre", 120, true, true);
  IF v_n > 0 THEN v_malas := v_malas || ' Insumo.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "CategoriaProducto" WHERE NOT nombre_de_ficha_valido("nombre", 80, false, true);
  IF v_n > 0 THEN v_malas := v_malas || ' CategoriaProducto.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "Proveedor" WHERE NOT nombre_de_ficha_valido("nombre", 200, true, false);
  IF v_n > 0 THEN v_malas := v_malas || ' Proveedor.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "Cliente" WHERE NOT nombre_de_ficha_valido("nombre", 200, true, false);
  IF v_n > 0 THEN v_malas := v_malas || ' Cliente.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "SeccionCarta" WHERE NOT nombre_de_ficha_valido("nombre", 80, false, true);
  IF v_n > 0 THEN v_malas := v_malas || ' SeccionCarta.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "GrupoDeOpciones" WHERE NOT nombre_de_ficha_valido("nombre", 80, false, true);
  IF v_n > 0 THEN v_malas := v_malas || ' GrupoDeOpciones.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "OpcionDeGrupo" WHERE NOT nombre_de_ficha_valido("nombre", 80, false, true);
  IF v_n > 0 THEN v_malas := v_malas || ' OpcionDeGrupo.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "Sucursal" WHERE NOT nombre_de_ficha_valido("nombre", 80, true, false);
  IF v_n > 0 THEN v_malas := v_malas || ' Sucursal.nombre=' || v_n; END IF;
  SELECT count(*) INTO v_n FROM "Rol" WHERE NOT nombre_de_ficha_valido("nombre", 80, true, false);
  IF v_n > 0 THEN v_malas := v_malas || ' Rol.nombre=' || v_n; END IF;
  IF v_malas <> '' THEN
    RAISE EXCEPTION 'hay nombres guardados fuera de la lista de permitidos (columna=cantidad):%', v_malas USING ERRCODE = '23514';
  END IF;
END
$$;

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 120, true, true));
ALTER TABLE "Insumo" ADD CONSTRAINT "Insumo_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 120, true, true));
ALTER TABLE "CategoriaProducto" ADD CONSTRAINT "CategoriaProducto_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, false, true));
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 200, true, false));
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 200, true, false));
ALTER TABLE "SeccionCarta" ADD CONSTRAINT "SeccionCarta_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, false, true));
ALTER TABLE "GrupoDeOpciones" ADD CONSTRAINT "GrupoDeOpciones_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, false, true));
ALTER TABLE "OpcionDeGrupo" ADD CONSTRAINT "OpcionDeGrupo_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, false, true));
ALTER TABLE "Sucursal" ADD CONSTRAINT "Sucursal_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, true, false));
ALTER TABLE "Rol" ADD CONSTRAINT "Rol_nombre_ficha_chk" CHECK (nombre_de_ficha_valido("nombre", 80, true, false));
