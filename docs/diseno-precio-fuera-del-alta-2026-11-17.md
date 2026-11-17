# Diseño corto — El precio sale del alta y se pide donde lo pide Pedernal — 2026-11-17

Frente 2 · Pedido del dueño (2026-11-17, citado por el orquestador, registrado en `motor2-docs`): «No, el precio donde lo pide... Donde lo pide Pedernal.» (respuesta a la pregunta de `docs/diseno-producto-nuevo-como-pedernal-2026-11-17.md` §6). **Este documento no construye nada**: es la verificación y las tablas que el orquestador pidió ANTES de construir. Toca dinero: sin atajos, sin cambios en el cálculo.

Estados: **CONFIRMADA** (dicha por el dueño), **CONFIRMADO POR LECTURA** (leído en el código/documentos citados), **PROPUESTA**, **NO VERIFICADO**. Fuentes leídas el 2026-11-17: `ZuluHub-docs` (`productos.html`, `e2-catalogo-minimo-especificacion.md`, `conceptos/precio-de-venta.md`, `carta-real-especificacion.md`, `decisiones-del-dueno-2026-11.md`) y el código de `motor2` (rama `main` + E2).

## 1. Dónde y cuándo pide el precio Pedernal (verificado, no asumido)

| # | Pregunta | Pedernal | Estado |
|---|---|---|---|
| 1 | ¿Dónde? | En la ficha del producto, pestaña **«Precios»** (`productos.html:580, 615-621`). **No se pide en el alta**: la pestaña está deshabilitada hasta guardar (`productos.html:758`: «precios y opciones se habilitan una vez guardado»). El alta de ERP no carga precio (`crear-producto.ts`, sin resultados al buscar «precio») | CONFIRMADO POR LECTURA |
| 2 | ¿Qué clases llevan precio? | Solo **Reventa** y **Producto vendible** (`e2-catalogo-minimo-especificacion.md:211-217`). Materia prima, Insumo y Elaborado: «No tiene precio de venta: su costo sale de las compras» (`productos.html:774`) | CONFIRMADO POR LECTURA |
| 3 | ¿Qué permiso? | Ver: `productos.ver` (los tres roles). Cargar/cambiar: `productos.cambiar_precio` (gerente y administrador); el precio de la empresa exige alcance de todas las sucursales, el de una sucursal, estar en el alcance | CONFIRMADO POR LECTURA |
| 4 | ¿Desde cuándo rige? | Solo desde ahora, sin fecha futura; guardar el mismo precio vigente se ignora (decisión del dueño, 2026-11-13, `decisiones-del-dueno-2026-11.md` fila 98) | CONFIRMADO POR LECTURA |
| 5 | Producto que nace sin precio | Se guarda sin precio. El servidor admite «precio abierto» (se vende, el importe lo pone la venta; `e2…:284`), pero la pantalla de venta rápida aprobada hoy lo deja apagado («Sin precio», `pantalla-venta-rapida.md:49,110`). **No existe** en Pedernal un estado «pendiente de precio» ni un aviso «nace sin poder venderse» (NO ENCONTRADO en `ZuluHub-docs`) | CONFIRMADO POR LECTURA |
| 6 | Carta pública | Un producto sin precio **no sale** (`carta-real-especificacion.md:201`); la pantalla «Carta en línea» muestra los motivos de «no sale» | CONFIRMADO POR LECTURA |
| 7 | Excepción | Duplicar un producto copia el precio (`novedades-para-motor2.md` fila 190) | CONFIRMADO POR LECTURA |
| 8 | Modelo | `numeric(18,6)`, ARS, IVA incluido, vigencia por inserción (solo agrega), empresa / sucursal / opción; **decimal exacto, ni entero ni float**. Listas de precios: no hay (futuro) | CONFIRMADO POR LECTURA |
| 9 | Pedernal ERP al día | El clon de ERP estaba en `26c7fc5` (17/11 08:38) y no se refrescó | NO VERIFICADO |

## 2. Qué hace Motor2 hoy (leído en el código)

| # | Qué | Hoy | Dónde |
|---|---|---|---|
| 1 | Precio en el alta | Campo «El precio de venta» (`precioVenta`) en el alta de un PV, solo con la clave `producto_campos_sensibles`; sin la clave, «$0» fijo y aviso | `producto-form.tsx:410-423`, `casos-de-uso/dar-de-alta-producto.ts:73-84` |
| 2 | Alta sin la clave | El PV nace **sin precio ($0) y NO disponible** en ninguna sucursal; el mensaje explica cómo se habilita («le cargue el precio y lo active») | `dar-de-alta-producto.ts:100,129-134` |
| 3 | Alta con la clave | El PV puede nacer con $0 y **disponible** (no se valida `> 0`) | `dar-de-alta-producto.ts:100,129` |
| 4 | Pestaña «Precios» | **Ya existe** (D8 del diseño de productos): «Precio de lista en «sucursal»», «Así se cobra», campo del precio de la sucursal activa → `setPrecioLocalProducto`, permiso `precio_local` (Editar) en la sucursal; ver = `producto_ver_catalogo`. Un producto «base» (se vende por opción) no cobra su precio guardado | `catalogo/productos/[id]/precios/page.tsx` |
| 5 | Precio global | `Producto.precioVenta` se edita en la ficha (edición, clave `producto_campos_sensibles`, control de concurrencia por valor visto); el precio por sucursal es un override (`precioLocalProducto`); el cobro resuelve local y, si no hay, global | `producto-form.tsx` (edición), `server/lecturas/movimientos/precio-venta.ts` |
| 6 | Activar un PV en $0 | El servidor exige la clave para ACTIVARLO («todavía no tiene precio…»); apagar no la exige | `actualizar-disponibilidad-producto.ts:30-33, 93-97` |
| 7 | Concepto «precio abierto» | **No existe** en Motor2: sin precio = $0 | auditoría `playwright-alta-de-producto.md:55` |

## 3. Qué cambia (PROPUESTA — pendiente de la revisión del orquestador y, en el punto A, del dueño)

El precio **sale del formulario del alta**. Se pide en la pestaña «Precios» de la ficha, que ya existe, guardada con el mismo comando de hoy (`setPrecioLocalProducto`) o, para el precio global, la edición con la clave de hoy. **No se crea tabla, columna ni comando nuevo y no cambia ningún cálculo de dinero.**

| # | Campo / elemento | Alta HOY (PV) | Alta PROPUESTA | Ficha |
|---|---|---|---|---|
| 1 | «El precio de venta» | Se pide (con la clave) | **Desaparece del alta** | Se pide en pestaña «Precios» (existe) |
| 2 | Aviso «No se va a poder vender todavía» | Solo sin la clave | Se muestra siempre en un PV: «El precio se carga después de crear, en la pestaña Precios» (texto a confirmar) | — |
| 3 | Aviso al pie «El producto se crea con precio $0, factor 1 y sin unidad de compra…» | Sin la clave | Se ajusta al nuevo alta (sin mencionar precio) | — |
| 4 | Factor de conversión, unidad de compra, IVA | Sin cambios | Sin cambios (no los pidió el dueño) | — |
| 5 | Después de crear | Va a la ficha | **Va a la ficha**; en un PV el aviso indica el paso siguiente: «Cargá el precio» con enlace a la pestaña Precios | Igual |

### A. Cómo nace el producto de venta (RESUELTA, 2026-11-17)

El dueño delegó en Pedernal los casos abiertos («Preguntale a Pedernal, según sus reglas, cómo definirían esos casos»); decisión citada por el orquestador: **A1**: el producto de venta **nace NO disponible** en todas las sucursales hasta que se le cargue el precio y se active (todo nace cerrado; es lo que Motor2 ya hace sin la clave). **Diferencia declarada con Pedernal (motivo):** Pedernal no guarda «disponible» y deja vender sin precio en el mostrador (precio abierto, decisión 175; sin precio no sale en la carta); Motor2 no tiene precio abierto y no se construye (solo si el dueño lo pide). El servidor de venta **no puede aceptar $0 por esta vía**: antes de construir se verifica el POS con un producto de venta disponible en $0 y se declara el resultado en el PR de código.

## 4. Tabla «¿qué pasa si…?» (PV que nace sin precio)

| ¿Qué pasa si…? | Con A1 (propuesta) | Fuente |
|---|---|---|
| El PV recién creado se busca en el **POS / venta** | No aparece: nace no disponible (`whereDisponibleEn`) | `server/lecturas/carta/menu.ts` (leído); POS exacto NO VERIFICADO |
| Se busca en la **carta pública / QR** | No aparece (igual que Pedernal: sin precio no sale) | `menu.ts`; `carta-real-especificacion.md:201` |
| Se activa sin precio (clic en «Disponible») | El servidor lo rechaza para quien no tiene la clave («todavía no tiene precio»); con la clave, hoy lo permite — **PROPUESTA:** no cambiar esa regla (nadie la pidió) | `actualizar-disponibilidad-producto.ts:93-97` |
| Se carga el precio en «Precios» y se activa | Queda a la venta al precio nuevo, desde ahora | `precios/page.tsx` |
| Dos personas cargan el precio a la vez | La segunda ve «el precio vigente ahora es …» y reintenta (valor visto como control de concurrencia, ya existente) | `PrecioDeLaSucursal`, `setPrecioLocalProducto` |
| Se repite el alta (clic doble) | Un solo producto (índice único de nombre, ya existente) | `dar-de-alta-producto.ts` |
| Se repite «Guardar precio» | Mismo valor: no cambia nada (valor visto) | existente |
| Quien crea no tiene `precio_local` / la clave | Crea el producto; no ve el campo de precio en «Precios» (solo lectura); alguien con el permiso lo carga | `precios/page.tsx` |
| El producto sale en **reportes** sin precio | Sin cambios: importe $0 = «sin dato», no entra en el total y se cuenta aparte (regla del dueño 2026-11-06); costos muestra «Sin precio de venta — cargarlo» | `hallazgo-venta-en-cero-real-vs-legada-2026-11-06.md`, `core/reportes/costos.ts` |
| Se **duplica** un PV con precio | Copia el precio como hoy (Pedernal también) | `duplicar-producto.ts` |
| Es una **MP / Insumo / Elaborado** | No tiene precio de venta: no cambia nada | — |
| Falla el guardado del precio a medias | Un solo comando, una transacción: se guarda todo o nada (existente) | `setPrecioLocalProducto` |
| Se cambia el precio de un producto ya vendido | Las ventas ya cerradas conservan el precio que tenían (sin cambios) | `precio-venta.ts` |
| Cortes de día / zona horaria | No aplica: el precio vigente se resuelve «desde ahora» | — |

## 5. Dinero y trazabilidad

- Sin cambios: el precio sigue siendo el `Producto.precioVenta` / `precioLocalProducto` de hoy (decimal exacto, ARS), con el mismo comando, la misma auditoría y los mismos permisos. El alta deja de mandar `precioVenta`: se guarda en 0 como hoy sin la clave.
- Diferencia declarada con Pedernal (motivo): Pedernal puede dejar un producto en «precio abierto»; Motor2 no tiene ese concepto (sin precio = $0). No se crea (no lo pidió el dueño).

## 6. Pruebas (cuando se construya)

Oráculo escrito aparte: el alta de un PV (con y sin la clave) nunca manda ni guarda precio; nace según A1; el aviso post-alta lleva al paso «Precios». Combinaciones: clave de campos sensibles (con/sin) × clase de alta (cuatro) × interruptor `ALTA_DE_PRODUCTO_COMO_PEDERNAL`; un test falla si el alta vuelve a mandar `precioVenta`. e2e a 375 px: crear PV → ficha con aviso → «Precios» → cargar → disponible. Idempotencia y concurrencia: las del alta y las del precio, ya cubiertas; se agrega que el alta repetida no crea otro. **Capturas antes/después** (pantalla real, datos reales de la empresa, fuera del repositorio público): se arman al construir.

## 7. Qué NO entra

Precio abierto, listas de precios, vigencia futura, precio por sucursal en el alta, cambios en el POS, tocar la regla de activar en $0.

## 8. Preguntas abiertas

Ninguna: la A está resuelta (A1).
