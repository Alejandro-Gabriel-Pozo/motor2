# Diseño — Cargar qué consume cada opción desde la ficha del producto (2026-11-09)

Método: escalera de diseño de 10 niveles (AGENTS.md). Estados: **CONFIRMADA** (lo dijo el dueño), **PROPUESTA** (supuesto declarado, el dueño lo corrige), **PENDIENTE**, **NO VERIFICADA**.

**Necesidad (poda):** pedida por el dueño el 2026-11-09 (punto A4 de una auditoría: «¿dónde se carga qué consume cada opción (pollo, carne, factor del tamaño)?»). Hoy el consumo de una opción solo se carga en la Biblioteca de opciones (`/catalogo/opciones/[grupoId]`); la ficha del producto admite grupos y opciones pero no muestra ni carga qué descuenta cada una. Estado: CONFIRMADA. Decisión asociada del dueño (misma fecha): el consumo se carga desde el producto; los grupos casi siempre son de un solo producto (producción: 25 grupos, 24 usados por UN producto y «Guarniciones» por 3; 0 consumos cargados); cuando un grupo se comparte se COPIA (esa salida se resolvió en otro proyecto y **no se construye acá**).

## Inventario de lo que ya existe (verificado en el código, no en documentos)

- **El dato:** `ConsumoDeOpcion` colgado de `VersionDeOpcion` (inmutable, versionada, `(opcionId, numero)` único). No se toca el esquema: **sin migración, sin tablas, sin columnas, sin claves de permiso.**
- **El caso de uso:** `agregarVersionDeOpcionCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/agregar-version-de-opcion.ts`) y su acción `agregarVersionDeOpcion` (`opciones-de-venta.ts`, permiso `opciones_definir`). Ya hace: transacción SERIALIZABLE, control de versión esperada (`VERSION_DESACTUALIZADA`), idempotencia (mismo pedido repetido → éxito sin otra versión), validación del tipo (`validarVersion`, `validarConsumos`), módulo Recetas (D-3), insumos de la empresa, auditoría. **Se reutiliza tal cual: no se escribe lógica de guardado nueva y no se agrega ninguna acción** (por eso no hay filas nuevas en la matriz de denegación GT-3b: `agregarVersionDeOpcion` ya tiene su generador y su control positivo en `test/aislamiento/denegacion/generadores.ts`).
- **El editor:** `EditorDeConsumos` (hoy en `src/app/(app)/catalogo/opciones/[grupoId]/editor-de-consumos.tsx`), usado por la Biblioteca a través de `CamposDeVersion` y `CambiarPrecio`. Se **mueve** a `src/components/catalogo/` (sin cambiar comportamiento) para que lo compartan las dos pantallas, junto con `version-del-formulario.ts` (lectura del FormData de una versión).
- **La lectura:** `cargarOpcionesDelProducto` (`src/server/consultas/catalogo/opciones-de-venta.ts`) ya recorre los grupos del producto con la lectura de GO-2a (`listarGruposDeOpciones`), que **ya trae la versión vigente con sus consumos** de cada opción; solo falta pasarla a la pantalla (más los nombres de insumos y los productos que usan cada grupo). Es una extensión de una consulta existente, no una puerta nueva.
- **La frase llana:** `resumenDeConsumos` (`src/core/opciones/presentacion.ts`), la misma de la Biblioteca.
- **La pestaña:** `src/app/(app)/catalogo/productos/[id]/opciones/page.tsx`, con una tarjeta por grupo (`data-admision-grupo`).

## Nivel 1 — Propósito y alcance

- En la pestaña **Opciones** del producto, junto a cada opción admitida, mostrar **qué consume hoy** en lenguaje llano y permitir **editarlo ahí mismo** con el mismo editor y la misma acción que la Biblioteca. CONFIRMADA (pedido del dueño).
- Aviso visible **antes** de editar cuando el grupo lo usa más de un producto, con enlace a la Biblioteca. CONFIRMADA (decisión del dueño del 2026-11-09).
- **Fuera de alcance:** «copiar grupo» (etapa posterior con nombre: ver Extensión), editar el precio o la diferencia de una opción desde el producto, editar el factor del tamaño desde el producto (ver pregunta abierta), crear opciones o insumos desde este editor, tablas nuevas, claves nuevas.

## Nivel 2 — Actores y contexto

- Quien arma las opciones del producto: ya exige **Editar** de `producto_opciones_admitidas` para entrar a la pestaña. Para **editar un consumo** exige además **Editar** de `opciones_definir`: **la misma clave** que exige hoy la Biblioteca (la acción `agregarVersionDeOpcion` la vuelve a pedir en el servidor). Quien no la tiene ve el consumo en solo lectura. PROPUESTA (misma clave, ninguna nueva).
- Contexto: empresa y sucursal de la sesión; nunca de la URL ni del formulario.

## Nivel 3 — Casos de uso

1. Ver qué descuenta cada opción del producto («Descuenta 0,15 kg de Pollo; escala con el tamaño»).
2. Editar el consumo de una opción (agregar, quitar o cambiar líneas) y guardar.
3. Ver una opción sin consumo cargado marcada «pendiente de completar».
4. Abrir un grupo compartido y leer el aviso antes de tocar nada.

## Nivel 4 — Conceptos y ciclo de vida

- El consumo es de la **opción**, no del producto: cada guardado crea una **versión nueva e inmutable** de la opción (número vigente + 1) que rige desde que se guarda; lo ya vendido conserva su foto. Lo que no cambia en el guardado (la diferencia de precio y el factor del tamaño) viaja con los valores de la versión vigente: **se vuelve a mandar tal cual**, de modo que guardar un consumo nunca cambia un precio.
- Estado de una opción en esta pantalla: `NO_CONSUME` (la opción «ninguna»), `PENDIENTE` (sin consumo cargado) o `CARGADO`.

## Nivel 5 — Invariantes y políticas

| Invariante / política | Estado |
|---|---|
| Qué se muestra y se puede editar por tipo de grupo: **MEDIDA, INCLUIDA, VARIANTE**: líneas SUMA o REEMPLAZA, cada una con «escala con el tamaño». **ADICIONAL**: solo SUMA y sin escalar (es la línea hija del producto ancla; `validarConsumos` lo exige y el editor ya no ofrece lo otro). El consumo aplica a los cuatro tipos: **ninguno queda sin poder editarse por tipo**. | PROPUESTA |
| La opción «ninguna» **no consume**: se dice «no consume» y no se ofrece editar (`validarConsumos` la rechaza). | PROPUESTA |
| «Pendiente de completar» = la opción no tiene ninguna línea de consumo cargada (o ninguna versión). Nunca se inventa un valor. Limitación declarada: hoy no hay forma de distinguir «sin consumo a propósito» de «todavía no cargado» sin una columna nueva; una opción que de verdad no consume (ejemplo: «sin sal») seguirá diciendo «pendiente» hasta que se decida si hace falta marcarla. | PROPUESTA |
| El editor solo se ofrece con el módulo **Recetas** activo (D-3: sin él, la acción rechaza consumos). Sin el módulo, la pantalla dice «usa el módulo Recetas, que tu empresa no tiene activo» y deja el consumo en solo lectura. | PROPUESTA |
| Un grupo con más de un producto activo (`ProductoAdmiteGrupo.activo`) muestra, antes de las opciones: «Este grupo lo usan N productos (A, B, C): cambiar el consumo de una opción los afecta a todos.» + enlace «Biblioteca de opciones». Aplica aunque la persona no pueda editar (es información). El enlace se dibuja solo con «Ver» de `opciones_definir`. | CONFIRMADA (texto y comportamiento) |
| Solo se listan las opciones que **este producto admite** (fila activa y opción prendida en la empresa). | PROPUESTA |
| El factor del tamaño (MEDIDA) se muestra en solo lectura («consume ×1,3 del tamaño base»); **no se edita desde acá**. | PROPUESTA (ver pregunta abierta) |

### Concurrencia, idempotencia, atomicidad (las da el caso de uso, no esta pantalla)

- **Concurrencia:** el cliente manda `numeroEsperado` (el número vigente que la pantalla leyó). Si otra persona guardó antes, el servidor devuelve `VERSION_DESACTUALIZADA` con su mensaje y la pantalla ofrece «Recargar»: no se pisa. Dos guardados a la vez: el único `(opcionId, numero)` y la transacción SERIALIZABLE dejan **una sola versión ganadora**; la otra recibe el mensaje.
- **Idempotencia:** el mismo pedido repetido (clic doble, reintento) por la misma persona con el mismo contenido → éxito sin otra versión. El mismo contenido que el vigente → no agrega una versión vacía.
- **Atomicidad:** versión, consumos y auditoría en una sola transacción: todo o nada.
- **Aislamiento y autorización:** la base del contexto filtra por empresa (RLS); una opción o un producto de otra empresa se comporta como hoy (`OPCION_NO_ENCONTRADA` / `notFound`). El permiso se valida en el servidor en cada guardado; el botón es cortesía de la interfaz.

## «¿Qué pasa si…?» (comando: guardar el consumo de una opción)

| Situación | Resultado |
|---|---|
| Clic doble en «Guardar el consumo» | Una sola versión nueva; el segundo pedido: «ya estaba cargado» (éxito). |
| Dos personas guardan la misma opción a la vez | Gana una; la otra ve «cambió mientras lo editabas… Recargá» y no se pisa nada. |
| Se guarda lo mismo que ya rige | «Ya tiene esos valores»: no se agrega versión. |
| Falla a mitad (insumo inexistente, línea inválida) | No se guarda nada; mensaje del servidor; la pantalla conserva lo tipeado. |
| El grupo lo usan 3 productos | Aviso antes de editar; al guardar rige para los 3 (es lo que dice el aviso). |
| Un producto deja de usar el grupo mientras se edita | El guardado sigue valiendo (el consumo es de la opción); al recargar, el aviso baja de 3 a 2. |
| La persona pierde `opciones_definir` con la pantalla abierta | El servidor rechaza con el mensaje de permiso; al recargar ya no ve el botón. |
| Se apaga el módulo Recetas con la pantalla abierta | El servidor rechaza con «módulo Recetas inactivo»; al recargar, solo lectura. |
| Opción o producto de otra empresa (id manipulado) | Como hoy: «no se encontró» / 404; nada de datos de la otra empresa. |
| Opción archivada entre la lectura y el guardado | Como hoy en la Biblioteca (el caso de uso decide). |
| Insumo del consumo archivado | Se sigue leyendo con su nombre; el editor ofrece solo los insumos de la empresa (como la Biblioteca). |
| Opción con porcentaje en un producto que se vende por opción | Se reenvía el mismo valor que ya regía; si el caso de uso lo rechaza (regla de la Fase 4) lo dice con su mensaje: no cambia en esta pantalla. |

## Nivel 6 — Historia y persistencia

Sin cambios: cada guardado agrega una `VersionDeOpcion` con sus `ConsumoDeOpcion` y los registros de auditoría que ya escribe el caso de uso (quién, cuándo, qué cambió). Nada se borra ni se edita en el lugar. **Sin migración.**

## Nivel 7 — Atomicidad y concurrencia

Ver arriba: el caso de uso existente. Esta pantalla no abre transacciones ni escribe por otro camino.

## Nivel 8 — Acceso e interfaces

- Una sola acción de escritura: `agregarVersionDeOpcion` (existente). La página la llama desde un closure `"use server"` que captura solo textos y números (`opcionId`, número vigente, diferencia y factor de la versión vigente) y lee las líneas del FormData con el mismo parser que la Biblioteca.
- La lectura extiende `cargarOpcionesDelProducto` (consulta de página, sin guarda propia: la página ya exige `producto_ver_catalogo` y `producto_opciones_admitidas`).
- Las reglas de qué se muestra/ofrece están en una función pura (`src/core/opciones/consumo-en-el-producto.ts`) para poder probarlas contra la tabla de combinaciones sin renderizar.

## Nivel 9 — Consultas y experiencia

Mobile-first: dentro de la tarjeta de cada grupo, una lista «Qué consume cada opción» con una fila por opción (nombre, frase del consumo, botón «Editar consumo» de área táctil completa). El editor se abre en el lugar (mismo patrón que «Cambiar precio o consumo» de la Biblioteca). Textos en rioplatense.

## Nivel 10 — Pruebas, combinaciones, migración y operación

**Dimensiones que cambian lo que se ve o se permite** (regla del dueño, 2026-10-28): tipo de grupo (MEDIDA, INCLUIDA, VARIANTE, ADICIONAL) × grupo compartido (sí/no) × opción (normal con consumo / normal sin consumo / «ninguna») × permiso de editar `opciones_definir` (con/sin) × módulo Recetas (activo/no). El **oráculo** (tabla de reglas escrita aparte del código) es `test/catalogo/consumo-de-opcion-en-el-producto.reglas.ts`; `test/catalogo/consumo-de-opcion-en-el-producto.test.tsx` recorre **todas** las combinaciones (exhaustivo: son pocas) contra esa tabla, tanto en la función pura como en el render de la pestaña. **Guardián de dimensiones:** el mismo test compara los valores del enum `TipoDeGrupoDeOpciones` y las columnas de `ConsumoDeOpcion` (enums de Prisma) contra lo declarado «afecta / no afecta lo que se ve»: un tipo o una columna nuevos sin declarar ponen el test en rojo.

**Pruebas:**
- Render de la pestaña: opción con consumo, sin consumo («pendiente de completar»), «ninguna» («no consume»), grupo compartido con aviso (texto exacto, con los nombres), sin permiso (solo lectura), sin módulo Recetas.
- Caso de uso reutilizado desde la pantalla del producto (con la misma forma de pedido que arma el closure): concurrencia (dos guardados a la vez → una versión ganadora, el otro recibe `VERSION_DESACTUALIZADA`), idempotencia (el mismo pedido repetido no duplica) y que guardar un consumo **conserva** diferencia y factor vigentes; aislamiento entre empresas (opción de otra empresa → «no encontrada»). Se agregan a `test/catalogo/opciones-versiones*.test.ts` (que ya cubren el caso de uso) sin duplicarlos.
- Movimiento de archivos: las pruebas y las líneas de base (`controles-a-mano.json`) que nombran la ruta vieja se actualizan; el comportamiento de la Biblioteca no cambia.

**Migración y operación:** no hay migración. Revertir = revertir el PR. Con 0 consumos en producción, nada que convertir.

## Extensión prevista (etapa posterior, NO se construye acá): «Copiar grupo»

Cuando un grupo compartido necesita consumos distintos por producto: una acción «Copiar este grupo para este producto» que, en una transacción, crea un grupo nuevo con las mismas opciones (cada una con su versión 1 copiando diferencia, factor y consumos vigentes), cambia la admisión del producto del grupo viejo al nuevo y deja el viejo para los demás productos. Punto de extensión: el aviso del grupo compartido ya tiene el lugar donde iría el botón; los datos no necesitan columnas nuevas. Se resolvió en otro proyecto; acá queda solo el aviso y el enlace.

## Decisiones

| Decisión | Estado |
|---|---|
| El consumo se carga desde la pestaña Opciones del producto | CONFIRMADA |
| Aviso de grupo compartido antes de editar, con enlace a la Biblioteca; «copiar grupo» no se construye ahora | CONFIRMADA |
| Mismo editor, misma acción, mismo caso de uso que la Biblioteca (el editor y el parser del formulario se mueven a `src/components/catalogo/` sin cambiar comportamiento) | PROPUESTA |
| Mismo permiso que la Biblioteca (`opciones_definir`, Editar); sin permiso, solo lectura; sin clave nueva | PROPUESTA |
| Opción sin consumo: «pendiente de completar»; «ninguna»: «no consume» y no se edita | PROPUESTA |
| Consumo editable en los 4 tipos (ADICIONAL: solo SUMA, sin escalar) | PROPUESTA |
| Sin módulo Recetas: solo lectura con el aviso del módulo | PROPUESTA |
| Solo se listan las opciones que el producto admite | PROPUESTA |
| Guardar un consumo reenvía la diferencia y el factor vigentes sin cambiarlos | PROPUESTA |
| Mostrar el factor del tamaño en solo lectura | PROPUESTA |
| **Pregunta abierta:** ¿se edita también el factor del tamaño desde el producto? (el dueño lo mencionó en la pregunta A4: «pollo, carne, factor del tamaño»). Hoy el factor se carga solo en la Biblioteca. No se construye hasta que lo confirme. | PENDIENTE |
| Distinguir «sin consumo a propósito» de «no cargado» | PENDIENTE (requiere columna nueva; no pedido) |
| Copiar grupo compartido | PENDIENTE (etapa posterior, otro proyecto) |
