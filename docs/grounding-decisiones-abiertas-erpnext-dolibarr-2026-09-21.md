# Grounding de las decisiones abiertas contra ERPNext y Dolibarr (2026-09-21)

Complementa `docs/p2109.md` §1. Cubre las once decisiones de producto abiertas. Es un documento de **evidencia y recomendación**: ninguna decisión queda tomada. Las recomendaciones son criterio del investigador, no del negocio.

## 1. Resumen

**Lo que dice el estándar de industria, de lo general a lo específico:**

1. **Ningún referente resuelve por motor2 las decisiones que son de negocio.** El estándar sirve para descartar opciones o para fijar un mínimo razonable.
2. **Tres decisiones quedan mayormente resueltas por el estándar**: alertas de stock (digest, no mail por ítem), corrección de compras (no se edita en el lugar; se cancela/enmienda o se compensa con documento vinculado) y import/export (archivo subido o descargado, no Drive).
3. **Dos funciones no existen en ninguno de los dos sistemas**: sugerencia de Insumo/Familia al tipear (E3) y búsqueda de conteo que resuelva la MP vía receta (E5). Si se hacen, son diferenciadores propios.
4. **Dos cosas cambian el diseño de lo que ya estaba pensado** (ver §4): la anulación de una compra choca con el índice único de factura, y la Devolución de motor2 se valúa al costo de hoy, mientras que ERPNext usa el costo de la compra original.

## 2. Tabla de decisiones

| Ítem | Qué hace el estándar | Recomendación (del investigador) | ¿Sigue siendo de negocio? |
|---|---|---|---|
| **E4** memoria de últimos valores | Lo «por usuario» vive en base de datos en ambos (Frappe `DefaultValue`/`__UserSettings`, Dolibarr `llx_user_param`). Ninguno guarda «últimos valores del alta». | Base de datos, no cookie. Exige tabla nueva y migración (autorizada solo para bases locales). | Sí: cookie vs. base |
| **E3** sugerencia al tipear | No existe en ninguno. | Diferenciador propio, opcional, después de E4. | Sí |
| **E5** conteo vía receta | No existe en ninguno. Ambos cuentan la grilla plana. | Si se hace, atajo de UI con filas visibles y editables. | Sí: 7 preguntas de alcance (§3.4) |
| **Paso 7** pivot | ERPNext: reportes «Analytics». Dolibarr: casi sin pivot. | Mantener al final. Mínimo: dimensión + rango mensual/trimestral/anual + total + export. | Sí: 8 preguntas de alcance (§3.5) |
| **6b** food cost por consumo | Ambos separan costo de lo vendido del gasto de compras. | Sí, mostrarlo al lado con rótulos distintos y aviso de cobertura. | Menor |
| **K1b/K1c** | No se edita un confirmado. | Ver §4. | 3 de 7 decisiones siguen abiertas |
| **D2** doble moneda | Moneda + tipo de cambio por documento, porque el documento se emite en moneda extranjera. | No agregar salvo que el negocio pacte precios en USD. | Sí: una sola pregunta decide |
| **E1** alertas | Digest agregado (ERPNext) o solo en pantalla (Dolibarr). Nunca mail por ítem sin filtro. | Digest diario por sucursal, a los usuarios con `notificar_alertas` de esa sucursal. | Menor |
| **Comprobantes** | El adjunto hereda el permiso del documento. Ninguno sube a Drive desde el núcleo. | Ve el comprobante quien ya ve la compra. | Sí: Workspace, dominio remitente |
| **G1** exportar a Drive | Descarga local en ambos. | Diferir. Ya se exporta `.xlsx`. | Sí |
| **G2** importar de Google | Archivo subido (CSV/XLSX) con asistente de mapeo. | Si se hace, archivo subido; evita OAuth y hoja pública. | Sí |
| **Seed de la demo** | Sin datos demo relevantes en ninguno. | Sin evidencia externa. | Sí |

## 3. Detalle por decisión

### 3.1 E4 y E3: alta de producto

**Verificado en fuente.**
- Frappe guarda defaults por usuario en el doctype `DefaultValue` (`frappe/defaults.py`) y las vistas por usuario en `__UserSettings` (`frappe/model/utils/user_settings.py`). El contenido de `__UserSettings` son vistas y filtros, no valores de formularios de alta.
- La función más parecida a E4 es «Remember Last Selected Value» (propiedad de los campos Link). Se lee y escribe en `frappe.boot.user.last_selected_values` en el cliente. **No se verificó** de dónde se llena ese objeto ni si sobrevive a una recarga. Un hilo del foro reporta que la función tenía un bug.
- El `Item Default` de ERPNext es una tabla hija **por compañía**, no por usuario. El Item Group aporta defaults al ítem (relación inversa a E3).
- Dolibarr guarda preferencias por usuario en `llx_user_param` (cargadas con `User::loadPersonalConf()`). En el alta de producto (`product/card.php`) los defaults vienen de constantes globales, no por usuario. No se vio memoria de últimos valores. La implementación de `dol_set_user_param` **no se pudo leer** (archivo truncado).
- Ninguno sugiere grupo o categoría a partir del nombre. Es ausencia en lo consultado, no prueba de ausencia.

**Código de motor2.**
- `src/app/(app)/catalogo/productos/producto-form.tsx` usa `<select>` estáticos; los `defaultValue` solo salen de un producto existente. No hay memoria ni sugerencia por nombre.
- El alta rápida de Compra (`src/components/catalogo/quick-crear-producto.tsx`) solo pide nombre y unidad de stock. E3/E4 tocarían el formulario completo, no ese modal.
- No hay tabla de preferencias. Cookies: solo autenticación y sucursal activa. `localStorage`: solo el sidebar. La opción «base de datos» exige tabla nueva y migración.

**Recomendación.** Base de datos, porque es el patrón de ambos sistemas para lo «por usuario», y una cookie no acompaña al usuario entre dispositivos. El motor viejo guardaba estos valores por usuario y tenía un botón «Olvidar».

### 3.2 6b: food cost por consumo junto al ratio Compras/Ventas

**Verificado en fuente.**
- ERPNext calcula el costo de lo vendido (Gross Profit) con `get_buying_amount()`, desde el Stock Ledger, `incoming_rate`, etc. Existe un issue abierto (#27297): el reporte usa el último valuation rate conocido del almacén y no el vigente al facturar. Ni ERPNext resuelve del todo el costo al momento.
- Dolibarr congela el precio de compra en la línea de factura (`buy_price_ht`) y el módulo Margins suma `qty * buy_price_ht` (equivalente conceptual de `costoUnitarioVenta`). Su `MARGIN_TYPE` elige entre mejor precio de proveedor, PMP o precio de costo de la ficha.
- No se encontró un reporte de ratio Compras/Ventas en ninguno (**no verificado**; no es prueba de ausencia).

**Código de motor2.** El cálculo ya existe: `calcularMargenDelPeriodo` (`src/core/reportes/periodo.ts`) devuelve `margenRealTotal`, `ingresoConCostoReal`, `ingresoSinCostoReal` y `ingresoRealReconstruido`. `RatioGastoVentas` documenta que mide desembolso, no consumo. Falta solo presentarlo junto al ratio.

**Recomendación.** Mostrarlo con rótulos distintos («Costo de lo vendido (consumo)» frente a «Compras / Ventas (desembolso)») y con aviso de cobertura, porque el margen real solo cubre lo costeable. No reemplazar el ratio de compras. En la demo saldría vacío o parcial (inferencia).

### 3.3 Seed de la demo

No se encontraron datos demo o seed relevantes en ERPNext ni en Dolibarr. Sin evidencia externa; sigue siendo decisión de producto (es un nice-to-have según el documento de origen).

### 3.4 E5: conteo físico vía receta

**Verificado en fuente.**
- ERPNext «Stock Reconciliation» → «Fetch Items from Warehouse» filtra por almacén, código de ítem opcional e «Ignore Empty Stock», sin expansión de BOM ni bundles. La explosión de BOM existe en Stock Entry (Manufacture/Repack), no en el conteo.
- Dolibarr «Inventory» arma la grilla filtrando por almacén, producto o categoría, y con la opción de subproductos **excluye a los padres de kit**: cuenta componentes, no compuestos.

**Código de motor2.** «+ Agregar producto» usa `SelectorProducto` con `soloConStockReal` (MP, o PV con `seProduce`), así que hoy no aparecen PV sin `seProduce`. El modelo permite resolver por receta (`RecetaVersion` → `RecetaIngrediente.insumoProductoId` → `Producto`). No se verificó si el ingrediente puede ser recursivamente un PV con `seProduce`.

**Preguntas de alcance que faltan decidir** (p2109 decía que no estaban guardadas; estas son propuestas del investigador):
1. ¿Se agregan solo las MP directas o el BOM recursivo (que ya existe en costeo)?
2. Un ingrediente con `seProduce` (salsa base) es a la vez receta y stock propio: ¿se cuenta él, sus MP, o ambos?
3. Si ambos, ¿cómo se evita contar doble?
4. ¿Se suma sobre la grilla precargada o reemplaza el filtro?
5. ¿Las MP sin saldo se agregan igual como fila manual?
6. ¿Merma y MP compartidas por varios PV: fila única o repetida?
7. ¿Aplica solo a Conteo Físico o también al buscador de otras pantallas?

### 3.5 Paso 7: selector de pivot

**Verificado en fuente.**
- ERPNext: Purchase Analytics tiene `tree_type` (Supplier Group / Supplier / Item Group / Item), `doc_type`, `value_quantity` (Value / Quantity) y `range` (Weekly / Monthly / Quarterly / Yearly). Sales Analytics y Stock Analytics son análogos. Report Builder permite Group By con Count, Sum y Average.
- Dolibarr casi no tiene pivot: estadísticas fijas, márgenes por producto/cliente/vendedor con rango de fechas y exports CSV/PDF. Los reportes mensuales de ejemplo solo se vieron en un resultado de búsqueda (**no verificado**).

**Código de motor2.** `reportes/compras/page.tsx` filtra solo desde/hasta/proveedor/factura. `obtenerReportePorPeriodo` ya trae `gastoPorInsumo`, así que el «Paso 1» del grounding ya está resuelto, aunque no como selector. Hay export en `src/core/excel.ts` y `src/components/tabla-reporte.tsx`.

**Preguntas de alcance que faltan decidir** (propuestas del investigador):
1. ¿Qué reportes lo tienen: solo Compras, o también Ventas y Margen?
2. ¿Qué dimensiones: proveedor, insumo, grupo (árbol o plano), sucursal?
3. ¿Qué granularidad: semana, mes, trimestre, año?
4. ¿Valor y cantidad son alternativos (como en ERPNext) o van juntos?
5. ¿Ajustado por IPC?
6. ¿Pantalla, export, o ambos?
7. ¿Con qué permiso, dado el esquema de permisos por grupos?
8. ¿Con fila Total y acumulado jerárquico por grupo?

### 3.6 K1b/K1c: corregir y anular una compra confirmada

**Principio común.** Un documento confirmado no se edita en el lugar. ERPNext lo cancela y lo enmienda. Dolibarr lo vuelve a borrador solo si se cumplen condiciones, lo abandona o lo reemplaza. Lo que compensa es un documento vinculado.

**Mapeo a las 7 decisiones** de `grounding-compras-correccion-y-notas-de-credito-2026-09-19.md` §7:

| # | Decisión | Evidencia | Estado |
|---|---|---|---|
| 1 | NC vinculada o suelta | Dolibarr permite ambas: la suelta requiere `INVOICE_CREDIT_NOTE_STANDALONE`. ERPNext vincula con `return_against`. | Resuelta por el estándar. Rec.: vinculada por defecto; suelta como excepción explícita |
| 2 | ¿La bonificación cambia el costo de reposición? | ERPNext valúa una devolución física al `incoming_rate` de la compra original. Para un ajuste de precio sin devolución no hay dato. Dolibarr: no verificado. | **De negocio** |
| 3 | Gasto neto de NC | Ambos restan la NC del saldo con el proveedor sin tocar la original. | Resuelta en lo conceptual (inferencia). Rec.: neto, con el bruto visible |
| 4 | Campos corregibles | ERPNext: tras confirmar, `allow_on_submit` cubre título, centro de costo, proyecto, etc. **No** proveedor, importes ni `bill_no`. Dolibarr: no se edita; volver a borrador exige sin pagos, sin exportar a contabilidad y estado validada. | Parcial. La propuesta de motor2 (editar en el lugar proveedor, N.º de factura y precios, con auditoría) **es más laxa que los dos estándares**: es una desviación deliberada a decidir. Alternativa estándar: anular y recargar |
| 5 | Anular con stock ya consumido | ERPNext bloquea con `NegativeStockError` («Insufficient Stock») salvo que se permita stock negativo. Dolibarr: no verificado. | Resuelta por el estándar. Rec.: bloquear por defecto y ofrecer la NC como salida |
| 6 | Permisos | No verificado en ninguno. | **De negocio** |
| 7 | Por dónde empezar | No es cuestión de referente. | **De negocio** |

**Evidencia adicional de Dolibarr** (`fournisseur.facture.class.php`, `fourn/facture/card.php`): tipos `TYPE_STANDARD=0`, `TYPE_REPLACEMENT=1`, `TYPE_CREDIT_NOTE=2`, `TYPE_DEPOSIT=3`; cierre `abandon`, `replaced`, `badsupplier`. Reabrir aplica a facturas cerradas o abandonadas, salvo las abandonadas por reemplazo. No se encontró tope de importe de la NC contra la original. La wiki «Module Suppliers Invoices» dice que reemplazo, NC y anticipo no están gestionados para proveedores, pero el código sí los tiene (la página parece desactualizada; manda el código).

### 3.7 D2 / Método 2 USD

**Verificado en fuente.** Ambos sistemas guardan moneda y tipo de cambio **por documento**, más los importes en moneda base:
- ERPNext: `currency`, `conversion_rate`, `base_net_total`, `base_grand_total`. Una devolución con referencia debe tener el mismo tipo de cambio que el original (`validate_return_against`).
- Dolibarr: `multicurrency_code`, `multicurrency_tx` (`double(24,8)`), `multicurrency_total_ht/tva/ttc`; tasas históricas en `llx_multicurrency_rate`. **No verificado**: si el módulo viene activo por defecto. Hay un issue abierto (#39956) sobre totales inconsistentes; solo se leyó el título.

**Código de motor2.** No hay ningún campo de moneda ni tipo de cambio en `Operacion` ni `MovimientoStock`. Existen `CotizacionDolar` e `IndicePrecio` (sin columna de serie).

**Recomendación.** Los sistemas lo hacen porque el documento se emite en moneda extranjera, no como vista de reporte. Si ningún proveedor factura en USD ni ningún precio se pacta en USD, el estándar no obliga a guardar USD por registro (inferencia). Una sola pregunta decide D2: **¿el negocio pacta precios en USD?** Si sí, el mínimo estándar es moneda + tipo de cambio en el documento + importe base, con la misma tasa en las NC vinculadas.

### 3.8 E1: alertas de stock

**Verificado en fuente.**
- ERPNext manda un digest agregado por empresa (grounding 2026-09-18 §3). El doctype `Notification` es por evento (New, Save, Submit, Cancel, Days Before/After, Value Change, Method) con destinatarios por rol, campo o mail fijo, pero **no tiene un evento «stock por debajo del mínimo»** (inferencia).
- Dolibarr **no manda mail por umbral de stock**: lo muestra en un widget del panel (`box_produits_alerte_stock.php`, permiso `stock/lire`) y ofrece reposición (`replenish.php`, que compara contra stock «virtual» con pedidos en camino). Su módulo Notification es por evento (lista cerrada de 32 códigos, sin movimientos ni umbral de stock), con suscripción por usuario en `notify_def`, y **sin digest**.
- **No copiar:** el filtro `seuil_stock_alerte > 0` de Dolibarr hace que un umbral en 0 nunca alerte. Es el mismo bug que motor2 ya corrigió.

**Código de motor2.** `notificar_alertas` existe solo como definición (`src/core/permisos/acciones.ts:41`); ninguna Server Action la consume. `calcularAlertasStock` (`src/core/stock/alertas.ts`) calcula al vuelo y no persiste estado, así que no hay flag «ya avisado». No hay dependencia de mail. No existe «responsable de sucursal» (`UsuarioSucursal` tiene usuario, sucursal, rol, `activo`, `notas`). `vercel.json` ya tiene dos crons diarios con `CRON_SECRET`, así que el digest sigue el mismo patrón.

**Recomendación.** Digest diario por sucursal, con flag «ya avisado», a los usuarios con `notificar_alertas` **de esa sucursal**: se calcula hoy sin migración. Exigir un «responsable» único implicaría un campo nuevo.

### 3.9 Comprobantes y Drive

**Verificado en fuente.**
- Frappe (`file.py`, `has_permission`): si el archivo no es privado, lo lee cualquiera; si no, el dueño, alguien con quien se compartió, o quien tiene permiso de lectura sobre el documento al que está adjunto.
- Dolibarr guarda los archivos en disco y los indexa en `ecm_files`. La descarga pasa por `document.php`, que exige el permiso del módulo de origen (`fournisseur/facture/lire`) y filtra usuarios externos. ECM tiene además permisos propios.
- Ninguno integra Drive en el núcleo (Dolistore de terceros: **no verificado**).

**Código de motor2.** No hay campo, tabla ni modelo de comprobante (C3 sigue sin existir).

**Recomendación.** Que vea el comprobante quien ya puede ver la compra en `/reportes/compras`, sin clave nueva, o una sola («ver comprobantes») si el negocio quiere restringirlo. Workspace, Unidades compartidas y dominio remitente de Resend siguen siendo decisiones de negocio.

### 3.10 G1 y G2

**Verificado en fuente.** Dolibarr exporta descargando (`csviso`, `csvutf8`, `excel2007`, `tsv`) e importa archivos subidos (`import_csv`, `import_xlsx`) con asistente y permiso `import/run`; no lee URLs ni Sheets. ERPNext exporta CSV/Excel y su Data Import acepta una URL de hoja pero pública (grounding §7.1). Sin novedad en Sheets más allá de lo ya documentado.

**Código de motor2.** `TablaReporte` exporta `.xlsx` en el cliente. No hay import de catálogo.

**Recomendación.** G1: diferir; el contador puede subir el `.xlsx` a mano. G2: si se hace, importar CSV/XLSX subido, no un selector de Sheets; evita OAuth y hoja pública. **No verificado**: si el export CSV de Dolibarr escapa fórmulas (motor2 ya tiene ese arreglo).

## 4. Hallazgos que afectan diseños ya pensados

1. **El índice único de factura no contempla la anulación.** Existe `Operacion_factura_unica_key` (`sucursalId, proveedorId, nroFactura` donde `nroFactura` no es nulo y `proceso='COMPRA'`; migración `20260920220000_factura_unica_compra`). Su propio comentario dice que no cubre la anulación (K1b/K1c). Inferencia: al anular una compra el número sigue ocupado, y «anular y recargar» chocaría con el índice salvo que se ajuste. Hay que verificarlo al diseñar. Recordar que aplicar el índice en Neon sigue pendiente (p2109 §2).
2. **Valuación de la Devolución.** ERPNext valúa una devolución con referencia al `incoming_rate` de la compra original. Motor2 valúa la Devolución al costo de hoy.
3. **`Operacion.anuladaEn` / `anuladaPorId` ya existen** con el comentario «Solo VENTA». Extenderlas a `COMPRA` no requiere migración, pero sí cambiar validaciones y reportes. No existe `anularCompra`, `corregirCompra` ni `NotaCredito` en `src/`.
4. **Corrección a `grounding-reportes-compras-2026-09-18.md`:** el documento dice que hay «un chequeo» de factura repetida; además del chequeo de aplicación hay un índice único parcial en la base (ver punto 1).
5. **Referencia de línea desactualizada:** `docs/grounding-pendientes-2026-09-18.md` §4 ubica `costoUnitarioVenta` en `schema.prisma:895`; hoy está en la línea 901. Menor.

## 5. Limitaciones

- **La mayoría de las lecturas de código fuente pasaron por WebFetch**, que devuelve un resumen hecho por un modelo chico, no el archivo íntegro. Los nombres de funciones, opciones y números de línea salen de esos resúmenes. Confirmar contra el archivo antes de citar literalmente. El agente de alertas/Drive leyó los archivos con `gh api` sobre `develop` (Dolibarr `4aae4a5`, Frappe `2ce13cc`), por lo que sus números de línea son de esos SHAs.
- **No verificado:** origen de `frappe.boot.user.last_selected_values`; `dol_set_user_param`; permisos de cancelar en ambos sistemas; si Dolibarr bloquea desvalidar una compra cuyo stock ya salió; cómo cambia la valuación de ERPNext ante un ajuste de precio sin devolución; si el módulo multi-moneda de Dolibarr está activo por defecto; el estado del issue #39956; módulos de terceros de Drive/Sheets en Dolistore; el manual de Cancel/Amend de ERPNext (apoyado en el buscador y en `amended_from`).
- **Ausencias** (E3, ratio compras/ventas, pivot en Dolibarr): concluidas por búsquedas dirigidas, no por lectura exhaustiva de los repositorios.
- Varias páginas de la wiki de Dolibarr y de docs de ERPNext dieron 404; se apoyó en código.
- Las recomendaciones y las preguntas de alcance son criterio del investigador, no probadas con el usuario ni con casos reales de la demo.
- Solo lectura: no se ejecutó ni se editó nada del repositorio.

## 6. Fuentes

**ERPNext / Frappe (`develop`)**
- `frappe/defaults.py`, `frappe/model/utils/user_settings.py`, `frappe/model/create_new.py`, `frappe/public/js/frappe/model/create_new.js`, `frappe/public/js/frappe/form/controls/link.js`
- `frappe/core/doctype/file/file.py`, `frappe/email/doctype/notification/notification.json` y `notification.py`, `frappe/hooks.py`
- `erpnext/stock/doctype/item_default/item_default.json`
- `erpnext/stock/doctype/stock_reconciliation/stock_reconciliation.js` y `.py`, `erpnext/stock/doctype/stock_entry/stock_entry.py`
- `erpnext/buying/report/purchase_analytics/purchase_analytics.js`, `erpnext/selling/report/sales_analytics/sales_analytics.js`, `erpnext/stock/report/stock_analytics/stock_analytics.js`
- `erpnext/accounts/report/gross_profit/gross_profit.py` y `.js`
- `erpnext/stock/stock_ledger.py`, `erpnext/controllers/sales_and_purchase_return.py`, `erpnext/controllers/buying_controller.py`, `erpnext/accounts/doctype/purchase_invoice/purchase_invoice.json`
- https://github.com/frappe/erpnext/issues/27297
- https://discuss.frappe.io/t/remember-last-selected-value/105742
- https://docs.frappe.io/erpnext/user/manual/en/multi-currency-accounting
- https://docs.frappe.io/erpnext/repost-item-valuation
- https://docs.frappe.io/framework/user/en/desk/reports/report-builder
- https://docs.frappe.io/framework/user/en/desk/attachments

**Dolibarr (`develop`)**
- `htdocs/user/class/user.class.php`, `htdocs/product/card.php`
- `htdocs/product/inventory/class/inventory.class.php`
- `htdocs/margin/lib/margins.lib.php`, `htdocs/margin/admin/margin.php`, `htdocs/margin/productMargins.php`, `htdocs/langs/en_US/margins.lang`
- `htdocs/fourn/class/fournisseur.facture.class.php`, `htdocs/fourn/facture/card.php`
- `htdocs/multicurrency/class/multicurrency.class.php`
- `htdocs/core/boxes/box_produits_alerte_stock.php`, `htdocs/product/stock/replenish.php`, `htdocs/product/stock/class/productstockentrepot.class.php`
- `htdocs/core/class/notify.class.php`, `htdocs/core/triggers/interface_50_modNotification_Notification.class.php`
- `htdocs/core/lib/files.lib.php`, `htdocs/document.php`, `htdocs/core/modules/modECM.class.php`
- `htdocs/core/modules/modImport.class.php`, `modExport.class.php`, `htdocs/imports/import.php`
- https://wiki.dolibarr.org/index.php/Table_llx_user_param
- https://wiki.dolibarr.org/index.php/Module_Margins
- https://wiki.dolibarr.org/index.php/Module_Products
- https://wiki.dolibarr.org/index.php/Module_Suppliers_Invoices
- https://wiki.dolibarr.org/index.php/Module_Customers_Invoices
- https://wiki.dolibarr.org/index.php/Module_Multi-currency
- https://wiki.dolibarr.org/index.php?title=Module_Notification
- https://github.com/Dolibarr/dolibarr/issues/39956 (solo título)

**Internas de motor2:** `docs/p2109.md`, `docs/grounding-pendientes-2026-09-18.md`, `docs/grounding-reportes-compras-2026-09-18.md`, `docs/grounding-compras-correccion-y-notas-de-credito-2026-09-19.md`, `docs/comparativa-ux-erpnext-dolibarr.md`, `prisma/schema.prisma`, `src/core/reportes/periodo.ts`, `src/core/stock/alertas.ts`, `src/core/movimientos/idempotencia.ts`, `src/server/actions/movimientos/venta.ts`, `src/server/actions/catalogo/productos.ts`.
