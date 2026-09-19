# Grounding: compras que se puedan ver, corregir y compensar (notas de crédito) — 2026-09-19

Pedido del usuario (2026-09-19), en sus palabras: las compras no tienen rastreo ni modificación. Ejemplo: una nota de crédito que cancela un producto de una factura de un proveedor ya cargada; hoy se cargó todo aunque se devolvió, y no se puede reflejar la devolución o el descuento más que como una merma, que no corresponde porque no fue una pérdida de plata. El usuario lo marcó como **el hueco más importante** de la lista de pendientes.

Estado: **grounding y propuesta. No hay nada implementado.** Los esfuerzos marcados con \* son estimación propia, sin verificar. Hace falta que el usuario decida (§7) antes de tocar código o esquema.

## 1. Conclusión

1. **Los dos referentes lo resuelven de forma parecida, en dos pasos**: (a) la factura cargada no se edita en silencio; se **anula** (o se cancela y se rehace) y (b) lo que la compensa es un **documento nuevo vinculado a la factura original** (nota de crédito / nota de débito de compra) que **mueve stock solo si así se configura** y que **resta lo que se le debe al proveedor** sin borrar la factura original. Solo en ERPNext se leyó que el documento lleva **cantidades en negativo** y **tope por línea**.
2. **Un descuento sin devolver mercadería es un caso aparte y de primera clase** en ERPNext (una página de manual propia): se carga la cantidad original en negativo y, como precio, solo la diferencia; no se toca el stock.
3. **Motor2 no tiene ninguna de las dos piezas para las compras.** Solo existe `anularVenta`. La «Devolución a proveedor» descuenta stock, pero no se vincula a la compra, no resta del gasto y se valúa con el costo de reposición de hoy, no con lo que el proveedor efectivamente acreditó.
4. **Propuesta**: cuatro fases chicas y reversibles (§5): ver las compras (sin migración), corregir sus datos con auditoría, anularlas, y notas de crédito vinculadas con gasto neto. La última necesita migración.

## 2. El problema, con el caso del usuario

Compra a un proveedor: factura N.º X con 5 líneas, entre ellas 10 kg de carne. Al recibirla se devuelven 3 kg (o el proveedor bonifica $ por mala calidad) y llega una nota de crédito.

| Qué debería pasar | Qué pasa hoy |
|---|---|
| El stock de carne baja 3 kg (devolución física) | Se puede hacer con «Devolución a proveedor», pero suelta: no dice de qué factura |
| El gasto del período baja lo que acreditó el proveedor | **No baja.** «Compras del período» solo suma operaciones `COMPRA`; el ratio Compras/Ventas y el gasto por insumo quedan inflados |
| Una bonificación sin devolución (descuento) baja el gasto y no toca el stock | **No hay dónde cargarla.** Una `MERMA` sería incorrecta: descuenta stock y cuenta como pérdida, y no hubo ninguna |
| Se puede ver la factura y qué se le devolvió | No hay pantalla que liste compras; solo el historial por producto y la trazabilidad por ID de operación |
| Una compra cargada sin proveedor o con el N.º de factura mal se corrige | No se puede: no existe editar ni anular una compra |

## 3. Qué hacen los referentes (leído en el código y en el manual, 2026-09-19)

### 3.1 ERPNext

- **La nota de débito es la misma factura con `is_return = 1`** y `return_against` apuntando a la original (`purchase_invoice.json`: «Is Return (Debit Note)», «Return Against Purchase Invoice»).
- **Validaciones al vincularla** (`sales_and_purchase_return.py`, `validate_return_against`): la original existe, es del mismo proveedor y la misma empresa, está confirmada (`docstatus` 1), **la devolución es posterior** a la original y tiene el mismo tipo de cambio.
- **Por línea** (`validate_returned_items`, `validate_quantity`): el ítem tiene que estar en la original y **no se puede devolver más que lo comprado menos lo ya devuelto** (`max_returnable_qty = reference_qty - returned_qty`; el acumulado de devoluciones anteriores se suma con `get_returned_qty_map_for_row`). Tiene que haber al menos una cantidad negativa.
- **Signo**: `make_return_doc` copia la original con cantidades en negativo (`qty = -1 * source.qty`) y el descuento también.
- **Stock**: lo decide el tilde **«Update Stock»** (`update_stock`, «si está marcado, actualiza el inventario»); la devolución hereda el valor de la original. Sin él, no se mueve stock.
- **Descuento sin devolver mercadería** — el manual tiene una página aparte, «Debit Note for Price Adjustment»: se carga la **cantidad original en negativo** y como **precio solo la diferencia** (ejemplo del manual: original $520, corregido $500, se carga $20 × −10 = −$200), con **«Update Stock» sin marcar**, «porque la mercadería no se devuelve». El manual no dice cómo cambia la valuación del stock; solo que la cantidad no cambia.
- **Efecto en lo que se debe**: al confirmarla «reduce el saldo a pagar al proveedor». **La factura original no se modifica**: su saldo baja por el importe de la nota. Si ya estaba paga, queda un crédito a favor para descontar de la próxima factura o para pedir el reembolso.
- **Corrección de una factura ya confirmada**: se **cancela y se enmienda**: `amended_from` guarda de cuál viene la nueva. Tras confirmar, solo se pueden tocar unos pocos campos de clasificación (los marcados `allow_on_submit` entre los que se revisaron: centro de costo, cuentas, proyecto…); entre esos no figuran el proveedor ni los importes (no se revisó la tabla de ítems).
- Duplicados del N.º de factura del proveedor: chequeo opcional por proveedor y año fiscal (ya relevado en `comparativa-ux-erpnext-dolibarr.md` §3).

### 3.2 Dolibarr (`fourn/class/fournisseur.facture.class.php`)

- **Tipos de factura de proveedor**: estándar (0), de reemplazo (1), **nota de crédito (2)** y anticipo (3). La nota de crédito se vincula con **`fk_facture_source`** (id de la factura origen).
- **Esa vinculación no se valida en esta clase**: no comprueba que la factura origen exista ni limita el importe. Es más laxo que ERPNext.
- **Stock**: al validar, si el módulo de stock está activo **y** la opción `STOCK_CALCULATE_ON_SUPPLIER_BILL` está prendida, una nota de crédito hace una salida de stock (`livraison`) y una factura estándar una entrada (`reception`). Sin esa opción, esta clase no mueve stock.
- **Una nota de crédito se puede convertir en descuento** para una factura futura del mismo proveedor (`insert_discount`, descuentos absolutos `societe_remise_except`): el mecanismo del «crédito a favor».
- **Corrección**: una factura validada **no se edita**: `setDraft()` la vuelve a borrador y **deshace los movimientos de stock** (con la misma opción), o se **cancela** con un motivo (`CLOSECODE_ABANDONED`, `CLOSECODE_REPLACED` = reemplazada por otra).

### 3.3 Lo que coincide

| | ERPNext | Dolibarr | Aplica a motor2 |
|---|---|---|---|
| La factura confirmada no se edita en silencio | Se cancela y se enmienda (`amended_from`) | Vuelve a borrador o se cancela con motivo | Sí: anular + recargar, o corrección auditada de datos que no tocan el Kardex |
| La compensación es un documento nuevo vinculado | `is_return` + `return_against` | Tipo nota de crédito + `fk_facture_source` | Sí |
| Cantidades en negativo | Sí (`qty = -1 * source.qty`) | No verificado en esta clase | Sí, o un documento aparte con importes |
| Tope por línea (lo devuelto ≤ lo comprado) | **Sí**, con acumulado de devoluciones previas | No en esta clase | Sí, es lo que evita devolver dos veces |
| Solo mueve stock si hubo devolución física | Tilde «Update Stock» | Opción global `STOCK_CALCULATE_ON_SUPPLIER_BILL` | Sí: la bonificación de precio no toca stock |
| Descuento sin devolver | Caso documentado (rate = diferencia, sin stock) | Nota de crédito; el stock solo se mueve con la opción prendida | Sí, es el caso que el usuario no puede cargar hoy |
| Crédito a favor si ya se pagó | Sí | Sí (descuento absoluto) | Solo si se agregan pagos a proveedores (hoy no existen; ver §6) |

## 4. Qué tiene motor2 hoy (verificado en el código de `main`)

- **Una compra** es una `Operacion` (`proceso = COMPRA`) con `proveedorId`, `nroFactura` y `fecha`, y una línea `MovimientoStock` por producto con `cantidad`, `precioTotal` y `precioPorUnidadStock`. El proveedor puede quedar vacío (el selector arranca en «Sin proveedor»). Hay un chequeo de que no se repita el N.º de factura con el mismo proveedor en la sucursal.
- **Editar o anular una compra: no existe.** La única anulación es `anularVenta` (`venta.ts`, permiso `anular_venta`): marca `Operacion.anuladaEn`/`anuladaPorId` y revierte el stock con movimientos inversos; **nunca edita ni borra** filas (criterio append-only del proyecto).
- **Devolución a proveedor** (`DEVOLUCION_PROVEEDOR`): baja stock (`signoStock −1`, exige stock real) y pide proveedor y N.º de factura, **pero no hay campo que la vincule a una compra** (`Operacion` no tiene «operación de origen»).
- **Los reportes de compras solo miran `COMPRA`**: `calcularComprasDelPeriodo` suma únicamente las líneas de compra; el ratio Compras/Ventas, el gasto por insumo y «Precio y tendencia» parten de ahí. Una devolución o una bonificación no las mueve.
- **La Devolución a proveedor se valúa con el costo de reposición de HOY** (`generarReporteDevoluciones` usa `obtenerCostoActualPorMP`), no con lo que el proveedor acreditó.
- **No hay una pantalla que liste compras.** Se llega por el historial de un producto o por la trazabilidad de una operación (por ID exacto).
- **Existe una auditoría administrativa** (`RegistroAuditoria`, entidades Producto, PrecioLocalProducto, PermisoRol, CapacidadSucursal, Rol) que hoy no cubre las compras.
- **El costo de reposición** de cada insumo es el precio por unidad de la compra con precio más reciente (`obtenerCostoActualPorMP`); sirve a Costos y márgenes y a la Valuación. Una bonificación de precio no lo cambiaría salvo que se decida (§7, punto 2).

## 5. Propuesta (propia, sin verificar contra el uso real)

Cuatro fases, cada una publicable sola. Antes de cada una: matriz de impacto y revisión del gobernador, como siempre.

| Fase | Contenido | Migración | Esfuerzo\* |
|---|---|---|---|
| **K1a** | **Listado de compras** (proveedor, N.º de factura, fecha, líneas, total) con detalle por factura y filtros; enlace desde «Compras por proveedor» y desde el historial. Muestra si una compra tiene notas de crédito, cuando existan | No | Bajo a medio |
| **K1b** | **Corregir los datos de una compra ya cargada** (proveedor, N.º de factura, y los precios de las líneas) con registro de auditoría de qué cambió y quién, **sin tocar cantidades ni el Kardex**. Resuelve «Sin proveedor» | Probablemente no (se apoya en `RegistroAuditoria`) | Medio |
| **K1c** | **Anular una compra** completa como operación inversa, igual que `anularVenta` (`anuladaEn` se extiende a `COMPRA`; los reportes la excluyen). Hay que definir qué pasa si el stock ya se consumió (§7, punto 5) | No (`anuladaEn` ya existe) | Medio |
| **K1d** | **Nota de crédito de proveedor vinculada a la compra original**, con dos tipos: **devolución de mercadería** (baja stock y se vincula a la línea, con tope por lo ya devuelto) y **bonificación de precio** (no toca stock). Resta del **gasto neto** de «Compras del período», del ratio y del gasto por insumo, y no pasa por merma | **Sí** | Medio a alto |

### 5.1 Modelo posible para K1d (a decidir)

- **Opción A — reutilizar `Operacion`/`MovimientoStock`** con un proceso nuevo `NOTA_CREDITO_PROVEEDOR` y un campo `operacionOrigenId` (auto-relación). Ventaja: todo pasa por el mismo motor, la trazabilidad y la idempotencia. Problema: una bonificación no tiene cantidad. El Kardex sí admite líneas de cantidad 0 en algunos procesos (`permiteCero: true` en AJUSTE, CONTROL y LIQUIDACION_CONSIGNACION, y `anularVenta` escribe filas con cantidad 0), y un proceso nuevo podría definir lo mismo en `TRANSICIONES`; el problema de fondo es que una bonificación de precio no es un movimiento de stock y mezclaría dinero con Kardex.
- **Opción B (recomendada, por separar el dinero del stock; no porque el Kardex no admita cantidad 0)** — **tabla propia `NotaCreditoProveedor` con sus líneas** (`operacionOrigenId`, por línea el producto, la cantidad devuelta y/o el importe acreditado, el tipo), y, **solo si hay devolución física**, esa nota crea además una `DEVOLUCION_PROVEEDOR` en el Kardex vinculada. El Kardex sigue siendo solo stock; el dinero vive en la nota. Es el equivalente a `is_return` + `return_against` de ERPNext, y evita meter líneas de cantidad 0.
- En cualquiera de las dos: **tope por línea** = comprado − ya devuelto (lo que ERPNext valida y Dolibarr no), y **la compra original no se modifica**.

### 5.2 Matriz de impacto (lo que hay que tocar o revisar)

| Pieza | Efecto |
|---|---|
| `calcularComprasDelPeriodo`, ratio Compras/Ventas, gasto por insumo, top de proveedores del Resumen | Pasan a ser **netos** de notas de crédito (con el bruto visible) |
| «Precio y tendencia» y costo de reposición | Decisión de §7, punto 2: ¿una bonificación cambia el precio efectivo? |
| Valuación del stock | Solo cambia con las devoluciones físicas (baja el stock); una bonificación, según el punto 2 |
| Reporte de Devoluciones | Valuar con el importe acreditado por la nota y no con el costo de hoy |
| Trazabilidad e historial por producto | Mostrar la nota y la compra vinculada |
| Permisos | Hoy `proceso_devolucion_proveedor` cubre la devolución. Para corregir y anular haría falta una acción nueva (por ejemplo `corregir_compra`, `anular_compra`), con la decisión del punto 6 |
| Esquema | K1d requiere migración (tabla nueva y vínculo). K1a a K1c, en principio, no |
| Datos existentes | Las compras ya cargadas siguen igual; la corrección (K1b) permite completar el proveedor de las que quedaron «Sin proveedor» |

## 6. Fuera de alcance de este grounding (anotado)

- **Pagos y cuentas a pagar a proveedores** (lo que ERPNext llama saldo a pagar y crédito a favor): motor2 no los tiene. Sin ellos, una nota de crédito reduce el gasto y el stock, pero no hay «saldo» que compensar. Es un circuito aparte; se puede decidir después.
- Órdenes de compra y recepciones (Dolibarr y ERPNext separan pedido, recepción y factura; motor2 registra todo en un solo paso).

## 7. Decisiones abiertas para el usuario

1. **¿La nota de crédito tiene que estar vinculada a una compra original, o se admite «suelta»?** ERPNext la vincula y valida (aunque el vínculo puede omitirse); Dolibarr la guarda sin validar. Recomendación: vinculada, con la opción de «suelta» solo para el caso de una factura que no se cargó.
2. **Una bonificación de precio, ¿cambia el costo de reposición del insumo?** (el «precio efectivo» que usan Costos y márgenes y la Valuación) ¿O solo baja el gasto del período? ERPNext no lo dice en su manual. Afecta a los márgenes.
3. **¿El gasto de los reportes pasa a ser neto de notas de crédito?** Recomendación: sí, mostrando también el bruto.
4. **¿Qué campos de una compra ya cargada se pueden corregir?** Propuesta: proveedor, N.º de factura y precios; nunca cantidades ni fecha (movería el Kardex).
5. **¿Se puede anular una compra cuyo stock ya se consumió?** Opciones: bloquear; permitirlo y dejar el stock en negativo; o pedir una nota de crédito en su lugar.
6. **Permisos**: ¿acciones nuevas (`corregir_compra`, `anular_compra`) o reutilizar `proceso_devolucion_proveedor` y `anular_venta`? Recomendación: acciones nuevas, para poder dárselas a un rol sin dárselas a otro.
7. **Por dónde empezar.** Recomendación: K1a (ver las compras) y K1b (corregir «Sin proveedor») primero: no necesitan migración y resuelven lo que el usuario ve hoy.

## 8. Limitaciones

- ERPNext y Dolibarr se leyeron en `develop` de sus repositorios y en el manual, con resúmenes de WebFetch: no se ejecutó ningún sistema. No se leyó el código de cómo ERPNext asienta la nota de débito en el libro mayor, ni el de las cuentas por pagar.
- **No verificado**: cómo cambia la valuación del stock de ERPNext con un ajuste de precio (el manual no lo dice); el comportamiento de Dolibarr sin la opción `STOCK_CALCULATE_ON_SUPPLIER_BILL` más allá de lo que dice el código de la clase; el detalle contable de una nota de crédito en ninguno de los dos.
- Los esfuerzos son estimación propia. La propuesta no se probó con el usuario ni con un caso real de la demo.
- Lo dicho de motor2 (§4) está verificado en el código de `main` al 2026-09-19; las cifras de la demo («Sin proveedor», 26 líneas, $1.916.100 en agosto) salen del relevamiento de pantallas.

## Fuentes

- ERPNext: `erpnext/controllers/sales_and_purchase_return.py` y `erpnext/accounts/doctype/purchase_invoice/purchase_invoice.json` (rama `develop`, `github.com/frappe/erpnext`).
- Manual de ERPNext: [Debit Note](https://docs.frappe.io/erpnext/user/manual/en/debit-note) y [Debit Note for Price Adjustment](https://docs.frappe.io/erpnext/user/manual/en/debit-note-for-price-adjustment).
- Dolibarr: `htdocs/fourn/class/fournisseur.facture.class.php` (rama `develop`, `github.com/Dolibarr/dolibarr`).
- Interno: `docs/comparativa-ux-erpnext-dolibarr.md` §3 y §8.6, `docs/grounding-pendientes-2026-09-18.md` (fila K1).
