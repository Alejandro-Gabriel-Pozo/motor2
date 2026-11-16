-- Migración de DATOS (no cambia el esquema) — Parte, etapa P1: el operador recibe `partes_ver` y `partes_editar` al nacer (REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN CADA BASE REAL, con respaldo y ensayo en una copia).
-- Pedido del dueño (2026-11-16): «como pedernal,» a la pregunta de si el operador tiene los permisos de Parte al nacer, como Pedernal (que le da ver, crear, editar, cambiar roles y vincular contacto, y deja desactivar/reactivar
-- en gerente y administrador). En Motor2 esa frontera es: `partes_ver` y `partes_editar` (piso operario) para el operador; `partes_desactivar` (piso administrador) NO: el operador no la recibe ni la puede recibir.
-- Es lo que una empresa que nace HOY recibe del alta (la semilla `rolesEditarSemilla` de `ACCIONES`): esta migración pone al día las empresas que ya existen. NO edita la 20261115152000_permisos_partes (que sembró solo al admin).
--
-- Por la clave estable del rol (`Rol.clave = 'operador'`), nunca por el nombre (el nombre visible se va a poder cambiar). Un rol propio (clave NULL) no recibe nada (todo nace cerrado). El `empresaId` sale de la fila del rol (la migración
-- corre como DUEÑO, sin RLS, y `app_empresa_actual()` devuelve NULL sin contexto). `ON CONFLICT DO NOTHING`: si la empresa ya tiene la fila (la dio o la apagó el gerente a mano), queda COMO ESTÁ. Empresa sin rol `operador` de sistema:
-- no recibe nada. NO se copia `CapacidadSucursal` (sin fila de capacidad, la acción está habilitada en toda sucursal). La perilla `permisosEditables` no cambia nada acá: bloquea editar la matriz, no la semilla.
--
-- Fase EXPANDIR y aditiva: el código anterior ignora filas de más. Idempotente. Depende de 20261115152000_permisos_partes (las claves `Accion` ya existen; si faltaran, la FK de `PermisoRol` lo frena).
-- Reversa: down.sql (a mano, como dueño). ORDEN DE REVERSA: bajar PRIMERO esta y después 20261115152000 (el down de esa aborta si hay filas de un rol que no es `admin`).

INSERT INTO "PermisoRol" ("id", "empresaId", "rolId", "accionClave", "puedeVer", "puedeEditar")
SELECT gen_random_uuid()::text, r."empresaId", r."id", a."clave", true, true
FROM "Rol" r
CROSS JOIN (VALUES ('partes_ver'), ('partes_editar')) AS a("clave")
WHERE r."clave" = 'operador'
ON CONFLICT ("rolId", "accionClave") DO NOTHING;
