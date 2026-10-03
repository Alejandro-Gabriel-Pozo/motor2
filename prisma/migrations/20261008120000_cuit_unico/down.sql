-- Reversa de 20261008120000_cuit_unico: vuelve a regir solo el código. El backfill (CUIT canónico, vacío → NULL) no se revierte: no pierde información.
DROP INDEX IF EXISTS "Proveedor_empresaId_cuit_key";
DROP INDEX IF EXISTS "Empresa_cuit_key";
