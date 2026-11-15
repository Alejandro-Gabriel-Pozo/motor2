-- «PRESENTACIÓN DE COMPRA POR PRODUCTO» (etapa C1 / P3 etapa 1, docs/diseno-productos-igual-a-pedernal-2026-11-13.md §9.2 y docs/diseno-equivalentes-de-pedernal-para-campos-de-ficha-2026-11-13.md §2; decisión del dueño 2026-11-13:
-- «El de Pedernal: presentación por producto (Recomendada)»; migraciones ADITIVAS con down.sql autorizadas el 2026-11-15; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo en copia):
-- «caja x6» y «caja x12» son dos presentaciones del mismo producto: cada una lleva un NOMBRE propio (hasta 80), único por producto sin distinguir mayúsculas, y una cantidad fija en la unidad base (otra cantidad = otra presentación).
-- Igual que `presentacion_de_producto` de Pedernal (migraciones/0037_compras.sql): `nombre`, `cantidad` (acá `factorConversion`, ya existía), `de_peso_variable` (acá `pesoVariable`; con peso variable la cantidad es el peso APROXIMADO, el stock entra por el real: NO hay columna de peso aparte), `version`.
-- Sobre la tabla "Presentacion" que ya existe (RLS y privilegios de siempre: no se tocan):
--  - "nombre" (nullable a propósito: el código anterior y varios fixtures insertan sin nombre; el código nuevo SIEMPRE lo escribe). Las filas existentes se rellenan con el nombre de su unidad.
--  - "pesoVariable" boolean, falso por defecto. "version" entero, 1 por defecto (control de versión optimista del caso de uso).
--  - CHECK: nombre (si hay) de 1 a 80 caracteres y sin espacios en los bordes; factorConversion > 0 (hasta 4 decimales ya lo impone Decimal(14,4)); version >= 1.
--  - Único por (empresa, producto, lower(nombre)). Convive con el único de siempre (producto, unidad): NO se borra. Consecuencia declarada: mientras ese único siga, dos presentaciones del mismo producto no pueden compartir unidad
--    («caja x6» y «caja x12» con la MISMA unidad «caja» recién caben cuando una etapa posterior, con su propia autorización, lo reemplace).
-- Verificar ANTES en cada base con verificacion-previa.sql (solo lectura). ADITIVA: el código anterior sigue funcionando (no lee ni escribe las columnas nuevas). Si una fila viola un CHECK (o dos nombres rellenados chocaran en el índice único),
-- la migración ABORTA entera (una transacción) y no deja nada a medias.
-- Reversa: down.sql (a mano, como dueño; idempotente). Bajar descarta los nombres y las marcas de peso variable cargados con el código nuevo (lo viejo no se toca).

ALTER TABLE "Presentacion" ADD COLUMN "nombre" TEXT;
ALTER TABLE "Presentacion" ADD COLUMN "pesoVariable" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Presentacion" ADD COLUMN "version" INTEGER NOT NULL DEFAULT 1;

-- Las ya cargadas conservan su forma: el nombre es el de su unidad (ninguna se borra, ninguna cambia de cantidad).
UPDATE "Presentacion" p SET "nombre" = btrim(u."nombre") FROM "Unidad" u WHERE u."empresaId" = p."empresaId" AND u."id" = p."unidadCompraId";

ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_nombre_chk" CHECK ("nombre" IS NULL OR (char_length("nombre") BETWEEN 1 AND 80 AND "nombre" = btrim("nombre"))) NOT VALID;
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_factorConversion_chk" CHECK ("factorConversion" > 0) NOT VALID;
ALTER TABLE "Presentacion" ADD CONSTRAINT "Presentacion_version_chk" CHECK ("version" >= 1) NOT VALID;

ALTER TABLE "Presentacion" VALIDATE CONSTRAINT "Presentacion_nombre_chk";
ALTER TABLE "Presentacion" VALIDATE CONSTRAINT "Presentacion_factorConversion_chk";
ALTER TABLE "Presentacion" VALIDATE CONSTRAINT "Presentacion_version_chk";

CREATE UNIQUE INDEX "Presentacion_empresaId_productoId_nombre_lower_key" ON "Presentacion" ("empresaId", "productoId", lower("nombre"));
