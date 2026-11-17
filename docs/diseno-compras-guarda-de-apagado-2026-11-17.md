# Diseño — Compras: guarda de apagado de la recepción separada (2026-11-17)

Estado del documento: disparador de base APROBADO por el orquestador (2026-11-17) como segunda barrera, con tres condiciones (abajo, sección 10). Orden de turnos de schema: #364 → guarda de apagado → `Seccion.uso`, de a uno, cada uno con verificación independiente. Sin código ni migración. Escalera de 10 niveles (AGENTS.md), versión corta.
Lo no leído está marcado NO VERIFICADO. Base real leída el 2026-11-17 sobre `feat/compras-recepcion-separada-n3a` (#364, head `a7cdaea7`).

## 1. Propósito y alcance
- **Necesidad (CONFIRMADA, dueño 2026-11-17, chat, registro `motor2-docs` a520c0e, citado por el orquestador):** «3.-lo recomendado por ahora» → el sistema NO deja apagar el módulo `recepcion_de_compras` mientras haya compras pendientes de recibir. Convierte en requisito el límite que #364 dejó documentado.
- Entra: la guarda en las dos vías que escriben `ModuloEmpresa` y una restricción en la base. No entra: recibir solo las pendientes al apagar, avisos, ni cambios de pantalla de la app.
- «Módulo/opción» del mensaje del dueño: en el código solo existe el módulo (no hay otra opción de recepción separada; `catalogo.ts:30`, `schema.prisma` sin columna aparte). VERIFICADO.

## 2. Actores y contexto
- Quien apaga: operador de plataforma desde la consola (`plataforma/src/servidor/modulos.ts:39-71`) o el script de emergencia (`src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts:16-42`). Ninguna pantalla de la app lo hace.
- Quien carga compras pendientes: usuarios de la empresa, por sucursal (RLS por sucursal).

## 3. Casos de uso
- CU1: apagar `recepcion_de_compras` con 0 pendientes → se apaga (como hoy).
- CU2: apagar con ≥1 pendiente → rechazado con mensaje que dice cuántas y en qué sucursales; no cambia nada.
- CU3: encender → sin cambios.
- CU4: cargar una compra con el módulo encendido mientras alguien lo apaga (carrera) → una de las dos gana y el resultado es coherente (sección 7).

## 4. Conceptos y ciclo de vida
- «Pendiente de recibir» = `FacturaProveedorSucursal.estadoRecepcion='PENDIENTE'` y factura no anulada (`anuladaEn IS NULL`), de cualquier sucursal de la empresa. Una factura anulada ya no se puede recibir, así que NO bloquea el apagado (mismo criterio que `listarComprasPorRecibir`, `facturas-proveedor.ts:~117`).

## 5. Invariantes y políticas
- I-1: no existe a la vez `ModuloEmpresa(recepcion_de_compras)=INACTIVO` y una parte pendiente no anulada de esa empresa. Lo impone la BASE, no solo el caso de uso (hay caminos de escritura fuera de la app: `psql`, otro script).
- I-2: con el módulo apagado no puede nacer una parte PENDIENTE (hoy lo decide `estadoInicialDeLaParte`; la base lo respalda).
- Nace cerrado: ante duda (no se pudo contar), no se apaga.

## 6. Historia y persistencia
- Sin tablas nuevas. Auditoría: el intento rechazado deja registro en `AuditoriaPlataforma` («modulo-desactivar-rechazado», con cantidad de pendientes) — PROPUESTA; hoy solo se audita lo que se aplica.
- Migración (turno de schema, de a uno): aditiva, con `down.sql` y `verificacion-previa.sql`:
  - Disparador `BEFORE UPDATE` sobre `ModuloEmpresa`: al pasar `recepcion_de_compras` a INACTIVO cuenta pendientes de la empresa y rechaza con error de restricción. Debe poder ver TODAS las sucursales de la empresa pese a la RLS por sucursal: función `SECURITY DEFINER` con búsqueda fija.
  - VERIFICADO (lectura de `scripts/operaciones/crear-rol-motor2-plataforma.sql:75-77`): `motor2_plataforma` NO tiene ningún permiso sobre `FacturaProveedorSucursal` (solo `SELECT, INSERT, UPDATE` sobre `Empresa` y `ModuloEmpresa`, y `SELECT` sobre `User`/`UsuarioEmpresa`). Por eso el conteo NO puede hacerse desde la consola con una consulta propia, y NO se agrega un GRANT (el test `test/arquitectura/grants-igual-a-uso.test.ts` compara cada línea con lo que la plataforma hace de verdad, y la regla es no dar de más): el conteo vive solo dentro de la función `SECURITY DEFINER`, que corre con los permisos del dueño. Consecuencia: el mensaje con el detalle «N compras, sucursales: …» sale del texto de error de la función (la función devuelve cantidad y nombres de sucursal en el mensaje de la excepción); ambas vías lo traducen. NO VERIFICADO: la RLS por sucursal con el dueño de la función (el dueño no es `motor2_app`; hay que probar con una base real que la función ve todas las sucursales).
  - Disparador `BEFORE INSERT` sobre `FacturaProveedorSucursal` cuando `estadoRecepcion='PENDIENTE'`: `SELECT … FROM ModuloEmpresa … FOR SHARE` del módulo ACTIVO; si no hay, rechaza. Esto cierra la carrera del punto 7.
- Los dos casos de uso (consola y script) traducen el error de la base a un mensaje claro; la función pura `validarCambioDeModulos` (`core/modulos/clausura.ts`) no cambia (no hay datos en ella). Si se prefiere chequeo previo, se le pasa un conteo ya leído; la base igual manda.

## 7. Atomicidad y concurrencia
- Hoy el apagado toma la fila de la empresa `FOR UPDATE` (`bloquearEmpresa`). El `FOR SHARE` sobre `ModuloEmpresa` del insert de una parte pendiente choca con el `UPDATE` del apagado: o la compra se carga primero (el apagado ve la pendiente y se rechaza) o el apagado gana primero (la carga ve «módulo apagado» y nace RECIBIDA, no PENDIENTE). Nunca queda una pendiente con el módulo apagado.
- Recibir (confirmar) una pendiente mientras se apaga: confirmar solo reduce pendientes; el apagado cuenta dentro de su transacción en SERIALIZABLE (o con el bloqueo anterior) y reintenta si hay conflicto.
- Rechazo por error de base = nada cambió (una sola sentencia).

## 8. Acceso e interfaces
- Permisos: sin cambios (la plataforma ya es el único camino).
- Texto nuevo (PROPUESTA, a aprobar): «No se puede apagar la recepción separada de compras: hay N compra(s) pendientes de recibir (sucursales: …). Recibilas o anulalas antes.»
- Camino futuro: cuando se conecte el techo del plan (M1b), `asignarPlan` podría apagar módulos de hecho; debe pasar por la misma guarda. PENDIENTE con nombre; hoy no apaga nada (VERIFICADO por grep).

## 9. Consultas y experiencia
- La consola muestra el error al operador. Hay que escribir `contarComprasPorRecibirDeLaEmpresa` (hoy `listarComprasPorRecibir` es por sucursal; no existe consulta por empresa).

## 10. Pruebas, migración y operación
- Dimensiones que cambian el resultado (oráculo escrito aparte): {vía: consola, script, UPDATE directo} × {pendientes: 0, ≥1 sin anular, solo anuladas, solo recibidas} × {otra sucursal de la misma empresa, otra empresa} × {desactivar, activar}. Se recorre completo contra una tabla.
- Condiciones del orquestador (2026-11-17): (a) prueba de concurrencia REAL con dos transacciones (apagar vs cargar pendiente: nunca queda el módulo apagado con una pendiente viva), (b) mensaje traducido en AMBAS vías (consola y script), (c) el camino futuro M1b (techo del plan) pasa por la misma guarda (por eso la guarda es de base).
- Pruebas: concurrencia (apagar vs cargar compra pendiente, dos transacciones reales abiertas a la vez, N repeticiones: nunca pendiente con módulo apagado); idempotencia (apagar dos veces: la segunda es no-op/éxito; rechazo repetido da el mismo error sin auditoría duplicada); aislamiento (pendientes de otra empresa no bloquean); UPDATE directo por psql también falla.
- Migración reversible: `down.sql` borra los disparadores y la función. Sin datos que migrar.
- Riesgo: el disparador de INSERT agrega un bloqueo compartido a cada carga de compra pendiente; costo bajo, pero bajo carga NO VERIFICADO.

## Tabla «¿qué pasa si…?»
| Caso | Resultado esperado |
|---|---|
| Se repite apagar con 0 pendientes | No-op, éxito, sin duplicar auditoría |
| Se repite apagar con ≥1 pendiente | Mismo rechazo, sin cambios |
| Dos operadores apagan a la vez | Uno aplica, el otro ve «ya apagado» |
| Apagar y cargar compra a la vez | Ver sección 7: coherente, nunca pendiente con módulo apagado |
| Se recibe la última pendiente justo antes | El apagado procede |
| Solo quedan pendientes anuladas | Se apaga |
| Corte de red a mitad | La base queda como antes (una sentencia) |
| No se puede contar (error de lectura) | Se rechaza (falla cerrada) |
| Pendientes en otra sucursal de la empresa | Bloquean (el conteo es por empresa) |
| UPDATE directo en la base | Rechazado por el disparador |
| Cambia el permiso del operador a mitad | Sin cambio: la plataforma ya autoriza antes de la transacción |

## Preguntas abiertas
- Ninguna. Decisión del dueño tomada; disparador de base aprobado por el orquestador.

## Diferencias con Pedernal
- Pedernal no tiene guarda de apagado: «Bajar de plan no toca lo ya cargado» (`perillas.ts:~138-150`, lectura parcial, NO VERIFICADO completo). Diferencia por decisión del dueño 2026-11-17 («3.-lo recomendado por ahora»).

## Implementación (2026-11-17, etapa construida; sin aplicar a ninguna base real)
- Migración `20261117170000_guarda_de_apagado_recepcion_separada` (con `down.sql` y `verificacion-previa.sql`): función `compras_pendientes_de_recepcion` (SECURITY DEFINER, `search_path` fijo, EXECUTE revocado a PUBLIC), disparador BEFORE UPDATE de `ModuloEmpresa` y disparador BEFORE INSERT de `FacturaProveedorSucursal`. SQLSTATE 23514 con restricciones `ModuloEmpresa_recepcion_pendientes_chk` y `FacturaProveedorSucursal_modulo_recepcion_chk`. Sin GRANTs nuevos.
- VERIFICADO (Postgres 16 local, base descartable): el dueño de la función ve todas las sucursales pese a la RLS (la cuenta de «otra sucursal» da la cantidad correcta como `motor2_plataforma`); el disparador de INSERT necesita SECURITY DEFINER porque `motor2_app` solo tiene SELECT sobre `ModuloEmpresa` y un `FOR SHARE` exige un privilegio de escritura. NO VERIFICADO: Neon (otra versión de Postgres) y el costo bajo carga.
- El disparador de apagado vuelve a tomar la fila (`FOR NO KEY UPDATE`) ANTES de contar, para que una carga que tenga el `FOR SHARE` se espere y la cuenta la vea confirmada. Fuera de READ COMMITTED cierra y no deja apagar (la cuenta podría no ver una compra recién confirmada); la consola y el script usan el nivel por defecto. También se rechaza cambiarle a la fila el módulo o la empresa (equivale a apagarla).
- Límite declarado: un DELETE de la fila de `ModuloEmpresa` no pasa por la guarda; solo lo hace el dueño (la plataforma no tiene DELETE, ADR-012 §3).
- Traducción: `src/core/modulos/guarda-de-apagado.ts` (puro) reconoce la marca `GUARDA_APAGADO_RECEPCION|N|sucursales` del mensaje; la consola devuelve `ok: false` con el texto y el script lanza `ModulosDeEmpresaError` con el mismo texto. La función pura `validarCambioDeModulos` no cambió.
- Rastro del intento rechazado («modulo-desactivar-rechazado», con módulo y cantidad) en AuditoriaPlataforma, escrito DESPUÉS del rechazo en otra escritura (la excepción de la base revierte la transacción; no hay forma de auditar dentro de ella). Cada intento deja su fila; el apagado aplicado repetido no audita. Si no se puede escribir el rastro, el rechazo igual se informa y el texto agrega «No se pudo dejar el rastro del intento en la auditoría de plataforma.» (PROPUESTA, igual que el texto principal).
- Fixtures de test que sembraban partes pendientes a mano sin el módulo encendido ahora lo encienden (`encenderRecepcionDeCompras`); el fixture e2e de «una sola compra» siembra la parte RECIBIDA (así la escribe el sistema).
- Oráculo: `docs/oraculo-combinaciones-compras-guarda-de-apagado-2026-11-17.md`.
