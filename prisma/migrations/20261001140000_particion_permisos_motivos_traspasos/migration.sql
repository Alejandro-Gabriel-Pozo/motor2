-- Migración de DATOS (no cambia el esquema): partición de las claves de permisos de los Motivos de merma / Destinos de consumo y de los
-- Traspasos entre sucursales (decisión del dueño, 2026-09-30: UNA clave por acción). Cada acción que colgaba de la clave de otra pasa a tener la suya.
--
-- Fase EXPANDIR: las claves padre (`motivos_movimiento` y `proceso_transferencia_sucursal`) quedan RETIRADAS del catálogo del código pero NO se
-- borran (siguen con sus filas de `Accion`, `PermisoRol` y `CapacidadSucursal` hasta la fase de contracción). Quienes ya podían hacer la acción
-- siguen pudiendo: a cada rol (y a cada capacidad de sucursal) se le copia, para cada clave nueva, lo que ya tenía en el padre. Se copia con el
-- `empresaId` de la fila de origen (la migración corre como dueño, sin RLS: no hay empresa activa de la que tomar el default). Idempotente y sin
-- pisar nada: lo que ya exista para (rol, acción) o (acción, sucursal) queda intacto.

INSERT INTO "Accion" ("clave", "descripcion") VALUES
  ('motivos_merma', 'Administrar el catálogo de Motivos de merma'),
  ('motivos_destino_consumo', 'Administrar el catálogo de Destinos de consumo'),
  ('traspaso_ver_bandeja', 'Ver la bandeja de traspasos con otras sucursales'),
  ('traspaso_solicitar', 'Solicitar a otra sucursal que nos envíe stock (traspaso)'),
  ('traspaso_enviar_directo', 'Enviarle stock a otra sucursal sin que lo haya pedido (traspaso)'),
  ('traspaso_aprobar', 'Aprobar y enviar una solicitud de traspaso que nos hicieron'),
  ('traspaso_cancelar_solicitud', 'Cancelar una solicitud de traspaso propia'),
  ('traspaso_rechazar_solicitud', 'Rechazar una solicitud de traspaso que nos hicieron'),
  ('traspaso_aceptar', 'Aceptar un envío de traspaso que nos mandaron'),
  ('traspaso_rechazar_envio', 'Rechazar un envío de traspaso que nos mandaron'),
  ('traspaso_confirmar_reingreso', 'Confirmar el reingreso de un envío de traspaso que nos rechazaron')
ON CONFLICT ("clave") DO NOTHING;

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, p."empresaId", p."rolId", m."hija", p."puedeVer", p."puedeEditar"
FROM "PermisoRol" p
JOIN (VALUES
  ('motivos_movimiento', 'motivos_merma'),
  ('motivos_movimiento', 'motivos_destino_consumo'),
  ('proceso_transferencia_sucursal', 'traspaso_ver_bandeja'),
  ('proceso_transferencia_sucursal', 'traspaso_solicitar'),
  ('proceso_transferencia_sucursal', 'traspaso_enviar_directo'),
  ('proceso_transferencia_sucursal', 'traspaso_aprobar'),
  ('proceso_transferencia_sucursal', 'traspaso_cancelar_solicitud'),
  ('proceso_transferencia_sucursal', 'traspaso_rechazar_solicitud'),
  ('proceso_transferencia_sucursal', 'traspaso_aceptar'),
  ('proceso_transferencia_sucursal', 'traspaso_rechazar_envio'),
  ('proceso_transferencia_sucursal', 'traspaso_confirmar_reingreso')
) AS m("padre", "hija") ON m."padre" = p."accionClave"
ON CONFLICT ("rolId", "accionClave") DO NOTHING;

INSERT INTO "CapacidadSucursal" ("id", "empresaId", "accionClave", "sucursalId", "habilitado")
SELECT gen_random_uuid()::text, c."empresaId", m."hija", c."sucursalId", c."habilitado"
FROM "CapacidadSucursal" c
JOIN (VALUES
  ('motivos_movimiento', 'motivos_merma'),
  ('motivos_movimiento', 'motivos_destino_consumo'),
  ('proceso_transferencia_sucursal', 'traspaso_ver_bandeja'),
  ('proceso_transferencia_sucursal', 'traspaso_solicitar'),
  ('proceso_transferencia_sucursal', 'traspaso_enviar_directo'),
  ('proceso_transferencia_sucursal', 'traspaso_aprobar'),
  ('proceso_transferencia_sucursal', 'traspaso_cancelar_solicitud'),
  ('proceso_transferencia_sucursal', 'traspaso_rechazar_solicitud'),
  ('proceso_transferencia_sucursal', 'traspaso_aceptar'),
  ('proceso_transferencia_sucursal', 'traspaso_rechazar_envio'),
  ('proceso_transferencia_sucursal', 'traspaso_confirmar_reingreso')
) AS m("padre", "hija") ON m."padre" = c."accionClave"
WHERE NOT EXISTS (
  SELECT 1 FROM "CapacidadSucursal" x
  WHERE x."empresaId" = c."empresaId" AND x."accionClave" = m."hija" AND x."sucursalId" IS NOT DISTINCT FROM c."sucursalId"
);
