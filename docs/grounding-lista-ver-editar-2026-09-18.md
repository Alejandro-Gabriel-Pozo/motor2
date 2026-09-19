# Grounding: listado, ver hacia adentro y editar — tres niveles para el catálogo (2026-09-18)

**Motivo**: tras el bug de «Editar producto» (el formulario no cargaba categoría, unidad, precio ni factor; arreglado en `a3c512f`, rama `fix/editar-producto-key`), el usuario señaló que el problema de fondo es de diseño: *"una cosa es el listado, otra cosa es ver hacia dentro del producto y otra cosa es querer editarlo"*, y que con recetas ya se había hecho. Este documento contrasta ese patrón de tres niveles con sistemas de referencia (leyendo su código), lo compara con lo que motor2 tiene hoy y propone cómo seguir. **No implementa nada**: cada paso pide decisión del usuario (§5).

**Antecedente en el propio repo**: `docs/comparativa-ux-erpnext-dolibarr.md` §6.6 ya separó, para **recetas**, la lista del editor (grounded en Dolibarr `bom_list.php` → `bom_card.php`), y la sección siguiente ("ver es distinto de querer editar") pidió un modo lectura dentro del editor (parcialmente resuelto en `2ed6ae6`). Productos quedó atrás.

## 1. Qué tiene motor2 hoy (verificado en el código)

| Pantalla | Lista | Ver hacia adentro (solo lectura) | Editar | Crear |
|---|---|---|---|---|
| **Recetas** (`/catalogo/recetas`, `/[productoId]`) | Sí, solo productos con receta | Sí: la ficha técnica, cada ingrediente y cada paso se ven como texto, con «Editar» por sección (`?editarFicha=1`, `?editar=<insumo>`, `?editarPaso=<n>`) | Inline, por sección | Buscador «+ Nueva receta» |
| **Productos** (`/catalogo/productos`) | Sí | **No** | Formulario en la **misma página** que la lista (`grid lg:grid-cols-[1fr_420px]`), «Editar» = `?id=` | El mismo formulario |
| **Proveedores** | Sí | No | Formulario debajo de la tabla (contacto, teléfono, email, CUIT, condiciones de pago y notas; el nombre no se edita) | Formulario inline |
| **Categorías, Unidades, Insumos y grupos** | Sí | No | Formularios inline | Formularios inline |

Pendiente ya documentado en recetas: los formularios «Agregar ingrediente» y «Agregar paso» siguen siempre abiertos entre las secciones de lectura (`comparativa` §"ver es distinto de querer editar").

**Consecuencia observada**: al mezclar lista y formulario en una página, «Editar» es una navegación suave y React reutiliza el formulario montado en modo alta; los campos con estado interno quedan con los valores del alta. Es el bug de `a3c512f`. Que exista una pantalla intermedia (ficha) y rutas separadas para crear/editar elimina esa clase de bug de raíz, porque cada pantalla monta su propio formulario.

## 2. Cómo lo resuelven los referentes (código real)

| Sistema | Lista | Ver hacia adentro (solo lectura) | Editar | Crear |
|---|---|---|---|---|
| **Dolibarr** (`htdocs/product/card.php`) | `product/list.php` | **Es el modo por defecto**: ficha con pestañas y barra de acciones (`:2603-2607`, `:3164-3200`) | «Modify» → `?action=edit` (`:2037`, botón `:3175`) | `?action=create` (`:1403`, `:1454`) |
| **Grocy** (`views/products.blade.php`, `components/productcard.blade.php`) | Tabla con botón «Edit this item» por fila (`:143`) | **Tarjeta «Product overview»** en modal, al hacer clic en el nombre (`productcard-trigger`, `:178`); trae un botón «Edit product» (`productcard:27`) | `/product/{id}` (`:143`) | `/product/new` (`:29`) |
| **TastyIgniter** (`Menus.php`, `formConfig` `:33-56`) | `menus` | Modo **`preview`** del formulario, con `back => 'menus'` | `edit`; al guardar vuelve a `menus/edit/{id}`, o a la lista con «guardar y cerrar» | `create` |
| **ERPNext / Frappe** (`item.js`, `form.js`) | List View | **No hay modo solo lectura**: un único formulario editable (solo lectura por workflow, `form.js:438`). En su lugar, un **panel de lectura dentro del formulario**: «dashboard» (`form.js:247-275`) con niveles de stock (`item.js:841-858`, solo si el ítem ya existe y maneja stock) y **conexiones** por tipo de documento (`item_dashboard.py:17-36`: Groups, Pricing, Sell, Buy, Manufacture, Traceability, Stock Movement…) | El mismo formulario | Formulario nuevo |
| **NexoPOS** (`ProductCrud.php:876-878`) | `dashboard/products` | **No**: solo `list`, `create` y `edit` | `products/edit/{id}` | `products/create` |
| **Tandoor** (según `grounding-ficha-tecnica-tandoor.md`) | Lista de recetas | Vistas de lectura aparte (`vue3/src/components/display/RecipeView.vue`, `StepView.vue`) | Pantallas de edición separadas | Aparte |

### Patrones que se repiten

1. **Cuatro de seis separan «ver» de «editar»** (Dolibarr, Grocy, TastyIgniter con `preview`, Tandoor). ERPNext no, pero compensa con el panel de lectura dentro del formulario. NexoPOS es el único que solo tiene lista y edición.
2. **La vista de lectura es donde viven las relaciones**: stock, precios, historial, proveedores, documentos vinculados. Dolibarr lo hace con pestañas (`product_prepare_head`: precios de venta y de compra, stock, recursos, contactos, eventos); Grocy con stock, valor, último precio y promedio, vida útil, historial de precios y diario de stock; ERPNext con conexiones y botones a reportes con el filtro puesto (Stock Balance, Stock Ledger, Stock Projected Qty, `item.js:186-213`).
3. **«Editar» es una acción explícita y con permiso**: en Dolibarr solo aparece si `$usercancreate` (`:3173`); en Grocy es un botón en la fila y en la tarjeta.
4. **Crear tiene su propia pantalla** en los cuatro sistemas que la separan.
5. **El borrado se condiciona al uso**: Dolibarr solo ofrece «Delete» si `!isObjectUsed` (`:3189-3192`). Motor2 ya desactiva en vez de borrar (`activo`).

## 3. Relevamiento de la misma clase de bug en el resto del proyecto

Se revisó todo lo que cambia de contenido con un `<Link>` (navegación suave) y tiene un formulario con estado interno. **Solo `productos` se reprodujo en un navegador; el resto es lectura de código.**

| Pantalla | Estado |
|---|---|
| Productos (`?id=`) | **Bug real, arreglado** en `a3c512f` (`key` en `<ProductoForm>`), con test e2e que falla sin el arreglo y pasa con él |
| Stock mínimo (`?editar=`) | Ya tenía `key={filaEnEdicion?.id ?? "nuevo"}` (`stock/minimo/page.tsx:58`) |
| Proveedores (`?editar=`) | Inputs comunes con `defaultValue`: siguen a las props. **Caso borde**: si se tipea en la edición de un proveedor y sin guardar se toca «Editar» en otro, los campos modificados conservan lo tipeado y se guardarían en el segundo. Se cierra con un `key`; **no se aplicó** |
| Conteo físico (`?seccionId=`) | No afectado: la sección se elige con un `<form>` común que recarga la página entera, y el grid se monta de cero |
| Recetas (`?editar=`, `?editarPaso=`, `?editarFicha=`) | No afectado: cada edición es render condicional y las filas llevan `key` |
| Cambio de sucursal | No afectado: `cambiarSucursalActiva` termina en `redirect("/")` |
| Filtros de reportes (`?desde=`, `?dias=`) | No afectado: formularios GET comunes; el orden elegido en una tabla se conserva a propósito |

## 4. Propuesta para motor2 (productos primero)

**Rutas** (cada pantalla monta su propio formulario, sin depender de `key`):
- `/catalogo/productos` — lista con buscador y «Nuevo producto»; el nombre enlaza a la ficha.
- `/catalogo/productos/[id]` — **ficha, solo lectura**, con «Editar» (permiso `editar_producto`) y «Desactivar».
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
| F0 | `key` en el formulario | **Hecha** (`a3c512f`), sin publicar |
| F1 | Rutas separadas `nuevo` y `editar`, con el formulario existente; la lista deja de compartir página con el formulario | Bajo |
| F2 | Ficha de solo lectura con «Datos» y enlaces a los reportes que ya existen (historial, costos, receta) | Bajo a medio |
| F3 | Ficha con stock, proveedores y precios, y cambios de precio | Medio |
| F4 | Mismo tratamiento para proveedores | Bajo a medio |

**Qué no conviene**: darle ficha a categorías, unidades e insumos-grupos. Son catálogos chicos sin relaciones que mirar; NexoPOS los resuelve con lista y edición, y alcanza. El criterio es dar ficha a lo que **tiene relaciones que consultar** (productos, proveedores).

**Riesgos**
- **Permisos por sección**: la ficha junta datos que hoy dependen de permisos distintos (`ver_stock`, `comparar_precios`, `ver_auditoria`); cada sección debería respetar el suyo.
- **Multi-sucursal**: stock, precio local y mínimo dependen de la sucursal activa.
- **Alcance**: la ficha completa es grande; por eso las fases.

## 5. Decisiones para el usuario

1. ¿Productos primero, con ficha y rutas separadas, y proveedores después?
2. ¿Qué secciones de la ficha van primero: datos, stock, precios y proveedores, receta, movimientos, auditoría?
3. ¿Al guardar se vuelve a la ficha (propuesta) o se sigue en la edición (como TastyIgniter)?
4. ¿Categorías, unidades e insumos-grupos quedan con lista y formulario inline?
5. ¿Se cierra ya el caso borde de proveedores con un `key`?

## 6. Limitaciones

- Los referentes se leyeron como archivos sueltos por la API de GitHub (Dolibarr `card.php` y `product.lib.php`, Grocy `products`, `productcard` y `productform`, Frappe `form.js`, TastyIgniter `Menus.php`, NexoPOS `ProductCrud.php`) o en clones locales (ERPNext `item.js` y `item_dashboard.py`). **No se ejecutó ninguno**: la descripción de cómo se ve cada pantalla sale del código, no de usarla.
- **No se verificó** qué hace Dolibarr al guardar (si vuelve a la ficha), ni Odoo, que no se miró. La descripción de Tandoor viene del documento previo, no se releyó su código.
- El relevamiento de §3 es por lectura del código, salvo productos, que se reprodujo en Chrome con un test e2e.

## Fuentes

- Dolibarr `d608047` (2026-09-19): `htdocs/product/card.php` (`:1403`, `:1454`, `:2037`, `:2073-2076`, `:2603-2607`, `:3164-3200`), `htdocs/core/lib/product.lib.php` (`product_prepare_head`).
- Grocy `41206cb` (2026-09-16): `views/products.blade.php` (`:29`, `:143`, `:178`), `views/components/productcard.blade.php` (`:15-45`).
- TastyIgniter `ti-ext-cart` `16c224c` (2026-09-13): `src/Http/Controllers/Menus.php` (`:33-56`).
- Frappe `03927f6` (2026-09-18): `frappe/public/js/frappe/form/form.js` (`:247-275`, `:438`).
- ERPNext `a2481e9` (clon local): `erpnext/stock/doctype/item/item.js` (`:186-213`, `:312-317`, `:841-858`), `item_dashboard.py` (`:17-36`).
- NexoPOS `6061a93` (2026-08-25): `app/Crud/ProductCrud.php` (`:876-878`).
- Motor2: `src/app/(app)/catalogo/**/page.tsx`, `docs/comparativa-ux-erpnext-dolibarr.md` §6.6 y "ver es distinto de querer editar", `docs/grounding-ficha-tecnica-tandoor.md`, commit `a3c512f` y `test/e2e/catalogo-editar-producto.spec.ts`.
