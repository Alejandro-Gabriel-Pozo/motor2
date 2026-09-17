# Plan I3 — Idempotencia: planificación y auditoría de datos (sin cambios de código)

**Fecha**: 2026-09-17
**Autorización vigente**: *"Arrancá con I3, pero únicamente con la fase previa de planificación y auditoría de datos. Todavía no autoriza cambios de código ni migraciones."*
**Alcance de este documento**: solo lectura de código y de datos, y diseño en papel. No se tocó `prisma/schema.prisma`, no se creó ninguna migración, no se modificó ninguna Server Action ni ningún componente de frontend, no se agregó ninguna dependencia, no se creó ningún constraint, no cambió ningún contrato de respuesta.

Este documento complementa — no reemplaza — el cierre del Pivote 2 en `docs/auditoria-motor2-pivotes-2026-09-16.md` §7-8 (política de negocio, matriz de cobertura de 10 procesos, reglas técnicas de conflicto de clave y de factura sin número) y el borrador de plan en §11 "Plan 4 — I3". Donde este documento contradice o precisa algo de esas secciones (dos casos: la cobertura real de `Operacion` y la recomendación reconstruir-vs-persistir), se marca explícitamente como corrección, no como sustitución silenciosa.

---

## 0. Resumen ejecutivo

| # | Punto pedido | Resuelto en |
|---|---|---|
| 1 | Modelo de idempotencia (dónde y qué se guarda) | §2 |
| 2 | Comportamiento ante duplicados | §3 |
| 3 | Resultado original: reconstruir vs. persistir (las 8 Server Actions) | §4 |
| 4 | Auditoría de facturas duplicadas en datos reales | §5 |
| 5 | Cobertura de los 10 procesos | §6 |
| 6 | Garantía de concurrencia con la misma clave | §7 |

Y, además, los ítems que el usuario exige tener resueltos antes de la próxima autorización: diseño de schema (§8), migración segura (§9), estrategia de rollback (§9.4), estrategia de compatibilidad temporal (§9.3), matriz de Server Actions afectadas (§6), pruebas de caracterización (§10), decisión final sobre reconstrucción del resultado original (§4.5).

**Hallazgo nuevo de esta fase** (no estaba resuelto en el cierre del Pivote 2): dos de los diez procesos —`crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia`, que no forman parte de la lista pedida, y **`rechazarTransferencia`, que sí forma parte de la lista**— no crean ninguna fila en `Operacion`. Una clave de idempotencia modelada como columna de `Operacion` no puede cubrir `rechazarTransferencia` de forma estructural. Ver §6.4 para el análisis y la resolución propuesta.

---

## 1. Corrección de alcance antes de empezar

El pedido dice "las ocho Server Actions". Contando los 10 procesos de la política contra los `export async function` reales:

| Proceso de la política | Server Action | Archivo |
|---|---|---|
| COMPRA | `registrarMovimiento` (proceso="COMPRA") | `movimientos.ts` |
| CONSUMO | `registrarMovimiento` (proceso="CONSUMO") | `movimientos.ts` |
| MERMA | `registrarMovimiento` (proceso="MERMA") | `movimientos.ts` |
| PRODUCCIÓN | `registrarMovimiento` (proceso="PRODUCCION") | `movimientos.ts` |
| DEVOLUCIONES (proveedor/consignación/cliente) | `registrarMovimiento` (proceso="DEVOLUCION_*") | `movimientos.ts` |
| VENTA | `registrarVenta` | `venta.ts` |
| RECLASIFICACIÓN | `reclasificarStock` | `reclasificacion.ts` |
| Aceptación de traspaso | `aceptarTransferencia` | `traspasos.ts` |
| Rechazo de traspaso | `rechazarTransferencia` | `traspasos.ts` |
| Reingreso de traspaso | `confirmarReingresoTransferencia` | `traspasos.ts` |

Son **10 procesos, pero 6 Server Actions** — `registrarMovimiento` es un único punto de entrada compartido por 7 de los 10 procesos (COMPRA, CONSUMO, MERMA, PRODUCCIÓN y las 3 variantes de DEVOLUCIÓN), distinguidos por el campo `proceso` del payload, no por función. El "ocho" del plan borrador (§11 Plan 4 del documento madre) contaba mal — quedó corregido acá. Esto en realidad simplifica la implementación: el mecanismo general se agrega en **6 funciones**, no en 8, y cubre los 10 procesos porque `registrarMovimiento` ya recibe `proceso` como parte del payload.

Confirmado por lectura de código, no se creó ni se tocó ningún archivo para llegar a esta tabla.

---

## 2. Modelo de idempotencia

### 2.1 Qué se guarda y dónde

Ampliar `Operacion` (append-only, ya es la tabla que registra "esto pasó una vez") con tres columnas nuevas, todas nulleables:

| Columna | Tipo | Contenido |
|---|---|---|
| `claveIdempotencia` | `String?` | El UUID que genera el cliente al abrir el formulario/modal (`crypto.randomUUID()`), reenviado tal cual en cualquier reintento de ESE intento de envío. |
| `payloadHash` | `String?` | Hash (SHA-256, ya disponible vía `node:crypto`, sin dependencia nueva) del payload validado que efectivamente se procesó — permite decidir "mismo payload" sin comparar objetos JSON campo por campo ni guardar el payload completo. |
| — | — | No hace falta una columna `resultado`/`mensaje` — ver §4 (decisión: reconstruir, no persistir). |

No es una tabla nueva (`ClaveIdempotencia` separada) por la misma razón que ya usa el proyecto para el resto de este esquema: `Operacion` YA es el registro de "esto se ejecutó" — una tabla aparte duplicaría esa responsabilidad y sería una segunda fuente de verdad sobre qué operaciones existen, exactamente el patrón que esta auditoría viene señalando como riesgoso (ver Merma sin signo, v2.1.0). La columna vive en la fila que de todos modos ya se crea.

### 2.2 Índice de unicidad

```prisma
@@unique([sucursalId, proceso, claveIdempotencia], name: "Operacion_idempotencia_key")
```

`sucursalId + proceso` (no solo la clave sola) porque un UUID es único de por sí — el criterio compuesto no aporta seguridad extra sobre colisión, pero sí dos cosas: (a) dos sucursales nunca podrían competir por la misma fila aunque un cliente generara el mismo UUID por un bug (defensa en profundidad, costo cero); (b) permite que la búsqueda "¿ya existe esta clave para este proceso en esta sucursal?" use el mismo índice que la unicidad, sin un índice adicional. Un índice único con una columna nulleable en Postgres **no bloquea múltiples NULL** (NULL no se compara igual a NULL) — así que las operaciones que todavía no manden clave (ver §9.3, rollout) conviven sin conflicto con las que sí la mandan.

### 2.3 Retención

Permanente — sin expiración, sin job de limpieza, sin TTL. Coincide con que `Operacion` ya es append-only y nunca se purga. Costo de storage: un UUID (16-36 bytes) + un hash (32 bytes) por operación, despreciable frente al resto de la fila.

---

## 3. Comportamiento ante duplicados

Regla ya cerrada en el documento madre (§8, "Reglas técnicas explícitas") — se repite acá porque es la base de todo el resto de este plan, sin cambios:

```text
clave nueva (no existe ninguna Operacion con esa combinación
  sucursalId+proceso+claveIdempotencia)
  → ejecutar la operación una sola vez, guardar la clave y el hash
    junto con la Operacion recién creada.

misma clave + mismo payload (el payloadHash coincide con el guardado)
  → NO se vuelve a ejecutar nada. Se reconstruye y se devuelve el
    resultado de la primera ejecución, con ok:true — el cliente no
    puede distinguir un duplicado silencioso de una ejecución nueva
    exitosa (ese es el punto: un doble-submit no debe alarmar a quien
    hizo el segundo click, ya salió bien la primera vez).

misma clave + payload distinto (el payloadHash NO coincide)
  → se rechaza con ok:false y un mensaje de conflicto de idempotencia
    explícito (ej. "Esta operación ya se envió con datos distintos —
    recargá la página e intentalo de nuevo."). Nunca se ejecuta el
    payload nuevo bajo una clave que ya representa otro intento.
```

El caso "payload distinto" es intencionalmente estricto: no se intenta adivinar cuál de los dos payloads es el "correcto" ni se hace merge. Es indicio de un bug de cliente (reutilizó una clave vieja) o de un intento de replay — en cualquier caso, la respuesta correcta es rechazar y forzar un nuevo intento con una clave nueva, nunca ejecutar silenciosamente.

---

## 4. Resultado original: reconstruir vs. persistir

### 4.1 El problema tal cual está planteado

Hoy ningún `ResultadoAccion`/`ResultadoConId` se persiste — es `{ ok: true, mensaje: string }` (y, en 2 de las 10, también `id`/`nombre`) generado en memoria y devuelto directamente al cliente. Para "devolver el resultado original" ante un duplicado hay que decidir de dónde sale ese objeto la segunda vez.

### 4.2 Opción A — Reconstruir desde `Operacion`/`MovimientoStock`

Volver a generar el `mensaje` en el momento de detectar el duplicado, a partir de lo que ya quedó escrito en la primera ejecución (contar filas de `MovimientoStock` de esa `Operacion`, releer campos de `Operacion`, etc.).

### 4.3 Opción B — Persistir el resultado

Agregar una columna `resultadoMensaje String?` (y, donde aplique, `resultadoId`) a `Operacion`, y guardar ahí exactamente el string que se devolvió la primera vez. Ante un duplicado, se lee esa columna tal cual — cero lógica de reconstrucción.

### 4.4 Verificación real contra las 6 Server Actions (10 procesos)

Se leyó el cuerpo completo de las 6 funciones para ver qué tan determinista es reconstruir cada mensaje:

| Server Action | Mensaje real (código) | ¿Reconstruible sin duplicar lógica? |
|---|---|---|
| `registrarMovimiento` (7 procesos) | `` `Se guardaron ${filas.length} movimiento(s).${avisoConversion}` `` — `avisoConversion` es un sufijo **condicional**, calculado a partir de si alguna línea tuvo conversión de unidad (comparando `unidadStock` del producto contra la unidad usada en el ítem) | **No sin costo**: reconstruirlo exige releer cada línea, volver a comparar unidades, y reproducir el `if` que arma el sufijo — es la MISMA lógica de negocio, escrita una segunda vez en el camino de "duplicado". Es exactamente el patrón de doble fuente de verdad que esta auditoría marcó como causa raíz de la "Merma sin signo" (Apps Script v2.1.0). |
| `registrarVenta` | `` `Se registraron ${ventas.length} venta(s) correctamente.` `` | Sí, trivial — solo depende de `count()` de `MovimientoStock` de esa `Operacion` con `proceso="VENTA"`. |
| `anularVenta` | `` `Venta anulada. Se revirtieron ${filas.length} línea(s) de stock${filas.some(f => f.proceso === "LIQUIDACION_CONSIGNACION") ? " y la liquidación de consignación" : ""}.` `` | **No sin costo** — mismo problema que `registrarMovimiento`: el sufijo depende de si alguna fila reversora fue de liquidación de consignación, una condición de negocio que hay que volver a evaluar. |
| `reclasificarStock` | `` `"${producto.nombre}" reclasificado: ${disponible} repartido en ${datos.destinos.length} destino(s).` `` | Sí, con cuidado: `disponible` es el saldo ANTES de reclasificar (no se puede recalcular desde el estado actual sin arrastrar el resto de movimientos posteriores) — habría que guardarlo en una columna de la `Operacion`/primera `MovimientoStock`, o aceptar recalcularlo mal. Parcialmente reconstruible. |
| `aceptarTransferencia` | `` `Recibido de "${origen.nombre}".` `` | Sí, trivial — `origen.nombre` sale de una FK ya existente en `TraspasoSucursal`. |
| `confirmarReingresoTransferencia` | `` `Reingreso confirmado: se sumó de nuevo ${cantidad} de "${traspaso.producto.nombre}" en "${seccionOrigen.nombre}".` `` | Sí, trivial — todos los valores ya están en `TraspasoSucursal`/`MovimientoStock`. |
| `rechazarTransferencia` | `"Transferencia rechazada — queda pendiente que el origen confirme el reingreso a su stock."` | Sí, trivial — string fijo, sin interpolación condicional. Pero ver §6.4: esta acción no tiene ninguna `Operacion` donde guardar la clave. |

**Resultado de la verificación**: de los 6 puntos de entrada, **2 tienen un mensaje con lógica condicional no trivial** (`registrarMovimiento`, `anularVenta`) y **1 depende de un valor "antes del cambio" que no sobrevive en el estado final** (`reclasificarStock`). Los otros 3 son triviales de reconstruir.

### 4.5 Decisión — revisión de la recomendación anterior

El borrador de plan (documento madre §11 Plan 4, punto 4) recomendaba tentativamente la Opción A (reconstruir), condicionado explícitamente a "verificarse para las ocho Server Actions". Esa verificación ya se hizo (§4.4) y el resultado **no sostiene la recomendación original**: 2 de 6 puntos de entrada exigirían reimplementar una porción real de la lógica de negocio (el cálculo de `avisoConversion`, el chequeo de `LIQUIDACION_CONSIGNACION`) en un segundo lugar del código — el mismo patrón de "segunda fuente de verdad" que este proyecto evita deliberadamente en todo el resto del esquema (Kardex append-only en vez de un campo `stockActual` mutable, `Operacion` como único lugar donde "pasó algo" en vez de un log paralelo, etc.), y que causó el bug histórico de Merma sin signo.

**Recomendación revisada: Opción B (persistir el resultado)**, con el costo aceptado de una columna `resultadoMensaje String?` (y, para los 2 procesos que devuelven `id`/`nombre` — aunque esos 2, `crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia`, no están en el alcance de los 10 procesos de esta política, así que en la práctica ningún proceso de la política actual necesita guardar `id`). Es una corrección transparente de la recomendación anterior, no una preferencia nueva sin base: la base es la verificación real contra las 6 Server Actions que el propio pedido exigió hacer antes de decidir.

Costo de la Opción B: una columna de texto más por `Operacion` (storage despreciable, mismo orden que `detalleLibre` que ya existe) y una escritura extra en el mismo insert que ya se hace — no una segunda transacción ni un round-trip adicional.

Esta decisión queda **pendiente de confirmación del usuario** antes de implementarse — se presenta acá como la recomendación técnica revisada, no como algo ya resuelto unilateralmente.

---

## 5. Auditoría de datos reales — facturas duplicadas

### 5.1 Limitación del entorno de esta sesión

Esta sesión **no tiene acceso a la base de datos de producción/Neon** — solo a la base de test local (`motor2_test`), que además se vacía por completo en cada corrida de test (`limpiarBaseDeTest()` en `beforeEach`). Se verificó el estado actual de esa base:

```sql
SELECT count(*) AS total_operaciones,
       count(*) FILTER (WHERE "nroFactura" IS NOT NULL) AS con_factura
FROM "Operacion";
```

Resultado: **3 filas totales, 0 con `nroFactura`** — restos de una corrida manual anterior de este mismo contenedor de sesión, no datos representativos de nada. No hay nada que auditar localmente.

**Este punto del pedido no puede completarse en esta sesión** — lo que sigue es la metodología exacta para que alguien con acceso a producción la ejecute, más las categorías de clasificación pedidas.

### 5.2 Query de auditoría (para ejecutar contra producción)

```sql
-- 1. Duplicados exactos: misma sucursal + proveedor + número de factura,
--    más de una Operacion de COMPRA.
SELECT "sucursalId", "proveedorId", "nroFactura", count(*) AS repeticiones,
       array_agg(id ORDER BY fecha) AS operacion_ids,
       array_agg(fecha ORDER BY fecha) AS fechas
FROM "Operacion"
WHERE proceso = 'COMPRA' AND "nroFactura" IS NOT NULL
GROUP BY "sucursalId", "proveedorId", "nroFactura"
HAVING count(*) > 1
ORDER BY repeticiones DESC;

-- 2. Números vacíos o solo espacios (candidatos a normalizar antes de
--    aplicar el índice, para que "" y NULL no se traten distinto).
SELECT id, "sucursalId", "proveedorId", "nroFactura", fecha
FROM "Operacion"
WHERE proceso = 'COMPRA' AND "nroFactura" IS NOT NULL AND trim("nroFactura") = '';

-- 3. Posibles duplicados por diferencia de formato (espacios internos,
--    guiones, ceros a la izquierda) — no los detecta el índice literal,
--    hace falta revisión humana de esta lista.
SELECT "sucursalId", "proveedorId",
       regexp_replace(lower(trim("nroFactura")), '[^a-z0-9]', '', 'g') AS normalizado,
       array_agg(DISTINCT "nroFactura") AS variantes_textuales,
       array_agg(id) AS operacion_ids
FROM "Operacion"
WHERE proceso = 'COMPRA' AND "nroFactura" IS NOT NULL AND trim("nroFactura") <> ''
GROUP BY "sucursalId", "proveedorId", normalizado
HAVING count(DISTINCT "nroFactura") > 1;

-- 4. Mismo número de factura, pero proveedor o sucursal DISTINTOS — no
--    son duplicados bajo la constraint propuesta (que es por sucursal+
--    proveedor+número), se listan solo para que el negocio confirme que
--    ese es el criterio correcto y no, por ejemplo, "número de factura
--    único por proveedor sin importar la sucursal".
SELECT "nroFactura", count(DISTINCT "proveedorId") AS proveedores_distintos,
       count(DISTINCT "sucursalId") AS sucursales_distintas, count(*) AS total
FROM "Operacion"
WHERE proceso = 'COMPRA' AND "nroFactura" IS NOT NULL AND trim("nroFactura") <> ''
GROUP BY "nroFactura"
HAVING count(DISTINCT "proveedorId") > 1 OR count(DISTINCT "sucursalId") > 1;

-- 5. Para cada grupo detectado en (1): ¿el payload real (líneas de
--    MovimientoStock) es igual o distinto entre las Operaciones
--    duplicadas? Distingue "se cargó la misma factura dos veces por
--    error" de "dos compras distintas que por error comparten número"
--    (ej. proveedor reutilizó un número).
SELECT o.id AS operacion_id, o."nroFactura", m."productoId", m.cantidad, m."precioTotal"
FROM "Operacion" o
JOIN "MovimientoStock" m ON m."operacionId" = o.id
WHERE o.id = ANY(:operacion_ids_de_un_grupo_del_query_1)
ORDER BY o.id, m."productoId";
```

### 5.3 Clasificación pedida — a completar por quien corra el query 1 en producción

| Categoría | Cómo se detecta (query) | Acción si aparece |
|---|---|---|
| Duplicados exactos | Query 1 | Antes de migrar: decidir con el negocio si se fusionan/anulan (nunca borrar filas de un Kardex append-only — se documenta y, si corresponde, se revierte con una `Operacion` de ajuste, mismo criterio que el resto del proyecto) |
| Números vacíos | Query 2 | No bloquean el índice (`WHERE "nroFactura" IS NOT NULL`) — pero si hay strings vacíos en vez de NULL real, conviene normalizarlos a NULL antes de migrar para que el índice parcial los excluya de verdad |
| Espacios/diferencias de formato | Query 3 | Requieren revisión humana — el índice no los va a detectar como duplicados porque son literalmente strings distintos; documentar aparte, no bloquean la migración |
| Proveedores/sucursales distintos con mismo número | Query 4 | No son duplicados bajo el criterio `sucursalId+proveedorId+nroFactura` — solo confirmar con el negocio que ese es el criterio correcto |
| Facturas con payload diferente | Query 5, aplicado a cada grupo de query 1 | Señal de que puede no ser un error de doble carga sino una reutilización real de número por el proveedor — afecta la decisión de qué hacer con cada grupo de (1), no bloquea el índice en sí |
| Datos que impedirían el índice parcial | Cualquier fila de query 1 con `repeticiones > 1` | Es la única categoría que técnicamente hace fallar el `CREATE UNIQUE INDEX` — es un prerequisito duro, no opcional, antes de aplicar la migración del índice de factura (ver §9.2) |

**No se puede cerrar este punto del pedido sin que alguien con acceso a producción corra el query 1** y reporte si devuelve filas. Mientras tanto, la migración del índice de factura queda marcada como bloqueada (§9.2).

---

## 6. Cobertura de los 10 procesos

### 6.1 Matriz de cobertura del mecanismo general (clave de idempotencia)

| # | Proceso | Server Action | ¿Crea `Operacion`? | ¿Cubierto por la columna `claveIdempotencia` en `Operacion`? |
|---|---|---|---|---|
| 1 | COMPRA | `registrarMovimiento` | Sí | Sí |
| 2 | CONSUMO | `registrarMovimiento` | Sí | Sí |
| 3 | VENTA | `registrarVenta` | Sí | Sí |
| 4 | MERMA | `registrarMovimiento` | Sí | Sí |
| 5 | PRODUCCIÓN | `registrarMovimiento` | Sí | Sí |
| 6 | DEVOLUCIONES (3 variantes) | `registrarMovimiento` | Sí | Sí |
| 7 | RECLASIFICACIÓN | `reclasificarStock` | Sí | Sí |
| 8 | Aceptación de traspaso | `aceptarTransferencia` | Sí (`TRANSFERENCIA_ENTRADA_SUCURSAL`) | Sí |
| 9 | **Rechazo de traspaso** | `rechazarTransferencia` | **No** — solo `prisma.traspasoSucursal.update()`, confirmado leyendo el cuerpo completo de la función (`traspasos.ts:319-336`) | **No, estructuralmente** — ver §6.4 |
| 10 | Reingreso de traspaso | `confirmarReingresoTransferencia` | Sí (`REINGRESO_TRANSFERENCIA_SUCURSAL`) | Sí |

9 de 10 procesos quedan cubiertos por el mecanismo general. El proceso 9 necesita una solución distinta.

### 6.2 Por qué `rechazarTransferencia` no tiene `Operacion`

Es consistente con el resto del modelo: rechazar un envío en tránsito **no mueve stock** — el Kardex de ninguna sucursal cambia en ese momento (el stock ya salió del origen cuando se envió, y no vuelve a entrar hasta que origen confirma el reingreso, que sí es el proceso 10 y sí genera `Operacion`). `rechazarTransferencia` solo cambia el `estado` de `TraspasoSucursal` y guarda un motivo de texto — no hay ningún "movimiento" que registrar en el Kardex, así que nunca tuvo sentido que generara una fila en `Operacion` (que sí es, por diseño, el registro de "algo se movió").

### 6.3 Lo que ya está identificado en el documento madre y sigue vigente

El documento madre (§8, "Hallazgo nuevo") ya había detectado que `rechazarTransferencia` es check-then-act **sin transacción** — el mismo patrón de riesgo que el Hallazgo 2 de COMPRA, confirmado racy con una prueba real (`traspasos-en-transito.test.ts`, "rechazo simultáneo", 5/5 corridas). Esa parte del diagnóstico no cambia. Lo que este documento agrega es la razón estructural de por qué el mecanismo general (columna en `Operacion`) no alcanza para resolverlo.

### 6.4 Resolución propuesta para `rechazarTransferencia`

**No** ampliar el modelo de idempotencia a `TraspasoSucursal` (agregar `claveIdempotencia`/`payloadHash` ahí también) — sería duplicar el mecanismo en dos tablas para cubrir un solo caso, cuando el problema real de `rechazarTransferencia` no es "necesita deduplicar por clave de cliente", es "necesita ser atómico". La diferencia importa: un rechazo repetido del mismo traspaso no es un reintento de red típico (el cliente no reenvía un botón de "rechazar" con el mismo UUID) — es, en la práctica, una carrera entre DOS PERSONAS DISTINTAS en la misma sucursal de destino intentando resolver el mismo traspaso al mismo tiempo (el escenario que la prueba "rechazo simultáneo" reproduce). Lo que hace falta ahí no es idempotencia por clave, es la misma guarda de estado atómica que ya usan `aceptarTransferencia` y `confirmarReingresoTransferencia`:

```text
Cambio propuesto para rechazarTransferencia (NO autorizado a implementar
todavía, documentado acá para la próxima fase):

  mover el cuerpo de la función DENTRO de conTransaccionSerializable,
  mismo patrón que aceptarTransferencia — el chequeo
  `traspaso.estado !== "ENVIADA"` y el `update` pasan a ejecutarse
  atómicamente. Esto ya cierra el hallazgo de la prueba "rechazo
  simultáneo" sin necesitar ninguna columna nueva.

  Es un cambio de UNA función, aislado, que no depende del resto de la
  implementación de I3 — podría hacerse incluso como parte de un futuro
  paquete C (concurrencia) en vez de I3, si se prefiere separarlo. Se
  documenta acá porque el propio criterio de cierre de I3 (los 10
  procesos con protección) lo necesita para estar completo.
```

Esto significa que la matriz final de "los 10 procesos con protección completa" combina DOS mecanismos, no uno solo — y eso debe quedar explícito en la documentación de cierre para no repetir el error de contarlo como "resuelto por I3" sin aclarar que es una guarda de estado, no una clave de idempotencia:

| Mecanismo | Procesos que cubre |
|---|---|
| Clave de idempotencia en `Operacion` (I3, este documento) | 9 procesos (todos salvo rechazo de traspaso) |
| Guarda de estado atómica dentro de `conTransaccionSerializable` (ya existente en 2 de los 3 pasos de traspaso; falta extenderla al tercero) | Aceptación, Rechazo (pendiente), Reingreso |

---

## 7. Garantía de concurrencia con la misma clave

### 7.1 Caso base: dos requests simultáneos, misma clave, mismo payload

```text
Request A y Request B llegan casi al mismo tiempo con
claveIdempotencia = "uuid-123" (mismo formulario, doble click o
reintento de red del mismo intento de envío).

1. Ambos entran a conTransaccionSerializable (aislamiento SERIALIZABLE
   ya usado en todo el proyecto para este tipo de escritura).
2. Dentro de la transacción, cada uno primero busca si ya existe una
   Operacion con (sucursalId, proceso, claveIdempotencia) = esa clave.
3. Con aislamiento Serializable, Postgres garantiza que el resultado
   final es equivalente a que A y B hubieran corrido uno después del
   otro, nunca intercalados de una forma que produzca un resultado
   imposible en secuencial.
4. Caso típico: A y B se serializan de hecho — el que efectivamente
   commitea primero crea la fila en Operacion con esa clave (protegida
   además por el índice único @@unique([sucursalId, proceso,
   claveIdempotencia]), que es el árbitro final incluso si dos
   transacciones lograran pasar el chequeo de "no existe" al mismo
   tiempo bajo una implementación menos estricta). El segundo, al
   intentar escribir, choca con el índice único (P2002) o con un
   conflicto de serialización (P2034 / DriverAdapterError
   TransactionWriteConflict, ya reconocidos por
   esConflictoDeEscritura() desde el fix de C2).
5. conTransaccionSerializable ya reintenta automáticamente (hasta 5
   intentos) ante un conflicto de escritura. En el reintento, el
   request que perdió la carrera vuelve a hacer el paso 2 — esta vez
   SÍ encuentra la Operacion que el otro ya creó — y devuelve el
   resultado reconstruido/persistido de esa fila en vez de reintentar
   el insert.
6. Resultado: exactamente 1 Operacion nueva, exactamente 1
   MovimientoStock por línea, los DOS requests responden ok:true con
   el mismo mensaje — ninguno ve un error, ninguno duplica el efecto.
```

Esto es una extensión directa de la garantía que C2 ya estableció para COMPRA (el índice único es el árbitro final, `conTransaccionSerializable` absorbe la carrera vía reintento) — I3 generaliza el mismo patrón a los otros 9 procesos usando la clave de idempotencia como la columna que arbitra, en vez de `sucursalId+proveedorId+nroFactura` (que sigue existiendo, como constraint aparte, solo para COMPRA — ver §3, última regla del documento madre §8).

### 7.2 Caso: misma clave, requests simultáneos, payload DISTINTO

```text
Request A: claveIdempotencia = "uuid-123", payload = {cantidad: 10}
Request B: claveIdempotencia = "uuid-123", payload = {cantidad: 20}
(mismo UUID reutilizado indebidamente por el cliente — bug o replay)

1. El que gana la carrera (mismo mecanismo de §7.1) crea la Operacion
   con su payloadHash.
2. El que pierde, al reintentar, encuentra la Operacion existente —
   compara su propio payloadHash contra el guardado.
3. Si NO coincide → responde con el error de conflicto de idempotencia
   (§3), nunca ejecuta su payload. No importa cuál de los dos llegó
   "primero" en tiempo real ni cuál tiene el payload "correcto" — gana
   el que efectivamente commiteó primero, el otro siempre es rechazado
   como conflicto, sea cual sea el orden de llegada real.
```

No hay ninguna ventana en la que ambos payloads se procesen ni en la que se mezclen — la comparación de hash ocurre DESPUÉS de que la transacción ganadora ya commiteó, así que el perdedor siempre ve el estado final real, no una versión intermedia.

---

## 8. Diseño de schema (documento, no aplicado)

```prisma
model Operacion {
  // ... campos existentes sin cambios ...

  /// I3 — clave de idempotencia generada por el cliente
  /// (crypto.randomUUID() al abrir el formulario), reenviada tal cual
  /// en reintentos del mismo intento de envío. Nulleable durante el
  /// rollout gradual (§9.3): una Operacion sin clave simplemente no
  /// participa del mecanismo de deduplicación.
  claveIdempotencia String?

  /// I3 — hash SHA-256 del payload validado que efectivamente se
  /// procesó, para distinguir "mismo intento reenviado" de "clave
  /// reutilizada con datos distintos" (§3) sin comparar objetos JSON
  /// campo por campo.
  payloadHash String?

  /// I3 — Opción B (§4.5): mensaje de éxito ya formateado, persistido
  /// tal cual se lo devolvió al cliente la primera vez. Se relee sin
  /// reprocesar nada ante un duplicado — evita reconstruir lógica
  /// condicional de negocio (avisoConversion, liquidación de
  /// consignación) en un segundo lugar del código.
  resultadoMensaje String?

  @@unique([sucursalId, proceso, claveIdempotencia], name: "Operacion_idempotencia_key")
}
```

Sin cambios en `TraspasoSucursal` (§6.4 — `rechazarTransferencia` se resuelve con una guarda de estado atómica, no con estas columnas).

---

## 9. Migración segura, compatibilidad y rollback

### 9.1 Migración de las 3 columnas + índice general

Aditiva y de bajo riesgo: 3 columnas nulleables + 1 índice único parcial-por-construcción (NULL no colisiona). No requiere backfill — todas las `Operacion` existentes quedan con las 3 columnas en NULL, lo cual es válido y no participa del mecanismo hasta que el frontend empiece a mandar la clave.

### 9.2 Migración del índice de unicidad de factura — BLOQUEADA hasta la auditoría

```sql
CREATE UNIQUE INDEX CONCURRENTLY "Operacion_factura_unica_key"
  ON "Operacion" ("sucursalId", "proveedorId", "nroFactura")
  WHERE "nroFactura" IS NOT NULL AND proceso = 'COMPRA';
```

(`CONCURRENTLY` para no tomar un lock exclusivo sobre `Operacion` en producción durante la construcción del índice — tabla potencialmatícamente grande y de escritura frecuente.)

**No se puede aplicar esta migración sin antes correr el query 1 de §5.2 contra producción** — si devuelve filas, el `CREATE UNIQUE INDEX` falla directamente (Postgres no permite crear un índice único sobre datos que ya lo violan). Esto es una dependencia dura documentada, no una formalidad: el criterio de cierre de I3 (§11 más abajo) la incluye explícitamente.

### 9.3 Estrategia de compatibilidad temporal (rollout gradual)

```text
Fase 1 (este plan): migración aditiva, columnas nulleables. Cero
  cambio de comportamiento — nada rompe porque el código todavía no
  lee ni escribe estas columnas.

Fase 2: las 6 Server Actions (§1) aceptan un parámetro OPCIONAL
  claveIdempotencia?: string. Si viene, se activa el mecanismo
  completo (chequeo + guardado). Si NO viene (callers viejos, tests
  existentes, cualquier caller que todavía no se actualizó), el
  comportamiento es exactamente el actual — sin chequeo, sin
  deduplicación, Operacion se crea con claveIdempotencia = NULL. Esto
  significa que NINGÚN test ni caller existente se rompe en esta fase
  con solo agregar el parámetro opcional.

Fase 3: cada uno de los 10 puntos de entrada de frontend (formularios/
  modales) genera crypto.randomUUID() al montar/abrir, lo manda en el
  payload. Rollout uno por uno, verificable en cada commit — no
  requiere que los 10 se actualicen en el mismo cambio.

Fase 4 (posterior, fuera de este plan): una vez que TODO el frontend
  mande la clave, evaluar si conviene hacer la columna NOT NULL — no
  es necesario para que el mecanismo funcione (el índice único ya
  ignora NULL), así que esta fase es opcional y de limpieza, no un
  requisito de cierre de I3.
```

### 9.4 Rollback

```text
Rollback de código (Server Actions + frontend): revertir el commit
  correspondiente. Como el parámetro es opcional en cada fase, revertir
  el frontend sin revertir el backend dentro de la misma ventana es
  seguro (el backend simplemente vuelve a ver claveIdempotencia
  ausente); revertir el backend sin revertir el frontend NO es
  seguro del todo (el frontend seguiría mandando la clave a una
  Server Action que ya no la procesa) — si hace falta un rollback
  parcial, revertir frontend primero, o revertir ambos juntos.

Rollback de schema: down migration que elimina las 3 columnas + el
  índice general — sin pérdida de datos de negocio real (son columnas
  nuevas, ninguna tabla ni relación existente se toca). El índice de
  factura (§9.2), si ya se aplicó, se elimina aparte con su propio
  DROP INDEX — es independiente del resto.

Ningún rollback de este plan requiere restaurar un backup ni corre
  riesgo de pérdida de datos, porque todo el cambio de schema es
  puramente aditivo.
```

---

## 10. Pruebas de caracterización

### 10.1 Ya existentes (evidencia de la línea base, sin modificar)

- `test/auditoria/idempotencia-resto-de-procesos.test.ts` — reenvío secuencial sin protección en MERMA/PRODUCCIÓN/DEVOLUCION_PROVEEDOR/RECLASIFICACIÓN/VENTA.
- `test/auditoria/concurrencia-idempotencia.test.ts` — Escenario 2/3 (COMPRA racy, CONSUMO sin protección).
- `test/auditoria/traspasos-en-transito.test.ts` — "Aceptación duplicada" (protegida), "rechazo simultáneo" (racy, confirma §6.3).

### 10.2 Pendientes de escribir DESPUÉS de la implementación (no antes — dependen del schema nuevo)

Por cada uno de los 10 procesos:

1. Reintento secuencial, misma clave, mismo payload → 1 sola `Operacion`, ambas respuestas `ok:true` con el mismo `mensaje`.
2. Misma clave, payload distinto → la segunda respuesta es `ok:false` con el mensaje de conflicto, cero `Operacion`/`MovimientoStock` nuevos.
3. Concurrencia real (2 requests con `Promise.allSettled`, misma clave, mismo payload) → exactamente 1 efecto en Kardex, ambas respuestas coherentes entre sí (mismo patrón de prueba ya usado para C2).
4. Clave nueva → comportamiento actual sin cambios (1 ejecución, 1 efecto).

Y, específicos:

5. `rechazarTransferencia`: repetir la prueba "rechazo simultáneo" ya existente, ahora esperando que solo uno de los dos rechazos tenga efecto y el otro reciba un error de estado (no que ambos respondan `ok:true` pisando el motivo, como hoy).
6. Compatibilidad: los 56 archivos/337 tests existentes (línea base actual, post-R2) siguen pasando sin cambios, llamando a las Server Actions SIN el parámetro `claveIdempotencia` (Fase 2 de §9.3).
7. Factura duplicada (si la auditoría de §5 se completa y no hay bloqueo): intentar crear una `Operacion` de COMPRA que violaría el índice parcial → error de constraint atrapado y convertido en mensaje de negocio (mismo patrón que `crearConCodigoAutogenerado` ante P2002).

---

## 11. Checklist de autorización — criterios pedidos por el usuario

| Criterio pedido | Estado |
|---|---|
| Plan detallado | Este documento |
| Resultado de la auditoría de duplicados | **Incompleto** — sin acceso a producción, ver §5.1. Metodología lista (§5.2), clasificación lista (§5.3), falta la ejecución real. |
| Diseño de schema | §8 |
| Migración segura | §9.1-9.2 |
| Estrategia de rollback | §9.4 |
| Estrategia de compatibilidad temporal | §9.3 |
| Matriz de Server Actions afectadas | §1, §6.1 |
| Pruebas de caracterización | §10 |
| Decisión final sobre reconstrucción del resultado original | §4.5 — recomendación revisada a Opción B (persistir), pendiente de confirmación |

**El único criterio no satisfecho por esta sesión es la ejecución real de la auditoría de facturas duplicadas** (§5.1) — no es una limitación del plan, es una limitación de acceso a datos de este entorno. Todo lo demás está resuelto en este documento.

**Hallazgos de diseño nuevos que el plan de implementación deberá incorporar** (no estaban en el borrador original):
1. Son 6 Server Actions, no 8 (§1).
2. `rechazarTransferencia` no puede cubrirse con la columna de `Operacion` — necesita su propio fix de atomicidad, separable de I3 (§6.4).
3. La recomendación reconstruir-vs-persistir cambia a "persistir" tras verificar las 6 Server Actions reales (§4.5).

---

## 12. Estado

```text
Revisión general: CERRADA
N3: implementado
C2: implementado
R2: implementado
I3: autorizado para planificación y auditoría de datos
I3: planificación y auditoría de datos — COMPLETADA (este documento),
    con la salvedad de §5.1 (sin acceso a datos de producción)
I3: implementación todavía no autorizada
```
