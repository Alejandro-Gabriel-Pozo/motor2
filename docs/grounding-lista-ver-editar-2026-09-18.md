# Grounding: listado, ver hacia adentro y editar — tres niveles para el catálogo (2026-09-18)

**Motivo**: tras el bug de «Editar producto» (el formulario no cargaba categoría, unidad, precio ni factor; arreglado en `a3c512f`, rama `fix/editar-producto-key`), el usuario señaló que el problema de fondo es de diseño: *"una cosa es el listado, otra cosa es ver hacia dentro del producto y otra cosa es querer editarlo"*, y que con recetas ya se había hecho. Este documento contrasta ese patrón de tres niveles con sistemas de referencia (leyendo su código), lo compara con lo que motor2 tiene hoy y propone cómo seguir. **No implementa nada**: cada paso pide decisión del usuario (§7). Después, el usuario señaló que la **matriz de permisos** tiene el mismo problema de fondo (cada clic cambia el acceso al instante, sin paso de edición); se contrastó con Frappe y Dolibarr en la §5.

**Antecedente en el propio repo**: `docs/comparativa-ux-erpnext-dolibarr.md` §6.6 ya separó, para **recetas**, la lista del editor (grounded en Dolibarr `bom_list.php` → `bom_card.php`), y la sección siguiente ("ver es distinto de querer editar") pidió un modo lectura dentro del editor (parcialmente resuelto en `2ed6ae6`). Productos quedó atrás.

## 1. El patrón general: tres niveles, y qué hacen los referentes en conjunto

Ver una lista, mirar hacia adentro de un registro y editarlo son tres momentos distintos. La mayoría de los referentes los separa; los que no, lo compensan de otra forma. Lo que se repite:

1. **Cuatro de seis separan «ver» de «editar»** (Dolibarr, Grocy, TastyIgniter con `preview`, Tandoor). ERPNext no, pero compensa con el panel de lectura dentro del formulario. NexoPOS es el único que solo tiene lista y edición.
2. **La vista de lectura es donde viven las relaciones**: stock, precios, historial, proveedores, documentos vinculados. Dolibarr lo hace con pestañas (`product_prepare_head`: precios de venta y de compra, stock, recursos, contactos, eventos); Grocy con stock, valor, último precio y promedio, vida útil, historial de precios y diario de stock; ERPNext con conexiones y botones a reportes con el filtro puesto (Stock Balance, Stock Ledger, Stock Projected Qty, `item.js:186-213`).
3. **«Editar» es una acción explícita y con permiso**: en Dolibarr solo aparece si `$usercancreate` (`:3173`); en Grocy es un botón en la fila y en la tarjeta.
4. **Crear tiene su propia pantalla** en los cuatro sistemas que la separan.
5. **El borrado se condiciona al uso**: Dolibarr solo ofrece «Delete» si `!isObjectUsed` (`:3189-3192`). Motor2 ya desactiva en vez de borrar (`activo`).
6. **Las matrices de permisos son la excepción: aplican al instante.** Frappe y Dolibarr guardan cada casilla en cuanto se toca, sin modo edición ni «Guardar» (§5). No lo resuelven separando ver de editar, sino con otras redes: bloquear la pantalla mientras guarda y revertir si falla (Frappe), o permitir el cambio solo a quien tiene permiso para administrar (Dolibarr).

## 2. Detalle por sistema (código real)

| Sistema | Lista | Ver hacia adentro (solo lectura) | Editar | Crear |
|---|---|---|---|---|
| **Dolibarr** (`htdocs/product/card.php`) | `product/list.php` | **Es el modo por defecto**: ficha con pestañas y barra de acciones (`:2603-2607`, `:3164-3200`) | «Modify» → `?action=edit` (`:2037`, botón `:3175`) | `?action=create` (`:1403`, `:1454`) |
| **Grocy** (`views/products.blade.php`, `components/productcard.blade.php`) | Tabla con botón «Edit this item» por fila (`:143`) | **Tarjeta «Product overview»** en modal, al hacer clic en el nombre (`productcard-trigger`, `:178`); trae un botón «Edit product» (`productcard:27`) | `/product/{id}` (`:143`) | `/product/new` (`:29`) |
| **TastyIgniter** (`Menus.php`, `formConfig` `:33-56`) | `menus` | Modo **`preview`** del formulario, con `back => 'menus'` | `edit`; al guardar vuelve a `menus/edit/{id}`, o a la lista con «guardar y cerrar» | `create` |
| **ERPNext / Frappe** (`item.js`, `form.js`) | List View | **No hay modo solo lectura**: un único formulario editable (solo lectura por workflow, `form.js:438`). En su lugar, un **panel de lectura dentro del formulario**: «dashboard» (`form.js:247-275`) con niveles de stock (`item.js:841-858`, solo si el ítem ya existe y maneja stock) y **conexiones** por tipo de documento (`item_dashboard.py:17-36`: Groups, Pricing, Sell, Buy, Manufacture, Traceability, Stock Movement…) | El mismo formulario | Formulario nuevo |
| **NexoPOS** (`ProductCrud.php:876-878`) | `dashboard/products` | **No**: solo `list`, `create` y `edit` | `products/edit/{id}` | `products/create` |
| **Tandoor** (según `grounding-ficha-tecnica-tandoor.md`) | Lista de recetas | Vistas de lectura aparte (`vue3/src/components/display/RecipeView.vue`, `StepView.vue`) | Pantallas de edición separadas | Aparte |

## 3. Qué tiene motor2 hoy (verificado en el código)

| Pantalla | Lista | Ver hacia adentro (solo lectura) | Editar | Crear |
|---|---|---|---|---|
| **Recetas** (`/catalogo/recetas`, `/[productoId]`) | Sí, solo productos con receta | Sí: la ficha técnica, cada ingrediente y cada paso se ven como texto, con «Editar» por sección (`?editarFicha=1`, `?editar=<insumo>`, `?editarPaso=<n>`) | Inline, por sección | Buscador «+ Nueva receta» |
| **Productos** (`/catalogo/productos`) | Sí | **Sí desde 2026-09-19** (F2): la ficha `/catalogo/productos/[id]`. Hasta entonces, no | **Hasta 2026-09-19** el formulario vivía en la misma página que la lista (`grid lg:grid-cols-[1fr_420px]`), «Editar» = `?id=`. **Hoy** tiene su propia ruta, `/catalogo/productos/[id]/editar` | `/catalogo/productos/nuevo` |
| **Proveedores** | Sí | No | Formulario debajo de la tabla (contacto, teléfono, email, CUIT, condiciones de pago y notas; el nombre no se edita) | Formulario inline |
| **Categorías, Unidades, Insumos y grupos** | Sí | No | Formularios inline | Formularios inline |

Pendiente ya documentado en recetas: los formularios «Agregar ingrediente» y «Agregar paso» siguen siempre abiertos entre las secciones de lectura (`comparativa` §"ver es distinto de querer editar").

**Consecuencia observada**: al mezclar lista y formulario en una página, «Editar» es una navegación suave y React reutiliza el formulario montado en modo alta; los campos con estado interno quedan con los valores del alta. Es el bug de `a3c512f`. Que exista una pantalla intermedia (ficha) y rutas separadas para crear/editar elimina esa clase de bug de raíz, porque cada pantalla monta su propio formulario.

## 4. Propuesta para motor2 (productos primero)

**Rutas** (cada pantalla monta su propio formulario, sin depender de `key`):
- `/catalogo/productos` — lista con buscador y «Nuevo producto»; el nombre enlaza a la ficha.
- `/catalogo/productos/[id]` — **ficha, solo lectura**, con «Editar». **Como quedó implementado (2026-09-19):** las cuatro pantallas piden Ver de `alta_producto` (la acción del ítem de menú) y el botón «Editar» se muestra a todos ellos; quien no tenga `editar_producto` recibe el mensaje de permiso al guardar (el comportamiento de antes). **Pendiente para F3:** mostrar «Editar» solo con `editar_producto` y agregar «Desactivar», que todavía no está.
- `/catalogo/productos/[id]/editar` — el `ProductoForm` actual; al guardar vuelve a la ficha.
- `/catalogo/productos/nuevo` — alta.

**Qué mostraría la ficha, con consultas que ya existen**:

| Sección | Fuente en motor2 |
|---|---|
| Datos (código, tipo, categoría, unidades, factor, consignación, observaciones, activo) | `Producto` |
| Precio y costo (venta global y local por sucursal, costo actual, margen) | `calcularCostosYMargenes` (`core/reportes/costos.ts:122`), `PrecioLocalProducto` |
| Stock (saldo por sección y lote, mínimo, alertas) | `calcularStockConsolidado`, `calcularAlertasStock` |
| Proveedores y precios | `ProveedorPorProducto`, `obtenerComparativaPreciosPorInsumo` |
| Presentaciones de compra | `Presentacion` (hoy se editan dentro del formulario) |
| Receta y usos como ingrediente | `obtenerRecetaVigente`, enlace a `/catalogo/recetas/[id]` |
| Movimientos recientes | `obtenerHistorialProducto` (`core/reportes/historial-producto.ts:73`), enlace a `/reportes/historial?productoId=` |
| Cambios de precio | `RegistroAuditoria` (entidad `Producto`) |

**Fases chicas y reversibles** (los esfuerzos son estimación propia):

| Fase | Contenido | Esfuerzo |
|---|---|---|
| F0 | `key` en el formulario | **Hecha y publicada** en `main` el 2026-09-19 (`a3c512f`); los dos deploys de Production en `success`. Sin verificar todavía en el navegador |
| F1 | Rutas separadas `nuevo` y `editar`, con el formulario existente; la lista deja de compartir página con el formulario | **Hecha (2026-09-19)**: `/catalogo/productos/nuevo` y `/catalogo/productos/[id]/editar`; los enlaces viejos `?id=` redirigen a la edición |
| F2 | Ficha de solo lectura con «Datos» y enlaces a los reportes que ya existen (historial, costos, receta) | **Hecha (2026-09-19)**: `/catalogo/productos/[id]`; al guardar (alta o edición) se vuelve a la ficha con el aviso |
| F3 | Ficha con stock, proveedores y precios, y cambios de precio | Medio |
| F4 | Mismo tratamiento para proveedores | Bajo a medio |

**Qué no conviene**: darle ficha a categorías, unidades e insumos-grupos. Son catálogos chicos sin relaciones que mirar; NexoPOS los resuelve con lista y edición, y alcanza. El criterio es dar ficha a lo que **tiene relaciones que consultar** (productos, proveedores).

**Riesgos**
- **Permisos por sección**: la ficha junta datos que hoy dependen de permisos distintos (`ver_stock`, `comparar_precios`, `ver_auditoria`); cada sección debería respetar el suyo.
- **Multi-sucursal**: stock, precio local y mínimo dependen de la sucursal activa.
- **Alcance**: la ficha completa es grande; por eso las fases.

## 5. Caso aparte: matrices de permisos y activaciones (cada clic aplica al instante)

**En una línea**: en motor2, tocar una casilla de la matriz de roles cambia el acceso de todos los usuarios de ese rol en ese mismo clic; los dos referentes que se leyeron hacen lo mismo, así que aquí el grounding **no respalda** un modo edición como estándar, y elegirlo sería una decisión propia por lo que está en juego (acceso), no una copia.

**Qué hacen los referentes** (código real):

| Sistema | Cómo se aplica un cambio de permiso | Redes de seguridad |
|---|---|---|
| **Frappe** (`permission_manager.js`) | **Al instante**: el clic en cualquier casilla llama al servidor (`method: "update"`, `:454-481`) | Congela la pantalla mientras guarda (`frappe.dom.freeze()`, `:462`) y **revierte la casilla si el servidor falla** (`:481`); botón secundario «Restore Original Permissions» (`:566`) que pide confirmación (`reset_std_permissions`, `:119-121`). Quitar una regla («x», `:436`) **no** pide confirmación |
| **Dolibarr** (`user/perms.php`) | **Al instante**: cada casilla es un enlace `?action=addrights` / `delrights` con `confirm=yes` (`:749`, `:775`, `:793`); el servidor lo ejecuta y redirige (`:114-163`) | Solo si `$caneditperms` (admin o `user->write`, `:69`). Sin confirmación ni «Guardar». Los enlaces «All / None» por módulo y global (`:511-513`, `:671-673`) cambian **todos** los permisos de un clic, también sin confirmar |

Lo que tienen en común: la matriz es una **herramienta de administración**, no un registro que se mira y se edita. Ninguno le pone modo edición.

**Qué tiene motor2 hoy** (verificado leyendo el código; no se probó en el navegador):

| Control | Comportamiento | Dónde |
|---|---|---|
| Matriz de permisos (`/administracion/permisos`) | Cada casilla es un botón que llama a `actualizarPermiso` y hace `router.refresh()`; sin modo edición, confirmación, «Guardar» ni deshacer. Feedback: «…» en la casilla y una línea de mensaje | `permisos-matriz.tsx:31-38`, `:82`, `:92` |
| Roles: «Activar/Desactivar» | Al instante, sin confirmación | `roles-tabla.tsx:19`, `:56` |
| Usuarios: «Activar/Desactivar» | Al instante, sin confirmación; desactivar corta el acceso de esa persona | `usuarios-tabla.tsx:38`, `:81` |
| Capacidades por sucursal | Un formulario por fila que aplica al enviarlo | `capacidades-sucursal/page.tsx:50` |

**Protecciones que motor2 ya tiene** (del lado del servidor, `permisos.ts`): exige el permiso `gestion_permisos` (`:35`); el admin no puede perder `gestion_permisos` ni `gestion_usuarios` (`:44`, lista `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`); «Ver» siempre incluye «Editar» (`:47`); cada cambio de «Ver» y de «Editar» queda en `RegistroAuditoria` (`:57`, `:62`, visible en `/administracion/auditoria`). Es decir: nadie puede quedar afuera por un clic y todo cambio se puede reconstruir, pero **antes** del cambio no hay ninguna pausa y **después** no hay deshacer (hay que volver a tocar).

**Opciones** (la 2 es la más cercana a los referentes; la 1 es criterio propio):

1. **Modo edición en la matriz.** Se abre en solo lectura con «Editar permisos»; los toques se acumulan como cambios pendientes marcados; un resumen («3 cambios: Cajero pierde Anular venta…») pide «Guardar» o «Descartar» y escribe todo junto. Es la separación ver/editar de las §1 a §4 aplicada a esta pantalla. Costo: medio (estado de cambios pendientes y una acción que aplique varios a la vez; hoy `actualizarPermiso` cambia uno por llamada, y el guardado debería ser todo o nada).
2. **Mantener el clic instantáneo, con las redes de Frappe.** Revertir la casilla si el servidor falla (hoy solo se muestra el mensaje), bloquear las casillas mientras guarda (hoy solo la casilla tocada), confirmar solo los cambios que **quitan** acceso, y un aviso «Deshacer» de unos segundos. Costo: bajo.
3. **Solo las desactivaciones** (roles y usuarios): pedir confirmación, porque son las acciones que cortan el acceso. Costo: bajo. Se puede combinar con 1 o con 2.

**Riesgos**: con la opción 1, dos administradores editando a la vez: gana el último que guarda salvo que se compare contra lo que se vio al abrir. Con la opción 2, un deshacer con ventana de tiempo puede pisar un cambio hecho por otra persona en el medio.

## 6. Relevamiento de la misma clase de bug en el resto del proyecto

Se revisó todo lo que cambia de contenido con un `<Link>` (navegación suave) y tiene un formulario con estado interno. **Solo `productos` se reprodujo en un navegador; el resto es lectura de código.**

| Pantalla | Estado |
|---|---|
| Productos (`?id=`) | **Bug real, arreglado** en `a3c512f` (`key` en `<ProductoForm>`), con test e2e que falla sin el arreglo y pasa con él |
| Stock mínimo (`?editar=`) | Ya tenía `key={filaEnEdicion?.id ?? "nuevo"}` (`stock/minimo/page.tsx:58`) |
| Proveedores (`?editar=`) | Inputs comunes con `defaultValue`: siguen a las props. **Caso borde**: si se tipea en la edición de un proveedor y sin guardar se toca «Editar» en otro, los campos modificados conservan lo tipeado y se guardarían en el segundo. Se cierra con un `key`; **ya se aplicó** (`catalogo/proveedores/page.tsx`: `key={enEdicion.id}` y `key="nuevo"`) |
| Conteo físico (`?seccionId=`) | No afectado: la sección se elige con un `<form>` común que recarga la página entera, y el grid se monta de cero |
| Recetas (`?editar=`, `?editarPaso=`, `?editarFicha=`) | No afectado: cada edición es render condicional y las filas llevan `key` |
| Cambio de sucursal | No afectado: `cambiarSucursalActiva` termina en `redirect("/")` (`sucursal-activa.ts:33`). Es una navegación suave, no una recarga: se sostiene porque `/` no muestra esos formularios |
| Filtros de reportes (`?desde=`, `?dias=`) | No afectado: formularios GET comunes; el orden elegido en una tabla se conserva a propósito |

## 7. Decisiones (tomadas por el usuario el 2026-09-19)

| # | Decisión | Respuesta |
|---|---|---|
| 1 | ¿Productos primero, con ficha y rutas separadas, y proveedores después? | **Sí.** Productos primero, proveedores después |
| 2 | ¿Qué secciones de la ficha van primero? | **Datos y enlaces a los reportes que ya existen (F2).** Stock, precios, proveedores, receta, movimientos y auditoría quedan para F3 |
| 3 | ¿Al guardar se vuelve a la ficha o se sigue en la edición? | **A la ficha.** Resuelve también el cartel de confirmación que hoy se pierde al volver a la lista (hallazgo M1 del gobernador, sin verificar en el navegador) |
| 4 | ¿Categorías, unidades e insumos-grupos quedan inline? | **Sí**, con lista y formulario inline, sin ficha |
| 5 | ¿Se cierra el caso borde de proveedores con un `key`? | **Sí, en un cambio aparte**, no mezclado con otros |
| 6 | Matriz de permisos (§5) | **Opción 1: modo edición con «Guardar»**: solo lectura al abrir, cambios pendientes marcados, resumen y guardado todo o nada. Es criterio propio, no lo que hacen los referentes. **Implementada (2026-09-19)**: «Editar permisos» → celdas marcadas → «Revisar y guardar» (resumen antes → después) → «Confirmar y guardar»; el servidor (`guardarPermisos`) guarda todo en una transacción, compara contra lo que se vio al abrir la edición y, si otra persona cambió algo, no guarda nada y lo dice |
| 7 | ¿Desactivar un rol o un usuario pide confirmación? | **Sí.** Solo desactivar pide confirmación; activar sigue directo |

**Implementadas al 2026-09-19:** la decisión 5 (el `key` de proveedores), la 7 (desactivar un rol, un usuario o una sucursal pide confirmación; commits `06fc718`, `676c8f6`, `b9ea18b`, `732703e`) y las decisiones 1 a 3 en lo que toca a productos: rutas separadas, ficha con «Datos» y enlaces a los reportes (F1 y F2) y guardar vuelve a la ficha; y la decisión 6, la matriz de permisos en modo edición con «Guardar». **El resto sigue sin implementar:** stock, precios y proveedores en la ficha (F3) y el mismo tratamiento para proveedores (F4). Antes de cada fase hace falta su matriz de impacto y pasar por el gobernador.

## 8. Limitaciones

- Los referentes se leyeron como archivos sueltos por la API de GitHub (Dolibarr `card.php` y `product.lib.php`, Grocy `products`, `productcard` y `productform`, Frappe `form.js`, TastyIgniter `Menus.php`, NexoPOS `ProductCrud.php`) o en clones locales (ERPNext `item.js` y `item_dashboard.py`). **No se ejecutó ninguno**: la descripción de cómo se ve cada pantalla sale del código, no de usarla.
- Los dos referentes de la §5 se leyeron como archivos sueltos (`permission_manager.js`, `perms.php`); no se ejecutaron. Los números de línea de Dolibarr corresponden a la rama `develop` en la fecha indicada en Fuentes y se mueven entre versiones. No se miró qué hace ERPNext cuando dos administradores editan la misma matriz a la vez, ni Odoo.
- **No se verificó** qué hace Dolibarr al guardar (si vuelve a la ficha), ni Odoo, que no se miró. La descripción de Tandoor viene del documento previo, no se releyó su código.
- El relevamiento de §6 es por lectura del código, salvo productos, que se reprodujo en Chrome con un test e2e.

## Fuentes

- Dolibarr `d608047` (2026-09-19): `htdocs/product/card.php` (`:1403`, `:1454`, `:2037`, `:2073-2076`, `:2603-2607`, `:3164-3200`), `htdocs/core/lib/product.lib.php` (`product_prepare_head`).
- Grocy `41206cb` (2026-09-16): `views/products.blade.php` (`:29`, `:143`, `:178`), `views/components/productcard.blade.php` (`:15-45`).
- TastyIgniter `ti-ext-cart` `16c224c` (2026-09-13): `src/Http/Controllers/Menus.php` (`:33-56`).
- Frappe `03927f6` (2026-09-18): `frappe/public/js/frappe/form/form.js` (`:247-275`, `:438`).
- Frappe `c9e0056` (2026-07-11): `frappe/core/page/permission_manager/permission_manager.js` (`:119-121`, `:436`, `:454-481`, `:566`).
- Dolibarr `42a4f53` (2026-09-07): `htdocs/user/perms.php` (`:69`, `:114-163`, `:511-513`, `:671-673`, `:749`, `:775`, `:793`).
- ERPNext `a2481e9` (clon local): `erpnext/stock/doctype/item/item.js` (`:186-213`, `:312-317`, `:841-858`), `item_dashboard.py` (`:17-36`).
- NexoPOS `6061a93` (2026-08-25): `app/Crud/ProductCrud.php` (`:876-878`).
- Motor2: `src/app/(app)/administracion/{permisos,roles,usuarios,capacidades-sucursal}`, `src/server/actions/permisos/permisos.ts`, `src/app/(app)/catalogo/**/page.tsx`, `docs/comparativa-ux-erpnext-dolibarr.md` §6.6 y "ver es distinto de querer editar", `docs/grounding-ficha-tecnica-tandoor.md`, commit `a3c512f` y `test/e2e/catalogo-editar-producto.spec.ts`.
