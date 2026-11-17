# Diseño — Compras: guarda de apagado de la recepción separada (2026-11-17)

Estado del documento: PROPUESTA para revisión del orquestador. Sin código ni migración. Escalera de 10 niveles (AGENTS.md), versión corta.
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
  - Disparador `BEFORE UPDATE` sobre `ModuloEmpresa`: al pasar `recepcion_de_compras` a INACTIVO cuenta pendientes de la empresa y rechaza con error de restricción. Debe poder ver TODAS las sucursales de la empresa pese a la RLS por sucursal (función `SECURITY DEFINER` con búsqueda fija) — NO VERIFICADO si `motor2_plataforma` ve `FacturaProveedorSucursal`; hay que leer `scripts/operaciones/crear-rol-motor2-plataforma.sql` antes de construir.
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
- Pruebas: concurrencia (apagar vs cargar compra pendiente, `Promise.all`, N repeticiones: nunca pendiente con módulo apagado); idempotencia (apagar dos veces: la segunda es no-op/éxito; rechazo repetido da el mismo error sin auditoría duplicada); aislamiento (pendientes de otra empresa no bloquean); UPDATE directo por psql también falla.
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
- Ninguna para el dueño: la decisión está tomada. Para el orquestador: confirmar que el disparador de base (que cubre el UPDATE directo) es aceptable como segunda barrera.

## Diferencias con Pedernal
- Pedernal no tiene guarda de apagado: «Bajar de plan no toca lo ya cargado» (`perillas.ts:~138-150`, lectura parcial, NO VERIFICADO completo). Diferencia por decisión del dueño 2026-11-17 («3.-lo recomendado por ahora»).
