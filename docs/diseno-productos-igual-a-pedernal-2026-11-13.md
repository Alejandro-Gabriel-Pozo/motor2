# Diseño — Productos (crear, editar, lista, precios, opciones, consumo) igual a Pedernal, con menos texto — 2026-11-13

Estado: **diagnóstico y diseño en papel (fase 1).** Sin código, sin migración, sin tablas nuevas. Producción congelada: nada se desplegó, migró ni escribió en producción.
Método: escalera de diseño de 10 niveles (AGENTS.md). Estados: **CONFIRMADA** (lo dijo el dueño, con cita), **PROPUESTA** (de este diseño, el dueño la corrige), **PENDIENTE** (falta decidir), **NO VERIFICADA**.
Marcas: **(V)** verificado corriendo la app o leyendo el código de `main` (`bab041b`); **(M)** verificado en la maqueta aprobada de Pedernal (`ZuluHub-docs/10-ux-ui/prototipos-gastronomia/productos.html`, 57 estados capturados); **(DOC)** sale solo de un documento.

## 1. Propósito y pedido (niveles 1 y 2)

**Pedido del dueño (2026-11-13, chat con el orquestador, literal — CONFIRMADA):** «La creación o edición o todo lo relacionado a los productos. Como verás usa menos texto.» Contexto dicho por el orquestador: el dueño comparó la ficha de producto de motor2 con la maqueta aprobada de Pedernal «Productos y precios» y quiere que **todo** lo relacionado con productos (crear, editar, lista, precios, opciones, variantes, grupos, consumo) se vea y funcione como Pedernal. Pantallas mobile first (375 px). Regla anterior ya citada en el checklist de deploy (dueño, 2026-11-12): «las pantallas quedaron bien, es mobile first, es igual a pedernal. Ahí recién desplegamos.»

Alcance de esta fase: diagnóstico + diseño + propuesta de PR chicos. No se construye nada. Actor: quien administra o gerencia el catálogo (Pedernal: «quien administra o gerencia carga todo lo que maneja la sucursal»); quien solo opera ve y no edita.

**Lo que NO se hizo / límites honestos**
- **Datos de las capturas de motor2:** base **local descartable** (Postgres local, `motor2_e2e`, vaciada al terminar) sembrada con productos de ejemplo genéricos (con grupos y recargos como los de la maqueta de Pedernal). **No se leyó ninguna copia de producción**: esta sesión no tiene credenciales y no se pidieron. Si el dueño quiere las capturas sobre su copia real, es una segunda pasada (PENDIENTE).
- **Código de Pedernal:** no estaba en este entorno; solo se leyó la maqueta y los documentos de `ZuluHub-docs`. Las reglas de Pedernal salen de la maqueta (estados y sus textos), no de su código.
- El conteo de palabras (§4) cuenta todo el texto visible, incluidas las opciones de los desplegables; es comparable entre las dos puntas, no un número exacto.

## 2. Inventario (lo que ya existe en motor2, verificado)

| Qué | Dónde / evidencia | Para este diseño |
|---|---|---|
| Lista de productos | `/catalogo/productos` (V): 4 filtros desplegables + buscador + tarjeta por producto con Código, Tipo, Disponible acá, Sucursales, Editar, Desactivar | Se rehace como la de Pedernal |
| Alta | `/catalogo/productos/nuevo` (V): Tipo (MP/PV), Categoría, Insumo, hermanar, unidad de stock y de compra, factor, «Se produce», «Activo en todas las sucursales», consignación, observaciones | Se rehace |
| Ficha | 5 pestañas: Resumen / Qué se vende / Opciones y precio / Receta / En la carta (V) | Pedernal tiene 3: Datos / Precios / Opciones (M) |
| Duplicar producto | `src/components/catalogo/duplicar-producto.tsx`, caso de uso `duplicar-producto.ts` (E4, #257) | Ya hecho; no se toca |
| Opciones del producto | `ProductoAdmiteGrupo`/`ProductoAdmiteOpcion`; grupos **compartidos** de una biblioteca (`/catalogo/opciones`) | Pedernal: grupos **propios** del producto (X18, ver §7) |
| Consumo por opción | editor de consumos, `VersionDeOpcion` + `ConsumoDeOpcion` (V) | Existe; falta rediseñarlo corto |
| Precio por sucursal | `PrecioLocalProducto` (V) y pestaña «Precio local» a nivel lista | Pedernal lo tiene dentro de «Precios» |
| Historial de precio | **No hay tabla de versiones de precio.** Sí hay auditoría: `registrarCambioAuditado` anota `Producto.precioVenta` (anterior → nuevo) en cada cambio (V: `actualizar-producto.ts:70`) | Candidato a leer de ahí, sin migración (PROPUESTA) |
| Alícuota de IVA | Columna `Producto.alicuotaIvaVenta` (nullable) existe; **no hay campo en ninguna pantalla** (V: no aparece en alta ni en edición; solo la copia «Duplicar») | Exponerla no requiere migración |
| Clasificación comercial / departamento | No existe. Existe «Categoría» (`CategoriaProducto`, rubro con margen objetivo) (V) | Otra cosa; ver Q3 |
| Ocultar / desactivar | Existe «Desactivar» por sucursal (`DisponibilidadProducto`); **no existe «Ocultar»** (V) | Ver M3 |
| Alta rápida | `quick-crear-producto.tsx` en la compra (V) | Pedernal agrega «Falta completar» |
| Nombre único | Solo `@@unique([empresaId, codigo])` (V: `schema.prisma`); la regla de nombre repetido no está en la base | Ver M4 |

## 3. Tabla comparativa, pantalla por pantalla (nivel 8 y 9)

Capturas: Pedernal `…/scratchpad/pedernal/<estado>.png`, motor2 `…/scratchpad/motor2/NN-<pantalla>.png` (rutas completas en §9; los PNG **no** se suben al repositorio, que es público).

| # | Pantalla | Qué hace Pedernal (M) | Qué hace motor2 hoy (V) | Diferencia visible (texto, campos, orden, botones) | Diferencia de reglas | Cambio de BASE DE DATOS |
|---|---|---|---|---|---|---|
| D1 | **Lista** (`lista`) | Buscador + chips «¿Qué es?» (Todos / Materia prima / Insumo / Reventa / Elaborado / Producto vendible / Oculto). Fila: nombre, «Clase · Sección», precio («$ 9.500,00», «Según medida», «por kg», «Desactivado», «Falta completar») | 4 desplegables (Tipo, Cómo se vende, Disponibilidad, Le falta algo) + «Filtrar». Tarjeta por producto con 4 pares etiqueta/valor, «Editar» y «Desactivar». La lista no muestra el precio | La tarjeta de motor2 ocupa ~170 px de alto contra ~50 de Pedernal; Pedernal muestra el precio, motor2 no | La lista de Pedernal es el estado del producto de un vistazo; la de motor2 es un tablero de filtros | Ninguno |
| D2 | **Filtro «¿Qué es?»** | 5 clases + Oculto | Tipo = Producto de venta / Materia prima / «Materia prima que se produce» / «Producto de respaldo de un adicional» | Chips contra desplegable; «respaldo de un adicional» aparece en la lista de motor2 y no existe para Pedernal | Pedernal: 5 clases (decisiones 69 y 77). motor2: 2 tipos (`MP`/`PV`) + `seProduce` | **Sí, si se quieren Insumo y Reventa** (M1). Materia prima, Elaborado (= MP + `seProduce`) y Producto vendible (= PV) mapean **sin** migración |
| D3 | **Nuevo producto** (`nuevo`) | Primero «¿Qué es?» con una línea de ayuda; luego Nombre, Nombre de cocina, Código interno, Código de barras, Unidad, Alícuota de IVA (sin valor por defecto), Departamento, Sección de la carta, Guardar. «Precios y opciones se habilitan una vez guardado» | Tipo, Categoría, Insumo (+ «Nuevo insumo», «hermanar»), Unidad de stock, Unidad de compra, factor de conversión, «Se produce», «Activo en todas las sucursales», consignación, observaciones, Crear | Pedernal pide lo propio del producto; motor2 mezcla compra, stock, hermanar y consignación en el alta. **No hay alícuota ni nombre de cocina ni código de barras** | La clase condiciona qué se pide (lo vendible: alícuota/sección/precio/opciones; lo comprado: cómo se compra) | Ninguno para ordenar y ocultar campos. «Nombre de cocina» y «código de barras» **no verificados** si existen como columna (no aparecen en el alta) → **requieren autorización expresa** si no existen |
| D4 | **Datos de un producto** (`datos`) | «¿Qué es?» (no editable), Nombre, Nombre de cocina, Códigos, Unidad, Alícuota, Departamento, Sección, «Cómo se vende» (Unidad/Fracciones/Peso + Ejemplo), «Ocultar», «Ocultar en toda la empresa», «Desactivar», «Guardar». «Cambiar los datos genera una versión nueva» | Pestaña «Qué se vende»: bloque largo con 4 explicaciones de varias líneas (tipo, unidad, factor, paso) y «Guardar cambios». Además una pestaña «Resumen» que repite los mismos datos en solo lectura | Dos pestañas (Resumen + Qué se vende) para lo que Pedernal resuelve en una; el texto explicativo de motor2 va en párrafos, el de Pedernal en una línea | Pedernal versiona los datos; motor2 audita el cambio (`registrarCambioAuditado`) | Ninguno por el reordenamiento |
| D5 | **Clasificación** (`clas-*`) | «Departamento» encadenado por niveles, «Vigente desde» (solo lectura), «Cambiar» rige desde ahora, nodo desactivado, sin departamentos | No existe (solo «Categoría» de rubro) | Campo nuevo | Clasificación con vigencia e historial; los vínculos viejos quedan en el historial | **Sí, requiere autorización expresa** (M2); además es decisión de producto (Q3) |
| D6 | **Cómo se vende** (`forma-*`, `fracciones-ofrecidas`, `cambio-*`) | Tres formas: Unidad (paso 1), Fracciones (se tildan ½, ¼, ⅛; el paso sale del más fino), Peso (kilo/gramo, paso de 0,001 kg). «Ejemplo» muestra los botones de venta. Cambiar el paso pide confirmación; cambiar kilo→gramo convierte precios | motor2: «¿Cómo se vende?» = Directo / Por opción (otra cosa: el modo de precio) y un campo libre «Paso de venta (opcional)» con párrafo explicativo | Mismo nombre de pantalla, **concepto distinto**: Pedernal = unidad de venta; motor2 = cómo se fija el precio | Pedernal deduce el paso de porciones elegidas; motor2 lo escribe a mano. La conversión de precios al cambiar de unidad no existe en motor2 | El paso ya está (`pasoVenta`). Las porciones elegidas y la conversión de precios: **NO VERIFICADO** si hacen falta columnas; ver Q9 |
| D7 | **Ocultar / desactivar** (`ocultar-*`, `ocultos-*`, `desactivar-frenado`) | «Ocultar» (local) y «Ocultar en toda la empresa» independientes de «Desactivar»; se frena si hay existencia o conteo abierto («Primero dejá la existencia en 0.»); filtro «Oculto» con «Volver a mostrar» en lote | Solo «Desactivar» por sucursal; no se frena por existencia | Botones y filtro nuevos | Dos estados independientes, mensajes aprobados, permiso aparte para «toda la empresa» | **Sí, requiere autorización expresa** (M3) |
| D8 | **Precios** (`precio`) | Pestaña propia: «Precios de» La empresa / Sucursal Centro / Norte, «Precio (IVA incluido)», «Vigente desde», «Historial», «Así se cobra» con ejemplo | Dentro de «Opciones y precio»: «Precio de lista en «Central»: $ …», «Precio en «Central»», «Guardar el precio», y «Precio local» es otra pantalla a nivel lista | El precio y las sucursales están en 2 lugares distintos; no hay selector de sucursal ni historial a la vista | Pedernal: la casilla vacía de la sucursal = rige el de la empresa. motor2: `PrecioLocalProducto` con `habilitado` (equivalente) | Selector de sucursal: ninguno. Historial: ninguno si se lee de la auditoría (PROPUESTA); **sí** (M5) si el dueño quiere «Vigente desde» con fecha elegible |
| D9 | **Precio cambiado por otra persona** (`precio-desactualizado`) | No guarda, avisa en el mismo campo, conserva lo escrito, el siguiente «Guardar» guarda (dueño 13/11) | NO VERIFICADO si el guardado del precio tiene control de versión (solo se vio el formulario) | — | Control de versión en el precio | Probable ninguno |
| D10 | **Variantes / medida** (`grilla-tamano`) | Un eje de medida con un precio por medida; «no hay precio propio del producto». «Un producto admite una sola variante» | Grupo tipo «Tamaño» con «Precio propio por tamaño / Diferencia sobre el precio base»; hasta 2 ejes (decisión 78) | Pedernal: una grilla simple; motor2: modo de precio por grupo + «Cómo se cobra…» | **Contradice la decisión 78** (producto A = 1 producto con 2 ejes tipo×tamaño y precio por combinación): la maqueta de Pedernal dice «una sola variante… si una combinación necesita otro precio, es otro producto» | Ninguno si se decide dejar como está; **CONTRADICCIÓN, Q1** |
| D11 | **Precio con recargos** (`recargos`) | Un precio + grupos; cada opción suma su recargo; «Así se cobra» + ejemplo («Producto D · Con queso y salame · Carne = $ 12.300,00») | motor2 ya tiene «Así se cobra» y «Cómo se va a ver en la carta». Cada opción ofrece «La de la opción / Otro monto / Otro porcentaje»; el grupo tiene Mínimo/Máximo | Mismo concepto, pero motor2 muestra los controles por opción y Pedernal solo el resultado | Pedernal: **sin % ni negativos, sin tope «hasta N»** (X15, X17). motor2: los conserva | Ninguno (decisión del dueño; en la auditoría, ver §7) |
| D12 | **Opciones** (`opciones`) | Botón «Copiar de otro producto»; sección «Variantes» con «Agregar variante»; «Grupos de opciones» con tarjeta por grupo: nombre, píldora «Incluida»/«Adicional», «(obligatorio)», las opciones en una línea, «Editar», «Qué consume»; «Agregar grupo» | «Opciones y precio»: «+ Nuevo grupo», «Agregar un grupo existente», y por grupo ~12 controles y párrafos (orden, mínimo, máximo, «Mostrar en la carta», cada opción con su desplegable de cobro) | 6 controles por tarjeta en motor2 contra 2 botones en Pedernal; **el editor está desplegado, no detrás de «Editar»** | Pedernal: grupos propios del producto. motor2: biblioteca compartida | Ninguno por la presentación. Grupos propios = M6 (X18, de la sesión de auditoría) |
| D13 | **Grupo nuevo** (`grupo-nuevo`, `incluida-recargo`, `dos-variantes`) | Un formulario: nombre, clase (Incluida/Adicional), obligatorio, se puede elegir más de una, no figura en la carta, opciones con recargo. Errores en el campo: «Una opción incluida no puede llevar recargo» | «+ Nuevo grupo» (formulario de grupo con tipos Tamaño/Variante/Incluida/Adicional) | Pedernal: dos clases + dos casillas; motor2: 4 tipos + mínimo/máximo | Pedernal: una sola variante por producto (error «Un producto admite una sola variante») | Ninguno |
| D14 | **Consumo** (`consumo`, `consumo-tamano`) | Pantalla «Qué consume cada opción» por grupo: cada opción dice qué insumo gasta y cuánto, **propio de este producto**; una línea puede escalar con la medida | Por opción: «Descuenta 0,2 kg de Leche entera / pendiente de completar / Editar consumo»; el consumo vive en la versión de la **opción** (compartida entre productos) | Diseño del botón «Qué consume» por grupo igual en intención; en motor2 el consumo está repartido bajo cada opción dentro de una pantalla muy larga | Pedernal: el consumo es del producto (la carne de la plato D ≠ la del bife). motor2: del grupo/opción (ya hay `docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md`) | Consumo propio del producto: **requiere autorización expresa** si la tabla actual no lo admite (NO VERIFICADO; ver ese diseño) |
| D15 | **Copiar de otro producto** (`copiar`) | Trae variantes y grupos de otro producto; lo copiado es independiente | No existe como botón en la pestaña de opciones; existe «Duplicar» (ficha, receta, opciones) y «Agregar un grupo existente» | Falta el botón dentro de «Opciones» | «Copiar» en Pedernal crea grupos independientes; motor2 hoy comparte | Con grupos compartidos: ninguno (se copia creando grupos nuevos, patrón de `duplicar-producto`). NO VERIFICADO |
| D16 | **Duplicar** | «Duplicar» aprobado (decisión 133, DOC) | **Hecho (E4, #257)**, botón en el Resumen | — | — | Ninguno; no se toca |
| D17 | **Alta rápida** (`alta-compra`, `alta-receta`) | Nombre + qué es + unidad, desde la compra o la receta; solo ofrece las clases componibles en la receta | `QuickCrearProducto` en la compra (V) | Misma intención; ver la pantalla en el PR de alta | — | Ninguno |
| D18 | **Falta completar** | Marca en la lista hasta que se guardan los datos | No existe | Etiqueta nueva | Producto «pendiente de completar» | **PROPUESTA sin migración:** derivarlo de lo que falta (por ejemplo, alícuota vacía). Si el dueño pide un marcador explícito: **requiere autorización expresa** (M7) |
| D19 | **Nombre repetido** | «Ya existe un producto con ese nombre» (único sin distinguir mayúsculas, también con desactivados) | NO VERIFICADO si la regla está en la aplicación; en la base solo es único el código | Mensaje en el campo | Único por empresa, sin mayúsculas | Índice único `(empresaId, lower(nombre))`: **requiere autorización expresa** (M4), con lectura previa de duplicados en la copia (igual que #251) |
| D20 | **Falta la alícuota** (`sin-alicuota`) | Un producto que se vende necesita alícuota; no tiene valor por defecto; «Elegí la alícuota» | La columna existe, la pantalla no la pide | Campo nuevo, obligatorio al vender | Decisión fiscal sin valor por defecto | Ninguno (columna existe). **Ya lo tiene la sesión de auditoría: no se empieza acá** (§7) |
| D21 | **Cómo se compra** (`peso-variable`, `presentacion`, `materia-prima`) | Para lo comprado: unidad de compra, presentaciones (bolsa de 25 kg), peso variable (aprox. + real al recibir) | `Presentacion` y `gestion-presentaciones.tsx` existen; «unidad de compra» + «factor de conversión» en el alta | Pedernal: pestaña/sección propia según la clase | Presentaciones con cantidad fija | Ninguno por ordenar; peso variable **NO VERIFICADO** |
| D22 | **Sin permiso** (`sin-permiso`, `ocultar-operador`) | Botones deshabilitados; el operador oculta en su local pero no en la empresa | Hay `aviso-solo-lectura.tsx` | — | Permisos por acción | Ninguno salvo el permiso de ocultar (con M3) |
| D23 | **En la carta** (pestaña) | No hay pestaña: «Sección de la carta» es un campo de Datos | Pestaña «En la carta» con ~12 campos (mostrar, ★, sección, orden, género, nombre en la carta, descripción, tags) + vista previa | Pedernal separa carta y producto | Sección por sucursal (motor2) vs. única (Pedernal) | Ninguno (ver Q7) |
| D24 | **Receta** (pestaña) | Receta en su propia ficha («Su receta se carga en la ficha de receta») | Pestaña «Receta» en la ficha | Igual intención | — | Ninguno |

**Resumen del diagnóstico (versión inicial; ver §8.1 y §8.2 para la corrección del 2026-11-13: +1 diferencia, D25 familias, y +3 migraciones posibles, M8 a M10):** 24 diferencias, **16 sin cambio de base de datos** (D1, D4, D6 en su parte de interfaz, D8 con selector de sucursal, D9, D10, D11, D12, D13, D15 y D16 a D24 en lo de interfaz), y **7 que pueden requerir migración** (M1 clases insumo/reventa, M2 clasificación, M3 ocultar, M4 nombre único, M5 versión de precio, M6 grupos propios, M7 marcador «falta completar»). De esas, **cuatro** (M1, M2, M3, M4) son aditivas simples; M5 y M7 son condicionales (la propuesta barata las evita); M6 ya es de otra sesión. **Parar y pedir autorización expresa al orquestador antes de cada una.**

## 4. Cuánto texto menos usa Pedernal (palabras visibles por pantalla, 375 px)

| Pantalla | Pedernal | motor2 | Ejemplo literal |
|---|---|---|---|
| Lista | 139 | 290 | Pedernal: «Producto B · Producto vendible · Productos B · Según medida». motor2: «Buscá por nombre o código, filtrá por tipo o disponibilidad y operá cada producto desde su fila.» |
| Nuevo | 87 | 239 | Pedernal: «Se arma o se produce y se vende; tiene composición.» (1 línea bajo «¿Qué es?»). motor2: «Agrupa esta materia prima con otras que sean, en la práctica, la misma (ej. comprada a proveedores distintos) — comparten stock automáticamente si una se queda sin stock, y se comparan sus precios entre sí.» |
| Datos | 111 | 262 | Pedernal: «La unidad base no se cambia después de crear el producto.» motor2: «Dejalo vacío para vender siempre de a una unidad entera (lo habitual). Con un paso (ej. 0,5), se puede vender esa fracción — 0,5 vende media unidad al 50% del precio — y cualquier cantidad que no sea múltiplo exacto del paso se rechaza al cargarla.» |
| Precios / opciones (hamburguesa) | 58 | 456 | Pedernal: «Guarnición — Papas fritas · Ensalada» + «Editar». motor2: 6 controles y 3 párrafos por grupo |
| Recargos (plato D) | 70 | 585 | Pedernal: «Ejemplo: Producto D · Con queso y salame · Carne = $ 12.300,00». motor2: la misma cuenta repetida por opción y por combinación |
| Variante + consumo (productoB) | 58 + 66 | 471 | Pedernal separa en dos pantallas; motor2 junta variante, grupos, consumos, vista de carta y «Así se cobra» en una pantalla de ~9 pantallas de alto |

Regla propuesta (PROPUESTA): una línea de ayuda por campo como máximo; el resto se resuelve con el estado de la propia pantalla (la píldora «Incluida», el ejemplo calculado). Los textos nuevos deben pasar por el flujo de textos por aprobar del dueño (`textos-por-aprobar.html` en Pedernal); **no se inventan textos**: se copian los de la maqueta aprobada.

## 5. Invariantes y políticas (nivel 5) y «qué pasa si…» (nivel 7)

Estas reglas ya rigen y **no cambian** con el rediseño visual; los PR chicos deben conservarlas (cada PR se verifica contra la lista):

| Comando | Repetición (doble clic) | Concurrencia (dos personas) | Error parcial | Permisos |
|---|---|---|---|---|
| Guardar datos | Auditado, idempotente por estado | Control de versión (aviso, no pisa) — **NO VERIFICADO** en datos/precio, verificar en el PR | Una transacción por guardado | `catalogo_*` (los actuales) |
| Guardar precio | Un solo registro auditado | Aviso en el mismo campo (D9) | Todo o nada | Permiso de precio actual |
| Ocultar (si se aprueba M3) | Una sola entrada en el registro (maqueta `ocultar-doble-toque`) | Frenar con existencia o conteo abierto | Se frena, no queda a medias | Gerente/administrador para «toda la empresa» |
| Duplicar | Ya cubierto por E4 | — | — | — |

Todo nace cerrado (regla del 2026-11-11): la alícuota **no** tiene valor por defecto; ninguna casilla viene tildada por decisión de este diseño; las pantallas nuevas deniegan por defecto.

## 6. Propuesta de PR chicos (≤ 400 líneas por archivo, sin refactor no pedido)

Orden propuesto (**PROPUESTA**; cada uno con el gate de 8 comandos completo):

**Sin migración (se pueden empezar cuando el dueño o el orquestador lo autorice):**
1. **P1 — Lista como Pedernal:** buscador + chips «¿Qué es?» (3 clases que ya mapean: Materia prima / Elaborado / Producto vendible; «Insumo» y «Reventa» quedan fuera hasta M1), fila compacta con precio y «Según medida». Sin tarjetas de 4 pares.
2. **P2 — Ficha con 3 pestañas (Datos / Precios / Opciones):** el Resumen se elimina y su contenido pasa a «Datos»; «Receta» y «En la carta» quedan como enlaces (Q6). Reordenamiento, sin reglas nuevas.
3. **P3 — Nuevo producto y Datos con «¿Qué es?» primero** y solo lo propio de cada clase; lo demás (hermanar, consignación, observaciones, factor de conversión) queda detrás de una sola sección plegada o se mueve a «Cómo se compra» (Q5).
4. **P4 — Precios en una pestaña:** precio de la empresa y selector de sucursal (usa `PrecioLocalProducto`); «Así se cobra» con ejemplo; historial leído de la auditoría (si el permiso de lectura lo permite — NO VERIFICADO).
5. **P5 — Opciones corto:** tarjeta por grupo con «Editar» y «Qué consume»; el editor completo detrás de «Editar». Textos de la maqueta.
6. **P6 — Consumo (pantalla «Qué consume»)** por grupo, sobre el modelo de consumo actual (la parte «propio del producto» depende de D14 y del diseño del 2026-11-09).
7. **P7 — «Copiar de otro producto» en Opciones** (reutiliza la lógica de `duplicar-producto`, crea grupos independientes). NO VERIFICADO que no choque con X18.

**Con migración — PARAR y pedir autorización expresa (una por cambio):**
- **M1** clases «Insumo» y «Reventa» (hoy `TipoProducto` = MP/PV). Aditiva: una columna o ampliar el enum; el diseño de datos requiere los niveles 1 a 5 de Q2 confirmados.
- **M2** clasificación comercial con vigencia (tablas de nodos y vínculos). Aditiva.
- **M3** ocultar en local / en toda la empresa. Aditiva (columnas o tabla de estados con historial que solo agrega) + permiso nuevo.
- **M4** índice único de nombre de producto `(empresaId, lower(nombre))`: requiere lectura previa de duplicados en la copia del ensayo (0 filas), igual que #251.
- **M5** versión de precio con «vigente desde» (solo si el historial por auditoría no alcanza).
- **M6** grupos propios del producto (X18): **ya está en la sesión de auditoría** (§7).
- **M7** marcador explícito «Falta completar» (solo si no alcanza derivarlo).
- **«Nombre de cocina» y «código de barras»:** NO VERIFICADO si son columnas existentes; si no, requieren migración.

Cada migración: aditiva y reversible (`down.sql`), sin backfill que invente datos («pendiente de completar», nunca un valor inventado).

## 7. Relacionados con la sesión de auditoría (no se empiezan acá; coordinar con el orquestador)

La sesión `session_01FWp2kfQWf5BWX1eaD9dN4k` ya tiene (según el encargo del orquestador, **no verificado por mí**) temas «Catálogo igual a Pedernal»: **X15** (sacar recargos en % y negativos), **X17** (sacar tope «hasta N»), **X18** (guarnición en grupos propios, M6) y **alícuota obligatoria** (D20). Este diseño los lista como relacionados con D11, D12, D13 y D20; los PR de arriba **no los incluyen** y deben ir después o en paralelo sin tocar los mismos archivos de opciones (P5 y P7 dependen de lo que decida X18). Fuente de la lista: `docs/auditoria-primitivas-pedernal-motor2-2026-11-12.md` §5 (filas X15, X17, X18).

Ya decidido y respetado: Duplicar (E4) hecho; ficha de «parte» única (`docs/diseno-parte-2026-11-12.md`); poda de promos en curso (#260); `docs/diseno-consumo-de-opcion-en-el-producto-2026-11-09.md` para el consumo.

## 8. Decisiones del dueño y preguntas que siguen abiertas

**Respondidas por el dueño el 2026-11-13** (chat del dueño con el orquestador; preguntas con opciones, cita literal de la opción elegida):

| # | Pregunta | Respuesta (cita literal) | Estado | Qué fija |
|---|---|---|---|---|
| 1 | Producto A: ¿una variante o dos ejes? | **Primera respuesta (2026-11-13, chat dueño ↔ orquestador): «Decisión 78: dos ejes con precio por combinación». REVOCADA** por la segunda (I9), dada después de ver lo que Pedernal decidió el 11–12/11. **Segunda respuesta (2026-11-13, chat dueño ↔ orquestador, pregunta con opciones y ese dato): «Como Pedernal: familia de productos (Recomendada)»** | **CONFIRMADA** (la segunda; reemplaza a la primera) | Producto A = **familia de productos independientes** (cada uno con su receta, stock, precio y código), cada producto con **una sola variante (la medida)** y **sin precio por combinación**. La divergencia con la maqueta **ya no existe**: motor2 va a familia + una variante «medida» (ver §8.1). La decisión 78 (dos ejes, precio por combinación) queda descartada |
| 2 | ¿Qué clases? | «Las 5 de Pedernal» | **CONFIRMADA** | Producto vendible, reventa, materia prima, insumo, elaborado. **Requiere migración (M1): NO se escribe.** M1 queda en diseño hasta autorización expresa; el nivel 6 solo con los niveles 1 a 5 confirmados |
| 4 | ¿Entra «Ocultar»? | «Sí, entra» | **CONFIRMADA** | Requiere migración (M3): solo diseño, queda para después con autorización expresa |
| 9 | ¿Por dónde se arranca? | «Sí, empezar por la lista y la ficha» | **CONFIRMADA** | Primero los cambios sin base de datos: lista (P1) y ficha de 3 pestañas (P2); después los demás, de a un PR chico, con capturas a 375 px antes de cada merge |


**Respondidas por el dueño el 2026-11-13 para las fases 2 y 3** (chat dueño ↔ orquestador; preguntas con opciones, cita literal):

| Pregunta | Respuesta | Estado | Qué fija |
|---|---|---|---|
| Lista de tarjetas sin tabla, sin «Código» ni «Sucursales N de M» en la fila | «Sí, como Pedernal (Recomendada)» | **CONFIRMADA** | **Relaja la regla de estilo de planilla del 2026-11-09 solo para la lista de Productos** (apartado y banda de filtros se mantienen; la fila es la de Pedernal). Código y «Sucursales N de M» siguen en la ficha |
| Ficha de 3 pestañas: «Resumen» eliminado, «Qué falta» arriba de Datos, disponibilidad por sucursal y «Duplicar» abajo de Datos, «Receta» y «En la carta» como dos enlaces chicos bajo las pestañas | «Sí, así provisorio (Recomendada)» | **CONFIRMADA (provisoria)** | La pregunta 6 (receta y «En la carta» dentro de la ficha o fuera) **sigue PENDIENTE** |
| «Elaborado» = materia prima que se produce | (supuesto declarado) | **PROPUESTA** | A confirmar por el dueño junto con las 5 clases cuando se diseñe la migración M1 |

**Siguen PENDIENTES (no se asumen):**
3. Departamento (M2): ¿entra la clasificación con «vigente desde»? ¿Convive con «Categoría» o la reemplaza?
5. Lo que Pedernal no muestra en la ficha y motor2 sí (hermanar insumos, consignación, observaciones, factor de conversión, producto de respaldo de un adicional): ¿se oculta, se mueve o se mantiene?
PENDIENTE — «Cómo se compra» (diferencia con Pedernal, SIN motivo de Prisma/RLS): Pedernal tiene la pestaña «Cómo se compra» con las presentaciones de compra (clases que se compran). Motor2 las tiene ocultas por una poda anterior (`PRESENTACIONES_VISIBLES = false`, `src/core/catalogo/presentaciones-visibles.ts`): la ficha no las muestra y las acciones devuelven «apagado». Pregunta para el dueño: ¿volver a mostrarlas? Si sí, se prende el interruptor y la sección «Presentaciones de compra» (hoy bajo Datos) pasa a ser la pestaña «Cómo se compra». Decisión del orquestador (2026-11-13): no se construye la pestaña ahora (sería UI muerta detrás de un interruptor apagado).

6. Receta y «En la carta»: ¿dentro de la ficha o fuera?
   - Dato de Pedernal (verificado el 2026-11-13 en zuluhub-erp `main` 59e47a4 y en la maqueta `productos.html`): la ficha tiene las pestañas Datos, Precios, Opciones y «Cómo se compra» (esta, solo para las clases que se compran). NO tiene «Receta» ni «En la carta»: la receta es otro módulo y la carta se arma en su propia pantalla; en la ficha solo aparece «Sección de la carta» como un campo de Datos. En Motor2 P2 quedan como enlaces con su «Pendiente» hasta que el dueño responda (orquestador, 2026-11-13: «no los borres»).
7. Sección de la carta: ¿única o por sucursal?
8. «Cómo se vende»: ¿porciones ½ ¼ ⅛ y peso en lugar del paso libre? ¿Y la conversión de precios al cambiar de unidad?
9b. ¿Capturas sobre una copia descartable de la base real?

*(El texto original de las preguntas 1, 2 y 4 queda arriba, en D2, D5 a D7 y D10, como contexto.)*

### 8.1. Corrección a la base de este diseño: lo que Pedernal decidió el 11–12/11 (revisado el 2026-11-13)

La primera versión de este documento se apoyó en `productos.html`. Se repasó `ZuluHub-docs` `origin/main` (`e157d19`, el mismo commit que se había clonado) con `conceptos/*.md`, `decisiones-del-dueno-2026-11.md` y las maquetas. Lo que cambia la tabla (las citas son del archivo citado; `DDD` = `decisiones-del-dueno-2026-11.md`, `MIG` = `migracion-de-la-carta-de-motor2-especificacion.md`):

| Tema | Qué dice Pedernal hoy | Fuente | Efecto en este diseño |
|---|---|---|---|
| **Producto A y familias** | Una **familia** es «un nombre que reúne productos vendibles independientes» (cada uno con su receta, stock, precio y código); opcional, un producto en una sola familia; dos interruptores, **«Agrupar en la carta»** y **«Agrupar en el POS»**; ayuda **«Aplicar el precio por medida a toda la familia»** (escribe el precio en cada producto, sin vínculo, todo o nada). En la carta sale como tabla (filas = tipos, columnas = medidas, hasta 3), línea, lista o sueltos. Orden alfabético o a mano y ★ **por empresa**, sin tope | `conceptos/familia.md`; maqueta `familias.html` (**aprobada**: «Sí, aprobado, integrá todo», DDD l.70); MIG §12.10 a §12.27 (**relatado por la sesión de la carta, sin cita literal verificada**, DDD l.42) | Nueva fila D25 y migración posible M8 (§8.2) |
| **Una sola variante, sin precio por combinación** | Cada producto tiene una variante (la medida); el «grupo de precio» se descartó | CYN 138 (`catalogo-y-niveles-maqueta.md`), MIG §12.22 | La decisión 78 de motor2 queda descartada (D10, §8) |
| **«Medida» en vez de «tamaño»** | «Por empresa, y medida en todas; medida me parece más "general"» (12/11) | DDD l.69-70 | Toda pantalla de productos dice «medida» (motor2 hoy dice «Tamaño», p. ej. el grupo «Tamaño» de la captura `05-opciones-productoB`): cambio de vocabulario (PR chico) |
| **Precio de un producto con medidas, suelto en la carta** | Siempre con el nombre de la medida al lado del precio (relatado sin cita literal) | DDD l.67 | Afecta la carta, no esta fase |
| **Ocultar** | Tres mensajes aprobados: «Primero dejá la existencia en 0.», «Hay un conteo abierto con este producto.» y el de existencia negativa; alcance local y toda la empresa; se frena desactivar también | DDD l.49-50, l.64-65, l.68 | Ya incluido (D7, M3); motor2 dijo «Sí, entra» (§8) |
| **Alícuota** | El producto ofrece **las seis** de ARCA (21, 10,5, 27, 5, 2,5, 0 %), formato «21 %», arranca en «Sin elegir»; «Exento» y «No gravado» no se ofrecen en el producto; la define el usuario | DDD l.63, 79, 85 | D20 (columna existe; sigue siendo de la sesión de auditoría) |
| **Un producto no cambia de naturaleza** | La clase no se cambia: se crea el correcto y se desactiva el otro; un insumo no se vende, se crea un producto aparte (Reventa o Vendible); «Se controla el stock» nace sin tildar; la lista vacía dice «Sin resultados» | DDD l.86, l.100 | D2/D3 (M1). Es coherente con que `Producto.tipo` hoy no se edita |
| **Forma de venta** | El producto **nace «por unidad»**; fracciones: solo **2, 4 y 8**, varias a la vez; **el paso mínimo se deriva del más fino**; el producto guarda las fracciones ofrecidas («una columna más al construir», supuesto del padre, costo de revertir bajo); «Borrar» y «Porciones» confirmados | DDD l.52, l.81 | D6: ya no es pregunta abierta de interfaz; la columna es **M10** (requiere autorización) |
| **Precios (T3)** | El precio nuevo rige solo **desde ahora** (sin fecha futura); si otra persona lo cambió se avisa en el campo; guardar el mismo precio vigente se ignora; el precio por sucursal y la grilla por medida van en la pantalla de opciones | DDD l.98 | D8, D9: «Vigente desde» es solo lectura; el historial sale de lo registrado. M5 baja de prioridad (sin fecha elegible) |
| **Lista y ficha** | La lista tiene filtro por estado (activo, falta completar, desactivado); la ficha no muestra descripción por ahora; guardar no muestra confirmación | DDD l.99 | D1, D4, D18 |
| **Clasificación (departamento → categoría)** | Aprobada y «se construye ya» en Pedernal; todo debajo del departamento se llama «Categoría»; no hay departamento por defecto | DDD l.88 a 97 | D5/M2: **Pedernal ya lo decidió**; para motor2 sigue **PENDIENTE** (pregunta 3) hasta que el dueño diga que va igual |

**Qué tiene motor2 hoy con otro nombre (verificado en el código de `main`):** la agrupación de la carta existe como **«género» y «ítem agrupado»** (`src/core/carta/genero-e-item-agrupado.ts`, con su interruptor `GENERO_E_ITEM_AGRUPADO_VISIBLE`); `conceptos/familia.md` dice que **no son** la familia («ni el "género" ni el "ítem agrupado" de Motor2», MIG §12.10). Además motor2 tiene el «grupo de precio» (`GrupoDePrecio`, ADR-032) que Pedernal **descartó** (CYN 138). **NO VERIFICADO:** cuánto de eso tiene datos cargados en la base real; hay que contarlo en la copia del ensayo (solo lectura) antes de decidir qué se retira.

### 8.2. Fila nueva y migraciones posibles que suma la corrección

| # | Pantalla / tema | Qué hace Pedernal (M, familias.html) | Qué hace motor2 hoy | Diferencia de reglas | Cambio de BASE DE DATOS |
|---|---|---|---|---|---|
| **D25** | **Familias** (lista, tabla producto A 6×3, aplicar precio por medida, interruptores carta/POS, quitar/agregar, orden y ★, sin permiso — 21 estados) | Lista de familias (cuántos productos, cómo sale en carta y POS); «Aplicar el precio por medida a toda la familia» con vista previa «actual → nuevo», todo o nada, una entrada de registro; doble toque y «otra persona cambió un precio» cubiertos; quitar con confirmación y «Deshacer»; un producto en una sola familia; «queda un solo producto» no agrupa | No existe familia. Existe «género / ítem agrupado» (otra cosa) y combinaciones/grupo de precio (descartados por Pedernal) | Concepto nuevo; el POS de motor2 no tiene agrupación | **M8 (familia: nombre, pertenencia y los dos interruptores): requiere autorización expresa.** Cómo se modela la pertenencia (tabla o columna) está **NO VERIFICADO** también en Pedernal (MIG §12.27). Con permiso de editar productos (propuesta del ingeniero de Pedernal, sin decidir) |

Migraciones posibles que se suman a las de §6: **M8** familia; **M9** retirar lo que sobra del modelo de dos ejes y precio por combinación (después de contar lo cargado; **aviso al dueño antes de cualquier borrado**); **M10** columna de las fracciones ofrecidas (2, 4, 8). Todas: **requieren autorización expresa** y niveles 1 a 5 confirmados antes del nivel 6.

### 8.3. Datos de la copia de solo lectura y conversión del producto con dos ejes (2026-11-13; contado por el orquestador, recontar en producción antes de desplegar)

Fuente: conteo del orquestador del 2026-11-13 en SOLO LECTURA sobre una copia descartable de la base (yo no leí esa base). Por ser un repositorio público, este documento **no** lleva nombres de productos, de proveedores ni cifras del negocio: el detalle vive en la conversación del dueño con el orquestador.

| Qué | Resultado en la copia |
|---|---|
| `CombinacionDeProducto`, `GrupoDePrecio`, `PrecioLocalDeCombinacion`, `CombinacionEnLinea`, `RecetaDeCombinacionVersion` | **Vacías todas**: el modelo de dos ejes y precio por combinación **no tiene ni un dato cargado ni vendido** |
| Productos con exactamente UN grupo de tipo MEDIDA | Varios; ninguno con dos (ya es «una sola variante») |
| Productos con MEDIDA + VARIANTE a la vez («dos ejes» de hecho) | **Tres** (por ejemplo, un producto «Producto A» con medida Chica/Mediana/Grande × variante de preparación) |
| Productos con VARIANTE sola | Pocos (sabores, preparaciones) |

**Consecuencias para §8 / D10 / M9:** retirar el modelo de dos ejes y de precio por combinación **no borra nada del cliente hoy** (el aviso de «borrado» baja a «sin datos hoy»); igual queda por regla de la casa: migración aditiva y reversible, autorización expresa, y recontar en producción antes de desplegar.

**Dónde guarda motor2 hoy el precio por opción (verificado en `prisma/schema.prisma`, no en la copia):** el precio de lista de una opción **en un producto** está en `ProductoAdmiteOpcion` (`precioAbsoluto`, o una diferencia `diferenciaPrecio`/`porcentaje`); la diferencia que trae la opción misma está en `VersionDeOpcion` (`diferenciaPrecio` o `porcentaje`, más `factorEscala` solo para MEDIDA); y el precio propio de una opción en una sucursal, en `PrecioLocalDeOpcion`.

**Conversión propuesta de los productos con medida + variante (PROPUESTA, sin migración de datos; la decide el dueño):**
1. **Producto A (medida × variante)** → una **familia** con un producto por variante («Producto A – variante 1», «Producto A – variante 2»…): **«Duplicar producto» (E4, ya construido)** copia ficha, receta y opciones; en cada copia se quita el grupo de la variante y queda solo la medida con sus precios. Lo que consumía cada opción de la variante pasa a la receta de su producto (a mano, en esta etapa).
2. **Los otros dos productos con medida + variante:** mismo camino si el dueño quiere que cada variante sea un producto propio; si la variante es en realidad un grupo con recargo, se reclasifica como grupo incluido/adicional **sin** crear productos. **Pregunta al dueño, por producto** (no se asume).
3. **Los grupos de tipo MEDIDA:** **NO VERIFICADO** cuántos son una medida real (chico/grande: cambia cuánto se gasta, por eso `factorEscala`) y cuántos son en realidad una variante con otro precio o un grupo con recargo (en Pedernal una «Preparación» con un recargo es un **grupo con recargo**, no la medida). Hay que listarlos con sus opciones y decidir grupo por grupo con el dueño (§8.4).

### 8.4. Los grupos MEDIDA de la copia: cómo clasificarlos para que el dueño decida grupo por grupo (2026-11-13)

La lista con nombres y cifras se pasó por la conversación del dueño con el orquestador (solo lectura); **no se reproduce acá** (repositorio público). La clasificación es **PROPUESTA de este documento, NO confirmada por el dueño**:

| Clase | Qué es | Qué pasaría en Pedernal (PROPUESTA) | Pregunta al dueño |
|---|---|---|---|
| **A. Medida real** (tamaño o cantidad; cambia cuánto se gasta) | Grupos con varias opciones de distinta cantidad o tamaño | Siguen como la variante «medida» del producto; si el producto también tiene una variante de otra cosa, esa pasa a **producto propio dentro de una familia** (§8.3) | ¿Confirmás que es una medida real? |
| **B. Un grupo con una sola opción** | Un grupo MEDIDA que ofrece una única opción (una «preparación» única) | No es una medida: se reclasifica como grupo **incluido** (sin recargo) o se saca el grupo y queda el producto solo | ¿Se reclasifica o se deja? |
| **C. Un grupo con varias opciones que son «otro plato» o «otro precio»** | Opciones que en realidad son preparaciones distintas con distinto precio | (a) grupo con recargo (adicional/incluida con recargo), o (b) cada opción como producto propio dentro de una **familia** (requiere la familia, M8) | ¿Recargo sobre un mismo producto o producto propio? |

**Observaciones (verificadas contra lo ya escrito, no contra la base):** el «Cambiar el tipo» de un grupo existente no se ofrece hoy en la pantalla (el tipo no se puede cambiar); pasar un grupo de MEDIDA a otro tipo es una **migración de datos** que requiere autorización expresa. Para la clase C(b) hace falta primero la familia (M8). **Nada de esto se ejecuta**: es el material para las preguntas al dueño.

## 9. Capturas (a 375 px; fuera del repositorio)

Carpeta Pedernal (57 estados, uno por `data-estado`): `/tmp/claude-0/-home-user-motor2/c9147c71-5143-55db-a407-d79011f3d678/scratchpad/pedernal/<estado>.png` (por ejemplo `lista.png`, `nuevo.png`, `datos.png`, `precio.png`, `recargos.png`, `opciones.png`, `consumo.png`, `copiar.png`, `grupo-nuevo.png`) y `textos.json` con el texto de cada estado.
Carpeta motor2 (29 pantallas): `/tmp/claude-0/-home-user-motor2/c9147c71-5143-55db-a407-d79011f3d678/scratchpad/motor2/NN-<pantalla>.png` (`01-lista`, `02-nuevo`, `03-ficha-productoB`, `04-datos-productoB`, `05-opciones-productoB`, `06-encarta-productoB`, `07-ficha-hamb` … `25-grupos-opciones`, `26-grupo-guarnicion`) y `textos.json`.

## 10. Pruebas, migración y operación (nivel 10)

- Cada PR de §6: gate de 8 comandos (`npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`).
- **Combinaciones (regla del 2026-10-28):** las dimensiones que cambian dinero/permisos/visibilidad en estas pantallas son **clase × rol (puede editar / solo operar) × alcance (empresa / sucursal)**; la tabla de reglas esperadas va aparte del código y un test recorre todas las combinaciones antes de cerrar P1–P4. Una dimensión nueva sin declarar debe hacer fallar el guardián.
- E2E por PR con captura a 375 px comparada contra la maqueta de Pedernal con sus textos.
- Ninguna migración en esta fase. Producción congelada: no hay despliegue.

## 11. Necesidad (quién, cuándo, dónde está escrita) y cita de aceptación

- Pedido: el dueño, 2026-11-13, chat con el orquestador: «La creación o edición o todo lo relacionado a los productos. Como verás usa menos texto.»
- Ninguna función nueva se suma por iniciativa de este documento: todo lo de §6 sale de un estado de la maqueta aprobada de Pedernal. Lo que motor2 tiene y Pedernal no (consignación, hermanar, «respaldo de un adicional») **no se quita**: se pregunta (Q5).
- Sugerencias (no implementadas): ninguna.

## 9. P3 — Presentaciones de compra («Cómo se compra»), SOLO DISEÑO (2026-11-13)

Estado: **PROPUESTA** salvo lo marcado CONFIRMADA. No se toca el interruptor `PRESENTACIONES_VISIBLES` ni `prisma/`. Toda migración de esta sección **requiere autorización expresa** del dueño.

**Decisión del dueño (CONFIRMADA, chat con el orquestador, 2026-11-13):** «El de Pedernal: presentación por producto» («caja x6» y «caja x12» son dos presentaciones; la oferta del proveedor apunta a la presentación). El diseño del 03/11 (envase por proveedor, `docs/diseno-envase-de-compra-en-el-vinculo-2026-11-03.md`) queda REVOCADO.

### 9.1 Estado actual contra Pedernal (verificado en el código real el 2026-11-13)

| # | Tema | Motor2 hoy (`Presentacion`) | Pedernal (`presentacion_de_producto`) |
|---|---|---|---|
| 1 | Qué es el envase | Una `Unidad` (p. ej. «caja») + factor; único por (producto, unidad): «caja x6» y «caja x12» no caben como dos presentaciones | Nombre libre de hasta 80, único por producto sin distinguir mayúsculas |
| 2 | Cantidad en unidad base | `factorConversion`, editable con auditoría y permiso de campos sensibles | Fija (>0, 4 decimales); «otra cantidad es otra presentación», no se edita |
| 3 | Peso variable | No existe | Marca «de peso variable» + peso aproximado |
| 4 | Oferta del proveedor | Apunta al producto (y, según el diseño revocado del 03/11, iba a apuntar al vínculo) | Apunta a la presentación |
| 5 | Clases comprables | Solo materia prima (`tipo = MP`) | Materia prima, insumo y reventa |

Lo que **coincide**: la presentación ya es por producto (no por proveedor) y su cantidad se expresa en la unidad base. Hoy el interruptor está apagado (poda): la ficha no las muestra y las acciones de crear/activar/desactivar devuelven «apagado». Con el interruptor encendido hoy se mostraría el modelo viejo, no el de Pedernal.

### 9.2 Etapas (cada una aditiva y reversible; cada migración con autorización expresa)

1. **Migración aditiva de `Presentacion`**: `nombre` (texto ≤80, obligatorio para las nuevas; las existentes se rellenan con el nombre de su unidad), unicidad (producto, nombre sin mayúsculas) con índice nuevo que convive con el viejo, `pesoVariable` (booleano, falso por defecto) y `pesoAproximado` (decimal opcional, obligatorio solo si `pesoVariable`; CHECK en la base). Sin borrar columnas ni la unicidad vieja. Cantidad inmutable: la acción de editar el factor pasa a rechazar cuando ya hay compras (hoy `FACTOR_CON_USO`) y, en esta etapa, para todas.
2. **La oferta del proveedor apunta a la presentación**: columna opcional `presentacionId` en la oferta (`ProveedorPorProducto`), con la regla de que, si está, la unidad y el factor salen de la presentación. Compras sin presentación siguen como hoy.
3. **Recién después**: `PRESENTACIONES_VISIBLES = true` (revisando las pruebas de congelación y los golden que hoy fijan «apagado»), que prende la pestaña «Cómo se compra» (ya armada en P2) y la gestión en la ficha.
4. **Clases comprables insumo y reventa**: cuando exista su migración de clases (decisión 2 del §8).

### 9.3 Qué cambia para el usuario
Quien edita productos podrá nombrar cada forma de compra («Caja x12»), indicar cuántas unidades base trae y, si pesa distinto cada vez, marcarla «de peso variable» con su peso aproximado; en la compra se elige la presentación y entra a stock la cantidad convertida a la unidad base (nunca «la caja»). Hasta la etapa 3 no se ve nada nuevo.

### 9.4 Qué se hace con las presentaciones ya cargadas
Hoy el interruptor está apagado: puede haber filas viejas. Antes de la etapa 1 hay que contarlas en la base real **en solo lectura** (lo hace el orquestador si el dueño lo pide) y decidir fila por fila: se conservan con `nombre` = nombre de la unidad y `pesoVariable = falso`. Ninguna se borra. Las compras ya hechas no se reescriben (el stock y el costo ya están en unidad base).

### 9.5 Reversión
Etapas 1 y 2: columnas nuevas opcionales y un índice nuevo; revertir es quitar el índice y las columnas sin perder nada de lo viejo. Etapa 3: poner el interruptor en `false`.

### 9.6 Tabla «¿qué pasa si…?» (comando «agregar presentación»)

| Caso | Resultado esperado |
|---|---|
| Se repite (clic doble, reintento) | Un solo registro: único (producto, nombre sin mayúsculas); la segunda llamada responde «ya existe» sin duplicar |
| Dos personas agregan el mismo nombre a la vez | Gana la primera por la restricción única; la otra recibe el rechazo, sin estado a medias |
| Producto no comprable (clase) | Se rechaza en el servidor con motivo |
| Cantidad ≤ 0 o más de 4 decimales | Se rechaza |
| Peso variable sin peso aproximado | Se rechaza (y la base lo impide con CHECK) |
| Sin permiso de editar productos | Se rechaza en el servidor; la pantalla no ofrece el botón |
| Otra empresa | Aislada por empresa (RLS y filtro en el servidor) |

### 9.7 Pruebas
Concurrencia (dos altas con el mismo nombre) e idempotencia (misma alta repetida) del comando; oráculo de combinaciones clase × peso variable × permiso; guardián de que el interruptor apagado no muestre la pestaña ni la gestión (ya existe) y de que encendido sí.

### 9.8 Pregunta abierta para el dueño
Ninguna bloqueante: la decisión de fondo ya está tomada. Queda la **autorización expresa de la migración de la etapa 1** (columnas `nombre`, `pesoVariable`, `pesoAproximado` y un índice único nuevo).
