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

**Brecha real, ya resuelta** (2026-09-15) — motor2 era "un producto a la vez" (elegís producto,
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

### Estado: implementado (2026-09-15)

`src/app/movimientos/conteo-fisico/conteo-fisico-grid.tsx` reemplaza por
completo el formulario "un producto a la vez". Decisiones de diseño,
grounded contra ambos ERPs de referencia:

- **Alcance por sección, no total** — mismo criterio que ERPNext
  (`stock_reconciliation.js`: el campo `Warehouse` es `reqd: 1`, un solo
  valor, no hay modo "toda la empresa junta"). Dolibarr sí permite dejar
  `fk_warehouse` vacío y traer stock de todos los almacenes a la vez
  (`inventory.class.php::validate()`, el filtro `AND ps.fk_entrepot = X`
  solo se aplica `if ($this->fk_warehouse > 0)`), pero es la excepción
  técnica, no el flujo recomendado — no se portó. Con una sola sección
  activa en la sucursal (caso real de este negocio), se preselecciona sola
  y el efecto práctico es "toda la sucursal", sin necesitar el modo
  cross-sección de Dolibarr.
- **Precarga automática** — `listarStockParaConteo` (`src/core/movimientos/
  stock.ts`) trae una fila por cada combinación (producto, lote) con saldo
  != 0 en la sección, mismo criterio que ERPNext (`get_items` arma la
  grilla a partir de la tabla `Bin` — solo lo que ya tiene historial de
  stock ahí, nunca el catálogo entero) y que Dolibarr (una fila por
  `(almacén, producto, lote)`). Saldo 0 se excluye a propósito: nada que
  verificar ahí.
- **"+ Agregar producto"** — el escape para el caso real de un ítem que
  nunca se contó ni tiene factura (está físicamente, el sistema no sabe
  nada de él): en ERPNext el fetch por Bin tampoco lo trae solo, pero Stock
  Reconciliation permite agregar una fila a mano igual, y al confirmarla
  esa queda como el primer movimiento real de ese producto en ese almacén.
  Mismo mecanismo en motor2: una fila manual con saldoSistema=0, y al
  confirmarla genera el mismo `ConteoFisico`/`MovimientoStock` `CONTROL`
  de siempre (`registrarConteoFisico` nunca exigió historial previo) — no
  hizo falta ningún proceso nuevo.
- **Diferencia en vivo por fila**, calculada client-side mientras se tipea
  — mismo que `stock_reconciliation.js:233-240` en ERPNext (aunque ahí no
  está en las columnas por defecto; acá sí, siempre visible).
- **Acción por fila (Ajustar/Falta movimiento/Descartar), no una sola para
  todo el lote** — ninguno de los dos ERPs de referencia tiene este
  concepto (ya señalado arriba como punto a favor de motor2), así que se
  preservó como estaba en el formulario individual en vez de degradarlo a
  una sola elección para toda la sesión de conteo.
- **Motivo/detalle**: se mantiene opcional por fila, igual que en el
  formulario individual.

Cada fila tipeada dispara su propio `registrarConteoFisico` (secuencial,
no en batch) — reutiliza 100% la validación/lógica ya existente y probada,
sin server action nueva para el alta. Lo único nuevo del lado servidor es
la consulta de lectura (`listarStockParaConteo`) y un lookup de producto
por id para mostrar la etiqueta de una fila agregada a mano
(`obtenerProductoOpcion`).

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

## 5. Shell de navegación — sin persistencia global, ya resuelto

**Brecha real, ya resuelta** (2026-09-15). No es un hallazgo de una
pantalla puntual como los anteriores — es estructural: `src/app/layout.tsx`
(el layout raíz) no tenía nav. Cada una de las 6 secciones
(`administracion`, `catalogo`, `movimientos`, `reportes`, `stock`,
`traspasos`) tenía su **propio** `layout.tsx`, reimplementando a mano el
mismo header y su propio array de links — para ir de una sección a otra no
había menú, solo links tipo `"← Catálogo"` / `"Reportes →"` insertados a
mano apuntando a la sección vecina (navegación tipo lista enlazada, cada
sección solo conocía a su vecina inmediata). En Reportes eso eran 19 links
grises en una sola fila envuelta en 2 líneas, sin agrupar, sin marcar en
cuál estás parado.

### Cómo lo resuelven ambos

- **Dolibarr** (`htdocs/main.inc.php::llxHeader()`, verificado): UNA
  función central llama a `top_menu()` + `left_menu()` en cada página —
  top bar + sidebar persistentes, nunca duplicados por módulo.
- **ERPNext** (local, `frappe/public/scss/desk/sidebar.scss`,
  `public/js/frappe/ui/toolbar/navbar.html`): top navbar fijo + sidebar
  colapsable organizado por Workspace (grupos de módulos con sub-ítems).

### Estado: implementado (2026-09-15)

- `src/core/navegacion/estructura.ts` — fuente única del árbol de
  navegación (6 grupos, uno por sección, cada uno con sus ítems), donde
  antes había 6 arrays `SECCIONES` duplicados con criterio propio cada uno.
- `src/components/app-shell.tsx` + `src/components/sidebar-nav.tsx` —
  sidebar persistente con los 6 grupos siempre visibles (colapsables, el
  grupo de la ruta activa se abre solo sin cerrar los que el usuario ya
  tenía abiertos), reemplaza los 6 `layout.tsx` de sección — ahora hay uno
  solo, `src/app/(app)/layout.tsx`, que gatea sesión una sola vez para
  las 6 secciones (route group `(app)`, invisible en la URL).
- Bug de fuente encontrado de paso: `globals.css` tenía `body {
  font-family: Arial, Helvetica, sans-serif }` pisando la fuente Geist que
  `layout.tsx` sí cargaba pero que nada aplicaba — toda la app renderizaba
  en Arial por accidente. Corregido a `font-family: var(--font-sans), ...`.
- Bug de spacing encontrado de paso: las tablas (`TablaReporte` y las de
  Conteo Físico) no tenían padding horizontal entre columnas — visible como
  texto de encabezado pegado (`DiferenciaAcción`). Corregido con `px-2` en
  `<th>`/`<td>`, beneficia a los ~18 reportes de una sola vez al estar en
  el componente compartido.

No se portó el resto del shell de ninguno de los dos ERPs de referencia
(buscador global, notificaciones, selector de sucursal en el navbar) — no
hay pedido de eso todavía, y el negocio no lo necesita con 5 sucursales
fijas conocidas de antemano.

---

## 6. Ayuda contextual y guía al usuario — grounding del asistente de hermanar

Investigación puntual (2026-09-16) pedida para dar respaldo real a
`AsistenteHermanar` (`src/components/catalogo/asistente-hermanar.tsx`), el
wizard de 3 pasos (buscar → confirmar/nombrar) que reemplazó el `<select>`
crudo de Insumo en `producto-form.tsx` porque "no me parece que sea
intuitivo". Pregunta: ¿cómo ayudan ERPNext y Dolibarr a un usuario que no
conoce el modelo de datos a tomar decisiones no obvias, más allá de un
dropdown?

### 6.1 Ayuda de campo (texto inline, tooltips)

**VERIFICADO en los dos.**

- **ERPNext/Frappe**: cada campo de un DocType puede declarar
  `"description"` en su JSON — ejemplo real, `item.json:242`
  (`is_stock_item`): *"ERPNext will make a stock ledger entry for each
  transaction of this item. Keep unchecked for non-stock or service
  items."*, o `item.json:170` (`variant_of`) explicando qué campos se
  heredan de la plantilla. En el cliente, `BaseInput.set_description()`
  (`base_input.js:223-234`) vuelca ese texto a un `<div class="help-box">`
  bajo el campo — persistente, no desaparece al tipear ni al perder foco
  (a diferencia de un placeholder). El mismo método se reusa para mensajes
  de error contextuales en runtime (ej. `barcode.js`: `Invalid Barcode: …`).
- **Dolibarr**: `Form::textwithpicto()` — un ícono "?" al lado del label
  que muestra el texto de ayuda al hover, sin ocupar espacio en el layout.
  No es solo para pantallas de configuración: se usa también en líneas de
  documentos reales, ej. `objectline_title.tpl.php:61` — el label "Qty" de
  una línea de BOM con el tooltip *"QtyRequiredIfNoLoss"* explicando la
  regla no obvia (cantidad requerida si no hay pérdida configurada).

### 6.2 Wizards guiados / asistentes paso a paso

**Existe, pero acotado a alta inicial — NO ENCONTRADO para carga de datos
del día a día.**

- ERPNext tiene un framework genérico de wizard multi-paso,
  `frappe.ui.Slides`/`frappe.ui.Slide` (`slides.js`), del que
  `SetupWizard extends frappe.ui.Slides` (`setup_wizard.js:94`, slides
  concretos en `:365`). Grep en los dos repos completos (`frappe` +
  `erpnext`) por `frappe.ui.Slides`: **el único consumidor es el propio
  Setup Wizard** — no hay ningún otro flujo del día a día (crear un
  producto, una factura, un asiento) que use este framework de pasos.
- Lo que ERPNext y Dolibarr usan en su lugar para decisiones no obvias es
  un **diálogo único** (no una secuencia de pantallas):
  - ERPNext, "Crear variantes de un Item" — `item.js:1300-1511`. Un solo
    `frappe.ui.Dialog` con checkboxes por cada valor de atributo
    (`"Select Attribute Values"`, `item.js:1302`) y un botón que dice
    cuántas variantes va a crear en vivo (`update_primary_action`,
    `item.js:1283-1298`, ej. "Make 3 Variants"). No hay pasos ni
    navegación atrás/adelante — es una sola pantalla con selección
    dinámica, más simple que el wizard de motor2.
  - Frappe, renombrar un documento — `toolbar.js:229-284`: diálogo único
    con un checkbox **"Merge with existing"** (`:277-281`): si el nuevo
    nombre coincide con un doc ya existente, en vez de fallar ofrece
    fusionarlos. Mecanismo genérico de la plataforma, no específico de
    ningún doctype.
  - Dolibarr, "Fusionar terceros" — botón dedicado en la ficha
    (`societe/card.php:3572`) que abre un `formconfirm` con **un solo
    campo**: un selector de empresa con autocompletado
    (`select_company()`, no un `<select>` plano) para elegir el tercero
    "origen" a fusionar (`societe/card.php:3005-3015`,
    `mergeCompany($soc_origin_id)` en `:232`). Mismo problema de fondo que
    "hermanar" (dos registros para la misma entidad real, cargados por
    separado) — pero resuelto en un solo diálogo de confirmación, no en
    pasos.
- **Conclusión**: el patrón de motor2 (pasos secuenciales con estado
  propio: buscar → confirmar/nombrar, cada uno con su propia pantalla) no
  tiene precedente en el código real de ninguno de los dos ERPs de
  referencia para una tarea de carga de datos — ambos resuelven el mismo
  tipo de problema (fusionar/asociar registros) con un diálogo único, no
  con un wizard de varias pantallas. El wizard de pasos como técnica sí
  existe en ERPNext, pero reservado a la instalación inicial.

### 6.3 Sugerencias mientras se tipea / detección de duplicados

**Autocompletado real: VERIFICADO. Fuzzy-matching "¿quisiste decir…?":
NO ENCONTRADO en ninguno de los dos.**

- ERPNext: el campo Link busca contra el servidor en cada tecla
  (`on_input`, `link.js:446-546`, método `frappe.desk.search.search_link`)
  y, si el usuario tiene permiso de creación, agrega siempre una opción
  **"Create a new {X}"** al final de la lista de resultados
  (`link.js:497-510`) — el mismo patrón "buscar primero, crear si no
  está" que el paso 1 de `AsistenteHermanar`. `merge_duplicates()`
  (`link.js:553-566`) solo junta filas con el mismo `value` exacto — no
  detecta nombres parecidos ("Coca Cola" vs "Coca-Cola").
- Dolibarr: la unicidad de nombre de tercero es un constraint de base
  (`DB_ERROR_RECORD_ALREADY_EXISTS`) atrapado recién al guardar
  (`societe.class.php:1157-1159`, mensaje `ErrorCompanyNameAlreadyExists`)
  — reactivo, no una sugerencia mientras se tipea.
- Búsqueda dirigida por "similar name"/fuzzy/Levenshtein en ambos repos:
  sin resultados — **NO ENCONTRADO**.

### 6.4 Estado vacío (listas/tablas sin datos)

**VERIFICADO — contraste real entre los dos.**

- ERPNext, List View (`list_view.js:701-747`,
  `get_no_result_message()`): título "No {Doctype} found" (si hay
  filtros activos) o "No {Doctype} created" (si no), descripción que cae
  en cascada — "Clear the filters to see all records" → la
  `meta.description` del propio DocType (el mismo texto de 6.1) → "Create
  your first {Doctype} to get started" → "Nothing has been added yet."
  como último recurso —, más botones reales **"Create"** y
  **"Documentation"** (si el doctype tiene link a docs), armado por
  `frappe.ui.empty_state.html()`. Vistas más simples (Kanban, etc.) caen
  al default de la clase base, `base_list.js:352-354`: solo "Nothing to
  show".
- Dolibarr: `NoRecordFound` = *"No record found"* (`main.lang:43`), usado
  como texto plano en una fila de tabla — `company.lib.php:1837`,
  `company.lib.php:2657`, `html.lib.php:6011`. Sin botón, sin "creá tu
  primer X", sin sugerencia de qué hacer después — grep exhaustivo en las
  llamadas a `NoRecordFound` confirma que ninguna agrega un CTA al lado.

### 6.5 Otro mecanismo relevante — fusión como función de plataforma

Los tres mecanismos de "unir dos registros que resultaron ser la misma
entidad real" encontrados (Frappe rename+merge en 6.2, ERPNext duplicate
check de variantes en 6.2, Dolibarr Merge Thirdparties en 6.2) comparten
un rasgo: **existen como función genérica de la plataforma o de un solo
módulo (terceros/variantes), no como parte del formulario de alta**. El
usuario crea el registro duplicado primero (sin que nada lo avise en el
momento) y lo fusiona después, desde una acción separada. `AsistenteHermanar`
hace lo opuesto y es más temprano en el flujo: se ofrece **en el momento
de crear el producto nuevo**, antes de que el duplicado exista — ningún
mecanismo real de los dos ERPs de referencia hace esa prevención
proactiva en el propio formulario de alta.

### 6.6 Lista vs. editor — restructuración de `/catalogo/recetas`, grounded

**Pedido explícito del usuario**: que la pantalla de Recetas separe "ver
qué productos ya tienen receta" de "editar una receta puntual", como lo
hace Dolibarr — en vez de la vista de dos columnas que mezclaba las dos
cosas en una sola página.

**VERIFICADO contra Dolibarr real**: `bom_list.php` es la lista de BOMs
YA creados (consulta sobre `llx_bom`, no sobre el catálogo de productos
entero) con un botón "New" (`bom_list.php:514`,
`dolGetButtonTitle($langs->trans('New'), ...)`) que manda a
`bom_card.php?action=create` — una pantalla dedicada aparte. Clickear una
fila de la lista abre `bom_card.php?id=X`, el editor de ESA receta
puntual. Nunca la lista y el editor comparten pantalla.

Portado a motor2: `/catalogo/recetas` ahora lista solo productos con al
menos una `RecetaVersion` (antes listaba TODO producto elegible, tenga
receta o no). `NuevaReceta` (`nueva-receta.tsx`) es el equivalente del
botón "New" — un buscador que manda directo a
`/catalogo/recetas/[productoId]`, el editor dedicado (antes vivía en la
misma página vía `?id=`). Filtro nuevo en el selector,
`elegibleParaReceta` (`server/actions/productos.ts`) — criterio PV o MP
"Se produce", el inverso de `soloConStockReal`.

---

## 7. Hallazgos probando la demo real (30 días, pizzería "La Cuadra") — 2026-09-16

Sesión de prueba en vivo contra datos reales (no sintéticos ni de un solo
caso feliz) — surgieron tres brechas de UX, cada una con causa raíz
verificada en el código, no solo intuida.

### 7.1 "Costo incompleto" — estado sin acción, y un bug de fondo detrás

**Pedido del usuario**: un estado de la operación (ej. "costo incompleto"
en Reportes → Costos) no es un flag, es una condición con una necesidad de
remediación DISTINTA según la causa — mostrar el estado sin la acción para
resolverlo es dejarle al usuario la tarea de adivinar qué hacer y dónde.

**Encontrado al implementarlo**: `EstadoCosto` (`costos.ts`) ya separaba
`SIN_RECETA` de `COSTO_INCOMPLETO` a nivel de datos, pero esa granularidad
se perdía en el resto de reportes (`perdidas.ts`, `devoluciones.ts`,
`periodo.ts`, `resumen-operativo.ts`) — todos calculan su propio booleano
suelto (`costoIncompleto`/`hayCostoIncompleto`) sin causa ni acción
asociada.

Al armar el link accionable apareció un bug real, no solo de UI:
`calcularCostosYMargenes` buscaba precio de COMPRA para cada ingrediente
de receta — pero un MP "Se produce" (ej. la prepizza) nunca se compra, se
fabrica con su propia receta. Cualquier plato que usara un intermedio
fabricado quedaba SIEMPRE en `COSTO_INCOMPLETO`, sin importar qué tan
completos estuvieran los datos (verificado: antes del fix, la mayoría del
menú de la demo estaba en ese estado; después, cero).

**Estado: parcialmente resuelto (PR #5)** — agregado `resolverCostoUnitario`
(BOM recursivo con cache y corte de ciclos) + links accionables en
Reportes → Costos (`SIN_RECETA` → cargar receta, `SIN_PRECIO_VENTA` →
cargar precio, `COSTO_INCOMPLETO` → Compra del insumo faltante, o a SU
receta si ese insumo es "Se produce"). **Pendiente**: propagar la misma
distinción causa+acción a los otros 4 reportes que hoy solo muestran el
booleano plano.

### 7.2 Recetas — el editor no separa "ver" de "editar"

**Pedido del usuario**: "ver es distinto de querer editar" — comparado con
cómo lo resuelven ERPs como Dolibarr/ERPNext y los POS en general.

Nota: esto es DISTINTO del hallazgo §6.6 (ya resuelto) — §6.6 separó la
LISTA de productos-con-receta del EDITOR dedicado por producto
(`/catalogo/recetas` → `/catalogo/recetas/[productoId]`). Lo que falta acá
es más fino: DENTRO de esa página de editor
(`catalogo/recetas/[productoId]/page.tsx`), TODO se renderiza siempre como
formulario editable — la ficha técnica ya aparece como `<form>` con botón
"Guardar" visible, cada ingrediente tiene "Editar/Quitar" al lado, cada
paso también. No existe un modo lectura por default; entrar a ver una
receta ya te para en modo edición.

**Estado: parcialmente resuelto (2026-09-16, `2ed6ae6`)** — la Ficha
técnica (cabecera) y cada fila existente de Ingredientes/Pasos ya tienen
modo vista real (solo texto + "Editar", el form completo solo aparece
para la fila puntual en edición). **Verificado en la demo real
(2026-09-17) que la percepción de "sigue igual que antes" es correcta
igual**, por una causa distinta a la ya resuelta: los formularios
"Agregar ingrediente" (`page.tsx:296-332`) y "Agregar paso" (`:425-456`)
—altas nuevas, no ediciones de algo existente— se renderizan siempre,
sin ningún gate, intercalados en el medio del flujo de lectura (entre la
tabla de Ingredientes y Método de preparación, y al cierre de los Pasos).
Al ser formularios completos y no un link chico, ocupan tanto espacio
visual como las partes editables de antes — rompen la lectura igual,
aunque la causa ya no sea "todo es un `<form>`" sino "las altas están
siempre abiertas". Pendiente: colapsar ambos detrás de un link tipo
"+ Agregar ingrediente"/"+ Agregar paso", mismo patrón que ya usan
"+ Agregar destino" (Reclasificar stock) y "+ Agregar producto" (Conteo
físico, §1).

### 7.3 Reporte por período — tarjetas visualmente iguales para cifras no comparables

Ventas, Margen, Compras y Movimientos se muestran en la misma fila con el
mismo estilo — sugiere que son cifras relacionadas (`Margen = Ventas −
Compras`), pero no lo son: Compras es caja gastada en el rango de fechas
(sin relación temporal con lo vendido ese mismo rango — se puede comprar
insumos hoy para vender en dos semanas, o vender hoy con stock comprado el
mes pasado); Margen es ingreso de ventas menos costo de RECETA vigente HOY
(costo de reposición, no lo que realmente costó comprar en su momento). El
aviso que aclara esto (`periodo.ts:298-300`) SÍ existe en el código y SÍ se
renderiza (`periodo/page.tsx:62-63`), pero como texto gris chico al pie,
deprioritizado frente a la jerarquía visual de las 4 tarjetas iguales.

**Estado: no resuelto** — fix acotado (mover el aviso pegado a cada
tarjeta que lo necesita, ej. tooltip o subtítulo en "Margen" y "Compras"
en vez de una nota genérica al final).

**Ampliado (2026-09-17), probando la demo real**: por qué no se usó
`AyudaIcono` (`components/ayuda-campo.tsx:21-31`, el mismo "?" que ya usa
Rendimiento real de recetas) directo en la tarjeta — el `aviso` de cada
métrica (`periodo.ts:298-300`) es una oración completa por tarjeta, más
larga que lo que ese ícono está pensado para mostrar al lado de un label
corto; en vez de acortarlo o resolverlo distinto, se mandó como párrafo
suelto al final. Además, el problema NO está contenido solo acá: `/reportes`
(Resumen operativo — la primera pantalla al entrar a Reportes) muestra las
mismas 3 tarjetas (Ventas del mes / Margen del mes / Gastado en compras,
`reportes/page.tsx:20-36`) con el mismo problema de fondo, pero sin
ningún aviso — ni siquiera el párrafo deprioritizado que sí tiene
Período. Cualquier fix tiene que cubrir los dos lugares, no solo Período.

**Estado: parcialmente resuelto (2026-09-17)** — ver §9: los avisos ahora
viven pegados a cada tarjeta (vía `AyudaIcono`) en los dos lugares
(Período y Resumen operativo), y se agregó una segunda cifra ("Margen
real") que no tiene el descalce temporal de fondo. La tarjeta "Margen"
nominal se mantiene al lado — no se reemplazó, por las razones de §9.

---

## Resumen para portar a Apps Script (`motor`)

| Hallazgo | Estado en motor2 | Aplica a Apps Script |
|---|---|---|
| Conteo físico "un producto a la vez" vs. grilla precargada | **Resuelto en motor2** (grilla por sección, precarga, diferencia en vivo, "+ Agregar producto") | Sí — mismo patrón "un producto por vez" en `PanelConteoFisico.html` |
| Reportes sin orden/export/drill-down | **Resuelto en motor2** (orden, CSV, drill-down) | Sí — los reportes de Apps Script (`Reportes.js`) tienen la misma limitación de base, aunque ahí el export a Sheets es más directo que un CSV |
| Número de factura sin validar formato | **No es brecha** — ambos ERPs de referencia hacen lo mismo | No aplica un fix — si Apps Script ya valida algo ahí, no hace falta tocarlo |
| `<input type="number">` nativo en plata/cantidad | **Resuelto en motor2** | Sí — los HTML de Apps Script (`PanelOperacion.html`, etc.) probablemente tienen el mismo `type="number"` nativo |
| Sin shell de navegación persistente (6 headers duplicados, sin sidebar) | **Resuelto en motor2** (sidebar único, 6 grupos, `src/core/navegacion/estructura.ts`) | Parcial — `Nav.html` en Apps Script ya es un include único (no duplicado), pero vale revisar si agrupa por módulo o es una lista plana como era acá |
| Ayuda de campo solo en el `placeholder` (desaparece al tipear), sin texto de ayuda persistente para campos no obvios (ej. "Factor de conversión", "Es consignación") | **Brecha real, no resuelta** — ERPNext (`description` de DocField + `set_description()`, `base_input.js:223-234`) y Dolibarr (`textwithpicto`, ícono "?") muestran la ayuda sin depender de que el campo esté vacío | Sí — mismo problema en los formularios HTML de Apps Script, que también usan placeholder como única explicación |
| Estado de la operación ("costo incompleto", etc.) sin acción asociada — el usuario tiene que adivinar dónde resolverlo | **Parcialmente resuelto en motor2** (PR #5: links accionables + bug de BOM recursivo para MP "Se produce" en Reportes → Costos) — **pendiente**: propagar a `perdidas`/`devoluciones`/`periodo`/`resumen-operativo` | Sí — si Apps Script tiene el mismo concepto de "costo incompleto"/estados de reporte, aplica el mismo patrón causa+acción |
| Editor de Recetas sin modo lectura — todo se renderiza siempre editable (ficha técnica, ingredientes, pasos) | **No resuelto — estructural** (distinto de §6.6, que separó lista de editor; esto es DENTRO del editor) | Sí, si el HTML de recetas de Apps Script tiene el mismo patrón "todo editable siempre" |
| Reporte por período: tarjetas de Ventas/Margen/Compras/Movimientos visualmente iguales para cifras no comparables (Margen ≠ Ventas − Compras), aviso aclaratorio deprioritizado al pie | **No resuelto** — fix acotado, mover el aviso pegado a cada tarjeta | Sí, si Apps Script muestra un resumen similar sin aclarar la relación (o falta de ella) entre cifras |

Fuentes primarias completas (con más citas de archivo:línea de las
resumidas acá) quedan en el historial de esta sesión — este documento es el
resumen curado para llevar al otro proyecto, no un volcado íntegro.

---

## 8. Hallazgos probando la demo real (deploy en Vercel) — 2026-09-17

Sesión de prueba en vivo contra el deployment real (no local) de la demo,
ya con datos de varias sucursales cargados. Cinco hallazgos, cada uno con
causa raíz verificada en el código.

### 8.1 "(venta directa)" en Rendimiento real de recetas — ayuda no persistente, sin drill-down

**Pedido del usuario**: "no se entiende que se está diciendo" sobre el
texto que explica el desvío en filas marcadas `esTrivial`.

**Causa raíz**: `AYUDA_TRIVIAL` (`reportes/rendimiento-recetas/page.tsx:14-15`)
se muestra como atributo `title=` nativo del navegador sobre el texto
`(venta directa)` (`:148`, `:202`) — exactamente el antipatrón que
§6.1 de este mismo documento ya señaló como inferior: desaparece, solo
aparece al pasar el mouse (no funciona al tacto/mobile), no es
descubrible. La MISMA página sí usa el mecanismo persistente y correcto
(`<AyudaIcono texto={...} />`, ícono "?" clickeable) para las ayudas de
los encabezados de columna dos líneas más arriba (`:131`, `:135`) — dos
mecanismos de ayuda distintos conviviendo en la misma tabla, uno bueno y
uno malo. Además, la fila no linkea a `/reportes/historial?productoId=...`
(el drill-down que sí existe en los ~16 reportes de §2) para que el
usuario pueda ir a ver el historial real de ese producto y decidir si el
desvío es ruido de lote o señal real.

**Estado: resuelto (2026-09-17)** — el texto ahora cuelga de
`<AyudaIcono>` (mismo mecanismo que ya usaban los encabezados), y se
agregó un link "Ver historial" a `/reportes/historial?productoId=` del
INSUMO (no del plato — es el stock físico del insumo el que puede tener
rotura/robo, no el del plato vendido).

### 8.2 "Anular venta" — sin confirmación ni feedback de resultado

**Pedido del usuario**: "aparece como algo accionable, pero no pasa nada,
y ¿qué pasaría si se selecciona?"

**Causa raíz**: `trazabilidad/page.tsx:61-71` es un `<form action={...}>`
crudo que llama `anularVenta` (`server/actions/venta.ts:256-295`) y
**descarta el `ResultadoAccion` devuelto** — ni el mensaje de éxito ("Se
revirtieron N línea(s) de stock") ni un error (ej. "Esta venta ya está
anulada") llegan a la pantalla. El fix ya existe en el propio repo y no
se usó acá: `src/components/form-con-resultado.tsx`, construido
explícitamente para este problema ("`<form>` crudo no tiene ningún lugar
donde mostrar `ok:false`... un error queda invisible"). Tampoco hay
`confirm()` ni modal antes de ejecutar, pese a que la acción SÍ es
irreversible en el sentido de que genera movimientos de stock reales (un
`Operacion` tipo `AJUSTE` que revierte cada línea) — mismo patrón de
"pedir confirmación antes de una acción destructiva" que ya se aplicó en
Stock Mínimo (`6deb789`) y Conteo Físico (`aa02bb1`), pero no acá.

**Estado: resuelto (2026-09-17)** — `boton-anular-venta.tsx` nuevo,
mismo patrón de confirmación INLINE que `BotonEliminarStockMinimo`
(nunca `window.confirm`, es la convención real del proyecto): un paso
intermedio "¿Anular esta venta?" con Sí/Volver, y el mensaje de
`anularVenta` (éxito o error) ahora sí se muestra.

### 8.3 Sidebar colapsable no libera espacio en tablas anchas

**Pedido del usuario**: al ocultar el sidebar, "las columnas no se
acomodan, sigue todo apretado".

**Causa raíz**: la tabla de Rendimiento real de recetas tiene un
`max-w-4xl` fijo (`rendimiento-recetas/page.tsx:123`, `:180`) — un techo
de ancho absoluto (56rem/896px) que no reacciona al espacio real
disponible. `SidebarColapsable` (`sidebar-colapsable.tsx:53-55`) sí libera
~224px del viewport (`w-56` → `w-0`), pero como el ancho de la tabla nunca
depende de eso, ese espacio extra simplemente queda vacío al lado — la
tabla sigue envolviendo texto en 6-7 columnas dentro del mismo `896px` de
siempre. El propio docstring de `SidebarColapsable` (`:14-15`) dice que el
colapso se pensó justo para "tablas anchas como Costos o Rendimiento real
de recetas" — la intención estaba, pero el ancho fijo de la tabla la
neutraliza en este reporte puntual.

**Estado: resuelto (2026-09-17)** — `max-w-4xl` → `max-w-6xl` en las dos
tablas, y de paso se les agregó el `px-2` entre columnas que tampoco
tenían (mismo bug de spacing de §5, nunca habían pasado por
`TablaReporte`).

### 8.4 "ROTO_O_CAIDO" en Pérdidas y consumo interno — motivo crudo, sin producto ni fecha

**Pedido del usuario**: "no se entiende que se está diciendo, ¿hubo un
conteo y no se registró algo, o qué? [...] roto o caído ¿qué? ¿cómo lo
veo? ¿cuándo?"

**Causa raíz, dos bugs distintos en la misma fila**:
1. `generarReportePerdidas` (`core/reportes/perdidas.ts:82`) agrupa por
   `m.operacion.motivo` — el valor crudo del enum de Prisma (`ROTO_O_CAIDO`)
   — sin pasar por `MOTIVOS_MERMA` (`core/movimientos/ui-config.ts:6-13`),
   que ya tiene la etiqueta humana ("Roto o caído") y se usa al cargar la
   Merma, pero no al reportarla.
2. `FilaPerdida.productos` (`perdidas.ts:15`, `:56-73`) YA calcula el
   desglose por producto con su valor — el dato que responde "¿qué se
   rompió?" existe en el objeto que devuelve el server — pero
   `tabla-perdidas.tsx:6-19` nunca lo lee ni lo renderiza. Y como el
   reporte es un acumulado sobre toda la ventana de "días atrás" (sin fila
   por evento), no hay ninguna fecha que mostrar aunque se agregara el
   producto — para el "¿cuándo?" haría falta un link a
   `/reportes/trazabilidad` filtrado por ese producto y ventana de fechas.

**Estado: parcialmente resuelto (2026-09-17)** — arreglados los dos bugs
de la fila: `tabla-perdidas.tsx` ahora mapea el motivo por
`MOTIVOS_MERMA`/`DESTINOS_CONSUMO` y renderiza `m.productos` (una
columna nueva). El "¿cuándo?" sigue sin respuesta — requiere pasar de
"acumulado del período" a "un evento por fila" (o un link a
Trazabilidad), que es un cambio de forma del reporte, no un fix chico;
queda pendiente a propósito.

### 8.5 Reclasificar stock — fecha de lote por destino, sin arrastrar la del origen

**Pedido del usuario**: al repartir el saldo entre varios destinos, "¿en
ninguna tengo la fecha del stock que cargué? ¿el operario no sabe la
fecha, tendrá que ir a mirar el artículo físico?"

**Causa raíz**: `reclasificar-form.tsx` pide la fecha de lote de origen
UNA vez (`loteOrigen`, campo "Lote origen", `:118-121`) para calcular el
disponible, pero cada fila de destino tiene su PROPIO campo "Lote destino
(opcional)" independiente (`:147-150`), vacío por default y sin ningún
valor sugerido — no se precarga con `loteOrigen` ni se muestra ese valor
como referencia junto a la fila. Confirmado en el server
(`server/actions/reclasificacion.ts:135`): si el operario deja el campo
vacío en una fila, esa porción del stock se graba con
`loteVencimiento: null` — es decir, reclasificar un lote puntual sin
retipear la fecha en cada destino **pierde el vencimiento de ese stock**,
silenciosamente, no es solo un problema de comodidad. Si el operario no
recuerda la fecha de memoria, hoy no tiene forma de consultarla desde este
mismo formulario (no hay lookup ni eco del valor ya cargado como
`loteOrigen`).

**Estado: resuelto (2026-09-17)** — cada destino nuevo se precarga con
`loteOrigen`, y cambiar `loteOrigen` sincroniza las filas que el
operario todavía no tocó (las que ya tienen una fecha propia puesta a
mano no se pisan).

---

## 9. Margen real — costo congelado al momento de la venta (2026-09-17)

Origen: al preguntar por qué el margen de Período/Resumen operativo mezcla
ingreso histórico con costo de reposición de HOY (§7.3/§8.6), se evaluaron
los 3 métodos estándar de contabilidad de gestión para este descalce
(ajuste por IPC, doble moneda/USD, costeo al momento de la venta). Se
decidió una implementación en dos pasadas — esta sección cubre la primera.

**Por qué "costeo al momento de la venta" (Método 3) y no IPC primero**:
a diferencia del ajuste por IPC (aplicable retroactivo a cualquier venta
vieja, porque el INDEC tiene el índice de cualquier mes pasado), este
método necesita el costo de LA RECETA en el instante exacto de cada venta
— un dato que nunca se guardó para ventas pasadas y no se puede
reconstruir sin una serie histórica de costo por insumo. Por eso es
**solo hacia adelante**: no corrige ni un reporte de datos ya cargados,
pero no trae ninguna dependencia externa (sin API de gobierno, sin cron,
sin tabla de índices que mantener) y es arquitectónicamente más simple.
El ajuste por IPC (retroactivo, con dependencia externa) queda para una
segunda pasada aparte, con su propia migración y su propio ok — no se
tocó nada de eso acá.

**Implementado**:
- `prisma/schema.prisma`, `MovimientoStock.costoUnitarioVenta` (`Decimal?
  @db.Decimal(14,4)`) — migración `20260917100000_agregar_costo_unitario_venta`,
  aplicada directo contra Neon (no había Postgres local disponible en esta
  sesión para generarla del modo habitual con `prisma migrate dev`).
  Columna aditiva y nullable: no toca ninguna fila existente.
- `server/actions/venta.ts` (`registrarVenta`) — antes de procesar las
  líneas del lote, corre `calcularCostosYMargenes` UNA vez (no por línea)
  para tener el costo de receta vigente en ese instante; cada
  `VentaCalculada` guarda ese costo (`costoUnitarioAlVender`, `null` si el
  costeo estaba incompleto ese día), y la fila `MovimientoStock` de
  proceso VENTA lo persiste en `costoUnitarioVenta`.
- `core/reportes/periodo.ts` (`calcularMargenDelPeriodo`) — adicionó
  `margenRealTotal`/`margenRealPctTotal`/`ingresoConCostoReal`/
  `ingresoSinCostoReal`/`avisoReal` a `MargenDelPeriodo`, calculados
  línea por línea desde `ItemPeriodo.costoUnitarioVenta` (no por producto
  agregado, a diferencia del margen nominal — dos ventas del mismo
  producto en fechas distintas pueden tener costo congelado distinto si
  la receta cambió entre medio). El margen nominal existente **no se
  tocó ni se reemplazó** — sigue siendo el mismo cálculo de siempre, al
  lado del nuevo.
- `core/reportes/resumen-operativo.ts` — reexpone los mismos campos
  (`margenRealTotal`, `margenRealPct`, más los 4 avisos ya existentes
  como texto, `avisoVentas`/`avisoMargen`/`avisoMargenReal`/`avisoCompras`)
  porque, como ya estaba documentado en §7.3, esta pantalla reusa
  `obtenerReportePorPeriodo` por debajo — no hizo falta duplicar el
  cálculo.
- UI (`reportes/periodo/page.tsx`, `reportes/page.tsx`) — de paso,
  arregla también §7.3/§8.6: los 4 avisos (Ventas/Margen/Compras +
  "Margen real") ahora cuelgan de `<AyudaIcono>` pegado a cada tarjeta,
  ya no como párrafos sueltos al pie. Resumen operativo pasó de tener
  CERO explicación a tener las mismas 4 ayudas que Período.

**Pendiente, a propósito, fuera de esta pasada**:
- No hay forma de ver "margen real" desglosado por producto todavía
  (`FilaMargenProducto` no tiene el equivalente) — solo el total del
  período. Se dejó así para no ensanchar el scope; si hace falta, es un
  agregado del mismo tipo sobre `items`, no un rediseño.
- El Método 1 (ajuste IPC) — implementado el mismo día en una segunda
  pasada aparte, con su propia migración/aprobación explícita. Ver §10.

### 8.6 "Líneas" en Compras por proveedor — sin explicación, y el nombre confunde

**Pedido del usuario**: "¿qué es 'Líneas'? [...] eso solo da información de
dinero pero no del qué, por qué, cómo".

**Causa raíz**: `tabla-periodo.tsx:31` no tiene `AyudaIcono` ni ningún
otro texto de ayuda en esa columna. Y el conteo detrás (`periodo.ts:171`,
`acc.lineas += 1` por cada `MovimientoStock` de proceso COMPRA) no es ni
"cantidad de facturas" ni "cantidad de productos distintos" — es la
cantidad de renglones de compra individuales acumulados en todo el rango
de fechas para ese proveedor. Un número alto puede significar compras
frecuentes en cantidades chicas (ej. verdulería) tanto como una sola
compra grande con muchos productos — sin la aclaración, no se puede
distinguir un caso del otro solo mirando la tarjeta.

**Estado: resuelto (2026-09-17)** — `tabla-periodo.tsx` cuelga un
`AyudaIcono` de la columna "Líneas" (mismo mecanismo que el resto del
documento), con la aclaración de que es renglones de compra, no
facturas ni productos distintos.

### 8.7 Huecos de catálogo — MP "Se produce" marcada como "sin proveedor" (falso positivo)

**Pedido del usuario**: notó que los insumos listados como "sin proveedor
cargado" eran en realidad MP que "se producen" — insumos intermedios
fabricados con su propia receta, que por diseño nunca se compran.

**Causa raíz, confirmado en código**: `huecos-catalogo.ts:62` arma
`insumosConRecetaSinProveedor` filtrando `tipo === "MP" && activo &&
mpsEnRecetas.has(id) && !conProveedor.has(id)` — **sin ningún chequeo de
`seProduce`**, campo que ni siquiera se selecciona en esta consulta (a
diferencia de `costos.ts`/`valuacion.ts`, que sí lo usan para esta misma
distinción). Una MP marcada "Se produce" (ej. "Prepizza masa grande/chica"
— fabricadas con su propia receta, nunca recibidas por Compra) queda
listada como si le faltara un dato de catálogo, cuando en realidad no
corresponde que tenga proveedor. No es un problema de wording — es un
falso positivo real que el usuario tiene que aprender a ignorar cada vez
que mira este reporte.

**Estado: resuelto (2026-09-17)** — `generarReporteHuecosCatalogo` ahora
filtra `!info.seProduce` en `insumosConRecetaSinProveedor`, con test
dedicado ("una MP 'Se produce' sin proveedor NO aparece").

### 8.8 Insumos y grupos — layout de dos columnas apretado, sin el padding que sí tienen los reportes

**Pedido del usuario**: "vista solapada o apretada" en `/catalogo/insumos-grupos`.

**Causa raíz**: `insumos-grupos/page.tsx:26` divide la pantalla 50/50
(`grid-cols-2` en desktop) entre "Insumos" y "Árbol de grupos", y cada
mitad tiene su propia tabla con `<select>` + botones inline — mucho
control para la mitad del ancho de pantalla. Esta página usa una
`<table>` HTML propia, no el componente compartido `TablaReporte` (vive
en `/catalogo`, no en `/reportes`) — por eso nunca recibió el fix de
padding horizontal entre columnas que sí se aplicó a los ~18 reportes
(§5 de este documento, "bug de spacing... corregido con `px-2` en
`<th>`/`<td>`"). Sin ese padding y con la mitad del ancho disponible, el
link "Guardar" del selector de grupo queda pegado contra el valor de la
columna "Activo".

**Estado: resuelto (2026-09-17)** — agregado el `px-2` entre columnas en
las dos tablas (mismo fix de spacing que §5), sin migrar a `TablaReporte`
(cambio de forma más grande, fuera de esta pasada).

---

## 10. Margen ajustado por IPC — Método 1, segunda pasada (2026-09-17)

Segunda pasada del trabajo de §9 — ahí quedó explícitamente pospuesto
"con su propia migración y su propio ok" antes de tocar la base
compartida otra vez; esta sección es esa segunda pasada, autorizada en
el momento.

**Fuente verificada real** (no documentación genérica): la API de series
de tiempo del Ministerio de Economía (`apis.datos.gob.ar`), serie
`101.1_I2NG_2016_M_22` (IPC GBA Nivel General, base dic-2016) — sin API
key, republica el IPC del INDEC. Confirmado con `curl` el 2026-09-17 antes
de escribir código.

**Bug real encontrado al usar la API**: sin el parámetro `limit`
explícito, devuelve como máximo 100 filas en orden ASCENDENTE (las más
VIEJAS primero) — con 125 meses de serie completa, eso corta justo antes
de llegar a los meses recientes. El primer backfill de prueba trajo datos
hasta 2024-07 en vez de 2026-08 por este motivo. Corregido agregando
`&limit=5000` a la URL (`indices-economicos.ts`) — documentado en el
propio código para que nadie lo saque "para simplificar" sin saber por
qué está.

**Implementado**:
- `prisma/schema.prisma`, modelo `IndicePrecio` (`mes` único, `valor`) —
  migración `20260917140000_agregar_indice_precio`, aditiva, aplicada
  contra Neon (`demo-pizzeria-la-cuadra`) y contra Postgres local.
- `core/reportes/indices-economicos.ts` — `cargarSerieIPC` (una consulta,
  toda la serie a memoria), `resolverCoeficienteIPC` (puro, sin I/O:
  último valor cargado ÷ valor del mes de la venta — `null` si falta
  cualquiera de los dos, nunca inventa un intermedio), `sincronizarIPC`
  (fetch + upsert idempotente, nunca reescribe un mes ya guardado).
- `core/reportes/periodo.ts` (`calcularMargenDelPeriodo`) — agregó
  `margenIPCTotal`/`margenIPCPctTotal`/`ingresoAjustadoIPCTotal`/
  `ingresoConIPC`/`ingresoSinIPC`/`avisoIPC`, línea por línea sobre
  `items` (mismo criterio que `margenReal` de §9: cada venta puede caer
  en un mes con coeficiente distinto). A propósito usa el MISMO
  `costoPorProducto` (costo de HOY) que ya usa el margen nominal — la
  idea del Método 1 es dejar los dos lados de la resta en la misma
  "moneda" (plata de hoy), no introducir un tercer costo. Ni el margen
  nominal ni el margen real (§9) se tocaron.
- `core/reportes/resumen-operativo.ts` y las tarjetas de
  `reportes/periodo/page.tsx` y `reportes/page.tsx` — mismo patrón que
  §9: una tercera línea ("Ajustado IPC: ...") al lado de "Real", con su
  propio `AyudaIcono`, sin reemplazar nada.
- Sincronización automática: `src/app/api/cron/sincronizar-ipc/route.ts`
  + `vercel.json` (Vercel Cron, día 15 de cada mes — le da tiempo al
  INDEC a publicar el mes anterior). Protegido con `CRON_SECRET` (env var
  nueva en Production de Vercel) — un request sin el secreto correcto se
  rechaza con 401 antes de tocar la DB.
- Backfill manual único (2026-09-17): corridos los ~125 meses históricos
  (2016-2026) tanto en Postgres local como en la rama demo de Neon, para
  que la funcionalidad tenga datos reales desde ya en vez de esperar al
  primer 15 del mes.

**A diferencia del Método 3 (§9), este SÍ es retroactivo** — cualquier
venta ya cargada, de cualquier fecha pasada, puede ajustarse en cuanto
ese mes tenga IPC sincronizado. La limitación real es el rezago de
publicación del INDEC (~1 mes) — una venta del mes en curso todavía no
tiene IPC para llevarla a "hoy", así que cae en `ingresoSinIPC` hasta que
el INDEC publique ese mes.

**Pendiente, a propósito, fuera de esta pasada**: Método 2 (doble
moneda/USD) no se implementó — la propia evaluación inicial (chat) ya
lo descartó como de "esfuerzo alto, poco práctico acá salvo que el
negocio ya cotice todo en USD", y nadie pidió eso. Si en algún momento
hace falta, es una tabla `CotizacionDolar` + la misma API de series
(serie `168.1_T_CAMBIOR_D_0_0_26`, tipo de cambio A3500 del BCRA, diaria)
— mismo patrón que `IndicePrecio`, no un diseño nuevo.
