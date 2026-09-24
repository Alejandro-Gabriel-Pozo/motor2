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

## 3. Decisión tomada (2026-09-23, continuación): módulo `carta` de solo lectura

El dueño confirma el requisito que faltaba de §2.1: el módulo nuevo **no
tiene una interacción real con stock** — depende de `catalogo`/`stock` en
un solo sentido (lectura) y el resto es lógica propia. Aplicando el mismo
molde que ya usa cada dominio de motor2 (`docs/arquitectura-modularidad-server-actions-2026-09-17.md`:
carpeta propia por capa, pensado para poder desprenderse como servicio
aparte):

- `src/core/carta/` — lógica pura ("dado `sucursalId`, qué platos se
  muestran"). Llama a `resolverDisponibilidad` de
  `src/core/catalogo/disponibilidad-producto.ts` **de lectura**, no la
  reimplementa ni la modifica.
- `src/server/actions/carta/` — Server Actions propias (gateadas con
  `con-permiso.ts` como el resto) solo si hay una pantalla interna para
  editar descripción/imagen/tags/"especial"/orden/sección. Ninguna toca
  las actions de `catalogo/` o `stock/`.
- `src/app/(app)/carta/` — esa pantalla de administración, si se hace.
- `src/app/api/carta/[sucursal]/route.ts` — el endpoint público de solo
  lectura que consume restaurant-menu-design (Route Handler, no Server
  Action, porque lo llama un sitio externo — mismo estilo que
  `app/api/revalidate` en ese repo).
- Los campos de presentación de §2.1 (`descripcion`, imagen, `tags`,
  `especial`) van en una tabla **nueva y aditiva**, `ContenidoCartaProducto`
  (FK a `Producto`), nunca en `Producto` en sí.

**Lo único que toca algo existente:** la migración de Prisma que crea
esa tabla necesita, del lado de `model Producto`, la línea de relación
inversa que Prisma exige para que el schema sea válido (una línea
declarativa, sin lógica de negocio ni cambio de comportamiento). Ninguna
columna existente cambia, ninguna Server Action de `catalogo`/`stock` se
toca, ningún test de inventario debería cambiar de resultado por esto.

## 4. Modelo final de agrupamiento y secciones (2026-09-23, continuación)

Capturas reales de la carta hoy (`restaurant-menu-design`, `iolileotest.vercel.app/carta/...`)
mostraron dos cosas que corrigieron el diseño inicial:

- La sección **"Platos Principales"** junta Bife a la criolla, Bife de
  chorizo, Chivo del norte, Pechuga de pollo y Trucha — son platos
  **distintos entre sí** (no variantes de una misma cosa), cada uno con
  su propia `CategoriaProducto` de tipo de plato. La sección no es un
  sinónimo de categoría: es un nivel más arriba que agrupa varias
  categorías distintas.
- La sección **"PROMOS"** tiene líneas como *"1 pizza a elección + 1
  coca 1,5L para llevar — $25.000"* o *"Hamburguesa XXL + Papas Fritas +
  Saborizada 1,5L (para 4 personas) — $75.000"*: son combos de varios
  productos con un precio propio. Grounding: lo único parecido que existe
  en motor2 es `PromocionProducto` (`prisma/schema.prisma:1132`) — un
  booleano "este producto individual está en promo" por sucursal, **no**
  un combo de varios productos con precio conjunto. No hay nada para
  reusar ahí; es un concepto nuevo.

El modelo completo queda en 4 niveles (de más chico a más grande),
todos de solo lectura hacia `catalogo` salvo los dos marcados "nuevo":

1. **`Producto`** (existente) — el SKU real: "Pizza Napolitana", "Coca
   1,5L".
2. **`CategoriaProducto`** (existente) — el tipo de plato/grupo fino:
   "Pizza", "Bife", "Gaseosa 500cc". Ya es lo que hoy alimenta
   `generarReporteVentasPorCategoria` (`src/core/reportes/periodo.ts:1108`,
   ver §5) — "cuántas pizzas vendí" ya funciona a este nivel, sin tocar
   nada.
3. **`SeccionCarta`** (nuevo, propio de carta) — el curso de la carta:
   "Entradas", "Platos Principales", "Bebidas", "Postres", "Promos".
   Agrupa **varias** `CategoriaProducto` (Bife + Chivo + Pollo + Trucha,
   todas bajo Platos Principales) vía una tabla puente de solo
   referencia (`categoriaId` → `seccionCartaId`), sin agregar ninguna
   columna a `CategoriaProducto`.
4. **`PromoCarta`** (nuevo, propio de carta) — el combo: título/
   descripción libre ("1 pizza a elección + 1 coca 1,5L"), precio propio,
   orden. Por ahora **sin** referencia a los `Producto`/`CategoriaProducto`
   reales que lo componen — el dueño confirma que el nombre es puramente
   informativo (ver §6, depende de cómo se termine cargando la venta de
   promos).

## 5. Reportes por nivel — reusar, no reimplementar

El pedido real detrás de todo el agrupamiento es un drill-down de a 3
pasos para decidir qué mantener en la carta, con el propio ejemplo del
dueño:

1. **Por sección:** "de Entradas no sale nada, saquemos toda la sección."
2. **Por grupo/tipo de plato dentro de la sección:** "en Bebidas lo que
   más sale son las gaseosas 500cc."
3. **Por producto puntual dentro del grupo:** "pero esta gaseosa en
   particular no se vende."

Los niveles 2 y 3 **ya existen, sin cambios**: `generarReporteVentasPorCategoria`
ya agrupa por `CategoriaProducto` y ya desglosa por producto adentro
(`porCategoria[].productos`, ordenado por importe). El nivel 1 (por
`SeccionCarta`) es la única pieza nueva: un reporte chico en `core/carta`
que **toma el resultado ya calculado** de `generarReporteVentasPorCategoria`
y lo reagrupa una vuelta más usando la tabla puente `categoriaId` →
`seccionCartaId` de §4. No se toca `src/core/reportes/periodo.ts` en
absoluto — es composición, no reimplementación.

## 6. Promociones — pendiente PREVIO, no parte de este alcance

El dueño ya había marcado esto como pendiente aparte: cómo se cargan las
ventas de una promo — probablemente vía **conciliación** — está sin
decidir todavía, y **es un prerrequisito**, no parte de la unificación
carta/stock en sí.

Grounding del problema real que esto resuelve (ejemplo concreto del
dueño): si un combo tipo "Menú ejecutivo" incluye una milanesa, y hoy la
venta se registra con el precio real solo en la línea del combo, la
milanesa que forma parte del combo puede quedar registrada en **$0** en
el reporte de ventas. Con 10 milanesas vendidas — 5 sueltas a $10.000
c/u ($50.000) y 5 dentro de "Menú ejecutivo" a $0 — el reporte de
ventas por producto (§5, nivel 3) promediaría $50.000/10 = $5.000 por
milanesa, un número que **no representa ningún precio real**: la plata
de las otras 5 está en la línea de "Menú ejecutivo", no en la de
milanesa. Resolver esto (con conciliación o el mecanismo que se elija)
es lo que habilitaría después un análisis de costos/márgenes correcto
por producto — pero es trabajo previo, separado, y no bloquea el resto
de este diseño (`PromoCarta` en §4 queda solo informativo hasta que esto
se resuelva).

Dos caminos mencionados por el dueño para resolverlo, ninguno decidido
todavía:

- **A. Conciliación.** La venta de un combo se sigue registrando como
  hoy (probablemente una sola línea "Menú ejecutivo" a precio de combo)
  y, aparte, un proceso de conciliación reparte ese importe entre los
  productos reales que lo componen (a mano o con una regla). No requiere
  cambios en el flujo de venta existente; el costo es que la
  descomposición es posterior y aproximada.
- **B. POS interno sin facturación, con comandas.** Transformar motor2
  en un punto de venta (sin facturación fiscal — no reemplaza ningún
  sistema de facturación existente) que permita tomar el pedido por
  producto real (incluida la elección dentro de un combo, ej. "pizza a
  elección: cuál") y emitir la comanda de cocina. La ventaja: la
  descomposición de un combo en sus productos reales ocurre **en el
  momento de la venta**, no después — la milanesa del "Menú ejecutivo"
  queda registrada con su valor real desde el vamos, y de yapa engancha
  directo con `src/server/actions/movimientos/venta.ts`/`MovimientoStock`
  que ya existe. El costo: es un módulo nuevo bastante más grande que
  todo lo demás de este documento (toma de pedido, comandas, UI de mozo/
  cocina), no una extensión chica de `carta`.

Ninguna de las dos decide nada todavía — quedan las dos anotadas para
cuando el dueño resuelva cuál seguir.

### 6.1 Grounding de infraestructura para la opción B (POS + comandas)

El dueño confirma que el local **ya tiene una PC**, con una **comandera**
(impresora térmica dedicada de cocina, protocolo ESC/POS — el estándar
de facto de este tipo de impresoras) **conectada por cable** a esa PC.
Esto resuelve la duda de infraestructura de la opción B sin comprar nada
nuevo, pero conviene separar dos problemas que parecen uno solo:

- **"Mesa abierta" NO es un problema de cómputo serverless.** Es una fila
  en Postgres (`Mesa`/`Comanda`, `estado: ABIERTA`) a la que se le van
  agregando líneas con el tiempo — el mismo patrón de Server Action +
  Neon que ya usa todo motor2 hoy. Serverless no necesita mantener nada
  en memoria entre requests para esto.
- **Imprimir en la comandera SÍ es un problema de red, no de estado.**
  Una función serverless en la nube no puede abrir una conexión directa
  a un dispositivo detrás del router del local (sin IP pública, y exponer
  el puerto de la impresora a internet sería un agujero de seguridad).
  Se resuelve con un agente local en esa misma PC:
  - Un script chico (podría ser Node/TypeScript — mismo lenguaje que ya
    usa motor2 — con una librería ESC/POS como `node-thermal-printer`/
    `escpos`) corriendo en la PC, con conexión USB directa a la
    comandera.
  - El agente sale por HTTPS hacia motor2 (conexión saliente, no
    requiere abrir nada de la red del local) a preguntar "¿hay comandas
    pendientes de imprimir?", las imprime, y le avisa a motor2 que ya se
    imprimieron (para no duplicar si el script se reinicia).

Dos preguntas operativas quedan abiertas ahí (no de arquitectura, de
uso diario):
- Qué pasa si el local se queda sin internet un rato — la comanda no
  llega hasta que vuelva la conexión.
- Que el agente/PC se caiga y nadie lo note — conviene que arranque solo
  con el sistema y quede corriendo siempre.

### 6.2 Resiliencia offline del POS/comandas (no de la carta)

Sobre qué pasa si se corta internet durante el servicio, se refinó el
diseño de la opción B (todavía sin decidir si se implementa):

- **La impresión no debería depender de internet en absoluto.** En vez
  de que el agente local le pregunte a motor2 (en la nube) "¿hay
  comandas pendientes?", el dispositivo donde se toma el pedido le habla
  **directo al agente por la red local** (LAN, sin salir a internet) —
  imprime siempre, haya o no conexión. El registro en motor2 (stock,
  reportes) se encola aparte y se sincroniza cuando vuelve la señal:
  eso sí tolera esperar, la cocina no.
- **La pantalla de toma de pedido necesitaría ser una PWA con caché
  offline** para poder seguir abriendo y tomando pedidos sin conexión.
  Estructura (nada de esto existe hoy en ningún repo — `restaurant-menu-design/app/manifest.ts`
  es el único precedente, y es solo el manifest de la carta pública, sin
  Service Worker ni caché):
  1. **Web App Manifest** propio de esta pantalla (mismo patrón que
     `manifest.ts`, pero para el POS, no para la carta).
  2. **Service Worker** — cachea el app shell la primera vez que carga
     con internet, y sirve esa versión cacheada sin conexión.
  3. **IndexedDB** — guarda la copia del catálogo/precios para poder
     armar el pedido offline, y la cola de pedidos pendientes de
     sincronizar (con estado `pendiente`/`sincronizado`, para no
     duplicar al reintentar).
  4. **Background Sync (o un fallback manual de "reintentar al detectar
     `online`")** — manda sola la cola pendiente apenas vuelve la
     conexión.
  5. **Indicador visible de "sin conexión"** en la UI, para que el
     mozo sepa que está operando offline.
- **Esto reduce el riesgo, no lo elimina.** Mientras dura el corte: el
  catálogo/precios que ve el dispositivo quedan congelados en lo último
  cacheado; si dos mozos tocan la misma mesa sin poder verse entre sí
  puede haber que reconciliar a mano al reconectar; y el caché offline
  del navegador depende del dispositivo (puede fallar por poco espacio,
  la app en segundo plano, etc.). Cortes cortos, esto lo tapa bien;
  cortes largos, no lo elimina del todo.

**Aclaración importante de alcance:** todo esto (impresión por LAN, PWA
offline, IndexedDB, sync) es exclusivo del lado **POS/comandera/mesas**
(staff, con login, con escritura) — **no aplica a la carta pública**
(`restaurant-menu-design`, de cara al cliente, sin login, solo lectura).
Son dos aplicaciones separadas, no dos pantallas de lo mismo: si al
comensal se le corta la conexión mirando el menú no se pierde nada
crítico, así que la carta no necesita nada de lo de esta sección.

## 7. Qué queda abierto

- Decidir el camino de `SiteConfig` (§2.2) — preview en vivo sin migrar,
  o editor real con persistencia.
- Resolver, como trabajo previo y separado, cómo se cargan/reconcilian
  las ventas de promos (§6) — recién ahí `PromoCarta` puede pasar de
  informativo a tener un análisis de costos real por combo.
- Si se sigue el camino B de promos (POS/comandas), decidir si se
  construye la resiliencia offline de §6.2 desde el principio o se
  arranca sin ella (dependiente de internet) y se suma después.
- Recordar que POS/comandas (§6, §6.1, §6.2) es una aplicación separada
  de la carta pública — ninguna decisión de esa parte bloquea ni
  necesita tocar `restaurant-menu-design`.
- Ninguna de estas decisiones requiere fusionar los repos en un solo
  código/deploy: alcanza con que restaurant-menu-design consuma el
  endpoint `src/app/api/carta/[sucursal]/route.ts` de motor2 en vez de
  Google Sheets.
