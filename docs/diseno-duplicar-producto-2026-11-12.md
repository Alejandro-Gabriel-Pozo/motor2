# Diseño — Duplicar producto / copiar receta y opciones entre productos (2026-11-12)

Método: escalera de diseño de 10 niveles (AGENTS.md). Estados: **CONFIRMADA** (lo dijo el dueño), **PROPUESTA** (supuesto declarado, el dueño lo corrige), **PENDIENTE**, **NO VERIFICADA**.
**Solo diseño:** este documento no trae código, ni tablas, ni migración. La compuerta (niveles 1 a 5 confirmados antes de tocar el nivel 6) queda abierta: lo que sigue de «PROPUESTA» lo decide el dueño.
**Decisión del dueño (2026-11-12, chat): «Esperá al Duplicar completo; COMO LO TIENE PEDERNAL».** El destino es UNA etapa, «Duplicar producto» (E4), igual que la especificación de Pedernal. Las piezas más chicas (E1 a E3) se describen para entender el costo, pero **no se entregan por separado**.

## Necesidad (quién, cuándo, dónde está escrita)
- El dueño, 2026-11-12 (chat con el orquestador): «no se supone que si cambia la receta, es otro producto en pedernal?; so lo que puede quedar es se genera 1 y el otro le copia la receta y cambia lo que tiene que cambiar y son 2 productos distintos y punto». **CONFIRMADA**: «Bife a criolla» y «Bife con chimichurri» son DOS productos distintos; el segundo se genera copiando la receta del primero y cambiando lo que haga falta.
- **CONFIRMADA (2026-11-12, chat): «Esperá al Duplicar completo; COMO LO TIENE PEDERNAL».** El dueño descartó ir por partes: se construye «Duplicar producto» entero (ficha, opciones, receta y ficha técnica, precio como punto de partida editable, nombre propio obligatorio), con las reglas de seguridad de la especificación de Pedernal (§12.12): id que manda la aplicación, una sola transacción, auditoría de quién duplicó a partir de cuál.
- Evidencia de costo medida (rama `alegp/tmp-capturas-antes-despues-carta`, `LEEME.md`, «ETAPA 2», 2026-11-12): cargar el segundo bife desde cero = 4 pantallas, 19 acciones (10 clics, 4 textos, 4 listas, 1 casilla; 5 guardados entre los clics) SIN contar receta ni ficha técnica; y no existe forma de copiarlas de un producto a otro.
- Regla de alcance (AGENTS.md): se pide copiar de un producto a otro la **ficha, receta, ficha técnica y opciones vinculadas**. No se pide copiar la carta, precios por sucursal, stock, proveedores ni nada más: no se suma.

## Inventario de lo que YA existe (verificado en el código real; `motor2-docs` revisado: **no hay plan ni decisión previa sobre duplicar o copiar entre productos**)
| Qué | Dónde | Sirve para esto |
|---|---|---|
| Alta de producto (formulario completo y rápido) | `src/server/actions/catalogo/productos.ts` (`darDeAltaProducto`) → `casos-de-uso/dar-de-alta-producto.ts` | Crea el producto: código autogenerado con reintento, **sin transacción a propósito**, disponibilidad DESPUÉS; sin `producto_campos_sensibles` el PV nace con precio 0 y APAGADO (M.2-A4); nombre repetido entre productos disponibles se rechaza (índice único). El alta **no se audita** (documento propio). |
| Receta versionada, append-only | `RecetaVersion` / `RecetaIngrediente` / `RecetaPaso` / `RecetaPasoIngrediente` / `SustitutoRecetaIngrediente` (`prisma/schema.prisma`); guardado en `casos-de-uso/guardar-version-de-receta.ts` | Cada guardado es una versión nueva (`MAX+1`), en transacción SERIALIZABLE con reintento, con `versionEsperada` (optimista), validación de ingredientes (disponibles, unidad de stock, guardia de unidad) y auditoría. La **ficha técnica** es la cabecera de la misma versión (rendimiento, raciones, tiempos, comentarios, presentación, notas, equipamiento). Permiso `guardar_receta` (empresa, nivel administrador). |
| Copiar receta entre SUCURSALES | `copiarRecetaPropiaDeOtraSucursal` (`receta-sucursal.ts:181`), permiso `receta_sucursal_copiar` | Es el patrón más cercano: lee el origen con permiso, exige confirmación para pisar, guarda una versión propia con «copiada de». **Mismo producto**, de una sucursal a otra; no sirve entre productos. |
| Ficha de cocina imprimible | `docs/diseno-ficha-de-cocina-2026-11-08.md` | Solo lectura; no copia nada. |
| Opciones vinculadas al producto | `ProductoAdmiteGrupo` + `ProductoAdmiteOpcion`; casos de uso `vincular-grupo-en-producto.ts`, `fijar-admision-de-grupo-en-producto.ts`, `crear-grupo-en-el-producto.ts`; permiso `producto_opciones_admitidas` | Los grupos y opciones son de la **biblioteca** (compartidos: «Guarnición» la usan 7 productos); cada producto solo guarda qué admite. Vincular un grupo existente = elegir + «Agregar» + marcar opciones + «Guardar» (SERIALIZABLE, optimista por versión, audita cada columna). |
| Copias ya hechas en el sistema | `copiar-carta-de-sucursal.ts`, `copiar-menu-del-dia-anterior.ts` | Patrón de «copiar» con idempotencia POR ESTADO (repetir no duplica). |
| «Duplicar producto», «copiar receta de otro producto», «copiar opciones de otro producto» | — | **No existen** (búsqueda por «duplicar», «clonar», «copiar» en acciones, casos de uso, pantallas y en `motor2-docs`). |
| **Pedernal** (consultado el 2026-11-12: `ZuluHub-docs` y `ZuluHub-ERP`) | ver la sección «Cómo lo resuelve Pedernal» más abajo | En el CÓDIGO de Pedernal solo existe `copiarOpciones`; «Duplicar producto» y «duplicar receta» están **aprobados como pedido** por el dueño (11/11) y especificados, pero sin construir |

## Cómo lo resuelve Pedernal (consultado el 2026-11-12; corrige lo que este documento decía antes)
Fuentes leídas: `ZuluHub-docs/11-especificaciones/migracion-de-la-carta-de-motor2-especificacion.md` (§12.8, §12.12, §12.18, §12.19, §12.22), `catalogo-y-niveles-maqueta.md` (decisión 133), `e0-cimientos-especificacion.md` (PP-6), `mapa-de-pantallas-pedernal.md` (A1, A3) y `ZuluHub-ERP/src/modulos/catalogo/casos-de-uso/copiar-opciones.ts`.
- **Regla de fondo:** «otra receta = producto distinto» (§12.6/§12.8). Dos bifes con distinta salsa son dos productos, cada uno con su receta. Coincide con lo que dijo el dueño hoy.
- **«Duplicar producto»: APROBADO COMO PEDIDO el 11/11 (§12.12), todavía NO construido** (el índice dice «NO EXISTE»; la maqueta `carta-libro.html` lo muestra). Lo especificado (supuestos de la sesión de Pedernal, «a corregir»): copia la **ficha** (clase, unidad, forma de venta, alícuota, sección, descripción), los **grupos y opciones con sus recargos**, el **precio de la empresa como punto de partida editable** y, cuando exista el módulo de recetas (E6), la **receta**. Obliga a cambiar el **nombre** (único); el código y el código de barras no se copian. **No** copia precios por sucursal, historial ni stock. Caso de uso propio con **id que manda la aplicación** (doble clic = un solo producto), **una sola transacción** (todo o nada), permiso de crear productos y auditoría de **quién duplicó a partir de cuál**. Botón «Duplicar» en la ficha: abre el producto nuevo con el nombre vacío y el cursor ahí.
- **«Duplicar receta» y «cambiar el ingrediente de una línea»: pedido para E6 (§12.18, 11/11).** El ejemplo del dueño es éste: duplicar «Milanesa de carne» → «Milanesa de cerdo», la receta se copia como punto de partida y se cambia solo la línea de la proteína; el resto no se toca. Pedernal anota que **no verificó** que E6 permita cambiar un ingrediente y que **hoy no hay recetas cargadas** allá. §12.19 agrega: la **ficha de cocina** del duplicado sale igual al instante (rinde, merma, pasos) y **conviene avisar que hay pasos para revisar** (un paso que dice «freír el bife de carne» se copia tal cual).
- **«Copiar de otro producto» (opciones): decisión 133 y código `copiarOpciones`** (es lo único construido). En Pedernal los grupos son **propios de cada producto** (a diferencia de Motor2, donde son de la biblioteca compartida): la copia **crea grupos nuevos independientes**, solo los que el destino no tiene (por nombre), con opciones activas y recargos; **no** copia el consumo de cada opción ni los precios de sucursal; idempotencia por un `copiaId` que manda la app; bloquea los dos productos en orden de id (sin trabarse con otra copia en sentido contrario); todo en una transacción.
- **Qué NO hay en Pedernal todavía:** el caso de uso «Duplicar», «duplicar receta», «cambiar ingrediente de una línea», la ficha técnica copiada. El dueño los dio por aprobados; el código no existe.

**Qué cambia para Motor2.** (1) El orquestador tenía razón en que el código de Pedernal solo trae «copiar opciones»; pero el pedido aprobado de Pedernal es **«Duplicar» completo** (ficha + opciones + receta + ficha técnica), y es lo que el dueño espera: «copio un bife y le cambio la salsa». (2) La diferencia de modelo importa: en Motor2 las opciones se **vinculan** a la biblioteca (compartidas), no se copian; la parte «copia independiente» de Pedernal en Motor2 corresponde a la **receta**, que sí es propia de cada producto. (3) «Cambiar la salsa» en Motor2 = cambiar el insumo de una línea de la receta: hoy `actualizarIngredienteDeReceta` cambia cantidad, unidad y merma del MISMO insumo; cambiar el insumo es **quitar y agregar** (**NO VERIFICADA** la secuencia exacta en pantalla): hay que sumarlo a la etapa de receta como «cambiar el ingrediente de una línea».

## Primero la opción más barata
Tres formas de resolverlo, de menor a mayor costo. Estimaciones de acciones = **ESTIMADO, no medido**, para «Bife con chimichurri» copiando de «Bife a criolla» en Cordillera; la medida de hoy es la de arriba (19 acciones en 4 pantallas, sin receta ni ficha).

| | Qué agrega | Pantallas nuevas | Escritura nueva | Qué se ahorra (bife) | Riesgo |
|---|---|---|---|---|---|
| **E1 — Copiar receta y ficha técnica de otro producto** | Un selector «Copiar de otro producto» en la pantalla de la receta del destino | 0 (un bloque en la pantalla de la receta) | Reusa `guardar-version-de-receta` (una versión nueva en el destino) | La receta entera: hoy ≈ 4 acciones por ingrediente + hasta ≈ 10 campos de ficha; copiar = 3 acciones (elegir, confirmar, copiar) | Bajo: sin tablas, sin precio, sin permisos nuevos |
| **E2 — Copiar opciones de otro producto** | Un botón «Copiar opciones de otro producto» en «Opciones y precio» del destino | 0 | Vínculos `ProductoAdmiteGrupo` / `ProductoAdmiteOpcion` en una transacción SERIALIZABLE | Los grupos del bife: hoy ≈ 9 de las 19 acciones; copiar = 3 | Medio: precios por opción (dinero) y opciones compartidas |
| **E3 — «Nuevo producto parecido a…»** | El alta (la existente) se abre precargada con los datos de otro producto; el nombre queda vacío y obligatorio | 0 (parámetro de la pantalla «Nuevo producto») | **Ninguna nueva**: guarda por la acción de alta de siempre | Categoría, unidad, factor, modo de venta, alícuota: ≈ 2 a 3 acciones | Bajo: es solo lectura precargada |
| **E4 — Botón «Duplicar» (todo junto)** | Un diálogo: nombre obligatorio + qué copiar → crea el producto, copia receta, ficha y opciones | 1 diálogo | Una acción que compone alta + E1 + E2 | De 19 acciones + receta a ≈ 3 (nombre, casillas, «Duplicar») + los datos propios de la carta | **Alto**: «todo o nada» choca con el alta actual (sin transacción a propósito) y obliga a decidir el precio |

**Decisión del dueño: esperar a E4 («Duplicar» completo), como Pedernal.** La regla «primero la opción más barata» sugería empezar por E1 (copiar la receta); el dueño la reemplazó con su decisión del 2026-11-12. Lo que sigue vale igual: E1, E2 y E3 son las **piezas** que E4 compone (leer el origen, copiar receta y ficha, vincular opciones, precargar el alta), y el diseño de sus comandos (niveles 3 a 10) es el de E4. Lo que cambia es que **no se entregan por separado**: la primera entrega es «Duplicar». «Cambiar el ingrediente de una línea» (el ejemplo de la salsa o la proteína) es el paso inmediato siguiente, **E4b**, como pide Pedernal en §12.18 (pedido a la etapa de recetas); queda con nombre, sin construir, hasta que el dueño lo pida.

---

## Nivel 1 — Propósito y alcance
- Que dos productos parecidos (bife a criolla / bife con chimichurri; milanesa / milanesa napolitana) no obliguen a cargar dos veces la misma receta, ficha técnica y opciones. CONFIRMADA (el dueño, 2026-11-12) para la receta; PROPUESTA para opciones y datos del producto.
- **Fuera de alcance (no se hace):** copiar la carta («En la carta»), el precio de lista y los precios por sucursal, la disponibilidad por sucursal, el stock, proveedores y presentaciones de compra, recetas propias de una sucursal, calibraciones de rendimiento local, historial, costos; vincular las dos recetas (la copia es independiente: cambiar una no cambia la otra); duplicar sucursales o categorías; copiar entre empresas. PROPUESTA.

## Nivel 2 — Actores y contexto
- Quien arma el catálogo: con `guardar_receta` (administrador, empresa) para E1; con `producto_opciones_admitidas` (administrador, empresa) para E2; con `alta_producto` (operario) para E3/E4. El servidor valida todo en cada acción; el pedido nunca trae el permiso.
- Contexto: empresa activa de la sesión. Los productos se ven bajo la regla de disponibilidad por sucursal (un producto que el usuario no ve → «No se encontró el producto»). Recetas y opciones son de la EMPRESA (no de la sucursal), salvo la receta propia de sucursal (no se copia).

## Nivel 3 — Casos de uso (comandos)
1. **C1 · Copiar receta de otro producto** (E1): `origenId`, `destinoId`, `versionEsperadaDelDestino`, `confirmaPisar`. Deja en el destino una versión NUEVA de la receta central con los ingredientes, sustitutos, pasos, la tabla paso↔ingrediente y la cabecera (ficha técnica) del origen.
2. **C2 · Copiar opciones de otro producto** (E2): `origenId`, `destinoId`, grupos a copiar (por defecto todos los activos). Suma al destino los vínculos que le faltan.
3. **C3 · Precargar un alta parecida** (E3): lectura del origen para llenar el formulario; no es un comando de escritura.
4. **C4 · Duplicar producto** (E4): `origenId`, `nombre` (obligatorio), qué copiar (receta y ficha / opciones), `claveDeIdempotencia`. Compone C3 + C1 + C2.

## Nivel 4 — Conceptos y ciclo de vida
- **Copia independiente.** El destino NO guarda un vínculo vivo con el origen: cambiar la receta del origen después no toca al destino. Lo que queda es el registro de auditoría «copiada de <producto> (versión N)» (nivel 6).
- **Receta = versiones append-only.** Copiar sobre un destino sin receta crea su versión 1; sobre uno con receta crea la versión siguiente (la anterior queda en el historial: nunca se borra ni se pisa). «Pisar» significa «la vigente pasa a ser la copia».
- **Opciones = vínculos a la biblioteca.** Copiar opciones NO crea grupos ni opciones nuevos: el destino queda vinculado a los MISMOS grupos y opciones (compartidos). Renombrar una opción o cambiar su consumo (`Qué consume cada opción`) afecta a todos los productos que la usan; la pantalla ya lo avisa. Si el dueño quiere un grupo propio, existe «Nuevo grupo» (hoy).
- Ciclo del destino: producto sin receta → (C1) receta vigente vN; sin opciones → (C2) opciones vinculadas; «En la carta» y precio siguen «Pendiente» hasta que alguien los carga.

## Nivel 5 — Invariantes y políticas
**Qué se copia y qué no (PROPUESTA, el dueño corrige).** Dimensión nueva en cualquiera de estas tablas ⇒ el guardián de columnas (nivel 10) obliga a declarar si se copia.
| Dato | C1 receta | C2 opciones | C4 duplicar | Nota |
|---|---|---|---|---|
| Ingredientes (insumo, cantidad, unidad, merma, observaciones) | **Sí** | — | Sí | Pasan por la validación de siempre (disponibles, unidad de stock, guardia de unidad) |
| Sustitutos del ingrediente | **Sí** | — | Sí | Si el insumo sustituto está inactivo, rechaza como un ingrediente dado de baja |
| Pasos y su tabla paso↔ingrediente | **Sí** | — | Sí | Se reconstruyen contra los ingredientes NUEVOS de la copia (no se reutilizan ids) |
| Ficha técnica (cabecera: rendimiento, raciones, tamaño de ración, tiempos, comentarios, presentación, notas, equipamiento) | **Sí** | — | Sí | Viaja en la misma versión |
| Receta vigente del producto elegido, en la sucursal elegida como origen (la Central cuenta como una sucursal más; si la sucursal no tiene receta propia, la que rige allá es la central) | **Sí** (ver «Elegir el origen») | — | Sí | **CONFIRMADA** (el dueño, 2026-11-12): la vigente en ese momento, no una anterior |
| Calibraciones de rendimiento local del ORIGEN | No | — | No | Las del destino siguen el arrastre existente (por insumo y unidad) |
| Grupos admitidos (`orden`, mínimo, máximo, modo de precio, «Mostrar este grupo en la carta») | — | **Sí** (solo los activos) | Sí | Un grupo archivado en la biblioteca no se copia y se avisa «N grupos archivados no se copiaron» |
| Opciones admitidas (activas; cantidad máxima) | — | **Sí** | Sí | Compartidas, no copiadas |
| **Precio por opción** y toda la información de la opción (`precioAbsoluto`, `tipoDeDiferencia`, `diferenciaPrecio`, `porcentaje`, cantidad máxima, activa) | — | **Sí** | **Sí** | **CONFIRMADA** (el dueño, 2026-11-12). La pantalla de confirmación muestra cuántos precios se copian |
| **Precio de venta de lista** | — | — | **No por defecto** | **Dinero**: ver la pregunta clave. Cambiarlo exige `producto_campos_sensibles` |
| Precios por sucursal (`PrecioLocalProducto`), disponibilidad, **«En la carta» (`ContenidoCartaProducto`)**, stock, proveedores, presentaciones | No | No | No | **CONFIRMADA** para la carta (el dueño, 2026-11-12: «eso ya es ajeno, es de otro módulo; acá hablamos de la configuración de los productos»). Quedan «Pendiente»; el sistema lo dice, no lo inventa |
| Datos del producto (tipo, categoría, unidad de stock, factor, modo de venta, alícuota IVA, `pasoVenta`, `seProduce`, observaciones) | — | — | **Sí** (E3/E4); `codigo`, `nombre`: nuevos | El nombre es obligatorio y propio; el código se autogenera como en el alta |
| Consignación (proveedor y costo) | — | — | No | Fijar un costo exige `pagar_consignante`; no se hereda |

**Invariantes.**
1. **Todo o nada** por comando: una transacción SERIALIZABLE (como `guardar-version-de-receta` y `fijar-admision-de-grupo-en-producto`); sin estados a medias.
2. **Idempotencia**: C1 optimista (`versionEsperadaDelDestino`) y por estado (si la vigente del destino ya es igual al origen: éxito sin escribir ni auditar); C2 por estado (cada par producto-grupo y producto-opción es único); C4 con `claveDeIdempotencia` y el índice único del nombre.
3. **La copia se lee DENTRO de la transacción**: lo que se copia es lo que el origen tenía en ese instante; queda anotado de qué versión.
4. **Nunca se copia salteando lo inválido**: si un ingrediente está dado de baja, falla todo con el nombre de cada uno; no se copia «lo que se pueda».
5. **El destino nunca se pisa en silencio**: con receta propia hace falta confirmación explícita; las versiones viejas quedan.
6. **Sin precio sin permiso ni aviso**: lo que mueve dinero se muestra antes de guardar.
7. **Aislamiento y autorización**: empresa y permisos los resuelve el servidor en cada comando; origen y destino deben ser de la empresa activa y visibles para quien copia.
8. **Trazabilidad**: toda copia deja quién, cuándo, de qué producto (y versión) a cuál (nivel 6).
9. **Toda acción que pisa datos muestra antes su resultado y pide aceptación** (CONFIRMADA, el dueño, 2026-11-12: «esta es una acción que tiene determinado resultado, ¿lo aceptás?»). Una ventana de confirmación dice qué se va a sobrescribir (por ejemplo «la receta vigente de <destino>, versión 3, pasará a ser la copia; la anterior queda en el historial»), qué se copia y qué no, y recién con el «Aceptar» se escribe. Vale para cualquier acción futura que pise datos. **«Duplicar» no pisa nada** (el producto nuevo nace vacío), así que no dispara esa ventana; sí muestra qué se va a copiar y qué no antes de crear.

### Estado de las decisiones (compuerta niveles 1 a 5)
| Decisión | Estado |
|---|---|
| Bife a criolla y Bife con chimichurri son 2 productos distintos | CONFIRMADA |
| Se genera uno y el otro le copia la receta y cambia lo que haga falta | CONFIRMADA |
| Copiar también ficha técnica, receta y opciones vinculadas | CONFIRMADA («como lo tiene Pedernal»: ficha + opciones + receta) |
| Esperar al «Duplicar» completo (E4), como Pedernal; no entregar E1 a E3 por separado | CONFIRMADA (el dueño, 2026-11-12, chat) |
| La copia es independiente del origen (sin vínculo vivo) | PROPUESTA |
| Qué se copia / no se copia (tabla de arriba) | PROPUESTA |
| Precio de lista del duplicado: se copia como punto de partida editable (Pedernal §12.12), mostrado antes de guardar; con la regla de permisos de Motor2 (sin `producto_campos_sensibles` nace en 0 y apagado) | CONFIRMADA en lo general («como lo tiene Pedernal»); el detalle de permisos es PROPUESTA |
| Precio por opción en la copia de opciones (recargos): se copian con el resto, como en Pedernal | CONFIRMADA en lo general; PROPUESTA el aviso «incluye N precios» |
| Nombre propio obligatorio y no repetido (E3/E4) | PROPUESTA (es la regla del alta actual) |
| Elegir el origen con un modal: primero la sucursal (la Central también cuenta como una) y luego el producto | CONFIRMADA (el dueño, 2026-11-12) |
| Se copia la receta VIGENTE en ese momento del producto elegido, nunca una versión anterior | CONFIRMADA (el dueño, 2026-11-12) |
| «En la carta» no se copia | CONFIRMADA (el dueño, 2026-11-12) |
| Se copian precio y toda la información de cada opción | CONFIRMADA (el dueño, 2026-11-12) |
| **Donde Motor2 difiera de Pedernal, se adapta para coincidir** (el dueño, 2026-11-12). Por eso «Duplicar» crea un producto NUEVO y vacío: no hay nada que sobrescribir; y si algún día se copia sobre un producto que ya existe, se hace como `copiarOpciones` de Pedernal: **suma lo que falta (grupos por nombre) y no pisa lo que el destino ya tiene** | CONFIRMADA (el dueño, 2026-11-12). Reemplaza la respuesta anterior «sobrescribir» |
| Avisar «hay pasos para revisar» al copiar la receta | CONFIRMADA (el dueño, 2026-11-12) |
| Hace falta cambiar el ingrediente de una línea (la salsa, la proteína) | CONFIRMADA la necesidad (el dueño, 2026-11-12); PROPUESTA que se entregue junto con «Duplicar» o inmediatamente después (E4b) |
| Pedernal: «Duplicar» (ficha + opciones + receta + precio de empresa editable) aprobado como pedido 11/11; sin construir; `copiarOpciones` sí construido | CONFIRMADA (leído en `ZuluHub-docs` y `ZuluHub-ERP`, 2026-11-12) |
| Cambiar el ingrediente de una línea al duplicar (el ejemplo de la proteína o la salsa) | PROPUESTA (pedido de Pedernal §12.18, sin especificar en Motor2) |

## ¿Qué pasa si…? (por comando)
### C1 · Copiar receta de otro producto
| Situación | Resultado |
|---|---|
| Repetición / doble clic | El segundo pedido trae la misma `versionEsperada`, ya superada: «la receta cambió, vuelva a mirarla» (`VERSION_DESACTUALIZADA`), no crea otra versión. Si la vigente del destino ya es igual al origen: éxito sin escribir (por estado). |
| Concurrencia: dos usuarios copian al mismo destino | SERIALIZABLE + `versionEsperada`: uno gana, el otro recibe el aviso de versión; nunca dos versiones con el mismo número (índice único, reintento). |
| Concurrencia: el origen cambia mientras se copia | El origen se lee dentro de la transacción: se copia una versión consistente; la auditoría anota su número. Un cambio posterior del origen no toca al destino. |
| Reintento automático tras error de red | Seguro: con la versión nueva ya guardada, el reintento cae en «la receta cambió» o en «ya es igual». |
| Origen sin receta | Rechazo: «<producto> no tiene receta: no hay nada que copiar.» No escribe. |
| Origen = destino | Rechazo («elegí otro producto»). |
| Destino con receta vigente | Sin confirmación explícita: rechazo. Con confirmación: versión nueva (la anterior queda en el historial). |
| Receta con ingredientes dados de baja (sin disponibilidad en ninguna sucursal) | Falla todo (la misma validación del guardado de siempre) y nombra cada ingrediente; no copia a medias. Quien copia lo arregla en el origen o lo quita en el destino. |
| El destino es uno de los ingredientes del origen (receta circular) | **NO VERIFICADA** la guarda actual; el diseño exige rechazar: un producto no puede ser ingrediente de sí mismo. Test obligatorio. |
| Destino que no admite receta (MP sin «Se produce») | Rechazo con el mensaje de elegibilidad de siempre. |
| Ingrediente con unidad distinta de la de stock, o cantidad desproporcionada (guardia de unidad) | La copia pasa por las mismas validaciones y guardias que un guardado a mano; si la receta del origen es vieja y no las cumple, pide corregirla o la confirmación habitual. |
| Cambio de permisos (le sacan `guardar_receta` en el medio) | El permiso se verifica en el servidor antes de leer nada; sin permiso, rechazo sin escribir. Si lo pierde después de empezar, la transacción ya empezada termina bajo el permiso con el que arrancó (igual que hoy en el guardado de receta). |
| Origen o destino de otra empresa o no visible para quien copia | «No se encontró el producto» (sin revelar si existe). |
| Error parcial / falla de la base | La transacción se revierte entera; el destino queda como estaba. |
| Datos faltantes (cabecera con unidad de rendimiento inactiva, ingredientes vacíos) | Validación de cabecera e ingredientes de siempre; mensaje explícito, sin escribir. |
| Tiempo | La copia no depende del reloj; la hora la pone el servidor; no hay reintentos por tiempo. |

### C2 · Copiar opciones de otro producto
| Situación | Resultado |
|---|---|
| Repetición / doble clic | Por estado: lo que el destino ya tiene vinculado no se vuelve a crear ni auditar; el segundo pedido dice «no había nada para sumar». |
| Concurrencia: dos usuarios copian al mismo destino | SERIALIZABLE con choque de único `(productoId, grupoId)` y `(productoId, opcionId)`; el reintento da el resultado de negocio (patrón de `fijar-admision-de-grupo-en-producto`). |
| El destino ya admite alguno de los grupos (solo si algún día se copia sobre un producto existente; **no es parte de «Duplicar»**) | **No se pisa:** se suman solo los grupos que faltan, por nombre, como `copiarOpciones` de Pedernal; la respuesta lista los que ya estaban. El destino que tiene grupos que el origen no tiene los conserva. |
| Opciones compartidas vs copiadas | Compartidas (mismos grupos y opciones de la biblioteca). El aviso de confirmación lo dice: «cambiar el nombre o el consumo de una opción afecta a los N productos que la usan». |
| Grupo o opción archivados en la biblioteca | No se copian y se avisa cuántos quedaron afuera. |
| Grupo con precio por opción (dinero) | Se copia con su precio (CONFIRMADA); la confirmación muestra cuántos precios se copiarían. |
| Cambio de permisos | `producto_opciones_admitidas` se verifica antes de leer; sin permiso, rechazo sin escribir. |
| Origen sin opciones | Rechazo: «<producto> no tiene opciones vinculadas.» |
| Error parcial | Todo o nada (una transacción). |

### C4 · Duplicar producto (etapa posterior; solo lo nuevo respecto de C1/C2/C3)
| Situación | Resultado |
|---|---|
| Doble clic en «Duplicar» | `claveDeIdempotencia` + índice único del nombre: se crea UN producto; el segundo pedido devuelve el producto ya creado. |
| Nombre repetido | Rechazo antes de crear (regla del alta: un producto disponible con ese nombre ya existe; índice único). Nombre vacío: rechazo (obligatorio). |
| Dos usuarios duplican a la vez con el mismo nombre | El índice único del nombre deja pasar a uno; el otro recibe «ya existe». |
| Falla a mitad (ya se creó el producto, falla la copia) | **No puede pasar a medias:** el alta y la copia van en UNA transacción SERIALIZABLE. El código autogenerado del alta usa el reintento de TODA la transacción (`conReintento`, como `guardar-version-de-receta`): si el código choca, se descarta el intento y se repite entero con otro; no hace falta el alta sin transacción de hoy. Si algo falla, no queda ni el producto vacío. |
| Sin `producto_campos_sensibles` | El producto nace con precio 0 y apagado (regla M.2-A4 vigente): se dice en pantalla; con la clave nace con el precio del original (editable) y la disponibilidad que pida el tilde. |
| El mismo `duplicadoId` con otro origen u otro nombre | Rechazo `ID_REUTILIZADO` (patrón de `copiarOpciones` de Pedernal); con el mismo origen y nombre devuelve el producto ya creado (`yaExistia`). |
| Sin `alta_producto` | Rechazo antes de leer. |

### Elegir el origen (CONFIRMADA, el dueño, 2026-11-12)
«Primero un modal de filtro que diga de qué sucursal querés buscar el producto a copiar, y seleccionar.» Se elige **primero la sucursal** y **después el producto**. **La Central cuenta como una sucursal más** (puede tener receta o no). Con una sola sucursal el primer paso se omite. **Se copia la receta VIGENTE en ese momento** del producto elegido en esa sucursal (nunca una versión anterior); si esa sucursal no tiene receta propia, la que rige allá es la central. Reglas que ya existen y se respetan (S-07, `copiarRecetaPropiaDeOtraSucursal`): solo se ofrecen las sucursales donde quien copia tiene membresía y «Ver» de `receta_sucursal_copiar`; el producto se ve bajo la regla de disponibilidad por sucursal; el servidor lo vuelve a verificar al guardar.

## Nivel 6 — Historia y persistencia (sin tablas nuevas)
- **Migración: ninguna.** E4 (y las piezas E1, E2 y E3 que compone) escribe solo en tablas que ya existen (`RecetaVersion` y sus hijas, `ProductoAdmiteGrupo`, `ProductoAdmiteOpcion`); no se crea ninguna tabla «a ciegas».
- **Trazabilidad (quién, cuándo, de qué a cuál):** el registro de auditoría existente (`registrarCambioAuditado`, mismo patrón que `describirCopiaDeRecetaPropia`): «Versión N de la receta de <destino> creada por copia de <origen> (versión M)»; y una fila por columna cambiada en los vínculos de opciones. La versión de la receta ya es append-only: no se borra ni se anula nada; revertir = copiar otra vez o volver a guardar.
- **Punto de extensión previsto (NO se migra ahora):** una columna opcional `copiadaDeRecetaVersionId` en `RecetaVersion` (relación opcional, solo agrega) si más adelante hace falta un reporte «de dónde viene esta receta» sin leer la auditoría. Hoy la necesidad no está escrita: queda como etapa con nombre.
- Dinero: sin columnas nuevas; los importes que se copian (si se decide) son los que ya tiene el origen, con su moneda de empresa.

## Nivel 7 — Atomicidad y concurrencia
- **C1:** reusar el caso de uso `guardar-version-de-receta` (transacción SERIALIZABLE, `conReintento` hasta 5, `versionEsperada`, validaciones, auditoría): la copia es «guardar una versión con los datos del origen». Lo único nuevo es leer el origen dentro de la misma transacción y reconstruir los pasos contra los ingredientes nuevos.
- **C2:** una transacción SERIALIZABLE con `tambienChoqueDeUnico` (patrón de `fijar-admision-de-grupo-en-producto`).
- **C4:** ver la tabla de arriba (decisión pendiente al llegar a la etapa).
- Ninguno de los comandos usa «leer, decidir, escribir» sin protección: la lectura va dentro de la transacción.

## Nivel 8 — Acceso e interfaces
- **Modal de origen** (común a todo): sucursal → producto; ver «Elegir el origen». **Ventana de aceptación** antes de pisar datos (invariante 9).
- E1: bloque «Copiar receta y ficha técnica de otro producto» en `/catalogo/recetas/[productoId]` (selector del producto origen + confirmación). Permiso `guardar_receta`.
- E2: botón «Copiar opciones de otro producto» en `/catalogo/productos/[id]/opciones`. Permiso `producto_opciones_admitidas`.
- E3: «Nuevo producto parecido a…» en `/catalogo/productos/nuevo?...` (precarga, nombre vacío y obligatorio) y/o en la ficha del producto. Permiso `alta_producto`.
- E4: botón «Duplicar» en la ficha del producto. Mensajes en lenguaje de proceso; nada se inventa: lo no copiado se muestra «pendiente de completar».
- Módulo y navegación: los de siempre (`catalogo_basico` y `recetas`).

## Nivel 9 — Consultas y experiencia
- La confirmación SIEMPRE muestra qué se copia y qué no («se copian: 4 ingredientes, 3 pasos, la ficha técnica; no se copian: precios, carta, disponibilidad»), y si el destino ya tiene receta, su versión vigente y que quedará en el historial.
- Estimación de pantallas y acciones (ESTIMADO) para el bife de Cordillera, «Bife con chimichurri» copiando de «Bife a criolla» (caso de prueba con las pantallas reales de la rama `alegp/tmp-capturas-antes-despues-carta`):

| | Hoy (medido) | Con E1 (copiar receta) | E1 + E3 + E2 | E4 «Duplicar» |
|---|---|---|---|---|
| Pantallas | 4 (+ receta: 1) | 5 (receta: 1, con el bloque nuevo) | 5 | 2 (diálogo + «En la carta») |
| Acciones sin receta/ficha | 19 | 19 | ≈ 12 (alta precargada 3, precio 2, opciones copiadas 3, carta 4) | ≈ 7 (nombre, casillas, «Duplicar» + carta 4) |
| Receta y ficha técnica | ≈ 4 por ingrediente + hasta ≈ 10 campos (a mano; no hay receta real cargada para medirlo) | 3 | 3 | incluida |
- El número exacto depende de cuántos ingredientes tenga la receta del bife: **no está medido porque en producción no hay recetas cargadas** (0 filas). Medirlo con una receta real es parte de la prueba de aceptación de E1.

## Nivel 10 — Pruebas, migración y operación
- **Migración:** ninguna (E4 y sus piezas). Operación: nada que sincronizar; reversible por construcción (las versiones y vínculos se pueden volver a editar).
- **Combinaciones (regla del dueño, 2026-10-28):** dimensiones que cambian lo que se copia o se rechaza, con tabla esperada escrita aparte del código y un test que las recorre:
  - C1: {destino con / sin receta} × {origen con / sin receta} × {tipo de destino: PV, MP «Se produce», MP común} × {ingredientes todos disponibles / alguno dado de baja} × {permiso `guardar_receta`: sí / no} × {confirmación de pisar: sí / no} (96 combinaciones, exhaustivo).
  - C2: {destino con / sin los mismos grupos} × {grupo del origen activo / archivado} × {opción activa / inactiva} × {precio por opción: sí / no} × {permiso: sí / no}.
  - Guardián de columnas: lista las columnas de `RecetaVersion`, `RecetaIngrediente`, `RecetaPaso`, `RecetaPasoIngrediente`, `SustitutoRecetaIngrediente`, `ProductoAdmiteGrupo`, `ProductoAdmiteOpcion` con «se copia / no se copia / derivada»; una columna nueva sin declarar hace fallar el test (como los demás guardianes del proyecto).
- **Pruebas obligatorias (reglas del dueño):** concurrencia (dos copias simultáneas al mismo destino: una gana, la otra recibe el aviso; nunca dos versiones con el mismo número), idempotencia (la misma copia repetida no agrega versiones ni vínculos), atomicidad (falla inyectada a mitad: el destino queda idéntico), aislamiento entre empresas, autorización (cada comando sin permiso: rechazo antes de leer), trazabilidad (la auditoría dice quién, de qué producto y versión), y el caso circular.
- **Verificación antes de integrar (gate de AGENTS.md):** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build` y `npm run test:e2e`, todos limpios en la misma corrida; más un e2e de aceptación con el bife (copiar receta y comprobar que las dos recetas son independientes).
- **Quién escribe el código (regla del dueño, 2026-11-04):** Sonnet; Opus y Fable planifican, revisan y verifican.

## Preguntas abiertas
**Ninguna pendiente.** Respondidas por el dueño el 2026-11-12 (ver «Estado de las decisiones»): receta con ficha técnica en el destino (en «Duplicar» el destino es nuevo, nada que sobrescribir); sucursal de origen (modal: sucursal y después producto; la Central cuenta como una); receta que se copia (la vigente en ese momento); «En la carta» (no se copia); precio por opción (se copia con toda la información); aviso de pasos copiados (sí); cambiar el ingrediente (hace falta); y la regla general «donde difiera de Pedernal, se adapta para coincidir».
- **Una lectura mía a confirmar en la revisión del PR (no bloquea):** «si la sucursal elegida no tiene receta propia, se copia la central, que es la que rige allá».

## Pregunta clave
La que quedaba abierta («¿el duplicado nace con el mismo precio de lista o vacío?») la respondió el dueño con «como lo tiene Pedernal»: el precio de la empresa se copia **como punto de partida editable** y se muestra antes de guardar. En Motor2 se aplica con la regla de permisos vigente: con `producto_campos_sensibles` nace con ese precio; sin la clave nace en 0 y apagado y la pantalla lo dice. **Sin pregunta clave pendiente.**

## Etapas con nombre
- **E4 — Duplicar producto (la que se construye primero).** Botón «Duplicar» en la ficha: abre el producto nuevo con el nombre vacío y obligatorio, y copia ficha, opciones, receta y ficha técnica y el precio como punto de partida, en una sola transacción, con id que manda la aplicación y auditoría de quién duplicó a partir de cuál. Compone internamente las piezas E3 (alta precargada), E1 (receta y ficha técnica) y E2 (opciones).
- **E4b — Cambiar el ingrediente de una línea de la receta** (el ejemplo de la salsa o de la proteína; §12.18 de Pedernal): **el dueño dice que hace falta** (2026-11-12). Se propone entregarla junto con «Duplicar» o inmediatamente después; sin construir hasta la autorización del dueño.
- **Aviso de pasos copiados** («hay pasos para revisar»): CONFIRMADO por el dueño (2026-11-12); forma parte de «Duplicar».
- **Posteriores (sin necesidad escrita hoy):** columna `copiadaDeRecetaVersionId`; copiar carta; copiar entre sucursales de recetas propias.
