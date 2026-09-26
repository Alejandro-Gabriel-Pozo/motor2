# Género de carta (carpetas del selector del POS) — 2026-09-26

## Qué es

Una carpeta VISUAL del POS que agrupa, dentro de una sección de carta, tanto productos sueltos como ítems agrupados que
comparten género (ej. "Cerveza" dentro de la sección "Bebidas"). NO implica precio ni sustituibilidad (eso lo sigue
manejando `ItemAgrupadoCarta`, que no se toca en esta implementación). NO es `Grupo` (que es de Insumo/stock) ni
`CategoriaProducto` (que no ubica nada en la carta ni en el POS).

## Decisiones de negocio (ya confirmadas por el dueño)

- **G1 — Alcance**: el género es GLOBAL (como `SeccionCarta`), no específico de una sección. "Cerveza" aparece como carpeta
  en cualquier sección donde tenga contenido pedible.
- **G2 — Orden**: dentro de una sección, las carpetas de género van PRIMERO (por su propio `orden`, después nombre), y los
  productos sin género van DESPUÉS, en el orden de siempre.
- **G3 — Interacción**: la carpeta que estaba abierta queda ABIERTA después de agregar un producto de adentro. Cambiar de
  sección la cierra. Un ítem agrupado SUELTO (sin género) desplegado sigue cerrándose tras agregar, como antes.
- **G4 — Alcance**: SOLO interno del POS por ahora. La carta pública (`CartaV1`, restaurant-menu-design) NO cambia.

## Diseño de datos (aditivo, sin backfill)

- `GeneroCarta` (nueva): `id`, `nombre @unique`, `orden`, `activo`, `creadoEn`. Nunca se borra: se apaga.
- `ContenidoCartaProducto.generoCartaId` (opcional) + relación + índice.
- `ItemAgrupadoCarta.generoCartaId` (opcional) + relación + índice. Las opciones de un agrupado (`OpcionItemAgrupadoCarta`)
  heredan el género de su ítem: nunca tienen uno propio.

Migración: `prisma/migrations/20260926134818_genero_carta`.

## Diseño de la lógica pura (`src/core/pos/selector-carta.ts`)

`armarSelectorCartaPos(carta, pedibles, generos?)` recibe un TERCER parámetro OPCIONAL (`GenerosSelectorCartaPos`: los
géneros activos + un mapa `productoId → generoCartaId` de los contenidos + un mapa `itemAgrupadoCartaId → generoCartaId`
de los ítems agrupados). Sin el parámetro, la salida es IDÉNTICA a la de antes de que existiera el género (aditivo puro).

Con géneros: dentro de una sección, cada entrada (suelto o agrupado) con un género ACTIVO cae en una carpeta
(`EntradaCarpetaGeneroSelectorCarta`); sin género, con un género apagado, o con uno que ya no existe, sigue suelta, SIN
ERROR. Las carpetas van primero (orden → nombre); los sueltos, después, en el orden de la carta. Una carpeta sin ningún
producto pedible en la sucursal se descarta, igual que una sección vacía.

## Estado del selector (`src/core/pos/selector-carta-estado.ts`)

`EstadoSelectorCarta` suma `carpetaAbierta: string | null`, mutuamente excluyente con `agrupadoAbierto` (abrir una cierra
la otra). Un ítem agrupado DENTRO de una carpeta abierta NO tiene su propio disclosure: se muestra siempre desplegado
mientras la carpeta esté abierta (evita la contradicción "abrir un agrupado cierra la carpeta" vs. "un agrupado adentro se
puede abrir sin cerrarla"). Tras `limpiarTrasAgregar`, `carpetaAbierta` queda intacta (G3); `agrupadoAbierto` se sigue
cerrando, como siempre. `elegirSeccion` cierra las dos cosas.

## UI

- **POS** (`src/app/(pos)/mesas/[mesaId]/selector-carta.tsx`): la carpeta se dibuja con `aria-expanded`/`aria-controls`,
  botón `type="button"`. Adentro, un producto suelto es el mismo botón de siempre; un ítem agrupado se muestra siempre
  desplegado (etiqueta + su grilla de opciones), sin botón propio.
- **Admin** (`/catalogo/carta`, mismo archivo/ruta que "Secciones de carta" — SIN ruta nueva, para no tocar
  `GRUPOS_NAV`/`RUTAS_SIN_PARAMETROS`): sección "Géneros de carta" con alta/edición/apagado (mismo patrón que Secciones).
  Select "Género (opcional)" en el alta/edición de contenido de un PV y de un ítem agrupado
  (`/catalogo/carta/agrupados`).

## Permisos

Reusa el permiso `carta` ya existente (mismo gate que el resto de la carta). No se agregó ningún permiso nuevo.

## Estado de los archivos compartidos con #24/#25 (el próximo pendiente construye encima)

- `agregar-items.tsx`: SIN cambios de forma. Sigue siendo el componente que junta el buscador (`SelectorProducto`) y, si
  hay carta, `<SelectorCarta selector={selectorCarta} estado={estado} despachar={despachar} />`, con el reductor de
  `selector-carta-estado.ts` en un `useReducer`. `selectorCarta` sigue siendo `SelectorCartaPos | null`.
- `selector-carta.tsx`: mismo patrón de siempre (una función `SelectorCarta`, sin sub-componentes exportados). Ahora
  distingue tres tipos de entrada de nivel de sección: `"producto"`, `"agrupado"` (suelto, con su propio disclosure) y
  `"carpeta"` (género, con su propio disclosure; adentro reusa `botonProducto` para los sueltos y dibuja los agrupados
  anidados siempre desplegados). El punto de entrada para #24 (rediseño a lista "por agregar") es el mismo `<ul>` con
  `entradas.flatMap(...)`: cualquier rediseño de cómo se AGREGAN los ítems puede seguir leyendo `EntradaSelectorCarta`
  (con su nueva variante `"carpeta"`) sin tocar `selector-carta.ts` ni `selector-carta-consulta.ts`.
- `selector-carta-estado.ts`: el reductor sigue siendo puro, con un solo `useReducer` en `AgregarItems`. Los dos campos
  de disclosure (`agrupadoAbierto`, `carpetaAbierta`) son mutuamente excluyentes; #25 (validación de venta fraccionada)
  puede sumar sus propios campos de estado sin tocar esta exclusión.
