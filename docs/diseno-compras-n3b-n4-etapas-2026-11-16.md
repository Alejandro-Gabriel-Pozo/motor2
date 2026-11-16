# Compras: etapas N3-b y N4 — diseño por etapa (solo documentos)

Fecha: 2026-11-16. Frente 5. Continúa `diseno-compras-paridad-pedernal-2026-11-16.md` (escalera, niveles 1 a 5) y la etapa N3-a (rama `feat/compras-recepcion-separada-n3a`, local). **No se aplica ninguna migración a ninguna base.** Estados: CONFIRMADA / PROPUESTA / PENDIENTE / NO VERIFICADA.

## Autorización (cita del dueño, 2026-11-16, relatada por el orquestador general)

«Compras: orden de compra, tres vías y notas de crédito» «como las decidió Pedernal, una por vez, en local y sin aplicar nada a ninguna base». Y: «No dejes nada pendiente de lo que se puede trabajar en paralelo». Fuente: mensaje del orquestador general a esta sesión (2026-11-16; el registro en `motor2-docs` lo mantiene el orquestador general). Alcance autorizado: N3-b (control por línea), orden de compra, tres vías con tolerancias, diferencias con cuatro resoluciones, notas de crédito y devolución al proveedor. **Saldo a favor y reintegro: solo si Pedernal los construyó en esa etapa; Pedernal NO los construyó (solo diseño; pasaron a un «libro común de saldos» que no se leyó): no se arrancan.**

## Cómo se lee Pedernal acá

Para N3 y N4 Pedernal tiene **decisiones del dueño y diseño, no código** (N3 aprobado en la 0063, sin rama; N4 solo diseño: `e9-n4-devolucion-nota-y-saldo-diseno.md`, `compras.md` §C.2/C.4 «punto de partida, no un contrato»). Por eso cada etapa dice qué decisión del dueño de Pedernal la respalda (`DDD:n` = línea de `ZuluHub-docs/11-especificaciones/decisiones-del-dueno-2026-11.md`) y qué quedó **NO VERIFICADO** (SQL real de 0063/0064/0065, libro de saldos, permisos reales). La FORMA (tablas, nombres) se adapta a las convenciones de Motor2 (cuid en filas viejas, uuid de la app en las nuevas por el frente 3, RLS por empresa, solo-inserción, Prisma); toda diferencia con Pedernal se declara.

Timestamps de migración reservados (+100 por etapa): N3-a `20261117120000`, **N3-b `20261117120100`, orden de compra `20261117120200`, tres vías/tolerancias/diferencias `20261117120300`, notas de crédito `20261117120400`, devolución `20261117120500`**. Todas aditivas, con `down.sql` y `verificacion-previa.sql`, subir-bajar-subir, «requiere autorización expresa por base», sin aplicar.

Perillas: las pide esta sesión al frente 4 (`conciliacion_de_tres_vias`, que ya ofrece, y las que el diseño fije). Mientras tanto el interruptor interino es el módulo `recepcion_de_compras` de N3-a.

---

## Etapa N3-b — control por línea de la recepción

**Necesidad:** «control por línea (conforme, con observaciones, rechazada; observación obligatoria si no es conforme)» — `DDD:198` (16/11, «A»). Motivo de rechazo: «alcanza la observación escrita (lista cerrada solo si el dueño la pide)» (`DDD:198`).

**Modelo (PROPUESTA):** tabla nueva `ControlDeLineaDeRecepcion`, solo inserción: `id` uuid, `empresaId`, `facturaProveedorSucursalId` (la parte) + `facturaProveedorRenglonId`, `condicion` CHECK ∈ {`CONFORME`,`CON_OBSERVACIONES`,`RECHAZADA`}, `observacion` (CHECK: obligatoria si no es `CONFORME`; ≤ 500; lista de caracteres permitidos), `cantidadSegunRemito` opcional (>0), quién y cuándo, `version`. Único `(parte, renglón)`. Sin fila = «no se constató» (vacío explícito; nunca un CONFORME por defecto). Difiere de Pedernal en la forma (satélite de `linea_de_recepcion`) porque Motor2 no tiene recepción propia: el satélite cuelga del renglón de la factura y de la parte. **Temperatura, lotes y series declarados: fuera (nadie los pidió).**

**Comando (extiende `confirmar-recepcion-de-factura`):** al confirmar se manda el control de cada línea; las `RECHAZADA` **no entran al stock** (cantidad rechazada = 0 en el movimiento; su destino —cuarentena/rechazo, 0064— es etapa posterior y NO VERIFICADO). Si todas son rechazadas, la parte se confirma sin stock.

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma confirmación dos veces: la segunda devuelve `YA_RECIBIDA`; el control no se duplica (único por parte y renglón). |
| Concurrencia | dos confirmaciones: cerrojo de cabecera + guarda de estado; gana una. |
| Tiempo | fecha de stock entre la de la factura y hoy (como N3-a). |
| Incertidumbre | falla de red tras commit: reintentar devuelve `YA_RECIBIDA`; la consulta muestra lo constatado. |
| Error parcial | control + stock + estado en UNA transacción; si falla un renglón no queda nada. |
| Datos faltantes | línea sin control: se rechaza la confirmación (todas las líneas se constatan) — PROPUESTA; observación vacía con `CON_OBSERVACIONES`/`RECHAZADA`: rechazo. |
| Cambio de permisos | `compra_recibir` (gerente/administrador) re-validado en el servidor al confirmar. |

**Dimensiones del oráculo:** condición (3) × observación (con/sin) × cantidad (parcial/total/cero) × módulo (on/off) × rol. **Textos:** «Conforme», «Con observaciones», «Rechazada», «Observación» ya aprobados en Pedernal (`catalogo-compras.ts`); alta en catálogo T1 por el orquestador. **NO VERIFICADO:** SQL real de 0063.

## Etapa OC — orden de compra (sin aprobación)

**Necesidad:** «una orden de compra NO necesita aprobación de una segunda persona» (`DDD:197`, 1A, 16/11); «crear y pedir una orden de compra lo hace quien administra o gerencia, no el operador» (5A); vocabulario aprobado «Pedida», «Borrador», «Cerrada», «Anulada» (`catalogo-compras.ts`).

**Ciclo (PROPUESTA, E9 D127 de Pedernal):** `BORRADOR → PEDIDA → CERRADA | ANULADA`. «Recibida parcial» y «recibida» **se calculan** (no se guardan). No se edita una vez pedida; se anula solo sin recepciones y con motivo; se cierra sola al recibirse todo o a mano «con saldo»; no se reabre; se reemplaza (nueva orden que apunta a la anterior). **Contradicción de Pedernal declarada:** el DDL viejo (`compras.md` §C.4) dice `EMITIDA`; vale «Pedida».

**Modelo (PROPUESTA):** `OrdenDeCompra` (uuid, `empresaId`, `numero` correlativo por empresa asignado al pedir, `proveedorId`, `sucursalDestinoId`, `fechaDeEntregaPrevista` date, `reemplazaAId`, `estado` CHECK, `cierreMotivo` ∈ {`COMPLETA`,`CON_SALDO`}, anulación con quién/cuándo/motivo, `claveIdempotencia`+`payloadHash`, `version`) y `LineaDeOrden` (producto, cantidad pedida en unidad de stock, `precioPorUnidadStock` opcional —nunca cero—, `retirada` boolean). El saldo por línea (`recibida`) se **calcula** desde las recepciones vinculadas (no tabla de saldo editable) salvo que la prueba de concurrencia de tres vías exija el contador atómico (ver tres vías). Vínculo recepción↔orden: columna opcional `ordenDeCompraId` en la **parte** (`FacturaProveedorSucursal`), nullable: una compra sin orden sigue igual.

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma clave → la misma orden; pedir dos veces → `YA_PEDIDA`. |
| Concurrencia | pedir y anular a la vez: `FOR UPDATE`; el número correlativo se asigna con contador atómico sin huecos duplicados (único por empresa). |
| Tiempo | entrega prevista ≥ hoy (Argentina); no se retroceden estados. |
| Incertidumbre | reintento con la misma clave devuelve el resultado guardado. |
| Error parcial | cabecera + líneas atómicas. |
| Datos faltantes | proveedor, sucursal y ≥ 1 línea con cantidad > 0 obligatorios; precio «sin precio», nunca cero. |
| Cambio de permisos | crear/pedir: gerente/administrador (acción nueva en zona restringida); el operador: rechazo en el servidor. |

**Perilla:** `conciliacion_de_tres_vias` (requiere `recepcion_separada`) según el frente 4. **NO VERIFICADO:** que Pedernal tenga la acción `ordenes_de_compra.*` con esos nombres (solo propuesta de E9 §229).

## Etapa 3V — tres vías, tolerancias y diferencias

**Necesidad y decisiones (Pedernal, 16/11, `DDD:197`):** sin tolerancia por defecto («sin tolerancia definida toda diferencia queda abierta»), las configura el gerente (`compras.configurar`); «Qué hacer con la diferencia» ofrece **cuatro** opciones: «Dejar abierta», «Pedir nota de crédito», «Aceptar la diferencia», «Devolver al proveedor» (2A; reemplaza las siete de `DDD:121` del 14/11).

**Modelo (PROPUESTA):**
- `ToleranciaDeCompras` (una fila por empresa; columnas de cantidad %, precio %, importe $, nullables; **NULL = no definida**, distinto de cero; CHECK de rango; `version`; solo el gerente escribe). Contradicción de Pedernal sobre dónde vive (satélite vs. `configuracion_de_compras`): se elige tabla propia, Motor2 no tiene `configuracion_de_compras`.
- `ConciliacionDeCompra` y `DiferenciaDeCompra`: la tres vías compara **orden** (lo pedido) · **recepción** (lo recibido, N3) · **factura** (lo facturado). Diferencia: `tipo` ∈ {recibido distinto de lo pedido, facturado distinto de lo recibido, precio distinto, total no cierra}, cantidades e importes con signo, `dentroDeTolerancia`, tolerancias aplicadas congeladas, `estado` ∈ {`ABIERTA`,`RESUELTA`,`ANULADA`}, `resolucion` ∈ {`ACEPTADA`,`PEDIR_NOTA_DE_CREDITO`,`DEVOLVER`,`DENTRO_DE_TOLERANCIA`} (el «dejar abierta» es el estado `ABIERTA`, no una resolución), `motivo` obligatorio salvo `DENTRO_DE_TOLERANCIA`, quién y cuándo, `version`. Único por `(conciliación, tipo, renglón)`: reintentar no duplica. Regla heredada de Pedernal 0037: una asignación nunca supera lo recibido ni lo facturado (`UPDATE … WHERE asignada + n <= recibida`); en Motor2 la base la impone con CHECK sobre un contador por renglón de la parte (nuevo, escrito solo por el caso de uso).

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | conciliar dos veces la misma factura: no duplica diferencias (único); resolver dos veces: `YA_RESUELTA`. |
| Concurrencia | dos asignaciones sobre el mismo renglón: tope atómico, gana una; resolver y anular la factura a la vez: cerrojo de cabecera. |
| Tiempo | tolerancia se congela al registrar la diferencia (cambiar la tolerancia después no reescribe lo ya registrado). |
| Incertidumbre | reintento por clave: devuelve lo hecho. |
| Error parcial | conciliación + diferencias + contadores en una transacción. |
| Datos faltantes | sin orden: se concilia recepción↔factura (dos vías); tolerancia no definida: toda diferencia `ABIERTA`. |
| Cambio de permisos | configurar tolerancias: solo gerente; resolver una diferencia: **solo gerente y administrador — CONFIRMADA** («Solo gerente y administrador (Recomendada)», 2026-11-16, registro `motor2-docs` «Compras: tres preguntas del frente 5»); el operador no la ve resolver y el servidor lo rechaza. |

**«Pedir nota de crédito»** crea un **pedido de nota** (hecho aparte: `DDD:176` 15A «la devolución no crea sola el pedido»; ver etapa NC) y **«Devolver al proveedor»** abre la devolución (etapa DEV); ninguna de las dos mueve dinero. **Dimensiones del oráculo:** tolerancia (sin definir / definida) × tipo de diferencia × resolución × orden (con/sin) × rol.

## Etapa NC — notas de crédito del proveedor

**Necesidad:** «a vos te pueden hacer una nota de crédito y ellos te tienen con saldo a favor… que yo devuelva una compra no significa que devuelva dinero» (`DDD:166`, 15/11); la nota «solo en N4» (`DDD:177`, 18A); un pedido de nota es un paso aparte (15A).

**Decisión técnica del orquestador general (2026-11-16, «primero lo más barato»; el dueño la puede corregir): reutilizar las 4 tablas `NotaCreditoProveedor*` que ya existen sin escritor** (trae factura asociada con FK de tres columnas «misma factura y proveedor», único parcial del número vigente, líneas por renglón, imputación por sucursal y `operacionDevolucionId`) en vez del «comprobante clase nota» de Pedernal. Motivo: regla «inventariar lo que ya existe» y «tablas a ciegas»; difiere en forma de Pedernal pero produce el mismo resultado. Se completa solo lo que falte (tope `total acreditado ≤ total de la factura` atómico: `UPDATE … WHERE acreditado + n <= total`, S-1 de Pedernal) — **verificar en la implementación** que las tablas lo permiten sin tocar sus CHECK.

**Comandos:** `pedirNotaDeCredito` (pedido con estados `A_SOLICITAR → SOLICITADA → RECIBIDA | RECHAZADA | ANULADA`, importe estimado opcional nunca cero, factura y diferencia opcionales; tabla nueva `PedidoDeNotaDeCredito`), `cargarNotaDeCredito` (idempotente por `claveIdempotencia` ya única; número único entre vigentes; solo sobre factura vigente del mismo proveedor; **no crea stock**) y `anularNotaDeCredito` (registro nuevo; no borra). **La nota nunca reduce sola lo que se paga** (`DDD:167/168`).

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma clave → misma nota; misma nota (proveedor+tipo+número) con otra clave → `NOTA_DUPLICADA`. |
| Concurrencia | dos notas que juntas pasan el total de la factura: tope atómico, gana una; anular nota y cargar otra a la vez: cerrojo de factura. |
| Tiempo | fecha de la nota ≤ hoy; anular la factura con nota vigente: bloqueado (ya existe `CON_NOTAS_DE_CREDITO`). |
| Incertidumbre | reintento por clave devuelve el mensaje guardado. |
| Error parcial | nota + líneas + imputaciones + (opcional) devolución atómicas. |
| Datos faltantes | sin factura asociada: rechazo (S-3 de Pedernal) — la «nota suelta» que traen las tablas queda **sin usar** (NO se pidió). |
| Cambio de permisos | cargar: quien tiene compras (supuesto de Pedernal); aplicar saldo: no existe en esta etapa. |

**NO construido (sin Pedernal en código):** saldo a favor, aplicación a factura, reintegro, cuenta corriente, importe de pago = total − aplicado. **Dimensiones del oráculo:** factura (vigente/anulada/de otro proveedor) × importe (≤ / > tope) × nota (vigente/anulada/duplicada) × pago de la factura (con/sin) × rol.

## Etapa DEV — devolución al proveedor

**Cambio de permisos declarado arriba en la tabla. Necesidad:** hecho H1 separado: «sale mercadería del stock hacia el proveedor; no mueve dinero, no crea nota, no toca la factura» (`e9-n4` §1); la devolución no crea sola el pedido de nota (`DDD:176` 15A). Una sola lista de motivos «que unifica rechazo y devolución» y «devuelve gerente o administrador» — **supuestos del ingeniero de Pedernal** (`DDD:121(4)`), no del dueño.

**Modelo:** Motor2 **ya tiene** el proceso de stock `DEVOLUCION_PROVEEDOR` (permiso `proceso_devolucion_proveedor`, piso operario, sin auditoría administrativa propia). Esta etapa **no crea otra salida de stock**: agrega (a) `DevolucionAProveedor` (uuid, `empresaId`, `operacionId` → la `Operacion` ya existente, `compraOrigen` opcional, `motivo` texto obligatorio con lista de permitidos, `diferenciaId` opcional, quién/cuándo, estado `CONFIRMADA|ANULADA` con anulación espejo, `claveIdempotencia`), (b) auditoría administrativa de la devolución, (c) la guarda de anulación en cadena (una compra con devolución vigente no se anula: `COMPRA_CON_DEVOLUCION`; una devolución con pedido de nota vigente no se anula).

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma clave → una sola salida de stock. |
| Concurrencia | dos devoluciones sobre la misma existencia: la base impide pasar de cero (stock agregado ya validado); devolver y anular la compra a la vez: cerrojo. |
| Error parcial | devolución + salida de stock atómicas (falla del stock deshace el registro). |
| Datos faltantes | motivo vacío o cantidad ≤ 0: rechazo. |
| Cambio de permisos | **CONFIRMADA (cambia lo de hoy):** «Solo gerente y administrador (Recomendada)» (2026-11-16). Hoy `proceso_devolucion_proveedor` es piso operario; pasa a piso administrador. **Qué ve el operador ahora:** deja de ver/usar la opción de devolver al proveedor (la acción se rechaza en el servidor con «Esta acción no está permitida»); sus devoluciones ya hechas siguen visibles en el historial. Cambia permisos Y comportamiento: la etapa lo declara, regenera matrices/goldens de permisos con ese motivo y agrega pruebas de denegación del operador y de aceptación de gerente/administrador. No toca devoluciones ya registradas. |

---

## Orden de construcción y reparto de subagentes

N3-b → OC → 3V → NC → DEV, **un PR por etapa**, cada una en su rama sobre la anterior (máximo 2 subagentes Sonnet a la vez; cada uno corre el gate local sin e2e/build). Mientras N3-a no esté commiteada no se arranca código de N3-b. Las migraciones de cada etapa solo agregan; ninguna se aplica.

## Respuestas del dueño (2026-11-16, literales, `motor2-docs` «Compras: tres preguntas del frente 5»)

- Diferencias de tres vías: «Solo gerente y administrador (Recomendada)» — CONFIRMADA.
- Devolución al proveedor: «Solo gerente y administrador (Recomendada)» — CONFIRMADA; **cambia el permiso y el comportamiento de hoy** (ver etapa DEV).
- Facturas repartidas entre sucursales: «Más adelante (Recomendada)» — CONFIRMADA: N3-a2 **diferida**, no se construye ahora.
- Reutilizar `NotaCreditoProveedor*`: decisión técnica del orquestador general (corregible por el dueño).

## Preguntas abiertas al dueño

- Notas y saldo a favor: Pedernal decidió que la nota «siempre pasa por saldo a favor»; Motor2 no arranca el saldo hasta que Pedernal lo construya o el dueño lo pida (NO VERIFICADO el libro de saldos). Se pregunta cuando toque.

## Riesgos y NO VERIFICADO

SQL real de 0063/0064/0065 de Pedernal; `primitiva-de-libro-diseno.md`; si Pedernal usa esos nombres de acciones; destino de lo rechazado (cuarentena/rechazo, 0064); que las 4 tablas de notas toleren el tope sin migración; permisos reales de N4 en Pedernal (la matriz de E9 es propuesta).
