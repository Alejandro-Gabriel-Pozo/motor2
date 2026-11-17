# Carta: orden de renglones (O1), permiso del portal y traducción del precio de familia: niveles 1 a 10 de lo más chico

> **Estado:** Fase 1, Frente 7 (CARTA), 2026-11-17. Solo documento; nada de código ni migraciones aplicadas. Continúa `docs/diseno-carta-familias-orden-identidad-portal-2026-11-17.md` (niveles 1 a 5 y preguntas).
> **Decisiones del dueño que rigen (2026-11-17, `AskUserQuestion`, textos literales, transmitidos por el orquestador general):** (1) «Familias nuevas como Pedernal (Recomendada)». (2) «Dejar por sucursal, sumar modo de orden (Recomendada)». (3) portal e identidad: «Migrar todo ya». (4) «Gerente y administrador, como Pedernal (Recomendada)».
> **Estados:** CONFIRMADA (dicha por el dueño) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).

## A. Permiso del portal: ya está cubierto, no hace falta tocar `acciones.ts` (PROPUESTA, con una verificación pendiente)

**Qué pidió el dueño:** «Gerente y administrador, como Pedernal»; operador cerrado (todo nace cerrado).

**Qué hay en el código real:**
- `carta_portal` es de contexto empresa, piso `administrador`, semilla solo rol `admin` (`src/core/permisos/acciones.ts:84`).
- En Motor2 «gerente» no es un rol de sucursal sino `UsuarioEmpresa.rolEmpresa`; para las acciones de piso `administrador` el gerente pasa por su membresía con rol `admin` (`src/core/permisos/decision-de-acceso.ts:150-157`: solo las acciones de piso gerente saltean la matriz).
- El traspaso de la gerencia exige que el destino sea «admin efectivo en alguna sucursal» (`src/core/permisos/gerencia.ts`, comentario del encabezado): o sea, **el gerente siempre es también administrador**.
- El operador no alcanza el piso `administrador`: ninguna fila de matriz se lo da (`rolAlcanzaLaAccion`).

**Conclusión:** el resultado que pide el dueño (gerente y administrador sí, operador no) **ya se cumple hoy** sin cambiar nada. Cambiar el piso a `gerente` sería lo contrario (dejaría afuera al administrador). **Diferencia con Pedernal declarada:** Pedernal escribe `["GERENTE","ADMINISTRADOR"]` en una tabla; Motor2 lo resuelve con pisos y matriz (motivo: el modelo de permisos de Motor2 ya existente, ADR-027). Nombre: se mantiene `carta_portal` (no se crea `vidrieras.administrar_portal`).
**Pendiente (†):** una prueba de integración «el gerente puede guardar el portal y el operador no» (no hay hoy un test con ese nombre, solo `tramo-c-rechaza-sin-permiso`). **No pide turno de zona restringida.**

## B. Traducción del precio por medida de la familia (pregunta 4, opción A; verificado en solo lectura)

**Resultado: SÍ existe el precio por producto y medida; lo único que cambia son los nombres.**

| Pedernal | Motor2 (verificado en `prisma/schema.prisma`) |
|---|---|
| Medida = grupo `VARIANTE` marcado `es_tamano`, con opciones; se compara **por nombre** | Medida = **`GrupoDeOpciones` con `tipo = 'MEDIDA'`** (CHECK: MEDIDA, VARIANTE, INCLUIDA, ADICIONAL), con `OpcionDeGrupo` («Chico», «Grande») |
| `precio_de_venta` por producto y `opcion_id` (fila nueva con `vigente_desde`) | **`ProductoAdmiteOpcion.precioAbsoluto`** («el precio de lista de la MEDIDA en este producto», `Decimal(14,2)` ≥ 0,01), con `version` (control optimista) y `activo`; hay además `tipoDeDiferencia` MONTO/PORCENTAJE (precio como diferencia del base) |
| Precio de la sucursal | `PrecioLocalDeOpcion` (sucursal, producto, opción, `precio`, `habilitado`): el «No cambia en Sucursal Norte» de la maqueta |
| Producto sin medidas | `Producto.precioVenta` (`Decimal(14,2)`) |
| Historial de precios por fila | **Distinto:** la fila de Motor2 se actualiza en lugar de agregar una nueva; el antes y el después van al `RegistroAuditoria` (como `ordenarSeccionesCarta`) |

**Consecuencias de diseño (PROPUESTA, F2):**
1. La acción «aplicar el precio por medida a la familia» escribe `precioAbsoluto` en las filas `ProductoAdmiteOpcion` de los productos tildados, **una sola transacción SERIALIZABLE**, todo o nada. El control de versión es la `version` de cada fila (en Pedernal, `precioIdEsperado`): si alguna cambió, se rechaza todo con `PRECIO_DESACTUALIZADO`.
2. Un producto cuyo precio de esa medida **no es absoluto** (tiene diferencia MONTO/PORCENTAJE) o que **no ofrece la medida** se saltea y se informa; no se inventa. †: cómo trata Motor2 hoy `tipoDeDiferencia` al cambiar a absoluto (hay que leer `crear-opcion-en-el-producto.ts` y `fijar-precio-local-de-opcion.ts` antes de F2).
3. Producto sin medidas: se escribe `Producto.precioVenta`. †: el caso de uso que lo cambia y su control de versión (`Producto.version`) no los leí; Pedernal exige no subir esa versión desde una familia, y acá escribir `precioVenta` **sí** la sube (diferencia a declarar y a revisar en nivel 7).
4. Las filas de `PrecioLocalDeOpcion` no se tocan; se informan como en Pedernal.
5. «Idempotencia por `aplicacionId`» y registro inmutable (`AplicacionDePrecioDeFamilia`) se mantienen tal cual 0080.
6. Los ejes: Motor2 admite dos ejes (`CombinacionDeProducto`, `grupoDePrecioId`); como Pedernal, la acción solo aplica a productos con **a lo sumo un** grupo MEDIDA, y los de dos ejes quedan afuera e informados.

**Estado:** la traducción es verificada para el modelo (existe); los puntos † 2 y 3 se cierran en el nivel 7 de F2. **La pregunta 4 queda respondida técnicamente; la decisión sigue siendo del dueño solo si quiere otra cosa** (se asume la opción «entra F1 con la acción de precio en F2», sin pedir nada nuevo).

## C. O1: modo de orden y «reordenar renglones» (niveles 1 a 10)

### 1. Propósito y alcance (CONFIRMADA: «Dejar por sucursal, sumar modo de orden»)
Que cada sucursal elija, **por sección**, cómo se ordenan los renglones de su carta: **alfabético** o **a mano**, y que «a mano» se pueda cambiar con una sola acción todo-o-nada. ★ queda como hoy (`especial`, sin tope, por sucursal): no se agrega nada.
**Necesidad:** pedido del dueño del 2026-11-17 («todo como Pedernal») y su elección «sumar modo de orden». **No entra:** orden por empresa, tope de estrellas, acción aparte de ★, orden de promos.

### 2. Actores
Quien edita la carta de la sucursal activa (permiso hoy `carta_contenido_producto`, contexto sucursal, piso `administrador`; **PROPUESTA** reutilizarlo, y exigir además `carta_items_agrupados` cuando la lista incluye ítems agrupados; ambos con el mismo piso y semilla). Sin permiso nuevo: no pide turno en `acciones.ts`. El comensal lee la carta pública.

### 3. Casos de uso
- **CU-O1 Fijar el modo de una sección** (alfabético / a mano) en la sucursal activa, por estado deseado.
- **CU-O2 Reordenar los renglones de una sección** (productos visibles e ítems agrupados activos, la misma escala que hoy): la pantalla manda la lista completa en el orden nuevo.
- **CU-O3 La carta pública** ordena según el modo (lectura).

### 4. Conceptos y ciclo de vida
- **Renglón** = `ContenidoCartaProducto` visible (con `seccionCartaId`) o `ItemAgrupadoCarta` activo, de la misma sucursal y sección. Clave `{tipo, id}`. Las promos tienen su propio orden y quedan afuera.
- **Modo:** `ALFABETICO` | `A_MANO`. **Sin fila = `A_MANO`**: es lo que la carta hace hoy (orden y después nombre, `armar-menu.ts:425,462`). *Diferencia con Pedernal, declarada:* Pedernal nace alfabético porque no tiene orden previo; Motor2 ya tiene cartas armadas por orden, y nacer alfabético reordenaría de golpe la carta real. Motivo: datos existentes. Una sección nueva nace a mano (sin fila) y la sucursal elige.
- **Estados:** el modo cambia con `version` y fecha; nada se borra (el modo se sobrescribe y queda en la auditoría).
- Renglón nuevo en «a mano»: al final (ya es así: `orden` = cantidad, DA5, `orden-sugerido.ts`).

### 5. Invariantes y políticas
1. Un modo por (sucursal, sección); la sección es de la empresa y el modo de la sucursal.
2. «Reordenar» fija el orden de **todos** los renglones de la sección en una sola transacción: posición 0, 1, 2… (misma escala).
3. La lista pedida es **exactamente** la de la sección en esa sucursal: falta o sobra uno → `ORDEN_DESACTUALIZADO`; un id repetido o de otra sucursal/empresa → «no encontrado» (misma respuesta que no existe).
4. Cada renglón trae el `ordenVisto`; si alguno cambió → se rechaza todo (molde de `ordenarSeccionesCarta`, que ya usa este mecanismo en vez de una columna de versión).
5. Orden ya vigente → éxito sin escribir ni auditar (idempotencia por estado).
6. Pasar a `ALFABETICO` **no borra** el orden a mano: se conserva en `orden` y vuelve si se elige «a mano» (todo reversible).
7. Todo nace cerrado: la validación declara lo permitido (lista cerrada de modos, ids con forma de id, lista de tamaño acotado, tope 200 renglones por sección **PROPUESTA**).

### 6. Historia y persistencia (compuerta: recién tras confirmación de 1 a 5 por el dueño)
- **Tabla nueva `ModoDeOrdenDeSeccionCarta`** (PROPUESTA), **una sentencia SQL por tabla**: `id UUID` (lo manda la aplicación), `empresaId`, `sucursalId`, `seccionCartaId` (FK compuestas con `empresaId`), `modo text` con CHECK (`'ALFABETICO','A_MANO'`), `version int ≥ 1`, `actualizadoPorId`, `creadoEn`/`actualizadoEn timestamptz`; `UNIQUE (sucursalId, seccionCartaId)` y `UNIQUE (empresaId, id)`. Sin DELETE ni TRUNCATE para `motor2_app` (privilegios por columna, como las demás).
- **No se agrega ninguna columna** a `ContenidoCartaProducto` ni a `ItemAgrupadoCarta`: `orden` y `especial` quedan donde están.
- **RLS:** aislamiento por empresa + política de alcance de sucursal (molde exacto: `20261117111000_rls_sucursal_caja_c1`, generada por `test/setup/politicas-de-alcance-de-sucursal.ts`).
- **Auditoría:** una fila de `RegistroAuditoria` por renglón que cambia de lugar (como las secciones) y una por cambio de modo.
- **Migración:** aditiva, en el bloque `20261117160000`; `down.sql` (DROP de la tabla, sin pérdida porque nada más la lee) y `verificacion-previa.sql` (comprobar que la tabla no exista y que `SeccionCarta`, `Sucursal` existan). **No se aplica a ninguna base real.** Sin backfill: sin fila = comportamiento de hoy, así que la carta real no cambia.

### 7. Atomicidad y concurrencia
- Los dos casos de uso, una transacción SERIALIZABLE (`conTransaccionSerializable`), las lecturas que deciden, las escrituras y la auditoría juntas.
- Dos «reordenar» a la vez: se serializan; el segundo ve `ordenVisto` distinto y se rechaza entero. Dos «fijar modo» a la vez: `version` esperada; el segundo recibe «otra persona lo cambió».
- Alta de un renglón mientras alguien reordena: la lista ya no es la de la sección → `ORDEN_DESACTUALIZADO`.
- Error a mitad de camino: la transacción revierte; nunca queda un orden a medias.

### 8. Acceso e interfaces
Dos Server Actions en `src/server/actions/carta/` (envoltorio + guard + caso de uso, como `ordenarSeccionesCarta`), con esquema en `src/core/features/carta/`. Autorización en servidor con la sucursal activa del contexto: lo que mande el frontend (sucursalId) nunca se confía. Revalidación de la carta pública como en `revalidar.ts`. La pantalla (Subir/Bajar, selector «Alfabético / A mano») la define el Frente 6.

### 9. Consultas y experiencia
- La lectura pública (`armar-menu.ts`) ordena por nombre si el modo es `ALFABETICO` y como hoy si es `A_MANO` o no hay fila; una sola función pura decide (una regla, un lugar). Comparación de nombres con el mismo `comparar` ya usado (acentos y mayúsculas).
- La lectura de gestión devuelve los renglones de la sección con su `ordenVisto` y el modo.
- Lo que falta se muestra como «pendiente de completar»: no hay datos inventados.

### 10. Pruebas, migración y operación
**Dimensiones** (cambian lo que ve el comensal): modo (sin fila, A_MANO, ALFABETICO) × tipo de renglón (producto, ítem agrupado) × empates de `orden` × renglón oculto/inactivo. **Oráculo escrito aparte del código:** tabla de ~12 filas (por ejemplo «ALFABETICO ignora `orden`»; «sin fila con `orden` iguales se desempata por nombre»; «el ítem agrupado y el producto comparten escala»). Test exhaustivo sobre esas combinaciones + guardián que falle si aparece una dimensión nueva sin declarar.
**Pruebas obligatorias:** (a) **concurrencia:** dos «reordenar» simultáneos → uno gana, el otro `ORDEN_DESACTUALIZADO`, resultado final de uno solo; dos «fijar modo»; (b) **idempotencia:** el mismo reordenamiento dos veces escribe y audita una sola vez; fijar el mismo modo dos veces; (c) **atomicidad:** falla forzada en la mitad no deja cambios; (d) **aislamiento:** una sucursal no ve ni cambia el modo/orden de otra; otra empresa responde como «no existe»; (e) **permiso:** operador rechazado, gerente y administrador permitidos; (f) **sin regresión:** con una base sin filas la carta pública sale idéntica (el golden de la carta real ya existe y no se toca).
**Operación:** se despliega apagado por no tener efecto (sin fila no cambia nada); revertir = `down.sql` + marcar la migración revertida.

### Declaraciones de la implementación de O1 (2026-11-17, a pedido del verificador)

- **`actualizadoPorId` sin llave foránea (diferencia declarada).** En `ModoDeOrdenDeSeccionCarta` el autor del último cambio es texto sin FK a `User`. Otras tablas lo declaran con FK y `onDelete: Restrict`; acá no se hizo porque tocar `User` quedaba fuera del carril de O1. El autor NO se pierde: cada cambio de modo y de orden deja su fila en `RegistroAuditoria` con `actorId`. Costo de corregirlo: una migración aditiva que agregue la FK (con verificación previa de que no haya ids huérfanos). Queda pendiente de decisión.
- **Permiso adicional `carta_items_agrupados`.** Cubierto por `test/carta/orden-de-renglones-permiso-agrupados.test.ts`: con `carta_contenido_producto` y sin `carta_items_agrupados`, reordenar o cambiar el modo de una sección con un ítem agrupado se rechaza sin escribir nada; con las dos claves corre. Con el control quitado (`void gate;`) los dos casos de rechazo ponen la suite en rojo.
- **Módulo apagado: sin prueba propia (pendiente declarado).** Las dos acciones heredan el rechazo por módulo de la envoltura de `contenido-producto.ts`, ya cubierto por la matriz de denegación; falta una prueba por acción que lo demuestre para O1.
- **Único de la base.** `UNIQUE (sucursalId, seccionCartaId)` está cubierto por el test de migración (subir/bajar/subir) y por el caso de concurrencia «dos ALFABETICO a la vez desde cero → UNA fila»; son dos capas (base y caso de uso), sin test aparte que intente insertar la fila duplicada con SQL directo.

### Tabla «¿qué pasa si…?»

| Situación | Resultado |
|---|---|
| Doble clic en «Guardar orden» | Segundo envío: orden ya vigente → éxito sin escribir |
| Dos personas reordenan a la vez | Gana una; la otra recibe «el orden cambió, recargá» y no cambia nada |
| Otra persona agrega un plato en medio | `ORDEN_DESACTUALIZADO`, no se cambia ninguno |
| Pasa a alfabético y vuelve a mano | El orden a mano se conserva |
| Se corta la red a mitad | Transacción revierte; reintento seguro |
| Se pide un renglón de otra sucursal | «No encontrado» |
| El operador intenta reordenar | Rechazado en el servidor |
| Cambia el permiso entre abrir y guardar | Se evalúa al guardar |
| Sección sin renglones | Éxito sin escribir |

## D. Dónde queda esto respecto de lo que sigue
1. **Ya mismo, sin turno:** nada (O1 y el permiso no tocan zona restringida hasta tener `schema.prisma` aprobado).
2. **Turno pedido para Fase 2 de O1:** modelo nuevo en `prisma/schema.prisma`, numeración de la migración `20261117160000`, lista de `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts` y, si el catálogo de textos lo exige, un texto de error (`ORDEN_DESACTUALIZADO` ya existe para secciones †). El generador de políticas de sucursal (`test/setup/`) **no es zona restringida** según el mapa, pero su test de migraciones sí se toca.
3. **Siguiente:** niveles 6 a 10 de F1 (familias) y del portal; este documento ya sirve de molde.
