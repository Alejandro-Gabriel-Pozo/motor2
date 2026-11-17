-- Carta, orden de renglones etapa O1 (docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md, sección C, nivel 6). REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR en cada base real (base por base, con respaldo y ensayo en una rama de Neon).
-- El dueño autorizó el 2026-11-15 migraciones ADITIVAS y REVERSIBLES (con down.sql) de etapas ratificadas; aplicarlas en bases reales sigue congelado (solo al desplegar, con backup y ensayo). Decisión del dueño, 2026-11-17: «Dejar por sucursal, sumar modo de orden (Recomendada)».
--
-- QUÉ: UNA tabla nueva, `ModoDeOrdenDeSeccionCarta`: una fila por (sucursal, sección de carta) con el modo de orden de los renglones (`ALFABETICO` o `A_MANO`). SIN FILA = `A_MANO`, que es lo que la carta hace hoy (orden y después nombre):
-- no hay backfill y la carta real no cambia hasta que alguien elige un modo. No se agrega ninguna columna a `ContenidoCartaProducto` ni a `ItemAgrupadoCarta`: `orden` y `especial` quedan donde están. Nunca se borra: el modo se sobrescribe.
--
-- QUÉ DECIDE LA BASE: un modo por (sucursal, sección) (único); la sucursal y la sección son de la MISMA empresa (claves foráneas compuestas); el modo es de una lista cerrada (CHECK); `version >= 1`. La app NO puede borrar (sin DELETE ni TRUNCATE) ni cambiar a qué
-- sucursal o sección apunta una fila: solo UPDATE de `modo`, `actualizadoPorId`, `actualizadoEn`, `version`.
-- QUÉ DECIDE EL CASO DE USO: permisos, la sucursal (siempre la activa), el control de versión, «ya estaba» y la auditoría.
-- Las políticas de alcance de sucursal (RLS por sucursal) van en la migración siguiente (20261117160100), salida exacta del generador.
--
-- MOLDE (docs/diseno-datos-paridad-pedernal-2026-11-16.md, E-0): `id` UUID nativo que genera la app; instantes TIMESTAMPTZ(3); la app NO tiene DELETE ni TRUNCATE.
-- ADITIVA: solo agrega una tabla; no toca ninguna fila ni columna existentes. El código anterior no la lee ni la escribe, así que se puede aplicar por adelantado y el Instant Rollback de Vercel sigue siendo seguro.
-- Reversa: down.sql (a mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117160000_modo_de_orden_de_seccion_carta`). Bajar ANTES la de políticas (20261117160100).

-- CreateTable
CREATE TABLE "ModoDeOrdenDeSeccionCarta" (
    "id" UUID NOT NULL,
    "empresaId" TEXT NOT NULL DEFAULT app_empresa_actual(),
    "sucursalId" TEXT NOT NULL,
    "seccionCartaId" TEXT NOT NULL,
    "modo" TEXT NOT NULL,
    "actualizadoPorId" TEXT NOT NULL,
    "actualizadoEn" TIMESTAMPTZ(3) NOT NULL,
    "version" INTEGER NOT NULL DEFAULT 1,
    "creadoEn" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ModoDeOrdenDeSeccionCarta_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE INDEX "ModoDeOrdenDeSeccionCarta_seccionCartaId_idx" ON "ModoDeOrdenDeSeccionCarta"("seccionCartaId");

-- CreateIndex
CREATE UNIQUE INDEX "ModoDeOrdenDeSeccionCarta_sucursalId_seccionCartaId_key" ON "ModoDeOrdenDeSeccionCarta"("sucursalId", "seccionCartaId");

-- CreateIndex
CREATE UNIQUE INDEX "ModoDeOrdenDeSeccionCarta_empresaId_id_key" ON "ModoDeOrdenDeSeccionCarta"("empresaId", "id");

-- AddForeignKey
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ADD CONSTRAINT "ModoDeOrdenDeSeccionCarta_empresaId_fkey" FOREIGN KEY ("empresaId") REFERENCES "Empresa"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ADD CONSTRAINT "ModoDeOrdenDeSeccionCarta_empresaId_sucursalId_fkey" FOREIGN KEY ("empresaId", "sucursalId") REFERENCES "Sucursal"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ADD CONSTRAINT "ModoDeOrdenDeSeccionCarta_empresaId_seccionCartaId_fkey" FOREIGN KEY ("empresaId", "seccionCartaId") REFERENCES "SeccionCarta"("empresaId", "id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- Reglas (CHECK con nombre): lista cerrada de modos y versión desde 1.
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ADD CONSTRAINT "ModoDeOrdenDeSeccionCarta_modo_chk" CHECK ("modo" IN ('ALFABETICO', 'A_MANO'));
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ADD CONSTRAINT "ModoDeOrdenDeSeccionCarta_version_chk" CHECK ("version" >= 1);

-- RLS por empresa (las políticas por sucursal van en 20261117160100)
ALTER TABLE "ModoDeOrdenDeSeccionCarta" ENABLE ROW LEVEL SECURITY;
CREATE POLICY aislamiento_empresa ON "ModoDeOrdenDeSeccionCarta"
  USING ("empresaId" = (SELECT app_empresa_actual()))
  WITH CHECK ("empresaId" = (SELECT app_empresa_actual()));

-- Privilegios (si los roles existen): leer, agregar y cambiar SOLO el modo; nunca borrar. La consola de plataforma no la toca.
DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_app') THEN
    REVOKE ALL ON "ModoDeOrdenDeSeccionCarta" FROM motor2_app;
    GRANT SELECT, INSERT ON "ModoDeOrdenDeSeccionCarta" TO motor2_app;
    GRANT UPDATE ("modo", "actualizadoPorId", "actualizadoEn", "version") ON "ModoDeOrdenDeSeccionCarta" TO motor2_app;
  END IF;
  IF EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'motor2_plataforma') THEN
    REVOKE ALL ON "ModoDeOrdenDeSeccionCarta" FROM motor2_plataforma;
  END IF;
END
$$;
