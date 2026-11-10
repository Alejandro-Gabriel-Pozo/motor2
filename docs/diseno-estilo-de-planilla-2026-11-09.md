# Diseño: estilo de planilla (2026-11-09)

Pedido del dueño (2026-11-09): mantener la «lógica de planilla» y mejorar la **maquetación estructural** de las pantallas de escritorio, con compatibilidad celular mobile-first. La maqueta del dueño es SOLO estilo: sus datos y los apartados «Resumen operativo / Pendientes / Actividad / Stock a controlar» son inventados y **no se construyen** (Inicio queda como está). Se apoya en `docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md` (PR #219): reutiliza sus piezas y sus etapas E-B…E-H.

Estados: CONFIRMADA (dicha por el dueño) · PROPUESTA · PENDIENTE · NO VERIFICADA.

## N1 · Propósito y alcance
- Que cada apartado de una pantalla de planilla se vea como una unidad (borde propio, banda de título, una línea de explicación, enlace «Ver todo →» si corresponde), con tabla de encabezado reconocible, filas separadas, columnas consistentes, filtros en banda propia encima de los datos, acciones en una columna propia al final y aire entre bloques. **CONFIRMADA** (los 9 puntos del pedido).
- No se elimina ninguna fila, columna, tabla ni densidad operativa. **CONFIRMADA**.
- Alcance de este PR: estilo de planilla dentro de `TablaDeDatos` + dos piezas mínimas + adopción en **dos** pantallas. El resto, por etapa (§ Adopción). **PROPUESTA** (las dos pantallas las elige el ejecutor; el dueño las ve en las capturas).
- Fuera de alcance: Inicio, campos numéricos (E-N), POS, migraciones, tablas, librerías.

## N2 · Actores y contexto
Quien administra el catálogo en escritorio (1366×768) y quien mira lo mismo desde el celular (390 px). Mismos permisos que hoy: ninguna pantalla cambia quién ve o hace qué. **CONFIRMADA**.

## N3 · Casos de uso
1. Ver la lista con encabezado y filas diferenciadas. 2. Filtrar (banda aparte) sin perder la lista. 3. Operar una fila (Editar, Activar/Desactivar) desde la última columna. 4. En celular, leer cada fila como tarjeta con su acción a la vista. **CONFIRMADA** (el 3 y 4 son el pedido de «acciones en columna propia» + «celular con tarjetas»).

## N4 · Conceptos y ciclo de vida (piezas)
Necesidad que resuelve: pedido del dueño del 2026-11-09 (arriba). Regla «primero la más barata»: **no se crea una segunda familia** de tablas.
| Pieza | Dónde | Qué es | Estado |
|---|---|---|---|
| Estilo de planilla | DENTRO de `TablaDeDatos` (`ui/componentes/datos`) | contorno con borde, banda de encabezado (`superficie-suave`, mayúsculas chicas), filas con separador y resalte al pasar, celdas con relleno parejo, números a la derecha, columna de acción (`accion: true`) al final | PROPUESTA |
| `ApartadoDePlanilla` | `ui/componentes/estructura` | `<section>` con borde, banda de título (h2) + descripción + enlace opcional «Ver todo →», cuerpo | PROPUESTA |
| `BarraDeFiltros` | `ui/componentes/estructura` | banda propia (fondo suave, borde inferior) que aloja los filtros encima de la tabla; envuelve a `FiltrosDeLista` (que ya existe y no se duplica) | PROPUESTA |
Inventario previo (código real): `TablaDeDatos` tiene 3 usuarios (la propia definición, `catalogo/opciones`, `catalogo/productos/[id]`); `FiltrosDeLista` solo lo usa la lista de productos; `CajaDesplazable` es un recuadro con scroll (no lo toco). No existía banda de filtros ni apartado con título.
Ciclo: sin estado; no hay base. Reversible: revertir el commit.

## N5 · Invariantes y políticas
- Una tabla nunca se queda en blanco (estado vacío obligatorio, ya vigente). Dentro del apartado, el vacío se muestra dentro del cuerpo. **CONFIRMADA** (regla previa).
- Celular: tarjetas, **sin** scroll horizontal de 780 px; 0 desborde horizontal de la página a 390. La acción de la fila queda visible y de ≥ 44 px. **CONFIRMADA** (instrucción del dueño).
- Solo tokens de `globals.css`, sin modo oscuro (DEC-04); el cerco de colores sigue verde.
- Impresión: no se toca el reset de `@media print` del `<main>` (#219); ficha de cocina y ticket del POS intactos.
- La columna de acción es PRESENTACIÓN: los permisos se siguen evaluando donde hoy (cada `celda` decide si dibuja el botón; el servidor vuelve a exigirlo).

## Combinaciones (dimensiones declaradas)
| Dimensión | ¿Cambia dinero/permisos/visibilidad/stock? |
|---|---|
| Ancho (celular <sm / escritorio ≥sm) | Visibilidad de la PRESENTACIÓN (tarjeta vs tabla); **mismas columnas y mismos datos** |
| `presentacionCelular` (tarjetas / tabla-con-scroll) | Solo presentación |
| Columna `accion` presente/ausente | Visibilidad: solo si la celda dibuja el control (permiso ya existente). No cambia permisos |
| `alinear` derecha | Solo presentación |
| `orden`, `claseFila` | Solo presentación |
| Filtros (banda) | Ninguna pieza nueva filtra: `FiltrosDeLista` sigue mandando GET y el servidor filtra |
**Ninguna cambia dinero ni stock.** Las únicas que tocan visibilidad son las dos de arriba y son de presentación. Oráculo: `test/ui/tabla-y-fechas.test.tsx` (extendido) recorre columna de acción × presentación de celular × vacío/con filas contra la tabla escrita aquí (la tarjeta lleva la acción; la tabla la lleva al final; la acción no se pierde en ninguna combinación). Guardián: un cerco con línea de base que solo baja cuenta los `<table` escritos a mano (lo nuevo no entra).

## ¿Qué pasa si…? (por comando: «ver la lista» y «operar una fila»)
| Situación | Qué pasa |
|---|---|
| Repetición (doble clic en Activar/Desactivar) | Igual que hoy: la acción es la existente (`actualizarDisponibilidadProducto`), idempotente en servidor; este cambio no la toca |
| Concurrencia (dos pestañas) | Sin cambio: la lista se lee en el servidor en cada carga |
| Tiempo | Sin cambio |
| Incertidumbre | Sin datos → estado vacío con el próximo paso |
| Reintento | La lista es una lectura GET |
| Error parcial | Sin escritura nueva |
| Datos faltantes | «—» en la celda, nunca se inventa |
| Cambio de permisos | Quien no puede editar ni cambiar disponibilidad no recibe la columna «Acciones» (la pantalla no la declara); si puede una de las dos, la celda dibuja solo ese control. El servidor vuelve a exigir cada permiso |
| Nombre muy largo en celular | La tarjeta corta palabras (`overflow-wrap:anywhere`), como hoy |

## N6–N7 · Historia, persistencia, atomicidad
No aplica: sin tablas, sin migraciones, sin escrituras. **CONFIRMADA** (no hay estado nuevo).

## N8 · Acceso e interfaces
Sin rutas ni permisos nuevos. Las piezas son componentes de servidor sin negocio (capa `ui/componentes`, `ui-sin-negocio`).

## N9 · Consultas y experiencia
Mobile first: base = tarjeta 390; desde `sm` tabla; desde `xl` rejilla de dos columnas ya existente. Toques ≥ 44 px en acciones de la tarjeta.

## N10 · Pruebas, migración y operación
- Unitarias (`test/ui`): estilo y columna de acción de `TablaDeDatos`, `ApartadoDePlanilla`, `BarraDeFiltros`.
- Cerco `tablas-a-mano` (línea de base = 35 archivos con `<table` hoy; solo baja).
- e2e `test/e2e/estilo-de-planilla.spec.ts`: 1366×768 y 390 px de las dos pantallas, sin desborde horizontal de página, acción visible en celular.
- Gate de 8 comandos en la misma corrida.
- Capturas ANTES/DESPUÉS con datos reales de producción (solo lectura) en la rama temporal `alegp/tmp-capturas-planilla`.

## Pantallas con `<table>` a mano por etapa de adopción (NO se migran ahora)
Fuente: `grep -rl "<table" src` (33 archivos a mano + la propia `TablaDeDatos`; `catalogo/productos/page.tsx` ya migró). Etapas del doc de estructura.
- **E-B (marco del producto / proveedor / receta):** `catalogo/productos/[id]/opciones/admision-de-grupo.tsx`, `catalogo/proveedores/[id]/page.tsx`, `catalogo/recetas/[productoId]/page.tsx`, `…/receta-de-la-sucursal.tsx`, `…/historial/page.tsx`, `components/catalogo/gestion-presentaciones.tsx`, `components/catalogo/ficha-de-cocina/ficha-de-cocina-vista.tsx` (**impresión: se evalúa aparte**).
- **E-C (administración):** `permisos-matriz.tsx`, `roles-tabla.tsx`, `usuarios-tabla.tsx`, `sucursales/page.tsx`, `capacidades-sucursal/page.tsx`.
- **E-D (reportes):** `reportes/{compras,periodo,rendimiento-recetas,rotacion-mesas,tickets}/page.tsx`, `components/tabla-reporte.tsx`.
- **E-E (listados de catálogo):** `catalogo/productos/page.tsx` (**ADOPTADA en este PR**), `proveedores/page.tsx`, `proveedores/comparativa/page.tsx`, `categorias`, `clientes`, `insumos-grupos`, `margen-objetivo`, `unidades`, `recetas/page.tsx`.
- **E-F (carta):** `components/carta-publica/seccion.tsx` (pública, fuera del estándar interno; PENDIENTE decidir).
- **E-G (movimientos, stock, traspasos):** `movimientos/{conteo-fisico/page,conteo-fisico/conteo-fisico-grid,precio-local,secciones}`, `traspasos/bandeja.tsx`, `components/stock/{tabla-de-stock,panel-de-maestro-simple}.tsx`.
- Ya sobre `TablaDeDatos`: `catalogo/opciones/page.tsx` (**recibe el estilo y el apartado en este PR**, es la 2.ª pantalla) y `catalogo/productos/[id]/page.tsx` (recibe el estilo por herencia; sin cambios de código).

## Decisiones y pregunta abierta
| Decisión | Estado |
|---|---|
| Estilo dentro de `TablaDeDatos`, no tabla nueva | PROPUESTA |
| Las dos pantallas: Productos (filtros + acciones por fila, 47 productos reales) y Biblioteca de opciones (25 grupos reales; ya usa `TablaDeDatos`, sin filtros ni acción por fila) | PROPUESTA. Motivo: hoy los listados con filtros que tienen datos en producción son solo Productos (proveedores: 1 fila; reportes y stock: 0 movimientos). Se declara la limitación |
| «Ver todo →» es una opción de `ApartadoDePlanilla` (la pide el dueño en su punto 1); ninguna de las dos pantallas lo usa (la lista ya es «todo»): se dibuja solo si se pasa `verTodo` | PROPUESTA |
| Etapas de adopción del resto | PENDIENTE (el dueño las ordena) |

**Pregunta abierta (una):** ¿el enlace «Ver todo →» de la pieza se deja para cuando un apartado que RESUME lo necesite (p. ej. Inicio, que no se toca), o se saca hasta que alguien lo use (poda)? Mientras tanto queda como opción sin uso en las dos pantallas; no se asume nada más.
