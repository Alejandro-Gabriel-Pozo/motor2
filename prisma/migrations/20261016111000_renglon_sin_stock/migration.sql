-- Paquete 3, M4.2 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el RENGLÓN SIN STOCK de la factura de proveedor. Un renglón de gasto (alquiler, flete, honorarios...) es
-- un renglón más de `FacturaProveedorRenglon` con naturaleza `SIN_STOCK`: tiene concepto de gasto y tipo de costo en vez de producto, cantidad y precio por unidad, y NUNCA genera `Operacion` ni línea del Kardex.
--
-- ESTA MIGRACIÓN REEMPLAZA DOS CHECK DE M3 (borra y vuelve a crear): `FacturaProveedorRenglon_naturaleza_chk` (la lista de naturalezas pasa de ('MERCADERIA') a ('MERCADERIA','SIN_STOCK')) y
-- `FacturaProveedorRenglon_pareo_mercaderia_chk`, que pasa a llamarse `FacturaProveedorRenglon_pareo_naturaleza_chk` y a decir el pareo de LAS DOS naturalezas. No hay `ALTER TYPE`: la naturaleza es TEXT con CHECK desde M3, así que
-- ampliarla es cambiar un CHECK y la reversa es exacta. Los dos cambios corren en la MISMA transacción que Prisma abre para el archivo: ninguna escritura concurrente ve la tabla sin su regla. NO se usa `NOT VALID` + `VALIDATE`: dentro de una
-- sola transacción no aporta nada (el bloqueo de la tabla se mantiene hasta el commit) y la tabla es chica; si ya hubiera renglones de M3, un renglón de MERCADERIA sigue cumpliendo el pareo nuevo (sus columnas nuevas nacen en NULL).
--
-- COLUMNAS NUEVAS (NULL): `conceptoGastoId` (clave foránea COMPUESTA (empresaId, conceptoGastoId) → ConceptoDeGasto, RESTRICT: el concepto es de la misma empresa) y `tipoDeCosto` (la COPIA que se queda el renglón del tipo de costo del concepto
-- o el que eligió quien cargó; D2: cinco valores, COSTO_DE_VENTAS, GASTO_OPERATIVO, EXTRAORDINARIO, INVERSION, RESULTADO_FINANCIERO). Cambiar después el tipo por defecto del concepto NO cambia lo ya cargado.
--
-- PAREO (`..._pareo_naturaleza_chk`): MERCADERIA = producto, cantidad, precio por unidad de stock y texto de conversión (como en M3) y NINGÚN concepto ni tipo de costo; SIN_STOCK = concepto y tipo de costo, NINGUNO de los campos de mercadería
-- (tampoco lote y vencimiento) y `precioTotal` MAYOR que cero (un gasto de cero pesos no es un gasto; el caso de uso lo rechaza antes con un mensaje explícito). Los precios y totales son siempre CON IVA incluido; `importeIvaComputable` (M3d) es de las dos naturalezas.
--
-- DISCRIMINADOR: un índice único `(empresaId, id, naturaleza)` es el destino de la clave foránea de M4.3 (`ImputacionDeGasto`), que lleva `naturalezaRenglon = 'SIN_STOCK'` fija: la BASE impide imputar un renglón de mercadería, y la naturaleza de un renglón
-- imputado no se puede cambiar (ON UPDATE RESTRICT; además la app no tiene UPDATE sobre el renglón). La naturaleza no se reclasifica: se anula la factura y se vuelve a cargar.
--
-- ADITIVA con una excepción declarada (los dos CHECK reemplazados): el código anterior no lee ni escribe nada de esto. Índices sin CONCURRENTLY (Prisma corre el archivo en UNA transacción; la tabla no tiene ninguna carga de gastos y el relleno de M3 no
-- crea renglones). Aplicar con `SET lock_timeout = '5s'` en la conexión del dueño (precedente M-9): toma ACCESS EXCLUSIVE un instante sobre `FacturaProveedorRenglon`.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016111000_renglon_sin_stock`). ABORTA si ya hay renglones SIN_STOCK (no destruye nada ni deja nada a medias). Bajar ANTES M4.3.

ALTER TABLE "FacturaProveedorRenglon"
  ADD COLUMN "conceptoGastoId" TEXT,
  ADD COLUMN "tipoDeCosto" TEXT;

ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_empresaId_conceptoGastoId_fkey"
  FOREIGN KEY ("empresaId", "conceptoGastoId") REFERENCES "ConceptoDeGasto"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;
CREATE INDEX "FacturaProveedorRenglon_conceptoGastoId_idx" ON "FacturaProveedorRenglon"("conceptoGastoId");

-- El destino de la clave foránea con discriminador de M4.3.
CREATE UNIQUE INDEX "FacturaProveedorRenglon_empresaId_id_naturaleza_key" ON "FacturaProveedorRenglon"("empresaId", "id", "naturaleza");

-- El tipo de costo de la copia (D2: cinco valores), o ninguno.
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_tipo_de_costo_chk"
  CHECK ("tipoDeCosto" IS NULL OR "tipoDeCosto" IN ('COSTO_DE_VENTAS', 'GASTO_OPERATIVO', 'EXTRAORDINARIO', 'INVERSION', 'RESULTADO_FINANCIERO'));

-- Los dos CHECK de M3 que se reemplazan (mismo nombre la naturaleza; el pareo cambia de nombre).
ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT "FacturaProveedorRenglon_naturaleza_chk";
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_naturaleza_chk" CHECK ("naturaleza" IN ('MERCADERIA', 'SIN_STOCK'));

ALTER TABLE "FacturaProveedorRenglon" DROP CONSTRAINT "FacturaProveedorRenglon_pareo_mercaderia_chk";
ALTER TABLE "FacturaProveedorRenglon" ADD CONSTRAINT "FacturaProveedorRenglon_pareo_naturaleza_chk"
  CHECK (
    (
      "naturaleza" = 'MERCADERIA'
      AND "productoId" IS NOT NULL AND "cantidadStock" IS NOT NULL AND "precioPorUnidadStock" IS NOT NULL AND "detalle" IS NOT NULL
      AND "conceptoGastoId" IS NULL AND "tipoDeCosto" IS NULL
    )
    OR (
      "naturaleza" = 'SIN_STOCK'
      AND "productoId" IS NULL AND "cantidadStock" IS NULL AND "precioPorUnidadStock" IS NULL AND "detalle" IS NULL AND "loteVencimiento" IS NULL
      AND "conceptoGastoId" IS NOT NULL AND "tipoDeCosto" IS NOT NULL
      AND "precioTotal" > 0
    )
  );
