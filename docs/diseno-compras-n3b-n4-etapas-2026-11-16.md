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

## Etapa 3V — tres vías, tolerancias y diferencias (reescrita 2026-11-17 según 0067)

**Necesidad y decisiones:** sin tolerancia por defecto («sin tolerancia definida toda diferencia queda abierta»), las configura el gerente (`compras.configurar`). Resoluciones: dueño, 2026-11-17: «Las 7, como el SQL de Pedernal (Recomendada)» — CONFIRMADA (fuente: mensaje del orquestador general; registro en `motor2-docs`). Las 4 acordadas el 16/11 quedan incluidas. Fuente de la forma: Pedernal `0067_compras_diferencias.sql` (pendiente, sin aplicar; ZuluHub-docs 03cde03). Contraste línea por línea: `diseno-compras-contraste-sql-pedernal-2026-11-16.md` §9.3.

**Modelo (PROPUESTA, igual a 0067 salvo lo que impone Prisma/RLS):**
- `ToleranciaDeCompras`: una fila por empresa, **4** columnas nullables (**NULL = no definida ≠ 0**): `toleranciaDeCantidad` (% sobre lo recibido, 0 a 100), `toleranciaDePrecio` (% sobre el precio de referencia, 0 a 100), `toleranciaDeImporte` (pesos, ≥ 0) y `toleranciaDeRecepcion` (% sobre lo pedido, 0 a 100). `version`; solo la escribe el gerente/administrador. Con la tolerancia de recepción vacía, el tope de recibir contra la orden es idéntico al de la etapa OC; definida, el tope es `pedida × (1 + t/100)` y solo cuando el nivel `compras.recepcion_excede_la_orden` lo exige (AVISAR sin confirmar o BLOQUEAR). Diferencia declarada con Pedernal: tabla propia porque Motor2 no tiene `configuracion_de_compras`.
- `ConciliacionDeCompra` (solo inserción) y `ToleranciaAplicadaDeConciliacion` (copia de las tres de la diferencia al conciliar; solo inserción; entra con su conciliación).
- `DiferenciaDeCompra`: `tipo` ∈ {`FACTURADO_DISTINTO_DE_LO_RECIBIDO`, `PRECIO_DISTINTO`, `FACTURADO_Y_NO_RECIBIDO`} (solo estos tres; `TOTAL_NO_CIERRA` y `RECIBIDO_DISTINTO_DE_LO_PEDIDO` quedan **fuera** de este tramo, como en Pedernal); factura y renglón de factura, recepción y renglón de recepción (opcionales según el tipo); `cantidadDeDiferencia` e `importeDeDiferencia` con signo (NULL = no aplica o sin precio); `precioFacturado`, `precioDeReferencia` y `origenDelPrecioDeReferencia` (`ORDEN` si la recepción es contra una orden, si no `RECEPCION`; los tres juntos o ninguno; el precio facturado solo en `PRECIO_DISTINTO`); `dentroDeTolerancia`; las tres tolerancias aplicadas copiadas; `estado` ∈ {`ABIERTA`,`RESUELTA`,`ANULADA`}; `resolucion` ∈ {`ACEPTADA`, `DENTRO_DE_TOLERANCIA`, `NOTA_DE_CREDITO`, `NOTA_DE_DEBITO`, `DEVOLUCION`, `FACTURA_COMPLEMENTARIA`, `CORREGIDA_POR_EL_PROVEEDOR`} (el «dejar abierta» es el estado `ABIERTA`); `motivo` ≤ 500 obligatorio salvo `DENTRO_DE_TOLERANCIA`; `DENTRO_DE_TOLERANCIA` solo si la diferencia realmente está dentro; quién y cuándo; `version`. **Único por (conciliación, tipo, renglón de factura, recepción, renglón de recepción)** con NULL tratado como valor: reintentar no duplica.
- Transiciones: ABIERTA → RESUELTA | ANULADA y RESUELTA → ANULADA; nada se reabre (al conciliar de nuevo se registra otra); al anularse conserva su resolución, motivo y autor. Solo cambian estado y resolución; todo lo demás es inmutable (CHECK/disparador). La diferencia entra solo en la transacción de su conciliación.
- La regla «una asignación nunca supera lo recibido ni lo facturado» del diseño anterior **no está en 0067**: queda fuera (NO VERIFICADO dónde vive en Pedernal; no se construye sin ella).

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | conciliar dos veces la misma factura: no duplica diferencias (único); resolver dos veces: `YA_RESUELTA`. |
| Concurrencia | resolver y anular la factura a la vez: cerrojo de cabecera; dos conciliaciones de la misma factura: serializadas por el cerrojo, la segunda no duplica (único). |
| Tiempo | las tolerancias se copian a la conciliación y a cada diferencia al registrarla: cambiar la tolerancia después no reescribe lo ya registrado. |
| Incertidumbre | reintento por clave: devuelve lo hecho. |
| Error parcial | conciliación + tolerancias aplicadas + diferencias en una transacción. |
| Datos faltantes | sin orden: se concilia recepción↔factura (precio de referencia de la recepción); tolerancia no definida: toda diferencia `ABIERTA`; renglón sin precio: importe de diferencia NULL. |
| Cambio de permisos | configurar tolerancias: gerente/administrador; resolver: **solo gerente y administrador — CONFIRMADA** («Solo gerente y administrador (Recomendada)», 2026-11-16); el operador no resuelve y el servidor lo rechaza. |

**Resoluciones y otras etapas:** `NOTA_DE_CREDITO`, `NOTA_DE_DEBITO`, `DEVOLUCION` y `FACTURA_COMPLEMENTARIA` son **solo la constancia de qué se hizo** (con su motivo); ninguna crea sola una nota, una devolución ni una factura ni mueve dinero (0067 no los enlaza). **Dimensiones del oráculo:** tolerancia (sin definir / definida / en el borde) × tipo (3) × resolución (7) × orden (con/sin) × rol; tabla en `docs/oraculo-combinaciones-compras-diferencias-AAAA-MM-DD.md` al construir.

## Etapa NC — notas de crédito del proveedor (reescrita 2026-11-17 según 0085)

**Necesidad:** «a vos te pueden hacer una nota de crédito y ellos te tienen con saldo a favor… que yo devuelva una compra no significa que devuelva dinero» (`DDD:166`, 15/11); la nota «solo en N4» (`DDD:177`, 18A). Forma: Pedernal `0085_compras_notas_de_credito.sql` (pendiente): **comprobante sin saldo** que corrige UNA factura; el libro de saldos (crédito, aplicación, reintegro) va aparte y no entra. Contraste: §9.2 del documento de contraste.

**Decisión técnica del orquestador general (2026-11-16; corregible por el dueño): reutilizar la cabecera de `NotaCreditoProveedor`** (factura asociada con FK de tres columnas «misma factura y proveedor», número único entre vigentes, `claveIdempotencia`, anulación) en vez de la columna `comprobante_asociado_id` de Pedernal: mismo resultado, otra forma, declarada. **A verificar al implementar:** que la cabecera se cargue **sin líneas, sin imputaciones y sin tributos** (la nota de Pedernal no tiene líneas) y que el tope se imponga sin tocar los CHECK de las tablas; si no se puede, se declara y se pregunta.

**Reglas (iguales a 0085):** N1 la nota **siempre** lleva factura asociada (la nota `SUELTA` que traen las tablas queda **sin usar**); N2 al cargar se **bloquea la factura** (`FOR UPDATE`) y se comprueba: es factura, está vigente, es **del mismo proveedor**, y **lo acreditado vigente + el importe de esta nota ≤ total de la factura** (las notas anuladas no cuentan; dos notas a la vez se serializan por el bloqueo); N3 una factura con notas vigentes **no se anula** (ya existe `CON_NOTAS_DE_CREDITO`); la nota **no tiene saldo, no reduce lo que se paga y no toca stock**. **Fuera de esta etapa (no están en Pedernal):** pedido de nota (`PedidoDeNotaDeCredito`), saldo a favor, aplicación y reintegro. **IVA/crédito fiscal de la nota: NO VERIFICADO** (0085 no lo menciona); queda en 0 como informa Pedernal, sin construir lógica propia hasta ver la regla real.

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma clave → misma nota; misma nota (proveedor+tipo+número) con otra clave → `NOTA_DUPLICADA`. |
| Concurrencia | dos notas que juntas pasan el total: bajo el candado de la factura gana una; anular la factura y cargar una nota a la vez: el candado deja la nota solo si la factura sigue vigente. |
| Tiempo | fecha de la nota ≤ hoy; anular la factura con nota vigente: rechazado. |
| Incertidumbre | reintento por clave devuelve el mensaje guardado. |
| Error parcial | nota + auditoría atómicas. |
| Datos faltantes | sin factura asociada: rechazo; importe ≤ 0: rechazo. |
| Cambio de permisos | cargar y anular: quien tiene permiso de compras (supuesto, NO VERIFICADO en Pedernal); aplicar saldo: no existe. |

**Dimensiones del oráculo:** factura (vigente / anulada / de otro proveedor) × importe (< / = / > tope) × nota (vigente / anulada / duplicada) × rol; pago de la factura **no cambia** (se prueba que no cambia).

## Etapa DEV — devolución de mercadería al proveedor (reescrita 2026-11-17 según 0084)

**Necesidad:** «sale mercadería del stock hacia el proveedor; no mueve dinero, no crea nota, no toca la factura» (`e9-n4` §1; 0084, decisión del dueño de Pedernal 15/11). Forma: Pedernal `0084_compras_devoluciones.sql` (pendiente). Contraste: §9.1. Decisiones del orquestador general (2026-11-17, por «iguales a Pedernal en todo», corregibles por el dueño): motivo de la lista `MOTIVOS_DE_RECHAZO` **completa**; remito de devolución con número y fecha; sin guarda «compra con devolución no se anula», sin `diferenciaId` y sin pedido de nota (no están en Pedernal).

**Modelo (PROPUESTA):** Motor2 **ya tiene** el proceso de stock `DEVOLUCION_PROVEEDOR` (permiso `proceso_devolucion_proveedor`): no se crea otra salida. Se agregan:
- `DevolucionAProveedor`: `numero` consecutivo por empresa (candado por empresa), sucursal, proveedor, `motivoId` (lista `MOTIVOS_DE_RECHAZO`, **sin texto libre**), `remitoDeDevolucionNumero` y `remitoDeDevolucionFecha` (opcionales, **juntos o ninguno**; el detalle va en el remito), `claveIdempotencia`+`payloadHash` únicos por empresa, `hechoEn`, `fechaNegocio` (jornada de la sucursal), `estado` ∈ {`CONFIRMADA`,`ANULADA`}, quién y cuándo, anulación con quién, cuándo y motivo (≤ 500; los tres juntos con el estado), `version`. Solo inserción salvo CONFIRMADA → ANULADA; nada se borra.
- `LineaDeDevolucion`: depósito, artículo, cantidad > 0, origen **opcional** por línea (recepción + renglón de recepción, juntos o ninguno), y el renglón del movimiento de stock de la salida (una salida por devolución). **Una línea por (depósito, artículo)** y devolución.
- **Lista de motivos: Motor2 no tiene el mecanismo `valor_de_lista`** (NO VERIFICADO que exista con otro nombre: no lo encontré). Lo mínimo para igualar: una lista sembrada **administrada por la plataforma** con los motivos de Pedernal (`Temperatura`, `Envase dañado`, `Vencida`, `No es lo pedido` — SUPUESTO del ingeniero de Pedernal, **sin confirmación del dueño registrada**; se adopta completa como pidió el orquestador), activos al devolver y conservados en lo ya devuelto si después se desactivan. Dónde vive en Motor2 (tabla global de solo inserción, consola de plataforma) **se decide al diseñar el nivel 6**; no se migra antes.
- **Reglas (0084):** con origen, la recepción debe estar **confirmada**, ser **del mismo proveedor** y la línea recibida **del mismo producto** que el artículo devuelto; **tope**: lo devuelto vigente (devoluciones CONFIRMADAS) de una línea recibida **no supera lo recibido**, bajo el candado de la línea (dos devoluciones simultáneas de la misma línea se serializan; una anulada deja de contar). Sin origen: solo rige el stock disponible. Salir de **cuarentena y rechazo**: única excepción a la validación de depósito **cuando ese depósito exista** (0064, etapa propia, no construida: hoy lo rechazado entra a un depósito común por decisión del dueño 16/11) — NO VERIFICADO mientras tanto.

| ¿Qué pasa si…? | Resultado |
|---|---|
| Repetición | misma clave y mismo contenido → la misma devolución, una sola salida de stock; misma clave con otro contenido → rechazo. |
| Concurrencia | dos devoluciones de la misma línea recibida: se serializan, la segunda ve a la primera y el tope decide; devolver y anular a la vez: cerrojo de la devolución; stock: la base impide pasar de cero. |
| Tiempo | el número consecutivo y la fecha de negocio los fija el servidor (jornada de la sucursal). |
| Error parcial | devolución + líneas + salida de stock atómicas. |
| Datos faltantes | motivo fuera de la lista o desactivado: rechazo; cantidad ≤ 0: rechazo; remito con solo número o solo fecha: rechazo. |
| Cambio de permisos | **CONFIRMADA (cambia lo de hoy):** «Solo gerente y administrador (Recomendada)» (2026-11-16). Hoy `proceso_devolucion_proveedor` es piso operario; pasa a piso administrador. El operador deja de ver/usar devolver al proveedor (el servidor la rechaza con «Esta acción no está permitida»); sus devoluciones hechas siguen visibles. Regenera matrices/goldens de permisos con ese motivo; pruebas de denegación del operador y aceptación de gerente/administrador. |
| Anulación | solo CONFIRMADA → ANULADA con motivo; el efecto en el stock es **otra salida/entrada de anulación, nunca un borrado** (NO VERIFICADO cómo lo hace 0084: la anulación del movimiento vive en la aplicación). |

**Dimensiones del oráculo:** origen (con/sin) × recepción (confirmada / no) × proveedor (mismo/otro) × producto (mismo/otro) × cantidad (< / = / > recibido) × motivo (activo / desactivado / fuera de lista) × estado × rol.

## Etapa CORR — corrección de compra ampliada (nueva, 2026-11-17, según 0060)

**Pedido del dueño:** 2026-11-17, «Sí, como Pedernal, después de las tres vías (Recomendada)» (fuente: mensaje del orquestador general; registro en `motor2-docs`). **Etapa propia DESPUÉS de 3V. NO se construye ahora y no se diseña el nivel 6 todavía.** Esta sección solo declara lo que hay que diseñar con la escalera de 10 niveles antes de tocar tablas.

**Qué pide Pedernal (0060, decisión de su dueño 15/11 «Respuestas 24 a 27», Q2 = C):** la corrección de una compra puede cambiar **precio, cantidad o peso real** de una línea y **completar el precio** de una línea «Sin precio»; sigue siendo **una fila nueva** (la línea original no se edita); el «precio por» (presentación o unidad, con su unidad) solo se guarda al completar un «Sin precio»; el peso real viaja de a pares (anterior y nuevo, > 0); toda corrección cambia al menos precio, cantidad o peso. La base de 0036/0037 (`correccion_de_compra`) **no la leí**: NO VERIFICADO.

**Lo que Motor2 tiene hoy:** `corregir_compra` (piso administrador) corrige proveedor, N.º y detalle de la FACTURA, «sin tocar renglones, partes ni Kardex». Cambiar cantidad o peso **reescribe stock y costo**; completar un precio cambia el costo y los reportes. Por eso necesita su diseño completo: invariantes de costo y stock (¿se re-valúa el kardex hacia atrás o con un movimiento de ajuste?), interacción con partes ya recibidas, con notas de crédito y devoluciones vigentes y con diferencias de tres vías ya resueltas, concurrencia contra anulación y recepción, permisos (¿`corregir_compra` basta?), y la tabla «¿qué pasa si…?». Preguntas a resolver en ese diseño: si Motor2 admite líneas «Sin precio» (NO VERIFICADO), y qué hace la corrección con un movimiento de stock ya consumido.

## Orden de construcción y reparto de subagentes

N3-b → OC → 3V → NC → DEV → CORR (corrección ampliada, después de 3V; su diseño completo antes de construir), **un PR por etapa**, cada una en su rama sobre la anterior (máximo 2 subagentes Sonnet a la vez; cada uno corre el gate local sin e2e/build). Mientras N3-a no esté commiteada no se arranca código de N3-b. Las migraciones de cada etapa solo agregan; ninguna se aplica.

## Respuestas del dueño (2026-11-16, literales, `motor2-docs` «Compras: tres preguntas del frente 5»)

- Diferencias de tres vías: «Solo gerente y administrador (Recomendada)» — CONFIRMADA.
- Devolución al proveedor: «Solo gerente y administrador (Recomendada)» — CONFIRMADA; **cambia el permiso y el comportamiento de hoy** (ver etapa DEV).
- Facturas repartidas entre sucursales: «Más adelante (Recomendada)» — CONFIRMADA: N3-a2 **diferida**, no se construye ahora.
- Reutilizar `NotaCreditoProveedor*`: decisión técnica del orquestador general (corregible por el dueño).

## Respuestas del dueño (2026-11-17)

- Resoluciones de diferencia: «Las 7, como el SQL de Pedernal (Recomendada)» — CONFIRMADA.
- Corrección de compra ampliada: «Sí, como Pedernal, después de las tres vías (Recomendada)» — CONFIRMADA (etapa CORR).
- Decisiones del orquestador general (declaradas, el dueño corrige): motivo de devolución = lista `MOTIVOS_DE_RECHAZO` completa; remito con número y fecha; sin guarda de compra con devolución, sin `diferenciaId`, sin pedido de nota; IVA de la nota NO VERIFICADO.

## Preguntas abiertas al dueño

- Los cuatro motivos de rechazo de Pedernal (Temperatura, Envase dañado, Vencida, No es lo pedido) son un SUPUESTO de su ingeniero sin confirmación del dueño: ¿son los de Motor2?
- Lista de motivos: Motor2 no tiene el mecanismo; dónde vive se decide en el nivel 6 de la etapa DEV.
- Notas y saldo a favor: Pedernal decidió que la nota «siempre pasa por saldo a favor»; Motor2 no arranca el saldo hasta que Pedernal lo construya o el dueño lo pida (NO VERIFICADO el libro de saldos). Se pregunta cuando toque.

## Riesgos y NO VERIFICADO

SQL real de 0063/0064/0065 de Pedernal; `primitiva-de-libro-diseno.md`; si Pedernal usa esos nombres de acciones; destino de lo rechazado (cuarentena/rechazo, 0064); que las 4 tablas de notas toleren el tope sin migración; permisos reales de N4 en Pedernal (la matriz de E9 es propuesta).
