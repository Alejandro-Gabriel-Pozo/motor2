-- Paquete 3, M3e (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR, base por base, con respaldo y ensayo en una rama de Neon): los DATOS DEL PROVEEDOR para la factura (C36, cambio del dueño, 2026-10-12): su condición frente al IVA y sus puntos de venta.
--
-- `Proveedor.condicionIva`: TEXT NULL de lista cerrada, la MISMA que `Empresa.condicionIva` (RESPONSABLE_INSCRIPTO, MONOTRIBUTO, EXENTO; `CONDICIONES_IVA` de src/core/fiscal/iva.ts; una prueba compara la lista con el CHECK). NULL = «no declarada»: sin default
-- y sin relleno (ningún proveedor existente recibe un valor deducido); quien la lea falla cerrado. Sin CHECK de obligatoriedad (ni `NOT VALID`).
--
-- `PuntoDeVentaDeProveedor` (nueva): los puntos de venta (los cinco dígitos del N.º de comprobante) con los que un proveedor factura. DE EMPRESA (RLS `aislamiento_empresa`, sin sucursal): el proveedor es de la empresa. `numero` entre 1 y 99999, único por
-- proveedor (`UNIQUE (proveedorId, numero)`); `activo` BOOLEAN NOT NULL DEFAULT true. NO SE BORRA NUNCA: se apaga. `motor2_app` tiene SELECT, INSERT y UPDATE SOLO de `activo` (el número no se corrige: un punto mal cargado se apaga y se carga el
-- bueno); `motor2_plataforma` no tiene acceso. La clave foránea es COMPUESTA (empresaId, proveedorId) RESTRICT: el punto es de un proveedor de la misma empresa.
--
-- NO hay en esta migración ninguna regla que sugiera la letra de la factura (A, B o C) a partir de la condición del proveedor y la de la empresa: esas reglas fiscales se verifican contra ARCA antes de ponerlas en código (Etapa C).
-- ADITIVA: el código anterior no lee ni escribe las columnas nuevas (`Proveedor` se lee con todas las columnas o con `select` explícito y la nueva viene en NULL). `ADD COLUMN` sin default solo toca el catálogo; validar el CHECK recorre las filas de `Proveedor`
-- (todas en NULL). Aplicar sin tráfico y con `lock_timeout` corto. Tabla nueva y vacía: sus índices van sin CONCURRENTLY, en la misma transacción.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261016104000_proveedor_condicion_iva_y_puntos_de_venta`). DESTRUCTIVA si ya hay condiciones o puntos de venta cargados.

ALTER TABLE "Proveedor" ADD COLUMN "condicionIva" TEXT;
ALTER TABLE "Proveedor" ADD CONSTRAINT "Proveedor_condicionIva_check" CHECK ("condicionIva" IS NULL OR "condicionIva" IN ('RESPONSABLE_INSCRIPTO', 'MONOTRIBUTO', 'EXENTO'));

CREATE TABLE "PuntoDeVentaDeProveedor" (
    "id" TEXT NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "proveedorId" TEXT NOT NULL,
    "numero" INTEGER NOT NULL,
    "activo" BOOLEAN NOT NULL DEFAULT true,
    "creadoEn" TIMESTAMP(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PuntoDeVentaDeProveedor_pkey" PRIMARY KEY ("id")
);

CREATE UNIQUE INDEX "PuntoDeVentaDeProveedor_empresaId_id_key" ON "PuntoDeVentaDeProveedor"("empresaId", "id");
CREATE UNIQUE INDEX "PuntoDeVentaDeProveedor_proveedorId_numero_key" ON "PuntoDeVentaDeProveedor"("proveedorId", "numero");

ALTER TABLE "PuntoDeVentaDeProveedor" ADD CONSTRAINT "PuntoDeVentaDeProveedor_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
ALTER TABLE "PuntoDeVentaDeProveedor" ADD CONSTRAINT "PuntoDeVentaDeProveedor_empresaId_proveedorId_fkey" FOREIGN KEY ("empresaId", "proveedorId") REFERENCES "Proveedor"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- El número del punto de venta son hasta cinco dígitos: de 1 a 99999.
ALTER TABLE "PuntoDeVentaDeProveedor" ADD CONSTRAINT "PuntoDeVentaDeProveedor_numero_chk" CHECK ("numero" BETWEEN 1 AND 99999);

ALTER TABLE "PuntoDeVentaDeProveedor" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "PuntoDeVentaDeProveedor"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen: en una base de test o recién creada pueden no estar). Nunca DELETE; el UPDATE es solo de `activo`.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "PuntoDeVentaDeProveedor" FROM motor2_app;
    GRANT SELECT, INSERT ON "PuntoDeVentaDeProveedor" TO motor2_app;
    GRANT UPDATE ("activo") ON "PuntoDeVentaDeProveedor" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "PuntoDeVentaDeProveedor" FROM motor2_plataforma;
  END IF;
END
$$;
