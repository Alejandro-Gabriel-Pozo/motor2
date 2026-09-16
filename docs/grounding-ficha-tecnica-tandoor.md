# Grounding: ficha técnica (método de preparación) contra Tandoor Recipes

Expediente de la diligencia técnica corrida el 2026-09-16 contra código real de
[Tandoor Recipes](https://github.com/TandoorRecipes/recipes) (clonado localmente,
rama `develop`, backend Django + DRF en `cookbook/`, frontend Vue 3 + Vuetify en
`vue3/`) — a diferencia de la comparativa contra ERPNext/Dolibarr de este mismo
proyecto (ver `docs/comparativa-ux-erpnext-dolibarr.md`, un tema DISTINTO — no se
tocó ese archivo), acá el objetivo es un sistema construido alrededor de "cómo se
cocina algo", no alrededor de inventario/BOM. Cada hallazgo cita archivo y línea
real leídos directamente del código clonado.

Convención: **VERIFICADO** = confirmado leyendo el código fuente citado. **NO
ENCONTRADO** = búsqueda exhaustiva sin resultado positivo (ausencia confirmada,
no simple desconocimiento).

---

## 1. Modelo de datos para instrucciones/pasos

**VERIFICADO** — Tandoor NO usa un campo de texto libre único para "cómo se
prepara". Usa una entidad `Step` separada, en relación muchos-a-muchos con
`Recipe`, ordenada explícitamente:

```python
# cookbook/models.py:961-987
class Step(ExportModelOperationsMixin('step'), models.Model, PermissionModelMixin):
    name = models.CharField(max_length=128, default='', blank=True)
    instruction = models.TextField(blank=True)
    ingredients = models.ManyToManyField(Ingredient, blank=True)
    time = models.IntegerField(default=0, blank=True)
    order = models.IntegerField(default=0)
    file = models.ForeignKey('UserFile', on_delete=models.PROTECT, null=True, blank=True)
    show_as_header = models.BooleanField(default=True)
    show_ingredients_table = models.BooleanField(default=True)
    search_vector = SearchVectorField(null=True)
    step_recipe = models.ForeignKey('Recipe', default=None, blank=True, null=True, on_delete=models.PROTECT)
    space = models.ForeignKey(Space, on_delete=models.CASCADE)
    ...
    class Meta:
        ordering = ['order', 'pk']
```

Y en `Recipe` (`cookbook/models.py:1086-1146`):

```python
# cookbook/models.py:1100-1102
steps = models.ManyToManyField(Step, blank=True)
working_time = models.IntegerField(default=0)
waiting_time = models.IntegerField(default=0)
```

Cada `Step` tiene: `name` (título corto, ej. "Marinar el pollo"), `instruction`
(texto — soporta Markdown, ver `get_instruction_render()` en
`cookbook/models.py:976-978`, que delega en `render_instructions` de
`cookbook/helper/template_helper.py`), `time` en minutos (un timer por paso, no
solo un tiempo total de receta), `order` (entero, define la secuencia), y
`ingredients` — su propio subconjunto de ingredientes vía M2M, exactamente el
caso "marinar con estos, salsa con estos otros" que menciona el pedido original.

`step_recipe` (línea 971) es un hallazgo extra no pedido explícitamente pero
relevante: un paso puede apuntar a OTRA `Recipe` completa como sub-receta
(composición de recetas — ej. "usar la Salsa Base [receta aparte] como este
paso"), ver sección 5.

## 2. Relación entre pasos e ingredientes

**VERIFICADO** — los ingredientes están atados al PASO, no a la receta
directamente. `Ingredient` (`cookbook/models.py:936-958`) no tiene ningún campo
`recipe` — se confirmó con grep exhaustivo sobre `cookbook/models.py`, cero
`ForeignKey(Recipe)` en `Ingredient`. El único camino de `Recipe` a
`Ingredient` es `Recipe.steps` (M2M) → `Step.ingredients` (M2M,
`cookbook/models.py:964`).

```python
# cookbook/models.py:936-949
class Ingredient(ExportModelOperationsMixin('ingredient'), models.Model, PermissionModelMixin):
    food = models.ForeignKey(Food, on_delete=models.CASCADE, null=True, blank=True)
    unit = models.ForeignKey(Unit, on_delete=models.SET_NULL, null=True, blank=True)
    amount = models.DecimalField(default=0, decimal_places=16, max_digits=32)
    note = models.CharField(max_length=256, null=True, blank=True)
    is_header = models.BooleanField(default=False)
    no_amount = models.BooleanField(default=False)
    order = models.IntegerField(default=0)
    original_text = models.CharField(max_length=512, null=True, blank=True, default=None)
```

Esto significa que la "lista plana de ingredientes" que muestra la mayoría de
las apps de recetas (y que motor2 tiene hoy en `RecetaIngrediente`) es, en
Tandoor, una VISTA derivada — agregación de todos los `Step.ingredients` de la
receta — no el modelo de origen. Se confirma en el frontend:
`vue3/src/components/display/StepsOverview.vue:77-137` calcula
`mergedIngredients` recorriendo `props.steps` y sumando por `food`+`unit`
(línea 120: `existingIngredient.amount += ingredient.amount`), exactamente para
reconstruir esa vista plana a partir de los pasos. `Recipe.show_ingredient_overview`
(`cookbook/models.py:1106`) es el flag que decide si esa vista resumen se
muestra o no. `is_header` (línea 942) también permite un ingrediente-separador
sin cantidad dentro de la lista de un paso (ej. "Para la salsa:").

`Ingredient` sí tiene `is_header`, `no_amount` y `original_text` — atributos que
motor2 no tiene y que no son parte de este pedido, se mencionan solo como
contexto del modelo.

## 3. Versionado/historial

**NO ENCONTRADO** — grep exhaustivo case-insensitive de `history`, `revision`,
`version` sobre `cookbook/models.py` y `cookbook/serializer.py`: cero
resultados relacionados a versionado del contenido de una receta. No hay
`HistoricalRecords` (django-simple-history), no hay `django-reversion`, no hay
ninguna tabla tipo `RecipeVersion`/`RecipeRevision`.

`Recipe` solo tiene `created_at` (`auto_now_add=True`) y `updated_at`
(`auto_now=True`) — `cookbook/models.py:1112-1113` — un timestamp de última
edición, nada más. Editar una receta (nombre, pasos, ingredientes) es un UPDATE
in-place vía `RecipeSerializer` (`cookbook/serializer.py:1193` en adelante, que
extiende `WritableNestedModelSerializer` — el patrón estándar de DRF para
escribir objetos anidados, reescribe/recrea los `Step`/`Ingredient` hijos en el
mismo `PATCH`/`PUT`). Existen sí modelos de *actividad* — `CookLog` (marca
"cociné esto tal día") y `ViewLog` (`cookbook/models.py:1492`, `:1520`) — pero
son bitácoras de uso, no snapshots del contenido de la receta en el tiempo.

**Contraste con motor2**: el `RecetaVersion` append-only de motor2
(`prisma/schema.prisma:414-425`, `guardarReceta` en
`src/server/actions/recetas.ts:45-86`) es una garantía más fuerte que la que
tiene Tandoor — Tandoor pierde la receta anterior al editar (solo queda
`updated_at`), motor2 conserva cada versión completa con su propio `id` y
`@@unique([productoId, version])`. Para un ERP de producción esto importa más
que para un recetario doméstico: una orden de producción ya ejecutada tiene
que poder mirar hacia atrás "con qué receta exacta se hizo esto", algo que
Tandoor ni necesita ni ofrece. **No hay nada que copiar de Tandoor en este
punto — motor2 ya está mejor acá**, mismo patrón de conclusión que la
comparativa ERPNext/Dolibarr tuvo con "motivo por línea" en conteo físico.

## 4. Cómo lo presenta la UI

**VERIFICADO** — pasos numerados y secuenciales, con ingredientes de ESE paso
visibles inline, cada uno con su propia card:

```vue
<!-- vue3/src/components/display/StepView.vue:1-20 -->
<v-card-title>
    <span v-if="step.name">{{ step.name }}</span>
    <span v-else>{{ $t('Step') }} {{ props.stepNumber }}</span>
    ...
    <v-btn v-if="step.time != undefined && step.time > 0" @click="timerRunning = true">
        <i class="fas fa-stopwatch mr-1 fa-fw"></i> {{ step.time }}
    </v-btn>
```

`StepView.vue:23-34` pone, lado a lado, la tabla de ingredientes de ESE paso
(`ingredients-table v-model="step.ingredients"`, condicionada a
`step.showIngredientsTable`) y las instrucciones del paso
(`instructions_html="step.instructionsMarkdown"`). `StepView.vue:37-48` renderiza
recursivamente los pasos de una sub-receta (`step.stepRecipe`) dentro de la
misma card, anidado. Hay un checkbox por paso para tacharlo como hecho
("cocinar en modo guiado", `stepChecked`, línea 14-16 y 21) y un timer real por
paso (`Timer.vue`, arrancado desde el botón de tiempo).

`RecipeView.vue` (contenedor de toda la vista) muestra tres métricas de
cabecera separadas — `working_time` (tiempo activo), `waiting_time` (tiempo de
espera — reposo/horneado/marinado, sin trabajo activo), y `servings` — y un
`recipe-scaling-dialog` que, al confirmar una nueva cantidad de porciones,
recalcula un factor:

```javascript
// vue3/src/components/display/RecipeView.vue:238-239
const ingredientFactor = computed(() => {
    return servings.value / ((recipe.value.servings != undefined) ? Math.max(recipe.value.servings, 1) : 1)
})
```

Ese `ingredientFactor` se pasa a CADA `step-view`/`steps-overview`
(`RecipeView.vue:141,145`), que a su vez lo pasa a `ingredients-table` — las
cantidades de TODOS los pasos escalan en vivo al cambiar porciones, sin volver
al servidor. También hay un toggle "Structured vs. Summary"
(`StepsOverview.vue:10-21`, `recipe_mergeStepOverview`) para alternar entre ver
los ingredientes agrupados por paso o la lista plana fusionada — cubre tanto al
usuario que quiere ver "qué necesito para cada etapa" como al que solo quiere
"la lista de compras total".

## 5. Otras ideas estructurales relevantes

- **Receta-como-paso (`step_recipe`)** — `cookbook/models.py:971`, ya citado.
  Un `Step` puede señalar a otra `Recipe` en vez de (o adicionalmente a) tener
  su propia `instruction`. Esto es composición jerárquica real: una receta de
  "Lasaña" puede tener un paso "Preparar la salsa boloñesa" que ES la receta
  "Salsa Boloñesa" completa, con sus propios pasos e ingredientes, reusada tal
  cual. El backend expone esto con `get_related_recipes`
  (`cookbook/models.py:1124-1137`, recorre `step_recipe` para armar el grafo de
  recetas relacionadas) y `StepRecipeSerializer`
  (`cookbook/serializer.py:1089-1094`).
  **Relevancia directa para motor2**: motor2 YA tiene el equivalente de esto a
  nivel de PRODUCTO — una MP con `seProduce=true` (ej. una salsa base) puede
  tener su propia `RecetaVersion`, y esa MP se usa como `insumoProducto` en la
  receta de un PV (ej. la lasaña la "compra" como insumo). El BOM multinivel ya
  existe. Lo que Tandoor añade es que un PASO puede referenciar directamente
  esa sub-receta con su propio método (no solo "restale stock de este insumo",
  sino "para ver cómo se prepara este insumo, mirá su propia ficha técnica
  acá mismo, en línea"). Es una idea de PRESENTACIÓN (link/expansión en la UI
  del paso), no exige un cambio de modelo — motor2 ya puede resolverlo: un
  paso que consume la MP-que-se-produce puede, en la UI, linkear a
  `/catalogo/recetas/[insumoProductoId]`.

- **`show_as_header` vs. paso normal** (`cookbook/models.py:968`) — un `Step`
  puede marcarse como encabezado de sección visual ("Para la masa", "Para el
  relleno") sin ser en sí mismo un paso ejecutable, usado para agrupar una
  tanda de pasos bajo un título común en la UI (`StepsOverview.vue:26`: `<b
  v-if="s.showAsHeader">{{ i + 1 }}. {{ s.name }}</b>`). Alternativa liviana a
  crear una entidad "Sección" separada — NO se está recomendando copiarlo
  (ver alcance de la propuesta abajo), pero se deja registrado como opción
  descartada conscientemente.

- **Archivo adjunto por paso** (`file` FK a `UserFile`,
  `cookbook/models.py:967`) — una foto o PDF por paso (ej. "así se ve el punto
  de cocción"). Fuera de alcance para esta propuesta (motor2 no tiene modelo
  de adjuntos hoy), se menciona solo como idea a futuro, no parte de la
  propuesta concreta de abajo.

## 6. Segunda referencia: Fudo (documentación de soporte — NO código fuente)

**Aclaración de rigor, distinta a las secciones 1-5**: Fudo es un POS de
gastronomía cerrado (muy usado en Argentina) — no hay repositorio para leer.
Lo de acá está sacado de capturas de pantalla reales de su documentación de
ayuda pública (`soporte.fu.do`), que el usuario compartió. Es "así lo describe
el vendor en su ayuda", no "así lo verifiqué en su código" — mismo peso que
una fuente secundaria, no primaria. Sirve igual porque es un sistema real,
hecho específicamente para gastronomía (a diferencia de Tandoor, que es un
recetario doméstico), y confirma/afina varias cosas de la sección 5.

Su "ficha técnica" tiene dos pantallas:

**Cabecera** (campos planos, no una lista de pasos):
- Nombre, Categoría — **ya existen en motor2** como `Producto.nombre`/
  `Producto.categoriaId` (no hay que duplicarlos en la receta).
- **Rendimiento** ("1 unidad") — cuánto produce la receta ENTERA. Distinto
  de:
- **N° de raciones** ("8 porciones") — en cuántas porciones se divide ese
  rendimiento.
- **Tamaño de la ración** ("150g, una porción") — el peso/cantidad de CADA
  porción.
- **Comentarios** — texto libre a nivel de toda la ficha (ej. "se puede
  congelar hasta 48h"), distinto de las instrucciones paso a paso.

Estos tres primeros (Rendimiento/Raciones/Tamaño de ración) son un hallazgo
real que ni Tandoor ni la propuesta original tenían separado así — Tandoor
solo tiene `servings` (un número), sin distinguir "cuánto rinde en total" de
"tamaño de cada porción".

**Detalles de elaboración** (la parte equivalente a los `Step` de Tandoor):
- Tiempo de preparación / Tiempo de cocción — con una aclaración explícita en
  la propia ayuda de Fudo: *"Este tiempo no afecta lo configurado en el
  Monitor de cocina (KDS). Es solo informativo dentro de la ficha técnica."*
  — confirma lo que ya se asumía en la sección 4/5: puede ser puramente
  informativo, sin que el sistema tenga que integrarlo con nada en vivo.
- **Pasos del procedimiento** — lista ordenada, "agrega uno a uno". A
  diferencia de Tandoor, los ejemplos de Fudo muestran los pasos como texto
  plano simple, SIN volver a atar un subconjunto de ingredientes a cada
  paso — más simple que el M2M de Tandoor.
- **Presentación o emplatado** — sección PROPIA, separada de "Pasos del
  procedimiento". Cómo se sirve el plato, no cómo se cocina. Tandoor no
  distingue esto (todo es "steps"); Fudo sí, como dos listas con propósito
  distinto.
- **Notas adicionales** — otro texto libre, a nivel de la elaboración (no
  de la cabecera — Fudo tiene notas en dos lugares distintos).
- **Equipamiento necesario** — lista de herramientas/equipos (ej. "Horno
  pizzero", "Tabla de corte", "Cuchilla o cortapizza"). No existe en Tandoor
  ni en la propuesta original — hallazgo nuevo.

### Ajuste a la propuesta original, a partir de Fudo

1. **Sumar los campos de cabecera** (Rendimiento, Raciones, Tamaño de
   ración, Comentarios) como escalares en `RecetaVersion` — no ameritan una
   tabla propia, son 1-a-1 con la versión de receta, igual que ya lo son
   `version`/`creadoEn`.
2. **Presentación/emplatado, Notas adicionales y Equipamiento necesario**:
   texto libre (una caja de texto con salto de línea = un ítem, mismo
   patrón visual que muestra Fudo), NO una tabla `RecetaPaso`-clon para
   cada uno. Ninguna de las tres necesita orden numerado con tiempo/
   ingredientes propios — eso es exactamente lo que sí justifica una tabla
   aparte para "Pasos del procedimiento" (`RecetaPaso`), y no lo que
   justificaría triplicar esa misma estructura para secciones que en la
   práctica son notas cortas.
3. **`RecetaPasoIngrediente` (el M2M paso↔ingrediente) se mantiene, pero
   pasa a ser explícitamente OPCIONAL en la práctica, no solo en el
   schema.** Fudo (un sistema realmente usado por cocinas) ni lo ofrece —
   sus pasos son texto plano. La tabla puente ya era opcional a nivel de
   dato (una fila de `RecetaPaso` puede tener cero filas en
   `RecetaPasoIngrediente`); con esta referencia queda claro que ESE va a
   ser el caso común, no la excepción — la mayoría de los pasos van a ser
   simples instrucciones de texto, y solo alguno puntual (el caso real que
   motivó todo esto: "marinar con esto, salsa aparte") va a necesitar
   marcar qué ingredientes le corresponden.

---

## PROPUESTA para motor2

### Alcance

Agregar SOLO lo necesario para que una receta tenga, además de la lista de
ingredientes que ya existe:

- Un puñado de campos de cabecera (rendimiento, raciones, tamaño de ración,
  tiempo de preparación/cocción, comentarios) — informativos, sección 6.
- Una lista ORDENADA de pasos de preparación (`RecetaPaso`), cada uno con
  nombre corto, instrucción, tiempo opcional, y — replicando el hallazgo
  más importante de la sección 1/2 — un subconjunto OPCIONAL de los
  ingredientes de esa misma versión de receta (opcional en el uso real, no
  solo en el schema — sección 6).
- Tres campos de texto libre (presentación/emplatado, notas adicionales,
  equipamiento necesario) — sin estructura propia, ver sección 6.

No se propone: sub-recetas como paso (ya resuelto por el BOM existente + un
link, sección 5), pasos-como-encabezado-de-sección, archivos adjuntos por
paso, ni escalado de porciones (motor2 es un ERP de producción con lotes/
órdenes reales, no un recetario para cocinar en casa — escalar "porciones"
no es un caso de uso declarado hoy; si aparece, es una extensión de UI sobre
este mismo modelo, no un cambio de esquema).

### Schema Prisma (adición mínima)

```prisma
model RecetaPaso {
  id              String        @id @default(cuid())
  recetaVersionId String
  recetaVersion   RecetaVersion @relation(fields: [recetaVersionId], references: [id], onDelete: Cascade)
  orden           Int
  nombre          String?
  instruccion     String
  minutos         Int?

  ingredientes    RecetaPasoIngrediente[]

  @@index([recetaVersionId])
}

model RecetaPasoIngrediente {
  id                  String              @id @default(cuid())
  recetaPasoId        String
  recetaPaso          RecetaPaso          @relation(fields: [recetaPasoId], references: [id], onDelete: Cascade)
  recetaIngredienteId String
  recetaIngrediente   RecetaIngrediente   @relation(fields: [recetaIngredienteId], references: [id], onDelete: Cascade)

  @@unique([recetaPasoId, recetaIngredienteId])
}
```

Y en `RecetaVersion` (`prisma/schema.prisma:414-425`), los campos de
cabecera (sección 6) más la relación a pasos — todos escalares u opcionales,
ninguno rompe una receta ya cargada:

```prisma
model RecetaVersion {
  ...
  ingredientes RecetaIngrediente[]
  pasos        RecetaPaso[]   // NUEVO

  // NUEVO — cabecera informativa (sección 6, grounded contra Fudo):
  rendimientoCantidad     Decimal? @db.Decimal(14, 4)
  rendimientoUnidadId     String?
  rendimientoUnidad       Unidad?  @relation(fields: [rendimientoUnidadId], references: [id])
  racionesCantidad        Int?
  racionTamano            Decimal? @db.Decimal(14, 4)
  racionUnidadId          String?
  racionUnidad            Unidad?  @relation(fields: [racionUnidadId], references: [id])
  tiempoPreparacionMinutos Int?
  tiempoCoccionMinutos     Int?
  comentarios             String?
  presentacionEmplatado   String? // texto libre, sin estructura propia — ver sección 6
  notasAdicionales        String? // texto libre, distinto de `comentarios` (Fudo los separa)
  equipamientoNecesario   String? // texto libre, un renglón = un ítem
  ...
}
```

Y en `RecetaIngrediente` (línea 427), el lado inverso de la relación (línea
extra, sin tocar ningún campo existente):

```prisma
model RecetaIngrediente {
  ...
  enPasos RecetaPasoIngrediente[]   // NUEVO
}
```

**Por qué una tabla puente (`RecetaPasoIngrediente`) y no un `pasoId` opcional
directo en `RecetaIngrediente`**: Tandoor usa M2M real (`Step.ingredients =
ManyToManyField(Ingredient)`, `cookbook/models.py:964`) precisamente porque un
mismo ingrediente puede — aunque sea un caso raro — participar de más de un
paso (ej. "sal" usada tanto para blanquear las papas como para la salsa
final). Un FK simple forzaría 1 ingrediente = 1 paso exactamente. La tabla
puente preserva la flexibilidad real de Tandoor sin duplicar filas de
`RecetaIngrediente` (que siguen siendo la fuente de verdad de cantidad/
unidad/merma — el paso solo referencia, no repite, la cantidad).

**Por qué NO copiar `is_header`/`no_amount`/`original_text` de `Ingredient`**:
son campos para import/scraping de recetas de texto libre de internet — no
existe ese caso de uso en motor2 (los ingredientes se cargan a mano contra el
catálogo de MPs real). Fuera de alcance.

### UI en `/catalogo/recetas/[productoId]`

Sobre `src/app/(app)/catalogo/recetas/[productoId]/page.tsx` (hoy: una sola
tabla de ingredientes, líneas 71-157, y un form de alta, líneas 159-195):

- **Cabecera** (sección 6/Fudo), arriba de la tabla de ingredientes: un
  bloque compacto con Rendimiento (cantidad + unidad), Raciones, Tamaño de
  ración (cantidad + unidad), Tiempo de preparación/cocción (minutos) — 
  todos opcionales, en blanco por defecto, no bloquean nada si no se
  completan. `Comentarios` como textarea corta debajo.
- Debajo de la tabla de ingredientes existente, agregar una sección
  "Método de preparación" — lista numerada de `vigente.pasos` (ordenados por
  `orden`), cada fila mostrando: número, nombre (si tiene), instrucción,
  minutos (si tiene), y — replicando `StepView.vue:23-26`, SOLO si el paso
  tiene alguno — la sub-lista de ingredientes de ESE paso (nombre + cantidad
  + unidad, solo lectura, tomados de `RecetaIngrediente` vía `enPasos`). La
  mayoría de los pasos no van a tener esta sub-lista (sección 6) — la fila
  simplemente no la muestra en ese caso, no hay que forzar nada.
- Un form "Agregar paso" (mismo patrón que el form "Agregar ingrediente" ya
  existente, líneas 159-195): textarea de instrucción, input opcional de
  nombre corto y minutos, y un multi-select de checkboxes con los ingredientes
  YA cargados en la receta vigente, **marcado explícitamente como opcional**
  ("¿Este paso usa solo algunos ingredientes en particular? — opcional,
  dejalo vacío si no aplica") — no tiene sentido ofrecer marcar ingredientes
  que todavía no existen, se agrega el ingrediente primero, el paso después.
- Cada paso editable/eliminable con el mismo patrón `?editar=` que ya usan
  las filas de ingredientes (líneas 84-119 del archivo actual) — reusa la
  convención de URL existente, no inventa una nueva.
- Reordenar pasos: un `orden` numérico editable simple (no hace falta
  drag-and-drop tipo `vue-draggable` de Tandoor —
  `StepEditor.vue:59` — para este alcance; se puede agregar después sin tocar
  el schema).
- **Presentación/emplatado, Notas adicionales, Equipamiento necesario**
  (sección 6/Fudo): tres textareas simples, debajo de "Método de
  preparación" — un renglón = un ítem, sin botones de "Agregar"/"Quitar"
  individuales (a diferencia de los pasos, no necesitan orden numerado ni
  edición fila por fila).

### Interacción con el versionado append-only — recomendación

**Recomendación: los pasos viven en la MISMA `RecetaVersion` que los
ingredientes — editar cualquiera de los dos genera una nueva versión, igual
que hoy.** Razones:

1. **Consistencia con el propio diseño de motor2, no con Tandoor.** El
   comentario de `guardarReceta` en `src/server/actions/recetas.ts:38-44` es
   explícito: versionado append-only real, nunca se pisa una versión vieja. El
   motivo de fondo (ver el comentario en `RecetaIngrediente`,
   `prisma/schema.prisma:431-433`, y el propio historial de
   `agregarIngredienteAReceta`/`actualizarIngredienteDeReceta`) es poder mirar
   atrás "con qué receta exacta se hizo esta producción". Un método de
   preparación es PARTE de esa misma foto: si se cambia la receta de
   "marinar 2 horas" a "marinar 4 horas", eso es tan parte de "qué versión de
   receta se usó" como cambiar la cantidad de sal. Separar el versionado de
   pasos del de ingredientes crearía dos relojes de versión independientes
   para la MISMA receta — "¿con qué ingredientes Y qué pasos se hizo el lote
   del martes?" dejaría de tener una respuesta única y auditable.
2. **Tandoor no es un buen precedente para esta decisión específica** — la
   sección 3 ya estableció que Tandoor NO versiona nada, edita todo in-place.
   No hay ahí ninguna señal de "separar el versionado de pasos e
   ingredientes" para adaptar — es un problema que Tandoor no tiene.
3. **Costo de implementación**: como `RecetaPaso` cuelga de `recetaVersionId`
   igual que `RecetaIngrediente`, el mecanismo de `guardarReceta` (recrear
   TODA la versión con snapshot completo de items, `src/server/actions/
   recetas.ts:59-83`) se extiende sin reescribirlo — pasa a recibir también
   `pasos: PasoInput[]` y los crea anidados igual que hoy crea
   `ingredientes: { create: [...] }`. Ninguna función existente
   (`obtenerRecetaVigente`, `agregarIngredienteAReceta`,
   `actualizarIngredienteDeReceta`) cambia de forma, solo de payload.

**Nota de alcance**: esto sigue siendo una recomendación de diseño con su
razonamiento, no una implementación — no se modificó `schema.prisma` ni
ningún archivo de código como parte de esta investigación ni de su
actualización posterior con Fudo (sección 6), según lo pedido.
