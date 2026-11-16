-- «Ocultar» como Pedernal, E3c3 (docs/diseno-ocultar-como-pedernal-2026-11-15.md, I-4, I-5, R-6 y R-8; Pedernal `migraciones/0049_producto_oculto_en_stock.sql`). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real
-- (base por base, con respaldo y ensayo en una rama de Neon). El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql); el orquestador aprobó esta (opción B: el control en la base) el mismo día.
--
-- QUÉ: UN disparador BEFORE INSERT en "MovimientoStock" que rechaza AGREGAR EXISTENCIA a un producto OCULTO: un renglón con cantidad POSITIVA cuyo saldo final en esa sección quedaría POR ENCIMA DE CERO, si el producto está
-- oculto en la sucursal de la sección (marca de la sucursal O de toda la empresa, `OcultamientoProducto`). Restar (cantidad <= 0) y corregir un negativo hasta cero se permiten. Cubre TODAS las vías que escriben el Kardex
-- (compra, producción, ajuste, anulación, devolución, traspaso, reclasificación, conteo…), las de hoy y las futuras: el estado «oculto con existencia nueva» queda imposible por la base, no por que cada vía se acuerde.
--
-- CONCURRENCIA con «ocultar» (que toma el producto FOR UPDATE, escribe la marca y recién entonces mira la existencia): el disparador toma el producto FOR KEY SHARE (el mismo bloqueo que ya toma la clave foránea del renglón: no
-- agrega costo) ANTES de leer la marca. Si ocultar entró primero, el renglón espera a que termine y ve la marca; si el renglón entró primero, ocultar espera y ve la existencia. Nunca queda «oculto y con existencia nueva».
--
-- CAMINO CALIENTE (todo INSERT en MovimientoStock): una salida o un renglón en cero sale en la primera línea sin leer nada; una entrada de un producto SIN ninguna marca oculta lee un índice (`OcultamientoProducto_productoId_idx`)
-- y sigue. Solo un producto oculto con entrada paga la suma del saldo de esa sección. No cambia ningún resultado existente: sin marcas ocultas el disparador no rechaza nada.
--
-- SECURITY DEFINER a propósito: lee marcas y saldos SIN pasar por la RLS por sucursal del rol de la app, así una marca que la política no deja ver no puede abrir el control (falla cerrado). `search_path` fijo. Solo lee.
-- ERROR: SQLSTATE 23514 (check_violation) con el nombre de restricción `MovimientoStock_producto_oculto_chk`, para que las vías que lo traduzcan (anular, conteo) y el error genérico cerrado del resto lo reconozcan por nombre.
--
-- ADITIVA: solo agrega una función y un disparador; no toca ninguna fila, columna ni índice. El código viejo no lo nota (sin marcas ocultas no rechaza nada). Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`;
-- después `prisma migrate resolve --rolled-back 20261115160000_producto_oculto_no_suma_existencia`).

CREATE FUNCTION rechazar_suma_a_producto_oculto() RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $$
DECLARE
  v_sucursal text;
  v_saldo numeric;
BEGIN
  -- Restar o dejar en cero nunca suma existencia: sale sin leer nada.
  IF NEW."cantidad" <= 0 THEN
    RETURN NEW;
  END IF;
  -- El mismo bloqueo que toma la clave foránea del renglón; contra el FOR UPDATE de «ocultar». ANTES de leer la marca: lo que sigue ve lo que ocultar ya confirmó.
  PERFORM 1 FROM "Producto" WHERE "id" = NEW."productoId" FOR KEY SHARE;
  -- Un producto sin ninguna marca oculta no tiene nada que mirar (índice por producto).
  IF NOT EXISTS (SELECT 1 FROM "OcultamientoProducto" WHERE "productoId" = NEW."productoId" AND "oculto") THEN
    RETURN NEW;
  END IF;
  SELECT s."sucursalId" INTO v_sucursal FROM "Seccion" s WHERE s."id" = NEW."seccionId";
  IF NOT EXISTS (
    SELECT 1 FROM "OcultamientoProducto"
     WHERE "productoId" = NEW."productoId" AND "oculto" AND ("sucursalId" IS NULL OR "sucursalId" = v_sucursal)
  ) THEN
    RETURN NEW;
  END IF;
  -- Oculto en esta sucursal: solo se rechaza si el saldo FINAL de la sección queda por encima de cero (corregir un negativo hasta cero se permite).
  SELECT COALESCE(SUM("cantidad"), 0) INTO v_saldo FROM "MovimientoStock" WHERE "productoId" = NEW."productoId" AND "seccionId" = NEW."seccionId";
  IF v_saldo + NEW."cantidad" > 0 THEN
    RAISE EXCEPTION 'MovimientoStock_producto_oculto_chk: no se puede sumar existencia a un producto oculto'
      USING ERRCODE = 'check_violation', CONSTRAINT = 'MovimientoStock_producto_oculto_chk';
  END IF;
  RETURN NEW;
END
$$;

COMMENT ON FUNCTION rechazar_suma_a_producto_oculto() IS '«Ocultar» (E3c3): un producto oculto en la sucursal no recibe existencia (renglón de cantidad positiva que deja el saldo de la sección por encima de cero).';

CREATE TRIGGER "MovimientoStock_producto_oculto_trg"
  BEFORE INSERT ON "MovimientoStock"
  FOR EACH ROW EXECUTE FUNCTION rechazar_suma_a_producto_oculto();
