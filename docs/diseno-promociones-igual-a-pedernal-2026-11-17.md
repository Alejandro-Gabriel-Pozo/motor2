# Diseño: el armado de promociones igual a Pedernal — 2026-11-17

Estado: **solo documento** (sin código, sin migración). Leído contra `main` 859408c8 (Motor2) y la documentación vigente de Pedernal (ZuluHub-docs `552042f`). Estados: **CONFIRMADA** (lo dijo el dueño, con fecha), **RELATADA** (la anotó una sesión de diseño; el dueño puede corregir), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

Pedido del dueño (2026-11-17, relatado por el orquestador padre): «El armado de promoción sigue siendo el viejo, entonces no está aplicado»; «creo que ya está el diseño y creo que lo debes haber podido ver en novedades para Motor 2». Regla de paridad: `AGENTS.md`, «Paridad con Pedernal» (2026-11-13).

Capturas (pantalla real de Motor2, datos de la base de demostración: promo «Menú ejecutivo» $ 55.000, solo salón, cupo «Entrada» 0 a 2; **no son datos reales de producción**) y maquetas de Pedernal: `motor2-docs`, `_coordinacion/capturas-pantallas-2026-11-16/promociones-lectura/` (`promociones-motor2-375.png`, `promociones-motor2-1366.png`, `pedernal-maqueta/`).

## 0. Hallazgo principal (lenguaje de proceso)

1. **Lo que el dueño ve como «el armado viejo» es la pantalla que ya tiene un diseño confirmado y no construido en Motor2**: `docs/diseno-promo-parte-de-seccion-2026-11-11.md`, etapas **E2a** (comando) y **E2b** (pantalla). Las etapas de núcleo y servidor (E1a, E1b: #230, #237) sí están en `main`; la pantalla de la administración, no.
2. **Pedernal pide algo más que esa pantalla**: un armado «por componentes» (lista de lo que lleva, «Agregar componente», «Cómo lo ve el cliente», «Reparto del precio», Activo/Pausado). Casi todo eso se puede mostrar con los datos que Motor2 ya guarda. Lo que sí cambiaría el modelo es chico y está nombrado en §3.
3. **La mitad de lo que Pedernal «pide» ya es igual en Motor2** (vigencia a mano, sin descuentos, sin recargos, repetir plato, reparto proporcional, solo salón). Ver §1.
4. Las filas de Pedernal sobre «lugares del combo» (fila 230 de `novedades-para-motor2.md`) están **RELATADAS** y su maqueta (`promos-lugares-propuesta.html`) dice «Propuesta, no aprobada»: no se construye nada de ahí hasta que el dueño las confirme.

## 1. Tabla: qué pide Pedernal / qué hace Motor2 hoy / diferencia / de quién es

«De quién es»: **Pantalla** = frente 6 (yo, solo pantalla con los datos que ya hay, tras un interruptor reversible). **Modelo** = necesita escalera de diseño 1 a 10 y turno de schema: no se construye acá, se pasa al orquestador padre. **Igual** = ya está igual; no hay trabajo.

| # | Qué pide Pedernal (fuente, estado) | Qué hace Motor2 hoy — pantalla | Qué hace Motor2 hoy — modelo | Diferencia | De quién es |
|---|---|---|---|---|---|
| 1 | Vigencia **a mano**, sin fechas (NOV 227, CONFIRMADA: «No por ahora») | «No tiene fechas: se maneja con activar y desactivar» (`promociones/page.tsx:82`) | Columnas de vigencia en el schema, **retiradas del código** el 2026-11-13 (#260) | Ninguna | **Igual** |
| 2 | **Sin descuentos automáticos** (NOV 227, CONFIRMADA: «A: no») | No hay | No hay (el descuento por producto está apagado: `DESCUENTO_POR_PRODUCTO_VISIBLE=false`) | Ninguna | **Igual** |
| 3 | «Cupo» = **un lugar del combo** (NOV 227, CONFIRMADA: «Un lugar del combo») | La pantalla llama «Cupos» a las partes y muestra «mín.» y «máx.» por sección | `PromoCartaCupo` = parte de la promo (SECCION o LISTA) | **Solo el nombre**: la pantalla dice «cupo» donde Pedernal dice «lugar» / «componente» | **Pantalla** (texto) |
| 4 | Lista «Combos»: «Hamburguesa Funghi + 1 de Bebidas a elección · Activo — $ 14.000,00» (`combos.html`, aprobada 09/11) | Cada promo es un `<details>` con un resumen largo: «título · precio · sección · prendida acá · solo salón · Armable — N cupos» | Los datos salen de `PromoCarta` + cupos + entradas | La fila no dice **qué lleva**; mezcla estados técnicos | **Pantalla** |
| 5 | «Qué lleva»: lista de componentes con «Quitar» y «Agregar componente» (producto fijo / a elegir en una sección) con **cantidad 1 a 9** | Una **casilla con mín./máx. por cada sección de la carta** (en la captura: 14 secciones apiladas), más «Sumar un lugar (opcional)» con «Tipo / Nombre / mín. / máx.» | Una parte = una fila de `PromoCartaCupo`; «producto fijo» = lista con una entrada FIJA y mín = máx | La pantalla pide tildar entre todas las secciones y poner rangos; Pedernal pide **ver lo que lleva y sumar de a un componente** | **Pantalla** (la forma). La cantidad exacta es una pregunta: ver §4 |
| 6 | «Cómo lo ve el cliente»: «Combo Barbacoa $ 13.500,00 — Hamburguesa Barbacoa + 1 de Bebidas a elección» | No existe | Se puede derivar de los cupos y entradas | Falta la línea «así se lee en la carta» | **Pantalla** (solo lectura) |
| 7 | «Reparto del precio»: cada componente con su parte y su precio de lista (`combos__armado.png`; «en proporción al precio de lista», dueño 12/11, CONFIRMADA) | No existe (solo el aviso «peor caso» y el piso $ 0,01 por unidad) | El prorrateo ya existe y es proporcional al precio de lista (`src/core/pos/promo-combo.ts`, mayor residuo, suma exacta) | Falta **mostrarlo** al armar. Hay que verificar que la función sea pura y reusable sin una cuenta abierta (**NO VERIFICADA**) | **Pantalla** (solo lectura), si la función es reusable; si no, pasa a Modelo/servidor |
| 8 | Interruptor **«Activo / Pausado»** | Botones «Prender/Apagar «T» en esta sucursal» y «… en toda la empresa» | `PromoCarta.activa` (empresa) y `PromoCartaSucursal.activa` (sucursal) | Palabras; Motor2 además distingue empresa y sucursal (regla ya existente, no se toca) | **Pantalla** (texto) |
| 9 | **Cada lugar admite una lista de platos y, por plato, una opción predefinida** (NOV 230, RELATADA) | «Sumar un lugar» + tildar platos en **otro bloque**, más abajo; por plato «Vienen fijas» / «El mozo elige» | `EntradaDeCupo` con `modoDeOpciones` FIJAS / A_ELEGIR y `OpcionDeEntradaDeCupo` | **El modelo ya lo permite.** Falta la pantalla del diseño 2026-11-11 (fila de sección con «Toda la sección / Solo estos platos» y el tildado en la misma fila) | **Pantalla + comando** (E2a/E2b, ya CONFIRMADO el 2026-11-11, sin tablas nuevas) |
| 10 | La promoción puede **fijar la medida del lugar** (ej. «Café mediano»; NOV 230, RELATADA; maqueta «no aprobada»; el texto «Medida» figura «sin fuente») | No existe | No existe una columna de medida del lugar. La opción fija de la entrada (FIJAS) cubre el caso «el café, tamaño mediano», pero no hay «medida» como concepto del lugar | Concepto nuevo, **no confirmado por el dueño** | **Modelo** (o nada: ver §4) |
| 11 | **Sin recargos** dentro de la promoción (E8 §11.1, RELATADA) | Los adicionales no entran en una promo de precio fijo («es un adicional: no entra») | Regla del servidor | Ninguna | **Igual** |
| 12 | **Cantidad exacta N** por lugar, 1 a 9 (NOV 230, RELATADA: «P1 exactamente») | «mín.» y «máx.» (0 a 999; el 2x1 se hizo con «de 0 a 2», CONFIRMADO 2026-11-11) | `cantidadMinima` / `cantidadMaxima` | **Regla distinta**: rango vs. exacta. Cambia qué puede vender el mozo | **Modelo/reglas**: pregunta única de §4 |
| 13 | **Se puede repetir plato** (NOV 230; PROMO C-4, RELATADA) | Se acepta: «el mozo puede elegir el mismo plato dos veces» (CONFIRMADO 2026-11-11, P1) | `promo-combo.ts` | Ninguna | **Igual** |
| 14 | Combos con **«Versión N» / «Guardar versión»** | «Guardar promo» y «Guardar cupos»; la promo tiene `version` solo como control de concurrencia | `PromoCarta.version` (control optimista); historial de versiones **NO VERIFICADO** | La versión como concepto visible y su historial es de Pedernal | **Modelo** (si el dueño lo pide) |
| 15 | **«Ocultar en este local»** un producto elegible (agotado); «No disponible — falta stock» calculado | La entrada se «saca» o «vuelve a ofrecer» para **toda la empresa** | `EntradaDeCupo.activa` (sin dimensión sucursal) | Lo oculto por local y la disponibilidad por stock no existen en la promo | **Modelo** |
| 16 | Componente «a elegir en una **categoría** / **grupo de precio**» (`combos.html`; «parqueado», NOV 189 / PP-6) | No existe | No existe | Parqueado por Pedernal mismo | **Nadie** (no se construye) |
| 17 | Alícuotas mezcladas: pendiente del contador (E8 PP-1) | Se rechaza (`COMBO_ALICUOTAS_DISTINTAS`) | Regla del servidor | Ninguna | **Igual** |
| 18 | Numeración «Bebidas 1 / Bebidas 2» en la hoja de elecciones del POS (NOV 189, aprobada por delegación) | No aplica a esta pantalla (es el POS) | — | Es la pantalla de **venta**, no del armado | Fuera de esta tarea (frente POS) |

## 2. Lo que es solo pantalla (mío) y lo que cambia el modelo (del padre)

**Solo pantalla** (sin tablas nuevas, sin cambiar qué se puede vender), detrás de un único interruptor reversible `ARMADO_DE_PROMO_COMO_PEDERNAL` (valor inicial `false`: la pantalla actual no cambia hasta que se prenda):
- P1. Fila de la lista: «título — componentes · Activo/Pausado — $ precio» (fila 4 y 8).
- P2. «Qué lleva»: la lista de lo que la promo ya lleva (partes con su rango tal como están hoy, «de 0 a 2»), con «Quitar», en lugar de la pila de casillas; «Agregar componente» elige una sección o una lista (fila 5).
- P3. «Cómo lo ve el cliente» (fila 6) y «Reparto del precio» (fila 7, si la función es pura).
- P4. «Lugar» / «componente» en vez de «cupo» (fila 3).
- P5. **E2b ya confirmado** (fila 9): «Toda la sección / Solo estos platos» en la fila. Necesita antes **E2a** (comando `guardarParteDePromo`, transacción, auditoría, sin tablas). Lo propongo como **segundo paso**, no en el primero, para no mezclar.

**Cambia el modelo (no se construye acá; lo paso al padre)**: fila 10 (medida del lugar), fila 12 (cantidad exacta, si el dueño la confirma como regla), fila 14 (versiones), fila 15 (ocultar por local, disponibilidad por stock). Cada una necesita sus niveles 1 a 5 confirmados antes de tocar tablas (`AGENTS.md`, «Diseño de módulos»). Ninguna tiene hoy el pedido textual del dueño en Motor2: las filas 10, 12 y 15 de Pedernal están RELATADAS, y la regla «lo que el dueño no pidió no entra» manda.

## 3. Escalera de diseño de la parte de pantalla (niveles relevantes)

- **Nivel 1, necesidad:** «El armado de promoción sigue siendo el viejo» (dueño, 2026-11-17, vía padre) + paridad con Pedernal (2026-11-13) + el diseño del propio Motor2 del 2026-11-11 (E2b). Alcance: solo lo de P1 a P4 en el primer paso.
- **Nivel 5, invariantes:** (a) la pantalla nueva **escribe lo mismo** que la vieja, por el mismo comando `guardarCuposPromoCarta` (SERIALIZABLE, piso de $ 0,01, «llevar al estado»); no se agrega un camino de escritura. (b) Todo nace cerrado: una promo nueva no trae componentes tildados; agregar un componente es un acto explícito. (c) Lo existente no se rompe: un rango «de 0 a 2» ya guardado se muestra tal cual, no se convierte.
- **Nivel 7, concurrencia/idempotencia:** sin cambios en el servidor, por lo tanto ya cubiertos (versión esperada y «llevar al estado»); la prueba existente del doble clic en «Guardar cupos» (`carta-promo-cupos-lista.spec.ts`) debe seguir verde con el interruptor prendido y apagado.
- **Nivel 8, permisos:** los mismos (`carta_ver` para ver, `carta_promo_definir` para armar, `carta_promo_activar` para prender en sucursal). Sin permiso, solo lectura, como hoy.
- **Nivel 10, pruebas y combinaciones:** dimensiones que cambian lo mostrado: interruptor (2) × permiso de definir (2) × promo con/sin partes (2) × solo salón (2) × activa/pausada (2). Oráculo escrito aparte del código en el test de la etapa; e2e a 375 px y escritorio con axe.

## 4. UNA pregunta para el dueño (vía el padre)

**Cantidad exacta o rango.** Pedernal (fila 230, relatada) pide **una sola cantidad N por lugar** («exactamente»). Motor2 hoy guarda **de mín. a máx.** y el dueño confirmó el 2026-11-11 que «de 0 a 2» sirve para un 2x1. Ejemplo con el «Menú ejecutivo» de la captura: la Entrada hoy es «de 0 a 2» (el mozo puede no elegir entrada, o elegir una, o dos). Con Pedernal sería «2»: el mozo **tiene** que elegir dos. ¿En Motor2 la pantalla de armado pide **una sola cantidad N** (y se guarda mín = máx = N), o **sigue con «de mín. a máx.»**? Hasta que responda, la pantalla del primer paso muestra el rango como está y no cambia esa regla.

## 5. Lo que queda sin verificar

- La función de reparto (`promo-combo.ts`) como pieza pura reusable en la administración (fila 7).
- Historial de versiones de la promo (fila 14) y disponibilidad por stock en promos (fila 15).
- Las citas literales del dueño en Pedernal salen de `novedades-para-motor2.md`, `e8-combos-especificacion.md` y `promociones-cupos-y-vigencia-diseno.md`; `decisiones-del-dueno-2026-11.md` no se leyó.
- Detalle interior de `promos-lugares-propuesta.html` (solo la cabecera: «Propuesta, no aprobada»).
