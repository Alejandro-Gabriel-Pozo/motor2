# Comparativa UX contra ERPNext y Dolibarr

Expediente de la diligencia técnica corrida el 2026-09-15 contra código real de
[ERPNext](https://github.com/frappe/erpnext) (+ [frappe](https://github.com/frappe/frappe),
rama `develop`) y [Dolibarr](https://github.com/Dolibarr/dolibarr) (rama `develop`) —
pensado para portarse también al proyecto Apps Script original (`motor`), no solo
para motor2. Cada hallazgo cita archivo y línea real; donde algo no se pudo
verificar, se marca explícitamente en vez de inventarlo.

Convención: **VERIFICADO** = confirmado leyendo el código fuente citado. **NO
ENCONTRADO** = búsqueda exhaustiva sin resultado positivo (ausencia confirmada,
no simple desconocimiento).

---

## 1. Conteo físico (inventario)

**Brecha real** — motor2 hoy es "un producto a la vez" (elegís producto,
sección, tipeás el conteo real, confirmás). Los dos sistemas de referencia
usan el mismo patrón entre sí, distinto al de motor2:

### Cómo lo resuelven ambos

- **Grilla precargada, no producto por producto.** Al iniciar el conteo (botón
  "Fetch Items from Warehouse" en ERPNext, "Validate (Start)" en Dolibarr), el
  sistema arma automáticamente una tabla con **todo el stock de ese
  almacén/sección**, una fila por producto (y lote si aplica), con la cantidad
  del sistema ya precargada. El usuario solo tipea lo que difiere — dejar el
  campo vacío significa "sin cambios".
  - ERPNext: `stock_reconciliation.js:112-176` arma el prompt, el server
    (`stock_reconciliation.py:1269-1319`) devuelve `qty = current_qty`, o sea
    la cantidad contada arranca igual a la del sistema.
  - Dolibarr: al Validar (`inventory.class.php:248-368`), inserta una fila por
    cada `(almacén, producto, lote)` con `qty_stock` = stock real actual.
- **Modo escaneo, para conteo a ciegas real.** ERPNext tiene un checkbox
  "Scan Mode" que *apaga* el precargado (`stock_reconciliation.json:156-167`,
  el aviso literal es *"Scan mode enabled, existing quantity will not be
  fetched"*). Dolibarr tiene una caja de texto donde se pegan/escanean
  muchos códigos de una — reparte cantidades automáticamente entre las filas
  ya existentes (`inventory.php:710-947`).
- **Borrador primero, nada toca stock hasta confirmar.** Los dos separan
  claramente "contar" de "aplicar":
  - ERPNext: `is_submittable`, Draft = docstatus 0 (no toca el ledger),
    Submit (`stock_reconciliation.py:116-122`) recién ahí escribe
    movimientos y asientos contables.
  - Dolibarr: botón **Save** (guarda cantidades) vs. botón separado
    **"Generate movements and close"** con diálogo de confirmación
    (`inventory.php:1290-1292`, `:649-658`).
- **Motivo/razón por línea: ninguno de los dos lo tiene.** Grep exhaustivo en
  ambos esquemas (`stock_reconciliation_item.json`, DDL de
  `llx_inventorydet`) — cero campo de nota o motivo por fila. Solo el header
  admite un comentario genérico. **motor2 ya está mejor acá**: Conteo Físico
  tiene "Detalle/causa" y una `Accion` (AJUSTAR/FALTA_MOVIMIENTO/DESCARTAR)
  por fila.
- **La diferencia (contado vs. sistema) no se muestra prominente mientras se
  cuenta.** ERPNext la calcula en vivo (`stock_reconciliation.js:233-240`)
  pero los campos `quantity_difference`/`amount_difference` no están en las
  columnas por defecto de la grilla — hay que expandir la fila o
  configurarlas. Dolibarr directamente no la muestra en pantalla en ningún
  momento — solo aparece en el PDF, y solo después de cerrar el conteo
  (`pdf_standard_inventory.modules.php:338-358`).

### Traducido a "qué haría distinto motor2"

Pasar de un formulario "un producto por vez" a una vista por sección que
**ya trae todos los productos elegibles con su saldo teórico actual**, donde
tipear en una fila es la única acción — el resto queda "sin cambios" por
default. Confirmar/cerrar el conteo como paso explícito separado de guardar
cantidades parciales (ya existe algo de esto vía `FALTA_MOVIMIENTO`, pero no
como flujo "guardar borrador, cerrar después"). No hace falta copiar el modo
escaneo ni el motivo por línea — en motivo, motor2 ya está mejor que los dos.

---

## 2. Reportes — filtros, orden, export, drill-down

**Brecha real, ya resuelta en su mayor parte** (2026-09-15): los ~16
reportes de motor2 eran tablas HTML planas: sin orden de columna, sin
exportar a nada, sin links entre reportes relacionados.

### Cómo lo resuelven ambos

- **Encabezados de columna clickeables para ordenar**, con flecha de
  dirección — Dolibarr: `html.lib.php:2798-2907`
  (`getTitleFieldOfList`/`print_liste_field_titre`), clase `liste_titre_sel`
  en la columna activa. ERPNext: sort selector estándar en toda lista
  (`base_list.js:302-313`) + agrupar por cualquier campo.
- **Fila de filtros bajo los encabezados**, un control por columna (texto,
  rango de fecha, dropdown de almacén/estado) — Dolibarr:
  `movement_list.php:1229-1294` (ejemplo real: fecha desde/hasta, ref,
  producto, lote, almacén, todo en la misma fila). ERPNext arma filtros
  "estándar" automáticamente desde los campos del doctype marcados
  `in_standard_filter` (`base_list.js:1136-1251`), más filtros tipados por
  reporte (Query Reports declaran su propio set — ejemplo real,
  `stock_balance.js:5-147`: rango de fechas, ítems, almacenes, checkboxes).
- **Elegir qué columnas ver, sin developer, y que se acuerde la próxima
  vez.** Dolibarr: dropdown de checkboxes por columna
  (`html.form.class.php:11053-11139`), guardado por usuario y por página
  (`actions_changeselectedfields.inc.php:40-53`). ERPNext: "Configure
  Columns" arrastrable (`grid_row.js:370-420`), persistido como
  `GridView` por usuario; en Report View también hay "Add Column" que
  trae campos de tablas relacionadas (`report_view.js:375-400`).
- **Guardar una vista/filtro entera y compartirla.** ERPNext guarda la
  combinación filtros+columnas+orden como un `Report` (Report Builder,
  `reportview.py:363-388`) o como "List Filter" con nombre, marcable
  como visible para todo el equipo (`layout_dialog.js:5-70`). Dolibarr lo
  resuelve como **bookmark de la URL** (arrastra los `search_*` actuales,
  `bookmarks.lib.php:40-77`) más un panel de admin para fijar
  filtro/orden por defecto de una lista (`admin/defaultvalues.php`).
- **Exportar.** ERPNext: botón "Export" directo en cada lista/reporte, CSV o
  Excel (`report_view.js:1751-1870`, `report_utils.js:173-231`), más
  Print/PDF con letterhead. Dolibarr lo separa en un wizard de export aparte
  (CSV ISO, CSV UTF-8, TSV, Excel) con "modelos" de export reutilizables
  (`htdocs/exports/export.php`) — no es un botón en la lista misma.
- **Drill-down entre reportes, con el filtro actual "viajando".** Ejemplo
  real ERPNext: el reporte de Balance de Stock tiene un botón "View Stock
  Ledger" que te manda al reporte de movimientos con el mismo
  almacén/fecha ya aplicado (`stock_balance.js:161-166`). Dolibarr hace lo
  mismo desde "stock a una fecha" hacia el listado de movimientos
  (`stockatdate.php:774-798`), y ojo: **apaga el link cuando el filtro no
  se puede expresar en la URL de destino** — un detalle de honestidad de UX
  a copiar (no ofrecer un link que después no filtra bien).

### Traducido a "qué agregar en motor2"

Por costo/beneficio, en orden:
1. **Links de drill-down** entre reportes relacionados — el más barato,
   ningún backend nuevo, solo `<Link href="...?param=...">`.
2. **Encabezados ordenables** — un helper de tabla compartido, sort
   client-side sobre los datos ya traídos (no hace falta tocar queries).
3. **Exportar a CSV** — un botón por reporte que arma el CSV a partir de los
   datos ya computados (no existe hoy ningún export, ni siquiera el que
   Apps Script sí tenía — `exportarReporteperiodoCSV` nunca se portó).
4. Filtros más completos (rango de fecha en los reportes que no lo tienen)
   — el que más justifica ya tener un dato que hoy no se puede acotar.
No hace falta el motor de "vistas guardadas" de ninguno de los dos — es
demasiado para el tamaño de este negocio.

### Estado: 1-3 implementados (2026-09-15)

`src/components/tabla-reporte.tsx` — tabla genérica client-side con orden
por columna (clic en encabezado, flecha ▲/▼) y export a CSV (BOM UTF-8,
separador `,`, valores entre comillas). Se usa en los ~16 reportes bajo
`/reportes/*`, con links de drill-down hacia `/reportes/historial
?productoId=...` donde el reporte tiene un producto identificable.

Un detalle no obvio de esta porción, para no repetir el error: `<TablaRepor
te>` es `"use client"`, así que las columnas (`render`/`valor`, que son
funciones) **no pueden definirse en el Server Component de cada `page.tsx`
y pasarse como prop** — Next.js corta la serialización RSC ahí ("Functions
cannot be passed directly to Client Components"), cosa que `tsc`/Vitest no
detectan (ninguno ejercita el árbol de Server→Client real) y que solo salió
a la luz corriendo la app de verdad. La solución adoptada: cada reporte
tiene un `tabla-<nombre>.tsx` chico con `"use client"` propio, que define
las columnas y envuelve `<TablaReporte>` — el `page.tsx` (Server Component)
solo hace fetch de datos planos y se los pasa como prop. Mismo motivo por
el que `reportes/conteos/page.tsx` mapea las filas de Prisma a un DTO plano
antes de pasarlas: los `Decimal` de Prisma tampoco cruzan ese límite.

Punto 4 (filtros de fecha donde faltan) quedó afuera a propósito: la
mayoría de los reportes ya tiene el filtro que corresponde (rango de fecha,
días atrás) o es una foto del estado actual sin ventana temporal que
filtrar (ej. Salud por producto, Diferencias de ajuste) — no había
brecha real que cerrar ahí, más allá de las dos ya cubiertas.

---

## 3. Número de factura del proveedor — corrección a un hallazgo previo

**No es una brecha.** Se había señalado como "no ERP" que el campo acepte
cualquier texto — verificado que **los dos sistemas de referencia hacen
exactamente lo mismo**, a propósito: es el número que puso el proveedor en
su propio papel, no algo que la empresa controla, así que no hay charset
"correcto" que exigir.

- ERPNext (`bill_no` en Purchase Invoice, `purchase_invoice.json:399-409`):
  `Data` sin `options`, sin regex — Frappe solo valida formato en campos
  `Data` cuyo `options` sea `Email/Name/Phone/URL/Barcode/IBAN`
  (`model/__init__.py:82`), no es el caso acá. Único tope: 140 caracteres
  (límite genérico de cualquier campo `Data`). Duplicado: chequeo
  **opcional, apagado por defecto** (`check_supplier_invoice_uniqueness`
  en Accounts Settings) por proveedor + año fiscal.
- Dolibarr (`ref_supplier` en `FactureFournisseur`,
  `fournisseur.facture.class.php`): `<input type="text">` sin `maxlength`
  ni `pattern` (`fourn/facture/card.php:2977-2985`), la única limpieza es
  un `trim()`. Duplicado: acá sí es un **índice único en la base**
  (`ref_supplier, fk_soc, entity`) — siempre activo, no opcional — y el
  error se muestra recién al guardar, no antes.

**motor2 ya se comporta igual o mejor**: el campo es texto libre (correcto)
y ya tiene el chequeo de "no repitas este número con este proveedor en esta
sucursal" (`movimientos.ts:216-218`) — sin necesitar apagarlo/prenderlo
como ERPNext. Lo único que falta, cosmético y de baja prioridad, es un tope
de longitud razonable (Dolibarr usa varchar(180); motor2 no tiene límite).

---

## 4. Inputs de dinero y cantidad — ya implementado en motor2

**Brecha real, ya resuelta** (commit `Reemplazar <input type=number> por
CampoNumero en plata y cantidades`, 2026-09-15). Se deja documentado acá
igual porque es el hallazgo más directamente portable al proyecto Apps
Script (que tiene el mismo problema en sus formularios HTML).

- Ninguno de los dos usa `<input type="number">` (el spinner nativo del
  navegador) para plata ni cantidad. Los dos son `<input type="text">`:
  - ERPNext: `ControlCurrency extends ControlFloat extends ControlInt
    extends ControlData` — ninguna de esas clases define `input_type`
    distinto de `"text"` (`controls/data.js:3-17`, `float.js:1`,
    `currency.js:1`). Formatea con separador de miles al mostrar
    (`format_number`), sin reformatear en cada tecla
    (`trigger_change_on_input_event = false`), selecciona todo el valor al
    enfocar, y hasta evalúa expresiones aritméticas tipeadas (`12*3` → 41).
  - Dolibarr: plantilla estándar de líneas de compra/venta
    (`objectline_create.tpl.php:513-607`) — `price_ht`, `qty`,
    `remise_percent`, todos `type="text"`. El símbolo de moneda se imprime
    en un `<span>` al costado, nunca dentro del valor editable
    (`commonobject.class.php:8162-8166`). Acepta coma o punto como
    decimal según el idioma del usuario (`price2num`,
    `functions.lib.php:4655-4740`).
- **motor2 ahora hace lo mismo**: `src/components/campo-numero.tsx`, texto
  sin spinner, formato es-AR al perder foco, valor crudo mientras se edita,
  símbolo `$` opcional al costado. Portado a los 14 campos reales de plata/
  cantidad de la app.

---

## Resumen para portar a Apps Script (`motor`)

| Hallazgo | Estado en motor2 | Aplica a Apps Script |
|---|---|---|
| Conteo físico "un producto a la vez" vs. grilla precargada | Brecha abierta | Sí — mismo patrón "un producto por vez" en `PanelConteoFisico.html` |
| Reportes sin orden/export/drill-down | **Resuelto en motor2** (orden, CSV, drill-down) | Sí — los reportes de Apps Script (`Reportes.js`) tienen la misma limitación de base, aunque ahí el export a Sheets es más directo que un CSV |
| Número de factura sin validar formato | **No es brecha** — ambos ERPs de referencia hacen lo mismo | No aplica un fix — si Apps Script ya valida algo ahí, no hace falta tocarlo |
| `<input type="number">` nativo en plata/cantidad | **Resuelto en motor2** | Sí — los HTML de Apps Script (`PanelOperacion.html`, etc.) probablemente tienen el mismo `type="number"` nativo |

Fuentes primarias completas (con más citas de archivo:línea de las
resumidas acá) quedan en el historial de esta sesión — este documento es el
resumen curado para llevar al otro proyecto, no un volcado íntegro.
