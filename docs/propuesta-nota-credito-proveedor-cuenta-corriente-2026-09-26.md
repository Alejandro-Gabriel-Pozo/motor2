# Propuesta: nota de crédito de proveedor y cuenta corriente (grounding contra Odoo, continuación de K1d)

- **Fecha:** 2026-09-26
- **motor2:** HEAD `f287b39` (rama de trabajo actual, árbol limpio al leer).
- **Odoo:** rama `20.0`, HEAD `9b1a92e` (2026-09-26). Clon parcial en `/tmp/claude-0/-home-user-motor2/eb147dc5-ab8d-5238-add2-03d4e5b42131/scratchpad/ref_repos/odoo`, con `addons/account`, `addons/purchase`, `addons/point_of_sale` y `addons/account_edi` materializados.
- **Qué es este documento:** la **tercera referencia** (después de ERPNext y Dolibarr) para el hilo K1 de compras. Es una **propuesta, no un plan**: no trae diffs, ni pasos de ejecución, ni verificación e2e. No reinicia el análisis. Da por leídos, y no repite:
  - `docs/grounding-compras-correccion-y-notas-de-credito-2026-09-19.md` (en adelante **G19**): el problema, las fases K1a a K1d, las opciones A y B de §5.1, las 7 decisiones de §7 y el «fuera de alcance» de §6;
  - `docs/grounding-decisiones-abiertas-erpnext-dolibarr-2026-09-21.md` §3.6 (en adelante **G21**): el mapeo de esas 7 decisiones contra ERPNext y Dolibarr;
  - `docs/planes-implementacion-pendientes-2026-09-21.md` §5 (en adelante **P21**): el plan de K1b y K1c, ya implementado;
  - `docs/propuesta-pos-incrementales-sin-cambio-arquitectura-2026-09-26.md` (en adelante **POS26**): el método de grounding contra POSR y la propuesta de caja y turno.

Todas las citas `archivo:línea` de este documento las leí yo en las dos ramas indicadas arriba. Las rutas de Odoo son relativas a la raíz del clon. Donde algo es inferencia y no lectura, lo digo.

---

## Parte 1 — Método de grounding usado contra Odoo

### 1.0 Principio

Sigue valiendo el orden de confianza de POS26 §1.0: schema y migraciones; después, el dominio con tests; después, el resto del código; después, la UI; y al final, sin valor de prueba, el README y la documentación. En Odoo el «schema» es la **clase ORM**: no hay un archivo de migración por campo como en Prisma o en SurrealDB. Esta parte explica qué cambia por eso y qué trampas propias tiene un monorepo como Odoo.

### 1.1 Clon parcial: blobless, sparse y superficial

**Por qué.** `addons/` de Odoo 20.0 tiene **642 directorios**. Lo conté con `git ls-tree -d HEAD addons/ | wc -l`, que solo lee árboles y no baja contenido. Para este tema hacen falta 3 o 4. Los cuatro materializados ocupan en disco unos 106 MB (`account` 60 MB, `point_of_sale` 35 MB, `purchase` 10 MB, `account_edi` 1,2 MB). El `.git` del clon quedó en unos 23 MB.

**Cómo se reproduce.** Esto es lo que muestra la configuración del clon: `remote.origin.partialclonefilter = blob:none`, `core.sparseCheckoutCone = true`, `git rev-parse --is-shallow-repository` devuelve `true` y hay un solo commit visible.

```
git clone --filter=blob:none --sparse --depth 1 --branch 20.0 https://github.com/odoo/odoo.git
git -C odoo sparse-checkout set addons/account addons/purchase addons/point_of_sale addons/account_edi
```

(El comando exacto con el que se creó el clon no quedó registrado. Esta es la reconstrucción a partir de esa configuración.)

**Trampa real de esta sesión: la descarga perezosa.** En un clon `blob:none`, todo comando que necesite el **contenido o el tamaño** de un blob fuera del cono lo baja de la red en silencio. Entran ahí `git ls-tree -l`, `git show HEAD:addons/product/...`, `git grep <rev>` y `git log -p`. Al preparar este documento corrí `git ls-tree -r -l HEAD addons` para sumar tamaños. Empezó a bajar blobs: el `.git` pasó de unos 23 a 25 MB, con decenas de mensajes «Auto packing the repository», antes de que lo cortara. No tocó el árbol de trabajo (`git status` limpio), pero dejó de ser una operación de solo lectura. Reglas:

- Para medir o listar se usa `git ls-tree -d` (solo árboles) o `du` sobre lo ya materializado. Nunca `-l`.
- Si un addon fuera del cono hace falta, se lo agrega **a propósito** con `sparse-checkout add`. No se lo «espía» con `git show`.

**Addons relevantes que quedaron fuera del cono.** Existen en el árbol (verificado con `ls-tree -d`) pero **no se leyeron**: `stock`, `stock_account`, `purchase_stock`, `account_payment` y `product`. Todo lo que dependa de ellos queda como no verificado (§Limitaciones).

### 1.2 El modelo ORM es la fuente de verdad, y hay que leerlo entero

**Qué se lee.** Las clases de `models/*.py` con `_name` (crea el modelo) o `_inherit` (lo extiende), y sus campos `fields.X(...)`. De cada campo importan:
- `compute=` (se calcula);
- `store=` (se guarda o no en la base);
- `related=` (es un atajo a otro campo).

**Qué no se usa como fuente.** El manual online y las vistas XML describen la UI. Una vista puede mostrar como solo lectura algo que el ORM permite escribir, y al revés.

**El antecedente de esta sesión viene de otro repo.** En el grounding contra POSR, el archivo de «modelo» `src/api/model/day_closing.ts:8` declaraba `cash_withdraw`. En cambio, la migración vigente (`migrations/latest.surql:396`) y la pantalla usan `cash_withdrawn` (POS26 §1.2 y §1.5, punto 3). Si la cita se hubiera tomado del archivo con nombre de «model», habría quedado mal: **manda la migración o el schema**.

**Las trampas equivalentes en Odoo.** No son archivos desactualizados. Son estas:

1. **Un campo puede no estar en el addon que uno espera.** `_inherit` reparte un mismo modelo en muchos addons. El vínculo línea de factura ↔ línea de pedido de compra (`purchase_line_id`) no está en `account`: lo agrega `purchase/models/account_invoice.py:662` sobre `account.move.line`. Si se busca solo en `account`, «no existe».
2. **Un campo `compute` sin `store` no está en la base.** El saldo con el proveedor (`res.partner.debit`) se calcula con SQL cada vez que se lee (`account/models/partner.py:391-437`). Una lectura del esquema de tablas no lo encontraría.
3. **El ORM puede permitir algo que la UI no muestra.** `write()` bloquea en un documento confirmado una lista cerrada de campos (`account/models/account_move.py:3992-3999`: `line_ids`, `invoice_line_ids`, `date`, `invoice_date`, `partner_id`, `fiscal_position_id`, `invoice_payment_term_id`, `currency_id`, `invoice_cash_rounding_id`). `ref`, la referencia del documento del proveedor, **no** está en esa lista. No verifiqué si la vista XML lo deja editable.

### 1.3 «Un solo modelo con un campo de tipo»: cómo se confirma que es real

`account.move` (`account/models/account_move.py:81-84`) representa asientos, facturas de cliente, notas de crédito de cliente, facturas de proveedor y notas de crédito de proveedor. Lo distingue `move_type` (`:152-168`: `entry`, `out_invoice`, `out_refund`, `in_invoice`, `in_refund`, `out_receipt`, `in_receipt`). Un campo así puede ser decorativo. Para confirmar que no lo es, se buscan cuatro señales:

1. **Hay un mapa de reversión y se usa.** `TYPE_REVERSE_MAP` (`:67-75`) mapea `in_invoice → in_refund` y viceversa. `_reverse_moves()` lo consulta al crear el espejo (`:5893`).
2. **El tipo condiciona comportamiento.**
   - `_update_standard_price()` solo actúa sobre `in_invoice` (`:6112-6113`).
   - En `purchase`, `_prepare_qty_invoiced()` suma los `in_invoice` y **resta** los `in_refund` (`purchase/models/purchase_order_line.py:267-270`).
   - `_compute_payment_state()` devuelve `reversed` solo si la contrapartida conciliada es del tipo inverso (`account_move.py:1340-1351`).
3. **El tipo está protegido.** `action_switch_move_type()` solo cambia el tipo de un borrador (`:6673-6677`).
4. **Hay tests por tipo.** `account/tests/` tiene un archivo por variante: `test_account_move_in_invoice.py`, `test_account_move_in_refund.py`, `test_account_move_out_invoice.py` y `test_account_move_out_refund.py`. `test_in_invoice_create_refund` (`test_account_move_in_invoice.py:1029`) crea la NC desde una factura de proveedor y verifica el estado de pago resultante.

El mismo patrón se repite para los pagos. `account.payment` (`account/models/account_payment.py:8`) es un solo modelo para cobrar y para pagar, con `payment_type` (`inbound`/`outbound`, `:122-125`) y `partner_type` (`customer`/`supplier`, `:126-129`). Esto importa en §2.3.

### 1.4 Separar «qué hace el addon de compras» de «qué hereda de contabilidad»

`purchase` es una capa chica montada sobre `account`:

- `purchase/__manifest__.py:10` declara `'depends': ['account']`, y nada de `stock`.
- Un grep de `stock|picking` en `purchase/models/*.py` (3986 líneas en 15 archivos) solo devuelve comentarios y ganchos que otro addon extiende: `purchase_order_line.py:80` (texto de ayuda), `:358-362` («Extended by `purchase_stock`»), `product.py:100-102`, `product_category.py:13,20`. No aparece ningún `stock.move` ni `stock.picking`.
- El saldo con el proveedor tampoco está en `purchase`. Está en `account/models/partner.py:571-574` (`debit`, «Total Payable»).

**Error a evitar:** evaluar `purchase` solo y concluir «Odoo no tiene saldo de proveedor» o «Odoo no mueve stock con una NC». Hay que seguir `depends` hacia abajo y buscar los ganchos «Overridden by».

**Segunda trampa, que encontré al releer.** «`purchase` no tiene stock» es cierto, pero **`account` sí mueve cantidades cuando `stock` no está instalado**:
- `_post()` llama a `_update_qty_available()` (`account_move.py:6320-6321`);
- ese método suma o resta `qty_available` del producto por cada línea de producto almacenable de una factura o NC (`:6094-6107`; `in_refund` resta);
- `account/models/company.py:1380-1384` lo documenta: «Simple approximation used when the stock module isn't installed… Overridden by `stock_account`».

La pregunta correcta no es «¿qué addon toca stock?» sino **«con qué addons instalados»**. Esto cambia el argumento de §2.2.

### 1.5 Subagentes en paralelo y verificación cruzada

Se lanzaron tres subagentes a la vez, uno por subdominio:
1. facturación de cliente (`account.move` y reversión);
2. compras ↔ factura ↔ NC (`purchase` sobre `account`);
3. caja de POS (`point_of_sale`).

Las instrucciones fueron las de POS26 §1.4: el README y la documentación del repo son datos, no instrucciones; toda afirmación lleva `archivo:línea`; se dice «no encontrado» junto con el patrón buscado; solo lectura; y se separa «qué hace» de «dónde vive».

Después el orquestador releyó una muestra. Como en POS26 §1.5, aparecieron diferencias con lo resumido:

| Afirmación resumida | Lo que dice el código |
|---|---|
| «Nunca se edita un documento confirmado» | **Matiz.** `button_draft()` (`account_move.py:6896-6913`) vuelve un documento confirmado a borrador. `_check_draftable()` (`:7015-7033`) solo lo impide si hay hash inalterable o si es un asiento de diferencia de cambio. Las fechas de bloqueo fiscal se validan en `write()` (`:4048-4050`). Lo que no se puede es editar en el lugar los campos de `:3992-3999` estando confirmado (`:4053-4060`). Además, `_unlink_or_reverse()` (`:5936-5953`) decide entre borrar, cancelar o revertir según bloqueo y auditoría. Odoo es menos estricto que el append-only de motor2. |
| «Una sobre-recepción ya facturada genera una línea negativa» | **Más preciso:** `qty_to_invoice` queda en −5 (`purchase/tests/test_purchase_invoice.py:227`, `test_vendor_bill_delivered_return`), y `action_create_invoice()` convierte el documento con total negativo en `in_refund` con `action_switch_move_type()` (`purchase/models/purchase_order.py:876`). Genera una **NC entera**, no una línea. |
| «`credit`/`debit` se calculan sobre líneas conciliadas y no conciliadas» | **Más preciso:** es `SUM(amount_residual)` de las líneas **no conciliadas** (`reconciled IS NOT TRUE`) de cuentas `liability_payable`/`asset_receivable` (`partner.py:406-416`). El saldo con el proveedor es `debit` («Total Payable», `:571-574`), no `credit` (que es «Total Receivable», `:550-552`). |
| «`purchase` no toca stock» | Cierto, pero `account` sí toca `qty_available` sin `stock` (§1.4). |
| (implícito) «Hay tope por línea como en ERPNext» | **No hay bloqueo.** `_compute_purchase_matching_issue_msg()` (`purchase/models/account_invoice.py:702-728`) solo arma un aviso (⚠ cantidad esperada, ⬆⬇ precio). No se encontró un `raise` por exceso en ese archivo (grep de `raise ` en `account_invoice.py`). |
| (implícito) «La NC queda abierta hasta que alguien la aplica» | **Depende.** Al confirmar una NC con `reversed_entry_id` hacia una factura confirmada, `_post()` la **concilia sola contra esa factura** (`account_move.py:6275-6283` y `:6339-6356`). Si se crea con «Reembolso» (`refund_moves`), queda en borrador y la factura sigue `not_paid` (`test_account_move_in_invoice.py:1043-1046`). Con «Modificar» (`modify_moves`), la factura pasa a `reversed` y se crea una copia en borrador para recargarla (`:1100-1103`). |

### 1.6 Índice: dónde encontrar las cosas en Odoo para este tema

| Archivo | Qué mirar |
|---|---|
| `addons/account/models/account_move.py` | `PAYMENT_STATE_SELECTION` (`:51-59`, incluye `partial` y `reversed`); `TYPE_REVERSE_MAP` (`:67-75`); `state` (`:138-148`); `move_type` (`:152-168`); `ref` (`:126`); `payment_state` (`:619`); `reversed_entry_id` y `reversal_move_ids` (`:653-661`); `_compute_payment_state` (`:1266-1360`); `_fetch_duplicate_reference` (`:2182`, factura repetida solo entre `draft`/`posted`); `write()` y campos inmodificables (`:3986-4060`); `_reverse_moves` (`:5879-5917`); `_unlink_or_reverse` (`:5936-5953`); `_update_qty_available` y `_update_standard_price` (`:6094-6120`); `_post` (`:6122`, permiso en `:6137`, conciliación automática de la reversión en `:6275-6283` y `:6339-6356`); `action_switch_move_type` (`:6673`); `action_reverse` (`:6802`); `js_assign_outstanding_line` (`:6872-6881`, aplicar a mano un crédito pendiente); `button_draft` (`:6896`); `_check_draftable` (`:7015`) |
| `addons/account/wizard/account_move_reversal.py` | `reason` (`:18`); `reverse_moves` (`:115-188`); `refund_moves` y `modify_moves` (`:190-194`); cuándo se concilia la reversión (`is_cancel_needed`, `:133`) |
| `addons/account/models/account_move_line.py` | `amount_residual`, `reconciled`, `full_reconcile_id`, `matched_debit_ids` y `matched_credit_ids` (`:280-306`); orden de la conciliación por vencimiento o fecha (`:3025-3038`); `reconcile` (`:3470-3472`); `remove_move_reconcile` (`:3474-3478`, **borra** los parciales) |
| `addons/account/models/account_partial_reconcile.py` | `debit_move_id`, `credit_move_id` y `full_reconcile_id` (`:17-25`); `amount` (`:50`); `max_date` (`:66`, para el reporte de antigüedad) |
| `addons/account/models/account_full_reconcile.py` | `partial_reconcile_ids` y `reconciled_line_ids` (`:11-12`) |
| `addons/account/models/partner.py` | `_credit_debit_get` (`:391-437`); `credit` (`:550`); `debit` (`:571`) |
| `addons/account/models/account_payment.py` | `move_id` (`:18`); `journal_id` (`:24`); `payment_method_line_id` (`:96`); `amount` (`:121`); `payment_type` y `partner_type` (`:122-129`); `invoice_ids` y `reconciled_bill_ids` (`:174-195`) |
| `addons/account/wizard/account_payment_register.py` | `group_payment` (`:25`); `payment_difference_handling` (`:145-147`: dejar abierta o marcar como saldada) |
| `addons/account/models/company.py` | `get_inventory_value` (`:1377-1417`), el modo «sin stock» |
| `addons/purchase/models/purchase_order_line.py` | `invoice_lines` (`:71`); `qty_invoiced` (`:75`); `qty_received` (`:81`); `qty_to_invoice` (`:83`); `_compute_qty_invoiced` (`:211-223`); `_prepare_qty_invoiced` (`:261-271`) |
| `addons/purchase/models/purchase_bill_line_match.py` | vista SQL `_auto = False` (`:10-12`); `_select_am_line` (`:127-153`, incluye `in_refund`); `_action_create_bill_from_po_lines` (`:170-184`); `action_match_lines` (`:186-223`); `action_unmatch_lines` (`:225`) |
| `addons/purchase/models/account_invoice.py` | `purchase_line_id` sobre `account.move.line` (`:662`); se copia al revertir (`:667-670`); aviso de desajuste (`:702-728`) |
| `addons/purchase/models/purchase_order.py` | `action_create_invoice` (`:820`); pasaje a `in_refund` si el total es negativo (`:876`) |
| `addons/purchase/tests/test_purchase_invoice.py` | `test_vendor_bill_delivered_return` (`:227`); `test_po_matching_credit_note` (`:1351`: NC suelta, vinculada después) |
| `addons/account/tests/test_account_move_in_invoice.py` | `test_in_invoice_create_refund` (`:1029`; «Reembolso» en `:1043-1046`, «Modificar» en `:1100-1103`) |
| `addons/point_of_sale/models/pos_session.py`, `pos_payment.py` | `opening_balance`, `closing_balance` y `closing_difference` (`pos_session.py:76-85`); `_validate_session_accounting` (`:943`); `payment_method_id` y `account_move_id` (`pos_payment.py:40,58`). POS depende de `account` (`__manifest__.py:12`) |

---

## Parte 2 — Propuesta (no plan): nota de crédito de proveedor (K1d) y cuenta corriente

**Esto no es un cambio de arquitectura.** motor2 sigue siendo Postgres + Prisma + Server Actions, con el Kardex append-only como libro de stock. No se mueve nada a un esquema «cliente primero» y **no se propone un libro contable de partida doble**. Odoo se usa para calibrar qué piezas mínimas hacen falta, no como modelo a copiar.

### 2.1 Qué ya está resuelto y qué sigue abierto

**K1a, listado de compras: implementado.**
- `listarComprasRegistradas` (`src/core/reportes/compras-registradas.ts:75`) lista una fila por `Operacion` `COMPRA`, con filtros y cursor.
- La página es `src/app/(app)/reportes/compras/page.tsx:19`. Marca las anuladas y las excluye del total de la página (`:55-58`).
- Su docstring todavía dice que «anular es otra fase» (`compras-registradas.ts:9-10`). Quedó desactualizado; es menor.

**K1c, anular una compra: implementado.**
- Reglas puras en `src/core/compras/anulacion.ts`: `evaluarAnulacion` (`:87-114`) bloquea con `STOCK_CONSUMIDO` comparando por bucket (producto, sección, lote) (`:94-111`); `construirReversion` (`:117-127`) niega cantidad y precio.
- Orquestación en `anularCompra` (`src/server/actions/movimientos/compras.ts:48-139`):
  - permiso `anular_compra` (`:49`);
  - `Operacion` `AJUSTE` de reversión (`:95-105`);
  - líneas inversas (`:107-118`);
  - marca `anuladaEn`/`anuladaPorId` (`:120`);
  - auditoría (`:122-131`).
- Migraciones `20260921230000_factura_unica_vigente` y `20260921230200_permiso_anular_compra`.
- Un guardián de arquitectura exige que los reportes filtren las compras anuladas (`test/arquitectura/reportes-compras-anuladas.test.ts`).

**K1b, corregir la cabecera: implementado.**
- `src/core/compras/correccion.ts:6-10` fija el alcance: solo proveedor, N.º de factura y detalle libre; nunca precios ni cantidades.
- `corregirCompra` (`compras.ts:175-239`) usa el permiso `corregir_compra` (`:176`), una guarda optimista (`:192`), el chequeo de factura repetida excluyendo anuladas (`:205-212`) y una fila de auditoría por campo (`:217-229`).
- Migración `20260921232000_permiso_corregir_compra`.

**K1d, nota de crédito de proveedor: sin implementar.**
- Un grep de `NotaCredito|nota_credito|notaDeCredito|NotaCreditoProveedor|pagoProveedor|PagoProveedor` en todo el repo (excluyendo `docs/` y `node_modules/`) no devuelve nada.
- `Operacion` (`prisma/schema.prisma:828-927`) no tiene «operación de origen».
- La reversión de `anularCompra` se vincula a la compra **solo por texto**: `detalleReversionDeCompra` arma un prefijo en `detalleLibre` (`src/core/movimientos/anulaciones.ts:23-25`) y los reportes la filtran con `LIKE` (`:31`).

**Devolución a proveedor: sigue suelta.**
- `DEVOLUCION_PROVEEDOR` (`src/core/movimientos/transiciones.ts:87`) es stock puro (`signoStock: -1`, `requiereStockReal: true`), con su propio permiso (`:168`).
- Acepta un `precioTotal` porque es un proceso «tipo compra» (`src/server/actions/movimientos/movimientos.ts:155-165`).
- Pero el reporte la valúa al costo de reposición **de hoy** (`src/core/reportes/devoluciones.ts:58`). Es el hallazgo 2 de G21 §4 y sigue igual.

**Cuenta corriente: no existe para proveedores de compra normal.**
- `Proveedor` (`schema.prisma:485-503`) tiene `condicionesPago String?` (`:495`), texto libre que solo se muestra en la ficha (`src/app/(app)/catalogo/proveedores/[id]/page.tsx:86`). No hay vencimientos en `Operacion`.
- Un grep de `(?i)medio.?de.?pago|efectivo|caja|turno|saldo.*proveedor|cuenta.?corriente|NotaCredito|nota.?de.?cr[eé]dito|pago` en `prisma/schema.prisma` devuelve solo `PagoConsignante` (`:39, :127, :502, :505-525`), `condicionesPago` (`:495`) y un comentario sobre «rendimientoEfectivo» (`:1127`).
- `Cuenta` (`:1644`) es la cuenta de una **mesa** del POS, no una cuenta corriente.

**El único precedente de saldo con un proveedor es consignación.**
- El docstring de `PagoConsignante` (`schema.prisma:505-510`) dice que es append-only y que el reporte resta `SUM(pagos)` de `SUM(liquidaciones)` por proveedor.
- El cálculo está en `generarReporteConsignacion` (`src/core/reportes/consignacion.ts:62-100`; `importe = liquidado − pagado` en `:99`).
- El alta está en `registrarPagoConsignante` (`src/server/actions/reportes/consignacion.ts:16-29`), con la clave `pagar_consignante` (`src/core/permisos/acciones.ts:86`), solo admin.

**Las 7 decisiones de G19 §7, con la columna Odoo.** El estado de motor2 sale de P21 §5 (encabezado de estado y «Decisiones que siguen siendo del negocio»).

| # | Decisión (G19 §7) | Estado hoy | ERPNext / Dolibarr (G21 §3.6) | Qué aporta Odoo | Veredicto |
|---|---|---|---|---|---|
| 1 | NC vinculada o suelta | Rec.: vinculada por defecto, suelta como excepción | ERPNext: `return_against`. Dolibarr: suelta con `INVOICE_CREDIT_NOTE_STANDALONE` | Las dos existen. La vinculada lleva `reversed_entry_id` (`account_move.py:5894`) y al confirmarse se concilia sola contra la original (`:6275-6283`, `:6339-6356`). La suelta se crea como `in_refund` directo y **se vincula después** a la línea de pedido (`test_po_matching_credit_note`, `test_purchase_invoice.py:1351`; `action_match_lines`, `purchase_bill_line_match.py:186`). El vínculo tiene **dos niveles**: documento (`reversed_entry_id`) y línea (`purchase_line_id`, que se copia al revertir: `account_invoice.py:667-670`). | **Refuerza**, y agrega «suelta con vinculación posterior» como tercera variante |
| 2 | ¿La bonificación cambia el costo de reposición? | Abierta; solo bloquea K1d | ERPNext: devolución al `incoming_rate` original; ajuste de precio sin dato. Dolibarr: no verificado | Dato **parcial**: sin `stock` instalado, `_update_standard_price` solo actúa sobre `in_invoice` (`account_move.py:6112-6113`), así que una NC de proveedor **no** cambia el costo promedio. Con `stock_account` no se verificó (fuera del cono). | **Matiza** (un solo modo, no decide) |
| 3 | Gasto neto de NC | Rec.: neto, con el bruto visible | Ambos restan la NC del saldo sin tocar la original | `qty_invoiced` = facturado − NC (`purchase_order_line.py:267-270`). La original no se toca; su `payment_state` pasa a `partial`/`reversed` (`account_move.py:1340-1355`). El bruto se puede recuperar porque los dos documentos existen. | **Refuerza** |
| 4 | Campos corregibles | **Resuelta**: V4, solo cabecera (`correccion.ts:6-10`) | ERPNext: no proveedor, importes ni `bill_no`. Dolibarr: no se edita | Con el documento confirmado, `partner_id`, fechas y líneas son inmodificables (`:3992-3999`), pero `ref` **no** (§1.2). Hay escape por `button_draft` (`:6896`). La K1b de motor2 coincide con Odoo en el N.º de factura y es **más laxa en el proveedor**. | **Matiza** una decisión ya tomada; no la reabre |
| 5 | Anular con stock consumido | **Resuelta**: bloquear (`anulacion.ts:102-111`) | ERPNext: `NegativeStockError` | Nada verificable: la guarda de stock vive en `stock`, fuera del cono. `modify_moves` (`account_move_reversal.py:193-194`) es el equivalente a «anular y recargar» del lado del dinero. | **No aporta** |
| 6 | Permisos | **Resuelta**: `anular_compra`, `corregir_compra` (`acciones.ts:77-79`) | No verificado | Solo que confirmar exige el grupo `account.group_account_invoice` (`account_move.py:6136-6137`) | **No aporta** |
| 7 | Por dónde empezar | **Resuelta**: K1a → K1c → K1b, hechas | — | — | **No aplica** |

### 2.2 K1d a la luz de Odoo

**La comparación correcta.** La pregunta no es «un modelo o una tabla nueva». Es **«¿el dinero vive separado del stock?»**.

**Con `stock` instalado, Odoo separa.** `purchase` no tiene código de stock (§1.4). La devolución física es un movimiento de `stock`/`purchase_stock` y la NC es un `account.move`. La Opción B de G19 §5.1 hace lo mismo en motor2: tabla propia de NC y, **solo si hay devolución física**, una `DEVOLUCION_PROVEEDOR` vinculada en el Kardex.

**El modo sin stock de Odoo muestra el riesgo de acoplar.** Sin `stock`, la NC mueve cantidades por sí misma: `_update_qty_available` resta `qty_available` por cada línea de producto almacenable de un `in_refund` (`account_move.py:6094-6107`). No distingue una devolución física de una bonificación de precio.

*Inferencia de la lectura, sin test que lo confirme:* una NC por diferencia de precio cargada sobre el producto, al estilo ERPNext («cantidad original, precio = diferencia»; G19 §3.1), bajaría la cantidad disponible aunque no volvió mercadería. Es el mismo problema que G19 §5.1 le atribuía a la Opción A: mezclar dinero con Kardex. En motor2, donde el Kardex es el stock real, ese acoplamiento sería peor. **La evidencia de Odoo refuerza la Opción B.**

**«Un solo modelo con tipo» en la altura correcta.** Odoo usa un solo `account.move` porque todo el dominio es contable. En motor2, el equivalente fiel no es meter la NC en `Operacion`. Es que **dentro del dominio del dinero** haya una sola tabla de NC con un campo de tipo (devolución de mercadería / bonificación de precio), en vez de dos tablas. Mover las compras a esa tabla sería reescribir K1a a K1c y todos los reportes: no se propone.

**Qué conviene tomar de Odoo para K1d**, como criterio, no como diseño cerrado:

1. **Vínculo de documento y de línea.** A nivel documento, el equivalente a `reversed_entry_id` es una FK real a la `Operacion` `COMPRA`. A nivel línea, el equivalente a `purchase_line_id` es una FK a la `MovimientoStock` comprada. El de línea es el que permite el tope «comprado − ya devuelto» por renglón.
2. **Vincular después.** La NC suelta puede quedar sin compra al cargarla y vincularse más tarde, como en `purchase_bill_line_match`. Cubre la «factura que no se cargó» de la decisión 1 sin perder el tope cuando se vincula.
3. **El tope sigue siendo bloqueo, no aviso.** Odoo avisa (§1.5) porque tiene una segunda referencia, el pedido con `qty_received`, contra la que se concilia después. motor2 no tiene pedido ni recepción separados (G19 §6), así que no hay contra qué conciliar un aviso. Queda el bloqueo de ERPNext.
4. **Valuación de la devolución física.** Al precio de la línea comprada, como ya hace la anulación (`anulacion.ts:10-11`), y no con `obtenerCostoActualPorMP` (`devoluciones.ts:58`). Esto corrige el hallazgo 2 de G21 §4 solo para las devoluciones que pasen por una NC.
5. **FK real en vez de texto.** La migración de K1d es el momento natural para que el vínculo NC → compra sea una FK y no un prefijo en `detalleLibre`, que es como se vincula hoy la reversión de una anulación (`anulaciones.ts:23-31`). Reescribir esas reversiones queda fuera de esta propuesta.
6. **Precedente interno de espejo con referencia.** `CuentaItem.anulaAItemId` (`schema.prisma:1686-1689`, `onDelete: Restrict`) ya es una fila espejo con FK al original. Es el patrón más cercano a `reversed_entry_id` dentro de motor2.

**Lo que Odoo no resuelve.** Si la bonificación toca el costo de reposición (decisión 2). El único dato leído, el modo sin stock, dice que no. Pero es un modo, de un sistema, y con `stock_account` quedó sin verificar.

### 2.3 Cuenta corriente y saldo a pagar (el «fuera de alcance» de G19 §6)

Sin cuenta corriente, una NC baja el gasto y, si corresponde, el stock, pero no hay «saldo» contra el cual compensarla (G19 §6; P21 §5, «Riesgos»). Hay dos enfoques, y los dos necesitan una pieza que hoy no existe.

#### Pieza común: el registro de «pago a proveedor»

Hoy no hay ningún registro de pago a un proveedor de compra normal (§2.1). En Odoo, `account.payment` es **un solo modelo** para cobrar y para pagar (`account_payment.py:122-129`). Registra:
- el medio de pago, con `journal_id` y `payment_method_line_id` (`:24`, `:96`);
- los documentos a los que se aplicó (`reconciled_bill_ids`, `:193-195`).

En motor2 hay tres caminos, con distinto alcance:
- **Registro simple**, calcado de `PagoConsignante`: proveedor, sucursal, importe, fecha, notas y usuario. No tiene medio de pago.
- **Registro con medio de pago.** POS26 §2.2 ya propone, para el lado de ventas, un «registro de pago por cierre de cuenta (medio e importe)» (Enfoque B) y, en el Enfoque A, movimientos manuales de caja «ingreso, retiro y gasto». Un pago en efectivo a un proveedor es un egreso de esa misma caja. Si las dos cosas avanzan, conviene diseñar el medio de pago **una sola vez**. Es el mismo razonamiento de Odoo, donde POS también termina en `account` (`point_of_sale/__manifest__.py:12`; `pos_payment.py:58`, `account_move_id`). No repito POS26: solo marco la dependencia.
- **Unificar con `PagoConsignante` o no.** Un mismo `Proveedor` puede tener productos en consignación y compras normales. Hoy su pago de consignación resta solo de las liquidaciones (`consignacion.ts:87-91`). Unificar exige decir a qué deuda se imputa cada pago. Dejarlos aparte duplica la tabla, pero no toca un reporte que ya funciona.

#### Enfoque L, liviano: saldo calculado por reporte

**Idea.** Es la generalización directa del patrón de consignación:

> **saldo(proveedor) = Σ compras vigentes − Σ notas de crédito − Σ pagos**

Se calcula al vuelo, por proveedor y con período opcional, igual que `generarReporteConsignacion` (`consignacion.ts:52-101`). No hay conciliación ni entidad de «factura pendiente».

**Por qué el total no es aproximado.** Odoo calcula el saldo como `SUM(amount_residual)` de las líneas por pagar **no conciliadas** (`partner.py:406-416`). La conciliación solo reparte importes entre líneas de la misma cuenta: una línea saldada queda con residuo 0 y una parcial con su residuo. *Inferencia algebraica:* esa suma es igual a la suma de todos los saldos de la cuenta por pagar del proveedor, menos las diferencias de cambio en multimoneda, que motor2 no tiene (D2, G21 §3.7). O sea, **el Enfoque L da el mismo total que Odoo**. Lo que no da es el reparto por documento.

**Qué exige además del pago:**
- **Compras de contado.** Con L, toda compra cuenta como deuda hasta que se registre un pago. Si muchas compras se pagan en el momento, el saldo solo sirve si al cargar la compra se puede marcar «pagada al contado», lo que genera el pago en la misma transacción. Tocaría el alta de compra.
- **Saldo inicial.** Las compras históricas aparecerían todas como deuda. Hace falta una fecha desde la cual se lleva la cuenta corriente, o un saldo de apertura por proveedor.
- **Huecos de datos que ya existen:**
  - las compras «Sin proveedor» no suman a ningún saldo;
  - las compras con productos sin precio (`haySinPrecio`, `compras-registradas.ts:125`) subestiman la deuda;
  - las anuladas quedan afuera por el mismo filtro `anuladaEn: null` que ya exige el guardián.

#### Enfoque C, conciliación: aplicación por documento

**Idea.** Una entidad de **aplicación** («este pago, o esta NC, cancela $X de esta compra»). Es el equivalente mínimo de `account.partial.reconcile` (`debit_move_id`, `credit_move_id`, `amount`: `account_partial_reconcile.py:17-25, 50`). Para cada compra: pendiente = total − Σ aplicaciones. El estado sería pendiente, parcial o saldada, como el `payment_state` de Odoo (`account_move.py:51-59`).

**Qué gana:**
- saber **cuál** factura sigue impaga cuando un proveedor tiene varias abiertas;
- antigüedad de la deuda (Odoo guarda `max_date` en cada parcial para eso: `account_partial_reconcile.py:66-70`);
- el «crédito a favor» explícito: una NC o un pago sin aplicar queda como saldo a favor, que se aplica después a mano (`js_assign_outstanding_line`, `account_move.py:6872-6881`).

**Qué cuesta:**
- **Entidad y reglas nuevas.**
  - Σ aplicaciones ≤ total de la compra.
  - Σ aplicaciones de un pago ≤ su importe.
  - Una NC vinculada se aplica sola a su compra al confirmarse, como en `_post()` (`:6339-6356`).
  - Un pago sin elección queda «a cuenta».
- **Orden de aplicación.** Odoo deja que la persona **elija los documentos** y, dentro de lo elegido, ordena por vencimiento o fecha (`account_move_line.py:3025-3038`). motor2 no tiene vencimientos (`condicionesPago` es texto), así que el FIFO sería por `Operacion.fecha`.
- **Choque con append-only.** Odoo deshace una conciliación **borrando** los parciales (`remove_move_reconcile`, `account_move_line.py:3474-3478`). motor2 tendría que desaplicar con una fila espejo (patrón `CuentaItem.anulaAItemId`) o con `anuladaEn` en la aplicación.
- **Interacción con K1c.** Una compra con pagos o NC aplicados no debería poder anularse sin desaplicar antes. Es el criterio de Dolibarr para volver a borrador: «sin pagos» (G21 §3.6, fila 4). `anularCompra` (`compras.ts:48`) sumaría una guarda.

**Relación entre los dos enfoques.** C es un superconjunto de L: su total es el mismo (ver arriba). Se puede **empezar por L y agregar C después** sin migrar los pagos. Los pagos ya registrados quedarían «a cuenta» hasta aplicarse, o se aplicarían en bloque por FIFO al introducir C. Es la misma relación que POS26 §2.2 señala entre sus enfoques B y A.

### 2.4 Tradeoffs

| | K1d (Opción B) | Pago a proveedor | Enfoque L | Enfoque C |
|---|---|---|---|---|
| Migración | Sí: tabla de NC con sus líneas y FK a la compra y a la línea comprada, más FK opcional a la `DEVOLUCION_PROVEEDOR` generada | Sí: una tabla, o una columna nueva en `PagoConsignante` si se unifica (tabla con datos) | Ninguna además del pago (y del «pagada al contado», si se decide) | Sí: tabla de aplicación, más su mecanismo de desaplicación append-only |
| Permisos | Clave nueva, con migración de datos idempotente y test espejo (P21 §5, hallazgo 9) | Clave nueva, o reusar `pagar_consignante` | — | Quizá una clave para aplicar y desaplicar |
| Reportes que cambian | Gasto neto con bruto visible, ratio Compras/Ventas, gasto por insumo, Devoluciones (G19 §5.2); el guardián de anuladas se extiende a la NC | — | Un reporte nuevo de saldo por proveedor | El mismo, más estado por compra en `/reportes/compras` y antigüedad |
| Qué se pierde | — | — | **Cuál** factura sigue impaga; antigüedad; estado por compra; crédito a favor como entidad (solo aparece como saldo negativo) | — |
| Complejidad nueva | Tope por línea con acumulado de NC previas; vínculo posterior de una NC suelta | Validaciones simples, como `registrarPagoConsignante` | Baja: una consulta agregada | Alta: parcialidad, orden (FIFO o manual), aplicación automática de la NC vinculada, desaplicación, guarda nueva en `anularCompra`, concurrencia (dos pagos aplicados a la misma compra) |
| Riesgo si se hace sin lo demás | Sin cuenta corriente, la NC baja el gasto pero «no compensa» nada (G19 §6) | Sin L ni C, un pago no se ve en ningún saldo | Sin «pagada al contado» ni saldo inicial, el número es engañoso | Sin L antes, no hay número rápido para validar el diseño con el uso real |
| Tests | Vitest: `limpiarBaseDeTest` es una lista **hardcodeada** y cada tabla nueva necesita su `deleteMany` (P21 §1) | Ídem | — | Ídem, más la concurrencia bajo `SERIALIZABLE` |

### 2.5 Decisiones que le corresponden al dueño del producto

**De G19 §7:**
- **Siguen intactas:**
  - **(2)** ¿una bonificación cambia el costo de reposición? Odoo solo aporta un dato parcial (§2.2). Sigue bloqueando K1d.
- **Odoo ayuda a cerrarlas:**
  - **(1)** vinculada por defecto, más la variante «suelta con vinculación posterior»: ¿se admite?
  - **(3)** gasto neto con el bruto visible.
- **Ya resueltas, sin cambios:** (4), (5), (6) y (7), ver §2.1.

**Nuevas, que aparecen al entrar en cuenta corriente y pagos:**

1. **¿Qué nivel de detalle se quiere?** ¿Alcanza con el **saldo total** por proveedor (Enfoque L), o hace falta saber **qué factura sigue impaga** y su antigüedad (Enfoque C)? ¿Se acepta empezar por L?
2. **¿Cómo es un pago a proveedor?** ¿Un **registro simple** (importe, fecha, notas), o lleva **medio de pago**? Si lleva medio de pago, ¿se diseña junto con la caja de POS26 §2.2, donde un pago en efectivo sería un egreso de caja?
3. **¿Cómo se aplica una NC?** ¿Automáticamente a su compra vinculada (como Odoo), a la compra pendiente más vieja (FIFO), o a mano? ¿Y un pago sin compra elegida: queda «a cuenta» o se aplica por FIFO?
4. **Compras de contado.** ¿Se agrega «pagada al contado» al cargar una compra (genera el pago sola), o toda compra se considera a crédito hasta registrar un pago?
5. **Desde cuándo.** ¿Se lleva la cuenta corriente desde una fecha de corte, con saldo inicial por proveedor, o desde la primera compra histórica?
6. **Alcance.** ¿Saldo por sucursal (las compras y `PagoConsignante` son por sucursal) o por proveedor en toda la empresa (`Proveedor` es global)?
7. **Consignación.** ¿`PagoConsignante` se unifica con el pago a proveedor normal o queda aparte? Si se unifica, ¿cómo se imputa el pago de un proveedor que tiene las dos deudas?
8. **Anulación con pagos.** ¿Se bloquea anular una compra que tiene pagos o NC aplicados (criterio de Dolibarr), o se desaplica automáticamente?
9. **Crédito a favor.** Una NC sobre una compra ya pagada, ¿se descuenta del próximo pago o se registra un reembolso del proveedor?
10. **Permisos.** ¿Registrar pagos a proveedor usa `pagar_consignante` o una clave nueva? ¿Quién puede aplicar y desaplicar, si se elige C?

Recién con (2) de G19 y con las nuevas 1 a 4 respondidas tiene sentido pasar a un plan real con la skill `plan-con-verificacion-e2e`.

---

## Limitaciones

- **Addons fuera del cono sin leer:** `stock`, `stock_account`, `purchase_stock`, `account_payment` y `product`. Por eso **no se verificó**:
  - cómo valúa Odoo una NC de proveedor con stock instalado (decisión 2);
  - si `stock_account` reemplaza `_update_qty_available`/`_update_standard_price` (solo lo dice el docstring de `company.py:1384` para la valuación);
  - la guarda de stock al revertir una recepción;
  - dónde se definen `qty_available` e `is_storable`.
- **No se ejecutó Odoo.** Todo sale de la lectura de código y de tests. El efecto de una NC de ajuste de precio sobre `qty_available` en el modo sin stock (§2.2) es **inferencia** de leer `_update_qty_available`. No encontré un test que lo ejerza.
- **No se leyeron las vistas XML.** Por eso no sé si `ref` es editable en la UI de una factura confirmada (§1.2).
- **No se encontró un test de `res.partner.debit` para un proveedor.** Un grep de `\.debit\b` en `account/tests/test_account_partner.py` no devuelve ninguno. La equivalencia de totales entre L y C (§2.3) es inferencia algebraica sobre `partner.py:406-416`, no algo probado.
- **Método:** un comando de esta sesión (`git ls-tree -r -l`) disparó descargas perezosas en el clon parcial antes de cortarlo (§1.1). El clon quedó con el árbol limpio y unos 2 MB más en `.git`.
- **Las recomendaciones y los enfoques son criterio propio.** No se probaron con el usuario ni con datos de la demo. Lo dicho de motor2 está verificado en `f287b39`.

## Fuentes

**Odoo, rama `20.0` (`9b1a92e`), `github.com/odoo/odoo`:**
- `addons/account/models/account_move.py`, `account_move_line.py`, `account_partial_reconcile.py`, `account_full_reconcile.py`, `partner.py`, `account_payment.py`, `company.py`, `product.py`
- `addons/account/wizard/account_move_reversal.py`, `account_payment_register.py`
- `addons/account/tests/test_account_move_in_invoice.py`, `test_account_move_in_refund.py`, `test_account_partner.py`
- `addons/purchase/__manifest__.py`, `models/purchase_order.py`, `models/purchase_order_line.py`, `models/purchase_bill_line_match.py`, `models/account_invoice.py`, `tests/test_purchase_invoice.py`
- `addons/point_of_sale/__manifest__.py`, `models/pos_session.py`, `models/pos_payment.py`

**motor2 (`f287b39`):**
- `prisma/schema.prisma` (`Proveedor`, `PagoConsignante`, `Operacion`, `MovimientoStock`, `Cuenta`, `CuentaItem`)
- `src/core/compras/anulacion.ts`, `src/core/compras/correccion.ts`, `src/server/actions/movimientos/compras.ts`, `src/server/actions/movimientos/movimientos.ts`
- `src/core/movimientos/transiciones.ts`, `src/core/movimientos/anulaciones.ts`
- `src/core/reportes/compras-registradas.ts`, `consignacion.ts`, `devoluciones.ts`, `comun.ts`
- `src/server/actions/reportes/consignacion.ts`, `src/core/permisos/acciones.ts`
- `src/app/(app)/reportes/compras/page.tsx`, `src/app/(app)/catalogo/proveedores/[id]/page.tsx`
- `test/arquitectura/reportes-compras-anuladas.test.ts`
- `prisma/migrations/20260921230000_factura_unica_vigente`, `20260921230200_permiso_anular_compra`, `20260921232000_permiso_corregir_compra`

**Documentos internos:** G19, G21 §3.6 y §4, P21 §1 y §5, y POS26 §1 y §2.2 (rutas completas en el encabezado).
