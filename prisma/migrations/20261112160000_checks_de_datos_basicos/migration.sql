-- «TODO NACE CERRADO» EN LA BASE (paso 10 de la auditoría de primitivas, docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md §8; el dueño autorizó el paso el 2026-11-12:
-- «TENES MI AUTORIZACIÓN»; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo):
-- la base rechaza lo que la app ya rechaza, para que un camino que se salte la app (un script, una carga a mano) no pueda guardar un estado inválido.
--  - Empresa.moneda: tres letras mayúsculas (código ISO; hoy todas son 'ARS'; el esquema de alta todavía acepta otros códigos, por eso no se fija en 'ARS').
--  - NO se agregan CHECK a Empresa.cuit ni Proveedor.cuit: muchas pruebas y el seed de demo guardan el CUIT con guiones directo en la base. Queda como decisión pendiente del dueño.
--  - UsuarioEmpresa.rolEmpresa: nulo o 'gerente' (único rol de empresa que existe).
--  - CotizacionDolar.fuente: 'BNA' o 'BCRA' (las dos fuentes de src/core/reportes/cotizacion-dolar.ts).
--  - Cliente.descuentoPorcentaje: 0 <= x < 100 (D4, validarPorcentajeDescuento).
-- Verificado en solo lectura el 2026-11-12 contra las dos bases de producción (zuluhub y stockhneuquen): ninguna fila viola ninguna regla.
-- ADITIVA y sin cambio de columnas: el código anterior sigue funcionando (solo se rechaza lo que ya rechazaba). Cada CHECK se agrega NOT VALID y se valida en el acto: si hubiera una fila
-- inválida, la migración ABORTA entera (una transacción) sin dejar nada a medias.
-- Reversa: down.sql (a mano, como dueño; idempotente).

ALTER TABLE "Empresa" ADD CONSTRAINT "Empresa_moneda_chk" CHECK ("moneda" ~ '^[A-Z]{3}$') NOT VALID;
ALTER TABLE "UsuarioEmpresa" ADD CONSTRAINT "UsuarioEmpresa_rolEmpresa_chk" CHECK ("rolEmpresa" IS NULL OR "rolEmpresa" = 'gerente') NOT VALID;
ALTER TABLE "CotizacionDolar" ADD CONSTRAINT "CotizacionDolar_fuente_chk" CHECK ("fuente" IN ('BNA', 'BCRA')) NOT VALID;
ALTER TABLE "Cliente" ADD CONSTRAINT "Cliente_descuentoPorcentaje_chk" CHECK ("descuentoPorcentaje" >= 0 AND "descuentoPorcentaje" < 100) NOT VALID;

ALTER TABLE "Empresa" VALIDATE CONSTRAINT "Empresa_moneda_chk";
ALTER TABLE "UsuarioEmpresa" VALIDATE CONSTRAINT "UsuarioEmpresa_rolEmpresa_chk";
ALTER TABLE "CotizacionDolar" VALIDATE CONSTRAINT "CotizacionDolar_fuente_chk";
ALTER TABLE "Cliente" VALIDATE CONSTRAINT "Cliente_descuentoPorcentaje_chk";
