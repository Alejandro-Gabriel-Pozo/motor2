# Diseño: Pagos, etapa X0 — declarar el pago de una factura de proveedor (2026-11-04)

Estado: **etapa de código.** Padre: `docs/diseno-pagos-y-conciliacion-2026-11-03.md` (§10, respuestas del dueño del 2026-11-04). Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA. La forma de guardar el pago (tabla nueva que solo agrega) y los cuatro supuestos de abajo fueron **aprobados por la coordinación el 2026-11-04** (decisión de ingeniería; el dueño los ve en el próximo resumen).

## 0. Lo verificado en el código real (no en documentos)

| Pregunta | Respuesta verificada |
|---|---|
| ¿Qué guarda hoy la factura de proveedor? | `FacturaProveedor` (empresa): `condicionPago` (CHECK solo `CONTADO_PAGADA`, inmutable: la app no tiene UPDATE), `fechaPagoDeclarada`, `medioPagoDeclarado` (la app tiene UPDATE por columna), ninguna escrita por `src/`. Migración `20261016101000`. |
| ¿Toda compra tiene factura? | **No.** La compra simple (una sola sucursal) es solo `Operacion` COMPRA (`registrarMovimiento`); solo la compra repartida crea `FacturaProveedor`. El caso de uso `registrarFacturaProveedorCasoDeUso` ya soporta «una sola parte del 100 % en la sucursal que carga». |
| ¿Cómo se ve el pago hoy? | Pantalla de compra por pasos (`panel-compra-por-pasos.tsx`): el paso «Pago» muestra «Pendiente de completar». En «Compras registradas» no se muestra el pago. |
| ¿Hay moneda en la factura? | No hay columna: el sistema opera en pesos. X0 **no guarda importes** (paga la factura entera), así que no introduce dinero nuevo ni moneda; el importe del pago es `FacturaProveedor.importeTotal`. |
| Patrones a copiar | Anulación como registro nuevo con clave y huella: `AnulacionDeFacturaProveedor`; permiso de empresa de piso operario: `compra_repartir` (migración `20261016100000`); alta de permiso con siembra al admin: M6.4 (`20261018103000`). |

## 1. Propósito y alcance

- **Necesidad (CONFIRMADA, dueño, 2026-11-04):** «hoy alcanza con cargar la factura y luego confirmar cuándo se pagó (si no fue en el momento): se carga la factura el viernes y se paga el martes; pasamos a otro mes, y eso ya es flujo de caja del otro mes».
- **Dentro de X0:** (a) cargar una factura «pendiente de pago»; (b) «Declarar pago» con fecha y medio; (c) «Anular pago declarado» (corrección de un error de tipeo, con registro nuevo); (d) mostrar el estado de pago en «Compras registradas».
- **Fuera (no se hace):** retenciones, cuentas de Gmail/Drive, conciliación N a N (X3), mes de imputación de servicios, notas de crédito, pagos parciales, reporte de flujo de caja (queda pendiente: se agrupará por mes de `fechaPago`), solicitud/aprobación del pago, importes en el pago.
- **Poda:** `fechaPagoDeclarada` y `medioPagoDeclarado` de la factura quedan **sin uso** (candidatas a borrarse en X3). No se escriben.

## 2. Actores y contexto

| Actor | Qué hace | Permiso |
|---|---|---|
| Quien carga la compra | Elige «pagada ahora» o «pendiente de pago» | `proceso_compra` (sucursal), como hoy |
| Quien confirma el pago | Declara o anula el pago | `declarar_pago_compra` (**nuevo**, EMPRESA, piso operario, semilla solo `admin`; el gerente lo asigna en la matriz). PROPUESTA aprobada: es dinero, no se reusa `proceso_compra` |
| Administración / auditoría | Ven el estado en «Compras registradas» | `reporte_compras` (ya existe) |

El contexto de la clave es **empresa**: la factura es un documento de la empresa (ADR-029); declarar el pago desde cualquier sucursal activa con la clave sirve para cualquier factura de la empresa.

## 3. Casos de uso

| # | Comando | Quién | Resultado |
|---|---|---|---|
| CU1 | Cargar compra «pagada ahora» | `proceso_compra` | **Sin cambios** (camino actual). Compra simple: solo `Operacion`. Factura repartida: `condicionPago = CONTADO_PAGADA` |
| CU2 | Cargar compra «pendiente de pago» | `proceso_compra` (+ `compra_repartir` si reparte) | Factura con `condicionPago = PENDIENTE_DE_PAGO`. Si no se reparte: una parte del 100 % en la sucursal activa (mismo stock y Kardex que la compra simple) |
| CU3 | Declarar pago | `declarar_pago_compra` | Un registro `PagoDeFacturaProveedor` (fecha, medio, quién, cuándo) |
| CU4 | Anular pago declarado | `declarar_pago_compra` | Un registro `AnulacionDePagoDeFacturaProveedor` con motivo; el pago queda marcado anulado y la factura vuelve a «pendiente» |
| CU5 | Ver el estado de pago | `reporte_compras` | «Pagada al cargar», «Pendiente de pago», «Pagada el dd/mm/aaaa (medio)» |

## 4. Conceptos y ciclo de vida (nivel 4)

- **Condición de pago** (al cargar, inmutable): `CONTADO_PAGADA` | `PENDIENTE_DE_PAGO` (CHECK ampliado, CONFIRMADA por el dueño en §10 del padre).
- **Estado del dinero** (derivado, no se guarda): `PAGADA_AL_CARGAR` (condición contado) · `PENDIENTE` (condición pendiente y ningún pago vigente) · `PAGADA` (pendiente con un pago vigente). Anulada la factura, el estado no se muestra como deuda.
- Ciclo del pago: `vigente` → `anulado` (fin; se declara uno nuevo si hace falta, y **solo uno vigente** por factura).
- Dos estados separados (principio del padre §9): aprobación y dinero; X0 solo tiene el del dinero.

## 5. Invariantes y políticas (nivel 5)

| # | Regla | Estado |
|---|---|---|
| P1 | Solo una factura `PENDIENTE_DE_PAGO` admite pago. Una `CONTADO_PAGADA` no (ya está pagada). | CONFIRMADA (necesidad) / regla PROPUESTA |
| P2 | Un único pago **vigente** por factura (índice único parcial en la base). | PROPUESTA aprobada |
| P3 | `fechaPago` es un **día** (sin hora), no anterior al día de la factura y no posterior a **hoy** en Argentina (UTC-3). | CONFIRMADA («no posterior a hoy»); piso = día de la factura PROPUESTA |
| P4 | Medio de lista cerrada: TRANSFERENCIA, EFECTIVO, CHEQUE, TARJETA, OTRO (CHECK). | PROPUESTA aprobada |
| P5 | No se declara pago sobre una factura **anulada**. Anular la factura **no** anula el pago: la factura anulada no cuenta como deuda ni como flujo (el reporte futuro filtra por vigentes). | PROPUESTA |
| P6 | Cada declaración y cada anulación llevan quién, cuándo, clave de reintento (única global, ADR-028) y huella; **nada se borra ni se edita** (la app no tiene UPDATE sobre el pago salvo la marca de anulación, ni DELETE). | PROPUESTA aprobada |
| P7 | Declarar el mismo pago dos veces (misma clave y mismos datos) devuelve el mismo resultado sin duplicar; misma clave con otros datos = conflicto. | PROPUESTA |
| P8 | Aislamiento por empresa: RLS `aislamiento_empresa` en las dos tablas nuevas; FK compuesta `(empresaId, facturaProveedorId)`. | PROPUESTA |
| P9 | Toda operación verifica el permiso en el servidor (`conPermiso("declarar_pago_compra")`); el frontend no decide nada. | PROPUESTA |
| P10 | La condición de pago de una factura ya cargada no cambia (se anula y se vuelve a cargar, como el importe). | CONFIRMADA por el diseño de M3 |

## 6. Historia y persistencia (nivel 6) — migración `20261104110000_pago_de_factura_proveedor`

Aditiva y reversible; **no se aplica en Neon/producción** (la coordinación hace respaldo, ensayo y despliegue).

1. `FacturaProveedor_condicion_pago_chk` pasa de `IN ('CONTADO_PAGADA')` a `IN ('CONTADO_PAGADA','PENDIENTE_DE_PAGO')`. Sin columnas nuevas en la factura. El CHECK `..._pago_declarado_solo_contado_chk` queda como está (las columnas viejas no se escriben).
2. `PagoDeFacturaProveedor` (de empresa): `id`, `empresaId`, `facturaProveedorId`, `fechaPago DATE`, `medio TEXT` (CHECK), `claveIdempotencia` único, `payloadHash`, `resultadoMensaje`, `creadoPorId`, `creadoEn`, `anuladoEn`, `anuladoPorId` (pareo CHECK). Índice único parcial `(facturaProveedorId) WHERE anuladoEn IS NULL`. La app: SELECT, INSERT y UPDATE **solo** de `anuladoEn`/`anuladoPorId`.
3. `AnulacionDePagoDeFacturaProveedor`: `pagoId` (único: una anulación por pago), `motivo` (CHECK 1–200), clave única, huella, mensaje, quién, cuándo. Solo SELECT e INSERT.
4. `down.sql`: **aborta** si hay filas en cualquiera de las dos tablas o facturas `PENDIENTE_DE_PAGO`; si no, borra las tablas y restaura el CHECK.
5. Migración de **datos** `20261104111000_permiso_declarar_pago_compra`: alta de la clave y siembra al rol `admin` de cada empresa (patrón M6.4/M3a), idempotente, `down.sql` que aborta si alguien configuró la clave a mano.
6. Puntos de extensión para X3: `PagoDeFacturaProveedor` se convierte en un pago con una imputación a su factura; las columnas `importe`/`moneda` se **agregan** entonces (aditivo), sin perder fecha ni medio.

## 7. Atomicidad y concurrencia (nivel 7)

- Declarar: una transacción SERIALIZABLE (con reintento): idempotencia primero (clave en el pago); `SELECT … FOR UPDATE` de la cabecera de la factura (serializa contra otra declaración y contra la anulación de la factura); validar; INSERT del pago + auditoría. El índice parcial es la segunda barrera: si dos declaran a la vez, gana una y la otra recibe «ya tiene un pago declarado» (o el resultado repetido si traía la misma clave).
- Anular: igual, con candado sobre la cabecera, `UPDATE … WHERE anuladoEn IS NULL` (0 filas = otra anulación ganó) y el INSERT de la anulación en la misma transacción.
- Todo o nada: pago + auditoría (o anulación + marca + auditoría) en una sola transacción.

### Tabla «¿qué pasa si…?» — Declarar pago

| Caso | Qué pasa |
|---|---|
| Repetición (doble clic, misma clave y mismos datos) | Éxito con el mismo mensaje, `repetida: true`; no se crea otro pago ni otra auditoría |
| Misma clave con otra fecha o medio | `CONFLICTO_IDEMPOTENCIA`, no escribe |
| Dos pedidos distintos a la vez sobre la misma factura | Uno gana; el otro «la factura ya tiene un pago declarado» (índice parcial + candado) |
| Pago ya vigente y se declara otro (clave nueva) | `YA_TIENE_PAGO`; hay que anular el vigente primero |
| Fecha posterior a hoy (AR) | Rechazo en el guard y en el caso de uso (el reloj lo inyecta el servidor) |
| Fecha anterior al día de la factura | `FECHA_FUERA_DE_RANGO` |
| Corte de día (23:59 / 00:01 AR) | El «hoy» sale de `diaDeCalendario(ahora, ZONA_ARGENTINA)`: 23:59 AR del martes acepta martes; 00:01 del miércoles acepta miércoles; nunca el día siguiente |
| Reintento tras corte de red | Misma clave → mismo resultado (la clave la genera la pantalla al abrir la confirmación) |
| Error parcial (falla la auditoría) | Se revierte todo; no queda pago sin auditoría |
| Factura anulada | `FACTURA_ANULADA` |
| Factura `CONTADO_PAGADA` | `NO_ADMITE_PAGO` |
| Factura de otra empresa / inexistente | `NO_ENCONTRADA` (la RLS la oculta; no se distingue) |
| Sin permiso / permiso retirado entre la pantalla y el envío | `conPermiso` lo rechaza en el servidor; el frontend no decide |
| Medio inválido o faltante / fecha faltante | Rechazo del guard |

### Tabla «¿qué pasa si…?» — Anular pago

| Caso | Qué pasa |
|---|---|
| Repetición (misma clave y datos) | Éxito repetido, una sola anulación |
| Dos anulaciones a la vez | Una gana (`UPDATE … WHERE anuladoEn IS NULL` y unicidad por pago); la otra «ya está anulado» |
| Pago ya anulado | `YA_ANULADO` |
| Sin motivo / motivo > 200 | Rechazo del guard y del CHECK |
| Luego de anular | La factura vuelve a «pendiente» y admite un pago nuevo |

## 8. Acceso e interfaces (nivel 8)

- Server Actions finas en `src/server/actions/movimientos/pagos-factura-proveedor.ts`: `declararPagoDeFacturaProveedor(facturaId, fechaPago, medio, claveIdempotencia)` y `anularPagoDeFacturaProveedor(pagoId, motivo, claveIdempotencia)`, ambas con `conPermiso("declarar_pago_compra", …)`.
- `registrarFacturaProveedor` acepta `condicionPago` (por defecto `CONTADO_PAGADA`: el código anterior no cambia).
- Pantalla de compra por pasos: el paso «Pago» pasa de «pendiente de completar» a elegir «Pagada ahora» (default) o «Pendiente de pago».
- «Compras registradas»: estado de pago por factura y los formularios «Declarar pago» / «Anular pago» (con `BotonConConfirmacion`, que genera la clave de reintento).

## 9. Consultas y experiencia (nivel 9)

- Estado y fecha/medio del pago vigente visibles en «Compras registradas» (sin importes nuevos). Lo que falta se muestra «Pendiente de pago», nunca se inventa una fecha.
- El reporte de flujo de caja por mes de `fechaPago` queda **pendiente** (etapa posterior con nombre).

## 10. Pruebas, migración y operación (nivel 10)

- **Dimensiones que cambian dinero, permisos o visibilidad** (oráculo escrito aparte en `test/pagos/oraculo-declarar-pago.ts`): condición de pago (2) × medio (5 + inválido) × fecha frente a la factura y a hoy (antes / el mismo día / entre / hoy / mañana) × factura simple (una parte) o repartida (varias) × vigente o anulada × pago previo (ninguno / vigente / anulado) × permiso (con / sin). Test exhaustivo contra la tabla; **guardián** que falla si aparece una dimensión nueva (columna del pago, medio, condición) sin declarar.
- Unitarios del guard y de la regla pura de la decisión; integración con Postgres real (RLS, CHECK, índice parcial, privilegios); **concurrencia** (dos «declarar pago» a la vez: una gana) e **idempotencia** (la misma clave dos veces); subir-bajar-subir de la migración; migración de datos del permiso.
- **Mutación demostrada:** romper la regla (p. ej. quitar la guarda «pago vigente» o la comparación de fecha) → rojo → revertir → verde.
- Guardianes a mantener: clasificación de tablas, kardex-solo-agrega, campos sensibles (`payloadHash`), matriz de permisos y claves (catálogo ↔ migraciones), `caracterizaciones-congeladas`, `deploy-con-migraciones.md`.
- **Operación:** la migración NO se aplica en Neon desde esta rama; la coordinación hace respaldo y ensayo.

## 11. Preguntas abiertas (no bloquean X0)

- ¿Anular una factura debería anular también su pago vigente? Hoy no (P5): la factura anulada deja de contar; el pago queda como historia. Se revisa en X3.
- Retenciones, tolerancia y adjuntos siguen en X3 / X1 (padre §8).
