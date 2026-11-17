# Diseño — Compras etapa (ii-b): la base restringe qué movimientos entran o salen de un depósito de CUARENTENA o RECHAZO (2026-11-17)

Estado: PROPUESTA (niveles 6 a 10; los niveles 1 a 5 vienen del diseño aprobado `docs/diseno-compras-cuarentena-y-rechazo-2026-11-17.md` y de la auditoría `docs/auditoria-lectores-de-disponible-2026-11-17.md`). Sin código ni migración: la migración es turno de schema propio y se pide solo con este diseño aprobado. Lo no verificado está marcado.

## 1 a 5 (resumen, con fuente)
- **Necesidad (CONFIRMADA, dueño 2026-11-17, «4.-lo recomendado» y «Sí, todo como Pedernal»; relatado por el orquestador general):** lo que está en un depósito de uso CUARENTENA o RECHAZO no se puede vender ni gastar como si fuera stock normal; como Pedernal.
- **Etapa (ii-b):** la barrera de BASE (la app tiene ~6 casos de uso que eligen sección y no hay punto único). Las partes (ii-a) venta y (ii-c) reportes son aparte.
- **Regla de Pedernal (VERIFICADO contra su SQL: 0030:665-668, 0064:52-56, 0084:237-242):** un depósito de uso distinto de NORMAL solo admite TRANSFERENCIA, AJUSTE, AJUSTE_POR_CONTEO, ANULACION, ENTRADA con motivo COMPRA y origen RECEPCION, y SALIDA con motivo DEVOLUCION_A_PROVEEDOR; todo lo demás se rechaza (`renglon_deposito_de_uso_restringido`). Las anulaciones son siempre posibles y espejo exacto del original.
- **Invariante I-B1:** ninguna fila de `MovimientoStock` hacia o desde una sección con `uso <> 'NORMAL'` que no esté en la lista de permitidos de abajo. Nace cerrado: lo que no está listado se rechaza.

## 6. Historia y persistencia
- Sin tablas nuevas. Una función y un disparador `BEFORE INSERT FOR EACH ROW` sobre `"MovimientoStock"`, mismo patrón que `MovimientoStock_producto_oculto_trg` (migración 20261115160000, `SECURITY DEFINER`, `search_path` fijo, EXECUTE revocado a PUBLIC).
- La función lee `Seccion.uso` de la sección de la fila (por clave `(empresaId, id)`); si es `NORMAL` no hace nada (camino común, una lectura por clave). Si no, decide por **`MovimientoStock.proceso`** (el efecto real de la línea) y por el signo de `cantidad`, más una marca de anulación.
- **Cómo reconoce una anulación (VERIFICADO en `src/server/persistencia/movimientos/escribir-contra-asiento.ts`):** el contra-asiento es una `Operacion` de proceso AJUSTE con `revierteAOperacionId` no nulo, y sus líneas de Kardex conservan el `proceso` del original con signo inverso. Por eso la función mira `Operacion.revierteAOperacionId IS NOT NULL` de la operación de la fila: si es una anulación, se permite (espejo, igual que Pedernal). NO VERIFICADO: que TODAS las rutas de anulación (compra, venta, conteo, traspaso, corrección de compra) pasen por ese escritor y marquen `revierteAOperacionId`; hay que recorrerlas antes de construir (la auditoría inventarió `escribir-anulacion-de-venta`, `escribir-anulacion-de-compra`, `cancelar-conteo-fisico`).
- **Lista de permitidos (PROPUESTA; cada fila con su fuente):**

| `MovimientoStock.proceso` | Signo | En sección no NORMAL | Fuente / estado |
|---|---|---|---|
| COMPRA | + (entrada) | Permitido (la recepción) | Pedernal 0064; CONFIRMADA por el dueño («entra directo a cuarentena o rechazo», fila 248) |
| COMPRA | − | Solo si es anulación (`revierteAOperacionId`) | espejo |
| DEVOLUCION_PROVEEDOR | − (salida) | Permitido | Pedernal 0084 |
| AJUSTE | ± | Permitido | Pedernal AJUSTE |
| CONTROL (conteo físico) | ± | Permitido | Pedernal AJUSTE_POR_CONTEO |
| TRANSFERENCIA | ± | Permitido (misma sucursal, entre depósitos) | Pedernal TRANSFERENCIA |
| cualquier proceso con `revierteAOperacionId` no nulo | inverso del original | Permitido | Pedernal ANULACION |
| RECLASIFICACION | ± | **Rechazado** (PENDIENTE: ver preguntas) | Pedernal no tiene esta clase |
| TRANSFERENCIA_SALIDA_SUCURSAL, TRANSFERENCIA_ENTRADA_SUCURSAL, REINGRESO_TRANSFERENCIA_SUCURSAL | ± | **Rechazado** (PENDIENTE: ver preguntas) | NO VERIFICADO si la TRANSFERENCIA de Pedernal cruza sucursales |
| VENTA, CONSUMO, MERMA, PRODUCCION, DEVOLUCION_CLIENTE, DEVOLUCION_CONSIGNACION, LIQUIDACION_CONSIGNACION | cualquiera | **Rechazado** | Pedernal rechaza toda otra entrada y salida |

- Error: SQLSTATE 23514, restricción `MovimientoStock_uso_de_seccion_chk`, mensaje técnico `USO_DE_SECCION|<uso>|<proceso>` que la capa de aplicación traduce a un mensaje claro (texto PROPUESTO abajo; lo ve el cliente de empresa).
- Una sección inactiva ya está cubierta por el caso de uso (solo puede sacar); no se repite acá.
- **Datos existentes:** todas las secciones quedan NORMAL con la migración (i), así que el disparador no rechaza nada de lo ya cargado. El disparador solo mira filas nuevas.
- Migración: aditiva, con `down.sql` (borra disparador y función; seguro siempre) y `verificacion-previa.sql` (informa cuántas secciones no NORMAL hay con movimientos que la lista rechazaría). No se aplica a ninguna base real; autorización expresa por base.

## 7. Atomicidad y concurrencia
- El disparador corre dentro de la misma transacción que la escritura del movimiento: la regla y el movimiento entran juntos o ninguno. Una confirmación de recepción, una devolución o un ajuste que viola la lista revierte entero.
- `uso` es inmutable (migración (i)), así que no hay carrera entre «leer el uso» y «escribir el movimiento»: no puede cambiar.
- Idempotencia: no aplica (no es una acción repetible; repetir una escritura rechazada la rechaza igual).
- Carga: una lectura por clave de `Seccion` por cada fila insertada. Con `createMany` de muchas filas, una consulta por fila. NO VERIFICADO el costo bajo carga; alternativa si pesa: disparador a nivel de sentencia con una sola lectura de las secciones distintas.
- Aislamiento: la función es `SECURITY DEFINER` y lee solo `Seccion.uso` de la empresa de la fila (`empresaId` de la fila, no del contexto).

## 8. Acceso e interfaces
- Sin pantallas nuevas. La app traduce el error de la base a un mensaje; hay que mapearlo donde hoy se traducen restricciones (mismo lugar que `MovimientoStock_producto_oculto_trg`).
- **Texto nuevo (PROPUESTA, lo ve el cliente de empresa, a aprobar por el dueño):** «Ese depósito es de cuarentena o de rechazo: solo admite recibir compras, devolver al proveedor, ajustar, contar, mover a otro depósito y anular. No se puede usar para <vender / consumir / mermar / producir>.» (una sola frase base con el verbo del proceso, o un único mensaje genérico; a decidir con el catálogo de textos).

## 9. Consultas y experiencia
- Los pickers de sección de los procesos que quedan prohibidos pueden ocultar las secciones de uso especial (eso es (ii-a) para venta; para consumo/merma/producción, parte de esta etapa o de la (ii-c)). Sin esa mejora, el usuario elige y recibe el mensaje de la base (falla cerrada, no pierde datos). PENDIENTE de decidir si se filtran los pickers en esta etapa (más chica: no; solo el mensaje).
- Riesgo funcional: el operador no podrá tirar mercadería de RECHAZO con una merma; tiene que usar un ajuste (igual que Pedernal).

## 10. Pruebas, migración y operación
- **Dimensiones (oráculo escrito aparte, recorrido completo contra la base real):** {uso de la sección: NORMAL, CUARENTENA, RECHAZO} × {proceso: los 16} × {signo: +, −} × {anulación: sí, no}. 3×16×2×2 = 192 combinaciones, contra la tabla de arriba; guardián que falla si aparece un proceso o un uso nuevo sin declarar su efecto.
- **Pruebas obligatorias:** concurrencia (dos escrituras a la vez sobre la misma sección especial, una permitida y una prohibida: la prohibida falla y la permitida entra; una anulación concurrente a una confirmación de recepción); idempotencia (repetir una recepción confirmada: éxito sin escribir, ya existente); atomicidad (una confirmación con una línea a depósito normal y otra a RECHAZO con proceso prohibido revierte todo); aislamiento (sección de otra empresa: la función no la ve y no la afecta); anulación de la compra recibida a CUARENTENA y de una devolución a proveedor desde RECHAZO: permitidas; `down.sql` revierte limpio.
- **Compatibilidad hacia atrás:** sin secciones especiales, el disparador no cambia nada. Se puede aplicar por adelantado.
- **Preguntas abiertas (UNA por vez, no frenan lo demás):**
  1. RECLASIFICACION: ¿se permite entre depósitos de la misma sucursal desde/hacia cuarentena y rechazo, o se usa la transferencia? Propuesta cerrada: se usa la transferencia (la reclasificación queda rechazada). Es una regla de stock: pregunta al orquestador/dueño.
  2. Traspasos entre sucursales (TRANSFERENCIA_SALIDA/ENTRADA/REINGRESO): ¿pueden salir de cuarentena o rechazo hacia otra sucursal? Propuesta cerrada: no. Pedernal: NO VERIFICADO si su TRANSFERENCIA cruza sucursales (hay que leer su SQL).
  3. Filtrar los pickers en esta etapa o solo mostrar el mensaje: propuesta, solo el mensaje.

## Diferencias con Pedernal (declaradas con motivo)
- Pedernal distingue ENTRADA/SALIDA por «clase» y «motivo/origen»; Motor2 no tiene esas columnas y decide por `MovimientoStock.proceso`, el signo y `Operacion.revierteAOperacionId`. Motivo: lo que impone el modelo de datos de Motor2 (el resultado es el mismo).
- RECLASIFICACION y los traspasos entre sucursales: rechazados por defecto (nace cerrado); Pedernal no tiene RECLASIFICACION y su traspaso entre sucursales es NO VERIFICADO.

## Etapas relacionadas
- (ii-a) venta: `uso = NORMAL` en `prepararOrigen` y `cargarHabituales` y validar el uso de la sección elegida en el mostrador. Sin migración. Puede ir antes o después de esta.
- (ii-c) reportes y alertas: helper compartido `whereSeccionDisponible`; el stock mínimo NO cuenta cuarentena ni rechazo (CONFIRMADO, dueño 2026-11-17, «5a»); valuación incluye todo y consolidado marca por uso (como Pedernal).
- Advertencia heredada de la etapa (i): la comparativa de proveedor y el costo de reposición se derivan del Kardex; una compra rechazada cuenta como «última compra». Se resuelve en (ii-c) con el dueño o se declara.
