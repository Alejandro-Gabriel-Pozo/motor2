# Plan: agrupar varios `Producto` (PV) bajo un solo ítem visible de la carta pública ("Gaseosa 500cc" → Coca-Cola 500cc, Sprite 500cc, Fanta 500cc)

Plan escrito el 2026-09-24 por un agente de planificación (Opus), sobre la base `f91e043` de `claude/merge-menu-inventory-repos-5ot8uc` (árbol limpio). Sigue el molde de `docs/plan-carta-catalogo-2026-09-24.md`, `docs/plan-registro-tenants-2026-09-24.md`, `docs/plan-mapa-de-mesas-2026-09-24.md` y `docs/plan-tema-carta-2026-09-24.md`. No reabre nada de lo ya implementado: todo es aditivo.

**Qué pide el dueño:** dentro de una sección de carta ("Bebidas"), un ítem visible ("Gaseosa 500cc") con su propia descripción, tags y ★, que agrupa varios PV reales y distintos del catálogo, elegidos a mano. Funciona como Insumo→Grupo, pero en un solo nivel plano. No es la sección de carta: "Platos Principales" ya es `SeccionCarta`, y cada plato distinto se sigue mostrando por separado.

**Evidencia real (sheet de "Los Miches", tenant a migrar):** en la sección "Bebidas sin alcohol" cada nombre visible es UNA fila con UN precio — "Gaseosa 500 CC" $5000, "Gaseosa 1500 CC" $9000, "Agua saborizada 500 CC" $5000 — nunca varias filas con precios distintos bajo un mismo nombre genérico. El dueño confirmó: "no deberían de diferir" los precios dentro de un grupo, aclarando que hay que ver qué hacer si en algún caso puntual llegaran a diferir (no asumir que nunca pasa). Esto es la base de D5.

---

## A. Lo que cambia respecto del pedido (verificado en el código)

1. **"Gaseosa 500cc" ya aparece en el diseño original, como `CategoriaProducto`.** `docs/grounding-unificacion-carta-stock-2026-09-23.md` §4 define la categoría como "el tipo de plato/grupo fino: 'Pizza', 'Bife', 'Gaseosa 500cc'", y §5 la usa como nivel 2 del drill-down de reportes ("en Bebidas lo que más sale son las gaseosas 500cc").
   - Hoy, una categoría "Gaseosa 500cc" en la sección "Bebidas" muestra cada producto como un renglón aparte: `armarMenuCarta` convierte cada PV visible en exactamente un `ItemCartaV1`.
   - Lo nuevo no reemplaza a la categoría. Es una capa de **presentación** entre el producto y el renglón de la carta.
   - La configuración típica recomendada: la categoría "Gaseosa 500cc" para los reportes, más un ítem agrupado "Gaseosa 500cc" en esa categoría para la carta (D4, D8).
2. **No hay "subtítulo" por ítem en ninguno de los dos repos.**
   - `ItemCartaV1` tiene `nombre`, `categoria`, `descripcion`, `precio`, `tags`, `especial` e `imagenUrl`.
   - El `MenuCategory.items[]` de restaurant-menu-design tiene `name`, `description`, `price`, `tags` y `especial`.
   - `cartaMotor2AMenuCategories` (`restaurant-menu-design/lib/carta-motor2.ts`) ni siquiera mapea `imagenUrl`.
   - El ítem agrupado lleva los mismos campos de cara al cliente que `ContenidoCartaProducto`. Un subtítulo por ítem sería un cambio aditivo aparte en los dos repos (E).
3. **El guardián `test/arquitectura/carta-solo-lectura.test.ts` impide que la pertenencia vaya como columna en `Producto`.**
   - Las acciones de `src/server/actions/carta/` solo pueden escribir en `TABLAS_DE_CARTA` (hoy 6). Un `Producto.itemAgrupadoId` al estilo de `Insumo.grupoId` obligaría a escribir en `producto` desde la carta, o a mover la asignación a las acciones de catálogo.
   - Además, el grounding §3 fija que lo de carta va "en una tabla nueva y aditiva, nunca en `Producto` en sí".
   - Por eso la pertenencia va en una tabla de carta (D2).
4. **La prevención de ciclos de `Grupo` (`src/core/catalogo/grupo.ts`: `creariaCiclo`, `cadenaDeGrupos`) no aplica.**
   - Sirve solo porque `Grupo.grupoPadreId` es autorreferenciado.
   - Acá las opciones apuntan a `Producto`, nunca a otro ítem agrupado. Un ciclo es imposible por construcción, así que no hace falta ningún código de ese tipo.
   - La analogía del dueño vale en el nivel `Insumo.grupoId` (plano, 1:0..1), no en el árbol.
5. **restaurant-menu-design acepta claves de más, pero no otra versión.**
   - `esItem` (`lib/carta-motor2.ts`) valida solo las claves que conoce y deja pasar las extra. `productoId` tiene que ser `string`.
   - `esCartaMotor2V1` exige `version === 1`. Si motor2 sube la versión, **todos** los tenants migrados caen al menú de respaldo hasta que se despliegue restaurant-menu-design.
   - Un campo aditivo en v1 no rompe nada (D6).
6. **Los tests de contrato comparan ítems enteros con `toEqual`.** Son `test/carta/api-carta.test.ts` ("200: forma v1…") y `test/e2e/api-carta.spec.ts`, más `test/carta/armar-menu.test.ts` ("arma la forma v1…"). Para que queden **idénticos**, un ítem sin agrupar **no** puede llevar ninguna clave nueva, ni siquiera `opciones: []` (D6).
7. **Sin cambios, un producto agrupado saldría dos veces.** `menu-consulta.ts` trae todo PV disponible con `contenidoCarta.visibleEnCarta = true`. Si Sprite 500cc ya tenía contenido visible, saldría suelto y además dentro del grupo. La consulta individual tiene que excluir a los agrupados, y `armarMenuCarta` lo hace además como defensa (D3).
8. **El aviso "PV disponibles acá sin contenido de carta" daría un falso positivo.** `cargarAdminCarta().sinContenido` en `admin-consulta.ts` marcaría a los agrupados sin fila de contenido, aunque sí salen en la carta a través del grupo (M6).
9. **Reportes: confirmado que no se tocan (D8).**
   - `generarReporteVentasPorCategoria` (`src/core/reportes/periodo.ts:1108-1137`) agrega `rep.ventas.porProducto` por `productoId → categoriaNombre` (líneas 1113-1114).
   - `reporte-secciones.ts` compone ese resultado con **una** consulta a `categoriaSeccionCarta`.
   - Ningún archivo de `src/core/reportes/` lee tablas de carta.
   - Las ventas se siguen registrando por `Producto` individual (`MovimientoStock`, `CuentaItem.productoId`).
10. **Paridad de precio.** El precio de cada opción tiene que salir de `precioDeCarta(precioVenta, local)`, la regla fijada contra `resolverPrecioVenta` en `armar-menu.test.ts`. Así el precio de la carta sigue siendo el que se cobra (D5).
11. **`limpiarBaseDeTest` (`test/setup/test-db.ts`)** borra `producto` y `categoriaProducto`, que van a tener FK RESTRICT desde las tablas nuevas. Hay que agregarlas al bloque de carta en el mismo commit de la migración. El reset E2E (`base-e2e.ts`) hace `TRUNCATE … CASCADE` sobre todas las tablas que descubre, así que no se toca.
12. **Guardián `disponibilidad-en-un-solo-lugar.test.ts`.** La consulta de opciones filtra con `...whereDisponibleEn(sucursalId)` anidado bajo `producto:`, sin escribir `disponibilidades:` a mano.
13. **Caso real: la sheet del tenant «Los Miches»** (tab "Menu", 108 filas, leída por el coordinador el 2026-09-24).
    - Cada fila es un nombre visible con un solo precio. Nunca hay varias filas con precios distintos bajo un mismo nombre genérico.
    - Ejemplos de "Bebidas sin alcohol": "Gaseosa 500 CC" $5000, "Gaseosa 1500 CC" $9000, "Agua saborizada 500 CC" $5000.
    - De "Bebidas con alcohol": "Corona 710 CC" $11000.
    - El dueño dice que los precios dentro de un grupo "no deberían de diferir", pero agrega "habría que ver".
    - motor2 separa "Gaseosa 500 CC" en varios `Producto` solo porque cada uno descuenta un stock distinto. Para el cliente siempre fue un único precio.

---

## B. Decisiones de diseño (con recomendación)

| # | Decisión | Recomendación |
|---|---|---|
| D1 | Nombre y forma | **`ItemAgrupadoCarta`** (en la UI, "ítem agrupado"; ej. "Gaseosa 500cc") y **`OpcionItemAgrupadoCarta`** (cada PV real adentro; en la UI, "opciones").<br>Nombres descartados:<br>• `GrupoCarta`: se confunde con `Grupo` de insumos.<br>• `VarianteCarta`: el dueño aclara que no son variantes de un mismo producto.<br>• `ItemCarta` a secas: choca con el tipo del contrato `ItemCartaV1`.<br>• `ItemCompuestoCarta`: suena a combo, que es `PromoCarta` o el futuro "tomar pedido".<br>"Opción" deja la puerta abierta a "tomar pedido", donde el cliente elige cuál de las opciones.<br>Forma: dos tablas planas, sin autorreferencia (schema en M1). |
| D2 | Cardinalidad | **1:0..1**: un producto está en a lo sumo un ítem agrupado.<br>Se garantiza en la base con `OpcionItemAgrupadoCarta.productoId @unique`, el mismo mecanismo que `ContenidoCartaProducto.productoId`.<br>N:M no tiene caso de uso: el ítem agrupado es global, así que un producto en dos grupos saldría dos veces en la misma carta.<br>Una **tabla de pertenencia en carta**, y no una FK en `Producto` (A.3). Otra alternativa descartada: una FK en `ContenidoCartaProducto`, porque obligaría a crear una fila de contenido, con descripción, tags y ★ que no se usan, solo para agrupar, y mezcla la visibilidad individual con la pertenencia. |
| D3 | Relación con `ContenidoCartaProducto` | **La fila de opción ES el opt-in del producto dentro del grupo.** Es el mismo criterio que D3 del plan de carta: nada sale sin que alguien lo marque.<br>• Un producto agrupado **no necesita** `ContenidoCartaProducto`.<br>• Si tiene una fila, **se ignora mientras esté agrupado**: nunca sale suelto. Esto vale también si el ítem agrupado está apagado, porque apagar "Gaseosa 500cc" no tiene que hacer aparecer tres gaseosas sueltas.<br>• Esa fila **no se borra**: al sacar el producto del grupo vuelve el comportamiento de hoy con su contenido previo. La vuelta atrás no pierde datos.<br>• **Un producto sin agrupar funciona exactamente como hoy.** Lo prueban cuatro cosas: `api-carta.test.ts`, `api-carta.spec.ts`, `armar-menu.test.ts` y `menu-consulta.test.ts` quedan idénticos y en verde, y dos tests nuevos de regresión explícita (M2 caso 1 y M3 caso 1). |
| D4 | De qué cuelga el ítem agrupado | **De una `CategoriaProducto`** (`categoriaId`, obligatorio). La sección de carta sale por la tabla puente, igual que para un PV.<br>Motivos:<br>• El orden dentro de la sección hoy es orden de categoría → orden de contenido → nombre. Con una categoría, el ítem agrupado se ordena con esas mismas reglas y se intercala con los PV sueltos de la misma categoría, sin inventar reglas nuevas.<br>• `ItemCartaV1.categoria` sigue siendo honesto: el nombre de su categoría.<br>• El reporte por sección agrupa por categoría, así que carta y reporte coinciden.<br>Alternativa descartada: colgarlo de `SeccionCarta` directamente, porque no hay forma limpia de ordenarlo contra los bloques de categoría.<br>**Consistencia de las opciones:** pueden tener cualquier categoría (el dueño elige "las bebidas que yo quiera"), y **no se bloquea**, con el mismo criterio que el aviso no bloqueante de Insumo. La pantalla avisa cuando la categoría de una opción cae en otra sección de carta, o en ninguna, que la del ítem agrupado, porque ahí "Ventas por sección de carta" cuenta esas ventas en la sección de SU categoría. Bloquear tampoco alcanzaría: la categoría se cambia después en Catálogo, sin pasar por la carta. |
| D5 | Precio del ítem agrupado (revisado con A.13 y con la decisión del dueño) | **El grupo NO tiene precio propio** (se mantiene: ver los 3 motivos más abajo). Pero la regla de negocio pasa a ser PREVENTIVA, no reactiva: **`agregarOpcionItemAgrupadoCarta` BLOQUEA agregar una opción cuyo precio no coincide** con el de las opciones ya cargadas. El dueño lo pidió explícito: "que deje agrupar solo las cosas que tengan el mismo precio y punto. Y después si hay una gaseosa que tiene un precio diferente, bueno, se agrupará en otro lugar o estará sola."<br><br>**Cómo se compara:** al agregar una opción, se calcula `precioDeCarta` del producto candidato Y de cada opción ya en el grupo, **en la sucursal activa de quien administra** (`ctx.sucursalId`, mismo criterio que el resto de `/catalogo/carta/agrupados`, D7). Si no coinciden exactamente → error, sin escribir nada: *"«Fanta 500cc» cuesta $X acá y «Gaseosa 500cc» ya tiene opciones a $Y: agrupá solo productos del mismo precio, o dejala aparte."* El primer producto de un grupo nuevo no tiene con qué comparar, así que siempre se puede agregar.<br><br>**Por qué esto es sostenible siendo `agregarOpcion` una escritura de carta:** a diferencia de D4 (la categoría de una opción se define y cambia en Catálogo, fuera del alcance de la carta, por eso ahí solo se avisa), el precio en el momento de armar el grupo SÍ es una decisión que se toma desde esta misma pantalla, así que bloquearla ahí es consistente y no pisa ninguna otra pantalla.<br><br>**Lo que el bloqueo NO puede evitar (el "habría que ver" del dueño):** después de agrupadas, alguien puede cambiar el precio de UN producto en Catálogo o su precio local, sin pasar por la carta — el guardián `carta-solo-lectura` ya prohíbe que la carta escriba `precioVenta`/`PrecioLocalProducto`, así que no hay forma de bloquear ESO desde acá. Para ese caso residual (no el camino normal, una divergencia posterior) se mantiene una red de seguridad puramente defensiva en `armarMenuCarta`: **se muestra el MAYOR** de los precios vigentes (nadie paga más de lo que vio en la carta) y el admin avisa en ámbar con el rango y un enlace a cada producto para corregirlo. `diagnostico.agrupadosConPreciosDistintos` (interno) sigue existiendo para esto.<br><br>**Por qué NO un precio propio del grupo** (se mantiene la evaluación anterior):<br>1. Reabre la paridad "carta = lo que se cobra" (`precioDeCarta` + su test de paridad en `armar-menu.test.ts`).<br>2. Pierde el precio por sucursal: necesitaría otra tabla de override, un tercer lugar para el mismo precio.<br>3. El guardián de solo-lectura ya impide que la carta escriba el precio real, así que un precio propio del grupo podría desincronizarse sin que nada lo marque.<br>`PromoCarta.precio` no es una analogía válida: esa promo es informativa, no se vende como un `Producto` real.<br><br>**Cómo encaja con «Los Miches» (A.13):** cargar "Gaseosa 500 CC $5000" es poner $5000 en Coca, Sprite y Fanta 500cc ANTES de agruparlas — si alguna quedó en $5500 sin corregir, el alta la rechaza hasta que se le ajuste el precio o se la deje sin agrupar, en vez de agruparla con un precio que después la carta tiene que "corregir" mostrando otro valor. |
| D6 | Contrato público | **`version: 1` sin cambios; campo aditivo opcional, presente solo en los ítems agrupados:**<br>`opciones?: OpcionItemCartaV1[]`, con `OpcionItemCartaV1 = { productoId: string; nombre: string; precio: number }`, solo las opciones disponibles en la sucursal, en su orden.<br>• En un ítem agrupado, `productoId` = **el id del `ItemAgrupadoCarta`**, documentado en el tipo. No se usa el id de la primera opción: si un consumidor busca ese id como `Producto`, falla a la vista en vez de tomar en silencio "Coca-Cola" como si fuera el ítem.<br>• La presencia de `opciones` es lo que distingue un ítem agrupado.<br>• Los ítems sin agrupar **no llevan la clave**: el JSON queda byte por byte como hoy, y los 3 tests con `toEqual` quedan idénticos (A.6).<br>• restaurant-menu-design sigue andando sin tocarlo (A.5): dibuja "Gaseosa 500cc" como un ítem más, con su precio.<br>Descartado: subir a `version: 2`. Obliga a un deploy coordinado, y cualquier tenant migrado cae al respaldo en la ventana entre deploys. |
| D7 | UI de administración | **Pantalla nueva `/catalogo/carta/agrupados`** ("Ítems agrupados"), protegida con `requierePermisoVer(…, "carta")` y con Server Actions `conPermiso("carta")`. Es la acción que ya existe, así que no hay migración de permisos. Sigue el precedente de `/portal` y `/tema`: la pantalla de `/catalogo/carta` ya tiene 4 bloques y 411 líneas.<br>• Lista de ítems agrupados, con un `<details>` y el formulario del ítem por cada uno.<br>• Dentro de cada ítem, sus opciones: orden, "Quitar" y el estado en esta sucursal (disponible o no, y su precio).<br>• Un select "Agregar producto" con los PV disponibles acá que todavía no están en ningún grupo. Es la analogía Insumo→Grupo al revés: en vez de elegir el grupo desde cada fila, se eligen las filas desde el grupo.<br>• Los avisos de D4 y D5.<br>En `/catalogo/carta` hay un cambio mínimo y aditivo:<br>• la fila del PV agrupado dice "en «Gaseosa 500cc»" en vez de "sin contenido" u "oculto";<br>• esos PV salen de la lista "sin contenido" (A.8). |
| D8 | Reportes | **Ningún reporte cambia.** `reporte-secciones.ts` opera en el nivel categoría → sección de carta y reagrupa por `CategoriaProducto.nombre`. `periodo.ts` agrega ventas por `productoId`. La venta real sigue siendo de Coca-Cola 500cc, no de "Gaseosa 500cc".<br>El agrupado no genera movimientos ni se vende como tal: es solo cómo se lee la carta.<br>`git diff` sobre `src/core/reportes/` y `src/core/carta/reporte-secciones.ts` tiene que salir vacío.<br>Única interacción: la atribución por la categoría de la opción (aviso de D4).<br>Un rollup "ventas por ítem agrupado" sería un pendiente aparte, que se compone igual que el de secciones (E). |
| D9 | Alcance: ¿global o por sucursal? | **Global (Catálogo Central)**, como `SeccionCarta`, `CategoriaSeccionCarta` y `ContenidoCartaProducto`.<br>Lo que cambia por sucursal ya existe:<br>• qué opciones están disponibles (`whereDisponibleEn`), así que la sucursal A puede mostrar Coca y Sprite, y la B, Coca y Pepsi, con el mismo "Gaseosa 500cc";<br>• el precio (precio local).<br>Un ítem agrupado sin ninguna opción disponible en la sucursal **no sale** y queda en el diagnóstico. Si hiciera falta un override por sucursal, se agrega después, de forma aditiva. |
| D10 | ¿Mostrar al cliente qué opciones hay? | **Fuera del alcance obligatorio.** El contrato ya trae `opciones` (D6).<br>Dibujarlas (por ejemplo "Coca-Cola · Sprite · Fanta" bajo el nombre, o "desde $X") es un paso **opcional** de restaurant-menu-design (R1), sujeto a que el dueño lo pida.<br>motor2 **no** concatena las opciones en `descripcion`: una descripción escrita a mano ("Coca, Sprite, Fanta") mentiría cuando una sucursal se queda sin Fanta, y la lista de `opciones` ya viene filtrada por disponibilidad. |

---

## C. Paso 0: línea de base (antes de tocar nada)

**motor2** (`/home/user/motor2`, rama `claude/merge-menu-inventory-repos-5ot8uc`, limpio, `f91e043`):
- Bases locales nuevas: `motor2_agrupados` (dev) y `motor2_agrupados_e2e` (e2e), usuario `motor2`/`motor2`, Postgres local en el puerto 5432. **Nunca Neon ni producción.**
- `.env` local:
  - `DATABASE_URL` y `DIRECT_URL` → `motor2_agrupados`;
  - `MOTOR2_E2E_DATABASE_URL` → `motor2_agrupados_e2e`;
  - `AUTH_SECRET` (`npx auth secret`);
  - `CARTA_API_TOKEN=dev-token`.
- Migrar las dos bases: `DIRECT_URL=... npx prisma migrate deploy`.
- Correr y **anotar**:
  1. `npx tsc --noEmit` (único ruido esperado: `LayoutProps`).
  2. `npm run lint` (errores y warnings).
  3. `npm test` ("Test Files X passed / Tests Y passed").
  4. `npm run build` (warnings).
  5. `npm run test:e2e` ("N passed"; confirmar `[e2e] Servidor: build`). Si Chromium no coincide de versión (problema ya conocido del sandbox), usar un config temporal **no comiteado** que extienda `playwright.config.ts` con `use.launchOptions.executablePath = "/opt/pw-browsers/chromium"`. Nunca `playwright install`.
  6. Contar los archivos de spec: `ls test/e2e/*.spec.ts | wc -l`.

**restaurant-menu-design:** no se toca en el camino obligatorio (D6). Solo como referencia: `pnpm build` en `/home/user/restaurant-menu-design`, para confirmar después que sigue igual.

---

## D. Pasos de implementación (un commit por paso, en orden)

### M1: schema y migración. **REQUIERE AUTORIZACIÓN EXPRESA.** Solo contra las bases locales `motor2_agrupados` y `motor2_agrupados_e2e`, nunca contra Neon ni producción.

En `prisma/schema.prisma`, sección `// CARTA`, después de `ContenidoCartaProducto`:

```prisma
/// Ítem AGRUPADO de la carta (docs/plan-agrupacion-items-carta-2026-09-24.md): un solo renglón visible ("Gaseosa 500cc") que
/// agrupa varios PV reales y distintos (Coca-Cola 500cc, Sprite 500cc…). Lleva lo de cara al cliente (como ContenidoCartaProducto).
/// SIN precio propio (D5): el precio es el de sus opciones, que tienen que coincidir; si no, la carta muestra el mayor y el
/// admin avisa. Global (Catálogo Central). Se ubica por su categoría → sección de carta, igual que un PV. Un solo nivel, sin
/// árbol (no es Grupo). Nunca se borra: se apaga.
model ItemAgrupadoCarta {
  id            String                    @id @default(cuid())
  nombre        String                    @unique
  categoriaId   String
  categoria     CategoriaProducto         @relation(fields: [categoriaId], references: [id])
  descripcion   String?
  imagenUrl     String?
  tags          String[]                  @default([])
  especial      Boolean                   @default(false)
  /// Orden dentro de su categoría (misma escala que ContenidoCartaProducto.orden).
  orden         Int                       @default(0)
  activo        Boolean                   @default(true)
  creadoEn      DateTime                  @default(now())
  actualizadoEn DateTime                  @updatedAt
  opciones      OpcionItemAgrupadoCarta[]

  @@index([categoriaId])
  @@index([activo])
}

/// Un PV real dentro de un ítem agrupado. `productoId @unique`: un producto está en a lo sumo UN ítem agrupado (D2). Un producto
/// agrupado nunca sale suelto en la carta, aunque tenga ContenidoCartaProducto visible (D3). Quitarlo = borrar esta fila (es
/// solo una referencia, como CategoriaSeccionCarta).
model OpcionItemAgrupadoCarta {
  id                  String            @id @default(cuid())
  itemAgrupadoCartaId String
  itemAgrupadoCarta   ItemAgrupadoCarta @relation(fields: [itemAgrupadoCartaId], references: [id])
  productoId          String            @unique
  producto            Producto          @relation(fields: [productoId], references: [id])
  /// Orden de la opción dentro del ítem agrupado.
  orden               Int               @default(0)
  creadoEn            DateTime          @default(now())

  @@index([itemAgrupadoCartaId])
}
```

- **Relaciones inversas**, solo las que Prisma exige, sin lógica:
  - en `Producto`: `opcionItemAgrupadoCarta OpcionItemAgrupadoCarta?`;
  - en `CategoriaProducto`: `itemsAgrupadosCarta ItemAgrupadoCarta[]`.
- Sin `onDelete: Cascade`: queda en RESTRICT, como el resto del catálogo.
- `npx prisma migrate dev --create-only --name carta_items_agrupados`. Revisar el SQL: 2 `CREATE TABLE`, índices únicos (`nombre`, `productoId`), 2 índices simples y 3 FK, **sin backfill** (opt-in). Después aplicar.
- **Mismo commit:** en `test/setup/test-db.ts::limpiarBaseDeTest`, al **principio** del bloque de carta:
  - `await prisma.opcionItemAgrupadoCarta.deleteMany();` y después `await prisma.itemAgrupadoCarta.deleteMany();`;
  - cambiar el comentario a "sus 8 tablas".
- Chequeo: `npx tsc --noEmit` y `npm test` completos, sin cambios de resultado.

### M2: `src/core/carta/armar-menu.ts`, lógica pura (sin Prisma)

Todo va acá porque el docstring del módulo ya dice que es el único que decide el precio y el agrupamiento de la carta.

**Tipos:**
- `OpcionItemCartaV1 { productoId; nombre; precio }`.
- `ItemCartaV1.opciones?: OpcionItemCartaV1[]`, con un docstring que explique D6: solo en ítems agrupados, y en esos `productoId` es el id del ítem agrupado.
- Entrada: `ItemAgrupadoEntrada { id; nombre; categoriaId; categoriaNombre; contenido: ContenidoCartaEntrada; opciones: ReadonlyArray<{ productoId; nombre; precioVenta; orden }> }`, con las opciones **ya filtradas**: PV y disponibles en la sucursal.
- `EntradaArmarMenu.agrupados?: readonly ItemAgrupadoEntrada[]`, **opcional**, para que `armar-menu.test.ts` compile y quede idéntico.

**Diagnóstico** (se agrega; no se expone):
- `agrupadosSinSeccion: { id, nombre, categoria }[]`;
- `agrupadosSinOpciones: { id, nombre }[]`;
- `agrupadosConPreciosDistintos: { id, nombre, minimo, maximo }[]`.

**Reglas:**
- Se juntan los `productoId` de las opciones. Si un producto de `productos` aparece también como opción, sale **solo** dentro del grupo (defensa de D3).
- Por cada ítem agrupado:
  - sin opciones → `agrupadosSinOpciones`, no se emite;
  - sin sección activa por su categoría → `agrupadosSinSeccion`, no se emite;
  - si no, precio de cada opción = `precioDeCarta(o.precioVenta, precioLocalPorProducto.get(o.productoId))`. `precio` = el **mayor** (D5: nadie paga más de lo que vio en la carta); si mínimo ≠ máximo → `agrupadosConPreciosDistintos`.
  - OJO: en el camino normal esto nunca da distinto, porque `agregarOpcionItemAgrupadoCarta` (M5) ya bloquea agregar una opción con otro precio. Esta rama de `armarMenuCarta` es la red de seguridad para cuando el precio de una opción cambia DESPUÉS, en Catálogo, sin pasar por la carta — sigue siendo necesaria porque `armar-menu.ts` no sabe nada de cómo se armó el grupo, solo lee lo que hay.
- El ítem emitido:

  ```
  { productoId: ag.id, nombre: ag.nombre, categoria: ag.categoriaNombre,
    descripcion: textoONull(...), precio, tags: limpiarTags(...), especial,
    imagenUrl: urlImagenSegura(...),
    opciones: [...] (ordenadas por orden → nombre, localeCompare "es") }
  ```

- Entra al mismo `itemsPorSeccion` con `ordenCategoria` y `ordenContenido = ag.contenido.orden`, así que ordena igual que un PV.
- Los ítems sin agrupar se construyen **exactamente** con el literal actual, sin tocarlo y sin la clave `opciones`.

**Test nuevo `test/carta/armar-menu-agrupados.test.ts` (puro).** `armar-menu.test.ts` queda idéntico.
1. **Sin agrupar = como hoy:** con la misma entrada sin `agrupados`, con `agrupados: []` y con un agrupado del que no es miembro ningún producto de la entrada, la `carta` sale deep-equal y con `JSON.stringify` idéntico. Además, `Object.keys(item)` de un ítem común es exactamente la lista de 8 claves de hoy, sin `opciones`.
2. **Forma del ítem agrupado:**
   - `productoId` = id del agrupado;
   - nombre, categoría, descripción, tags y ★ salen del agrupado, no de las opciones;
   - `opciones` en orden → nombre, con `{ productoId, nombre, precio }`;
   - `version` sigue en 1.
3. **Un producto presente como suelto y como opción** sale solo dentro del grupo.
4. **Precio (caso «Los Miches», A.13) — probando la RED DE SEGURIDAD de `armar-menu.ts`, no el bloqueo (que es de M5, a nivel Server Action; acá se simula el escenario ya agrupado con un drift posterior, construyendo la entrada a mano):**
   - 3 opciones a $5000 → 5000, sin diagnóstico;
   - una opción a $5500 (drift simulado) → 5500 (el mayor), más `agrupadosConPreciosDistintos` con `{minimo: 5000, maximo: 5500}`;
   - precio local habilitado en una opción → se usa;
   - precio local deshabilitado → no.
   - Paridad: el precio de cada opción es igual a `precioDeCarta`.
5. **Orden:** el agrupado se intercala con los PV sueltos de su categoría por `orden` y después `nombre`, y respeta el orden de la categoría dentro de la sección.
6. **Sin opciones:** no se emite, va al diagnóstico, y una sección que solo tenía ese agrupado desaparece.
7. **Categoría sin sección activa:** no se emite y va a `agrupadosSinSeccion`.
8. **`imagenUrl` insegura** del agrupado → `null`; tags limpios y sin repetidos.

### M3: `src/core/carta/menu-consulta.ts`, lectura con Prisma (nunca escribe)

- **Consulta individual:** se agrega `opcionItemAgrupadoCarta: { is: null }` al `where` de `producto.findMany`. Los agrupados no salen sueltos, esté activo o no su grupo (D3).
- **Consulta nueva, dentro del mismo `Promise.all`:**

  ```ts
  itemAgrupadoCarta.findMany({
    where: { activo: true },
    select: {
      id, nombre, categoriaId,
      categoria: { select: { nombre } },
      descripcion, imagenUrl, tags, especial, orden,
      opciones: {
        where: { producto: { tipo: "PV", ...whereDisponibleEn(sucursalId) } },
        select: { orden, producto: { select: { id, nombre, precioVenta } } },
      },
    },
  })
  ```

- `precioLocalProducto.findMany`: `productoId in` la **unión** de los ids sueltos y los de las opciones. Se sigue saltando si la unión está vacía.
- `Number()` sobre todos los `Decimal`. Se pasa `agrupados` a `armarMenuCarta`.
- **Test nuevo `test/carta/items-agrupados-consulta.test.ts`** (Postgres). `menu-consulta.test.ts` queda idéntico.
  1. **Regresión:** con el fixture de hoy, crear un ítem agrupado sin opciones o con opciones de otra sucursal no cambia la carta. Se compara deep-equal antes y después, con `ahora` fijo.
  2. **Las opciones salen solo si están disponibles en la sucursal.** Otra sucursal ve sus propias opciones, y un MP asignado a mano no sale.
  3. **Una opción con `ContenidoCartaProducto.visibleEnCarta = true`** sale solo dentro del grupo.
  4. **Grupo apagado:** no sale, y sus miembros tampoco salen sueltos.
  5. **Reversibilidad:** borrar la fila de opción hace que el PV vuelva a salir suelto con su contenido previo.
  6. **Precio local por sucursal:** con las tres opciones a $5000, "Central" muestra $5000. Otra sucursal con un precio local de $5500 en una opción muestra $5500, y "Central" sigue en $5000.
  7. **No escribe:** el conteo de las 8 tablas de carta, más `producto` y `disponibilidadProducto`, no cambia.

### M4: contrato del endpoint (Vitest y E2E). `route.ts` no se toca.

- `git diff src/app/api/carta/[sucursal]/route.ts` vacío: el endpoint ya serializa lo que devuelve `resolverMenuCarta`.
- **Test nuevo `test/carta/api-carta-agrupados.test.ts`** (caso «Los Miches», A.13, tres opciones a $5000):
  - `GET` con token → 200, `version === 1`;
  - el ítem agrupado es `toEqual({ productoId: <id del agrupado>, nombre: "Gaseosa 500 CC", categoria, descripcion, precio: 5000, tags, especial, imagenUrl: null, opciones: [{ productoId, nombre, precio: 5000 }, …] })`;
  - en la misma sección, un PV suelto **sin** la clave `opciones`;
  - el JSON no contiene el `codigo` de las opciones, `precioVenta`, `observaciones` ni `diagnostico`.
- **Spec nuevo `test/e2e/api-carta-agrupados.spec.ts`**, contra el build de producción:
  - se siembra una categoría, una sección, dos PV disponibles en "Central" a $5000, el agrupado y sus opciones → 200 con un solo renglón a $5000 y `opciones` con los dos;
  - se sube uno de los dos a $5500 → el renglón pasa a mostrar 5500 (el mayor);
  - se limpia en `finally`, **las filas de opción primero** (RESTRICT): opciones → agrupado → puente → sección → disponibilidad → productos → categoría.
- `test/carta/api-carta.test.ts` y `test/e2e/api-carta.spec.ts` quedan **idénticos**.

### M5: validaciones y Server Actions `src/server/actions/carta/items-agrupados.ts`

- **`src/core/carta/validaciones.ts`:** `validarNombreItemAgrupadoCarta` (mismo patrón que `validarNombreSeccionCarta`, mensaje propio). El resto se reusa: `validarTextoLibreCarta`, `validarImagenUrlCarta`, `normalizarTagsCarta`, `validarOrdenCarta`.
- **Acciones**, todas envueltas en `conPermiso("carta", …)`:
  - `guardarItemAgrupadoCarta({ id?, nombre, categoriaId, descripcion, imagenUrl, tags, especial, orden }): ResultadoConId`:
    - nombre repetido sin distinguir mayúsculas → error (como en secciones);
    - la categoría tiene que existir.
  - `actualizarActivoItemAgrupadoCarta(id, activo)`: nunca se borra.
  - `agregarOpcionItemAgrupadoCarta(itemAgrupadoCartaId, productoId, orden?)`:
    - el ítem existe; el producto existe y es PV;
    - si ya está en **otro** grupo → error "«Sprite 500cc» ya está en «Gaseosa 1,5L»: quitalo de ahí primero";
    - si ya está en **este** → error "ya está";
    - un `P2002` por carrera se traduce al mismo mensaje;
    - **bloqueo de precio (D5, decisión del dueño):** si el ítem ya tiene al menos una opción, se calcula `precioDeCarta` del producto candidato y de las opciones existentes, las tres en `ctx.sucursalId` (la sucursal activa de quien administra). Si el candidato no coincide con el precio ya establecido del grupo → error, **no se agrega nada**: *"«Fanta 500cc» cuesta $X acá y «Gaseosa 500cc» ya tiene opciones a $Y: agrupá solo productos del mismo precio, o dejala aparte."* El primer producto de un ítem nuevo (sin opciones todavía) no tiene con qué comparar, así que entra siempre;
    - devuelve el aviso de D4 en el mensaje de éxito si la categoría del producto cae en otra sección.
  - `actualizarOrdenOpcionItemAgrupadoCarta(opcionId, orden)`.
  - `quitarOpcionItemAgrupadoCarta(opcionId)`: `deleteMany` por id. El producto y su contenido no se tocan.
- **Solo escriben** en `itemAgrupadoCarta` y `opcionItemAgrupadoCarta`. No registran en `RegistroAuditoria`: no está en `TABLAS_DE_CARTA`, igual que el resto de las acciones de carta.
- **Guardián `test/arquitectura/carta-solo-lectura.test.ts`:** sumar `"itemAgrupadoCarta"` y `"opcionItemAgrupadoCarta"` a `TABLAS_DE_CARTA` y actualizar el texto a "las 8 tablas de carta" (docstring y nombre del `it`).
- **Test nuevo `test/carta/acciones-items-agrupados.test.ts`:**
  - **Permiso:** un operador sin `carta` no escribe nada, con el mismo patrón que `acciones-carta.test.ts`.
  - **Alta, edición y nombre repetido** (sin distinguir mayúsculas).
  - **Validaciones:** imagen insegura, tags, descripción larga, orden no entero, categoría inexistente. En ningún caso se escribe.
  - **Opciones:**
    - solo PV (un MP da error);
    - el producto en otro grupo da error con el nombre de ese grupo;
    - **precio (D5, caso «Los Miches»):** Coca y Sprite a $5000 se agregan sin problema; Fanta a $5500 se RECHAZA con el mensaje de arriba y no queda ninguna fila nueva; bajar Fanta a $5000 (edición en Catálogo, fuera de esta acción) y reintentar → se agrega. El primer producto de un ítem recién creado se agrega sin comparar nada (todavía no hay precio de referencia);
    - agregar, reordenar y quitar;
    - quitar deja intacto `ContenidoCartaProducto`.
  - **Apagar y prender:** la fila sigue existiendo.
  - **No toca `Producto`:** el `precioVenta`, la `categoriaId` y el `ContenidoCartaProducto` del producto no cambian.
  - **Fin a fin:** después de agregar dos opciones, `resolverMenuCarta` muestra el agrupado.

### M6: lectura del admin y ajuste mínimo de `/catalogo/carta`

- **`src/core/carta/admin-consulta.ts`:**
  - **`cargarAdminCarta`:**
    - el `select` de productos suma `opcionItemAgrupadoCarta: { select: { itemAgrupadoCarta: { select: { nombre: true } } } }`;
    - `ProductoCartaAdmin.agrupadoEn: string | null`;
    - `sinContenido` excluye a los que tienen `agrupadoEn` (A.8).
  - **Nuevo `cargarAdminItemsAgrupados(sucursalId, db)`:** todos los ítems agrupados (activos primero, orden, nombre) con:
    - su categoría y su sección activa;
    - cada opción con su `productoId` (para el enlace `/catalogo/productos/<id>/editar`), nombre, categoría, sección, `disponibleAca` y precio acá (con `precioDeCarta`);
    - los avisos calculados de D4 y D5 — el de D5 con el rango ($X a $Y) y el precio que se termina mostrando (el mayor);
    - las categorías, para el select;
    - los "PV disponibles acá sin grupo", para el select de "Agregar";
    - `resolverMenuCartaConDiagnostico` para los diagnósticos.
- **`src/app/(app)/catalogo/carta/page.tsx`:** en `ContenidoProducto`, `estado` = `"en «X»"` cuando hay `agrupadoEn`, con un enlace a `/catalogo/carta/agrupados`. No cambia nada más.
- **Test nuevo `test/carta/admin-items-agrupados.test.ts`** (Postgres):
  - un PV agrupado sin contenido **no** está en `sinContenido` y tiene `agrupadoEn`;
  - los avisos: precios distintos (el aviso muestra el rango $X-$Y y el precio mostrado es el mayor), opción de otra sección, sin opciones acá.
- El test E2E `carta-admin.spec.ts` y el chequeo de axe de `/catalogo/carta` quedan en verde sin tocarlos.

### M7: pantalla `/catalogo/carta/agrupados`

- **`src/app/(app)/catalogo/carta/agrupados/page.tsx`:** usa `requierePermisoVer(ctx.usuarioId, ctx.sucursalId, "carta")` y trabaja sobre la sucursal activa (para la disponibilidad y los precios que se ven).
  - **Encabezado:** "Ítems agrupados de la carta", con la regla de precio de D5: "Solo se pueden agrupar productos del mismo precio (acá). Si el precio de uno cambia después en Catálogo, la carta lo va a mostrar por el mayor, con aviso, hasta que se corrija."
  - **Lista:** `<li data-item-agrupado="<nombre>">`, con un `<details>`.
    - **Resumen:** nombre · categoría · sección de carta · "N de M opciones disponibles acá" · precio (o "$X–$Y") · activo/apagado · ★.
    - **Formulario del ítem** (`FormConResultado`, con campos al estilo de `CamposSeccion` y `ContenidoProducto`): nombre, categoría (select), descripción, tags, imagen, ★ y orden.
    - **Opciones:** una por fila, con su orden (y "Guardar orden"), "Quitar", "no disponible en esta sucursal" cuando corresponda, y el aviso de D4 por opción.
    - **"Agregar producto":** select con los PV disponibles acá que no están en ningún grupo.
    - **Botón Apagar/Prender.**
  - **Avisos en ámbar**, con las clases ya usadas en `/catalogo/carta` (`text-amber-700 dark:text-amber-600`, por `contraste-de-color.test.ts`): precios distintos acá — solo puede pasar por un cambio posterior en Catálogo, nunca al agregar desde esta pantalla (D5) — ("En esta sucursal las opciones no cuestan lo mismo ($X a $Y): la carta muestra $Y. Igualalas en Catálogo o en el precio local", con el precio de cada opción y enlace a `/catalogo/productos/<id>/editar`), sin opciones disponibles acá y sin sección de carta.
  - **"Agregar producto":** si el intento se rechaza por precio (D5), el error de la Server Action se muestra en el resultado del formulario tal cual lo devuelve la acción — no hace falta deshabilitar opciones del select de antemano.
  - **Formulario "Nuevo ítem agrupado"**, en la caja punteada de siempre.
  - Los closures capturan solo ids y llaman a `refrescarVistaSiHaceFalta` cuando sale bien, como en `page.tsx`.
- **`src/core/navegacion/estructura.ts`:** `{ href: "/catalogo/carta/agrupados", label: "Ítems agrupados de la carta", accion: "carta" }`, después de "Carta pública". Lo exigen `menu-con-permiso` y `enlaces-con-permiso`.
- **`test/e2e/rutas-sin-parametros.ts`:** sumar `"/catalogo/carta/agrupados"`.
- **Spec nuevo `test/e2e/carta-items-agrupados.spec.ts`** (caso «Los Miches», A.13):
  1. Sembrar una categoría "E2E Gaseosa 500 CC …" asignada a una sección, y **cuatro** PV disponibles en la sucursal de la sesión: tres a $5000 y uno (Fanta) a $5500.
  2. Crear "Gaseosa 500 CC" desde la pantalla, con descripción y ★, y agregar las tres de $5000: entran todas.
  3. Intentar agregar Fanta ($5500): la pantalla muestra el error de bloqueo de D5 y Fanta sigue apareciendo en el select de "sin grupo" (no quedó agregada).
  4. Sin aviso de precios distintos (nunca se llegó a agrupar algo distinto). `GET /api/carta/<sucursal>` → un solo renglón a $5000 con 3 opciones, y Fanta sigue suelta con su propio renglón a $5500.
  5. Quitar una opción del grupo: quedan 2 opciones.
  6. Apagar el ítem: el renglón desaparece y los PV no salen sueltos.
  7. Limpieza en `finally`, en el orden RESTRICT de M4.
- **Chequeo de axe** en `test/e2e/accesibilidad.spec.ts`: la pantalla con un ítem abierto, con el aviso de precios visible, y los selects con etiqueta accesible.

### restaurant-menu-design: nada obligatorio

**R1 (opcional, sujeto a que el dueño lo pida; commit aparte, aditivo, sin tocar la guardia de versión):**
- en `lib/carta-motor2.ts`, tipar `opciones?` en `ItemCartaMotor2V1`;
- que el mapper, si hay opciones, las muestre (por ejemplo, la lista de nombres como línea extra de la descripción, o "desde $X" cuando los precios difieren).

Sin R1, la carta dibuja "Gaseosa 500cc" como un ítem común y todo funciona (A.5). Si se hace R1, `git diff --stat components/` tiene que salir vacío.

---

## E. Riesgos y temas abiertos (ninguno bloquea)

- **Precio de D5 (revisado, decisión del dueño):** agrupar con precio distinto queda BLOQUEADO al agregar la opción — el dueño lo pidió explícito. El riesgo que queda es solo el residual: alguien cambia el precio de un producto YA agrupado, en Catálogo, sin pasar por la carta. Ahí la carta muestra el mayor (nadie paga más de lo que vio) y el admin avisa con el rango y el enlace a cada producto para corregirlo.
- **Nota operativa de migración («Los Miches», A.13):** cada fila de la sheet como "Gaseosa 500 CC $5000" se convierte, al migrar ese tenant, en las opciones (Coca, Sprite, Fanta 500cc) puestas a $5000 en Catálogo (o en su precio local) más el ítem agrupado "Gaseosa 500 CC" con esas tres opciones. No hay backfill automático: es carga manual, tenant por tenant, igual que el resto de la migración de carta.
- **Atribución en "Ventas por sección de carta" (D4):** una opción de otra categoría cuenta en la sección de SU categoría. La pantalla lo avisa, y la configuración recomendada (categoría y agrupado con el mismo nombre) lo evita.
- **Hasta 5 minutos** para que un cambio se vea en la carta (`revalidate: 300`, sin cambios).
- **Pendientes aparte:**
  - subtítulo por ítem (A.2);
  - rollup "ventas por ítem agrupado";
  - override por sucursal (D9);
  - en "tomar pedido", elegir la opción al pedir un ítem agrupado (`opciones` ya deja el dato listo);
  - si algún día el grupo necesitara cobrar por sí mismo (más allá del precio derivado de D5), sería un cambio aditivo de ESE pendiente (ej. columna `precio Decimal?` en `ItemAgrupadoCarta`), con su propia decisión — no reabre lo que se resolvió acá.

---

## F. Verificación end-to-end final (obligatoria)

**Criterio de cierre conjunto:** el pendiente está terminado **solo** cuando **todos** estos comandos pasan limpios **en la misma corrida**, sobre las bases locales del Paso 0 y después del último commit. Nunca Neon ni producción.

| Comando | Criterio de éxito |
|---|---|
| `npx tsc --noEmit` | Salida vacía, salvo el ruido de `LayoutProps` que ya estaba |
| `npm run lint` | 0 errores y 0 warnings nuevos respecto de la línea de base |
| `npm test` (Vitest contra Postgres real, suite ENTERA) | Todo en verde. Test Files y Tests ≥ línea de base más los nuevos: `armar-menu-agrupados`, `items-agrupados-consulta`, `api-carta-agrupados`, `acciones-items-agrupados` y `admin-items-agrupados`. **Idénticos (`git diff` vacío) y en verde:** `test/carta/api-carta.test.ts`, `armar-menu.test.ts`, `menu-consulta.test.ts`, `reporte-secciones.test.ts` y `acciones-carta.test.ts` |
| `npm run build` (solo contra la base local) | Aplica la migración `carta_items_agrupados` sin errores. Build limpio y sin warnings nuevos. `/catalogo/carta/agrupados` aparece como ruta, y `/api/carta/[sucursal]` sigue dinámica (ƒ) |
| `npm run test:e2e` (Playwright, suite ENTERA, `[e2e] Servidor: build`) | Todo en verde. Specs ≥ línea de base más `api-carta-agrupados.spec.ts`, `carta-items-agrupados.spec.ts` y el chequeo de axe nuevo. `api-carta.spec.ts` **idéntico**. Si Chromium no coincide, usar el config temporal no comiteado con `executablePath: "/opt/pw-browsers/chromium"`; nunca `playwright install` |

**Diffs que tienen que salir vacíos:**
- `git diff f91e043 -- src/core/reportes/ src/core/carta/reporte-secciones.ts src/app/api/carta/ src/core/catalogo/`;
- `git diff f91e043 -- test/carta/api-carta.test.ts test/e2e/api-carta.spec.ts test/carta/armar-menu.test.ts test/carta/menu-consulta.test.ts`.

**Tests a mirar con atención especial:**
- **Guardianes:**
  - `carta-solo-lectura.test.ts` (8 tablas);
  - `disponibilidad-en-un-solo-lugar.test.ts` (el `whereDisponibleEn` anidado);
  - `acciones-con-guarda.test.ts`;
  - `menu-con-permiso`, `enlaces-con-permiso`, `contraste-de-color` y `region-de-las-funciones` (`vercel.json` no se toca).
- **Carta:** `test/carta/*` y los specs `carta-admin.spec.ts`, `api-carta*.spec.ts` y `accesibilidad.spec.ts` (los bloques de `/catalogo/carta`, `/portal` y `/tema`).
- **Reportes:** `reporte-secciones.test.ts`, `test/reportes/periodo.test.ts`, `catalogo-una-sola-carga.test.ts` y `reportes-consolidado-promociones-categorias.spec.ts`. Tienen que dar exactamente lo mismo que antes (D8).
- **Catálogo y POS:** `test/catalogo/*`, `catalogo-*.spec.ts` y `pos-mapa-de-mesas.spec.ts`. La relación nueva en `Producto` y en `CategoriaProducto` no tiene que romper altas, ediciones ni desactivaciones.

**Verificación manual mínima (caso «Los Miches», A.13):**
1. `npm run dev` con `CARTA_API_TOKEN=dev-token`. En "Central":
   - categoría "Gaseosa 500 CC" en la sección "Bebidas sin alcohol";
   - PV Coca-Cola 500cc, Sprite 500cc y Fanta 500cc, los tres a $5000, disponibles;
   - Sprite ya con un `ContenidoCartaProducto` visible.
2. En `/catalogo/carta/agrupados`: crear "Gaseosa 500 CC" con descripción y ★, y agregar las tres opciones. Sin aviso (los tres precios coinciden).
2b. **Bloqueo (D5):** poner Fanta a $5500 en Catálogo y tratar de agregarla a un grupo nuevo que ya tenga alguna opción a $5000 → se rechaza con el mensaje de D5 y no queda agregada. Bajarla a $5000 y reintentar → se agrega sin problema.
3. `curl -H "Authorization: Bearer dev-token" localhost:3000/api/carta/<id>` debe devolver:
   - **un** renglón "Gaseosa 500 CC", `precio: 5000`, 3 `opciones` a $5000;
   - Sprite **no** sale suelta;
   - `version: 1`;
   - los demás ítems sin la clave `opciones`.
4. **Simular el drift residual** (D5): con Fanta YA agregada a $5000, subirle el precio local a $5500 en "Central" DESPUÉS, directo en Catálogo (no por esta pantalla): el renglón de la carta pasa a $5500 (el mayor) y aparece el aviso "$5000 a $5500: la carta muestra $5500" — esto es la red de seguridad para cuando el bloqueo de alta ya no aplica (la opción entró con precio correcto y cambió después).
5. Deshabilitar ese precio local: vuelve a $5000 y el aviso desaparece.
6. Otra sucursal sin ese precio local sigue mostrando $5000 mientras "Central" muestra $5500 (paso 4).
7. Apagar la disponibilidad de Coca y Sprite: queda 1 opción (Fanta) y su precio.
8. Apagar las tres:
   - el renglón desaparece;
   - "sin opciones disponibles acá" aparece en el admin.
9. Quitar Sprite del grupo: vuelve a salir suelta con su contenido de antes.
10. Apagar el ítem agrupado: no sale ni el renglón ni sus opciones sueltas.
11. En `/catalogo/carta`: los PV agrupados dicen "en «Gaseosa 500 CC»" y no aparecen en el aviso "sin contenido".
12. `/reportes/ventas-por-seccion` con una venta de Coca: igual que antes de crear el grupo.
13. Opcional: con restaurant-menu-design apuntando a este motor2, "Gaseosa 500 CC" se dibuja como un ítem común con $5000.

### Archivos críticos para la implementación
- /home/user/motor2/prisma/schema.prisma (sección `// CARTA` y las relaciones inversas en `Producto` y `CategoriaProducto`)
- /home/user/motor2/src/core/carta/armar-menu.ts (contrato `ItemCartaV1.opciones?`, precio y agrupamiento)
- /home/user/motor2/src/core/carta/menu-consulta.ts y /home/user/motor2/src/core/carta/admin-consulta.ts
- /home/user/motor2/test/arquitectura/carta-solo-lectura.test.ts y /home/user/motor2/test/setup/test-db.ts
- /home/user/motor2/src/app/(app)/catalogo/carta/page.tsx (molde de UI) y /home/user/motor2/src/server/actions/carta/secciones.ts (molde de acciones)
- /home/user/motor2/src/core/movimientos/precio-venta.ts (solo lectura: es la base de D5 — `resolverPrecioVenta`, lo que realmente cobra la caja)
- /home/user/restaurant-menu-design/lib/carta-motor2.ts (solo lectura: confirma que un campo aditivo en v1 no rompe la guardia)
