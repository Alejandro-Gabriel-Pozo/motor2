# Plan: «Agregar al pedido» del POS por sección de carta — 2026-09-25

Pantalla de la mesa (`/mesas/<id>`, `src/app/(pos)/mesas/[mesaId]/`). Antes, «Agregar al pedido» era solo un buscador por texto
(`SelectorProducto`, PV disponibles en la sucursal). Ahora, además, se navega por las **secciones de la carta** y un **ítem
agrupado** («Gaseosa 500cc») se despliega para elegir la opción concreta (Coca, Sprite…). Plan diseñado por un agente de
planificación contra el código real e implementado en la rama `feat/carta-secciones-pos-picker`, un commit por paso.

OJO con el nombre: esto trata de `SeccionCarta` (sección de la CARTA, «Platos Principales»), no de `Seccion` (sección de STOCK,
«Depósito»). Todo lo nuevo se llama `…Carta` (`seccionesCarta`, `SeccionSelectorCarta`, `selectorCarta`), nunca `secciones` a secas:
`page.tsx` ya tiene una variable `secciones` que son las de stock (para «Cerrar cuenta»).

## A. Decisiones

- **DP1. Todo lo que la carta pública no muestra va a «Fuera de carta».** Un PV no visible, sin sección, en una sección apagada o
  dentro de un ítem agrupado apagado (ahí sale suelto). El mozo ve la misma ubicación que el cliente en la carta, sin una segunda
  regla, y sigue pudiendo pedir todo lo que podía pedir antes.
- **DP2. El balde se llama «Fuera de carta», nunca «Otros»** (podría chocar con una sección de carta real llamada así).
- **DP3. Sin ninguna sección de carta, la pantalla queda exactamente como antes** (solo el buscador). Cero regresión: la base E2E
  de `pos-tomar-pedido.spec.ts` no siembra carta y esos specs no cambiaron.
- **DP4. Un ítem agrupado con una sola opción disponible igual se despliega** (predecible: siempre se elige la opción).
- **Interacción.** Barra de secciones (`role="group"`, botones con `aria-pressed`, «Fuera de carta» al final) + grilla de la sección a
  la vista (`role="region"`). El agrupado se despliega en el lugar (patrón *disclosure*, `aria-expanded`/`aria-controls`); abrir uno
  cierra el anterior y cambiar de sección lo cierra. Elegir → cantidad → «Agregar», como siempre. Después de agregar se limpia lo
  elegido, se cierra el agrupado y se queda en la misma sección.
- **Buscador y carta, dos caminos al mismo `productoId`.** Elegir en la carta vacía el buscador (`limpiarSenal`); elegir en el
  buscador marca el botón de la carta (`aria-pressed` derivado); tipear en el buscador limpia lo elegido.
- **Todos los botones nuevos son `type="button"`** (viven dentro del `<form>`), ninguno se llama «Agregar», y la línea «Elegido: …»
  no lleva `role="status"` (el aviso de la pantalla es el único `status` con `aria-live`).
- **Precio.** El de cada opción, no el del grupo: la carta muestra el mayor si las opciones difieren (D5 de la agrupación), pero el
  POS cobra el precio real de la opción (`resolverPrecioVenta`). El botón del grupo muestra un precio o el rango «$X a $Y».

## B. Contrato: `SelectorCartaPos` (`src/core/pos/selector-carta.ts`, puro)

```ts
interface ProductoPedible { productoId: string; codigo: string; nombre: string; precio: number }
type EntradaSelectorCarta =
  | { tipo: "producto"; producto: ProductoPedible }
  | { tipo: "agrupado"; itemAgrupadoCartaId: string; nombre: string; precioMinimo: number; precioMaximo: number; opciones: ProductoPedible[] };
interface SeccionSelectorCarta { seccionCartaId: string; nombre: string; entradas: EntradaSelectorCarta[] }
interface SelectorCartaPos { seccionesCarta: SeccionSelectorCarta[]; fueraDeCarta: ProductoPedible[] }
```

- La **estructura** sale de la carta pública ya armada (`resolverMenuCarta` → `CartaV1`): orden de secciones e ítems, agrupados y
  D3. El **precio y el código** salen siempre de los pedibles (una sola fuente; la carta no trae código). Las promos se ignoran.
- **Invariante** (fijado por `test/pos/selector-carta.test.ts`): cada PV pedible aparece exactamente una vez, y ningún
  `itemAgrupadoCartaId` llega como `productoId` — un agrupado se resuelve a la opción concreta en el cliente, antes de llamar a
  `agregarItems` (que no cambió: con el id de un agrupado responde «El producto no existe.»).
- **Lectura** (`selector-carta-consulta.ts`, `cargarSelectorCartaPos`): la carta de la sucursal + los PV disponibles
  (`whereDisponibleEn`) + los precios locales habilitados (`precioDeCarta`, paridad con `resolverPrecioVenta`). Vive en `core/pos`,
  no en `core/carta`: reusa la carta sin tocarla. La llama `page.tsx` después de su guarda de Ver de `pos_mesas`, solo con cuenta
  abierta y `pos_tomar_pedido` Editar (el mozo no tiene el permiso `carta`): **ninguna Server Action nueva**.
- **Estado** (`selector-carta-estado.ts`, reductor puro, testeado en Vitest sin DOM): sección activa, agrupado abierto, producto
  elegido y la señal para vaciar el buscador. El DOM se cubre con Playwright (`test/e2e/pos-carta-secciones.spec.ts` y un caso axe en
  `accesibilidad.spec.ts`).

## C. Por qué no se tocó `SelectorProducto`

`src/components/selector-producto.tsx` busca en el servidor, con tope de 20 resultados, y no sabe nada de categorías ni
agrupaciones. Se usa en otras 13 pantallas: extenderlo las ponía a todas en riesgo. Queda tal cual, al lado del navegador nuevo, y
los dos comparten el mismo `productoId`.

Tampoco se tocaron `src/core/carta/`, `src/app/api/carta/` ni `src/server/actions/`, ni hubo cambios de schema ni migraciones.
