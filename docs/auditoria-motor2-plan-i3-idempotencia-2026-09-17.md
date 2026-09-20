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
| `resultadoMensaje` | `String?` | El `mensaje` exacto que se devolvió la primera vez (Opción B, §4.5) — se relee tal cual ante un duplicado, sin reprocesar nada. |

*(Nota: en la primera versión de este documento, esta tabla decía "no hace falta una columna resultado/mensaje" apuntando a una decisión de reconstruir que todavía no estaba tomada en esa sección — quedó inconsistente con §4.5, que sí resuelve persistir. Corregido acá para que las tres columnas coincidan con el diseño final de §8.)*

No es una tabla nueva (`ClaveIdempotencia` separada) por la misma razón que ya usa el proyecto para el resto de este esquema: `Operacion` YA es el registro de "esto se ejecutó" — una tabla aparte duplicaría esa responsabilidad y sería una segunda fuente de verdad sobre qué operaciones existen, exactamente el patrón que esta auditoría viene señalando como riesgoso (ver Merma sin signo, v2.1.0). La columna vive en la fila que de todos modos ya se crea.

### 2.2 Índice de unicidad — CORREGIDO (revisión 2026-09-17, tras la evaluación del usuario)

```prisma
@@unique([claveIdempotencia], name: "Operacion_idempotencia_key")
```

**Corrección respecto a la versión anterior de este documento**: la primera versión proponía un índice compuesto `[sucursalId, proceso, claveIdempotencia]`, razonando que la clave sola "ya es única de por sí" y que el compuesto solo agregaba defensa en profundidad. El usuario señaló correctamente que la unicidad debe ser **global** — y es más que una preferencia de estilo: con el índice compuesto, la MISMA clave reenviada para un `proceso` distinto (por bug de cliente, por reutilizar un UUID viejo, etc.) no chocaría contra nada — el índice no la vería como duplicada porque `proceso` es distinto, y el mecanismo simplemente crearía una segunda `Operacion` con la misma clave sin ningún aviso. Eso es exactamente el hueco que la condición 9 del usuario pide cerrar ("confirmar que una misma clave no pueda reutilizarse entre procesos distintos") — y el índice compuesto no lo cerraba.

Con el índice global (`claveIdempotencia` sola), reenviar la misma clave para un proceso distinto SÍ choca contra el índice — y como el `proceso` (y el resto de los campos específicos de cada Server Action) forma parte del payload que se hashea (§9.5, `payloadHash` incluye `proceso` explícitamente), el `payloadHash` de ese segundo intento necesariamente difiere del guardado → se resuelve como **conflicto de idempotencia** (§3), nunca como duplicado silencioso ni como una segunda operación libre. Es una garantía estructural, no una convención que dependa de que el frontend "se porte bien".

Sigue siendo cierto que un índice único con una columna nulleable en Postgres **no bloquea múltiples NULL** (NULL no se compara igual a NULL) — las operaciones que todavía no manden clave (rollout gradual, §9.3) conviven sin conflicto con las que sí la mandan, exactamente igual que con el índice compuesto anterior.

### 2.3 Retención

Permanente — sin expiración, sin job de limpieza, sin TTL. Coincide con que `Operacion` ya es append-only y nunca se purga. Costo de storage: un UUID (16-36 bytes) + un hash (32 bytes) por operación, despreciable frente al resto de la fila.

---

## 3. Comportamiento ante duplicados

Regla ya cerrada en el documento madre (§8, "Reglas técnicas explícitas") — se repite acá porque es la base de todo el resto de este plan, sin cambios:

```text
clave nueva (no existe ninguna Operacion con esa claveIdempotencia,
  búsqueda global — §2.2, corregido)
  → ejecutar la operación una sola vez, guardar la clave, el hash y el
    resultadoMensaje junto con la Operacion recién creada.

misma clave + mismo payload (el payloadHash coincide con el guardado)
  → NO se vuelve a ejecutar nada. Se relee el resultadoMensaje ya
    persistido (Opción B, §4.5 — no se reconstruye nada) y se devuelve
    con ok:true — el cliente no puede distinguir un duplicado
    silencioso de una ejecución nueva exitosa (ese es el punto: un
    doble-submit no debe alarmar a quien hizo el segundo click, ya
    salió bien la primera vez).

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

### 5.1 Acceso obtenido y ejecución real (actualizado 2026-09-17)

La versión anterior de este documento marcaba este punto como bloqueado: la sesión solo tenía la base de test local (`motor2_test`, vaciada en cada corrida — `limpiarBaseDeTest()`), sin acceso a producción. Se le preguntó al usuario cuál de los proyectos Neon accesibles desde esta sesión (`DB-APP-PPMS`, `pdb-ppms`, `inventario-api`) correspondía a motor2 — confirmó **`inventario-api`** (`project_id: morning-field-10188884`).

**Verificación antes de auditar** (este entorno de sesión hospeda varios proyectos no relacionados — `dolibarr`, `frappe`, `grocy`, `motor` — así que no alcanzaba con el nombre del proyecto Neon): se listaron las tablas de `inventario-api` y coinciden exactamente con el schema de motor2 (`Operacion`, `MovimientoStock`, `TraspasoSucursal`, `Sucursal`, `Proveedor`, `Producto`, `_prisma_migrations`, etc.) — confirmado que es la base correcta antes de correr ninguna consulta.

**Hallazgo de las ramas del proyecto**: el proyecto tiene 3 branches — `main` (default/primary) está prácticamente vacía (1 `Sucursal`, 0 `Producto`, 2 `User`, 0 `Operacion` — una instancia sin uso real todavía); `demo-pizzeria-la-cuadra` (creada 2026-09-16, a partir de `main`) tiene **479 `Operacion`, 58 con `nroFactura`, 62 de proceso COMPRA** — es la única rama con datos operativos reales; y `respaldo-demo-pizzeria-la-cuadra-2026-09-16`, un backup de esa misma rama. La auditoría se corrió contra `demo-pizzeria-la-cuadra` (`branch_id: br-snowy-bar-afmlmxc7`), por ser la única con datos para auditar.

**Nota de transparencia — confirmado por el usuario (2026-09-18)**: ~~el nombre de la rama (`demo-pizzeria-la-cuadra`) sugiere que podría ser un ambiente de demo/piloto... o podría ser el único despliegue real que existe hoy~~. Es demo/piloto: un cliente real haciendo de tester a propósito, sabiéndolo — `main` es la que va a usar ese mismo cliente cuando el producto esté terminado. Los 479 `Operacion` de esta auditoría son datos de piloto consentido, no de producción definitiva.

Todas las consultas que siguen fueron **de solo lectura** (`SELECT`), sin ninguna escritura contra ninguna rama.

Resultado de la consulta base:

```sql
SELECT count(*) AS total_operaciones,
       count(*) FILTER (WHERE "nroFactura" IS NOT NULL) AS con_factura,
       count(*) FILTER (WHERE proceso = 'COMPRA') AS total_compras
FROM "Operacion";
-- 479 | 58 | 62 (rama demo-pizzeria-la-cuadra)
```

### 5.2 Query de auditoría — EJECUTADA contra `demo-pizzeria-la-cuadra` (2026-09-17)

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

### 5.3 Resultado de la auditoría (ejecutada, 2026-09-17)

| Categoría | Query | Resultado real | Acción |
|---|---|---|---|
| Duplicados exactos | Query 1 | **0 filas** — ningún grupo `sucursalId+proveedorId+nroFactura` con más de 1 `Operacion` de COMPRA, sobre 58 compras con número de factura | Sin acción — nada que fusionar ni decidir con el negocio |
| Números vacíos | Query 2 | **0 filas** — ningún `nroFactura` es string vacío o solo espacios | Sin acción — no hace falta normalizar nada antes de migrar |
| Espacios/diferencias de formato | Query 3 | **0 filas** — ningún par de números distintos normaliza al mismo valor dentro de la misma sucursal+proveedor | Sin acción |
| Proveedores/sucursales distintos con mismo número | Query 4 | **0 filas** — ningún `nroFactura` se repite entre proveedores o sucursales distintos | Sin acción — no hay ambigüedad que confirmar con el negocio |
| Facturas con payload diferente | Query 5 | No aplica — depende de que Query 1 devuelva grupos, y no devolvió ninguno | No aplica |
| Datos que impedirían el índice parcial | — | **Ninguno** | El `CREATE UNIQUE INDEX CONCURRENTLY` de §9.2 no encontraría ninguna violación sobre los datos actuales de esta rama |

**Conclusión de la auditoría**: sobre los 479 `Operacion` / 62 COMPRA / 58 con número de factura de la rama `demo-pizzeria-la-cuadra`, **no se encontró ningún conflicto en ninguna de las 6 categorías pedidas**. El bloqueo que impedía aplicar la migración del índice de unicidad de factura (§9.2) queda **levantado para esta rama** — es demo/piloto (confirmado por el usuario, §5.1), así que este resultado es válido para el piloto pero no reemplaza correr el mismo query contra `main` cuando esa sea el destino real del deploy.

Si en el futuro se crean más branches o el volumen de datos crece, este mismo query (§5.2) es el que hay que volver a correr antes de aplicar la migración — no es una verificación de una sola vez si la base sigue recibiendo COMPRAs entre ahora y el momento real del deploy.

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
   Operacion con claveIdempotencia = esa clave (búsqueda global, sin
   filtrar por sucursalId/proceso — §2.2, corregido).
3. Con aislamiento Serializable, Postgres garantiza que el resultado
   final es equivalente a que A y B hubieran corrido uno después del
   otro, nunca intercalados de una forma que produzca un resultado
   imposible en secuencial.
4. Caso típico: A y B se serializan de hecho — el que efectivamente
   commitea primero crea la fila en Operacion con esa clave (protegida
   además por el índice único global @@unique([claveIdempotencia]),
   que es el árbitro final incluso si dos
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
   resultadoMensaje ya persistido en esa fila en vez de reintentar
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
  /// participa del mecanismo de deduplicación. Validada en la capa de
  /// aplicación como UUID (§13.1) antes de llegar acá — nunca se
  /// guarda un string que no pase esa validación.
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

  @@unique([claveIdempotencia], name: "Operacion_idempotencia_key")
}
```

Sin cambios en `TraspasoSucursal` (§6.4 — `rechazarTransferencia` se resuelve con una guarda de estado atómica, no con estas columnas).

---

## 9. Migración segura, compatibilidad y rollback

### 9.1 Migración de las 3 columnas + índice general

Aditiva y de bajo riesgo: 3 columnas nulleables + 1 índice único parcial-por-construcción (NULL no colisiona). No requiere backfill — todas las `Operacion` existentes quedan con las 3 columnas en NULL, lo cual es válido y no participa del mecanismo hasta que el frontend empiece a mandar la clave.

### 9.2 Migración del índice de unicidad de factura — desbloqueada para los datos auditados (§5.3)

```sql
CREATE UNIQUE INDEX CONCURRENTLY "Operacion_factura_unica_key"
  ON "Operacion" ("sucursalId", "proveedorId", "nroFactura")
  WHERE "nroFactura" IS NOT NULL AND proceso = 'COMPRA';
```

(`CONCURRENTLY` para no tomar un lock exclusivo sobre `Operacion` en producción durante la construcción del índice — tabla potencialmatícamente grande y de escritura frecuente.)

**Actualización 2026-09-17**: el query 1 de §5.2 ya se corrió (§5.3) contra la única rama con datos reales del proyecto Neon confirmado por el usuario (`inventario-api`, rama `demo-pizzeria-la-cuadra`) — 0 filas, ningún duplicado. Sobre esos datos, este `CREATE UNIQUE INDEX` no fallaría. Queda como condición para el deploy real, no ya como bloqueo de este plan: correr el mismo query 1 una vez más inmediatamente antes de aplicar la migración en el entorno real de destino (si son datos nuevos entre ahora y ese momento, o si la rama auditada no es la que finalmente se usa — ver la salvedad de §5.1 sobre qué es exactamente esa rama), para no asumir que un resultado de hoy sigue vigente sin volver a verificarlo.

**Actualización 2026-09-20 (Plan 4 del backlog de auditoría) — implementado en el repo, pendiente de aplicar en Neon:**

- El índice quedó en `prisma/migrations/20260920220000_factura_unica_compra/migration.sql`, con `IF NOT EXISTS` agregado (idempotente) y **sin** predicado de anulación: se confirmó que `anuladaEn` (agregado por `20260916185129_anular_venta`, después de este documento) es exclusivamente de VENTA — ninguna Operacion de COMPRA puede tenerlo distinto de null hoy, así que no hace falta excluir nada. Si K1b/K1c (anular una compra) se decide en el futuro, este índice deberá recrearse con ese predicado.
- Aplicado y verificado en `motor2_dev` (local): `CREATE INDEX CONCURRENTLY` funcionó dentro de `prisma migrate deploy` sin problemas, siempre que el archivo tenga UNA sola sentencia (Postgres no permite `CONCURRENTLY` dentro de una transacción, y Prisma envuelve en una si hay más de una sentencia). Un primer intento falló porque la base tenía datos residuales de un test que corrió la carrera sin protección (duplicado real, `23505`) — limpiados antes de reintentar; documentado como parte del runbook, no un problema del índice en sí.
- **Forma real del error P2002 confirmada empíricamente** (no coincide con lo asumido originalmente en §11): con `@prisma/adapter-pg` (Prisma 7), la violación llega como `PrismaClientKnownRequestError` con `code: "P2002"` y el nombre del índice en `meta.driverAdapterError.cause.constraint.index` — **no** en `meta.target` (que viene vacío para este caso). El helper `src/core/movimientos/factura-unica.ts` (`esChoqueDeFacturaUnica`) revisa las dos formas.
- Código: `registrarMovimiento` (`src/server/actions/movimientos/movimientos.ts`) ahora envuelve `conTransaccionSerializable(...)` con un `.catch` que reconoce específicamente ese choque y devuelve el mismo mensaje de negocio que el chequeo secuencial (`MENSAJE_FACTURA_DUPLICADA`) — nunca un P2002 crudo ni un 500.
- Test de regresión: `test/auditoria/factura-unica-concurrencia.test.ts` (10 iteraciones, `Promise.allSettled`, sin clave de idempotencia — demostrado en rojo antes del índice, rojo distinto con el índice pero sin el catch, verde con los dos). Se endureció además `test/auditoria/concurrencia-idempotencia.test.ts` ("Escenario 2"), que documentaba la carrera como hallazgo sin afirmar nada (`toBeGreaterThanOrEqual(1)`) — ahora es una regresión real (`toBe(1)`, ninguna promesa rechaza).
- **Pendiente, fuera del alcance de esta sesión (bloqueo de red, no de decisión)**: aplicar la misma migración contra el proyecto Neon real. Esta sesión no tiene salida de red hacia `neon.tech` (confirmado con dos intentos: conexión Postgres directa se cuelga sin respuesta, la API HTTP de Neon devuelve 403 "Host not in allowlist" — política de egress del sandbox, no un problema de credenciales). El usuario corre los comandos exactos a mano: re-auditar duplicados (query 1 de §5.2, contra la rama de destino real) y, si da 0 filas, `npx prisma migrate deploy` con `DATABASE_URL`/`DIRECT_URL` apuntando a Neon. Ver `docs/pendientes-responsable-2026-09-20.md` §3 para el runbook completo.

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

## 11. Precisiones contractuales previas a la implementación

Resuelve, una por una, las 10 condiciones que el usuario pidió dejar explícitas antes de autorizar. Sigue siendo fase de planificación — nada de lo que sigue toca código, schema ni migraciones.

### 11.1 Formato y longitud máxima de `claveIdempotencia`

- Formato esperado: UUID (`crypto.randomUUID()` del lado del cliente, que genera v4 — pero la validación de servidor acepta cualquier UUID bien formado, sin atarse a la versión exacta, para no ser frágil si algún cliente futuro usa otra fuente).
- Validación de servidor (capa de aplicación, mismo criterio que el resto de los inputs del proyecto — Zod): regex de UUID estándar (`/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i`) aplicada ANTES de que el valor llegue a la transacción. Un valor que no matchea se rechaza con un error de validación (mismo tipo de respuesta que cualquier otro campo inválido hoy) — nunca se guarda un string arbitrario.
- Longitud de columna: sin `@db.VarChar` fijo (Prisma `String` sin anotación mapea a `TEXT`, sin límite duro) — el límite real lo impone la validación de formato (36 caracteres exactos para un UUID), no un límite de columna. No hace falta una cota de columna aparte porque nada que no sea un UUID válido llega a escribirse.

### 11.2 Cómo se calcula `payloadHash`

- Algoritmo: SHA-256 vía `node:crypto` (ya disponible, sin dependencia nueva).
- Entrada al hash: el payload **ya validado** (la salida del parser de Zod, no el body crudo que mandó el cliente) — así que espacios sobrantes, orden de claves del JSON entrante o tipos coeccionados (`"10"` vs `10`) no cambian el hash, porque para ese momento ya pasaron por el mismo parser que determina el comportamiento real de la Server Action.
- Normalización: las claves del objeto se serializan en orden alfabético recursivo (una función `canonicalizeJson` chica, sin librería nueva) antes de hashear, porque JavaScript no garantiza orden estable entre distintos clientes/versiones de payload.
- Se incluye `ctx.sucursalId` en el objeto hasheado (además de los campos de negocio del payload) — así, si la misma clave llegara desde una sucursal distinta (por bug o por un usuario con más de una membresía), el hash no coincide y se resuelve como conflicto, no como duplicado legítimo.
- Se incluye un identificador explícito del proceso/Server Action (ej. `datos.proceso` para `registrarMovimiento`, o un literal fijo como `"VENTA"`/`"RECLASIFICACION"`/`"ACEPTAR_TRASPASO"`/`"REINGRESO_TRASPASO"` para las que no tienen un campo `proceso` propio en el payload) — así la garantía de §11.8 (misma clave entre procesos distintos siempre da conflicto) es una regla explícita y deliberada del hash, no una coincidencia de que los payloads de cada Server Action tengan forma distinta.
- NO se incluye `ctx.usuarioId` — la política define "mismo intento de request", no "mismo usuario"; dos personas con sesión en la misma sucursal reenviando el mismo formulario (ej. tras un refresh que preserva la clave) deben seguir tratándose como el mismo intento. Esto es una precisión de diseño nueva, no estaba en la política original — queda marcada para confirmación explícita del usuario junto con el resto de este punto.
- Fechas: se hashea el valor ya parseado a `Date`/ISO string, no el string crudo del formulario.

### 11.3 Clave existente con `payloadHash` nulo

Bajo el diseño correcto, `claveIdempotencia` y `payloadHash` se escriben **siempre juntos**, en el mismo insert que crea la `Operacion` — nunca uno sin el otro. Dos casos posibles:

```text
Fila con claveIdempotencia = NULL (todas las Operacion anteriores a
  I3, o posteriores mientras el frontend de ese formulario puntual
  todavía no mande clave — rollout gradual, §9.3):
  → no participa del mecanismo. El chequeo busca por claveIdempotencia
    exacta; una fila con NULL nunca puede matchear una clave real que
    manda un cliente (NULL no es igual a ningún valor).

Fila con claveIdempotencia NO NULL pero payloadHash NULL:
  → NO debería poder existir bajo el flujo normal (se escriben juntos).
    Si se encontrara este estado (bug, migración de datos futura, etc.),
    la regla es "fail closed": tratarla SIEMPRE como conflicto (nunca
    como "mismo payload" por default inseguro), porque no hay forma de
    verificar la igualdad. Además, es un estado que ameritaría alerta/
    log, porque indica una inconsistencia que el código no debería
    poder producir.
```

### 11.4 ¿Alcanza `resultadoMensaje` o hace falta una respuesta estructurada?

Verificado contra el contrato real: `ResultadoAccion = { ok: true; mensaje: string } | { ok: false; mensaje: string }` (`src/server/actions/tipos.ts`) es el tipo de retorno de las 6 Server Actions de la política I3 (confirmado por lectura de código — ninguna de las 10 en alcance devuelve `ResultadoConId`; ese tipo solo lo usan `crearSolicitudTransferencia`/`crearEnvioDirectoTransferencia`, que NO forman parte de los 10 procesos de la política). Por lo tanto, **una sola columna de texto (`resultadoMensaje`) es contractualmente suficiente** para reconstruir `{ ok: true, mensaje: resultadoMensaje }` completo ante un duplicado, para el alcance actual de I3 — no hace falta una columna JSON ni una tabla de resultados estructurados.

Nota de alcance, no una decisión pendiente hoy: si en el futuro se agrega a la política algún proceso que devuelva `ResultadoConId` (con `id`/`nombre`), el modelo necesitaría ampliarse en ese momento (columnas nuevas o una estructura JSON) — queda fuera del alcance de esta implementación de I3, documentado para no sorprender a quien lo retome.

### 11.5 Matriz exacta — Server Action → procesos → clave → resultado

| Server Action | Procesos que cubre (vía `datos.proceso`) | Dónde se lee/escribe la clave | Resultado persistido |
|---|---|---|---|
| `registrarMovimiento` | COMPRA, CONSUMO, MERMA, PRODUCCIÓN, DEVOLUCION_PROVEEDOR, DEVOLUCION_CONSIGNACION, DEVOLUCION_CLIENTE (7 procesos, 1 función) | Dentro de `conTransaccionSerializable`, antes de escribir las líneas de `MovimientoStock` | `Operacion.resultadoMensaje` = `` `Se guardaron ${filas.length} movimiento(s).${avisoConversion}` `` completo, ya resuelto |
| `registrarVenta` | VENTA | Dentro de `conTransaccionSerializable`, antes de escribir las líneas de venta | `Operacion.resultadoMensaje` = `` `Se registraron ${ventas.length} venta(s) correctamente.` `` |
| `reclasificarStock` | RECLASIFICACIÓN | Dentro de `conTransaccionSerializable`, antes de repartir el saldo disponible | `Operacion.resultadoMensaje` = mensaje completo, incluyendo el `disponible` calculado en ESE momento (§4.4 — valor que no sobrevive en el estado final, por eso debe persistirse, no recalcularse) |
| `aceptarTransferencia` | Aceptación de traspaso | Dentro de `conTransaccionSerializable`, antes de escribir `TRANSFERENCIA_ENTRADA_SUCURSAL` | `Operacion.resultadoMensaje` = `` `Recibido de "${origen.nombre}".` `` |
| `confirmarReingresoTransferencia` | Reingreso de traspaso | Dentro de `conTransaccionSerializable`, antes de escribir `REINGRESO_TRANSFERENCIA_SUCURSAL` | `Operacion.resultadoMensaje` = mensaje completo con `cantidad`/nombres ya resueltos |
| `rechazarTransferencia` | Rechazo de traspaso | **No aplica** — no crea `Operacion` (§6.2). Se cubre con guarda de estado atómica dentro de `conTransaccionSerializable`, no con `claveIdempotencia`/`payloadHash`/`resultadoMensaje` | No aplica — el "resultado" ante una carrera es un error de estado explícito para el que pierde, no un duplicado silencioso (mismo comportamiento que ya tienen `aceptarTransferencia`/`confirmarReingresoTransferencia` hoy ante un estado inválido) |

Esta tabla es la versión consolidada de §1 (qué Server Action cubre qué proceso) y §6.1 (qué mecanismo aplica a cada una) — evita que la implementación futura agregue el chequeo de idempotencia más de una vez dentro de `registrarMovimiento` (una sola vez alcanza para los 7 procesos que comparte, porque el chequeo va antes de la rama por `proceso`).

### 11.6 Rollback y compatibilidad temporal

Ya resueltos en §9.3 (compatibilidad — rollout en 4 fases, parámetro opcional, ningún caller existente se rompe) y §9.4 (rollback de código y de schema, ambos sin pérdida de datos por ser aditivos). Se confirma acá que ambos puntos están completos y no requieren contenido adicional — solo se referencian para que este checklist quede autocontenido.

### 11.7 Prueba de la carrera de `rechazarTransferencia`

Ya estaba listada como prueba pendiente #5 en §10.2. Se precisa acá el criterio de aceptación exacto, para que quede accionable al implementar:

```text
Dado: un traspaso en estado ENVIADA.
Cuando: dos llamadas concurrentes a rechazarTransferencia(id, motivoA)
  y rechazarTransferencia(id, motivoB) (Promise.allSettled, mismo
  patrón que "rechazo simultáneo" ya existente).
Entonces:
  - Exactamente UNA de las dos responde ok:true.
  - La otra responde ok:false con un mensaje de estado explícito
    (ej. `Este traspaso está en estado "RECHAZADA_DESTINO" — no se
    puede rechazar desde acá.` — el mismo mensaje que ya usa el guard
    de estado para cualquier otra transición inválida).
  - El traspaso queda con estado RECHAZADA_DESTINO y motivoRechazoDestino
    = el motivo de la llamada que ganó — nunca se pisa entre las dos
    (el defecto actual, confirmado 5/5 corridas).
  - No se ejecuta ninguna escritura de Kardex (correcto en ambos casos
    — rechazar nunca toca stock, §6.2).
```

### 11.8 Reutilización de la misma clave entre procesos distintos

Resuelto en §2.2 (corrección aplicada tras la evaluación del usuario): el índice pasa a ser `@@unique([claveIdempotencia])`, global, no compuesto con `sucursalId`/`proceso`. Combinado con que `payloadHash` incluye un identificador explícito del proceso/Server Action (§11.2, agregado deliberadamente al objeto hasheado, no dejado como coincidencia de forma del payload), cualquier reutilización de la misma clave para un proceso distinto produce un `payloadHash` distinto → se resuelve siempre como conflicto de idempotencia, nunca como duplicado silencioso ni como una segunda `Operacion` libre. Es una garantía estructural del índice + hash, no una convención de frontend.

### 11.9 Errores definitivos y transacciones interrumpidas

```text
Regla: claveIdempotencia + payloadHash + resultadoMensaje se escriben
  ÚNICAMENTE junto con una Operacion que efectivamente se commitea. No
  existe un estado intermedio "a medias" — Postgres garantiza que una
  transacción se commitea completa o no se commitea nada (la misma
  atomicidad de la que ya depende todo conTransaccionSerializable hoy).

Caso 1 — rechazo de validación de negocio (ej. "no hay stock
  suficiente"): ocurre ANTES de entrar a la transacción de escritura
  (o dentro de ella, pero aborta sin llegar al insert) → responde
  ok:false, NO se crea Operacion, NO se guarda ninguna clave. Un
  reintento posterior con la MISMA clave no encuentra nada guardado —
  corre de nuevo desde cero (nueva validación, mismo resultado si nada
  cambió, o éxito si la condición que lo bloqueaba ya no aplica). Esto
  es seguro: una validación fallida nunca tuvo un efecto que duplicar.

Caso 2 — conflicto de escritura que agota los 5 reintentos de
  conTransaccionSerializable (carga muy alta, caso extremo): termina
  lanzando el error tal cual (comportamiento ya existente, sin cambios
  de I3) — tampoco deja ninguna fila a medias, mismo razonamiento que
  el Caso 1.

Caso 3 — error de infraestructura (conexión caída a mitad de
  transacción): Postgres hace rollback automático de toda la
  transacción — de nuevo, no puede quedar una Operacion parcial con
  clave pero sin el resto de sus filas de MovimientoStock, ni con
  clave pero sin resultadoMensaje.

Conclusión: bajo la política I3, NINGÚN resultado "fallido" se
  persiste ni se cachea contra la clave — solo los éxitos committeados
  quedan disponibles para deduplicar. Un reintento tras cualquier error
  definitivo es indistinguible de un primer intento nuevo: usa la misma
  clave, pero como no hay fila previa que la use, se ejecuta de cero.
  No contradice la política ("mismo payload → mismo resultado"): un
  resultado que nunca se persistió no tiene nada que reproducir.
```

---

## 12. Checklist de autorización — criterios pedidos por el usuario

| Criterio pedido | Estado |
|---|---|
| Plan detallado | Este documento |
| Resultado de la auditoría de duplicados | **Ejecutada** (§5.1/§5.3) — 0 conflictos en las 6 categorías, sobre la rama `demo-pizzeria-la-cuadra` del proyecto Neon `inventario-api` (confirmado por el usuario como motor2). Esa rama es demo/piloto — confirmado por el usuario (§5.1) — no producción definitiva; `main` es la que se usará cuando el producto esté terminado, con el mismo cliente. |
| Diseño de schema | §8 |
| Migración segura | §9.1-9.2 |
| Estrategia de rollback | §9.4 |
| Estrategia de compatibilidad temporal | §9.3 |
| Matriz de Server Actions afectadas | §1, §6.1, §11.5 (versión consolidada) |
| Pruebas de caracterización | §10, precisadas en §11.7 (rechazo de traspaso) |
| Decisión final sobre reconstrucción del resultado original | §4.5 — recomendación revisada a Opción B (persistir), confirmada suficiente en §11.4; pendiente de aprobación formal del usuario |
| Formato/longitud de `claveIdempotencia` | §11.1 |
| Cálculo de `payloadHash` (normalización, orden de campos) | §11.2 |
| Clave existente con `payloadHash` nulo | §11.3 |
| Unicidad global entre procesos distintos | §2.2 (corregido), §11.8 |
| Comportamiento ante errores definitivos / transacciones interrumpidas | §11.9 |

**Actualización 2026-09-17**: los 9 criterios están resueltos. El usuario confirmó que el proyecto Neon `inventario-api` es motor2; se verificó el schema antes de auditar (coincide exactamente); se encontró que la única rama con datos reales es `demo-pizzeria-la-cuadra` (`main` está vacía); se corrieron los 4 queries aplicables de §5.2 (de solo lectura) contra esa rama — **0 conflictos en las 6 categorías pedidas** (§5.3). El bloqueo de la migración del índice de factura (§9.2) queda levantado para esos datos.

**Único punto que sigue necesitando confirmación del usuario, no de esta sesión**: ~~si `demo-pizzeria-la-cuadra` representa el ambiente de producción real o es un ambiente demo/piloto (§5.1)~~ — **confirmado por el usuario (2026-09-18)**: es demo/piloto, con un cliente real (el mismo que va a usar `main` cuando el producto esté terminado) haciendo de tester a propósito, sabiéndolo. `main` queda reservada para cuando el producto esté finalizado, con el mismo cliente. Con esto, la auditoría de §5 es válida como lo que es (datos reales de un piloto consentido, no de producción definitiva) — sigue valiendo la recomendación de volver a correr el query 1 inmediatamente antes de aplicar la migración contra `main` el día que ese sea el destino real, por si se cargaron más compras en el piloto entretanto.

**Hallazgos de diseño nuevos que el plan de implementación deberá incorporar** (no estaban en el borrador original):
1. Son 6 Server Actions, no 8 (§1).
2. `rechazarTransferencia` no puede cubrirse con la columna de `Operacion` — necesita su propio fix de atomicidad, separable de I3 (§6.4).
3. La recomendación reconstruir-vs-persistir cambia a "persistir" tras verificar las 6 Server Actions reales (§4.5).
4. El índice de unicidad pasa a ser global (`claveIdempotencia` sola), no compuesto con `sucursalId`/`proceso` — corrección aplicada tras la evaluación del usuario (§2.2, §11.8).
5. `payloadHash` debe incluir un identificador explícito de proceso/Server Action, no solo los campos de negocio (§11.2) — necesario para que la garantía del punto 4 sea estructural.
6. La auditoría de facturas duplicadas (§5) ya se ejecutó contra datos reales — 0 conflictos — sobre `demo-pizzeria-la-cuadra`, confirmado demo/piloto (§5.1), no producción definitiva.

---

## 13. Estado

```text
Revisión general: CERRADA
N3: implementado
C2: implementado
R2: implementado
I3: autorizado para planificación y auditoría de datos
I3: planificación — COMPLETADA (este documento, incluidas las 10
    precisiones contractuales de la revisión del usuario, §11)
I3: auditoría de facturas duplicadas — EJECUTADA (§5) contra datos
    reales (rama demo-pizzeria-la-cuadra, proyecto Neon inventario-api,
    confirmado por el usuario como demo/piloto) — 0 conflictos en las 6
    categorías
I3: implementación — AUTORIZADA ("autorizo implementar I3 en el código
    sin aplicar datos reales") e IMPLEMENTADA (2026-09-17) — ver el
    documento madre §13 para el detalle completo (schema, mecanismo
    común, 6 Server Actions, rechazarTransferencia, frontend, 14
    pruebas nuevas).
I3: migración en demo Neon — AUTORIZADA ("Sí, aplicar y probar en demo
    Neon", luego "Poner al día las 4" al encontrar 3 migraciones previas
    pendientes) y APLICADA (2026-09-17) contra demo-pizzeria-la-cuadra —
    ver el documento madre §14. 4/5 pruebas de humo verificadas a nivel
    SQL; la de concurrencia real queda pendiente por falta de
    conectividad de red a Neon desde esta sesión.
```
