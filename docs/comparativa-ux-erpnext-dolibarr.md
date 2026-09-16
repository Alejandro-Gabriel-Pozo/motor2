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

Fuentes primarias completas (con más citas de archivo:línea de las
resumidas acá) quedan en el historial de esta sesión — este documento es el
resumen curado para llevar al otro proyecto, no un volcado íntegro.
