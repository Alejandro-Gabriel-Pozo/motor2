# Diseño — Ficha de cocina imprimible (2026-11-08)

Método: escalera de diseño de 10 niveles (AGENTS.md). Estados: **CONFIRMADA** (lo dijo el dueño), **PROPUESTA** (supuesto declarado, el dueño lo corrige), **PENDIENTE**, **NO VERIFICADA**.

**Necesidad (poda):** pedida por el dueño el 2026-11-08 («ficha de cocina imprimible») tras ver cómo imprime HOY la receta: 2 hojas A4 con el menú lateral, la barra superior, los botones Editar/Quitar y un hueco en blanco. Estado: CONFIRMADA.

## Inventario de lo que ya existe (verificado en el código, no en documentos)

- **Impresión en el catálogo de recetas: no hay.** Hoy el dueño imprime con Ctrl+P la pantalla de edición (de ahí las 2 hojas).
- `window.print()` + `@media print` ya existen en la carta pública (`navegacion-carta.tsx`, bloque `.carta-shell` de `globals.css`) y en el ticket/comanda del POS (`(pos)/mesas/[mesaId]/imprimir.tsx`, `[data-imprimible]`). Se sigue el mismo patrón.
- Los datos ya existen: `RecetaVersion` (rendimiento, raciones, tamaño de ración, tiempos, comentarios, presentación, notas, equipamiento), `RecetaIngrediente`, `RecetaPaso` y `RecetaPasoIngrediente`. La receta propia de una sucursal (`RecetaSucursal`, ADR-009) copia pasos y ficha técnica de la central y solo cambia ingredientes. **No se agrega ninguna tabla, columna, migración ni clave de permiso.**
- Lectores reutilizados: `obtenerRecetaVigente` (central, con `INCLUDE_RECETA_COMPLETA`), `obtenerEstadoDeRecetaPropia` (propia + si está habilitada), `obtenerProductoPorId`. **No se agrega ninguna consulta nueva** (por eso no hay filas nuevas en el guardián de denegación GT-3b: no hay puertas de datos nuevas).

## Nivel 1 — Propósito y alcance

- Una pantalla de **solo lectura**, `/catalogo/recetas/[productoId]/ficha` («Ficha de cocina»), que sale bien en papel A4 vertical: una hoja para una receta normal, corte limpio si es más larga. CONFIRMADA (pedido del dueño).
- Enlace «Ficha de cocina» desde la pantalla de la receta, junto a «Ver historial de versiones». PROPUESTA.
- **Fuera de alcance:** fotos, costos, precios, merma %, sustitutos, edición desde la ficha, PDF generado por el servidor, tamaño de hoja configurable, varias recetas por hoja, QR. Dejarlos fuera es la forma más barata de empezar a usarla.

## Nivel 2 — Actores y contexto

- Quien ya puede **ver** la receta (permiso `guardar_receta`, módulo Recetas): cocina, encargado, administración. Mismo «Ver» que la pantalla de la receta; no hay clave nueva. PROPUESTA.
- Contexto: empresa y sucursal activas de la sesión (nunca de la URL). La hora de impresión es de Argentina (UTC-3).

## Nivel 3 — Casos de uso

1. Abrir la ficha desde la receta, ver cómo queda y apretar «Imprimir» (`window.print()`, diálogo nativo del navegador).
2. Receta incompleta: se imprime igual, con lo que falta marcado «pendiente de completar».
3. Sucursal con receta propia: sale la que rige ahí.

## Nivel 4 — Conceptos y ciclo de vida

- Ficha = **vista derivada** de la versión de receta vigente de la sucursal activa; no se guarda nada, no tiene ciclo de vida propio. La versión impresa se identifica en el papel («Versión 4 · receta propia de la sucursal») para poder contrastar con el sistema.
- Cuál rige: la receta **propia** de la sucursal activa si está habilitada y tiene versiones; si no, la **central** (igual que `cargarRecetaVigente` y que la pantalla de la receta). PROPUESTA.

## Nivel 5 — Invariantes y políticas (qué entra al papel)

Todo PROPUESTA salvo lo pedido (ficha imprimible, sin menú/barra/botones, A4, corte limpio):

| Entra | No entra |
|---|---|
| Nombre del plato y versión vigente (propia/central) | Costos, precios |
| Sucursal activa y fecha-hora de impresión (UTC-3) | Merma % |
| Rendimiento, raciones, tamaño de ración, tiempo de preparación y de cocción | Sustitutos |
| Ingredientes con **cantidad y unidad tal como están cargados** | Fotos |
| Pasos numerados con nombre, tiempo y los ingredientes de cada paso | Menú lateral, barra superior, botones y enlaces de edición |
| Presentación o emplatado, equipamiento necesario, notas adicionales, comentarios | Calibraciones por sucursal, disponibilidad |

- «Lo que falta» (regla del dueño): ficha técnica, ingredientes y pasos vacíos dicen **«pendiente de completar»**; presentación, equipamiento, notas y comentarios vacíos se **omiten**. Nunca se inventa un valor.
- «Sin costos/merma/sustitutos» se garantiza **por construcción**: el modelo de la ficha (`RecetaParaFicha`) no declara esos campos, y un test mete costo, merma y sustitutos en la fila de entrada y comprueba que no salen.
- Cantidades en texto rioplatense sin ceros de relleno (0,22 · 0,005 · 1). Sin conversión de unidades.

### Lectura pura: concurrencia, idempotencia, atomicidad

No escribe nada: no hay concurrencia ni idempotencia ni atomicidad que resolver. Si alguien guarda otra versión mientras se imprime, la hoja dice la versión que imprimió. Sin dinero, sin stock, sin migraciones.

### Aislamiento y autorización (nivel 8, resumido)

- El servidor valida empresa, sucursal y permiso con la misma guarda que la pantalla de la receta (`requierePermisoVerDeEmpresa(..., "guardar_receta")`) y el mismo cupo de lecturas; las consultas corren con la base del contexto (RLS por empresa). Sin permiso → mensaje de la guarda; producto de otra empresa o inexistente → «No se encontró ese producto» (patrón del historial de versiones).
- Receta de otra empresa: se prueba con lo que ya cubre la matriz GT-3b para las puertas reutilizadas (`obtenerProductoPorId`, `obtenerRecetaVigente`, `obtenerEstadoDeRecetaPropia`); esta pantalla no suma puertas.

## «¿Qué pasa si…?» (comando único: imprimir/ver la ficha)

| Situación | Resultado |
|---|---|
| Se aprieta «Imprimir» dos veces | Dos diálogos de impresión del navegador; no hay efecto en datos. |
| Dos personas la abren a la vez | Sin efecto cruzado (solo lectura). |
| Cambió la receta entre que se abrió y se imprimió | Se imprime lo que cargó la pantalla, con su número de versión; recargar trae la nueva. |
| Producto sin receta | Mensaje «todavía no tiene receta: pendiente de completar», sin hoja vacía. |
| Receta sin ficha técnica / sin pasos / sin ingredientes | Se imprime con «pendiente de completar» en esa sección. |
| Texto de ficha con renglones vacíos | Se descartan; si no queda ninguno, se omite la sección. |
| Producto de otra empresa o sin permiso | «No se encontró ese producto» / mensaje de permiso; nada de datos. |
| Se le quita el permiso mientras tiene la pantalla abierta | La hoja ya cargada se puede imprimir (datos que ya vio); al recargar, no. |
| Receta propia de la sucursal habilitada | Sale la propia con su versión; si se vuelve a la central, sale la central. |
| Receta larga (muchos pasos) | Pasa a 2.ª hoja sin partir un paso ni una fila; los rótulos de la tabla se repiten. |
| Navegador que no soporta página con nombre | Se imprime con el tamaño y márgenes que elija el diálogo; el contenido no cambia. |

## Niveles 6 a 10 (resumen; sin tablas, nada que migrar)

- **6 Historia y persistencia:** ninguna; es una vista derivada. Sin migración.
- **7 Atomicidad:** no aplica (solo lectura).
- **8 Acceso e interfaces:** una página de servidor + un botón cliente (`window.print()`); el armado de los datos es código puro (`core/catalogo/ficha-de-cocina.ts`) y el dibujo un componente presentacional sin enlaces ni botones. El CSS de impresión vive en `globals.css` y solo actúa si la pantalla tiene la marca `data-ficha-cocina` (Ctrl+P en cualquier otra pantalla no cambia).
- **9 Consultas y experiencia:** mobile first en pantalla (columna única); en papel, A4 vertical, márgenes de 12 mm, negro sobre blanco.
- **10 Pruebas:** ver abajo.

### Combinaciones (regla del dueño, 2026-10-28)

Dimensiones que cambian lo que se ve: **receta propia de la sucursal (propia/central) × ficha técnica cargada (con/sin) × sustitutos (con/sin) × pasos (con/sin)** = 16 combinaciones. Oráculo escrito aparte del código: `test/catalogo/ficha-de-cocina.reglas.ts` (qué debe y qué NO debe decir cada combinación; «nunca» incluye merma, sustitutos, costos y controles de edición). `test/catalogo/ficha-de-cocina.test.tsx` recorre las 16 de forma exhaustiva. **Guardián de dimensiones:** el mismo test compara las columnas de `RecetaVersion`, `RecetaIngrediente` y `RecetaPaso` (enums de Prisma) contra la lista declarada «imprime / no imprime»: una columna nueva sin declarar pone el test en rojo.

### Pruebas

Armado y render (todas las combinaciones, orden de pasos, hora Argentina, receta sin ingredientes), guardián de columnas, CSS de impresión (A4, se esconden menú/barra/botones solo con la marca, `break-inside: avoid`), y captura real en 375 px y 1280 px más PDF A4 (ver el PR; datos de maqueta: producción tiene 0 recetas).

## Decisiones

| Decisión | Estado |
|---|---|
| Existe la ficha imprimible, sin menú/barra/botones, A4, sin hueco | CONFIRMADA |
| Ruta `/catalogo/recetas/[productoId]/ficha`, solo lectura, botón «Imprimir» + enlace desde la receta | PROPUESTA |
| Permiso: el «Ver» de recetas (`guardar_receta`), sin clave nueva | PROPUESTA |
| Rige la receta propia de la sucursal si está habilitada, si no la central | PROPUESTA |
| Contenido y exclusiones de la tabla del nivel 5 (sin costos, merma, sustitutos, fotos) | PROPUESTA |
| «Pendiente de completar» para ficha técnica/ingredientes/pasos vacíos; omitir lo opcional vacío | PROPUESTA |
| Página con nombre A4 vertical, márgenes 12 mm | PROPUESTA |
| Pantalla de producto sin receta: mensaje, no hoja vacía | PROPUESTA |
| Impresión de varias recetas en lote, PDF del servidor, fotos | PENDIENTE (etapa posterior, no pedida) |
