-- CLASE DE USO DEL PRODUCTO (frente 2, «clases de producto como Pedernal», etapa E1; docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md §6.2 y §13; diseño corto del alta docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md).
-- Autorización: el orquestador general concedió el turno de schema de E1 el 2026-11-17 (migración aditiva, con down.sql y verificacion-previa.sql); respaldo del dueño: «Las 5 de Pedernal» (2026-11-13), «Sí, copiar a
-- Pedernal en esas cinco» (2026-11-15) y «Solo lo seguro; Insumo y Reventa para altas nuevas» (2026-11-15). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN (congelamiento vigente); esta migración es ADITIVA y reversible (down.sql).
--
-- Qué hace: agrega "Producto"."claseDeUso" (TEXT, NULL = «todavía sin clase»): qué ES el producto para el negocio (MATERIA_PRIMA, INSUMO, REVENTA, ELABORADO o VENDIBLE). NO se escribe ninguna fila (todo queda en NULL;
-- el relleno de lo existente es un script aparte, con ensayo y autorización expresa: diseño §6.4), NO se toca "tipo" (sigue mandando en el código), NADA lee la columna todavía (el alta con las 5 clases es E2).
-- Tres CHECK (texto + CHECK, no enum: agregar una clase es cambiar un CHECK, reversible; mismo criterio que "modoDeVenta"):
--   1) lista cerrada de las cinco clases (todo nace cerrado);
--   2) coherencia con "tipo": una materia prima (MP) es MATERIA_PRIMA, INSUMO o ELABORADO; un producto de venta (PV) es VENDIBLE. REVENTA todavía NO se admite (se compra y se vende: toca el uso de "tipo" en ~63 lugares;
--      es la etapa E4, que relaja este CHECK en su propia migración);
--   3) «se produce» = ELABORADO: en una materia prima con clase, seProduce es verdadero si y solo si la clase es ELABORADO (respuesta 3 del dueño, «No, como Pedernal»: «se produce» no se prende ni se apaga en una
--      materia prima ya clasificada). Un producto de venta puede traer seProduce sin que signifique nada (la medialuna que se vende y se produce).
-- Y un disparador: la clase se escribe UNA vez (de NULL a un valor) y después no cambia, sin excepciones (dueño, 2026-11-13: la clase equivocada se corrige creando el producto correcto y desactivando el otro).
-- Sin índices, políticas ni GRANT nuevos: "Producto" ya tiene los permisos y la política por empresa de TABLA, que cubren la columna nueva. ADD COLUMN NULL no reescribe la tabla; validar cada CHECK recorre las filas (todas NULL).
-- Compatibilidad hacia atrás: el código anterior no lee ni escribe la columna (sus `data` son explícitos y los INSERT toman NULL). Por eso esta migración va ANTES que el código.
-- Reversa: down.sql (a mano, como dueño; ABORTA si algún producto ya tiene clase, para no perderla en silencio; idempotente).

ALTER TABLE "Producto" ADD COLUMN "claseDeUso" TEXT;

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_chk"
  CHECK ("claseDeUso" IS NULL OR "claseDeUso" IN ('MATERIA_PRIMA', 'INSUMO', 'REVENTA', 'ELABORADO', 'VENDIBLE'));

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_tipo_chk"
  CHECK ("claseDeUso" IS NULL
    OR ("tipo" = 'MP' AND "claseDeUso" IN ('MATERIA_PRIMA', 'INSUMO', 'ELABORADO'))
    OR ("tipo" = 'PV' AND "claseDeUso" = 'VENDIBLE'));

ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_seProduce_chk"
  CHECK ("claseDeUso" IS NULL
    OR "tipo" = 'PV'
    OR ("claseDeUso" = 'ELABORADO') = "seProduce");

CREATE FUNCTION producto_clase_de_uso_inmutable() RETURNS trigger
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $$
BEGIN
  IF OLD."claseDeUso" IS NOT NULL AND NEW."claseDeUso" IS DISTINCT FROM OLD."claseDeUso" THEN
    RAISE EXCEPTION 'La clase de un producto no cambia una vez puesta (producto %): si se equivocó, creá el producto correcto y desactivá este.', OLD."id"
      USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END
$$;

CREATE TRIGGER "Producto_claseDeUso_inmutable_trg"
  BEFORE UPDATE OF "claseDeUso" ON "Producto"
  FOR EACH ROW
  WHEN (OLD."claseDeUso" IS DISTINCT FROM NEW."claseDeUso")
  EXECUTE FUNCTION producto_clase_de_uso_inmutable();
