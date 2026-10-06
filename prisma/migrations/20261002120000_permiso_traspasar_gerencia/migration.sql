-- Migración de DATOS (no cambia el esquema): da de alta la acción `traspasar_gerencia`, de piso GERENTE.
-- Antes el traspaso de la gerencia lo gateaba un `esGerenteDeEmpresa` suelto en la acción (`conGerenteDeEmpresa`); ahora es una clave más del
-- catálogo (una clave por acción, ADR-008). No tiene padre: no existía como clave, así que no se copia nada y ningún rol la recibe; la tiene solo
-- el gerente de la empresa, sin pasar por la matriz. Idempotente.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('traspasar_gerencia', 'Traspasar la gerencia de la empresa a otro administrador')
ON CONFLICT ("clave") DO NOTHING;
