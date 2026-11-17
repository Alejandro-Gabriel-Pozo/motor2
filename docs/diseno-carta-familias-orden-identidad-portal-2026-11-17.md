# Carta: familias, orden y destacado, identidad y portal de la empresa (paridad con Pedernal): diseño, Fase 1

> **Estado:** borrador del Frente 7 (CARTA), 2026-11-17. **Solo documento: sin código, sin migraciones, nada aplicado.** Primer entregable: inventario, lectura de Pedernal y niveles 1 a 5 por tema con preguntas abiertas. Los niveles 6 a 10 NO se diseñan hasta que el dueño confirme los niveles 1 a 5 (compuerta de `AGENTS.md`).
> **Pedido del dueño (2026-11-17, chat, literal):** «Como q no pedí?» (sobre las funciones de la carta que Pedernal publicó); a la pregunta «¿Querés que Motor2 también lo tenga, igual que Pedernal?»: «Sí, todo como Pedernal (Recomendada)». Fuente de la cita: chat del dueño con el orquestador general, transmitida por el padre.
> **Fuera de alcance (no se toca):** el Libro (lo hace el Frente 6, «libro para todos, como hoy»); promociones (en espera del dueño); pantallas (las define el Frente 6, estilo simple de Pedernal).
> **Estados:** CONFIRMADA (dicha por el dueño, con cita) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).
> **Fuentes leídas:** Pedernal (`ZuluHub-docs` main y ramas `exploracion/*`): SQL 0077, 0079, 0080, 0081; `familias-especificacion.md`; `carta-identidad-y-portal-datos-diseno.md` (incluye 0078 y 0083 como propuesta); `novedades-para-motor2.md` filas 231 a 243. Motor2: `prisma/schema.prisma`, `src/core/carta/*`, `src/server/actions/carta/*`, `src/core/permisos/acciones.ts`, `docs/diseno-marca-del-portal-2026-11-13.md`.
> **Límite honesto (†):** no leí el CÓDIGO de ZuluHub-ERP (solo clonado, sin recorrer); lo que sigue de Pedernal es lo que dicen sus especificaciones y SQL. Los SQL 0078 y 0083 no están como archivo en `main` de ZuluHub-docs: solo como texto dentro del diseño de datos.

## Respuestas del dueño (2026-11-17, `AskUserQuestion`, literales, transmitidas por el orquestador general)

| Pregunta | Respuesta | Efecto |
|---|---|---|
| 1 Familias | «Familias nuevas como Pedernal (Recomendada)» | **CONFIRMADA:** familias nuevas por empresa; el ítem agrupado queda y se migra después, en etapa aparte con ensayo en copia |
| 2 Orden y ★ | «Dejar por sucursal, sumar modo de orden (Recomendada)» | **CONFIRMADA:** por sucursal; se suma solo el modo (alfabético / a mano) y el reordenar atómico. Diferencia declarada: carta propia por sucursal (2026-10-02) y datos existentes |
| 3 Portal e identidad | «Migrar todo ya» | **CONFIRMADA:** el modelo completo de Pedernal de una vez (no la opción barata); con ensayo en copia de solo lectura, compatible hacia atrás y por etapas internas que no rompan lo cargado |
| 4 Precio por medida | sin decisión del dueño | Opción A: verificado en solo lectura, ver `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md` §B |
| 5 Permiso del portal | «Gerente y administrador, como Pedernal (Recomendada)» | **CONFIRMADA;** ya se cumple con el código actual (§A del documento anterior): sin cambio en `acciones.ts` |

**Verificado en ZuluHub-ERP `main` (#370, clonado):** no hay todavía portal, familias ni `vidrieras.administrar_portal` en el código de Pedernal: solo están especificados. Lo de Pedernal que Motor2 reproduce es la especificación y el SQL propuesto, no código ya probado.

## 0. En diez líneas (para el dueño)

1. **Lo que pediste ya está a medias en Motor2 con otro nombre.** Motor2 ya tiene orden dentro de la sección, ★ «especial», ítems agrupados («Gaseosa 500 cc» = un renglón que junta varios productos), tema por sucursal y un portal de la empresa con tarjetas y mapa. Pedernal construyó lo mismo desde cero con otra forma. «Igual que Pedernal» no es construir de cero: es decidir qué cambia de lo que ya anda.
2. **Familias:** hay dos cosas distintas. El **ítem agrupado** de Motor2 es por sucursal, sin precio propio, y el producto agrupado «nunca sale suelto». La **familia** de Pedernal es por empresa, cada producto conserva su precio, la carta la muestra como tabla, lista o línea, y trae una acción «aplicar el precio por medida a toda la familia» (todo o nada, sin duplicar si se repite). Hay que decidir si conviven o una reemplaza a la otra (pregunta 1).
3. **Orden y ★:** en Motor2 son **por sucursal** (cada carta es propia, decisión tuya del 2026-10-02); en Pedernal son **por empresa** (tu decisión DDD 69: «Por empresa»). Cambia el modelo de datos y lo que ve cada sucursal (pregunta 2).
4. **Identidad y portal:** colores libres con contraste mínimo 7 a 1 y logos por dirección externa. Motor2 tiene hoy 12 claves de color del portal sin tope de contraste y un permiso `carta_portal` solo de administrador; Pedernal pide `vidriera.administrar_portal` para gerente y administrador.
5. **Lo más barato que permite empezar a usarlo** (§5): primero lo que no toca datos (contraste, permiso, regla de «el portal se oculta si la empresa baja de plan», forma de salir de una agrupación), después tablas nuevas.
6. Nada de lo de Pedernal se copia como código; se reproduce el resultado y la forma. Toda diferencia queda declarada con su motivo (columna «Diferencia con Pedernal»).

## 1. Inventario: lo que Motor2 YA tiene con otro nombre (validado contra el código real)

| Pedernal | Motor2 hoy | Dónde | Diferencia de fondo |
|---|---|---|---|
| Familia de productos (`familia_de_producto`, `miembro_de_familia`) | **Ítem agrupado** (`ItemAgrupadoCarta` + `OpcionItemAgrupadoCarta`) | `prisma/schema.prisma:2034`; `src/server/actions/carta/items-agrupados.ts` | De UNA sucursal. Sin precio propio (D5: «el de sus opciones, que tienen que coincidir; si no, la carta muestra el mayor»). `productoId @unique`: un producto en a lo sumo un ítem (igual que Pedernal F1). Quitar = DELETE de la fila (Pedernal: nunca borra, fecha y autor de baja). Sin «forma de salir» tabla/lista. Sin acción de precio masivo. |
| «Agrupar en el POS» (interruptor) | **No existe.** El género (`GeneroCarta`) es una carpeta visual del POS, sin precio | `schema.prisma:2071` | Concepto distinto; el interruptor de Pedernal decide si el POS muestra la familia como un renglón desplegable. |
| Orden a mano dentro de la sección (`seccion_de_carta.orden_de_renglones`, `familia.orden`, `lugar_en_carta_de_producto`) | **`orden` Int** en `ContenidoCartaProducto` y en `ItemAgrupadoCarta`, misma escala; empate por nombre | `schema.prisma:2005`, `:2046`; `src/core/carta/armar-menu.ts:425,462` | Por sucursal. No hay modo «alfabético/a mano» ni versión del orden; cada producto se edita por separado. Existe `ordenarSeccionesCarta` (secciones), **no hay acción «reordenar renglones de una sección» (†)**. |
| Estrella ★ (`familia.destacada`, `lugar.destacado`) | **`especial` Boolean** en los mismos dos modelos | `schema.prisma:2000`, `:2044` | Por sucursal; sin tope en ambos. |
| Identidad: modelo, cara, color propio, logo (0077) | **Tema por sucursal** (`TemaCartaSucursal.valores` JSON con `CLAVES_TEMA_V1`, `aplicarEnCarta`); color de marca derivado con contraste (`marca-derivada.ts`) | `schema.prisma:2353`; `src/core/carta/tema.ts`, `marca-derivada.ts`, `color-css.ts` | JSON libre validado por catálogo de claves vs columnas con CHECK. **No hay «modelo» (Lista/Cuadrícula/Libro) ni «cara» (Día/Boliche/Noche)** † (`grep` solo muestra familias tipográficas y marca). El mínimo de contraste hoy es 4,5 (AA), Pedernal pide 7. |
| Color de la empresa para sus cartas (`identidad_de_carta_empresa`) | **No existe.** Solo «color de marca» por empresa para el portal (confirmada P3, `diseno-marca-del-portal-2026-11-13.md`) | `src/core/carta/portal.ts` | Pedernal: tabla de una columna; Motor2: JSON del portal. |
| Portal (`portal_de_empresa`, `portal_tarjeta`, `portal_zona`, código propio para el QR) | **`PortalCartaEmpresa`** (JSON, 22 claves `CLAVES_PORTAL_V1`) + **`SucursalPublica`** (slug, etiqueta, `subtituloPortal`, `posX/Y/W/H`, `orden`, `publicada`) | `schema.prisma:2373`, `:2322`; `src/core/carta/portal.ts` (`decidirLayoutPortal`: modo grilla o mapa) | Motor2 ya tiene las dos variantes a su manera: grilla (≈ tarjetas, variante A) y mapa con posiciones % (≈ zonas, variante B). Pedernal guarda tarjetas y zonas en tablas separadas para poder cambiar de variante sin perder lo cargado; Motor2 las mezcla en `SucursalPublica`. La clave pública del portal es el slug de la empresa, no un código con azar propio (†). |
| Permiso `vidriera.administrar_portal` (gerente y administrador) | `carta_portal` (contexto empresa, **nivelMinimo administrador**) | `src/core/permisos/acciones.ts:84` | Motor2 modela permisos con matriz configurable; el piso difiere (administrador vs gerente+administrador). Cambia permisos: va al dueño. |
| «El portal se oculta si la empresa baja de plan» (0083) | **† No verificado** si la lectura pública del portal ya mira el módulo `carta`/el plan | `src/server/lecturas/carta/publica.ts`; `src/core/modulos/catalogo.ts:32` | A revisar contra el Frente 4 (planes y perillas). |
| Logos y fotos por dirección externa (partes, no URL pegada) | `imagenUrl` / claves de imagen del portal aceptan `https://` validado con `extraerUrlImagen` | `src/core/carta/portal.ts:92`; `schema.prisma:1953` | Motor2 guarda la URL entera; Pedernal guarda proveedor + cuenta + id + versión + extensión (lista cerrada, `CLOUDINARY`). **Ojo: cambia lo ya cargado en la empresa real.** |
| Precio por medida de un producto (`precio_de_venta` por `opcion_id`) | Producto con **un `precioVenta` + opciones con precio aditivo + `GrupoDePrecio` + `CombinacionDeProducto` + `PrecioLocalProducto`** | `schema.prisma:~405`, `:4028`, `:3907` | **El modelo de precios es otro.** «Aplicar el precio por medida a toda la familia» no se puede copiar: hay que traducirlo (†, ver pregunta 4). |

**Lo que NO existe y no pidió nadie (no entra):** días de disponibilidad, tope de estrellas, cualquier campo no listado arriba.

## 2. Tema A: FAMILIAS DE PRODUCTOS (Pedernal 0079 y 0080)

### Niveles 1 a 5

**1. Propósito y alcance.** Reunir productos que siguen siendo independientes (receta, stock, costo, código y precio propios) para mostrarlos juntos en la carta y cargar precios repetidos de una vez. *Etapa mínima (N0, lo más barato):* ya está cubierta en parte por el ítem agrupado. *Necesidad:* el dueño de Pedernal la pidió con las gaseosas y los cafés (MIG §12.10, DDD 68 a 70, 91, 122); en Motor2 el pedido es el del 2026-11-17 («Sí, todo como Pedernal»). Estado: **CONFIRMADA** (alcance), **PENDIENTE** (cómo convive con el ítem agrupado).

**2. Actores.** Quien edita productos (gerente, administrador) crea y edita familias; quien cambia precios los aplica (por cada producto). El comensal ve la carta. Operador: ve, no cambia. Estado: **PROPUESTA** (permisos de Pedernal: `productos.editar` y `productos.cambiar_precio`; en Motor2 hay que mapearlos a `carta_items_agrupados`/`catalogo_*` †; permisos nuevos o su piso → dueño).

**3. Casos de uso** (los de Pedernal, CU-F1 a F10): crear; editar nombre e interruptores; agregar producto; quitar producto; desactivar/reactivar; **aplicar precio por medida (atómico)**; productos sueltos; orden y ★; qué ve la carta; qué consume el POS (solo el dato).

**4. Conceptos y ciclo de vida.**

| Cosa | Estados | Decisión del dueño de Pedernal que rige |
|---|---|---|
| Familia | activa ↔ desactivada; nunca se borra | **Fila 231: «Sí, siguen siendo miembros»**: al desactivar, los productos siguen siendo miembros. **CONFIRMADA (en Pedernal; aceptada para Motor2 por «todo como Pedernal»)** |
| Sección | **Una familia no tiene sección propia**: toma la de sus productos; si no están todos en la misma, salen sueltos en la carta | Fila 231 «A: sin sección propia». **CONFIRMADA (idem)** |
| «Agrupar en el POS» | Interruptor, nace **apagado**, se guarda ya | Fila 231 «Sí, se guarda ya». **CONFIRMADA (idem)** |
| IVA | Una familia **puede mezclar alícuotas** (cada producto factura con la suya), sin consultar al contador † | Fila 231 «Sí, se permite». **CONFIRMADA (idem)**. Ojo: Motor2 guarda `alicuotaIvaVenta` como texto por producto, sin restricción por familia: sin choque. |
| Miembro | en la familia → fuera (con quién y cuándo); volver a agregarlo es una fila NUEVA | PROPUESTA (Pedernal F3) |
| Forma de salir | **derivada**, no se guarda: una línea, tabla (≤ 3 medidas), lista (> 3), sueltos | Maqueta aprobada de Pedernal (DDD 70) |

**5. Invariantes y políticas.** Un producto en una sola familia a la vez; todo nace cerrado (interruptores apagados; nada se agrupa si no se declara); nada se borra; el precio de cada producto sigue siendo del producto (la acción solo escribe los precios que ya existen en su modelo, sin vínculo permanente: MIG §12.24); tope de 50 productos por familia y por acción (supuesto de Pedernal S3); orden de bloqueo por id; moneda explícita y decimal exacto (en Motor2 `Decimal(14,2)`, ya existe). Estado: **PROPUESTA** salvo lo marcado arriba.

### Diferencias con Pedernal (a declarar)
| Diferencia | Motivo | Estado |
|---|---|---|
| Ids: Pedernal usa UUID generado por la app; Motor2 hasta ahora `cuid` | Regla de datos del Frente 3 (tablas nuevas con `UUID` nativo) | PROPUESTA: tablas nuevas con UUID |
| Pedernal: la familia es de la empresa; el ítem agrupado de Motor2 es de la sucursal | Datos ya existentes en producción (ítems agrupados por sucursal) + decisión de carta propia por sucursal (2026-10-02) | **PENDIENTE, pregunta 1** |
| Precio por medida: Motor2 no tiene `precio_de_venta` por `opcion_id` | Prisma/datos existentes: modelo de precios distinto | **NO VERIFICADO †, pregunta 4** |
| Auditoría: Pedernal en `registro_de_auditoria` transaccional; Motor2 `RegistroAuditoria` | Equivalente por existir ya en Motor2 | PROPUESTA |

## 3. Tema B: ORDEN Y DESTACADO DE LA CARTA (Pedernal 0081)

### Niveles 1 a 5
**1. Propósito.** Que el dueño ordene a mano los renglones de una sección (familias agrupadas y productos sueltos) y marque ★, sin tocar la ficha del producto. *Etapa mínima:* en Motor2 ya existen `orden` y `especial` por sucursal; lo nuevo es solo el **modo de orden** («alfabético» por defecto / «a mano») y la acción **«reordenar» atómica con versión**. Estado: alcance **CONFIRMADA**; resto **PROPUESTA**.

**2. Actores.** Gerente y administrador (`productos.editar` + alcance total en Pedernal; en Motor2 `carta_contenido_producto`/`carta_items_agrupados`, contexto sucursal hoy). Operador: ve. **PROPUESTA.**

**3. Casos de uso.** Elegir el modo de orden de una sección; reordenar todos sus renglones en una sola acción (Subir/Bajar es solo la forma de armar la lista); encender/apagar ★ por renglón (estado deseado, no «alternar»).

**4. Conceptos.** Modo de orden por sección (`ALFABETICO`|`A_MANO`) con `version_del_orden`; renglón nuevo en «a mano» va al final; ★ **sin tope** (DDD 68, «creo que son innecesarios topes»; **CONFIRMADA** en Pedernal). Estado: **CONFIRMADA** (sin tope y por empresa, citadas por Pedernal; el «por empresa» choca con Motor2, ver abajo).

**5. Invariantes.** Reordenar es todo o nada: falta o sobra un renglón → `LISTA_INCOMPLETA`; versión vieja → se rechaza; el orden ya vigente → éxito sin escribir. Dos reordenamientos a la vez: gana uno. Molde: `ordenarSeccionesCarta` de Motor2 (ya existe).

### Choque con lo que Motor2 ya tiene (pregunta 2)
- Pedernal: orden y ★ **por empresa** (DDD 69: «Por empresa, y medida en todas»); columnas nuevas en `familia_de_producto` y tabla `lugar_en_carta_de_producto`, sin tocar `producto`.
- Motor2: `ContenidoCartaProducto.orden/especial` e `ItemAgrupadoCarta.orden/especial` **por sucursal**, con datos cargados en producción (la empresa real tiene cartas armadas, incl. los «platos destacados»).

| Diferencia | Motivo | Estado |
|---|---|---|
| Orden/★ por sucursal (Motor2) vs por empresa (Pedernal) | Datos existentes + «la carta es propia de cada sucursal» (2026-10-02) vs «Por empresa» (DDD 69) | **PENDIENTE, pregunta 2** |
| Motor2 ya cubre orden y ★; no hay tabla nueva que migrar si se queda por sucursal | Primero lo más barato | PROPUESTA: dejar `orden`/`especial` donde están y sumar solo modo de orden + reordenar atómico |

## 4. Tema C: IDENTIDAD DE LA CARTA Y PORTAL DE LA EMPRESA (Pedernal 0077, 0078, 0083)

### Niveles 1 a 5
**1. Propósito.** Que cada carta de sucursal tenga su identidad (modelo, cara, color, logo) heredando de la empresa, y que la empresa tenga un portal público (QR) con tarjetas o imagen con zonas. *Estado de Pedernal:* 0077 «propuesta, sin aplicar»; 0078 y 0083 **no mergeadas, sin archivo en `main`** (solo propuesta en el diseño; †). Alcance: **CONFIRMADA** («Sí, todo como Pedernal»).

**2. Actores.** Administrador (portal y color de la empresa), gerente de la sucursal (identidad de su carta). Comensal: lee el portal con el código en la mano. **Fila 235: gerente y administrador pueden cambiar el portal (operador no). CONFIRMADA (Pedernal).** En Motor2 hoy `carta_portal` = administrador: cambiarlo es cambiar permisos → dueño.

**3. Casos de uso.** Guardar identidad de una carta; guardar color de la empresa; guardar el portal (variante, textos, colores, logo, tarjetas o zonas) en **una transacción**; el comensal abre el portal; la empresa baja de plan y el portal deja de verse.

**4. Decisiones del dueño de Pedernal que se aceptan (fila · texto):**

| Fila | Decisión | Estado en Motor2 |
|---|---|---|
| 232 | Logos y fotos por dirección externa, sin subir archivos; «no indexar» hasta tener dominio propio | **CONFIRMADA** (Pedernal) |
| 235 | Colores libres con contraste mínimo **7 a 1**; frase final «se guarda siempre y se muestra solo con el Libro» (**el Libro es del Frente 6: Motor2 solo guarda el campo**); subir logos desde el celular queda sin efecto; el portal se oculta si la empresa baja de plan o pierde el módulo; permiso gerente y administrador | **CONFIRMADA** (Pedernal) |
| 238, 241 | Correcciones al SQL del portal (segunda variable de sesión, dos políticas de lectura por código, teléfono con lista de permitidos) | **CONFIRMADA** (Pedernal); en Motor2 la mecánica es RLS propia |
| 242 | Dos variantes (tarjetas / imagen con zonas), la empresa elige una por vez; cambiar no pierde lo cargado en la otra; ninguna detrás de perilla | **CONFIRMADA** (Pedernal) |
| 243 | La clave del portal lleva la empresa (excepción: la llave pública del QR, única en toda la plataforma); el portal público lee solo las cartas con tarjeta o zona **visible** | **CONFIRMADA** (Pedernal) |
| 236 | SQL 0077, 0078, 0083: «aprobadas, aditivas; las reversiones frenan si hay datos»; **no mergeadas** | Informativo |

**5. Invariantes.** Se guarda el color **elegido** (el contraste se calcula al mostrar, nunca se guarda doble); la base solo valida la forma `#rrggbb`; imágenes por partes (proveedor cerrado, cuenta, id, versión, extensión), todas o ninguna; ninguna tabla se borra; portal y cartas solo de la propia empresa (aislamiento por empresa y RLS); lectura pública por columna y por código, sin poder recorrer. En Motor2 el contraste ya tiene reglas (`marca-derivada.ts`, 4,5 y 3); el 7 a 1 es **una constante nueva de la carta**, no otra fórmula.

### Diferencias con Pedernal (a declarar)
| Diferencia | Motivo | Estado |
|---|---|---|
| Portal en JSON de 22 claves (Motor2) vs columnas con CHECK (Pedernal) | Datos reales ya cargados en la empresa (header `#e5dfdf`, siete claves `transparent`, portal tipo mapa) | **PENDIENTE, pregunta 3** (migrar el portal real a las tablas nuevas o dejar el JSON) |
| Mapa/grilla en `SucursalPublica` (Motor2) vs `portal_tarjeta`/`portal_zona` separadas (Pedernal) | Datos existentes | PENDIENTE, misma pregunta 3 |
| Logo/foto: URL entera (Motor2) vs partes (Pedernal) | Datos existentes en producción | PROPUESTA: aceptar las dos al leer, escribir solo partes |
| Permiso `carta_portal` (admin) vs `vidriera.administrar_portal` (gerente+admin) | Permisos → dueño | **PENDIENTE, pregunta 5** |
| `modelo` y `cara`: no existen en Motor2 | Etapa posterior; `modelo` toca al Libro (Frente 6) | PROPUESTA: etapa C2, coordinar con Frente 6 |

## 5. Etapas (lo más barato primero; cada una chica y aditiva)

| Etapa | Contenido | Migración | Depende de |
|---|---|---|---|
| **C0** | Contraste mínimo 7 a 1 de la carta como constante nueva; validar al guardar color libre (reusa `marca-derivada.ts`) | No | pregunta 3 no la bloquea |
| **C1** | El portal público no se muestra si la empresa no tiene el módulo/plan (verificar primero si ya pasa †) | No | Frente 4 |
| **O1** | Modo de orden («alfabético/a mano») y acción **reordenar renglones** atómica con versión; ★ por estado deseado | Aditiva si por sucursal (columna en `SeccionCarta`/tabla de modo) | pregunta 2 |
| **F1** | Familia + miembros (tablas nuevas, UUID), casos de uso CU-F1 a F5, función pura «forma de salir» (§2) con oráculo | Sí (2 tablas) | preguntas 1 y 4 |
| **F2** | Aplicar precio por medida atómico + registro inmutable (`aplicacion_de_precio_de_familia`) | Sí (1 tabla) | F1 y pregunta 4 |
| **C2** | Identidad por carta (`modelo`, `cara`, color propio, logo por partes) y color de la empresa | Sí | Frente 6 (Libro) |
| **C3** | Portal con tarjetas y zonas separadas, clave propia del portal, permiso `administrar_portal` | Sí | preguntas 3 y 5 |

Migraciones en el bloque `20261117160000`–`20261117169999`, con `down.sql` y `verificacion-previa.sql`, una sentencia por tabla nueva (id UUID, `timestamptz`, sin DELETE/TRUNCATE para `motor2_app`). **Nada se aplica a ninguna base real.**

## 6. Dimensiones y oráculo de combinaciones (borrador, regla del 2026-10-28)

La «forma de salir» de una familia cambia lo que ve el comensal y el precio mostrado. **Dimensiones:** agrupar en carta (sí/no) × miembros vigentes (0, 1, ≥ 2) × medidas (ninguna, todas iguales, distintas) × precios (iguales, distintos) × cantidad de medidas (≤ 3, > 3) × secciones de los miembros (misma, distintas) × miembro oculto/desactivado/sin precio. **Oráculo:** la tabla del §6 de `familias-especificacion.md` de Pedernal (ocho filas) escrita aparte del código; test exhaustivo contra ella y guardián que falle si aparece una dimensión nueva sin declarar. Estado: **PROPUESTA** (se completa en nivel 10).

## 7. Preguntas al dueño (una por vez, ordenadas por peso)

1. **Familias vs ítem agrupado** (cambia el modelo de datos). Motor2 ya tiene el ítem agrupado, por sucursal y sin precio propio; Pedernal tiene la familia, por empresa y con acción de precio.
   - **A (recomendada):** familias nuevas por empresa como Pedernal; el ítem agrupado queda como está y se migra a familias en una etapa posterior con nombre. Costo: durante un tiempo conviven dos conceptos.
   - **B:** hacer crecer el ítem agrupado (forma tabla/lista, acción de precio); más barato, pero sigue siendo por sucursal y no es «igual a Pedernal».
2. **Orden y ★: ¿por empresa o por sucursal?** Hoy Motor2 los guarda por sucursal y hay datos reales cargados; Pedernal los guarda por empresa.
   - **A (recomendada):** dejarlos por sucursal (carta propia de cada sucursal, decisión del 2026-10-02) y sumar solo el modo de orden y el reordenar atómico. Diferencia declarada con motivo «datos existentes».
   - **B:** por empresa, como Pedernal: la sucursal pierde su orden propio (hay que migrar y elegir qué orden gana donde difieren).
3. **Portal real ya armado:** la empresa real tiene un portal tipo mapa con colores en JSON. ¿Se migra a las tablas nuevas de Pedernal?
   - **A (recomendada):** primero solo contraste, permiso y ocultar por plan (C0/C1) y dejar el JSON; las tablas nuevas, en una etapa aparte con la migración del portal real ensayada en copia.
   - **B:** pasar todo ya a las tablas de Pedernal.
4. **Precio por medida de la familia.** Motor2 no tiene un precio por producto y medida como Pedernal (usa precio base + opciones aditivas + grupos de precio). ¿Qué significa «aplicar el precio a toda la familia» acá? Necesito una respuesta antes de F2.
   - **A (recomendada):** que mi próximo paso sea una verificación del modelo de precios (solo lectura) y volver con la traducción exacta a una opción tuya; F2 queda en espera.
   - **B:** entrar F1 sin la acción de precio y dejar F2 afuera por ahora.
5. **Permiso del portal.** Hoy `carta_portal` es solo administrador; Pedernal da el portal a gerente y administrador. Es tu decisión fila 235 de Pedernal, pero cambia permisos de Motor2. ¿Confirmás gerente y administrador?

Sin respuesta, nada de esto entra: ninguna de las cinco se asume como supuesto.

## 8. Tabla «¿qué pasa si…?» (borrador por comando; se cierra en nivel 7)

| Comando | Repetición | Concurrencia | Tiempo / incertidumbre | Error parcial | Datos faltantes | Cambio de permisos |
|---|---|---|---|---|---|---|
| Crear familia | `id` mandado por la app: mismo contenido → `yaExistia`; otro → `ID_REUTILIZADO` | Único `(empresa, nombre_clave)`: gana una | — | Una transacción | Nombre vacío → rechazo | Sin permiso → cierra |
| Agregar producto | Ya está → `yaEstaba` | Único parcial `(empresa, producto)` vigente: gana una | — | Una transacción | Producto de otra empresa = «no existe» | Idem |
| Aplicar precio | Misma `aplicacionId` + huella → devuelve lo guardado | Bloqueo en orden de id; `precioIdEsperado` obsoleto → se rechaza todo | Rige desde `ahora` | Nada a medias | Producto sin esa medida: se saltea e informa | Se verifica por cada producto |
| Reordenar renglones | Orden ya vigente → éxito sin escribir | Versión del orden: gana uno | — | Todo o nada | Falta/sobra un renglón → `LISTA_INCOMPLETA` | `productos.editar` |
| Guardar portal | Mismo contenido no crea versión | `version` optimista | — | 3 tablas en una transacción | Colores vacíos = neutro | Permiso del portal |
| Ver portal público | — | — | Empresa baja de plan → deja de verse | — | Sin tarjeta/zona visible → no aparece | Ninguno (anónimo) |

## 9. Coordinación pendiente

- **Frente 6 (Pantallas, `session_01FWp2kk5PrAyuuNP3Ufwf9V`):** pantallas de familias, orden/★, identidad y portal; `modelo` y Libro. Aún sin contacto: no toqué `src/app`.
- **Frente 4 (planes/perillas):** «el portal se oculta si la empresa baja de plan» necesita su contrato.
- **Frente 2 (unidades/clasificación):** la misma «medida» de la familia debería ser la unidad/medida que defina.
- **Zona restringida** (turno del orquestador general): `schema.prisma` (modelos nuevos), `acciones.ts` y matrices (permiso del portal), `catalogo.ts` de módulos, textos nuevos, DEC.
- **Carril propio declarado (para Fase 2):** `src/core/carta/familias/**`, `src/server/actions/carta/familias*`, `prisma/migrations/2026111716*` y los modelos nuevos `FamiliaDeProducto`, `MiembroDeFamilia`, `AplicacionDePrecioDeFamilia` (y, si se aprueba, las de identidad y portal).
