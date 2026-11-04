# Diseño: «Nombre en la carta» por sucursal (2026-11-04)

Versión corta de la escalera de 10 niveles (regla del dueño del 2026-10-26). Estados: **CONFIRMADA** (dicha por el dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Todo lo que se dice del código sale de una lectura del código real en `main` (`94cbe181`, 2026-11-04); los tests se corren recién al implementar.

## 1. Propósito y alcance

- **Necesidad (CONFIRMADA, dueño, 2026-11-04):** el cliente ve en la carta el nombre **interno** del producto de venta, y al mozo también le hace ruido verlo al elegir platos. Hoy no existe un nombre de cara al cliente: la carta (`src/server/lecturas/carta/menu.ts`, `src/core/carta/armar-menu.ts`) y el selector del mozo (`src/server/lecturas/pos/selector-carta.ts` → `src/core/pos/selector-carta.ts` → `selector-carta.tsx`) usan `Producto.nombre`.
- **Dentro:** un campo opcional «Nombre en la carta» por producto **y por sucursal**; la carta pública, la impresa, la vista previa del producto, «Va a mostrar» y el selector del mozo lo usan cuando está cargado; «copiar carta» lo copia.
- **Fuera (CONFIRMADA):** los ítems agrupados y las promos (ya tienen nombre propio); nada más (ni opciones «por las dudas»: sin idiomas, sin nombre corto, sin nombre por canal).
- **Fuera por supuesto declarado (PROPUESTA, abiertos al final):** comanda, ticket, cocina y reportes siguen con el nombre interno.

## 2. Actores

| Actor | Qué hace | Permiso (existente) |
|---|---|---|
| Quien arma la carta | Escribe, corrige o borra el nombre en la carta de un producto en SU sucursal activa | `carta_contenido_producto` (el mismo que hoy edita el contenido de carta) |
| Comensal | Lee la carta (pública o impresa) | ninguno |
| Mozo | Ve el nombre de carta al elegir platos | los del POS (sin cambios) |

## 3. Casos de uso

| # | Caso | Resultado |
|---|---|---|
| CU1 | El dueño carga «Bife de chorizo a la parrilla» para «BIFE_CHORIZO_300» en la sucursal Centro | la carta de Centro, su vista previa, «Va a mostrar» y el selector del mozo de Centro dicen eso |
| CU2 | Otra sucursal no lo cargó | su carta sigue con el nombre interno |
| CU3 | Se borra el texto y se guarda | vuelve a NULL: la carta usa el nombre interno |
| CU4 | «Copiar carta» de una sucursal a otra | el nombre en la carta viaja con el resto del contenido |
| CU5 | Se renombra el producto (nombre interno) | si hay nombre en la carta, la carta no cambia; si no hay, la carta sigue al nombre interno |

## 4. Conceptos y ciclo de vida

- **Nombre en la carta:** texto corto, una línea, **opcional**, editable en el lugar, **sin versión propia** (como `descripcion` y `mostrarNombreArriba` del contenido). Vive en el contenido de carta del producto (`ContenidoCartaProducto`), que ya es de UNA sucursal (ADR-009, C3), así que la regla «por sucursal» sale sola del modelo existente.
- **Regla de resolución (pura, una sola):** `nombreDeCarta = nombreEnCarta ?? Producto.nombre`. Se resuelve **una vez**, al armar la carta (`armarMenuCarta`), y de ahí la usan la carta pública, la impresa y la vista previa del producto. El selector del mozo lee el campo del contenido de la sucursal y lo pone en el pedible (`nombreEnCarta?`) para mostrarlo en el botón; el resto del POS sigue con `nombre` (ajuste de implementación, declarado).
- **Sin fila de contenido = sin nombre en la carta:** un producto fuera de carta no tiene a dónde guardarlo (hay que agregarlo a la carta primero), igual que hoy la descripción.

## 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | Es **por producto y por sucursal**; vacío (NULL) = usa el nombre interno | CONFIRMADA |
| I2 | «Copiar carta» lo copia | CONFIRMADA |
| I3 | Lo escribe solo `guardarContenidoCartaProducto`, con el permiso que hoy edita el contenido de carta; auditado por columna; idempotente | CONFIRMADA (pedido del padre, 2026-11-04) |
| I4 | Largo: de 1 a 80 caracteres, una sola línea (sin saltos), sin espacios a los costados; vacío o solo espacios = NULL. El tope de 80 es el de un nombre de catálogo | PROPUESTA |
| I5 | Texto plano con el mismo juego de caracteres de un nombre de catálogo (letras, números, espacios y `- . , ( ) % & / ' _`; no puede empezar con «-»): nunca HTML | PROPUESTA |
| I6 | **No cambia el precio, ni el stock, ni la receta, ni la venta.** Es solo presentación | PROPUESTA |
| I7 | **Principio (CONFIRMADO por el dueño, 2026-11-04):** el rótulo de la **opción** es lo principal; si el producto no tiene opción que defina el plato, sale el nombre del producto, y ahí entra «Nombre en la carta» (`nombreEnCarta ?? nombre`). Hoy el ticket y la comanda **ya no** usan el nombre interno en una base (el plato sale del rótulo de la opción de la MEDIDA y lo incluido va en el `detalle`; `src/core/opciones/nombre-de-la-linea.ts`, decisión 2026-10-29): el nombre del producto solo se usa en el producto **directo**. «Nombre en la carta» reemplaza **solo** el uso de `productoNombre` de cara al cliente: carta pública/impresa/vista previa/«Va a mostrar», encabezado de «nombre arriba» y selector del mozo (implementado). **Ticket del cliente, línea de un producto directo:** PENDIENTE de confirmar (no implementado; `ticket.ts` no se toca). **Comanda de cocina (KOT):** sin cambios (`nombreDeLinea ?? productoNombre` + `detalle`; ahí debe verse lo operativo y poder controlar que «no se sacó nalga cuando era bife»), PENDIENTE de que el dueño lo confirme; protegida con test (`test/pos/comanda.test.ts`: un `nombreEnCarta` que llegara de más no entra; el consumo de stock por opción está en `test/core/opciones/consumo-de-linea-configurada.test.ts`). Reportes: sin cambios (nombre interno) | CONFIRMADA (principio) / PENDIENTE (ticket de producto directo; KOT) |
| I8 | El **buscador** del POS (`SelectorProducto`, el campo «Buscar por nombre o código») es genérico y busca por nombre interno y código; **no se toca** | PROPUESTA (pregunta abierta B) |
| I9 | **En la carta de una sucursal no puede haber dos cosas con el mismo nombre visible** (regla del dueño, 2026-11-04). «Mismo» = **nombre COMPLETO**, sin distinguir mayúsculas, tildes ni espacios de los bordes (nunca por prefijo: «Bife de chorizo» no choca con «Bife de chorizo a la criolla»). **Qué es el «nombre visible» según la forma del producto:** producto directo = `nombreEnCarta ?? nombre` (solo si está **visible**: uno oculto no ocupa nombre); agrupado y promo = su nombre / su título; **base (se vende por opción) = lo que el cliente lee son los rótulos de sus opciones** («nombre arriba» = nombre + rótulos): **en esta etapa una base NO ocupa el nombre de su producto** (sin nombre en la carta no entra a la regla; con uno, solo se compara con los nombres en la carta de los demás platos visibles). Comparar rótulos completos de opciones de bases es la **etapa posterior declarada** (necesita armar la tabla de la carta de cada base en cada guardado). El control corre solo cuando el plato va a quedar **visible** en esa carta (alta, «Mostrar», «Agregar a la carta» o guardar visible); cada sucursal se mira por separado. Lo cuida la base (único parcial `(sucursalId, lower(nombreEnCarta))` **solo entre visibles**) y el caso de uso (el resto, dentro de la misma transacción y con el candado de los nombres de la sucursal). Mensaje CONFIRMADO: «"<nombre>" ya lo usa el producto "<nombre interno del otro>" en la carta de <sucursal>. Ponele un nombre de carta distinto a uno de los dos.» (para un agrupado o una promo dice «el ítem agrupado» / «la promo») | **CONFIRMADA** (dueño, 2026-11-04): el principio, el rechazo y el mensaje; PROPUESTA: la forma de cuidarlo y el límite de la etapa para las bases |
| I10 | El orden de los platos dentro de una sección (`orden`, y a igual `orden` el nombre) desempata por el nombre que se **ve** (el de la carta) | PROPUESTA |
| I11 | Las listas de administración (diagnóstico de la carta, «Carta hoy», fuera de carta) siguen con el nombre **interno**: quien administra identifica el producto real | PROPUESTA |

## 6. Historia y persistencia

- **Una columna:** `ContenidoCartaProducto.nombreEnCarta TEXT NULL`, con `CHECK` (`NULL`, o 1 a 80 caracteres, visible a los costados y sin saltos), en pareo con `OpcionDeGrupo_descripcion_en_carta_chk` (E3).
- **Migración** `20261104130000_contenido_carta_nombre_en_carta`: aditiva y reversible; `down.sql` **aborta** si algún contenido tiene un nombre cargado (no lo borra en silencio) y después `DROP CONSTRAINT IF EXISTS` y `DROP COLUMN IF EXISTS`. Forma copiada de `20261021140000_contenido_carta_mostrar_nombre_arriba` y de la de E3. Autorización: el dueño autorizó migraciones reversibles de la carta; **aplicarla en producción la coordina el padre** (respaldo, ensayo y despliegue).
- **Sin GRANT por columna (ajuste a la propuesta del padre, verificado en el código):** `ContenidoCartaProducto` NO tiene privilegios por columna para `motor2_app` (los de tabla alcanzan; lo dice la migración de `mostrarNombreArriba` y no hay ningún `GRANT … (columna)` sobre esta tabla). Agregar uno sería inventar una restricción que la tabla no tiene. El test de la migración fija que los privilegios de tabla no cambian.
- **Sin columna de versión (NO VERIFICADA hasta correr el test):** `ContenidoCartaProducto` no tiene `version`; se guarda con un `upsert` por (sucursal, producto) y su concurrencia es «la última escritura gana, con auditoría coherente» (ver §7). No se agrega `version` a la tabla: sería un cambio grande que nadie pidió.
- **Auditoría por columna:** `ContenidoCartaProducto.nombreEnCarta`, del valor anterior al nuevo, con la sucursal, en la misma transacción que la escritura (como `mostrarNombreArriba`).

## 7. Atomicidad y concurrencia — «¿qué pasa si…?» del comando guardar

| Si… | Qué pasa (PROPUESTA) |
|---|---|
| Se hace doble clic en «Guardar» / se reintenta | Mismo pedido, mismo estado: el `upsert` escribe lo mismo y **no deja otra fila de auditoría** (`registrarCambioAuditado` no anota lo que no cambió) |
| Dos personas guardan a la vez el nombre del mismo producto en la misma sucursal | Las dos escrituras se **serializan** (la lectura del valor anterior toma el bloqueo de la fila, `FOR UPDATE`): gana la última en el orden serializado y la cadena de auditoría encadena (el «antes» de una es el «después» de la otra); nunca queda un nombre sin su fila de auditoría ni una fila a medias |
| Dos altas simultáneas del contenido de un producto sin fila todavía | Choca el único (sucursal, producto): un pedido gana y el otro vuelve a leer y escribe sobre la fila ya creada (el `upsert` ya lo cubre); sin duplicados |
| El pedido NO trae la clave (un formulario que no la muestra) | No se toca el nombre ni se audita (patrón `mostrarNombreArriba`) |
| Se guarda vacío o con espacios | Se interpreta como «sin nombre en la carta» (NULL) |
| Texto con `<script>`, saltos de línea, espacios a los costados o más de 80 caracteres | Rechazo en el guard del servidor, sin escribir; la base repite el tope y los costados con el `CHECK` |
| Falla la auditoría | No queda el nombre sin su registro: una sola transacción |
| El usuario pierde el permiso mientras edita | Rechazo en el servidor antes de escribir (`conPermiso("carta_contenido_producto")`) |
| El producto deja de ser PV, no existe o es de otra empresa | `PRODUCTO_NO_ENCONTRADO` / `NO_ES_PV`, sin escribir (el orden de chequeos de siempre) |
| La carta pública está en caché | Se invalida con la misma etiqueta de siempre al guardar; se sube `VERSION_DE_LA_CARTA_EN_CACHE` (cambia lo que arma el servidor: el `nombre` de cada ítem) |
| Dos usuarios guardan el mismo nombre en dos platos a la vez | El candado de los nombres de la sucursal los ordena: gana uno; el otro recibe «ya lo usa el plato X… elegí otro» y no escribe ni audita. El único parcial de la base es la segunda barrera |
| Se repite el mismo guardado (doble clic, reintento) | No choca consigo mismo (se excluye el propio plato); no deja otra fila de auditoría |
| Se muestra un plato (atajo «Mostrar», «Agregar a la carta» o «Guardar» con visible) cuyo nombre ya usa otro | Se rechaza con el mensaje confirmado; no escribe. Un plato **oculto** no ocupa nombre: un alta oculta que choca **pasa**, y mostrarla después se rechaza |
| Un producto base («Bife a criolla» / «Bife con chimichurri» como opciones de «BIFE-») | No ocupa el nombre de su producto: no choca con un directo «Bife de chorizo»; los rótulos completos de sus opciones quedan para la etapa posterior |
| Se pide un nombre que choca con un ítem agrupado o una promo de la sucursal | Se rechaza. Una promo de otra sucursal, o el nombre en la carta de otra sucursal, no chocan (cada carta es propia) |
| Se copia la carta a otra sucursal | El nombre viaja en el `INSERT` de la copia; la sucursal destino queda con el mismo nombre |
| Se desactiva o se saca el producto de la carta | La fila de contenido queda con su nombre guardado pero no se muestra (como todo el contenido) |

## 8. Acceso e interfaces

- **Permisos:** sin claves nuevas (`carta_contenido_producto`).
- **Pantalla del administrador:** el campo «Nombre en la carta (opcional)» en el contenido de carta del producto (`catalogo/productos/[id]/en-la-carta`, `components/carta/contenido-del-producto.tsx`), con la ayuda «Vacío = la carta usa el nombre del producto. No cambia el ticket, la comanda ni los reportes».
- **Pantallas del comensal / mozo:** sin pantallas nuevas; cambia el texto del nombre en la carta pública, la impresa, la vista previa, «Va a mostrar» y el selector del mozo.
- **Salida pública:** NO suma ninguna clave (el nombre resuelto va en el `nombre` que ya sale): `CLAVES_DE_LA_CARTA` no cambia. Sí se declara la columna en la lista cerrada de lo que **lee** la carta pública (`PUBLICACION_CARTA`).

## 9. Consultas y experiencia

- **Cadena de lectura:** `menu.ts` (select de `contenidosCarta`: + `nombreEnCarta`) → `armarMenuCarta` (`nombre: nombreDeCarta(...)` del ítem; el diagnóstico interno sigue con el nombre interno) → `CartaV1` → `proyectarCartaPublica` (sin cambios) → la carta pública / la impresa; `armarSelectorCartaPos` (el producto del selector muestra el nombre del ítem de la carta); la ficha del producto y «Va a mostrar» (`vistaPreviaDeLaForma(nombre, …)`) reciben el nombre ya resuelto.
- **El selector del mozo:** muestra el nombre de la carta en cada plato (con sus opciones como en la carta). La lista «Por agregar» y la cuenta siguen con el nombre interno (ver pregunta abierta A).
- **Qué pasa si el nombre interno cambia:** con nombre de carta cargado, la carta no se mueve.

## 10. Pruebas, migración y operación

**Dimensiones que cambian lo que ve el cliente (regla «Combinaciones», 2026-10-28):** A) nombre en la carta (ausente / presente); B) canal (carta pública, impresa, vista previa del producto, «Va a mostrar», selector del mozo); C) tipo de plato (producto directo / base con opciones / ítem agrupado).
**Dimensión «colisión» (regla del dueño, 2026-11-04):** sin choque / choca con el nombre en la carta de otro plato / con el nombre del producto de otro plato visible / con el nombre en la carta de uno oculto (no choca) / con el de uno oculto (no choca) / con el de una base (no choca en esta etapa) / con un agrupado / con una promo / con una promo de otra sucursal (no choca) / con el nombre en la carta de otra sucursal (no choca), × variante (igual, otras mayúsculas, otras tildes). Oráculo en `test/carta/nombre-en-carta.oraculo.ts` (con las dos variantes nuevas, «oculto» y «base»), recorrido completo (30 combinaciones) en `test/carta/contenido-nombre-en-carta-choque.test.ts`.

**Oráculo (tabla aparte del código, a escribir a mano):** el nombre que se ve es el de la carta **si y solo si** A = presente, el canal es de carta o selector y el plato es un producto (directo o base); un ítem agrupado nunca lo usa (tiene su propio nombre); sin nombre en la carta se ve siempre el interno; ticket, comanda y reportes (fuera de las dimensiones) no cambian.

| Qué se rompe o se amplía al sumar la columna | Dónde |
|---|---|
| Regla de resolución `nombreEnCarta ?? nombre` | test unitario puro nuevo |
| Oráculo de combinaciones (A × B × C) | test nuevo + tabla escrita aparte, con el tamaño del producto afirmado y la combinación completa en el fallo |
| Migración (forma, CHECK, privilegios de TABLA sin cambios, `down.sql` que aborta, subir-bajar-subir) | molde: `test/persistencia/migracion-opcion-descripcion-en-carta.test.ts` |
| Guard (ausente / vacío / costados / saltos / largo / caracteres) | molde: `test/catalogo/opcion-descripcion-en-carta.test.ts` |
| Caso de uso: auditoría por columna, idempotencia, **concurrencia real** (dos guardados a la vez), permiso y sucursal activa | molde: `test/carta/contenido-mostrar-nombre-arriba.test.ts` |
| «Copiar carta» copia el nombre | test de copiar carta existente, ampliado |
| Auditoría por columna | `test/arquitectura/auditoria-por-columna.test.ts` |
| Columnas de significado (declarar `ContenidoCartaProducto.nombreEnCarta` como «visibilidad») | `test/arquitectura/guardas/columnas-de-significado.ts` |
| Lista cerrada de lo que lee la carta pública | `test/arquitectura/carta-publica-lista-cerrada.test.ts` (`ContenidoCartaProducto`) |
| Caché de la carta | `test/carta/cartas-publicas-cache-por-empresa.test.ts` (la versión) |
| e2e a 375 px: el selector del mozo muestra el nombre de la carta (y el interno donde corresponde); la carta pública también | spec nuevo |

**Operación:** el padre coordina el respaldo, el ensayo y el despliegue de la migración; revertir exige antes vaciar los nombres cargados.

## 11. Preguntas abiertas (para el dueño; NO se resuelven por cuenta propia)

- **A. (corregida, 2026-11-04)** Ver I7: la comanda (KOT) no se toca y el ticket de un producto **directo** queda PENDIENTE de confirmar; en una base ya salen el rótulo de la opción y el detalle, sin el nombre del producto. Sigue abierta solo la línea del ticket de producto directo y la lista «Por agregar» del mozo (hoy con el nombre interno).
- **B. Buscador del POS:** el campo «Buscar por nombre o código» (`SelectorProducto`) es genérico (lo usan otras pantallas) y hoy busca por **nombre interno y código** y muestra el interno en el resultado. Si el mozo escribe «parrilla» (el nombre de la carta), no lo encuentra. Hacer que encuentre por los dos (y que muestre el de la carta) toca la búsqueda compartida. ¿Se hace como etapa aparte?
- **C. (resuelta por el dueño, 2026-11-04)** Nombres repetidos: **no se permiten** (ver I9). Quedan como PENDIENTES de otra etapa, declaradas acá para que no se pierdan: (1) el sentido inverso: **crear o renombrar un ítem agrupado, crear o renombrar una promo, o renombrar un producto** con un nombre que ya usa un plato de la carta no se valida todavía (hoy el choque se detecta recién al guardar o mostrar el plato); (2) **prender** un agrupado o una promo apagados que chocan; (3) una promo propia de la sucursal destino que choca con un nombre copiado: **«copiar carta» no copia ese nombre** (el plato sale con el de su producto), lo informa y sigue con el resto — decisión PROPUESTA.

## 12. NO VERIFICADO

- Que el `upsert` por (sucursal, producto) sea realmente seguro ante dos altas simultáneas del contenido sin fila previa (se prueba con concurrencia real al implementar; si falla, se informa).
- Qué otros lectores del nombre de un producto de la carta existen fuera de los listados (se buscan al implementar; un lector de carta que quede con el nombre interno se declara).
- Si algún golden (`cobro-y-carta`, la línea de base de navegador) cambia con el selector del mozo o la carta (se regenera y se declara solo si cambia).
