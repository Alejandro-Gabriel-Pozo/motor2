# ADR-031: Centros de costos (unidades de negocio) y distribución de un gasto por versiones

> Redactado el 2026-10-13 (Paquete 5, M7). **Estado: el MODELO está escrito en el repositorio (cuatro migraciones aditivas con su `down.sql` y sus pruebas, más el módulo `centros_de_costos` «en desarrollo»); NINGÚN caso de uso las escribe todavía (Etapa C) y NO están aplicadas a ninguna base real** (cada una REQUIERE AUTORIZACIÓN EXPRESA, base por base). No se toca el ADR-029: esto es otra decisión (una dimensión nueva, con módulo propio, aplicabilidad por sucursal y alcance heredado). El 030 es de otra tarea.

## Contexto

Una sucursal soporta gastos (`ImputacionDeGasto`, ADR-029 §10) pero el dueño necesita ver cuánto le costó cada **unidad de negocio** de esa sucursal (por ejemplo, el hotel y el restaurante de una hostería). La jerarquía que describió es «Central → sucursal → unidad de negocio de cada sucursal»: lo que se reparte entre unidades es la parte de UNA sucursal, no el gasto entero de la empresa. Los nombres de las unidades no se fijan en código: son un dato que carga cada empresa (la decisión del 2026-10-08, #4).

M4 dejó reservado el ancla: `ImputacionDeGasto (empresaId, id)` es el destino de una clave foránea compuesta pensada para esto. M7 es **solo el modelo de datos** (migraciones, esquema, guardianes y pruebas); los casos de uso, las pantallas y los reportes son la Etapa C.

## Decisión

### Las cinco tablas y su alcance

| Tabla | Alcance por sucursal | Qué es |
|---|---|---|
| `PlanDeCostos` | `DE_EMPRESA` | Una dimensión de análisis de la empresa (por ejemplo «unidades de negocio»). Código fijo, nombre único sin importar mayúsculas, `activo`. |
| `CentroDeCostos` | `DE_EMPRESA` | Un centro de un plan. El mismo código vale en todas las sucursales (sin `sucursalId`). |
| `PlanDeCostosSucursal` | `PROPIA` | En qué sucursales **aplica** un plan (`aplica`, un interruptor). |
| `DistribucionCostoVersion` | `HEREDADA` de `ImputacionDeGasto` por `imputacionDeGastoId` | Una versión de la distribución de una imputación entre los centros de UN plan. |
| `DistribucionCostoLinea` | `HEREDADA` de `DistribucionCostoVersion` por `distribucionCostoVersionId` | Lo que le toca a un centro dentro de una versión. |

El plan y el centro son del catálogo de la empresa: se ven desde cualquier sucursal. La aplicabilidad, la versión y la línea llevan las cuatro políticas de sucursal (migración M7.3, 12 políticas, salida exacta del generador de `test/setup/politicas-de-alcance-de-sucursal.ts`): quien ve una sola sucursal ve solo las distribuciones de los gastos de esa sucursal. La versión NO puede ser `DE_EMPRESA` porque apunta a una tabla `PROPIA`; y la concurrencia anda igual con el alcance heredado porque todas las versiones de una imputación son de una sola sucursal: quien puede escribir una versión ve todas las anteriores, calcula `numero` = máximo + 1 con la misma vista y el único `(imputación, plan, numero)` elige una sola ganadora.

### Por qué el ancla es la imputación y no el renglón ni una columna

1. M4 lo reservó así (el índice `(empresaId, id)` de la imputación existe para esto).
2. Lo que se reparte entre unidades es la parte de una sucursal: es la imputación, no el renglón de la factura (que es de la empresa).
3. Un «centro» como columna del renglón o de la imputación sería el dato a reinterpretar cuando aparezca un segundo plan («una columna por plan», el patrón que se descartó: Odoo guarda una columna por plan). Con una tabla de versiones por (imputación, plan) un plan nuevo es un plan nuevo, no una migración.
4. La mercadería queda fuera por construcción: solo existen imputaciones de renglones `SIN_STOCK` (la clave foránea con discriminador de M4.3). El costo de la mercadería sigue al stock por sucursal.

### La versión vigente y los tres estados

Cada (imputación, plan) tiene versiones 1, 2, 3...; la **vigente es siempre la de `numero` mayor**: derivada con `SELECT DISTINCT ON ("imputacionDeGastoId","planDeCostosId") ... ORDER BY ..., "numero" DESC`, nunca un flag ni un UPDATE. Corregir es agregar una versión nueva, con `motivo` (obligatorio desde la 2, opcional en la 1; CHECK). Los estados de un gasto frente a un plan son tres:

- **sin asignar**: el plan aplica en la sucursal y no hay ninguna versión;
- **vigente**: hay versiones y rige la de número mayor;
- **no aplica**: el plan no tiene fila en la sucursal o la tiene con `aplica = false` (ADR-009, familia `optin`; lo decide un único embudo, `src/core/compras/aplicabilidad-de-plan-de-costos.ts`, que por ahora ningún código de producción llama).

La versión rige desde `creadoEn` (UTC) y vale para el período del gasto (`FacturaProveedor.fecha`): como en M5, no hay `rigeDesde`. Pueden quedar huecos en `numero` solo si alguien escribe por SQL; la regla del máximo los tolera.

### Qué decide la base y qué decide la Etapa C

**La base decide** (restricciones declaradas, probadas contra Postgres real): formato y unicidad de código y nombre (dos altas simultáneas dejan una sola); una aplicabilidad por (plan, sucursal); una versión por (imputación, plan, número); la clave de idempotencia única global (ADR-028); que el centro y la versión son del mismo plan (claves foráneas compuestas de tres columnas, aun escribiendo como dueño); puntos básicos enteros de 1 a 10000; importes e IVA computable con sus CHECK (el computable entre 0 y el importe); que no se borre una imputación, un plan, un centro ni un usuario referenciados; que solo se agregue (la app tiene SELECT e INSERT en la versión y la línea; UPDATE por columna solo de `nombre`, `activo` y `aplica`); y la atomicidad de la cabecera con sus líneas (la misma transacción).

**La Etapa C decide**, porque cruza filas y la regla de este proyecto es no usar disparadores (precedente ADR-029 §10): Σ `porcentajeBp` = 10000; Σ importes y Σ IVA computable = los de la imputación, repartiendo en dos pasos con `repartirImporte` (`src/core/moneda.ts`) y los centros ordenados por id; que el plan aplique en la sucursal y que el plan y el centro estén activos; que la factura no esté anulada; `numero` = vigente + 1; rechazar el cambio de `aplica` si la sucursal ya tiene gastos con ese plan (para que nada pasado cambie de «sin asignar» a «no aplica»); y la auditoría. Como la base no lo impide, hay una **consulta de coherencia** (tres consultas que deben dar cero filas, en `docs/deploy-con-migraciones.md`) y una prueba (`test/persistencia/distribucion-de-costos-dinero.test.ts`) que demuestra que una versión que suma 9999 puntos básicos o 0,01 de más ENTRA y que la consulta la encuentra.

### Jerarquía de centros

En la versión 1 un centro no tiene padre: `centroPadreId` es siempre NULL (CHECK `CentroDeCostos_sin_padre_chk`), como pidió el dueño («vacía en la versión 1»). La clave foránea de tres columnas `(empresaId, planDeCostosId, centroPadreId)` ya obliga a que, cuando se habiliten los sub-centros, el padre sea del mismo plan. La migración que los habilite reemplazará ese CHECK por la **regla de nivel**: `nivel` y `nivelPadre` con CHECK `nivel = nivelPadre + 1` (o 0 sin padre) y una clave foránea de cuatro columnas hacia el único `(empresaId, planDeCostosId, id, nivel)`. Con esa regla un ciclo es imposible incluso con un INSERT de varias filas o con SQL del dueño; hacerlo solo en el caso de uso dejaría ese hueco (las claves foráneas se verifican al final de la sentencia). Queda escrito y NO implementado; su costo es dos columnas, un único, un CHECK y adaptar la lista de claves foráneas con discriminador de `test/persistencia/multiempresa-estructura.test.ts` para que cada entrada declare su cantidad de columnas.

### Dinero (Decisión 1 del dueño) y aplicabilidad (Decisión 2)

- **Cada línea guarda su `importe` y su `importeIvaComputable`** (DECIMAL(14,2), con IVA incluido), repartidos una sola vez al distribuir, en dos pasos: primero el importe con los puntos básicos como pesos; después el IVA computable con pesos iguales a esos importes en centavos. Así ningún computable pasa de su importe y las dos sumas dan exacto; un número escrito no cambia aunque cambie el algoritmo. Un centro con puntos básicos mayores que 0 puede quedar en 0,00 por el redondeo: la base lo acepta. Es lo mismo que el dueño eligió para la imputación (D3 de M4) y lo que pide el plan de distribución de costos. M7 no cambia ninguna columna de dinero existente.
- **Que un plan aplique en una sucursal es un interruptor** (`aplica`, UPDATE por columna), no una historia con fecha «desde». El costo de esa elección está en la Etapa C: tiene que rechazar el cambio (mostrando el conteo) si la sucursal ya tiene gastos con ese plan. La alternativa, una tabla versionada de aplicabilidad, queda descartada por ahora.

### Permisos ocultos hasta la Etapa C

Tres claves nacen en la base (migración de datos M7.4) y NO están en `ACCIONES`: `centros_costos` (empresa), `distribucion_costos` y `reporte_gastos_por_unidad` (sucursal), las tres con piso administrador y semilla `admin`. Como las siete de los gastos (ADR-029 §10), el módulo `centros_de_costos` está «en desarrollo» (requiere `gastos`) y la regla de `acciones-con-modulo` prohíbe acciones de un módulo en desarrollo. El módulo no necesita migración: es código. Cada clave reservada declara ahora la migración que la siembra (`test/setup/claves-reservadas-en-base.ts`). A diferencia de la reversa de M4.5, la de M7.4 **aborta** si la configuración ya no es la semilla pura.

### Bloqueo de la reversa de M4.3

Con M7 arriba, `down.sql` de M4.3 (que borra `ImputacionDeGasto`) **falla** con 2BP01: la clave foránea y las políticas de la versión dependen de esa tabla. Es lo que se quiere, y falla entero, sin dejar nada a medias. El orden de la reversa es **M7.4, M7.3, M7.2, M7.1** y recién después M5 y las de M4. Ningún archivo de M4 se edita.

## Limitaciones conocidas (documentadas, no resueltas)

- **Sin disparador**: el dueño de la base podría hacer UPDATE o DELETE por SQL; las sumas por versión las controla la Etapa C y el chequeo posterior al despliegue, no la base.
- **El costo de la política HEREDADA de dos niveles** (línea → versión → imputación) con volumen real no está medido; la consulta usa el índice por sucursal de la imputación.
- **La aplicabilidad se lee al leer**: cambiar `aplica` cambia lo que se muestra (por eso la Etapa C lo rechaza con gastos).
- **`obligatorioEnGastos`** (planes que exigen distribuir) no se incluye: sin lector, sería una configuración sin efecto. Se agrega con su validación.
- **Volver a «sin asignar»** no entra en la v1: una versión siempre tiene líneas; la coherencia detecta la que no.

## Por qué no las alternativas

- **Una columna «centro» en el renglón o la imputación** (V2): el dato a reinterpretar cuando aparezca un segundo plan.
- **Una sola tabla sin cabecera** (la distribución como filas sueltas): no hay una ganadora; dos versiones con centros distintos se mezclarían.
- **Disparadores** que validen las sumas: contrarios a la regla del proyecto y difíciles de probar y de bajar; la Etapa C y la consulta de coherencia cumplen el mismo fin.
- **Arreglos en la cabecera** (los porcentajes como un arreglo): sin claves foráneas, la base no podría impedir un centro de otro plan.
- **`rigeDesde`**: igual que M5, no hay dos fechas que reconciliar.

## Consecuencias

- Cinco tablas nuevas, cuatro migraciones (`20261019100000` a `20261019103000`), ninguna destructiva al bajar con datos (abortan); el despliegue y los chequeos están en `docs/deploy-con-migraciones.md`.
- Los guardianes se tocaron sumando entradas (clasificación, alcance, claves foráneas con discriminador, solo-agrega, campos sensibles, semántica de «sin fila» y claves reservadas); ningún golden ni «congelada» cambia.
- La Etapa C tiene un contrato claro: las validaciones de arriba, el embudo `planDeCostosAplica`, la auditoría de las altas y de los cambios de `aplica`, y pasar las tres claves a `ACCIONES` cuando el módulo salga de «en desarrollo».
