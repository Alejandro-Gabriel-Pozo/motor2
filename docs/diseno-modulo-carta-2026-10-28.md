# Diseño: módulo Carta de la Fase 7 «pantallas por módulo» (Ola PM), 2026-10-28

Origen: DEC-24 ratificada por el dueño el 2026-10-20 (`docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`, «Fase 7»): Carta tiene **3 entradas** de menú: «Carta» (pestañas Hoy · Secciones y géneros · Ítems agrupados), «Promociones» (con el menú del día) y «Apariencia y publicación». Aplican también DEC-33 (ver ≠ escribir con NIVELES de la misma clave, sin claves nuevas ni migración) y la regla «primero lo más barato» (AGENTS.md). Molde: los módulos Movimientos (#131) y Stock (`docs/diseno-modulo-stock-2026-10-27.md`) ya terminados.

Escrito contra el código real del carril `alegp/carril-car` (base `2b994fb6`, la integración E1 + E2 + E3a + Stock), contra la emulación ratificada (artefacto `N9vFwuyYsQD7RkwjNzTsxf`, `project/Main.dc.html`: `MP.carta`, `TABS.p_carta/p_promos/p_apar`, vistas `agot` y `cartaSecProp`) y contra `motor2-docs` (no hay plan aprobado de la carta más allá de DEC-24, la emulación, ADR-032, ADR-034 y ADR-035).

**Restricción de esta ola: SIN MIGRACIÓN.** Menú, rutas, pestañas, vocabulario, niveles ver ≠ escribir y un filtro de LECTURA (vigencia de las promos en la carta pública). Lo que pediría migración o un cambio de permisos no ratificado queda PENDIENTE (sección 11).

## 0. Inventario de lo que ya existe (verificado en el código)

Ya se construyó buena parte de la gestión de la carta (CARTA-MANT, ADR-034, pedidos #121 y #128): dos «puertas» arriba de cada pantalla (`encabezado-de-carta.tsx`: «Mantenimiento» y «Parametrización»), con niveles internos en Mantenimiento (Hoy · Precios · Visibilidad) y un tablero de tarjetas en Parametrización.

| Ruta | Qué es | Guarda de la página | Escrituras (caso de uso, clave) |
|---|---|---|---|
| `/carta` | «Mantenimiento»: niveles Hoy (platos sin stock hoy), Precios (apagado: `PRECIOS_EDITABLES = false`), Visibilidad (Sí/No por sección y producto, «Fuera de carta») | `carta_ver` | `fijarDisponibilidadDeHoy` (`producto_disponibilidad`), `actualizarVisibleEnCarta`, `agregar/quitarProductoALaCarta` (`carta_contenido_producto`), `actualizarActivaSeccionCarta` (`carta_secciones`, empresa), copiar carta (`carta_copiar_de_sucursal`) |
| `/carta/parametrizacion` | Tablero de tarjetas (Secciones, Géneros, Agrupados, Promociones, Apariencia) | `carta_ver` | — |
| `/carta/parametrizacion/secciones` | Secciones (empresa: alta, orden, activar) y la ficha de cada producto en la carta (contenido, descuento) | `carta_ver` | `carta_secciones`, `carta_contenido_producto`, `carta_producto_descuento` |
| `/carta/parametrizacion/generos` | Géneros (carpetas del selector del POS) | `carta_ver` | `carta_generos` |
| `/carta/agrupados` | Ítems agrupados | `carta_items_agrupados` | `carta_items_agrupados` |
| `/carta/parametrizacion/promociones` | Promos: datos, cupos, lugares de entradas, vigencia, «dónde se ve» (solo salón), prender en la sucursal, precio local | `carta_ver` | `carta_promo_definir` (empresa), `carta_promo_activar`, `carta_promo_precio_local` |
| `/carta/parametrizacion/apariencia` | Tablero con dos enlaces: Tema y Portal | `carta_ver` | — |
| `/carta/tema` | Tema de la carta pública de la sucursal | `carta_tema` | `guardarTemaCarta`, `cambiarAplicacionTema` |
| `/carta/portal` | Portal de sucursales (empresa) | `carta_portal` (empresa) | `guardarPortalEmpresa`, `moverSucursalEnMapa`, `agregar/quitarSucursalAlPortal`, `guardarSucursalPublica` |
| `/movimientos/opciones-agotadas` | Opciones agotadas hoy en la sucursal | `opcion_apagar_en_sucursal` | `apagarOpcionEnSucursal` |
| `/movimientos/menu-del-dia` | Plato del día de los lugares «del día» | `promo_menu_del_dia`; con `MENU_DEL_DIA_VISIBLE = false` responde 404 | `agregar/quitarPlatoDelDia`, copiar el día anterior |

**Menú hoy** (`core/navegacion/estructura.ts`, grupo `carta`): «Carta pública» (`/carta`, mal nombrada: es la administración), «Ítems agrupados de la carta», «Portal de sucursales», «Tema de la carta», «Opciones agotadas» y, solo con el interruptor prendido, «Menú del día». Secciones, Géneros, Promociones y Apariencia NO tienen entrada (se llega por el tablero).

**Claves** (`core/permisos/acciones.ts`): todas las `carta_*` y `carta_promo_*` con piso administrador; `opcion_apagar_en_sucursal`, `producto_disponibilidad` y `promo_menu_del_dia` con piso operario. Contexto empresa: `carta_secciones`, `carta_portal`, `carta_promo_definir`; el resto, sucursal.

**Ver ≠ escribir hoy:** Secciones, Géneros, Agrupados, Promociones y la ficha «En la carta» muestran los datos como texto (`DatosSoloLectura`) con el aviso `AvisoSoloLectura`; `/carta` deshabilita cada control; Opciones agotadas y Menú del día miran su nivel. **Brechas:** Tema y Portal dibujan los formularios completos a quien solo ve (el servidor rechaza igual, `conPermiso`/`conPermisoDeEmpresa`).

**Mecanismo del menú reutilizable** (de Movimientos y Stock): `ItemNav` con `accion` o `algunaDe`; `RUTAS_DE_UNA_ENTRADA`; `PestanasDeRuta`; guardas `requierePermisoVerDeAlguna` (sucursal) y `requierePermisoVerDeAlgunaDelMenu` (dos contextos); filtrado de pestañas en el servidor (`pestanasVisiblesDeStock`).

**Hallazgo de la carta pública (pendientes 2026-10-27 §5):** la vigencia de una promo (`PromoCarta.vigenteDesde/vigenteHasta/diasDeSemana`, ADR-032 D-7) la respeta el POS (`promoVigenteEl` en `lecturas/pos/selector-carta.ts` y al agregar), pero la carta pública (`lecturas/carta/menu.ts`) muestra la promo todos los días: el cliente ve una promo que el mozo no puede vender ese día.

## 1. Propósito y alcance

- **Propósito:** que el encargado y el administrador encuentren todo lo de la carta en TRES lugares con nombre de tarea: lo de todos los días y su estructura («Carta»), las promociones («Promociones») y cómo se ve y se publica («Apariencia y publicación»). — CONFIRMADA (DEC-24).
- **Dentro:** menú de 3 entradas con sus pestañas de ruta (las URL no cambian); reemplazar las dos «puertas» de CARTA-MANT por esas pestañas; ver ≠ escribir en Tema y Portal; vocabulario; arreglos a 375 y 1280 px; arreglo de la vigencia en la carta pública (lectura). — CONFIRMADA (pedido de la ola).
- **Fuera:** rediseño del Menú del día (GO-3d; ver sección 12); carta en inglés, pop-up de promociones, imágenes de platos, «forzar forma», diccionario de palabras fijas (ideas, sin decisión); cambiar quién puede agotar platos (ver P-1); mudar URL. — CONFIRMADA (pedido de la ola) / PROPUESTA (URL).

## 2. Actores y contexto

- Administrador de la sucursal (rol `admin`): ve y edita todo. — CONFIRMADA (semilla).
- Encargado/operario con `opcion_apagar_en_sucursal` (piso operario) sin `carta_ver`: hoy entra solo a «Opciones agotadas». Tiene que seguir encontrándolo. — CONFIRMADA (código).
- Rol con Ver y sin Editar de una clave (DEC-33). — CONFIRMADA.
- Mozo (salón): no entra a la administración; vende desde el POS lo que la carta y las promos ofrecen. — CONFIRMADA.
- Cliente: ve la carta pública (web, QR, impresa), sin sesión. — CONFIRMADA.
- Contexto: casi todo es de la sucursal ACTIVA; secciones, portal y definición de promos son de la EMPRESA. Aislamiento por RLS (`ctx.db`) y eco de sucursal en cada acción. — CONFIRMADA (código).

## 3. Casos de uso

| Id | Caso | Dónde (después de esta ola) | Clave |
|---|---|---|---|
| CU1 | Marcar un plato sin stock hoy / de nuevo en carta | Carta › Hoy (`/carta`) | `producto_disponibilidad` |
| CU2 | Agotar una opción (tamaño, guarnición) hoy | Carta › Hoy › Opciones agotadas (`/movimientos/opciones-agotadas`) | `opcion_apagar_en_sucursal` |
| CU3 | Qué se muestra (sección o producto) y «Fuera de carta» | Carta › Hoy, nivel Visibilidad | `carta_contenido_producto`, `carta_secciones` |
| CU4 | Secciones, orden y ficha de cada producto; géneros del POS | Carta › Secciones y géneros | `carta_secciones`, `carta_contenido_producto`, `carta_producto_descuento`, `carta_generos` |
| CU5 | Ítems agrupados | Carta › Ítems agrupados | `carta_items_agrupados` |
| CU6 | Promos (datos, cupos, lugares, vigencia, solo salón, prender, precio local) | Promociones | `carta_promo_*` |
| CU7 | Menú del día | Promociones › Menú del día (solo con el interruptor prendido) | `promo_menu_del_dia` |
| CU8 | Tema de la carta | Apariencia y publicación › Tema | `carta_tema` |
| CU9 | Portal de sucursales | Apariencia y publicación › Portal | `carta_portal` (empresa) |
| CU10 | El cliente ve la carta pública con las promos que valen HOY | Carta pública | sin sesión |

## 4. Conceptos y ciclo de vida

- **Carta propia de la sucursal** (ADR-009): contenido por producto y sucursal (`ContenidoCartaProducto`); sin fila = no sale. Secciones de la empresa. — CONFIRMADA.
- **Disponibilidad «hoy»** (`DisponibilidadProducto.disponible`): NO vence sola; «sin stock hoy» queda así hasta que alguien lo vuelve a prender (ADR-034; la base no distingue «sin stock hoy» de «no se vende acá»). — CONFIRMADA (código).
- **Fuera de carta**: PV disponible en la sucursal sin contenido de carta: se vende en el POS (sección «Fuera de carta» del selector) y NUNCA sale en la carta pública (premisa del dueño del 2026-10-14, `core/carta/mantenimiento.ts`). — CONFIRMADA.
- **Promo** (`PromoCarta`, de la empresa) prendida por sucursal (`PromoCartaSucursal`), con vigencia opcional (rango de fechas inclusive y días de la semana, en días de calendario de la zona de la empresa) y «solo salón». Lo que ya está en una mesa no cambia si la promo deja de valer. — CONFIRMADA (ADR-032 D-7, diseño solo salón).
- **Tema** (borrador → aplicado → desaplicado, conserva valores) y **publicación en el portal** (agregada → publicada / sin publicar; quitar no borra, el slug queda reservado). — CONFIRMADA (código).

## 5. Invariantes y políticas

| Id | Regla | Estado |
|---|---|---|
| I1 | Menú = página: una entrada se muestra solo a quien puede abrir su página (misma clave o misma lista `algunaDe`, mismo cálculo). | CONFIRMADA (test `menu-con-permiso`) |
| I2 | Ver ≠ escribir con niveles de la MISMA clave: quien solo ve recibe la pantalla sin poder cambiar (formulario deshabilitado o datos como texto) con aviso, y el servidor rechaza igual. Sin claves nuevas. | CONFIRMADA (DEC-33) |
| I3 | Las URL no cambian; una pantalla que queda sin uso (tableros) redirige a la que la reemplaza. | PROPUESTA (como Fase 6 y Stock) |
| I4 | La carta pública muestra una promo solo si está ofrecida en la sucursal (activa y prendida), no es «solo salón» y VALE HOY (vigencia, con el día de calendario de la zona de la empresa). Mismo criterio que el POS: `promoVigenteEl`, función única. Falla cerrado: vigencia inválida = no se muestra. | PROPUESTA (arregla el hallazgo; criterio ya CONFIRMADO para el POS en ADR-032) |
| I5 | Ninguna lectura de la carta escribe (guardián `carta-solo-lectura`). | CONFIRMADA |
| I6 | Todo se lee y escribe en la sucursal activa o la empresa activa; otra empresa no ve ni escribe (RLS + eco de sucursal). | CONFIRMADA |
| I7 | Lo que falta se muestra «pendiente de completar» / «Sin cargar», nunca inventado (el tablero NO dibuja «cambios sin publicar» porque no existe un borrador de la carta). | CONFIRMADA |

## 6. Historia y persistencia

**Sin tablas, columnas ni datos nuevos.** La vigencia ya está en `PromoCarta` (migración GO-3 aplicada). El arreglo de la carta pública es un filtro de lectura. Las escrituras del módulo conservan su auditoría actual (ficha `@ficha` de cada caso de uso: `REGISTRO_AUDITORIA` en disponibilidad, contenido, promos, cupos, vigencia, solo salón, copiar; `DOCUMENTO_PROPIO` en secciones, géneros, agrupados, tema y portal: brecha anotada en P-4).

## 7. Atomicidad y concurrencia

- Esta ola NO agrega comandos de escritura. Las escrituras existentes se documentan como están (sección 10).
- Vigencia en la carta pública: el día se calcula UNA vez por pedido, en el borde (`cartaPublica`, con el `ahora` de la página y la zona de la empresa) y entra en la CLAVE del caché de la carta (`unstable_cache`): al cambiar el día cambia la entrada, así que la carta de ayer no se sirve hoy desde ese caché. El ISR de la página (`revalidate = 60`) puede servir la página de ayer hasta 60 s después de la medianoche: es la misma ventana que cualquier cambio que no pasa por una acción. — PROPUESTA.

## 8. Acceso e interfaces

**Menú (DEC-24), fuente única `core/carta/ui-config.ts`** (mismo molde que `core/stock/ui-config.ts`):

| Entrada | Ruta | Visible con | Panel | Pestañas (cada una con su clave de «Ver») |
|---|---|---|---|---|
| Carta | `/carta` | `algunaDe: [carta_ver, opcion_apagar_en_sucursal, carta_items_agrupados]` | Sucursal | **Hoy** (`/carta`, `carta_ver`; y `/movimientos/opciones-agotadas`, `opcion_apagar_en_sucursal`: la pestaña lleva a la primera que el rol puede abrir y se marca en las dos) · **Secciones y géneros** (`/carta/parametrizacion/secciones` y `/carta/parametrizacion/generos`, `carta_ver`) · **Ítems agrupados** (`/carta/agrupados`, `carta_items_agrupados`) |
| Promociones | `/carta/parametrizacion/promociones` | `carta_ver` | Ambos | **Promociones** · **Menú del día** (`/movimientos/menu-del-dia`, `promo_menu_del_dia`; SOLO con `MENU_DEL_DIA_VISIBLE`) |
| Apariencia y publicación | `/carta/parametrizacion/apariencia` | `algunaDe: [carta_tema, carta_portal]` | Ambos | **Tema** (`/carta/tema`, `carta_tema`) · **Portal** (`/carta/portal`, `carta_portal`, empresa) |

- `/carta`: guarda `requierePermisoVerDeAlguna` con las tres claves; sin `carta_ver` redirige a la primera pestaña que el rol ve (Opciones agotadas o Ítems agrupados). — PROPUESTA.
- `/carta/parametrizacion/apariencia`: guarda `requierePermisoVerDeAlgunaDelMenu` (tema es de sucursal, portal de empresa) y redirige a la primera pestaña que el rol ve. El tablero de dos enlaces queda reemplazado por las pestañas. — PROPUESTA.
- `/carta/parametrizacion`: el tablero de tarjetas queda reemplazado por las tres entradas; con `carta_ver` redirige a «Secciones y géneros». — PROPUESTA.
- Las dos «puertas» (Mantenimiento / Parametrización) se reemplazan por la fila de pestañas de cada entrada (filtrada en el servidor, como `FilaDeStock`); la barra azul conserva «Carta · <entrada> · <sucursal>». — PROPUESTA.
- La emulación pone también una pestaña «Apariencia» (`carta_ver`) que era el tablero de dos enlaces: no se agrega (sería un enlace a sí misma). — PROPUESTA.
- La fila interna de `/carta` (Hoy · Precios · Visibilidad, prototipo aprobado CARTA-MANT) se conserva; ver P-2.
- **Ver ≠ escribir (I2):** Tema: aviso «Solo lectura» y el editor y «Aplicar» deshabilitados (`fieldset disabled`). Portal: aviso, editor deshabilitado (sin arrastrar tarjetas) y la lista de sucursales como texto, sin «Agregar», «Editar» ni «Quitar». El servidor ya rechaza (`conPermiso("carta_tema")`, `conPermisoDeEmpresa("carta_portal")`). — PROPUESTA (molde de Stock).

## 9. Consultas y experiencia

- Vocabulario: «Carta › Hoy», «Carta › Secciones y géneros» en lugar de «Mantenimiento» y «Parametrización» en los textos de pantalla; el ítem «Carta pública» del menú (que abría la administración) pasa a «Carta». Las descripciones de `ACCIONES` viven en la base: no se tocan (P-5).
- Hoy: desde el nivel Hoy, un enlace «Opciones agotadas» (tamaños, guarniciones, extras); desde Opciones agotadas, «Platos enteros: Carta › Hoy» (cada enlace solo a quien puede abrirlo, `EnlaceInterno`).
- 375 px: la fila de pestañas pasa a otro renglón («envuelta») y se lee completa; nada desborda la pantalla.
- Carta pública: una promo fuera de su vigencia hoy no aparece (ni su sección si solo la tenía a ella), igual que en el POS.

## 10. Tabla «¿qué pasa si…?» por comando de escritura del módulo (existentes; esta ola no agrega ninguno)

| Comando | Repetición (doble clic) | Concurrencia | Tiempo / incertidumbre | Reintento | Error parcial | Datos faltantes | Cambio de permisos | Otra empresa / sucursal |
|---|---|---|---|---|---|---|---|---|
| Fijar disponibilidad de hoy (uno o varios) | Por estado: no escribe ni audita | Filas tomadas `FOR UPDATE` en orden de id: sin abrazo mortal | No vence sola (I4 del concepto) | Igual que repetición | Todo o nada, con auditoría | Producto inexistente → rechazo; activar un PV a $0 exige la clave fina | `conPermiso` en cada pedido | Eco de sucursal + RLS |
| Agotar / prender opción en la sucursal | Por estado | SERIALIZABLE | No vence sola («no se prende sola») | Igual | Una transacción | Opción inexistente → rechazo | `conPermiso("opcion_apagar_en_sucursal")` | Eco + RLS |
| Visible en carta / agregar / quitar producto | Por estado | Agregar/quitar SERIALIZABLE; visible sin transacción (último gana) | — | Igual | Agregar/quitar con auditoría en la misma transacción | Quitar con datos cargados pide confirmación | `carta_contenido_producto` | Eco + RLS |
| Sección: crear, activar, ordenar | Por estado | Ordenar SERIALIZABLE; activar último gana | — | Igual | Una escritura | Nombre vacío → validación | `conPermisoDeEmpresa("carta_secciones")` | RLS de empresa |
| Contenido, descuento, géneros, agrupados | Por estado (salvo descuento) | Último gana (sin versión) | — | Igual | Una escritura (contenido y descuento auditados) | Validación del guard | Su clave | Eco + RLS |
| Promo: guardar, cupos, lugares, vigencia, solo salón | Por estado | SERIALIZABLE; solo salón y vigencia con versión optimista (`VERSION_DESACTUALIZADA`) | Vigencia en días de la zona de la empresa | Igual | Una transacción con auditoría | Vigencia inválida → `VIGENCIA_INVALIDA` | `carta_promo_definir` (empresa) | RLS de empresa |
| Promo: prender en la sucursal / precio local | Prender: estado pedido; precio: optimista por precio visto | Precio SERIALIZABLE | — | Igual | Una escritura | — | `carta_promo_activar` / `carta_promo_precio_local` | Eco + RLS |
| Plato del día (con el interruptor prendido) | Por estado | SERIALIZABLE | Hasta 13 días de anticipación | Igual | Una transacción | Con el interruptor apagado el servidor rechaza | `promo_menu_del_dia` | Eco + RLS |
| Tema: guardar / aplicar | Por estado / estado pedido | Último gana | La carta lo toma en hasta 60 s o al revalidar | Igual | Una escritura | Tema vacío no se aplica | `conPermiso("carta_tema")` | Sucursal activa + RLS |
| Portal: apariencia, sucursal publicada, mover, agregar, quitar | Por estado (salvo mover y guardar sucursal) | Último gana; slug único por empresa | Igual | Igual | Una escritura | Slug inválido o tomado → rechazo | `conPermisoDeEmpresa("carta_portal")` | RLS de empresa |
| Copiar la carta de otra sucursal | Por estado (solo sobre carta vacía) | SERIALIZABLE | — | Igual | Todo o nada, auditado | Origen sin «Ver» → rechazo | `carta_copiar_de_sucursal` | Solo sucursales con membresía y «Ver» |

## 11. Decisiones PENDIENTES para el dueño (no se inventan; se avanza con lo no bloqueado)

- **P-1 (permisos, ratificado pero con la clave sin confirmar):** el 2026-10-20 (tarde) se decidió que quien solo tiene `producto_disponibilidad` vea Carta › Hoy y agote OPCIONES sueltas, pero NO platos enteros (eso pediría «el permiso de editar la carta»). Hacerlo cambia quién puede qué EN EL SERVIDOR: `fijarDisponibilidadDeHoy` pasaría a exigir además una clave de la carta (la emulación usó `carta_contenido_producto` «a confirmar») y `apagarOpcionEnSucursal` aceptaría `producto_disponibilidad`. Hoy el operador de la semilla agota platos enteros desde Catálogo › Productos. Pregunta: ¿qué clave es «editar la carta» para agotar un plato entero? Recomendación: `carta_contenido_producto`, en un paso propio con su matriz de acceso regenerada y declarada. PENDIENTE (esta ola no cambia permisos).
- **P-2 (experiencia):** dentro de Carta › Hoy queda la fila interna del prototipo CARTA-MANT (Hoy · Precios · Visibilidad). Pregunta: ¿se deja así o «Visibilidad» pasa a «Secciones y géneros»? Recomendación: dejarla hasta ver las capturas; mover Visibilidad es mudar un componente entero. PROPUESTA.
- **P-3 (URL):** mudar `/movimientos/opciones-agotadas` y `/movimientos/menu-del-dia` a `/carta/…`. Recomendación: no por ahora (igual que Stock). PROPUESTA.
- **P-4 (trazabilidad):** secciones, géneros, agrupados, tema y portal no dejan quién cambió qué. Recomendación: auditarlos (`registrarCambioAuditado`, sin migración) en un paso aparte. PENDIENTE.
- **P-5 (datos):** las descripciones de `ACCIONES` («Entrar a la pantalla Carta…») viven en la base; cambiarlas es una actualización de datos. Recomendación: con la próxima migración autorizada. PENDIENTE.
- **P-6 (vista previa del administrador):** la vista previa interna de la carta (`cargarAdminCarta`) muestra todas las promos prendidas sin mirar la vigencia (es la administración, no el cliente). Recomendación: dejarla. PROPUESTA.

## 12. Menú del día: lo que ya se puede hacer sin rediseño (instrucción del dueño del 2026-10-28)

«Si ya se puede resolver de una manera existente y lo otro es feature, hay que reconsiderar si es necesario el rediseño del menú del día.» Verificado en el código (y con el spec e2e `carta-plato-del-dia-sin-rediseno.spec.ts`, con el interruptor `MENU_DEL_DIA_VISIBLE` APAGADO):

**(a) Plato del día = un producto de venta común, fuera de carta.**
- Se crea como cualquier producto de venta (Catálogo › Productos › Nuevo), con su receta y su precio PROPIO. Si tiene variantes (carne o pollo, tamaño) se vende «Por opción» (ADR-035) con su grupo de opciones.
- Se deja DISPONIBLE en la sucursal y SIN contenido de carta: cae en «Fuera de carta (POS y menú del día)» (Carta › Hoy › Visibilidad, contador informativo). La carta pública NUNCA lo muestra (`resolverMenuCartaConDiagnostico` exige contenido visible de esta sucursal).
- El mozo lo encuentra en el POS, en la pestaña «Fuera de carta» del selector de la mesa (o con el buscador), y lo vende al precio del producto, con su receta descontando stock.
- «Solo hoy»: al terminar el día se lo marca «no disponible» (Catálogo › Productos, botón de disponibilidad de la sucursal, `producto_disponibilidad`). OJO: la disponibilidad NO vence sola; si nadie lo apaga, al día siguiente el mozo lo sigue viendo. Y un producto fuera de carta APAGADO desaparece de las listas de Carta › Hoy (la base no distingue «sin stock hoy» de «no se vende acá»): para volver a ofrecerlo se lo prende desde Catálogo › Productos.

**(b) Menú ejecutivo = una promo armada, «solo salón».**
- Promociones › nueva promo con su precio FIJO (el que el dueño pidió), lugares de SECCIÓN («elegí una de Bebidas») y/o de LISTA (productos sueltos, ESTÉN O NO en la carta, incluso el plato del día de (a); con una configuración fija si hace falta), y la casilla «Solo salón» (no sale en la carta pública, sí en el POS).
- La LISTA respeta la disponibilidad: un plato apagado hoy no se ofrece dentro del menú. Así funciona el «pozo de opciones» del dueño: se agregan entradas una vez y cada día se apaga lo que no hay (no hay que cargar nada nuevo cada día).
- Vigencia opcional: días de la semana (por ejemplo, lunes a viernes) y rango de fechas; el POS no la ofrece fuera de su vigencia (y desde esta ola, la carta pública tampoco, aunque una «solo salón» nunca sale ahí).

**Lo que de verdad NO se puede hoy (lo que queda como feature):**
1. Que el mozo elija la VARIANTE dentro del menú: un lugar de LISTA lleva una configuración FIJA por entrada (para «milanesa de carne o de pollo» hay que cargar dos entradas); un producto con grupo obligatorio sin configuración no entra.
2. Quitar productos puntuales de un lugar de SECCIÓN (toma toda la sección visible): el rodeo es una LISTA armada a mano.
3. Que «hoy» venza solo a la medianoche (la disponibilidad se apaga a mano).
4. Mostrar el plato del día en la carta pública (pregunta abierta del dueño: hoy NUNCA se muestra; si se quiere mostrar, se le da contenido de carta en una sección «Del día» y se apaga/prende).

**Recomendación:** MANTENER APAGADO el interruptor y NO hacer el rediseño GO-3d ahora: (a) + (b) cubren el planteo del 2026-10-22 salvo las variantes elegidas por el mozo (1). Si el dueño lo necesita, el cambio más chico que lo habilita es permitir, en un lugar de LISTA, una entrada SIN configuración fija cuyo producto tenga opciones, y que el POS pida la opción al agregar (reutiliza el diálogo de opciones de una línea suelta; sin migración, porque la configuración ya es opcional en `EntradaDeCupo`); se diseña aparte, con su tabla «¿qué pasa si…?», cuando aparezca un caso real. El vencimiento a medianoche (3) sería un dato nuevo (migración): solo si el uso lo pide.

## 13. Escalera de producto (lo que ve el cliente y el encargado), N0 a N5

| Nivel | Carta (Hoy, Secciones, Agrupados) | Promociones | Apariencia y publicación |
|---|---|---|---|
| N0 | Pantallas sueltas detrás de dos «puertas» (hoy) | Tablero › Promociones (hoy) | Tema y Portal sueltos (hoy) |
| N1 (esta ola) | Una entrada con pestañas; Opciones agotadas dentro de Hoy | Una entrada; la carta pública respeta la vigencia | Una entrada con pestañas; quien solo ve no puede tocar |
| N2 | Agotar platos con la clave de la carta (P-1); Visibilidad junto a Secciones (P-2) | Variante elegida por el mozo dentro de un menú (sección 12) | Auditoría de tema y portal (P-4) |
| N3 | Plato del día visible en la carta pública como sección «Del día» | Lugar de sección con exclusiones | Vista previa de la carta pública desde la pantalla |
| N4 | Carta en inglés (idea) | Pop-up de promociones (idea) | Imágenes de platos (idea) |
| N5 | «Forzar forma», diccionario de palabras fijas (ideas) | Precio por opción del menú (descartado por ahora: precio fijo) | — |

Lo que falta se muestra «pendiente de completar» / «Sin cargar», nunca inventado. La escalera de diseño y la de producto se cruzan en el nivel 5 (I2 e I4).

## 14. Pruebas, migración y operación

- **Migración:** ninguna. Despliegue: solo código; reversible con `git revert`.
- **Unitarias/integración:** configuración del menú de Carta (tres entradas, pestañas, rutas de cada entrada, resaltado, panel, buscador, cambio de sucursal); pestaña con dos pantallas (Hoy); la vigencia en la carta pública con la hora de Argentina y bordes de medianoche (23:59:59 y 00:00:00 ART, primer y último día del rango, día de la semana), con mutación (mutar ⇒ rojo ⇒ revertir ⇒ verde); la promo «solo salón» sigue fuera.
- **Arquitectura:** `menu-con-permiso` (entradas `algunaDe` con su guarda); golden de visibilidad del menú (`test/modulos/__golden__/empresa-principal.json`) regenerado con `GOLDEN_ACTUALIZAR=1`; línea de base de precio y carta (`REGENERAR_LB_PRECIO_Y_CARTA=1`) y caracterización del tramo A, si cambian, con regeneración declarada en `caracterizaciones-congeladas.test.ts`.
- **e2e (Playwright):** navegación de las tres entradas y sus pestañas; Tema/Portal en solo lectura; el recorrido del menú del día sin rediseño (sección 12) con su mutación; accesibilidad (axe) en las pantallas tocadas; 375 px sin desborde.
- **Capturas** a 375 y 1280 px para la aprobación del dueño (fuera del repositorio).

## 15. Pasos (un commit cada uno)

1. Este documento.
2. Fuente del menú de Carta (`core/carta/ui-config.ts`) y menú de tres entradas con sus rutas de una entrada; guardas de las entradas; tests del menú; golden del menú.
3. Fila de pestañas (`FilaDeCarta`) en lugar de las dos puertas; tableros reemplazados por redirecciones; enlaces Hoy ↔ Opciones agotadas.
4. Ver ≠ escribir en Tema y Portal.
5. Vocabulario («Carta › Hoy», «Secciones y géneros»).
6. Vigencia de las promos en la carta pública (lectura, día de la zona de la empresa, clave de caché) con pruebas de borde y mutación.
7. e2e: navegación, solo lectura, menú del día sin rediseño (con mutación); accesibilidad; capturas.
8. Cierre: los 8 comandos del gate.
