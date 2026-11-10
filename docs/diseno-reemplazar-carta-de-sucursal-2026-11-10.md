# Diseño: «Reemplazar con la carta de otra sucursal» (2026-11-10)

Estados: **CONFIRMADA** (la dijo el dueño), **PROPUESTA** (la propone el ingeniero; el dueño la corrige), **PENDIENTE**, **NO VERIFICADA**, y **VERIFICADA EN CÓDIGO** (se miró el código/esquema real, no un documento).

## N1 · Propósito y alcance

- **Necesidad** (quién y dónde está escrita): pedido del dueño, 2026-11-10 — «Copiar de otra sucursal» solo funciona sobre una carta VACÍA (`copiar-carta-de-sucursal.ts`: «Esta sucursal ya tiene carta propia: solo se puede copiar sobre una carta vacía»). El dueño configuró cosas en la sucursal destino y no puede copiar. Eligió la opción **REEMPLAZAR**. — CONFIRMADA.
- La copia sobre carta vacía sigue exactamente igual (mismos textos, misma auditoría, mismo permiso). — CONFIRMADA (pedido del dueño).
- Forma más barata (regla «primero la opción más barata»): se reutiliza el caso de uso de la copia y sus tres funciones de escritura; no se crea tabla, columna ni permiso. **Sin migración.** — VERIFICADA EN CÓDIGO (ver N6).
- La descripción del permiso `carta_copiar_de_sucursal` («…solo sobre una carta vacía») NO se cambió: está duplicada en una migración de datos y cambiarla exigiría una migración (no autorizada). Queda anotado como pendiente cosmético.
- Fuera de alcance: «deshacer» en pantalla, reemplazo parcial (solo géneros, solo productos), reemplazar promos/cupos/tema/secciones. — CONFIRMADA por omisión (el dueño no los pidió).

## N2 · Actores y contexto

- Actor: quien tiene `carta_copiar_de_sucursal` con nivel «editar» en la sucursal ACTIVA (el mismo permiso que la copia; **no se crea clave nueva**). — PROPUESTA.
- El destino es SIEMPRE la sucursal activa del contexto (`ctx.sucursalId`), nunca un parámetro. — VERIFICADA EN CÓDIGO (es lo que hace la copia hoy).
- El origen: otra sucursal ACTIVA donde el actor tiene membresía vigente y `carta_ver` (`leerOrigenDeCopia`, S-07/O.56). El origen NO se modifica (solo se lee, con el alcance ensanchado a su lectura, M.3-A5). — VERIFICADA EN CÓDIGO.

## N3 · Casos de uso

1. **Reemplazar la carta de la sucursal activa con la de otra** (el comando nuevo).
2. Copiar sobre carta vacía (existente, sin cambios).
3. Ofrecer en pantalla de dónde reemplazar (consulta existente `origenesDeCopiaVisibles`, ahora también cuando el destino YA tiene carta).

## N4 · Conceptos y ciclo de vida

«Carta propia» de una sucursal = sus filas de `GeneroCarta`, `ItemAgrupadoCarta` (+ `OpcionItemAgrupadoCarta`) y `ContenidoCartaProducto`.

**Qué se reemplaza** (lo mismo que hoy se copia). — PROPUESTA, verificada contra el caso de uso actual:

| Se reemplaza en el destino | Se toca |
|---|---|
| Géneros (`GeneroCarta`: nombre, orden, activo) | borra los del destino y copia los del origen |
| Ítems agrupados + opciones | ídem |
| Contenidos de producto (visible, sección, descripción, tags, ★, orden, género, «mostrar nombre arriba», nombre en carta) | ídem |

**Qué NO se toca**: promos, cupos, secciones (son de la empresa), tema/portal, descuentos de producto, disponibilidad, precios locales, recetas, menú del día, combos, stock, ventas; ninguna otra sucursal; y el ORIGEN. — PROPUESTA.

**Regla del nombre en carta** (regla del dueño 2026-11-04, ya implementada en la copia): si una promo del destino ya se llama igual que un «Nombre en la carta» del origen, ese nombre NO se copia (el plato sale con el de su producto) y se informa. Se aplica igual en el reemplazo (las promos del destino no se tocan). — VERIFICADA EN CÓDIGO.

**«Ya es igual»** (para la idempotencia): la carta del destino es igual a lo que se copiaría cuando, comparando por CONTENIDO (no por ids; los géneros por nombre —única por sucursal—, los ítems agrupados por nombre —única por sucursal—, los contenidos por producto —única por sucursal—), coinciden todos los campos copiables, sus opciones y el reapuntado de género, incluida la regla del nombre en carta. Es el mismo criterio que usa la fila resultante, así que repetir el pedido con el origen sin cambios no escribe ni audita. — PROPUESTA.

**Destino vacío**: reemplazar sobre una carta vacía se comporta como copiar (no hay nada que eliminar). La pantalla igual ofrece «Reemplazar» solo cuando el destino tiene carta; la copia normal, cuando está vacío. — PROPUESTA.

## N5 · Invariantes y políticas

- **Nada que sea dinero, stock o comprobante se borra.** Verificado en el esquema real (`prisma/schema.prisma`): ninguna tabla tiene clave foránea hacia `ContenidoCartaProducto`, `GeneroCarta`, `ItemAgrupadoCarta` ni `OpcionItemAgrupadoCarta`, salvo entre ellas (contenido→género y ítem→género con `ON DELETE SET NULL`; opción→ítem con `RESTRICT`, por eso se borran las opciones antes que los ítems). Las ventas/tickets (`CuentaItem`, `OpcionElegidaEnLinea`), promos, cupos, menú del día y combos referencian PRODUCTOS o grupos de opciones, no filas de carta; la fila ya se borra hoy en «Quitar de la carta» (contenido) y «Quitar opción» (opción). Géneros e ítems agrupados «nunca se borran, se apagan» es una convención de la pantalla, no una restricción de la base ni de dinero/stock/comprobante: las políticas RLS de DELETE por sucursal existen (`alcance_sucursal_delete`) y el rol de la app tiene DELETE (no hay REVOKE). — VERIFICADA EN CÓDIGO / PROPUESTA (la decisión de borrar géneros e ítems, a diferencia de apagarlos, es de diseño: «reemplazar» es reemplazar; si el dueño prefiere apagarlos, se cambia el borrado por un apagado).
- La auditoría guarda lo eliminado entero (N6), así que lo borrado se puede reconstruir a mano.
- El origen debe tener carta propia (al menos un contenido, género o ítem); si no, se rechaza SIN tocar nada: «`<origen>` no tiene carta propia: no hay nada que copiar.» — PROPUESTA (igual que hoy).
- Origen = destino: se rechaza (guard, como hoy). Origen de otra empresa o sin acceso: rechazado sin leer nada del origen (`leerOrigenDeCopia`).
- Confirmación fuerte: se exige `nombreEscrito` igual (sin mayúsculas ni espacios de los costados) al nombre de la sucursal destino; la valida el SERVIDOR (la pantalla es cortesía). — PROPUESTA.
- Mensajes en lenguaje llano; el éxito dice cuánto se eliminó y cuánto se copió.

## N6 · Historia y persistencia

- **Sin migración.** — VERIFICADA EN CÓDIGO. Si el dueño no quisiera borrar géneros e ítems y pidiera apagarlos, tampoco haría falta.
- Persistencia: función nueva `borrarCartaPropiaDeSucursal` en `server/persistencia/carta/copiar-carta.ts` (4 `deleteMany` por `sucursalId`, en orden: opciones → contenidos → ítems → géneros; devuelve la cuenta). Las escrituras de la copia son las mismas funciones de hoy.
- **Auditoría** (misma transacción, `registrarCambioAuditado`): `entidad: "CartaSucursal"`, `entidadId: <sucursal destino>`, `campo: "cartaPropia"`, `actorId` y `creadoEn` (quién y cuándo); `descripcion` = «Carta de «Destino»: reemplazada con la de «Origen» (eliminó N productos, N ítems agrupados, N géneros; copió N productos, N ítems agrupados, N géneros)»; `valorNuevo` = «reemplazada con la de Origen (sucursal <id>)»; `valorAnterior` = **foto completa** de lo eliminado (JSON: géneros, ítems con sus opciones y los contenidos con nombre del producto, sección, género y todos los campos) para reconstruir a mano. **No hay «deshacer» en pantalla** (declarado): la foto permite repararlo a mano o con un script. — PROPUESTA.
- La sucursal activa no cambia; las otras sucursales no se leen más que el origen.

## N7 · Atomicidad y concurrencia

- UNA transacción SERIALIZABLE con reintento (`conTransaccionSerializable`), igual que la copia: lee el destino y el origen, decide, borra y copia, audita. Todo o nada: si falla el insert, el borrado se deshace. — PROPUESTA (mismo mecanismo que el caso actual).
- Dos reemplazos a la vez: SERIALIZABLE aborta a uno; su reintento relee, encuentra la carta ya igual y devuelve «ya estaba igual» sin duplicar ni auditar de más. Agotados los reintentos: «La carta cambió mientras la reemplazabas; recargá e intentá de nuevo.»
- Reemplazo contra edición simultánea de la carta del destino: SERIALIZABLE ordena (uno de los dos reintenta).
- Revalidación de la carta pública: la hace la acción DESPUÉS de confirmar y solo si hubo cambio (decisión M1(b) ya vigente en la copia).

## N8 · Acceso e interfaces

- Acción nueva `reemplazarCartaDeSucursal(sucursalOrigenId, nombreEscrito)` en `server/actions/carta/copiar-carta.ts`, con `conPermiso("carta_copiar_de_sucursal")` → guard del comando (confirmación escrita y origen ≠ activa) → caso de uso `reemplazar-carta-de-sucursal.ts` → revalidar → `aResultadoAccion`. El permiso rechaza antes que la validación de formato.
- Pantalla `Carta` (`src/app/(app)/carta/page.tsx`): con el destino vacío, la copia de siempre; con carta propia y permiso, una tarjeta «Reemplazar con la carta de otra sucursal» con el origen elegible, el resumen **«Se elimina: N productos con contenido, N géneros, N ítems agrupados» / «Se copia: …»** y un campo «Para confirmar, escribí el nombre de esta sucursal». El botón de confirmar queda deshabilitado hasta que coincida. Sin permiso, no se ofrece. Mobile-first: toques ≥ 44 px (`max-md:min-h-11`).

## N9 · Consultas y experiencia

- El resumen de lo que se elimina sale de conteos de ESTA sucursal; el de lo que se copia, de la misma consulta nueva `cuentasDeCartaPropiaPorSucursal` (conteo por la relación de `Sucursal`, con la base ampliada a la lectura de los orígenes que la página ya ofrece; `estadoCartaPropia` no se tocó para no mover la caracterización congelada). Cantidades como enteros, sin dinero en pantalla.
- «¿Qué pasa si…?» en la tabla de abajo.

### Tabla «¿qué pasa si…?»

| Situación | Resultado | Estado |
|---|---|---|
| Se repite el mismo pedido (clic doble, reintento) con el origen sin cambios | 2.º pedido: «La carta de «Destino» ya era igual a la de «Origen»: no hay nada que reemplazar.» Sin escritura, sin auditoría, sin revalidar | PROPUESTA |
| Dos reemplazos a la vez | Uno gana; el otro reintenta, ve «ya igual» (arriba) o, si el origen cambió entremedio, reemplaza de nuevo; nunca duplica ni mezcla (`@@unique` por sucursal lo impide además) | PROPUESTA |
| Falla a mitad (insert) | Nada cambia: el borrado se deshace (misma transacción) | PROPUESTA |
| Origen sin carta propia | Rechaza sin tocar nada | PROPUESTA |
| Destino vacío | Se comporta como copia (sin eliminar nada); mismo texto de éxito de reemplazo con «eliminó 0» | PROPUESTA |
| Origen = destino | Rechaza (guard) | VERIFICADA EN CÓDIGO |
| Origen de otra empresa / otra sucursal sin acceso / inexistente | Rechaza («No se encontró…» / «No tenés acceso…») sin leer del origen ni escribir | VERIFICADA EN CÓDIGO |
| El permiso cambia (se lo sacan) entre abrir la pantalla y confirmar | El servidor vuelve a validar: rechazo por permiso, nada cambia | PROPUESTA |
| Sin permiso | No se ofrece en pantalla; la acción rechaza | PROPUESTA |
| Nombre escrito distinto al de la sucursal / vacío | Rechaza antes de leer nada | PROPUESTA |
| Faltan datos (origen sin sección en un contenido oculto, género null, etc.) | Se copia tal cual (los nulos se conservan); el reapuntado de género deja null si no hay | VERIFICADA EN CÓDIGO |
| Hay filas históricas que dependen de las filas de carta | No hay ninguna en el esquema (N5); si apareciera una clave foránea nueva, el borrado falla cerrado (RESTRICT) y la transacción se revierte sin dejar estado a medias | VERIFICADA EN CÓDIGO |
| Promo del destino con el mismo nombre que un «nombre en carta» del origen | No se copia ese nombre, se informa (regla del 2026-11-04) | VERIFICADA EN CÓDIGO |
| Se reemplaza por una carta con distintos productos | Los productos del destino que no están en el origen quedan «Fuera de carta» (su fila de contenido se borra); su disponibilidad y precio no cambian | PROPUESTA |

## N10 · Pruebas, migración y operación

- **Dimensiones** cuyas combinaciones cambian lo que ve el cliente (visibilidad en carta/POS): (A) destino vacío / con carta; (B) origen con / sin carta; (C) origen igual / distinto al destino; (D) qué tiene el origen: géneros, ítems, contenidos (cada uno sí/no); (E) qué tenía el destino: géneros, ítems, contenidos (cada uno sí/no). El género e ítem de la carta y su alcance por sucursal ya están en la matriz GT-3b.
- **Oráculo escrito aparte del código**: `test/carta/reemplazar-carta.oraculo.ts` (tabla legible: combinación → resultado esperado y cuántas filas quedan), y `test/carta/reemplazar-carta-combinaciones.test.ts` recorre TODAS las combinaciones (2⁶ = 64 de A..E) contra Postgres real y contra la función pura `decidirCopiaDeCarta`. Guardián: falla si aparece una columna nueva en `GeneroCarta`/`ItemAgrupadoCarta`/`OpcionItemAgrupadoCarta`/`ContenidoCartaProducto` sin declarar si se copia o no (se apoya en `CAMPOS_DECLARADOS` de la poda de género e ítem agrupado y suma una lista propia «copiable / no copiable»).
- **Pruebas**: unidad (`decidirCopiaDeCarta`, `firmaDeCarta`), integración contra Postgres (reemplazo correcto; copia sobre carta vacía idéntica; origen sin carta; doble reemplazo concurrente; mismo pedido repetido; otra empresa; otra sucursal sin acceso; sin permiso; atomicidad con fallo inyectado), denegación GT-3b con control positivo para la acción nueva, guardianes de envoltorio/clave/«use server», e2e Playwright de la pantalla (confirmación escrita; sin permiso no se ofrece).
- **Migración: ninguna.** Operación: ninguna tarea nueva. Riesgo conocido: la acción es destructiva sobre la carta del destino (por eso la confirmación escrita y la foto de la auditoría).
