# ADR-034: Mantenimiento de la carta (lo que sale en la carta pública, por sección; «Fuera de carta» no es un faltante)

> Redactado el 2026-10-14 (rama `carta-mantenimiento`, nacida de `main` en `2f54899`). **Estado: F1 implementado en el código, sin migraciones ni cambios de esquema; F2 a F4 en curso (se agregan abajo).** Especificación: el prototipo aprobado «Mantenimiento / Parametrización» de la carta (pestañas «Mantenimiento» —niveles Hoy, Precios y Visibilidad— y «Parametrización» —Secciones, Géneros, Agrupados, Promociones, Apariencia y publicación—). Las pestañas «Factura prov.» y «Cobro» del mismo prototipo no son parte de este trabajo.

## Contexto

`/carta` era una página larga con todos los formularios apilados. En el celular del dueño, debajo de las secciones, aparecía un recuadro ámbar «PV disponibles acá sin contenido de carta (no salen en la carta)» con unos 30 productos (entre ellos «Adicional - papas fritas y huevo frito»), como si fueran un pendiente.

> Decisión del dueño (2026-10-14): esos productos **no son un pendiente**: son los platos del MENÚ DEL DÍA y lo que se vende solo en el POS, que **nunca** salen en la carta pública (lo que sale en la carta lo ve el cliente; el menú del día no se publica porque hasta que se cocina no se sabe).

## Decisión (F1)

1. **El estado por defecto de un producto de venta sin contenido de carta es «Fuera de carta (POS y menú del día)»** y no se avisa como faltante: el recuadro ámbar desaparece. La pantalla se centra en lo que SÍ sale en la carta: los productos de la sucursal **agrupados por sección** (plegadas, «tocá una sección para ver sus productos»), con los ocultos sin sección y los que están dentro de un ítem agrupado en grupos propios; abajo, plegado, el contador «Fuera de carta (POS y menú del día): N» con buscador (sin acentos ni mayúsculas, todas las palabras) y **«Agregar a la carta» de un toque** (se elige la sección).
2. **El ancla de un adicional** (el producto de respaldo, `OpcionDeGrupo.productoId`; ADR-030, D-1) **no figura en ninguna lista** de la carta, aunque un dato viejo lo tenga disponible o con contenido; y «Agregar a la carta» lo rechaza (`ES_ANCLA_DE_ADICIONAL`).
3. **En qué lista va cada producto lo decide una función pura**, `organizarCartaParaMantener` (`src/core/carta/mantenimiento.ts`), con una prioridad cerrada: ancla → ninguna; dentro de un agrupado de la sucursal → «dentro de un ítem agrupado»; con contenido con sección → esa sección (aunque hoy no esté disponible: «sin stock hoy» no es «fuera de carta»); con contenido sin sección → «ocultos, sin sección»; sin contenido y disponible acá → «Fuera de carta»; sin contenido y no disponible → ninguna. La lee `cargarCartaParaMantener` (`src/server/consultas/carta/mantenimiento.ts`, cuatro consultas para todo el lote, filtradas por la sucursal y con la RLS por sucursal por debajo).
4. **«Agregar a la carta»** es la acción `agregarProductoALaCarta` (`src/server/actions/carta/mantenimiento.ts`) → caso de uso `agregar-producto-a-la-carta.ts`:
   - **clave existente**: `carta_contenido_producto` (sucursal). No hay claves nuevas: una clave nueva necesita una migración de datos (las filas de `Accion` y de `PermisoRol`), y este trabajo no toca el esquema ni escribe migraciones;
   - **eco de la sucursal** primero (la que vio la pantalla tiene que ser la activa) y escritura SOLO en la sucursal activa;
   - **nunca pisa** un contenido existente: si ya está visible en esa sección es éxito sin cambio (idempotente: repetir no duplica ni audita); si existe de otra forma (otra sección u oculto), `YA_TIENE_CONTENIDO` (se cambia desde su ficha); `create`, nunca `upsert`;
   - **queda al final** de la sección, contando productos e ítems agrupados de ESTA sucursal (`ordenAlFinalDeLaSeccion`, con el tope de `validarOrdenCarta`); en una sección apagada no (`SECCION_APAGADA`);
   - **SERIALIZABLE** con el reintento por choque de único: dos «agregar» a la vez del mismo producto dejan UNA fila y UNA auditoría;
   - **auditoría** nueva: `ContenidoCartaProducto`, `entidadId` `${sucursalId}:${productoId}`, `campo: "visibleEnCarta"`, de `null` a `true`, con la sucursal.

### Decisiones declaradas en F1 (no estaban en el prototipo; se eligió lo más simple)

- El prototipo es anterior a la decisión del «Fuera de carta»: el bloque plegado, su buscador y el «Agregar a la carta» siguen su estética (tarjetas con borde, filas de 44 px, botones de un toque), sin pantalla aparte.
- «Agregar a la carta» **no tiene «Deshacer»**: deshacer sería borrar el contenido (nada se borra) u ocultarlo (y el producto dejaría de estar «fuera de carta» para pasar a «oculto»). Si se agregó por error, se oculta o se le cambia la sección desde su ficha.
- Las fichas de contenido de cada producto (descripción, tags, ★, género, orden y el descuento) quedan como estaban, adentro de su sección. Un producto con contenido que hoy no está disponible en la sucursal se lista sin ficha («no disponible en esta sucursal»): la ficha la lee `cargarAdminCarta`, que solo trae los disponibles y es una caracterización congelada que no se cambia.
- El aviso «Visibles pero sin sección de carta activa» y el del stock teórico en 0 (GO-2d) siguen: esos sí son problemas de lo que se muestra.

## Consecuencias

- Cambian a propósito los e2e que dependían del recuadro ámbar o de la ficha de un PV sin contenido (`carta-admin`, `accesibilidad`, `carta-orden-sugerido`) y los que abren la ficha de un producto, que ahora está adentro de su sección plegada (`carta-solo-ver`, `carta-descuento-producto`).
- `DatosAdminCarta.sinContenido` sigue en la caracterización congelada de `cargarAdminCarta` (no se regenera), pero la pantalla ya no lo usa.

Evidencia y mutaciones: filas O.480 y siguientes del bloque «// CARTA-MANT» de `docs/pureza-integracion.md`.
