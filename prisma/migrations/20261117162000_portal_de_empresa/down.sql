-- Reversa de 20261117162000_portal_de_empresa (Carta, portal de la empresa PR-A). A mano, como dueño, con `psql -1 -v ON_ERROR_STOP=1`; después `prisma migrate resolve --rolled-back 20261117162000_portal_de_empresa`.
-- ABORTA si hay filas en cualquiera de las tres tablas: se perderían el portal y su código (impreso en QR) y lo cargado en tarjetas y zonas (la auditoría lo conserva, pero no se podría reconstruir el estado). Con las tablas vacías el estado resultante es el de antes (sin portal nuevo).
-- Bajarla dos veces no falla. Saca también las tres funciones de validación (si otra migración posterior las usa —la identidad de la carta, PR-B—, bajar primero esa).
DO $$
DECLARE
  portales bigint;
  tarjetas bigint;
  zonas bigint;
BEGIN
  portales := 0;
  tarjetas := 0;
  zonas := 0;
  IF to_regclass('"PortalDeEmpresa"') IS NOT NULL THEN SELECT count(*) INTO portales FROM "PortalDeEmpresa"; END IF;
  IF to_regclass('"PortalTarjeta"') IS NOT NULL THEN SELECT count(*) INTO tarjetas FROM "PortalTarjeta"; END IF;
  IF to_regclass('"PortalZona"') IS NOT NULL THEN SELECT count(*) INTO zonas FROM "PortalZona"; END IF;
  IF portales > 0 OR tarjetas > 0 OR zonas > 0 THEN
    RAISE EXCEPTION 'No se puede bajar 20261117162000_portal_de_empresa: hay % portal(es), % tarjeta(s) y % zona(s) cargados', portales, tarjetas, zonas;
  END IF;
END
$$;

DROP TABLE IF EXISTS "PortalZona";
DROP TABLE IF EXISTS "PortalTarjeta";
DROP TABLE IF EXISTS "PortalDeEmpresa";
DROP FUNCTION IF EXISTS "PortalZona_proteger"();
DROP FUNCTION IF EXISTS "PortalTarjeta_proteger"();
DROP FUNCTION IF EXISTS "PortalDeEmpresa_proteger"();
DROP FUNCTION IF EXISTS imagen_externa_valida(text, text, text, text, text);
DROP FUNCTION IF EXISTS color_de_carta_valido(text);
DROP FUNCTION IF EXISTS texto_de_catalogo_valido(text, integer);
