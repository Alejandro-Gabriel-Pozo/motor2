-- Paquete 3, M4.1 (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): el CATÁLOGO de CONCEPTOS DE GASTO de la empresa (`ConceptoDeGasto`), lo que se paga sin que entre mercadería al stock
-- (alquiler, luz, honorarios, flete, descuento obtenido...). Un servicio NO es un producto: es un concepto de gasto, y vive acá, no en `Producto`.
--
-- POR QUÉ DE EMPRESA: el catálogo lo comparten todas las sucursales (el mismo «Alquiler» se imputa a varias), así que no lleva sucursal: RLS `aislamiento_empresa` y alcance `DE_EMPRESA` (sin FK a `Sucursal`; la regla R3 de
-- test/arquitectura/alcance-de-sucursal.test.ts la volvería «de sucursal» si la tuviera). La imputación de un gasto a cada sucursal es otra tabla (M4.3) y esa SÍ es de la sucursal.
--
-- CÓDIGO FIJO: `codigo` (mayúsculas, dígitos y guion bajo, empieza con letra, hasta 40) es la identidad estable del concepto (para reportes y para la carga de «sugeridos») y NO se puede cambiar: `motor2_app` no tiene UPDATE sobre esa columna. Un código mal
-- puesto se corrige con un concepto nuevo y desactivando el viejo. NOMBRE: único por empresa sin importar mayúsculas (índice único sobre `lower("nombre")`, además del `@@unique([empresaId, nombre])` de Prisma, como los demás catálogos).
-- TIPO DE COSTO POR DEFECTO (D2 del dueño): lista cerrada de CINCO valores — COSTO_DE_VENTAS, GASTO_OPERATIVO, EXTRAORDINARIO, INVERSION y RESULTADO_FINANCIERO («descuento obtenido»). Es TEXT con CHECK, no un tipo enumerado de Postgres:
-- agregar o quitar un valor después es cambiar un CHECK (reversible), no un `ALTER TYPE` (que no se deshace). Solo es el valor por defecto de las cargas nuevas; cada renglón guarda su copia (M4.2).
--
-- LA UNICIDAD LA DECIDE LA BASE, no una lectura previa: dos altas simultáneas del mismo código (o del mismo nombre) y gana una; la otra recibe 23505. Nada de leer-decidir-escribir.
--
-- SE EDITA POCO Y NO SE BORRA: `motor2_app` tiene SELECT e INSERT, NUNCA DELETE, y UPDATE solo de `nombre`, `tipoDeCostoPorDefecto` y `activo` (un concepto inactivo no se usa en cargas nuevas, pero sus gastos siguen). `motor2_plataforma` no toca nada.
-- Sin `@updatedAt` en el esquema (rompería el privilegio por columna).
--
-- ADITIVA: tabla nueva y vacía; ningún código la lee ni escribe hasta la Etapa C. Sus índices van sin CONCURRENTLY, en la misma transacción (Prisma corre este archivo entero en una): caen sobre 0 filas.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016110000_concepto_de_gasto`). DESTRUCTIVA si ya hay conceptos. Bajar ANTES M4.2 (el renglón la referencia).

CREATE TABLE "ConceptoDeGasto" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "codigo" TEXT NOT NULL,
    "nombre" TEXT NOT NULL,
    "tipoDeCostoPorDefecto" TEXT NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ConceptoDeGasto_pkey" PRIMARY KEY ("id")
);

-- (empresaId, id): destino de las claves foráneas compuestas (el renglón de M4.2).
CREATE UNIQUE INDEX "ConceptoDeGasto_empresaId_id_key" ON "ConceptoDeGasto"("empresaId", "id");
CREATE UNIQUE INDEX "ConceptoDeGasto_empresaId_codigo_key" ON "ConceptoDeGasto"("empresaId", "codigo");
CREATE UNIQUE INDEX "ConceptoDeGasto_empresaId_nombre_key" ON "ConceptoDeGasto"("empresaId", "nombre");
-- El nombre, sin importar mayúsculas (Prisma no modela índices sobre expresiones: vive solo acá, como `Proveedor_nombre_lower_key`).
CREATE UNIQUE INDEX "ConceptoDeGasto_nombre_lower_key" ON "ConceptoDeGasto" ("empresaId", lower("nombre"));

ALTER TABLE "ConceptoDeGasto" ADD CONSTRAINT "ConceptoDeGasto_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

ALTER TABLE "ConceptoDeGasto" ADD CONSTRAINT "ConceptoDeGasto_codigo_chk" CHECK ("codigo" ~ '^[A-Z][A-Z0-9_]{0,39}$');
-- El nombre tiene algún carácter visible (`\S`: ni vacío ni solo espacios, tabulaciones o saltos de línea) y hasta 120.
ALTER TABLE "ConceptoDeGasto" ADD CONSTRAINT "ConceptoDeGasto_nombre_chk" CHECK ("nombre" ~ '\S' AND length("nombre") <= 120);
ALTER TABLE "ConceptoDeGasto" ADD CONSTRAINT "ConceptoDeGasto_tipo_de_costo_chk"
  CHECK ("tipoDeCostoPorDefecto" IN ('COSTO_DE_VENTAS', 'GASTO_OPERATIVO', 'EXTRAORDINARIO', 'INVERSION', 'RESULTADO_FINANCIERO'));

ALTER TABLE "ConceptoDeGasto" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ConceptoDeGasto"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Los privilegios por defecto le dan DML completo a `motor2_app` sobre las tablas nuevas: se le quitan TODOS y se le devuelve lo mínimo.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "ConceptoDeGasto" FROM motor2_app;
    GRANT SELECT, INSERT ON "ConceptoDeGasto" TO motor2_app;
    GRANT UPDATE ("nombre", "tipoDeCostoPorDefecto", "activo") ON "ConceptoDeGasto" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "ConceptoDeGasto" FROM motor2_plataforma;
  END IF;
END
$$;
