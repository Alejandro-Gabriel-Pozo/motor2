# Grounding: unificación de motor2 (stock) con restaurant-menu-design (carta) — 2026-09-23

Notas de una charla exploratoria, no un plan. No hay ninguna decisión de
negocio tomada todavía — esto es el grounding contra el código real de
ambos repos para que esa decisión se tome con evidencia, no a ciegas.
Cuando el dueño decida qué camino tomar, ahí corresponde `plan-con-verificacion-e2e`
para el plan de implementación (ver AGENTS.md).

## 0. El pedido

Unir, en la medida en que sea factible, `motor2` (stock/inventario) con
`restaurant-menu-design` (la página pública de la carta): que la carta se
alimente del catálogo real de motor2 (qué producto está o no disponible)
en vez de mantenerse a mano por separado. Hoy ese mantenimiento a mano se
hace editando una Google Sheet publicada.

## 1. Qué hay hoy en cada repo (verificado leyendo código, no supuesto)

### 1.1 motor2 — ya tiene la mitad del modelo

- `prisma/schema.prisma` — `model Producto`: `tipo` (`MP`/`PV`), `nombre`,
  `precioVenta`, `categoriaId` → `CategoriaProducto`. Los productos de
  venta (`tipo=PV`) son, en esencia, los platos de la carta.
- `model DisponibilidadProducto` (mismo archivo, comentario largo fechado
  2026-09-23): `sucursalId` + `productoId` + `disponible: Boolean`,
  `@@unique([sucursalId, productoId])`. **Este es exactamente el booleano
  "está en la carta / no está", pero ya modelado por sucursal**, no
  global — resuelto por `resolverDisponibilidad` en
  `src/core/catalogo/disponibilidad-producto.ts`. Ver
  `docs/grounding-disponibilidad-por-sucursal-2026-09-23.md` y
  `docs/plan-disponibilidad-por-sucursal-2026-09-23.md` para el porqué de
  ese diseño (fila ausente = no disponible, grounding contra ERPNext/Dolibarr).
- `model Sucursal` — ya existe como el concepto de "local"/tenant.
- No existe hoy ningún campo de **presentación** (descripción larga para
  comensales, imagen del plato, tags tipo "vegano"/"picante", flag
  "especial", orden dentro de una sección) — `Producto` es un modelo de
  inventario, no de marketing.

### 1.2 restaurant-menu-design — todo el contenido viene de Google Sheets vía gviz

- `lib/gviz.ts` — parser único de la respuesta gviz de Google
  Visualization API (JSONP), usado por los tres consumidores de abajo.
- `lib/get-menu.ts` — lee la tab `Menu` de una sheet por tenant. Cada fila
  tiene `categoria`, `titulo_seccion`, `platillo`, `descripcion`,
  `precio`, `disponible` (booleano de la celda), `tags`, `especial`,
  `orden`. Filtra a `disponible === true` antes de armar `MenuCategory[]`.
  Si la sheet falla o no hay `MENU_SHEET_ID`, cae a
  `lib/menu-data.fallback.ts` (menú estático hardcodeado).
- `lib/tenants.ts` — lee la tab `tenant` de una sheet maestra
  (`MASTER_SHEET_ID`): `tenant_id`, `sheet_id`, `sheet_name`, `activo`,
  posición sobre un mapa (`pos_x/y/w/h`). Es el multi-tenant: cada
  sucursal tiene su propio `sheet_id`.
- `lib/get-config.ts` — lee la tab `Config` (formato clave/valor, una fila
  por clave) y la vuelca en un tipo `SiteConfig` de **~100 campos**:
  identidad del restaurante, SEO/OG, hero/portada, ~35 claves `color_*`
  por zona (nav, sección, especial, cta, tags, precio, portada, índice,
  banda, items regulares/especiales), tamaños de fuente por zona, textos
  de portada/índice, config del portal multisucursal. Todo el theming
  visual de la carta pasa por acá.
- `lib/hero-utils.ts` — `sanitizeCssColor()` valida cualquier valor de
  color antes de inyectarlo en un `<style>` (bloquea `; { } < > "` — ya
  contempla que el valor viene de una fuente externa no confiable, la
  sheet). También trae parsers propios de hex/rgb/hsl/oklch para calcular
  contraste WCAG y elegir texto claro/oscuro automáticamente.
- `app/api/revalidate/route.ts` — deploy hook: la sheet dispara esto
  (o se llama a mano) para invalidar el ISR de 5 min/1h y traer el dato
  fresco sin esperar el revalidate automático.
- `app/api/debug-config`, `debug-tenants`, `debug-menu` — endpoints de
  diagnóstico que devuelven el gviz crudo, para depurar qué está leyendo
  realmente de la sheet.
- `docs/template-config-sheet.md`, `docs/setup-sucursal.md` — ya
  documentan, del lado de este repo, cómo se completa la sheet hoy.

## 2. Lo que se discutió

### 2.1 Unificar catálogo/disponibilidad (motor2 → carta)

**Feasible.** El mapeo es casi 1:1:

| restaurant-menu-design (sheet `Menu`) | motor2 |
|---|---|
| `platillo` | `Producto.nombre` (tipo `PV`) |
| `precio` | `Producto.precioVenta` |
| `disponible` (por sheet = por tenant = por sucursal) | `DisponibilidadProducto.disponible` |
| `categoria` | `CategoriaProducto.nombre` (o `Seccion`, a decidir) |
| tenant (`sheet_id`) | `Sucursal` |

Lo que **no** tiene hoy correlato en motor2 y es puramente de
presentación: `descripcion` (de comensal, no `Producto.observaciones`),
`imagen_seccion_url`/imagen del plato, `tags`, `especial`, `orden`.

Opción discutida: exponer un endpoint de solo lectura en motor2
(`/api/menu/[sucursal]` o similar) con los `Producto` tipo `PV`
disponibles en esa sucursal, y en restaurant-menu-design reemplazar el
fetch de `get-menu.ts`/`tenants.ts` (hoy a `gviz`) para que apunte ahí en
vez de a Sheets — sin tocar diseño ni componentes (`menu-section.tsx`,
`carta-view.tsx`, etc.), porque el contrato de salida (`MenuCategory[]`)
no cambia. El deploy hook (`app/api/revalidate`) se reutiliza, pero
disparado por motor2 (al cambiar `DisponibilidadProducto` o
`precioVenta`) en vez de por la sheet.

**Decisión pendiente:** dónde viven los campos de presentación
(`descripcion`, imagen, `tags`, `especial`, `orden`) — agregarlos a
`Producto`/una tabla nueva en motor2 (mezcla inventario con marketing) o
mantenerlos en una tabla chica aparte que solo consulta
restaurant-menu-design.

### 2.2 Exponer/editar el theming (`SiteConfig`) con vista previa en vivo

Problema distinto: hoy se edita `Config` en la sheet a ciegas — no hay
manera de ver el resultado antes de que el ISR/ revalidate lo traiga.

Dos caminos discutidos, de menor a mayor esfuerzo:

1. **Preview en vivo sin migrar la fuente de datos:** una página tipo
   `/theme-preview?sucursal=x` que renderiza la carta real con un panel
   de inputs (color, fuente) enganchados a las mismas CSS custom
   properties que ya usan `menu-hero.tsx`/`hero-utils.ts`. Se ajusta en
   el navegador y, conforme, se copian los valores a la sheet a mano.
   Reutiliza `sanitizeCssColor` tal cual. Sin migración.
2. **Editor real con persistencia:** que `SiteConfig` deje de vivir en la
   sheet y pase a una tabla (ej. `SucursalConfig` en motor2, al lado de
   `DisponibilidadProducto`), con un form/admin con swatches de color que
   guarda con preview en vivo — recién ahí "tener una paleta" en el
   sentido de guardar/reusar combinaciones tiene sentido. Conviene
   hacerlo junto con la unificación de catálogo (§2.1), no antes.

**Decisión pendiente:** si se arranca por la opción 1 (rápida, sigue
editando la sheet) o se va directo a la opción 2 (resuelve de raíz, más
trabajo, y solo tiene sentido si además se resuelve §2.1).

## 3. Qué queda abierto

- Confirmar el mapeo `categoria`/`titulo_seccion` de la carta contra
  `CategoriaProducto` o `Seccion` de motor2 (son conceptos distintos hoy
  en motor2: `Seccion` es de movimientos de stock, no de menú).
- Decidir dónde viven los campos de presentación (§2.1).
- Decidir el camino de `SiteConfig` (§2.2).
- Ninguna de estas decisiones requiere fusionar los repos en un solo
  código/deploy: alcanza con que restaurant-menu-design consuma un
  endpoint de motor2 en vez de Google Sheets.
