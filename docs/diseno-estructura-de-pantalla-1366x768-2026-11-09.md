# Diseño: estructura de pantalla para escritorio 1366×768 (con celular primero) — 2026-11-09

**Necesidad (quién la pidió y cuándo):** el dueño, 2026-11-09: «distribuir mejor el espacio; lo ideal sería distribuirlo en 1366 × 768; en escritorio así no hay páginas largas». Aclaración del mismo día (vía orquestador): es **transversal**, un estándar que después se aplica pantalla por pantalla a TODAS las pantallas de escritorio y que maneja el celular, «quizá desde mobile first».

Estados: **CONFIRMADA** (dicha por el dueño) · **PROPUESTA** · **PENDIENTE** · **NO VERIFICADA**. Lo que no dijo el dueño es PROPUESTA hasta que apruebe las capturas.

**Base:** esta rama se actualizó con `origin/main` (merge, sin conflictos) el 2026-11-09: la ficha de cocina (PR #215), `docs/pendientes-sesion-2026-11-08.md` y `docs/diseno-ficha-de-cocina-2026-11-08.md` SÍ existen en main. Las menciones previas a «la ficha no está en main» eran un error de base vieja y están corregidas.

**Alcance de ESTE PR (etapa E-A):** la estructura común (`AppShell`), las piezas reutilizables, las dos pantallas de prueba (pestaña «Opciones y precio» del producto y la pantalla de Receta) y el guardián de adopción. Sin migraciones, tablas ni librerías nuevas. El resto del sistema queda en etapas con nombre (§12).

## 0. Medición (datos locales de maqueta; ver «Datos de maqueta»)

Se midió con Chromium, sesión real de administrador, **90 pantallas de (app) y (pos)** (`next dev`, base local descartable) a 1366×768, 1280×720 y 390×844: alto del documento ÷ 768.

**Datos de maqueta (declarados):** base local con una empresa «Maqueta Gastronomía», 2 sucursales (Varvarco, Centro), 17 materias primas con compra y proveedor (bife, nalga, papa, Jugo Fresli, etc.), 7 productos de venta con receta (Milanesa con papas fritas $18.000, Bife de chorizo, Jugo Fresli…), 7 grupos de opciones (Tamaño, Guarnición, Punto de cocción, Ingredientes incluidos, Adicionales, Salsa, Sabor del jugo) y una carta. **Producción tiene 0 recetas y 0 ventas; la maqueta no tiene ventas**: los reportes y listados con filas dependen del volumen real, así que su alto aquí es un piso, no un techo. Nada de esto toca producción.

**Resultado:** 45 de 89 pantallas (51 %) miden más de una pantalla a 1366×768; 44 caben en una. Ranking de las más largas (1366×768):

| # | Pantalla | Pantallas de 768 | Qué la hace larga | Estado de la causa |
|---|---|---|---|---|
| 1 | `/administracion/permisos` | 10,9 | matriz de permisos por rol/acción sin paginar ni plegar | NO VERIFICADA (a confirmar en E-C) |
| 2 | `/catalogo/productos/[id]/opciones` | **6,6** (5.082 px) | un grupo por tarjeta, apilados, dentro de una columna de 768 px (`max-w-3xl` del marco); sobra el 25 % del ancho | verificada |
| 3 | `/administracion/capacidades-sucursal` | 6,5 | lista/matriz apilada | NO VERIFICADA (E-C) |
| 4 | `/movimientos/opciones-agotadas` | 3,4 | lista de opciones sin paginar | NO VERIFICADA |
| 5 | `/reportes/rendimiento-recetas` | 3,3 | tabla ancha sin paginar | NO VERIFICADA |
| 6 | `/catalogo/opciones/[grupoId]` | 2,4 | formularios apilados | NO VERIFICADA |
| 7 | `/catalogo/productos/[id]/en-la-carta` | 2,1 | formularios apilados en columna angosta | NO VERIFICADA |
| 8-11 | `/carta/parametrizacion` (+ secciones, apariencia) y `/carta/tema` | 1,9-2,0 | formularios/lista apilados | NO VERIFICADA |
| 12 | `/catalogo/recetas/[productoId]` | **1,85** | ficha + ingredientes + agregar + método apilados en `max-w-2xl` (672 px) | verificada |
| 13+ | `/reportes/*` (27 pantallas) | 1,55 (iguales) | filtros + estado vacío; **con filas reales crecen** | verificada para el piso |

**Celular (390×844):** desborde horizontal de la PÁGINA en `/administracion/sucursales` (420 px) y `/administracion/usuarios` (416 px); el resto no desborda. La línea de base del celular **no puede empeorar** (§9).

Lo que manda el alcance: el ranking dice que las dos pantallas de prueba pedidas (Opciones y Receta) son las **dos más largas de las que se editan a diario** (Permisos y Capacidades son de uso esporádico) y comparten el marco del espacio del producto: el ahorro de una pasa a las dos pestañas restantes del marco casi gratis.

## 1. Inventario de lo que YA existe (no se inventa una segunda forma)

Validado contra el código real:

| Necesidad | Ya existe | Decisión |
|---|---|---|
| Estructura común | `AppShell` (`src/components/app-shell.tsx`): menú `SidebarColapsable` (224 px, colapsable, `md:`), encabezado, `<main data-panel className="flex-1 p-6">`; `MenuCelular` (cajón < 768 px) | se **modifica** el shell (PROPUESTA) |
| Pestañas | `PestanasDeRuta` (`src/ui/componentes/navegacion`); `MarcoDelEspacio` (ficha del producto, `max-w-3xl`) | se reutilizan; el marco acepta un ancho |
| Tabla adaptable | `TablaDeDatos` (`src/ui/componentes/datos`): tabla desde `sm:`, **tarjetas en celular por defecto**, o `tabla-con-scroll` | es la pieza «tabla con scroll propio». Solo la usa 1 pantalla de 91: adopción en E-D/E-E |
| Filtros | `filtros-de-lista.tsx`, `selector-rango.tsx` | se reutilizan |
| Diálogo | `Dialogo` (`<dialog>` nativo, `showModal`), `modal.tsx` | sin cambios (§8) |
| Formularios | `GrupoDeFormularios`, `FormConResultado` | sin cambios |
| Primitivas | `Boton` (44 px en celular, compacto desde `md:`), `Campo`, `Selector`, `Aviso`, `Insignia` | sin cambios |
| Ancho máximo global del contenido | **no existe** (cada página pone su `max-w-*`: 28 usos de `max-w-md`, 18 `2xl`, 6 `3xl`…) | se agrega UNO en el shell |
| Rejilla de secciones, barra de acciones fija, encabezado de página fijo, plegables, paginación | **no existen** (`grep`: «paginación» solo aparece en `reportes/tickets`) | se crean las 3 primeras (E-A); plegables y paginación quedan nombradas (E-D/E-E) |

**Convención de Tailwind hoy (verificada):** v4, breakpoints por defecto (sm 640, md 768, lg 1024, xl 1280, 2xl 1536; el proyecto no redefine ninguno). Uso real: 111 `sm:`, 62 `md:`, 22 `lg:`, 1 `xl:`; `max-md:` 37 veces (casi siempre para ocultar/mostrar: menú lateral). O sea: **ya es mobile-first** (estilos base de celular + `min-width`), con `max-md:` solo para excepciones. `Boton` lo declara («mobile first», 44 px base, compacto desde `md:`). **No se cambia la convención.**

## 2. Escalera de diseño, niveles 1 a 5

**N1 · Propósito y alcance.** Que una pantalla de gestión muestre, a 1366×768, su vista inicial (título, filtros, acciones y lo principal) sin recorrer varias páginas, y que el celular siga andando. Hace una sola cosa: *distribuir el espacio*. No cambia datos, permisos, reglas de negocio ni textos. (CONFIRMADA el propósito; el método es PROPUESTA.)

**N2 · Actores y contexto.** Administrador/gerente en notebook 1366×768 (principal, CONFIRMADA por el dueño), a veces 1280×720 o monitor 1920; encargado/mozo en celular 390×844 (PROPUESTA: 390 como celular de referencia). Menú abierto o colapsado según gusto.

**N3 · Casos de uso.** (a) abrir una pantalla y ver título, filtros y acciones sin desplazarse; (b) editar una pantalla larga y tener siempre a la vista dónde guardar; (c) recorrer una lista/tabla larga sin perder el encabezado; (d) lo mismo en celular, sin desborde horizontal; (e) imprimir ficha de cocina y ticket como hoy.

**N4 · Conceptos y ciclo de vida.** Piezas (todas sin estado de negocio, sin base): *estructura del shell* (menú + encabezado fijos + **área de contenido que se desplaza**), *ContenedorDePagina* (ancho máximo + relleno), *EncabezadoDePagina* (acciones principales/filtros que quedan arriba al desplazar), *RejillaDeSecciones* (1 → 2 columnas). Prevista y **no construida en E-A** (nadie la usaría; el guardián de código muerto la rechazaría): *BarraDeAccionesFija* (guardar al pie, para los formularios largos de E-G). Ciclo: una pantalla pasa de «no adoptada» a «adoptada» una vez, por etapa; reversible (ver §12).

**N5 · Invariantes y políticas.** (PROPUESTAS, salvo el 1366×768)
1. Diseño de referencia: lienzo 1440×900, verificado a **1366×768**, 1280×720 y 390×844 (CONFIRMADA 1366×768).
2. Desde `md:` (≥768 px) **solo se desplaza el área de contenido**; el encabezado y el menú quedan fijos. Debajo de 768 px **se desplaza el documento, como hoy** (el celular no empeora).
3. Ancho máximo del contenido **1280 px** (80 rem), centrado en pantallas anchas; relleno 16 px en celular, 24 px desde `md:`.
4. Altura: el shell ocupa `100dvh` desde `md:`; **no se fijan alturas en píxeles** (se usa `min-h-0`/`overflow` del flex). La altura del viewport es la de la ventana, no un número.
5. La rejilla pasa a **2 columnas desde `xl:` (1280)**; en 1366 con menú abierto caben 2 columnas de ≈500 px. Nunca columna de menos de ≈480 px.
6. Las acciones principales de una pantalla larga quedan visibles: en E-A, `EncabezadoDePagina` pegado arriba del área que se desplaza (Opciones: «+ Nuevo grupo» / «Agregar un grupo existente»); la barra al pie queda para formularios con «Guardar» global (E-G). Decisión de uso por pantalla, no obligatoria.
7. Una tabla ancha conserva su `overflow-x-auto` propio (no se toca ese criterio; el `min-w-0` del shell sigue).
8. Toques ≥ 44 px en celular (`Boton` ya lo cumple; se corrige el selector de sucursal y empresa del encabezado).
9. `@media print` de la ficha de cocina y del ticket **no se toca** y se prueba (§8).

Compuerta: N1–N5 escritos; se puede pasar al código (no hay tablas: nivel 6 no aplica).

## 3. N6 · Historia y persistencia
No hay datos nuevos. No hay migración. Lo único que persiste es lo que ya persistía (`localStorage` `motor2:sidebar-colapsado`). Nada que auditar ni anular.

## 4. N7 · Atomicidad y concurrencia
No aplica a datos. Sí a la interfaz: las acciones de la barra fija son los MISMOS formularios de hoy (cada uno con su `GrupoDeFormularios` y versión); la barra **no agrega envíos nuevos** ni duplica botones (un guardar, un lugar). Doble clic: lo siguen cubriendo `BotonDeServidor`/`FormConResultado` (sin cambios).

## 5. N8 · Acceso e interfaces
Sin permisos nuevos ni pantallas nuevas. El shell ya filtra el menú por permiso; no cambia. Las piezas viven en `src/ui/componentes/estructura/` (capa `ui`, sin negocio: la valida `test/arquitectura/ui-sin-negocio.test.ts`).

### Piezas reutilizables (documentación de uso)

Todas en `src/ui/componentes/estructura/`. Mobile first: estilos base de celular y mejoras con `md:`/`xl:`.

```tsx
// 1. ContenedorDePagina  — lo pone el AppShell, las páginas NO lo repiten.
//    ancho máximo 80 rem centrado, relleno p-4 → md:p-6.
// 2. EncabezadoDePagina  — acciones principales/filtros; desde md queda pegado arriba del área que se desplaza (sticky), en celular no se pega.
//    Va ANTES del contenido en el DOM. `etiqueta` = nombre accesible del grupo.
<EncabezadoDePagina etiqueta="Acciones de las opciones"><Boton>…</Boton></EncabezadoDePagina>
// 3. RejillaDeSecciones  — 1 columna en celular, 2 desde xl. Hijos = secciones (tarjetas) o `SeccionDeRejilla`.
//    SeccionDeRejilla: `completa` = ocupa las 2 columnas; `apilada` = apila lo que lleva con separación de 2 rem.
//    `separacion="amplia"` (2 rem entre secciones; por defecto 1 rem). Sin `className`: la regla «primitivas sin clases de presentación» lo impide.
<RejillaDeSecciones>
  <SeccionDeRejilla apilada>…</SeccionDeRejilla>
  <SeccionDeRejilla completa>…</SeccionDeRejilla>
</RejillaDeSecciones>
// Marco del espacio del producto: <MarcoDelEspacio ancho="ancho"> usa todo el ancho del contenedor (por defecto «angosto» = 768 px, como hasta hoy).
```

Piezas que el estándar prevé pero **no se construyen en E-A** (nombradas): `BarraDeAccionesFija` (sticky al pie, botones ≥ 44 px en celular; E-G), `SeccionPlegable` (acordeón con `<details>`), `TablaDeDatos` con paginación/búsqueda (reutiliza la actual; E-D/E-E), tarjetas de celular para tablas (ya están en `TablaDeDatos`).

**Mobile first — estrategia (PROPUESTA):** (1) estilos base = celular 390; (2) mejoras con `min-width` en UN conjunto de puntos (los de Tailwind, **única fuente**: `sm 640 · md 768 · lg 1024 · xl 1280 · 2xl 1536`; los números que usan el oráculo y el guardián viven en `src/ui/componentes/estructura/reglas.ts` y un test los compara con las clases); (3) `max-md:` solo para ocultar/mostrar; (4) menú: cajón en celular (`MenuCelular`, sin cambios), lateral desde `md:`; (5) acciones fijas: en escritorio, `EncabezadoDePagina` pegado arriba (E-A); la barra al pie para formularios con «Guardar» global (E-G, mismas reglas en celular y escritorio); en celular el encabezado de página NO se pega (el documento se desplaza); en celular el encabezado del shell **no** se fija (ocuparía ≈150 px de 844); (6) tablas: `TablaDeDatos` (tarjetas) como salida más barata para celular, con columnas prioritarias como título/valores; la columna «Corregir este movimiento» de Trazabilidad se resuelve al adoptar el reporte (E-D) pasando a tarjeta con la acción visible; (7) toques ≥ 44 px: se corrige el selector de sucursal/empresa; «Salir» (`en-fila`) y los `Boton` ya cumplen; los enlaces «Editar» dentro de tablas quedan para E-C/E-D/E-E (`Enlace` en tabla: NO VERIFICADA su altura).
> El pendiente «tablas mobile-first» (`docs/pendientes-sesion-2026-11-08.md`, en main; corrección: en una versión anterior de este diseño se dijo que no existía porque la rama estaba sobre un main viejo) dice: `TablaReporte` es más ancha que 375 px y «Corregir este movimiento» queda fuera de vista; el dueño lo dejó «no es para hoy» y pide diseñarlo con la escalera antes (opción 2: filas como tarjeta apilada). La salida de menor costo que propone este estándar es la opción 2 reutilizando `TablaDeDatos` (ya trae tarjetas en celular), en la etapa E-D, con prueba a 375 px por pantalla.

## 6. N9 · Consultas y experiencia
Sin consultas nuevas. Lo único «de lectura» es el alto medido (§0).

## 7. N10 · Pruebas, migración y operación

### Dimensiones de combinaciones (regla del 2026-10-28)
Dimensiones cuyas combinaciones cambian el resultado (dónde se desplaza, cuántas columnas, si hay barra, cuánto mide el contenido):
`ancho de ventana ∈ {390, 768, 1280, 1366, 1440, 1920}` × `menú ∈ {abierto, colapsado}` (solo desde 768) × `la pantalla usa BarraDeAccionesFija ∈ {sí, no}` × `contenido ∈ {más bajo, más alto} que la ventana`.

**Oráculo (tabla escrita aparte del código):** `test/ui/estructura-de-pantalla.oraculo.ts`. Resumen:

| Ancho | Menú | Se desplaza | Encabezado del shell | Columnas de rejilla | Relleno | Ancho del contenido |
|---|---|---|---|---|---|---|
| 390 | — (cajón) | documento | se va con el scroll | 1 | 16 | 390 − 32 |
| 768 | abierto / colapsado | área de contenido | fijo | 1 | 24 | 768 − 244 − 48 / 768 − 20 − 48 |
| 1280 | abierto / colapsado | área de contenido | fijo | 2 | 24 | 988 / 1212 |
| 1366 | abierto / colapsado | área de contenido | fijo | 2 | 24 | 1.074 / 1.298 → tope 1.280 |
| 1440 | abierto / colapsado | área de contenido | fijo | 2 | 24 | 1.148 / 1.372 → tope 1.280 |
| 1920 | abierto / colapsado | área de contenido | fijo | 2 | 24 | tope 1.280 |

Con `EncabezadoDePagina`: pegado arriba del área que se desplaza desde `md` (no cambia quién se desplaza: el e2e lo verifica); si el contenido es más bajo que la ventana no hay scroll y queda donde está. Un **guardián** falla si aparece un punto de corte o una clase de estructura que no esté en el oráculo.

### Pruebas
- Vitest: `reglas` (funciones puras: columnas, dónde se desplaza, relleno, ancho útil) contra el oráculo, recorriendo TODAS las combinaciones; render de las piezas (clases, `aria`); las clases usan los mismos puntos de corte que `reglas.ts`.
- Cerco/guardián de adopción: `test/arquitectura/cerco-pantallas-con-estructura.test.ts` (patrón trinquete de `test/arquitectura/cercos/`): lista de pantallas de `(app)` y `(pos)` que todavía no usan el estándar = **línea de base que solo baja**; una pantalla nueva sin estándar falla.
- e2e (Playwright, `test/e2e/estructura-de-pantalla.spec.ts`): recorre combinaciones de ancho × menú en la pantalla Opciones y verifica en el navegador real quién se desplaza (documento vs contenido), encabezado fijo, columnas de la rejilla, ausencia de desborde a 390; `test/e2e/accesibilidad.spec.ts` (axe) incluye las pantallas tocadas.
- Existentes que deben seguir verdes: impresión de la ficha de cocina y del ticket (`@media print`), `campo-numero-tactil`, accesibilidad, navegación.
- Gate completo de 8 comandos (AGENTS.md).

### Migración y operación
Sin migraciones. Reversible: revertir el commit devuelve el shell anterior (documento que se desplaza). Sin interruptores nuevos (Poda: no se agregan opciones).

## 8. «¿Qué pasa si…?» (por comando/situación de pantalla)

| Situación | Qué pasa | Estado |
|---|---|---|
| Ventana angosta (< 768) | se desplaza el documento como hoy; cajón de menú; rejilla 1 columna; barra de acciones al pie del documento | PROPUESTA |
| Ventana ancha (1920) | contenido centrado con tope 1.280; menú a la izquierda | PROPUESTA |
| Menú colapsado | el contenido gana 224 px; las columnas **no** cambian (solo cuenta el ancho de ventana) — se evita que la pantalla «salte» de 1 a 2 columnas al tocar el menú | PROPUESTA |
| Acciones fijas con teclado / lector de pantalla | `EncabezadoDePagina` va **antes** del contenido en el DOM (orden de foco natural; no roba el foco) y es un `<div role="group" aria-label>`. Un sticky arriba puede tapar el campo enfocado al subir con Mayús+Tab (WCAG 2.4.11): **NO VERIFICADA** (ni con teclado ni con lector de pantalla); mitigación prevista si pasa: `scroll-padding-top` en el área que se desplaza igual al alto del encabezado de página. La barra al pie (E-G) llevará `scroll-padding-bottom` | PROPUESTA |
| Tabla ancha dentro del contenido que se desplaza | `overflow-x-auto` propio de la tabla (no se toca); el `min-w-0` del shell evita que ensanche la página; el scroll vertical es el del contenido | CONFIRMADA (criterio existente) |
| Impresión (ticket; ficha de cocina) | **Riesgo real y cubierto.** Con `<main>` como área que se desplaza dentro de un shell de alto de ventana, el papel saldría cortado en la primera pantalla. El bloque «Ficha de cocina» de `globals.css` ya convertía los `div` contenedores en bloque de alto libre, pero `<main>` no es un `div`: se agregó `main { height: auto; min-height: 0; overflow: visible }` y el contenedor de página pierde relleno y ancho máximo en papel. Para cualquier otra pantalla el shell vuelve a altura automática (`print:h-auto print:overflow-visible`) y el encabezado de página no es sticky (`print:static`). El ticket del POS (`body:has(> [data-imprimible]) > :not([data-imprimible]) { display: none }`) oculta el shell entero: no cambia. Pruebas: `test/catalogo/ficha-de-cocina.test.tsx` (reglas del papel, incl. las nuevas), e2e `test/e2e/ficha-de-cocina-impresa-con-estructura.spec.ts` (medio `print` emulado a 1366×768, PDF A4: 1 hoja, sin menú ni encabezado, último paso dentro del documento) y capturas antes/después de la ficha impresa | PROPUESTA |
| Foco al abrir un diálogo | `<dialog>.showModal()` va en la capa superior del navegador: no lo afecta el contenedor que se desplaza. Se verifica con el e2e de diálogos existente | PROPUESTA |
| Zoom del navegador al 125 % (1366 → ≈1093 px CSS) | cae bajo `xl`: 1 columna, comportamiento correcto; el encabezado y la barra siguen fijos; se verifica a 1093×614 | PROPUESTA |
| Zoom 200 % o texto grande | 1 columna; el contenido se desplaza; WCAG 1.4.10 reflow: sin desborde a 320 px equivalentes | PROPUESTA |
| Restauración de scroll al navegar | con `main` como contenedor, el navegador ya no restaura el scroll del documento; Next 16 hace scroll al inicio del segmento al navegar (`scroll` por defecto) sobre el **contenedor** más cercano; se verifica en el e2e (volver atrás deja el contenido arriba, no a mitad). Si no, el shell hace `scrollTop = 0` al cambiar de ruta (cambio mínimo de cliente) | NO VERIFICADA: se comprueba en el prototipo |
| Dos pestañas / dos usuarios | no aplica: no hay estado compartido nuevo | — |
| Cambio de permisos mientras se usa | no cambia: el menú y las pantallas ya se calculan en el servidor | — |
| Datos faltantes (lista vacía) | el área mide menos que la ventana; no hay barra de scroll; la barra de acciones (si la hay) queda pegada a su contenido | PROPUESTA |
| Error parcial / reintento / repetición | no aplica: no se agregan envíos | — |

## 9. Celular: lo que NO puede empeorar
Línea de base (§0): 2 pantallas desbordan a 390 (`administracion/sucursales`, `usuarios`; deuda existente, no se toca en E-A). El e2e nuevo y la captura exigen **0 desborde horizontal de la página** en la estructura común y en las 2 pantallas de prueba a 390 px, y relleno 16 px (gana 16 px de ancho útil frente a hoy). Toques ≥ 44 px: selector de sucursal y de empresa se corrigen.

## 10. Accesibilidad (PROPUESTA)
axe sin violaciones graves en las pantallas tocadas (`test/e2e/accesibilidad.spec.ts`); orden de foco = orden del DOM (barra de acciones al final; encabezado de página antes del contenido); sin pérdida de foco al redibujar (las piezas son de servidor, sin estado: no remontan los formularios); el área que se desplaza (`main`) no necesita `tabindex` mientras tenga controles enfocables (axe `scrollable-region-focusable` no marca nada en las 2 pantallas probadas); una pantalla de solo lectura sin controles tendrá que revisarse al adoptarla. **Hallazgo del prototipo:** `<main>` es `relative`, porque el texto solo-lector (`sr-only`, `position: absolute`) escapaba del área que se desplaza y agrandaba el documento (3.841 px de scroll fantasma).

## 11. Guardián de adopción
`test/arquitectura/cerco-pantallas-con-estructura.test.ts`, regla `pantallas-con-estructura`, línea de base `linea-de-base/pantallas-con-estructura.json`. Mide cada `page.tsx` de `src/app/(app)` y `src/app/(pos)`: «adoptada» = importa algo de `@/ui/componentes/estructura/` o del marco del espacio (que las usa). El resto cuenta 1. Falla si: aparece una pantalla nueva sin estándar, o si una adoptada vuelve a no serlo; también falla (pidiendo bajar la línea de base) cuando una pantalla se adopta. Se regenera solo hacia abajo con `BAJAR_CERCOS=1`. Meta: 0.

## 12. Plan de adopción — TODAS las pantallas de (app) y (pos)

Cada etapa: un PR, reversible (revertir el commit), con capturas antes/después a 1366×768 y 390×844 y **aprobación del dueño antes de mergear**. Tamaños en archivos de pantalla tocados (sin contar tests).

| Etapa | Qué | Pantallas | Tamaño |
|---|---|---|---|
| **E-A (este PR)** | shell + piezas + Opciones del producto + Receta + guardián | 2 | 13 archivos de código (shell, sidebar, 2 selectores, 3 piezas + reglas, marco, 2 páginas) + 4 de prueba |
| E-B | Resto del marco del producto (portada, datos, en la carta), ficha de proveedor, Biblioteca de opciones (detalle de grupo), historial de receta | 8 | ≈ 8-10 |
| E-C | Administración (permisos: matriz con scroll propio y filtro por rol/módulo — pasos plegables; capacidades; usuarios/sucursales: arreglar desborde a 390) | 8 | ≈ 8-10 |
| E-D | Reportes (27): un único filtro común + `TablaDeDatos` con paginación/tarjetas (incluye «Corregir este movimiento» visible en celular) | 27 | ≈ 6 componentes comunes + 27 páginas (con adopción en lotes de 8-9) |
| E-E | Listados de catálogo (productos, proveedores, categorías, unidades, clientes, grupos de insumos, margen, opciones) con búsqueda/paginación | 12 | ≈ 12 |
| E-F | Carta (parametrización, secciones, apariencia, portal, tema, agrupados, promociones, géneros) | 9 | ≈ 9 |
| E-G | Movimientos, stock, traspasos, inicio (formularios con barra de acciones fija) | 22 | ≈ 22 (en 2 PR) |
| E-H | POS / salón (`(pos)`, tiene su propio `pos-shell`: se define si adopta o queda exceptuado con motivo) | 3 | ≈ 3 (PENDIENTE decisión) |

**Más de 10 pantallas:** el estándar en sí (E-A) toca 2 pantallas; las otras 89 se hacen por etapas, no en este PR (la regla de «parar y avisar» es por PR/etapa, no por el total del plan).

### Lista completa y estado de adopción
Alto a 1366×768 y 390×844 en «pantallas de 768 / 844 px» (— = pantalla con parámetro no medida o sin datos de maqueta).

#### Administración

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/administracion/auditoria` | 1.0 | 1.2 | no adoptada | E-C |
| `/administracion/capacidades-sucursal` | 6.5 | 7.3 | no adoptada | E-C |
| `/administracion/empresa` | 1.0 | 1.0 | no adoptada | E-C |
| `/administracion/gerencia` | 1.0 | 1.0 | no adoptada | E-C |
| `/administracion/permisos` | 10.9 | 11.8 | no adoptada | E-C |
| `/administracion/roles` | 1.0 | 1.0 | no adoptada | E-C |
| `/administracion/sucursales` | 1.0 | 1.0 (desborda) | no adoptada | E-C |
| `/administracion/usuarios` | 1.0 | 1.2 (desborda) | no adoptada | E-C |

#### Formularios y configuración

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/carta/agrupados` | 1.3 | 1.8 | no adoptada | E-F |
| `/carta` | 1.0 | 1.1 | no adoptada | E-F |
| `/carta/parametrizacion/apariencia` | 1.9 | 3.2 | no adoptada | E-F |
| `/carta/parametrizacion/generos` | 1.0 | 1.2 | no adoptada | E-F |
| `/carta/parametrizacion` | 2.0 | 2.5 | no adoptada | E-F |
| `/carta/parametrizacion/promociones` | 1.0 | 1.4 | no adoptada | E-F |
| `/carta/parametrizacion/secciones` | 2.0 | 2.5 | no adoptada | E-F |
| `/carta/portal` | 1.5 | 2.3 | no adoptada | E-F |
| `/carta/tema` | 1.9 | 3.2 | no adoptada | E-F |
| `/catalogo/opciones/limpiar` | — | — | no adoptada | E-E |
| `/catalogo/productos/nuevo` | 1.3 | 1.6 | no adoptada | E-E |
| `/catalogo/proveedores/[id]/editar` | 1.0 | 1.0 | no adoptada | E-B |
| `/catalogo/proveedores/nuevo` | 1.0 | 1.0 | no adoptada | E-E |
| `/movimientos/[proceso]` | — | — | no adoptada | E-G |
| `/movimientos/conteo-fisico` | 1.0 | 1.0 | no adoptada | E-G |
| `/movimientos/venta` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/configuracion` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/conteo-frecuencia` | 1.0 | 1.4 | no adoptada | E-G |
| `/stock/reclasificar` | 1.0 | 1.5 | no adoptada | E-G |
| `/traspasos/enviar` | 1.0 | 1.0 | no adoptada | E-G |
| `/traspasos/solicitar` | 1.0 | 1.0 | no adoptada | E-G |

#### Listados y paneles

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/catalogo/categorias` | 1.0 | 1.0 | no adoptada | E-E |
| `/catalogo/clientes` | 1.0 | 1.0 | no adoptada | E-E |
| `/catalogo/insumos-grupos` | 1.0 | 1.2 | no adoptada | E-E |
| `/catalogo/margen-objetivo` | 1.1 | 1.3 | no adoptada | E-E |
| `/catalogo/opciones` | 1.0 | 2.1 | no adoptada | E-E |
| `/catalogo/productos` | 1.8 | 3.1 | no adoptada | E-E |
| `/catalogo/proveedores/comparativa` | 1.0 | 1.0 | no adoptada | E-E |
| `/catalogo/proveedores` | 1.0 | 1.0 | no adoptada | E-E |
| `/catalogo/recetas` | 1.0 | 1.0 | no adoptada | E-B |
| `/catalogo/unidades` | 1.0 | 1.0 | no adoptada | E-E |
| `/inicio` | 1.0 | 1.3 | no adoptada | E-G |
| `/movimientos/destinos-consumo` | 1.0 | 1.0 | no adoptada | E-G |
| `/movimientos/menu-del-dia` | — | — | no adoptada | E-G |
| `/movimientos/motivos-merma` | 1.0 | 1.1 | no adoptada | E-G |
| `/movimientos/opciones-agotadas` | 3.4 | 3.3 | no adoptada | E-G |
| `/movimientos` | 1.0 | 1.0 | no adoptada | E-G |
| `/movimientos/precio-local` | 1.0 | 1.1 | no adoptada | E-G |
| `/movimientos/secciones` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/alertas` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/consolidado` | 1.2 | 2.0 | no adoptada | E-G |
| `/stock/minimo` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/por-familia` | 1.0 | 1.0 | no adoptada | E-G |
| `/stock/seccion-habitual` | 1.0 | 1.0 | no adoptada | E-G |
| `/traspasos` | 1.0 | 1.0 | no adoptada | E-G |

#### Fichas con pestañas

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/catalogo/opciones/[grupoId]` | 2.4 | 3.1 | no adoptada | E-B |
| `/catalogo/productos/[id]/datos` | 1.4 | 1.7 | no adoptada | E-B |
| `/catalogo/productos/[id]/en-la-carta` | 2.1 | 2.6 | no adoptada | E-B |
| `/catalogo/productos/[id]/opciones` | 6.6 | 8.9 | adoptada (E-A, este PR) | E-A |
| `/catalogo/productos/[id]` | 1.4 | 2.0 | no adoptada | E-B |
| `/catalogo/proveedores/[id]` | 1.0 | 1.0 | no adoptada | E-B |
| `/catalogo/recetas/[productoId]/historial` | 1.0 | 1.0 | no adoptada | E-B |
| `/catalogo/recetas/[productoId]` | 1.9 | 2.3 | adoptada (E-A, este PR) | E-A |

#### Reportes con tabla

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/reportes/categorias` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/compras` | 1.6 | 2.3 | no adoptada | E-D |
| `/reportes/consignacion` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/consolidado` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/conteos` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/costos` | 1.6 | 2.4 | no adoptada | E-D |
| `/reportes/descuentos-clientes` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/descuentos-productos` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/devoluciones` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/diferencias` | 1.6 | 3.9 | no adoptada | E-D |
| `/reportes/historial` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/huecos-catalogo` | 1.0 | 1.1 | no adoptada | E-D |
| `/reportes/insumos-sin-receta` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/margen-promociones` | 1.6 | 1.1 | no adoptada | E-D |
| `/reportes` | 1.6 | 1.6 | no adoptada | E-D |
| `/reportes/perdidas` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/periodo` | 1.8 | 2.9 | no adoptada | E-D |
| `/reportes/rendimiento-recetas` | 3.3 | 5.9 | no adoptada | E-D |
| `/reportes/rendimiento-recetas/por-sucursal` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/rotacion-mesas` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/salud` | 1.6 | 1.9 | no adoptada | E-D |
| `/reportes/sin-receta` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/tickets` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/trazabilidad` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/valuacion` | 1.6 | 2.0 | no adoptada | E-D |
| `/reportes/vencimientos` | 1.6 | 1.0 | no adoptada | E-D |
| `/reportes/ventas-por-seccion` | 1.6 | 1.0 | no adoptada | E-D |

#### POS / salón

| Pantalla | Alto 1366×768 (pantallas) | Alto 390×844 | Adopción | Etapa |
|---|---|---|---|---|
| `/mesas/[mesaId]` | — | — | no adoptada | E-H |
| `/mesas/mostrador` | 1.0 | 1.0 | no adoptada | E-H |
| `/mesas` | 1.0 | 1.1 | no adoptada | E-H |

## 13. Decisiones abiertas (PROPUESTAS que el dueño puede corregir)
1. Tope de ancho 1.280 px y relleno 24/16 px.
2. Rejilla de 2 columnas desde 1280 px (no desde 1024) y sin cambiar al colapsar el menú.
3. Barra de acciones fija al pie (también en escritorio).
4. Encabezado del shell sin fijar en celular.
5. Orden de etapas (E-B…E-H) y que el POS quede para el final.
6. «Desde md: solo se desplaza el contenido» (el documento deja de desplazarse en escritorio).

## 14. Ampliación 2026-11-09 (segunda aclaración del dueño): «información clara» y regla de números

Estado general: **DISEÑO ESCRITO, SIN CÓDIGO** (se paró por la regla «si obliga a más de 10 pantallas o a una librería, parar y avisar»; ver §14.3). Todo es PROPUESTA salvo lo marcado CONFIRMADA.

### 14.1 «Información clara» como piezas del estándar (el dueño aprobó el criterio; los textos son PROPUESTA hasta aprobar captura)

| # | Pieza | Inventario real (lo que ya existe) | Propuesta | Estado |
|---|---|---|---|---|
| 1 | Jerarquía de texto de 4 niveles (título de página, sección, etiqueta, ayuda) | Hoy hay `text-xl font-semibold` (h1 del marco), `text-lg font-medium` (secciones), `font-medium` a secas (h2 de la receta), `text-sm`, y **157 ayudas** con `text-xs` + `text-tinta-suave/tenue`. Contraste medido: `tinta-suave` 5,55:1 sobre blanco / 5,31:1 sobre papel / **4,83:1 sobre `superficie-suave`**; `tinta-tenue` 4,79 / 4,58 / **4,17:1 sobre `superficie-suave` (no llega a 4,5)** | 4 clases/componentes únicos: `TituloDePagina` (xl/semibold), `TituloDeSeccion` (lg/medium), etiqueta (`text-sm font-medium`, ya en `Campo`) y `Ayuda` (`text-sm`, `tinta-suave`: ≥ 4,83:1 en todos los fondos; la ayuda sube de `text-xs` a `text-sm`). `tinta-tenue` queda solo sobre blanco/papel o se retira. Cerco de línea de base para los `text-xs` de ayuda | PROPUESTA |
| 2 | Nombre primero, código después | Marco: «PV_MILA · Producto de venta (PV)» ya es secundario; el id largo (`cmw9c60du…`) aparece en URLs y puede aparecer en pantallas | En pantalla siempre el nombre; código/id secundario (`text-sm tinta-suave`) o detrás de «Copiar». Auditar los `{x.id}` visibles en una etapa propia | PROPUESTA (NO VERIFICADO cuántos ids se ven) |
| 3 | UNA familia de estados con texto | `Insignia` (`src/ui/primitivas/insignia.tsx`): 5 tonos (neutro, ok, aviso, error, marca) y 9 usos; «Pendiente» ya sale de `marco.tsx`; el tono lo refuerza el texto | **No se crea una segunda familia**: se fijan 5 estados sobre `Insignia`: «Completo» (ok), «Pendiente de completar» (aviso), «Apagado» (neutro), «Anulado» (error), «Corregido» (marca). Una tabla estado→tono→texto en un solo archivo y cerco que rechace chips escritos a mano. La etiqueta «Pendiente» cortada a 375 px: la insignia pasa a `flex-shrink-0 whitespace-nowrap` y la pestaña permite 2 líneas | PROPUESTA |
| 4 | Una acción principal por sección; secundarias discretas; destructivas separadas | `Boton` tiene variantes primario/secundario/enlace; «Quitar de este producto» hoy está junto a «+ Opción» | Regla de uso: 1 `primario` por sección, `secundario`/`enlace` el resto, destructivas a la derecha y separadas; con la barra fija (E-G) | PROPUESTA |
| 5 | Sección plegable con resumen de una línea | No existe (`<details>` sin uso) | `SeccionPlegable` sobre `<details>/<summary>`: cerrada muestra el resumen («Proteína Milanesa · 3 opciones · 2 con consumo»), abierta el contenido; sin JS (servidor). Es la salida para bajar Opciones de 5,3 a ≈1,5 pantallas. **No construida en este PR** | PROPUESTA |
| 6 | «Qué falta completar» al tope de la ficha | La portada del producto ya calcula `estado` de cada paso (`pendiente`) en `cargarMarcoDelEspacio` | Mostrar ese mismo cálculo arriba de cada pantalla del marco como lista corta con enlaces (receta, consumo de opciones, IVA, sección de carta). Sin tablas nuevas | PROPUESTA |

### 14.2 Regla de números (CONFIRMADA por el dueño, con la corrección del mismo día)

Texto del dueño: se muestra SIEMPRE `1.000,00`; al tipear solo dígitos y UNA coma; la tecla «.» **se ignora** con el aviso «Los decimales van con coma: 0,5»; un pegado con «.» **se rechaza entero** con el mismo aviso y el campo queda como estaba (sin heurísticas); el sistema agrega solo el punto de miles al mostrar; siempre se muestra el número entendido junto al campo; el servidor rechaza SIEMPRE un valor con «.» (decimal o miles); dinero exacto con 2 decimales y cantidades con los decimales de su unidad; tablas, reportes y fichas muestran el mismo formato; Excel sigue numérico.

**Inventario (verificado en el código):**
- `src/components/campo-numero.tsx` (`CampoNumero`, 37 archivos lo importan, 25 son pantallas) con `inputMode="decimal"` y tipos `importe | cantidad | entero | porcentaje`.
- `src/core/datos/campo-numero-logica.ts` y `src/core/datos/numero-tecleado.ts`: el parser `interpretarNumeroTecleado` **acepta el punto como miles** («1.000.000», «21.000» = veintiún mil en un importe) y rechaza como ambiguo «1.205» en una cantidad con decimales; `numeroDelCampo` (27 archivos) y `numeroDeEntrada`/`validarImporte`/`validarCantidad` lo reutilizan en el servidor.
- **El canal entre el campo y el servidor es el número CANÓNICO con punto decimal** (`"1234.56"`, `leerNumeroCanonico`, regex `^-?\d+(\.\d+)?$`): el `<input type="hidden">` lo lleva y el servidor lo lee. Es un formato de máquina, no lo que ve ni escribe la persona.
- `src/core/moneda.ts` (decimal exacto con `decimal.js`, ARS, redondeo definido), `formatearMonto`/`MONEDA_FIJA` (es-AR).
- Ramas del repo `campo-numero-al-tocar` y `fix/campo-numero-pos` (tocar y reemplazar el valor; no revisadas en detalle: NO VERIFICADO su contenido); PR #218 (guardia de unidad) no está en main.
- Lo que muestran hoy las tablas (p. ej. Receta: `0.25`, `0.12` crudos con punto) no pasa por el formateador: es el «0.22 / 0,22» que vio el dueño.

**Contradicciones con lo construido (hay que decidirlas, no adivinarlas):**
1. El punto como miles que hoy acepta el parser contradice «el punto se ignora/rechaza».
2. El **canal canónico con punto** contradice «el servidor rechaza siempre un valor con punto». O el canal pasa a coma (`"1234,56"`) y se cambia `leerNumeroCanonico`/`numeroDeEntrada` y los ≈27 archivos que parsean, o la regla del servidor se limita al texto que escribe una persona (API/Server Action con texto crudo) y se mantiene el canal canónico entre el campo y el servidor. Es una decisión de modelo de datos de entrada: **PENDIENTE del dueño** (una sola pregunta, §14.3).
3. Un número que llega como `number` (no como texto) no tiene formato: la regla del servidor aplica solo a texto.

**Teclado de celular:** el campo pide el teclado numérico con `inputmode="decimal"` (ya lo hace `CampoNumero`); los celulares ya traen la coma, y el punto tipeado se ignora con el aviso «Los decimales van con coma: 0,5». **DECISIÓN DEL DUEÑO (2026-11-09, CONFIRMADA): el botón «,» propio en celular y cualquier variante quedaron DESCARTADOS** (no se proponen ni se diseñan). Queda sin verificar en un celular real (no hay en el entorno de pruebas).

**Oráculo de combinaciones (escrito aparte del código, a escribir con el campo):** dimensiones = entrada (tecleado | pegado) × contiene «.» (sí | no) × contiene coma (sí | no) × unidad (0, 3 y 4 decimales; dinero = 2) × lado (cliente | servidor). Resultados esperados (todos PROPUESTA hasta el código):

| Entrada | Lado | Tecleado | Pegado | Servidor (texto) |
|---|---|---|---|---|
| sin «.», sin coma (`1000`) | — | acepta; se muestra `1.000` (o `1.000,00` en dinero) | acepta | acepta |
| sin «.», con una coma (`0,5`) | — | acepta (decimales ≤ los de la unidad) | acepta | acepta |
| con «.», con o sin coma (`2.5`, `1.234,50`) | — | la tecla «.» se ignora + aviso | **se rechaza entero**, campo igual que antes + aviso | **rechaza** con el mismo mensaje |
| dos comas (`1,2,3`) | — | la segunda coma se ignora | rechaza | rechaza |
| más decimales que la unidad (`0,0605` con kg=3) | — | rechaza con el mensaje de la unidad | ídem | ídem |
| unidad con 0 decimales y una coma (`2,5` en unidades) | — | la coma no se admite (campo `entero`) | rechaza | rechaza |

### 14.3 Por qué se paró (regla «parar y avisar»)
El mensaje del orquestador pide parar si esto «obliga a más de 10 pantallas o a una librería». Lo verificado: la regla de números **cambia el parser central y el canal de valor** que usan **37 archivos con `CampoNumero` (25 pantallas)** y **27 archivos con `numeroDelCampo`**, más los números que muestran tablas y reportes (decenas de pantallas). Es una etapa transversal propia (nombrada **E-N**, antes de E-B), no un agregado de este PR. En este PR **no se tocó código** por esta aclaración (ni el campo, ni el servidor, ni el chip de la Receta); queda este diseño.

**Pregunta única al dueño (cambia el modelo de entrada):** ¿el servidor rechaza el punto en TODO texto numérico que le llegue (y entonces el campo manda coma al servidor y se reescribe el canal en los ≈27 archivos que lo parsean), o rechaza el punto solo en lo que escribe una persona y se conserva el canal canónico máquina↔servidor? Recomendación: lo segundo (el canal canónico es un contrato interno; el punto jamás llega a la persona).

### 14.4 Plan de adopción ampliado
| Etapa | Qué | Tamaño |
|---|---|---|
| **E-N** (antes de E-B) | Regla de números: parser (`numero-tecleado.ts`), `CampoNumero` (ignora «.», aviso, número entendido), formateador único de salida (`formatearNumero` sobre `formatearMonto`), validación del servidor y oráculo; después, adopción en las 25 pantallas con campos y en las tablas (Receta primero) | ≈ 8 archivos de núcleo + 25 pantallas (varios PR) — **más de 10: requiere tu OK** |
| **E-I** (junto a E-B) | Piezas de «información clara»: `TituloDePagina/TituloDeSeccion/Ayuda`, tabla estado→`Insignia`, `SeccionPlegable`, «Qué falta completar» | ≈ 6 archivos + adopción por familia |

### 14.5 Decisiones del orquestador (2026-11-09) que cierran §14.3
1. **Alcance de la regla de números:** el rechazo del «.» vale SOLO para lo que escribe o pega una persona en un campo numérico. El canal interno campo→servidor (número canónico con punto, `<input hidden>`, `leerNumeroCanonico`) **no se toca**. El servidor acepta únicamente el formato canónico estricto (dígitos y un punto decimal, sin miles) y rechaza cualquier otra cosa con mensaje claro (coma, miles o notaciones raras): un pedido armado a mano no cuela ambigüedad. (Reemplaza la pregunta de §14.3: **CONFIRMADA** por quien coordina; el dueño no necesita decidir cómo viaja el valor.)
2. **Etapas:** E-A (este PR) + el DISEÑO de A y B (§14); **E-N** (campo numérico y parser: oráculo de combinaciones, tests de dinero exacto, el parser que hoy acepta «21.000» como 21000 pasa a rechazarlo con aviso) y **E-I** (piezas de información clara) como PR aparte, DESPUÉS de que el dueño apruebe E-A. No se construyen ahora.
3. **Primer ítem de E-I:** el contraste de `tinta-tenue` sobre `superficie-suave` (4,17:1, bajo el mínimo de 4,5) es un defecto real de accesibilidad: ajuste de token (barato). Anotado como deuda.
4. ~~Botón «,» propio en celular~~: **descartado por el dueño** (2026-11-09).

### 14.6 Inventario de `type="number"` (verificado contra origin/main) — para E-N
Hay **23 campos `<Campo type="number">` fuera de `CampoNumero`** (se excluye `XAxis type="number"` de un gráfico, que no es un campo): `carta/agrupados` 1 (orden); `carta/parametrizacion/formularios` 10 (orden ×2, **PRECIO ×1 = la única plata**, lugar mín/máx ×4, mín/máx ×2); `carta/portal` 2 (orden, porcentaje 0–100); `catalogo/unidades` 1 (decimales 0–6); reportes `devoluciones`/`perdidas`/`vencimientos` 3 (días); `components/carta/contenido-del-producto` 1 (descuento % 0–99,99); `editor-portal` 2 y `editor-tema` 2 (porcentajes/escala); `seccion-y-orden` 1 (orden). Ya existe el cerco `test/arquitectura/cerco-campo-type-number.test.ts` con línea de base `cercos/linea-de-base/campo-type-number.json` que solo baja: **E-N lleva esa base a CERO**, migrando los 23 a `CampoNumero` con su tipo (`importe`, `entero`, `porcentaje`…), empezando por el de PRECIO (dinero exacto, 2 decimales, «1.000,00»). No se construye en este PR.
