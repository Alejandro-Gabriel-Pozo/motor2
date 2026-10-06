-- Reversa de 20261001210000_politica_de_plataforma_empresa: se pierde la política guardada por empresa (vuelve a valer true para todas, como antes).
ALTER TABLE "Empresa" DROP COLUMN "dosPaneles", DROP COLUMN "permisosEditables";
