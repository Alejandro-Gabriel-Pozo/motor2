# Carta: familias de productos, F1 (altas y miembros): niveles 6 a 10

> **Estado:** Fase 1, Frente 7 (CARTA), 2026-11-17. Solo documento. Continúa `docs/diseno-carta-familias-orden-identidad-portal-2026-11-17.md` (niveles 1 a 5, §2) y `docs/diseno-carta-orden-permiso-y-precio-de-familia-2026-11-17.md` (§B, precio).
> **Decisión del dueño que rige (2026-11-17, `AskUserQuestion`, literal):** «Familias nuevas como Pedernal (Recomendada)»: familias nuevas por empresa; el ítem agrupado queda y se migra después, en etapa aparte con ensayo en copia. Fuente: `motor2-docs/seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Carta como Pedernal: respuestas del Frente 7 (2026-11-17)».
> **Alcance de F1:** tablas `FamiliaDeProducto` y `MiembroDeFamilia`; casos de uso crear, editar, agregar producto, quitar producto, desactivar/reactivar; consulta de gestión; función pura «forma de salir» con su oráculo. **Fuera de F1:** la acción de precio (F2), la carta pública con renglones de familia (F4, cambia el contrato público `CartaPublicaV1` y sus goldens: zona restringida), el POS (E4/E7) y las pantallas (Frente 6).
> **Estados:** CONFIRMADA (dicha por el dueño) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).

## 0. Decisiones nuevas de este nivel (todas PROPUESTA salvo lo marcado)

| # | Decisión | Por qué | Costo de revertir |
|---|---|---|---|
| D1 | **Permiso: se reutiliza `carta_secciones`** (empresa, piso administrador; gerente y administrador). No hay permiso nuevo ni turno en `acciones.ts`. | Pedernal: «quien edita productos crea y edita familias, mismo permiso que las secciones; sin permiso nuevo» (DDD 122, punto 4). La familia es de la empresa, como la sección. `producto_editar` no sirve: lo tiene el operario. | Nulo (cambiar una clave en el guard) |
| D2 | **Un producto puede ser miembro de una familia y estar en un ítem agrupado a la vez, pero la carta lo muestra solo en el ítem agrupado** (el ítem agrupado tiene precedencia; la consulta de gestión avisa «ya sale en un ítem agrupado»). | El ítem agrupado queda como está (CONFIRMADA); no se toca su código en F1. Prohibir la combinación obligaría a editar `items-agrupados.ts`. | Bajo (agregar el chequeo cruzado en una etapa posterior) |
| D3 | **Solo productos de venta** (`Producto.tipo = 'PV'`) pueden ser miembros. | Una familia es para mostrar en carta/POS; un insumo no se vende. † verificar el nombre exacto del valor del enum `TipoProducto`. | Bajo |
| D4 | Tope de **50 miembros vigentes** por familia, impuesto por la aplicación con la familia bloqueada (`SELECT … FOR UPDATE`). | Igual que Pedernal (S3, F4 del 0079): un trigger no ve la fila de otra transacción. | Bajo |
| D5 | **Nombre:** 1 a 120 caracteres, único por empresa sin distinguir mayúsculas ni acentos (`nombreClave`), mismo criterio que productos y secciones. † reusar la primitiva de nombres que usa `guardarSeccionCarta` (no escribir otra). | Pedernal `familia_nombre_uk`. | Bajo |
| D6 | **Interruptores nacen apagados** (`agruparEnCarta=false`, `agruparEnPos=false`); «Agrupar en el POS» se guarda y nada más lo lee (CONFIRMADA, fila 231). | «Todo nace cerrado». | Nulo |
| D7 | **Sin sección propia**: no hay `seccionCartaId` en la familia (CONFIRMADA, fila 231). La carta decide por sucursal: si todos los miembros vigentes visibles están en la misma sección, sale agrupada en esa; si no, salen sueltos. | Fila 231 «A: sin sección propia». | — |

## 6. Historia y persistencia (compuerta: la migración recién se escribe cuando el dueño confirme 1 a 5 y el orquestador revise esto)

**Dos tablas, una sentencia SQL por tabla.** Ids `UUID` nativo generado por la aplicación (`azar.uuid()`, molde `OcultamientoProducto`); fechas `timestamptz`; nada de `DELETE`/`TRUNCATE` para `motor2_app`; privilegios por columna.

| Tabla | Columnas | Restricciones que impone la base |
|---|---|---|
| `FamiliaDeProducto` | `id`, `empresaId`, `nombre`, `nombreClave`, `agruparEnCarta bool default false`, `agruparEnPos bool default false`, `activa bool default true`, `creadoPorId`, `version int ≥ 1`, `creadoEn`, `actualizadoEn` | `UNIQUE (empresaId, nombreClave)`; `UNIQUE (empresaId, id)`; `CHECK` de largo del nombre y de `version`; identidad (`id`, `empresaId`) inmutable (trigger) |
| `MiembroDeFamilia` | `id`, `empresaId`, `familiaId`, `productoId`, `posicion int 1..1000`, `agregadoPorId`, `agregadoEn`, `quitadoPorId`, `quitadoEn` | FK compuestas `(familiaId, empresaId)` y `(productoId, empresaId)`; **único parcial `(empresaId, productoId) WHERE quitadoEn IS NULL`** (un producto, una sola familia a la vez, aun con dos pedidos simultáneos); **único parcial `(empresaId, familiaId, posicion) WHERE quitadoEn IS NULL`**; `CHECK (quitadoEn IS NOT NULL OR quitadoPorId IS NULL)`; trigger: un miembro quitado no cambia más y solo se escriben `quitadoPorId` y `quitadoEn` una vez |

- **No se toca `Producto`** (su `version` sube con cualquier UPDATE; una familia que cambiara columnas del producto haría fallar la edición simultánea de la ficha). †: confirmar en `schema.prisma` el nombre exacto del campo de versión de `Producto` antes de afirmarlo en la migración.
- **Historia:** quitar = escribir quién y cuándo; volver a agregar = fila NUEVA. Desactivar la familia = `activa=false`, los miembros siguen siéndolo (CONFIRMADA, fila 231). Todo cambio, también en `RegistroAuditoria` (antes y después), en la misma transacción.
- **RLS:** aislamiento por empresa como las demás tablas de empresa (`aislamiento_empresa`); no son tablas de sucursal, así que no llevan política de alcance de sucursal.
- **Migración:** aditiva, en el bloque `20261117161000` (o el siguiente libre dentro de 160000–169999 tras O1), con `down.sql` (DROP de las dos tablas; frena si hay filas, `verificacion-previa.sql` cuenta filas) y `verificacion-previa.sql` (comprobar que las tablas no existan y que `Producto`, `Empresa` existan). Entrada al final de la lista del `m1`. **No se aplica a ninguna base real.**
- **Diferencias con Pedernal (declaradas):** ids `UUID` generados por la app (igual); tabla `familia` sin columnas `orden`/`destacada` (esas son de la etapa de orden por empresa, que el dueño dejó por sucursal); `creadoPorId` como texto de usuario de Motor2, no `persona`; `version` en lugar de `fijar_version_y_fecha()` (en Motor2 la sube la aplicación, patrón de `GrupoDePrecio`). †: si Motor2 ya tiene un trigger genérico equivalente a `sin_borrado()`.

## 7. Atomicidad y concurrencia

Cada caso de uso, **una transacción SERIALIZABLE** (`conTransaccionSerializable`) con las lecturas que deciden, las escrituras y la auditoría. Se bloquea la familia y, cuando hay producto, la familia y el producto **en orden de id** (no hay traba cruzada).

| Comando | Repetición | Concurrencia | Error parcial | Datos faltantes | Cambio de permisos |
|---|---|---|---|---|---|
| **Crear** (CU-F1) | `id` mandado por la app: mismo contenido → `yaExistia` sin escribir; otro contenido → `ID_REUTILIZADO` | Dos con el mismo nombre: gana una (`UNIQUE`), la otra `NOMBRE_REPETIDO` | Todo o nada | Nombre vacío o largo → `DATO_INVALIDO` | Se evalúa al guardar |
| **Editar** (CU-F2: nombre e interruptores) | Estado deseado, no «alternar»: igual → `yaEstaba`, sin auditar | `versionEsperada` de la familia; vieja → «otra persona la cambió», no cambia nada | Todo o nada | Familia inexistente o de otra empresa → «no encontrada» | Idem |
| **Agregar producto** (CU-F3) | Ya está en esta familia → `yaEstaba` | Dos lo agregan a familias distintas: gana una (único parcial), la otra recibe el mensaje genérico `PRODUCTO_EN_OTRA_FAMILIA`; tope 50 con familia bloqueada | Todo o nada | Producto de otra empresa o no PV → «no encontrado» | Idem |
| **Quitar producto** (CU-F4) | Ya estaba fuera → `yaEstaba` | `versionEsperada` de la familia | Todo o nada | Producto que no es miembro → `yaEstaba` | Idem |
| **Desactivar / reactivar** (CU-F5) | Estado deseado | `versionEsperada` | Todo o nada | — | Idem |

Posición al agregar: la asigna la aplicación con la familia bloqueada (máx+1); el único parcial atrapa una carrera. Quitar no renumera (huecos permitidos); reordenar miembros dentro de la familia queda **fuera de F1** (nadie lo pidió; se reconsidera con el orden por empresa que el dueño dejó por sucursal).

## 8. Acceso e interfaces

- **Server Actions** en `src/server/actions/carta/familias.ts` (envoltorio + guard + caso de uso, con el molde de `secciones.ts` y `ordenar-secciones-carta.ts`), esquemas en `src/core/features/carta/familias.schema.ts`, persistencia en `src/server/persistencia/carta/familias.ts`, regla pura en `src/core/carta/familias/` (**carril propio** del frente). Todo de empresa: la empresa sale del contexto del servidor, nunca del frontend.
- **Guard:** `carta_secciones` para escribir; lectura con el permiso de ver la carta (`carta_ver` ya existe, sucursal) †: confirmar si una lectura de empresa necesita otro; la consulta de gestión nunca devuelve datos de otra empresa (RLS).
- **Módulo:** nacen dentro del módulo `carta` (ya «disponible»): sin perilla ni módulo nuevo (alcance mínimo). Un cambio de módulo o plan es del Frente 4.
- **Respuestas con códigos de error propios:** `NOMBRE_REPETIDO`, `FAMILIA_NO_ENCONTRADA`, `PRODUCTO_NO_ENCONTRADO`, `PRODUCTO_EN_OTRA_FAMILIA`, `FAMILIA_LLENA`, `VERSION_DESACTUALIZADA`, `ID_REUTILIZADO`, `DATO_INVALIDO`. **Textos de pantalla nuevos: del catálogo T1** (zona restringida: turno del orquestador general; el mensaje de «otra familia» es genérico, no revela la familia ni la empresa).
- **Cosas que el servidor NO hace:** decidir cómo se ve la familia en pantalla (lo decide la pantalla con la función pura), tocar precio, receta o stock del producto.

## 9. Consultas y experiencia

- **Lista de familias** de la empresa con cantidad de miembros vigentes, estado y versión; **ficha** con sus miembros vigentes (producto, posición) y, por cada miembro, banderas: «sale en un ítem agrupado» (D2), «desactivado», «oculto» (regla única `ocultoPor`, `dominio/carta-publica`), «sin medidas» cuando la familia tiene.
- **Función pura «forma de salir»** (`src/core/carta/familias/forma-de-salir.ts`), sin base ni reloj, entrada: interruptor, miembros vigentes (visibles, con precio, en la sucursal de la carta), medidas por miembro, secciones. Salida: `SUELTOS | UNA_LINEA | TABLA | LISTA`. Es la tabla de 8 filas de Pedernal (§6 de su especificación) y rige la carta (F4) y la ficha. Medidas: se comparan **por nombre** entre grupos `MEDIDA` (`ProductoAdmiteGrupo`/`ProductoAdmiteOpcion`); precio de cada celda: `precioAbsoluto` (§B del documento de precio). Orden de columnas: el de las medidas de los productos.
- **Sin dato = «pendiente de completar»**, nunca se inventa un precio ni una medida.
- **Escalera de producto:** N0 = familia con miembros y forma derivada visible en la ficha; N1 = «Agrupar en la carta» (F4); N2 = precio por medida (F2); N3 = «Agrupar en el POS» consumido por E4/E7. Cada peldaño es aditivo y no rompe lo cargado.

## 10. Pruebas, migración y operación

**Dimensiones del oráculo** (cambian lo que ve el comensal y el precio mostrado): `agruparEnCarta` (sí/no) × `activa` × miembros vigentes (0, 1, ≥ 2) × medidas (ninguna / todas iguales / distintas, algún miembro sin medidas) × precios (iguales / distintos) × cantidad de medidas (≤ 3 / > 3) × secciones (misma / distintas) × estado del miembro (oculto / desactivado / sin precio / en ítem agrupado). **Oráculo:** tabla escrita aparte del código, con una fila por cada caso de la regla de §6 de Pedernal más las filas D2 (ítem agrupado) y D7 (secciones distintas); test exhaustivo de combinaciones pequeñas, y propiedad con `fast-check` (ya está en el proyecto †) «el resultado no depende del orden en que llegan los miembros». **Guardián:** falla si aparece una dimensión nueva (una clave del interruptor, una columna) sin declarar si afecta.

**Pruebas obligatorias (además del gate de 8 comandos):**
1. **Concurrencia:** dos agregan el MISMO producto a familias distintas → gana una; dos crean el mismo nombre → gana una; dos editan la misma familia con la misma versión → una rechazada; tope 50 con dos altas a la vez.
2. **Idempotencia:** crear con el mismo `id` y contenido → `yaExistia` (una fila, una auditoría); agregar el mismo producto dos veces; quitar dos veces; desactivar dos veces.
3. **Atomicidad:** fallo forzado después del insert del miembro y antes de la auditoría → no queda nada.
4. **Aislamiento:** una empresa no ve ni nombra familias/productos de otra (responde «no encontrada»); lectura con RLS.
5. **Permisos:** operador rechazado en cada comando; gerente y administrador permitidos; sin sesión rechazado.
6. **Base:** el único parcial y los CHECK se prueban con SQL directo (un miembro quitado no se puede modificar; no se puede borrar).
7. **Sin regresión:** no hay cambio en la carta pública hasta F4; los goldens existentes siguen verdes sin tocarlos.

**Migración y operación:** compatible hacia atrás (tablas nuevas que nadie lee hasta F4); `down.sql` reversible; ensayo en copia descartable; **ninguna base real**. Se despliega sin efecto visible (nada lee las tablas). Trazabilidad: `RegistroAuditoria` por comando.

## 11. Lo que no verifiqué (†) y turnos a pedir
- †: valor del enum `TipoProducto`; primitiva de nombres de `guardarSeccionCarta`; nombre del campo de versión de `Producto`; trigger genérico equivalente a `sin_borrado()`; si `fast-check` ya es dependencia (`package.json`, zona restringida, no se toca).
- **Turnos (cuando el orquestador general revise este diseño):** modelos nuevos en `prisma/schema.prisma` (solo `FamiliaDeProducto` y `MiembroDeFamilia`), timestamp de migración dentro de `20261117160000–169999`, lista `m1`, textos T1. Ningún cambio en `acciones.ts` ni DEC.
