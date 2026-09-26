# Agregar varios productos de una sola vez (POS) — 2026-09-26

## Qué era el problema

El Server Action `agregarItems` (`src/server/actions/pos/cuenta.ts`) ya aceptaba un array `items[]` (hasta
`MAXIMO_ITEMS_POR_AGREGADO` = 50) y ya guardaba todo en una sola transacción serializable — el KOT de un solo envío con
varios productos ya funcionaba (`test/e2e/pos-tomar-pedido.spec.ts`, "Envío 1 a cocina: 2 ítems"). Lo que faltaba era del
lado del CLIENTE: cada «Agregar» hacía un viaje al servidor por producto, con espera y refresco de pantalla completo,
obligando a re-elegir producto y cantidad uno por uno antes de poder mandar algo a cocina.

## Diseño

Una lista **«Por agregar»** del lado del cliente (nunca guardada hasta confirmar): tocar un producto —en la grilla de
carta o elegirlo en el buscador— lo suma con cantidad 1; tocarlo de nuevo (o volver a elegirlo) ACUMULA en la MISMA
línea, nunca abre una segunda. Al confirmar, un solo `agregarItems(cuentaId, lineas)` — todo o nada, igual que siempre.

- **`src/core/pos/cantidad-pedido.ts`** (nuevo, PURO): `validarCantidadPedido` y las constantes `CANTIDAD_MAXIMA_POR_ITEM` /
  `MAXIMO_ITEMS_POR_AGREGADO`, separadas de `src/core/pos/cuenta.ts` (que importa `@/lib/db` a nivel de módulo — un
  cliente no puede importarlo ni solo para esto). `cuenta.ts` y el Server Action las re-exportan/importan de acá; nadie
  más cambia su forma de importarlas.
- **`src/core/pos/selector-carta.ts`**: `ProductoPedible` suma `decimales` (de `unidadStock.decimales`) — la lista
  necesita normalizar cada línea con la MISMA función que el servidor, y eso exige saber los decimales del producto.
- **`src/core/pos/agregar-lista-estado.ts`** (nuevo, PURO): reductor de la lista «Por agregar»
  (`test/pos/agregar-lista-estado.test.ts`). Cada línea guarda `cantidadTexto` (lo que se ve, crudo mientras se tipea) y
  `cantidad` (la última interpretación válida, para el subtotal). `sumarProducto` acumula o abre línea (hasta el tope de
  productos DISTINTOS); `incrementar`/`decrementar` son los botones −/+; `cambiarCantidadTexto` interpreta con
  `interpretarNumero` (nunca `Number(...)`); `normalizarCantidad` (al salir del campo) corre `validarCantidadPedido` — así
  una cantidad que redondea (ej. "1,4" en una unidad entera) se VE en "1" antes de confirmar, nunca oculta.
- **`src/core/pos/selector-carta-estado.ts`**: pierde `productoId`/`elegirProducto`/`limpiarTrasAgregar` (ya no hay una
  "elegida" transitoria: tocar un producto la suma directo) y gana `productoSumado`, el mismo efecto de antes
  (vaciar el buscador, cerrar el agrupado suelto, dejar la carpeta de género abierta — G3) pero disparado en el momento
  del toque, no después de un viaje al servidor.
- **`agregar-items.tsx`** / **`selector-carta.tsx`** (UI): combinan los DOS reductores (navegación + lista) sin que uno
  reemplace al otro. `aria-pressed` de un botón de producto ahora refleja si YA está en la lista (varios a la vez, a
  propósito: mezclar secciones sin perder lo elegido es el punto). El botón de confirmar es `type="button"` con
  `onClick`, y el `<form>` lleva `onSubmit={(e) => e.preventDefault()}` — Enter en cualquier campo NO tiene que confirmar
  nada (precedente `test/e2e/form-con-resultado-enter.spec.ts`), y sin ese `onSubmit` el navegador haría un submit nativo
  (recarga de página) que además borraría la lista.
- Tope de 50 productos DISTINTOS: con la lista llena, un producto que TODAVÍA no está en la lista queda deshabilitado en
  la carta (con `title` explicando por qué) y aparece un aviso fijo arriba de «Por agregar»; uno YA en la lista sigue
  pudiendo sumar de nuevo (se acumula, no abre otra línea).

## Todo o nada

Si un producto deja de estar disponible justo al confirmar, el servidor no guarda nada (misma transacción serializable
de `agregarItems`) y `useAccionMesa` deja el mensaje en `error` sin llamar al callback de éxito — la lista del cliente
queda INTACTA (nunca se vacía sola) con el error a la vista: no hay que volver a elegir todo de nuevo
(`test/e2e/pos-agregar-varios.spec.ts`).

## Tests

- `test/pos/agregar-lista-estado.test.ts`: acumular repetidos, tope de productos distintos, conversión con
  `interpretarNumero`, normalización con `validarCantidadPedido`.
- `test/pos/selector-carta-estado.test.ts`: reescrito sin `productoId`; `productoSumado` en su lugar.
- `test/e2e/pos-carta-secciones.spec.ts`: actualizado a la lista (ya no hay «Elegido: …» ni un solo campo "Cantidad").
- `test/e2e/pos-tomar-pedido.spec.ts`: el helper `agregar()` sigue el ciclo completo (buscar → elegir → corregir cantidad
  de esa línea → confirmar) para no romper los casos existentes.
- `test/e2e/pos-agregar-varios.spec.ts` (nuevo): una sola confirmación con productos de dos secciones + del buscador → un
  solo KOT; disponibilidad perdida justo al confirmar (todo o nada); accesibilidad de la lista con productos y con error.
