# Diseño — Secciones de la carta como lista simple, igual que Pedernal — 2026-11-16

Estado: **etapa de pantalla autorizada (Fase 2 del Frente 6)**. Sin migración, sin tablas nuevas, sin acciones de servidor nuevas. Método: escalera de diseño (niveles 1 a 5 abajo; 6 no aplica).

## Pedido y aceptación (niveles 1 y 2)

- **Pedido (CONFIRMADA):** «las pantallas de pedernal, son con menos datos y más justas...» (dueño, 2026-11-16).
- **Decisión (CONFIRMADA):** «Lista simple como Pedernal (Recomendada)» (dueño, 2026-11-16, registrada en `motor2-docs`): lista simple (nombre, orden, activar/desactivar, «Nueva sección»); al tocar una sección se abre su pantalla con sus datos (título, descripción, imagen) y sus productos; la ficha de carta de cada producto vive en la ficha del producto; **no se pierde ningún dato ni función**.
- Actores: quien gerencia o administra la carta (`carta_secciones`, de la empresa) edita; quien solo ve (`carta_ver`) mira.

## Qué cambió (nivel 8, interfaz)

| Antes | Ahora |
|---|---|
| Una sola página con: la lista, un formulario por cada sección (nombre, título, descripción, imagen, orden), «Nueva sección» y la ficha de cada producto de la carta, agrupada por sección (413 palabras, 75 campos y 44 botones al entrar con la carta real de Huinganco) | `/carta/parametrizacion/secciones`: la lista (con «Ordenar» y «⋯», como antes), «Nueva sección de carta» y, plegados, los productos que no están en ninguna sección |
| Los datos de cada sección, apilados | `/carta/parametrizacion/secciones/[id]`: sus datos (los mismos cinco campos, «Guardar sección», «Apagar/Prender») y la lista de SUS productos |
| La ficha de carta de cada producto, dentro de la lista | Cada producto es un enlace a `/catalogo/productos/[id]/en-la-carta` (la ficha ya existía ahí; no se tocó) |

Las dos pantallas usan las acciones de siempre (`guardarSeccionCarta`, `actualizarActivaSeccionCarta`, `ordenarSeccionesCarta`) y los mismos permisos: **no hay código de servidor nuevo**. «⋯ › Cambiar el nombre y los datos» ahora abre la pantalla de la sección. No se tocó `src/app/(app)/catalogo/productos/[id]/**` (ficha del producto: tarjeta Ocultar, otra sesión).

## Invariantes y políticas (nivel 5)

1. El servidor decide el permiso al guardar; la pantalla solo ofrece o esconde (sin `carta_secciones`: datos como texto, sin campos ni botones).
2. El id de la URL es lo único que viene del navegador; una sección ajena o inexistente da «no encontrada» (la base filtra por empresa).
3. Nada se borra: apagar es reversible; los productos siguen apuntando a su sección.
4. Todo nace cerrado: no se agrega ningún permiso, opción ni dato nuevo.

## Tabla «¿qué pasa si…?» (nivel 7)

| Si… | Guardar datos de la sección | Apagar / prender | Ordenar (lista) | Abrir la pantalla `[id]` |
|---|---|---|---|---|
| Repetición (doble clic) | Mismos datos, misma fila: un solo resultado, sin duplicar (probado con `dblclick`) | Manda el estado destino visto al abrir (no «alternar» en el servidor): dos clics mandan lo mismo y el resultado es el mismo | `ordenarSeccionesCarta` compara contra el orden visto (todo o nada) | Solo lee |
| Concurrencia (dos personas) | Gana el último guardado (las secciones no llevan versión: comportamiento de antes, sin cambio) | Igual | Si otra persona cambió el orden, «Recargá la pantalla» (ya existía) | Solo lee |
| Tiempo | — | — | — | — |
| Incertidumbre / reintento | El aviso del servidor se muestra en la misma pantalla; reintentar es seguro (mismos datos) | Reintentar es seguro | «Deshacer» manda el orden anterior contra el visto | Recargar es seguro |
| Error parcial | Una sola escritura: todo o nada | Una sola escritura | Todo o nada | — |
| Datos faltantes | Nombre vacío/repetido: lo rechaza el servidor con su mensaje de siempre | — | — | Sección sin productos en la sucursal: «Todavía no tiene productos en esta sucursal.»; id inexistente: «no encontrada» (404) |
| Cambio de permisos | El servidor vuelve a decidir; si lo perdió, el aviso de permiso | Igual | Igual | Sin `carta_ver`: no entra |

## Qué se verificó y qué NO

- **Verificado (local, base descartable):** `tsc`, `eslint`, `npm run arquitectura`, `knip` (con el entorno de e2e cargado), `vitest` de `test/arquitectura` y `test/navegacion`; Playwright en modo dev: `carta-seccion-pantalla` (nuevo: lista sin formularios apilados, abrir, editar con doble clic, apagar/prender, 404, 375 y 1366 px sin desborde, axe en 0), `carta-solo-ver`, `carta-admin`, `carta-ordenar-secciones`, `form-con-resultado-enter`, `movil-sin-desborde`, `maquetacion-general`, el tramo «carta» de `accesibilidad` y `linea-de-base-precio-y-carta` (regenerada).
- **NO verificado:** `carta-orden-sugerido` y la primera prueba de `carta-descuento-producto` se editaron para la nueva ruta pero **se saltean solas** (interruptores `GENERO_E_ITEM_AGRUPADO_VISIBLE` y `DESCUENTO_POR_PRODUCTO_VISIBLE` apagados): no corrieron. No corrí `npm test` completo, `npm run build`, `plataforma:build` ni el e2e completo (el gate lo corre el «CI casero»).
- **Zona restringida tocada, a integrar por turno:** `test/e2e/linea-de-base-precio-y-carta.golden.txt` regenerado y una entrada nueva en `test/arquitectura/caracterizaciones-congeladas.test.ts` (blob `5f96a74d…`, padre `4b8db032`: **si el commit padre cambia al integrar, hay que actualizar ese campo**).
- **Textos nuevos (hardcodeados, como el resto de esta pantalla; pasan por T1 en el lote del orquestador general):** «‹ Secciones de la carta», «Productos de esta sección», «Sección apagada: no sale en la carta.», «Todavía no tiene productos en esta sucursal.», «Fuera de carta» (ya existía en Carta › Hoy › Visibilidad), «Productos fuera de las secciones» y la frase «Tocá una sección para ver sus datos y sus productos.». Se reusaron «Guardar sección», «Apagar/Prender «X»», «Nueva sección de carta», «Cambiar el nombre y los datos».

## Sugerencias (no implementadas)

- «Nueva sección de carta» sigue con sus cinco campos (nombre, título, descripción, imagen, orden); Pedernal pide solo el nombre. Si el dueño lo pide, se reduce a un campo y el resto se completa en la pantalla de la sección.
- Fila de la lista entera tocable (hoy solo el nombre es el enlace).
