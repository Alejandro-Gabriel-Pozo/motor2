# Grounding: "Activo de producto" pasa de global a por sucursal (2026-09-23)

Complementa `docs/plan-disponibilidad-por-sucursal-2026-09-23.md`. Documento de evidencia — no toma
decisiones de negocio (esas ya están resueltas, ver el plan §0).

---

## 0. Qué confirmé leyendo el código de motor2 (no supuesto)

### 0.1 El interruptor de hoy

- `prisma/schema.prisma:285` — dentro de `model Producto` (líneas 262-321): `activo Boolean @default(true)`. Un único booleano, sin relación con `Sucursal`.
- `src/server/actions/catalogo/productos.ts:324` — `actualizarActivoProducto(productoId, activo)`: no recibe `sucursalId`; hace `prisma.producto.update({ where: { id: productoId }, data: { activo } })` (línea 338) y audita con `entidad: "Producto", campo: "activo"` (líneas 340-344).
- `src/core/catalogo/desactivar-producto.ts:21` — `dependenciasParaDesactivar(productoId, db)`. Su propio docstring (líneas 18-19) ya nombra el problema: *«saldo por sección, de TODAS las sucursales: el producto es global, y darlo de baja lo saca del stock de todas»*.

### 0.2 Qué referencia a `Producto` (qué se rompe si deja de estar disponible en una sucursal sin dejar de existir)

De `schema.prisma:307-317`, las relaciones salientes de `Producto`:
`presentaciones`, `proveedorPorProducto`, `recetaVersiones`, `usadoComoIngrediente` (RecetaIngrediente), `movimientos` (MovimientoStock), `conteosFisicos`, `preciosLocales`, `stockMinimos`, `frecuenciasConteo`, `promociones`, `traspasos`.

Clasificación relevante al cambio:
- **Centrales (no se rompen, no cambian)**: `Presentacion`, `ProveedorPorProducto`, `RecetaVersion`/`RecetaIngrediente`, `Insumo`, `CategoriaProducto`.
- **Ya por sucursal (siguen igual)**: `PrecioLocalProducto`, `StockMinimoProducto`, `FrecuenciaConteoProducto`, `PromocionProducto`. Una fila de precio local de un producto no disponible ahí simplemente no se usa — no se borra (mismo patrón «nunca DELETE» que ya documenta `PrecioLocalProducto` en `schema.prisma:998-999`).
- **Por sección → por sucursal (sí se ven afectados)**: `MovimientoStock`, `ConteoFisico`, `Operacion`, `TraspasoSucursal`.

### 0.3 Los 3 modelos plantilla (leídos completos)

| | Ubicación | Forma | Fila ausente = |
|---|---|---|---|
| `PrecioLocalProducto` | `schema.prisma:989-1003` | `sucursalId`+`productoId`+`precio`+`habilitado`, `@@unique([sucursalId, productoId])` | fallback a `Producto.precioVenta` |
| `FrecuenciaConteoProducto` | `schema.prisma:1021-1030` | `sucursalId`+`productoId`+`frecuenciaDias`, `@@unique([sucursalId, productoId])` | sin agenda |
| `StockMinimoProducto` | `schema.prisma:1058-1069` | `sucursalId`+`productoId`+`seccionId?`+`minimo`, `@@unique([productoId, seccionId])` + índice único parcial a mano | sin mínimo cargado (≠ mínimo 0) |

Sus pares action/UI usados como molde:
- `src/server/actions/stock/stock-minimo.ts` + `src/app/(app)/stock/minimo/{page.tsx,stock-minimo-form.tsx,boton-eliminar.tsx}`
- `src/server/actions/stock/frecuencia-conteo.ts` + `src/app/(app)/stock/conteo-frecuencia/{page.tsx,conteo-frecuencia-form.tsx,boton-eliminar.tsx}`
- Resolvers: `src/core/stock/stock-minimo.ts::resolverStockMinimo` (consulta) y `src/core/stock/frecuencia-conteo.ts::resolverProximoConteo` (pura, sin Prisma).
- Migración plantilla: `prisma/migrations/20260922225810_frecuencia_conteo_producto/migration.sql` (CREATE TABLE + índice único + 2 FKs, sin datos).

**Confirmado: ninguna de las 3 es un booleano simple con default** — el "fila ausente = ¿?" para disponibilidad es diseño real, no un detalle heredado de la plantilla (ver plan §2).

---

## 1. Grounding externo (verificado en fuente, contra `develop` de cada proyecto)

### 1.1 ERPNext — **NO ENCONTRADO** un booleano "ítem deshabilitado en este warehouse"

Lo que sí hay, literal:

- `erpnext/stock/doctype/item/item.json` — campo `disabled`, fieldtype `Check`, label `"Disabled"`. **Global al ítem**, no por depósito.
- `erpnext/stock/doctype/item/item.py`, bloque de tipos auto-generado (líneas ~75 y ~135): `allowed_companies: DF.TableMultiSelect[CompanyRestriction]` y `restrict_to_companies: DF.Check`.
- `erpnext/stock/doctype/company_restriction/company_restriction.json` — `"istable": 1`, **un solo campo**: `company`, fieldtype `Link`, options `Company`.
- `erpnext/stock/doctype/company_restriction/company_restriction.py`:
  - `RESTRICTABLE_MASTER_DOCTYPES = ("Item", "Customer", "Supplier")`
  - `get_restriction_criterion(...)` termina en: `return Bracket((parent.restrict_to_companies == 0) | ExistsCriterion(allowed_rows))`
  - `has_permission(...)`: `if not doc.get("restrict_to_companies"): return True`
  - mensaje de bloqueo: `_("{0} {1} cannot be used with Company {2} because of Company Restrictions")`
  - y `_("Allowed Companies is required when Restrict to Companies is checked")`
- `erpnext/stock/doctype/item_default/item_default.json` — tabla hija **por Company**: `company | Link | Company`, `default_warehouse | Link | Warehouse`, `default_price_list`, cuentas contables. **Ningún booleano de enabled/disabled.**
- `erpnext/stock/doctype/item_reorder/item_reorder.json` — `"istable": 1`; `warehouse | Link | Warehouse` (label `"Request for"`), `warehouse_group | Link | Warehouse` (label `"Check Availability in Warehouse"`), `warehouse_reorder_level | Float`, `warehouse_reorder_qty | Float`. Es la única config **por ítem × depósito** de ERPNext: niveles de reposición, **no** disponibilidad.
- `erpnext/stock/doctype/warehouse/warehouse.json` — el **depósito entero** sí tiene `disabled | Check | "Disabled"`. Se apaga el depósito completo, no un ítem dentro de él.

**Verdicto ERPNext:** el eje real de "este ítem no se usa acá" es **Company**, no Warehouse, y se modela como **allow-list opt-in**: `restrict_to_companies = 0` ⇒ disponible en todas (sin filas); `= 1` ⇒ solo las Companies listadas.

### 1.2 Dolibarr — **NO ENCONTRADO** un booleano por almacén ni por entidad

- `htdocs/install/mysql/tables/llx_product.sql`:
  - `entity integer DEFAULT 1 NOT NULL, -- Multi company id`
  - `tosell tinyint DEFAULT 1, -- Product you sell`
  - `tobuy tinyint DEFAULT 1, -- Product you buy`
  - `seuil_stock_alerte float DEFAULT NULL`, `desiredstock float DEFAULT 0`, `fk_default_warehouse integer DEFAULT NULL`
- `htdocs/product/class/product.class.php`:
  - `public $status = 0;` con `public $tosell;` marcado `@deprecated  Use $status instead`
  - líneas 3210-3211: `$this->status = $obj->tosell; $this->status_buy = $obj->tobuy;`
  - líneas 1624-1625 (UPDATE): `", tosell = ".(int) $this->status` / `", tobuy = ".(int) $this->status_buy`
  → la disponibilidad son **dos booleanos globales en la fila del producto**, y la fila pertenece a **una** `entity`.
- `htdocs/install/mysql/tables/llx_product_perentity-multicompany.sql` (encabezado: Copyright Open-Dsi) — `create table llx_product_perentity` con `fk_product`, `entity integer DEFAULT 1 NOT NULL, -- multi company id`, `accountancy_code_sell`, `..._sell_intra`, `..._sell_export`, `accountancy_code_buy`, `..._buy_intra`, `..._buy_export`, `pmp double(24,8)`. **No tiene `tosell` ni `tobuy`**: compartir un producto entre entidades NO da un on/off por entidad, solo pisa códigos contables y el PMP.
- `htdocs/install/mysql/tables/llx_product_warehouse_properties-stock.sql` — comentario literal: `-- Table used when STOCK_ALLOW_ADD_LIMIT_STOCK_BY_WAREHOUSE is set.`; columnas `fk_product`, `fk_entrepot`, `seuil_stock_alerte float DEFAULT '0'`, `desiredstock float DEFAULT '0'`. Producto × almacén: **umbrales, no disponibilidad.**
- `htdocs/install/mysql/tables/llx_product_stock.sql` — `fk_product`, `fk_entrepot`, `reel real, -- physical stock`. Solo cantidad.

### 1.3 Conclusión del grounding

**No hay estándar de industria directo que copiar para un booleano "activo por sucursal/depósito".** Los dos sistemas de referencia tienen *exactamente* la tabla "producto × depósito" que motor2 ya tiene (`Item Reorder` en ERPNext, `llx_product_warehouse_properties` en Dolibarr ≡ `StockMinimoProducto`), y **ninguno de los dos le puso un booleano de disponibilidad**: ambas guardan umbrales de stock y nada más. El único precedente real de "este ítem no se usa acá" está un nivel más arriba: **Company** en ERPNext (`Item.restrict_to_companies` + tabla hija `Company Restriction`), y en Dolibarr ni siquiera eso (la disponibilidad es `tosell`/`tobuy` global de una fila que pertenece a UNA entidad).

Ese nivel "Company" es justamente el que motor2 ya mapea a `Sucursal`: `schema.prisma:86-88` documenta que el gate por sucursal está *"validado contra ERPNext (User Permission / Company Restriction) frente a Dolibarr, que no tiene ningún gate de este tipo dentro de una misma empresa"*. Con ese mapeo (Sucursal ↔ Company) **sí hay precedente**, y el diseño de este plan es su equivalente materializado.

**Diferencia honesta con ERPNext:** ERPNext lo modela **opt-in sin filas** (`restrict_to_companies == 0` ⇒ visible en todas, incluidas las Companies creadas *después*). motor2 elige **materializar una fila por sucursal**, que es lo que la decisión 2 del dueño pide literalmente ("todas las sucursales existentes **en ese momento**"). El precio de esa elección: una sucursal nueva arranca sin ningún producto disponible salvo que se le dé el mismo tratamiento de alta con tilde (ver plan §10).
