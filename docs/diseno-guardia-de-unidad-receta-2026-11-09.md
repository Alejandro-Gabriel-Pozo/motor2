# Diseño — Guardia de unidad en las recetas (2026-11-09)

Método: escalera de diseño de 10 niveles (AGENTS.md). Estados: **CONFIRMADA** (lo dijo el dueño), **PROPUESTA** (supuesto declarado, el dueño lo corrige), **PENDIENTE**, **NO VERIFICADA**.

**Necesidad (poda):** pedida por el dueño el 2026-11-09 («Guardia de unidad»), tras la auditoría de recetas. CONFIRMADA. Problema verificado en el código: la receta se carga SIEMPRE en la unidad de STOCK de la materia prima (U7 / D3, `receta-validacion.ts`, `guardar-version-de-receta.ts`). Quien escribe 100 pensando en gramos para «Pan rallado» (stock en kg) deja «100 kg por unidad vendida»: cada venta descontaría 100 kg y costaría una fortuna. Hoy no hay ninguna guardia de plausibilidad. Producción tiene 0 recetas: es el momento, ANTES de cargar las 47.

## Inventario de lo que ya existe (verificado en el código)

- Todo camino que guarda ingredientes termina en `guardarVersionDeRecetaCasoDeUso` (`src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts`): agregar/editar/quitar ingrediente de la central (`recetas.ts`), agregar/editar/quitar de la propia de sucursal y crear/copiar la propia (`receta-sucursal.ts`), y el reemplazo a ciegas (`receta-a-ciegas.ts`, solo `scripts/` y `test/`, fijado por el guardián `receta-a-ciegas-solo-desde-scripts-y-tests`). Un solo punto donde poner la guardia.
- La unidad ya se fuerza a la de stock (`validarUnidadDeIngredientes`, dentro de la transacción SERIALIZABLE): la guardia usa esa misma lectura.
- La pantalla ya tiene la unidad fija junto a la cantidad (`Insignia` en el alta, caja gris al editar) y una lectura en vivo («= 220 g», `LecturaDeCantidad`).
- Patrón de «advertencia con confirmación» que ya existe: `confirmarFusion` (insumos: bandera estricta `true` que viaja con el pedido, la valida el caso de uso). Se reutiliza la idea; no hay librerías nuevas.
- Magnitud de la unidad: `Unidad.magnitud` (PESO / VOLUMEN / CANTIDAD). El modelo NO guarda la relación kg↔g; la equivalencia sale de los nombres sembrados («kg»/«g», «l»/«ml», `lectura-de-cantidad.ts`).

## Nivel 1 — Propósito y alcance

Evitar que un error de unidad al TIPEAR (100 en vez de 0,1) quede guardado sin que la persona lo vea. Es una guardia de PLAUSIBILIDAD, no un tope duro: se puede confirmar. CONFIRMADA (pedido) / forma PROPUESTA.

Fuera de alcance: convertir unidades (la receta sigue cargándose en la unidad de stock), cambiar lo ya guardado, topes por producto, nada de migraciones ni tablas.

## Nivel 2 — Actores y contexto

Quien tiene `guardar_receta` (central) o `receta_sucursal_editar` (propia). Sin permisos nuevos. La empresa y la sucursal salen de la sesión, no del pedido. PROPUESTA.

## Nivel 3 — Casos de uso

1. Cargar o editar un ingrediente con cantidad razonable: se guarda como siempre, sin molestar.
2. Cargar una cantidad desproporcionada: el guardado se rechaza con un mensaje que muestra la equivalencia; la pantalla ofrece «Sí, es esa cantidad: guardar».
3. Confirmar: se reenvía EL MISMO pedido (la misma cantidad que se avisó) con la confirmación; se guarda.
4. Mientras se tipea, la pantalla dice en lenguaje llano qué lleva el plato («Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa con papas fritas») y deja bien visible la unidad.

## Nivel 4 — Conceptos y ciclo de vida

- **Cantidad desproporcionada:** la cantidad de UN ingrediente por unidad vendida es mayor o igual al umbral de su unidad de stock. No es un estado guardado: se calcula al guardar.
- **Confirmación:** `confirmaCantidadDesproporcionada` (booleano) en el comando del caso de uso. Solo un `true` estricto confirma. No se guarda: vale para ese pedido.
- Nada nuevo en la base.

## Nivel 5 — Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| R1 | **Umbral por magnitud de la unidad de stock** (un solo lugar: `UMBRALES_DE_CANTIDAD` en `src/core/catalogo/guardia-de-unidad.ts`): PESO y VOLUMEN ≥ 5 (en kg / l), CANTIDAD ≥ 50. «Desproporcionada» incluye el valor justo en el umbral. | PROPUESTA |
| R2 | **Unidad menor (g, ml):** si la unidad de stock es «g» o «ml» (par sembrado de «kg»/«l», mismo criterio que la lectura en vivo), el umbral se multiplica por 1000 (5000 g, 5000 ml). Sin esto, 100 g de un insumo con stock en gramos —lo normal— se rechazaría. Es un agregado mío al pedido, necesario para no dar falsos positivos. | PROPUESTA |
| R3 | La guardia mira solo los ingredientes **nuevos o cuya cantidad/unidad cambió** respecto de la versión vigente de la serie donde se guarda. Quitar un ingrediente, editar un paso o la cabecera NO re-juzga los ingredientes que ya estaban (no cambia nada de lo ya guardado). | PROPUESTA |
| R4 | **No aplica** a productos «Se produce» (las tandas de producción usan cantidades grandes legítimas). | CONFIRMADA (pedido) |
| R5 | **Rutas que NO pasan por la guardia (declaradas):** `guardarRecetaACiegas` (seeds, scripts, tests: carga en bloque sin pantalla) y las dos que COPIAN lo ya aceptado, «crear la propia desde la central» y «copiar la propia de otra sucursal» (no crean ni editan un ingrediente: la guardia se evaluó cuando se escribió en el origen). Lo declaran con `omitirGuardiaDeUnidad: true` en el comando; el valor por defecto es EVALUAR (una acción nueva queda protegida si se olvida). | PROPUESTA |
| R6 | Sin confirmación (o con algo distinto de `true`), una cantidad desproporcionada se rechaza **siempre en el servidor**, aunque el cliente no valide. | CONFIRMADA (pedido) |
| R7 | El mensaje es exacto (ver abajo) y lleva el código `CANTIDAD_DESPROPORCIONADA`, que la pantalla usa para ofrecer el botón. | PROPUESTA |
| R8 | La guardia corre DENTRO de la transacción SERIALIZABLE, con la unidad de stock real leída ahí (la misma lectura de U7 / D3), después de la versión esperada y de la unidad. | PROPUESTA |

Mensaje (R7), con la cantidad en es-AR sin separador de miles:

- kg / l: «Esto descuenta 100 kg de Pan rallado por cada unidad vendida de Milanesa con papas fritas. Si querías 100 gramos, escribí 0,1 (la receta se carga en kg). Si de verdad es 100 kg, confirmalo.» (en litros: «mililitros», «… se carga en l»).
- g / ml / unidades / otras: «Esto descuenta 60 unidades de Huevo por cada unidad vendida de Milanesa. Si de verdad es así, confirmalo.» («unidad» va en plural si no es 1; una unidad creada a mano va tal cual.) Sin sugerencia de equivalencia: no hay una unidad menor para sugerir.

Diferencia con el ejemplo del pedido: «por cada **unidad vendida de** Milanesa» en vez de «por cada Milanesa vendida», porque el género del plato no se sabe («una Pizza vendida», «un Choripán vendido»). PROPUESTA.

## Nivel 6 — Historia y persistencia

Nada nuevo. Sin migración, sin tablas, sin columnas. La confirmación no se guarda: lo que queda registrado es la versión de la receta con su auditoría de siempre (quién, cuándo, qué versión). Pendiente anotado: dejar en esa auditoría que la cantidad fue confirmada (hoy no se distingue). PENDIENTE.

## Nivel 7 — Atomicidad y concurrencia

- La guardia se evalúa en cada intento de la transacción SERIALIZABLE con la unidad de stock leída adentro; un rechazo no escribe nada (mismo mecanismo `rechazo.resultado` que `VERSION_DESACTUALIZADA` y la unidad).
- La comparación «nuevo o cambiado» usa la versión vigente leída en el mismo intento (`ultima`), así que dos guardados simultáneos se ordenan como siempre (UNIQUE + `versionEsperada`).

### ¿Qué pasa si…?

| Situación | Resultado |
|---|---|
| **Repetición** (doble clic, reintento de red) con confirmación | La segunda llega con la versión vieja y se rechaza por `VERSION_DESACTUALIZADA` (la primera ya guardó): no duplica nada. Sin confirmación: el mismo rechazo cada vez, sin efectos. |
| **Concurrencia**: dos personas guardan el mismo ingrediente | Como hoy: gana una, la otra recibe «la receta cambió»; la guardia se evalúa de nuevo en el reintento. |
| **Cantidad justo en el umbral** (5 kg, 50 unidades) | Desproporcionada (R1: «a partir de»). Un poco debajo (4,9999) pasa. |
| **Unidad de stock cambiada después** | Lo ya guardado no se re-juzga (R3). Al editar ese ingrediente, primero manda U7 (unidad distinta de la de stock → rechazo) y después la guardia con la unidad nueva. |
| **Receta propia de sucursal** | Misma guardia (agregar/editar ingrediente de la propia). Crear la propia desde la central y copiar de otra sucursal no la evalúan (R5). |
| **Producto «Se produce»** | Sin guardia (R4). |
| **Datos faltantes** (cantidad vacía, texto, ≤ 0, enorme) | Los rechazan las validaciones de siempre, ANTES: la guardia solo juzga cantidades ya válidas. Ingrediente cuya MP no existe: lo reporta `validarIngredientes` antes. |
| **Cambio de permisos** | Sin cambios: el permiso se chequea antes y la confirmación no da permisos extra. |
| **Confirmación sin cantidad desproporcionada** | Se ignora (no hace nada). |
| **Cantidad cambiada después del aviso** | La pantalla descarta el aviso apenas se toca el formulario; el botón de confirmar reenvía exactamente lo que se avisó. Aunque llegara otro pedido, la confirmación viaja con la cantidad del mismo pedido. |
| **Ingrediente quitado / paso editado con un ingrediente viejo desproporcionado** | No se re-juzga (R3): puede seguir editándose la receta. |

## Nivel 8 — Acceso e interfaces

- Acciones públicas que reciben un parámetro final opcional `confirmaCantidadDesproporcionada` (booleano): `agregarIngredienteAReceta`, `actualizarIngredienteDeReceta` (central), `agregarIngredienteARecetaPropia`, `actualizarIngredienteDeRecetaPropia`. Las dos de quitar no lo necesitan.
- `ResultadoAccion` suma, solo en este rechazo, `requiereConfirmacion: true` (campo opcional: el resto de las pantallas no cambia). `FormConResultado` lo usa para ofrecer «Sí, es esa cantidad: guardar», que reenvía el MISMO pedido con `confirmaCantidadDesproporcionada=1`.
- El pedido de confirmación viaja en el `FormData` (`confirmarDesproporcion`); el servidor solo acepta el `true` estricto.

## Nivel 9 — Consultas y experiencia

- Debajo del campo de cantidad, texto llano: «Lleva 0,22 kg de Bife de nalga por cada unidad vendida de Milanesa con papas fritas.» (reutiliza `LecturaDeCantidad`; sin librerías). La unidad ya está pegada al campo; se agrega al texto en negrita.
- Mensaje de la guardia en un aviso de advertencia con el botón de confirmar, 375 px y escritorio (capturas con datos de maqueta: «Milanesa con papas fritas»).

## Nivel 10 — Pruebas, migración y operación

Migración: ninguna. Operación: los umbrales se ajustan en una constante.

**Dimensiones de la combinatoria** (cambian si un guardado se acepta o se rechaza): magnitud de la unidad (PESO / VOLUMEN / CANTIDAD) × unidad mayor o menor (kg·l·unidad / g·ml) × `seProduce` (sí / no) × cantidad (debajo / en / sobre el umbral) × confirmación (con / sin) × ingrediente (nuevo-cambiado / sin cambios). Oráculo escrito aparte: `test/catalogo/guardia-de-unidad.reglas.ts`; el test (`guardia-de-unidad.test.ts`) recorre TODAS las combinaciones contra esa tabla. Un guardián falla si aparece una columna nueva de `Unidad` o un valor nuevo de `MagnitudUnidad` sin declarar si afecta.

Pruebas (archivos): `test/catalogo/guardia-de-unidad.test.ts` + `.reglas.ts` (núcleo, oráculo, guardián), `guardia-de-unidad-servidor.test.ts` (base real), `guardia-de-unidad-pantalla.test.tsx` y `test/e2e/receta-guardia-de-unidad.spec.ts` (navegador). Núcleo puro (umbrales, mensaje exacto); caso de uso con base (rechaza sin confirmación aunque el cliente no valide, acepta con confirmación, idempotente, receta propia, «se produce» sin guardia, ruta a ciegas sin guardia, ingrediente existente no re-juzgado); pantalla (el mensaje y el botón de confirmar, el texto llano).

## Decisiones abiertas para el dueño

- Los umbrales (R1) y su múltiplo para g/ml (R2): ¿5 kg/l y 50 unidades están bien para su cocina? Se ajustan mirando las capturas.
- La redacción del mensaje (R7).
- ¿Dejar en la auditoría que la cantidad fue confirmada? (PENDIENTE, nivel 6).
