# Diseño: promo que muestra SOLO lo permitido (productos y opciones), con elección del mozo dentro de lo permitido — 2026-11-04

**Alcance corregido por el dueño (2026-11-04, vía coordinación; reemplaza la primera versión de este documento).** El problema no es QUIÉN puede usar la promo sino QUÉ puede elegir el mozo DENTRO de ella. Palabras del dueño (resumidas): «hoy el mozo se podría equivocar eligiendo una promoción que no es; para eso no necesito establecer ningún cliente. Lo que quiero es que, si elige la promoción correcta (por ejemplo "Promo Empresa 1", como hoy), vea SOLO lo que se puede sacar por mesa con esa promo: dentro de Platos principales solo los bifes; dentro de Bebidas solo agua o agua saborizada. Es "para esta empresa tenemos este menú", a través de esa promoción. Después la promo capaz pasa al convenio, pero hoy ya funcionaría así. También: si armo una promo temática (Halloween, con galletitas con un nombre determinado), que nada se salga de la temática.» **CONFIRMADA** (dicho por el dueño). La asignación de la promo a la cuenta sigue **manual, como hoy**; reservar la promo a una empresa o convenio queda para después (§8, N2) y **sin** la tabla `PromoCartaCliente` de la primera versión.

**Estado: SOLO DISEÑO Y MAQUETA.** Sin código, sin migraciones, sin tests, sin PR. Nada se implementa hasta que el dueño apruebe viendo la maqueta (`/home/user/revision-del-dueno/promo-subconjunto/index.html`; en `docs/` solo se admiten `.md`, la maqueta no se versiona acá). Estados: **CONFIRMADA** (dicha por el dueño), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

Fuentes leídas en el código real (rama `alegp/diseno-promo-subconjunto`, desde `origin/main`): `prisma/schema.prisma`, `src/core/pos/promo-combo.ts`, `src/core/pos/linea-configurada.ts`, `src/core/pos/componente-de-combo.ts`, `src/core/carta/piso-de-promo.ts`, `src/server/actions/pos/casos-de-uso/agregar-items.ts`, `src/server/lecturas/pos/promo-para-agregar.ts`, `src/server/lecturas/pos/entradas-de-promo-para-vender.ts`, `src/server/actions/carta/casos-de-uso/guardar-cupos-promo-carta.ts`, `src/app/(pos)/mesas/[mesaId]/armar-promo.tsx`, `docs/adr/ADR-030`, `ADR-032` y `ADR-035`. **NO VERIFICADA** la base de producción: el producto «BIFE-» y sus grupos son los que describió la coordinación; no leí ninguna base. Tampoco está en esta sesión el repositorio `motor2-docs` (puede haber un plan aprobado allá).

---

## 0. Resumen para el dueño (lenguaje de proceso)

1. **Halloween ya funciona hoy.** Una promo temática con un lugar «Galletitas» de tipo LISTA y las galletitas como entradas es «solo lo de la promo»: el mozo no ve ni puede mandar otra cosa.
2. **«Solo los bifes» y «solo agua o agua saborizada» también se pueden armar hoy, con un costo alto:** el bife es un producto «se vende por opción» (con tamaño o preparación obligatoria) y hoy una promo solo lo acepta como entrada con la configuración **fija** que cargó el dueño (decisión D-6 de ADR-032): el mozo no elige. Para el bife real (2 preparaciones × 2 proteínas × 3 guarniciones) hacen falta **12 entradas** cargadas a mano, y 36 filas de opciones.
3. **En un lugar de tipo «sección» el mozo ve todos los productos de la sección** (no solo los bifes), y un producto con opción obligatoria ni se puede armar ahí.
4. **Propuesta más barata (lo que el dueño quiere AHORA):** que una entrada de la lista pueda marcarse «el mozo elige entre estas opciones» (en vez de una configuración fija). El bife pasa de **12 entradas a 1**, sin tabla nueva y con **una sola columna**. «Solo los bifes» se resuelve listando los bifes (1 o pocos), lo que hoy ya existe.
5. **Seguridad de «que no se equivoque»:** el selector solo muestra lo permitido y el servidor vuelve a validar con la **misma** regla que ya valida las opciones de una venta suelta, filtrada a lo permitido por la promo. Fail-closed.
6. **Esto enmienda una decisión de ADR-032 (D-6):** el mozo hoy no elige opciones dentro del combo. Pasa a poder hacerlo, **solo** en las entradas que el dueño marque «a elegir» y **solo** entre lo que permitió. El precio de la promo (por ejemplo $55.000) sigue fijo.

---

## 1. Inventario: qué existe hoy y qué parte del pedido ya se resuelve (con archivo y línea)

| Pieza | Dónde | Qué hace hoy |
|---|---|---|
| Promo y lugares (cupos) | `prisma/schema.prisma:2008` (`PromoCarta`), `:2096` (`PromoCartaCupo`) | Cada promo tiene lugares con mínimo y máximo. Tipos: `SECCION` (**todos** los elegibles de una sección de la carta), `LISTA` (productos que arma el dueño, aunque no estén en la carta) y `DEL_DIA`. |
| Entradas de un lugar LISTA | `:2128` (`EntradaDeCupo`), `:2151` (`OpcionDeEntradaDeCupo`) | Producto + **configuración fija** opcional de opciones. La identidad (lugar, producto, configuración) es inmutable (clave `claveConfiguracion`); se desactiva, no se edita. |
| Lo que el mozo puede elegir | `src/core/pos/promo-combo.ts:148`-`:259` (`validarYAplanarEleccionPromo`, `aplanarCupoDeEntradas`) | En un lugar de entradas solo las **elegibles hoy** («Esa opción de "<lugar>" no está disponible hoy en esta promo.», `ENTRADA_NO_DISPONIBLE`, `:236`); en un lugar de sección solo las de esa sección («Ese producto no es una opción válida de "<sección>" en esta promo.», `:213`). Mínimo y máximo, cantidades enteras, sin repetidos. |
| El servidor revalida | `agregar-items.ts:201` (carga), `:205` (`PROMO_CAMBIO`), `:210` (valida), `:223` (`PROMO_CON_OPCIONES`) | SERIALIZABLE, todo o nada, clave de reintento opcional. La promo se lee con **la misma fuente** que el selector (`promo-para-agregar.ts`). |
| Un componente con opciones, v1 | `agregar-items.ts:223`, `armar-promo.tsx` (`noSeArman`) | En un lugar de sección, un producto con grupo obligatorio no se arma («pedilo suelto»); con grupos opcionales entra **sin** opciones. |
| Lo elegible hoy en una lista | `entradas-de-promo-para-vender.ts` | Entrada activa, producto disponible en la sucursal, componente válido (PV, precio de referencia ≥ $0,01, origen de stock: receta o stock propio, D-8/D-9) y configuración fija **armable hoy** con `armarLineaConfigurada`. |
| Línea con opciones | `src/core/pos/linea-configurada.ts:132` (`armarLineaConfigurada`), `src/core/opciones/validar-opciones-elegidas.ts` | Recibe **qué grupos y opciones admite el producto en la sucursal** (`grupos`) y **lo elegido** (`elegidas`); valida mínimos, máximos, opciones apagadas y la versión que vio el mozo; compone el precio de lista; arma la foto de lo elegido y el consumo de insumos. **Es la pieza reutilizable**: «solo estas opciones» = pasarle una lista de `grupos` más corta. |
| Escritura de un componente configurado | `agregar-items.ts` (bloque `componentesConfigurados`) | Un componente con configuración se escribe como línea configurada colgada de su `PromoCuenta`, con foto de opciones. Ya existe para la configuración fija. |
| Precio de la promo | `src/core/pos/promo-combo.ts:333` (`prorratearPrecioPromo`), `src/core/carta/piso-de-promo.ts` | El precio congelado de la promo se reparte entre los componentes elegidos en proporción al precio de lista de cada unidad; el piso es $0,01 por unidad en el peor caso (suma de **máximos de unidades**, no depende de qué se elija). |
| Producto «se vende por opción» | `docs/adr/ADR-035` (`Producto.modoDeVenta = BASE_CONFIGURABLE`) | El precio sale de la medida en ABSOLUTO que se elija; el guardado de la base no se usa. Una base no puede estar en un ítem agrupado ni respaldar un adicional. |
| Opciones que admite un producto | `:3549` (`GrupoDeOpciones`: tipos `MEDIDA`, `VARIANTE`, `INCLUIDA`, `ADICIONAL`), `:3580` (`OpcionDeGrupo`), `:3678` (`ProductoAdmiteGrupo`), `:3710` (`ProductoAdmiteOpcion`) | Qué grupos y qué opciones admite cada producto, con mínimos, máximos y precios. |
| Permiso de definir cupos | `src/core/permisos/acciones.ts:75` (`carta_promo_definir`) | Empresa, piso administrador. |

### 1.1 Lo que el pedido necesita y NO existe

| Necesidad | ¿Existe? | Evidencia |
|---|---|---|
| El mozo elige opciones dentro de lo permitido en un combo | **No, por D-6** | `ADR-032` línea 20 (D-6); `agregar-items.ts:223`. |
| «De esta sección, SOLO estos productos» | **No** | `promo-para-agregar.ts` (bloque `deSeccion`): un lugar de sección ofrece todos los elegibles de su sección. El camino hoy es una LISTA con cada producto a mano. |
| «Solo estas opciones» sin cargar cada combinación | **No** | Cada combinación de opciones es una entrada distinta (`@@unique([cupoId, productoId, claveConfiguracion])`). |

### 1.2 Qué ya funciona hoy (N0, sin código)

- **Halloween:** promo temática con un lugar LISTA «Galletitas» cuyas entradas son las galletitas con nombre propio (productos de venta con precio de referencia y origen de stock, D-8/D-9). Lo que no está en la lista no se ve y el servidor lo rechaza. **Resuelto.**
- **Bebidas «solo agua o agua saborizada»:** lugar LISTA con «Agua» y «Agua saborizada». Si «agua saborizada» tiene sabores como opciones, cada sabor es una entrada más.
- **Platos principales «solo los bifes»:** lugar LISTA con el bife como entrada, **pero** con una entrada por cada combinación de opciones (§3).

---

## 2. Escalera de diseño (niveles 1 a 5)

### Nivel 1. Propósito y alcance
- **Propósito (CONFIRMADA):** que, elegida la promo correcta, el mozo vea y pueda elegir **solo** lo que esa promo permite (productos y, dentro del producto, opciones), y no pueda salirse de ahí. Ejemplos del dueño: «Promo Empresa 1» ($55.000, platos principales solo bifes, bebidas solo agua o agua saborizada) y «Halloween» (galletitas temáticas).
- **Necesidad escrita:** pedido del dueño del 2026-11-04 (arriba) y, más atrás, «marcar para qué cliente o agencia es un menú» (pendientes 2026-10-22, 14.ª parte), de la que **solo** se resuelve la parte del contenido del menú.
- **Fuera de alcance (CONFIRMADA):** reservar la promo a una empresa o convenio (después, N2), descuentos por cliente, convenios completos, que la cuenta de la empresa solo admita lo pactado.

### Nivel 2. Actores y contexto
| Actor | Qué hace | Permiso |
|---|---|---|
| Administrador de la empresa | Arma la promo, sus lugares, qué productos y qué opciones se permiten | `carta_promo_definir` (empresa, administrador). **PROPUESTA:** sin clave nueva. |
| Gerente de sucursal | Prende la promo en su sucursal | `carta_promo_activar` (sin cambios) |
| Mozo | Elige la promo y arma lo permitido | `pos_tomar_pedido` (piso operario, sin cambios) |
| Servidor | Revalida todo al agregar | — |
Contexto: la promo es de la empresa y se prende por sucursal; las opciones se pueden **apagar por sucursal** (`OpcionApagadaEnSucursal`); la carta, las recetas y el stock son por sucursal; el día es el de la zona de la empresa; módulo `promociones`.

### Nivel 3. Casos de uso
| # | Caso de uso | Etapa |
|---|---|---|
| CU1 | Armar una promo temática (lugar LISTA con entradas fijas, p. ej. Halloween) | N0, existe |
| CU2 | Cargar el bife como UNA entrada «el mozo elige» con las opciones permitidas por grupo | N1 |
| CU3 | Ver en el selector solo lo permitido y elegir dentro de eso | N1 |
| CU4 | Agregar la promo a la cuenta: el servidor revalida productos y opciones elegidas | N0 existe; la parte «opciones elegidas» es N1 |
| CU5 | Cambiar lo permitido de una entrada (agregar una guarnición permitida) | N1 |
| CU6 | De una sección, «solo estos productos» sin listarlos como entradas | N1b (solo si el dueño lo pide, §4) |
| CU7 | Reservar la promo a una empresa o convenio | N2 (después, sin tabla propia) |

### Nivel 4. Conceptos y ciclo de vida
- **Entrada de lista:** un producto elegible de un lugar. Hoy con modo de opciones `FIJAS`. **Nuevo (PROPUESTA):** modo `A_ELEGIR`.
- **Entrada «a elegir» (`A_ELEGIR`):** el producto más, por grupo, las **opciones permitidas** (las que el mozo puede elegir). La identidad de la entrada incluye el conjunto de permitidas (como hoy incluye la configuración fija): cambiar lo permitido es **otra entrada** y la anterior se desactiva (la regla de la casa: solo se agrega).
- **Opciones permitidas efectivas** (lo que ve y puede mandar el mozo, calculado en el momento): las permitidas de la entrada ∩ las que el producto admite ∩ las que no están apagadas en la sucursal. Si un grupo obligatorio se queda sin ninguna opción, la entrada **no es elegible** (falla cerrado: no se ofrece ni se acepta).
- **Lo elegido por el mozo:** por entrada, una o más **configuraciones** (cada una con sus opciones y su cantidad). Dos configuraciones distintas del mismo producto son dos líneas (igual que dos configuraciones de una entrada fija hoy, `claveDeComponenteConfigurado`).
- **Ciclo:** `entrada creada` → `ofrecida hoy` (elegible) → `elegida por el mozo` → `agregada a la cuenta` (precio, componentes, foto de opciones **congelados**, I5) → eventualmente `desactivada` (la entrada se da de baja; lo ya cargado no cambia).

### Nivel 5. Invariantes y políticas
| # | Invariante | Lo impone | Estado |
|---|---|---|---|
| I1 | Un componente que no es elegible hoy en el lugar nunca entra a la cuenta | `validarYAplanarEleccionPromo`, ya existente | EXISTE |
| I2 | En una entrada `A_ELEGIR` solo se acepta una opción que esté entre las permitidas efectivas; cualquier otra se rechaza **antes de escribir** | `armarLineaConfigurada` recibiendo `grupos` filtrados a lo permitido (la misma función que valida una venta suelta) | PROPUESTA |
| I3 | El selector del mozo y el servidor usan **la misma** lista de permitidas efectivas (una sola función de lectura) | `cargarEntradasDePromoParaVender`, compartido; test de paridad como `promo-combo-consulta` | PROPUESTA |
| I4 | El precio de la promo es fijo: elegir otra opción **nunca** cambia el total cobrado, solo el reparto entre componentes | `prorratearPrecioPromo` + `repartirImporte` (existe; el total siempre es exacto) | EXISTE; PROPUESTA aplicarlo a las entradas `A_ELEGIR` |
| I5 | Lo agregado a la cuenta (precio, componentes, opciones elegidas) no cambia si después cambia lo permitido, se apaga una opción o cambia la sección | la lectura es al agregar, nunca al cerrar (como la vigencia, ADR-032 D-7) | EXISTE (precio); PROPUESTA (opciones) |
| I6 | En una entrada `A_ELEGIR` **no se permite** un grupo `ADICIONAL` (el recargo rompería el precio fijo y agrega una línea hija con su propio stock) | caso de uso al guardar y al leer | PROPUESTA (pregunta 3) |
| I7 | Si el mozo elige con una versión de opción que cambió desde que la vio: se rechaza («volvé a mirarla») | `OPCION_CAMBIO` (existe para ventas sueltas) | EXISTE; PROPUESTA aplicarlo |
| I8 | Una entrada `A_ELEGIR` solo se puede guardar si existe al menos una configuración armable con precio de referencia ≥ $0,01 y origen de stock (D-8/D-9); y cada **elegida** se vuelve a validar al agregar | `rechazoDeComponenteDeCombo` sobre la configuración elegida | PROPUESTA |
| I9 | Toda alta, baja o cambio de lo permitido deja auditoría en la misma transacción; las entradas y sus opciones nunca se borran | `registrarCambioAuditado`; privilegios sin DELETE | EXISTE (patrón) |
| I10 | Aislamiento por empresa y permiso verificado en el servidor | RLS y `carta_promo_definir` | EXISTE |

**Políticas:** sin claves nuevas. Con el módulo `promociones` apagado no se ofrece ni se acepta nada (como hoy).

---

## 3. El caso real: el bife (cuántas entradas explota cada alternativa)

Caso descrito por la coordinación (**NO VERIFICADA** contra la base): producto interno «BIFE-» **se vende por opción** (`BASE_CONFIGURABLE`) con tres grupos: **Preparación** (MEDIDA, obligatoria, elige 1: «Bife a criolla», «Bife con chimichurri»), **Proteína** (elige 1: Nalga, Bife de chorizo) y **Guarniciones** (elige 1: Puré, Ensalada, Papas fritas). Promo «Menú Empresa 1» a $55.000.

| Alternativa | Qué se carga | Entradas | Filas de opciones | Qué ve el mozo | Costo de agregar una guarnición nueva («Arroz») |
|---|---|---|---|---|---|
| **A. LISTA fija (hoy, D-6)** | Una entrada por combinación | **12** (2×2×3) | **36** (3 por entrada) | 12 renglones largos | +4 entradas y +12 filas (2×2×1) |
| A'. LISTA fija, «hasta 2 guarniciones distintas» | Una entrada por combinación | **24** (2×2×(3+3)) | 24×(2 a 4) | 24 renglones | crece más |
| **B. LISTA con entrada «a elegir» (recomendada)** | UNA entrada del bife + sus opciones permitidas por grupo | **1** | **7** (2+2+3) | 1 renglón con 3 selectores | 1 entrada nueva (la vieja se desactiva) y 8 filas |
| C. Lugar de SECCIÓN con subconjunto + opciones permitidas | 1 producto permitido + 7 opciones permitidas | 0 entradas; 8 filas | 8 | 1 renglón con 3 selectores | +1 fila, pero **tabla nueva** y columna nueva |
| D. Sin restringir (lo que el producto admite) | Nada | 0 | 0 | todas las opciones del producto | — (no cumple «solo estas opciones» si el producto admite más) |

**La más barata que cumple lo que el dueño quiere: B** — cero tablas nuevas, una columna (`EntradaDeCupo.modoDeOpciones`, §6) y reutiliza `OpcionDeEntradaDeCupo` (que pasa a guardar las **permitidas** cuando el modo es `A_ELEGIR`). Bebidas: «Agua» (1 entrada) y «Agua saborizada» (1 entrada `A_ELEGIR` con sus sabores permitidos) = **2** entradas en lugar de 1 + k.

**Total del caso Empresa 1:** con la alternativa A, **12 + 1 + k** entradas (k = sabores del agua saborizada); con la B, **3**.

---

## 4. Cómo se elige el subconjunto: ¿por producto, por categoría o por lista? (decisión y justificación)

**Decisión (PROPUESTA): por lista explícita de productos** (lo que hoy ya es un lugar LISTA), con dos ayudas:

1. un **atajo «agregar todos los de esta categoría»** que carga la lista **en ese momento** (con vista previa) y no la deja atada a la categoría;
2. un **aviso** en la pantalla de la promo («hay N productos nuevos de la categoría X que no están en esta promo: ¿agregarlos?»).

Por qué **no** «seguir la sección» ni «seguir la categoría» automáticamente:
- **El precio de la promo es fijo** (p. ej. $55.000) y lo que entra define el costo y el margen: un producto que llega solo a una sección o categoría (un corte más caro) entraría al menú sin que nadie lo decida. Es dinero.
- **La categoría es un rubro comercial** (`CategoriaProducto`, `schema.prisma:557`, usado para el food cost objetivo), no una definición de menú; reclasificar un producto cambiaría el contenido del menú sin tocar la promo.
- **Las secciones de la carta cambian seguido** (se mueven, se apagan) por razones de la carta, no de la promo.
- Una lista explícita **falla cerrado**: si no está en la lista, no entra.

**Qué entra y qué sale solo (siempre con lista explícita):**
- **Entra solo:** nada. Un producto nuevo no se ofrece hasta que alguien lo agregue (y lo avisa el aviso del punto 2).
- **Sale solo:** lo que hoy ya sale solo: un producto apagado en la sucursal, sin origen de stock, sin receta o sin precio de referencia deja de ser elegible hoy (I1); una opción apagada en la sucursal desaparece de lo permitido efectivo (§2, nivel 4). Si un grupo obligatorio se queda sin opciones, el bife **deja de ofrecerse** y el administrador ve el motivo (`COMPONENTE_...` o «sin opciones armables»).

**Alternativa C (subconjunto de una sección) — no recomendada en N1.** Solo conviene si el dueño quiere que la promo «siga» el orden, la visibilidad y el precio de la carta de la sección. Costaría una tabla mínima y una columna (`PromoCartaCupo.elegibles` `'TODOS' | 'ALGUNOS'` más la lista permitida); con `ALGUNOS` y ninguno activo, el lugar queda **sin elegibles** (nunca «todos»). Queda como **N1b**, con nombre, para cuando haya un caso que la justifique (§8).

---

## 5. Qué parte de ADR-032 hay que enmendar, y los riesgos

### 5.1 Qué se enmienda (PROPUESTA)
- **D-6** («El mozo NO elige opciones dentro del combo en v1», línea 20 de `ADR-032`): pasa a «el mozo elige opciones dentro del combo **solo** en las entradas de lista que el dueño marcó `A_ELEGIR`, **solo** entre las permitidas por el dueño, y nunca un adicional». En un lugar de **sección** y en el **plato del día** sigue valiendo D-6 sin cambios (`PROMO_CON_OPCIONES`, `agregar-items.ts:223`; el supuesto «un plato del día es un producto sin configuración fija»).
- **D-8 y D-9** (precio de referencia y origen de stock): se evalúan **por configuración elegida** al agregar, y al cargar la entrada se exige que exista **al menos una** configuración armable.
- **El texto de `armar-promo.tsx`** y su nota GO-2d («pedilo suelto»): el diálogo gana los selectores de opciones por entrada `A_ELEGIR`; el aviso se mantiene para lugares de sección.
- **No se enmienda:** D-2 (IVA: un combo no mezcla alícuotas declaradas distintas; el producto es el mismo, no cambia), D-3/D-4 (retirados), D-5, D-7, `piso-de-promo.ts` (suma de máximos de **unidades**: no depende de la configuración elegida).

### 5.2 Riesgos
| Riesgo | Qué pasa | Cómo se cubre |
|---|---|---|
| **Stock** | Elegir otra proteína o guarnición descuenta otros insumos (REEMPLAZA/SUMA). Hoy el origen de stock de una entrada se evalúa al cargarla; con opciones depende de lo elegido. | I8: se valida por configuración elegida al agregar (`rechazoDeComponenteDeCombo` con `opcionesQueDescuentan`, ya existente); `insumosSinLaBase` da el aviso temprano; el descuento real lo decide el cobro como en cualquier línea configurada. **NO VERIFICADA** la conducta del cobro cuando una opción permitida está agotada: hoy depende de la política de stock negativo de la sucursal. |
| **Precio fijo ($55.000)** | La lista compuesta del bife cambia según la **Preparación** elegida (medida en ABSOLUTO): cambia el reparto entre componentes, no el total. | I4: el total cobrado siempre es el de la promo (`repartirImporte` es exacto al centavo); el reparto afecta el margen **por línea** y el IVA **por línea** (con una sola alícuota por combo, D-2, el IVA total no cambia). El piso de $0,01 por unidad no cambia. **NO VERIFICADA** la lectura del reporte «Margen de promociones» con configuraciones distintas por venta. |
| **Comanda y ticket** | Hoy una línea configurada imprime sus opciones; dos configuraciones del mismo producto en una promo son **dos líneas** (clave de línea con huella). | La escritura existe (`componentesConfigurados`); lo nuevo es que la configuración la elige el mozo, no el dueño. **NO VERIFICADA** la presentación exacta del ticket de un combo con dos bifes de configuraciones distintas (hay que mirarla con una venta de prueba). |
| **Versiones de opciones** | Entre que el mozo ve y confirma, una opción cambia de versión o de precio. | `OPCION_CAMBIO` (existe) y `PROMO_CAMBIO` para el precio de la promo. |
| **Opciones apagadas** | Se apaga «Papas fritas» en una sucursal. | Sale de lo permitido efectivo; si un grupo obligatorio queda vacío, el producto deja de ofrecerse (falla cerrado). |
| **Explosión por «hasta 2 guarniciones»** | Si el grupo admite varias, crece el espacio de elecciones. | No crece en entradas (sigue 1), solo en lo que puede armar el mozo; se valida con los mismos máximos del grupo. |
| **Complejidad del diálogo del mozo** | Más controles en «Armar promo». | Un selector por grupo, solo en las entradas `A_ELEGIR`; el resto del diálogo no cambia. |

---

## 6. Tablas y columnas (EN PAPEL; nivel 6 solo después de que el dueño confirme los niveles 1 a 5)

**N1 (recomendada, la más barata): UNA columna, cero tablas nuevas.**
- `EntradaDeCupo.modoDeOpciones` TEXT NOT NULL DEFAULT `'FIJAS'`, CHECK `IN ('FIJAS','A_ELEGIR')`. Todas las filas de hoy quedan `FIJAS`: **el comportamiento de hoy no cambia** (aditiva, reversible, `down.sql` que **aborta** si hay filas `A_ELEGIR`).
- Con `A_ELEGIR`, las filas de `OpcionDeEntradaDeCupo` de la entrada son las **permitidas** (`cantidad` = tope de unidades de esa opción) en lugar de la configuración fija; `claveConfiguracion` es el canónico del **conjunto de permitidas** (igual que hoy es el de la configuración fija: identidad inmutable). Cambiar lo permitido = entrada nueva + baja de la anterior.
- CHECK de coherencia (PROPUESTA): una entrada `A_ELEGIR` no tiene opciones de un grupo `ADICIONAL` (I6, lo valida el caso de uso; la base lo puede reforzar solo si la FK al grupo se hace visible, a evaluar en el nivel 6).
- Sin tabla nueva, sin clave de permiso nueva, sin cambio de RLS.

**N1b (solo si el dueño lo pide): subconjunto de una sección.** `PromoCartaCupo.elegibles` TEXT DEFAULT `'TODOS'` CHECK `('TODOS','ALGUNOS')` y una tabla mínima `ProductoPermitidoDeCupo (cupo, producto, activa)` (baja lógica, sin DELETE, RLS, auditoría). `ALGUNOS` con ninguno activo = ningún elegible (falla cerrado).

**N2 (después): reserva a empresa o convenio.** Sin tabla propia en este diseño: se resuelve con la etapa N1 del diseño de convenios (`ConvenioOferta`), ver §8.

---

## 7. «El mozo no puede equivocarse»: cómo queda garantizado

1. **Selector (comodidad):** el diálogo «Armar promo» solo muestra, por lugar, las entradas elegibles hoy y, en una entrada `A_ELEGIR`, **solo las opciones permitidas efectivas**; un selector por grupo, con los mínimos y máximos del grupo. «Agregar promo» queda deshabilitado hasta cumplir lugares y grupos.
2. **Servidor (la defensa real, fail-closed):** `agregarItems` vuelve a leer lo permitido **dentro** de la transacción SERIALIZABLE, con la misma función que alimenta al selector (I3), arma cada línea con `armarLineaConfigurada` recibiendo solo los grupos y opciones permitidos (I2) y rechaza sin escribir nada si algo no cuadra.
3. **Mensajes de rechazo (PROPUESTA; los marcados «existe» ya están hoy):**
   - producto o entrada fuera del lugar: «Esa opción de "<lugar>" no está disponible hoy en esta promo.» (existe, `ENTRADA_NO_DISPONIBLE`);
   - opción fuera de lo permitido: ««Menú Empresa 1»: «Bife» no admite «Ojo de bife» en esta promo.» (nuevo, código propuesto `OPCION_NO_PERMITIDA_EN_PROMO`);
   - falta una opción obligatoria: ««Menú Empresa 1»: Elegí la proteína del bife.» (mensaje del validador existente, con el nombre del grupo);
   - más unidades que el máximo del lugar: «Como máximo 1 opción(es) de "Plato principal".» (existe);
   - la versión de la opción cambió: «volvé a mirarla» (`OPCION_CAMBIO`, existe).

### «¿Qué pasa si…?» — comando «Definir una entrada `A_ELEGIR` con sus opciones permitidas» (administrador)

| Situación | Resultado propuesto |
|---|---|
| Repetición o doble clic | Por estado (llevar al estado pedido): repetir no escribe ni audita nada, como `guardarCuposPromoCarta`. |
| Concurrencia | SERIALIZABLE con reintento; dos administradores que cargan lo mismo: la clave natural `(lugar, producto, conjunto permitido)` hace que el segundo vea la entrada y no cree otra. Uno que agrega una guarnición y otro que desactiva la entrada: se ordenan; el segundo ve el estado nuevo. |
| Tiempo o vigencia | Rige la vigencia de la promo; cambiar lo permitido no toca lo ya cargado (I5). |
| Incertidumbre | Si al guardar no hay ninguna configuración armable (precio de referencia o stock), se rechaza con el motivo y no se guarda la entrada (I8). |
| Reintento | Mismo resultado: por estado. |
| Error parcial | Entrada, opciones permitidas y auditoría en UNA transacción: todo o nada. |
| Datos faltantes | Producto que no es «se vende por opción» o sin grupos: la entrada `A_ELEGIR` no se puede guardar (no hay nada que elegir; usar entrada fija). Opción de otra empresa o inexistente: rechazo. |
| Cambio de permisos | `carta_promo_definir` se verifica en el servidor; el cambio de permisos no afecta lo ya cargado. |

### «¿Qué pasa si…?» — comando «Agregar la promo a la cuenta» (mozo)

| Situación | Resultado |
|---|---|
| Repetición o doble clic | Con clave (I3): exactamente una vez; el reintento devuelve el mensaje original (existe). |
| Concurrencia | Dos mozos agregando a la misma cuenta: SERIALIZABLE; ambos agregan (son dos intenciones). Un administrador que cambia lo permitido mientras el mozo confirma: el servidor lee **adentro**; si la opción elegida ya no está permitida, rechaza y no escribe nada. |
| Tiempo o vigencia | La promo se evalúa al agregar con «hoy» de la empresa; lo ya cargado no cambia (I5). |
| Incertidumbre | Se apagó una opción o un producto entre que lo vio y que confirma: rechazo con mensaje; se agotó: depende del cobro (**NO VERIFICADA**, §5.2). |
| Reintento tras corte de red | Mismo mensaje original; no duplica líneas. |
| Error parcial | Todo o nada: ninguna `PromoCuenta` ni línea si algo no valida. |
| Datos faltantes | Una opción obligatoria sin elegir: rechazo con el nombre del grupo. |
| Cambio de permisos | `pos_tomar_pedido` se verifica en el servidor; lo ya agregado queda. |

### «¿Qué pasa si…?» — después de agregar, cambia el contenido (producto apagado, agotado, sección que cambia)

| Evento | Lo ya cargado en la cuenta | Lo que se ofrece desde ahora |
|---|---|---|
| Se apaga el bife en la sucursal | No cambia (I5) | Sale del selector; el servidor lo rechaza |
| Se apaga una guarnición | No cambia | Sale de lo permitido; si el grupo obligatorio queda vacío, el bife deja de ofrecerse |
| Se mueve el bife a otra sección de la carta | No cambia | **No cambia** (la lista es explícita, no depende de la sección) |
| Aparece un producto nuevo en la sección o la categoría | — | **No entra** (aviso al administrador, §4) |
| Se cambia lo permitido (agregar «Arroz») | No cambia | Entrada nueva; la anterior se desactiva |

---

## 8. Etapas

| Peldaño | Qué es | Tablas o columnas | Estado |
|---|---|---|---|
| **N0 — hoy, sin código** | Promo temática con lugar LISTA (Halloween); bife con 12 entradas fijas; agua con sus sabores como entradas | Ninguna | Existe |
| **N1 — lo que el dueño quiere AHORA** | Entrada «el mozo elige entre estas opciones» (`A_ELEGIR`) con las opciones permitidas por grupo; selector y servidor sobre la misma regla; reutiliza `armarLineaConfigurada` filtrada | Una columna en `EntradaDeCupo` | PROPUESTA |
| N1b — subconjunto de una sección | «De esta sección, solo estos productos» | Una columna y una tabla mínima | PENDIENTE (solo si el dueño lo pide) |
| **N2 — reservar a empresa o convenio (después)** | La promo solo se ofrece/acepta en la cuenta de esa empresa o convenio | **Sin** `PromoCartaCliente`: se hace con la etapa N1 del diseño de convenios del 26/10 (`ConvenioOferta`, `Cuenta.convenioId`) | PENDIENTE (después) |
| N3 — opciones libres en cualquier lugar o en el plato del día | Extender la elección del mozo a lugares de sección y plato del día | Revisar D-6 por completo | NO recomendada hasta que haya un caso |

**Por qué N1 primero:** es lo más barato que cumple la palabra del dueño: «si elige la promo correcta, vea solo lo que se puede sacar con esa promo». Reutiliza la misma función que valida una venta suelta; no introduce reglas paralelas.

**N2 no se duplica:** la «oferta del convenio» del diseño del 26/10 es una promo propia (H3, CONFIRMADA). Lo que construye N1 es exactamente el contenido de esa promo; N2 solo agrega **a quién** se le ofrece.

---

## 9. Escalera de producto N0 a N5 (lo que ve el cliente)

| Peldaño | El cliente ve | Si falta algo |
|---|---|---|
| N0 | Armar la promo con lista fija; el mozo ve solo esas entradas | — |
| N1 | En la promo, una entrada «Bife» con «Preparación / Proteína / Guarnición» y casillas con lo permitido; el mozo elige dentro | Entrada sin opciones armables: «pendiente de completar» y no se ofrece |
| N1b | Un lugar de sección «Todos» o «Algunos» con casillas | Sin ninguno: «la promo no se puede armar» |
| N2 | «Reservada a: Empresa 1» | Sin cliente: se ofrece a todos (explícito) |
| N3 | Elegir opciones también en lugares de sección y plato del día | — |
| N4 | Reporte de qué se eligió en cada promo (qué proteína, qué guarnición, por empresa) | Sin foto: «no registrado» |
| N5 | Costo y margen de la promo por configuración elegida | Costeo incompleto: «pendiente» |

Formalidad y detalle son ejes separados: cada peldaño suma sin romper lo cargado.

---

## 10. Oráculo de combinaciones (dimensiones y reglas; sin test todavía)

**Dimensiones que cambian el resultado (dinero, permisos, visibilidad o stock):**

| Dim. | Valores | Qué representa |
|---|---|---|
| **T** tipo de lugar | `SECCION` · `LISTA` · `DEL_DIA` | De dónde salen los elegibles |
| **S** subconjunto | `TODOS` · `ALGUNOS` · `NINGUNO` | Solo existe con `SECCION` (N1b); `NINGUNO` = «algunos» con cero activos |
| **O** opciones | `FIJAS` · `A_ELEGIR_PERMITIDAS` | Solo `LISTA` admite `A_ELEGIR` (N1); sección y plato del día siguen `FIJAS`/sin opciones |
| **X** lo elegido | `DENTRO` · `FUERA` | La opción o el producto elegido, dentro o fuera de lo permitido |
| **P** producto en la sucursal | `DISPONIBLE` · `APAGADO` · `SIN_ORIGEN_DE_STOCK` | Producto disponible, apagado o sin receta ni stock propio |
| **G** opción en la sucursal | `ACTIVA` · `APAGADA` | Opción permitida pero apagada en la sucursal |
| **Q** cantidad | `BAJO_MINIMO` · `EN_RANGO` · `SOBRE_MAXIMO` | Contra mínimo y máximo del lugar y del grupo |
| **R** reserva a cliente o convenio | (no aplica hasta N2) | Declarada: **no cambia el resultado en N1** (la asignación sigue manual) |

**Imposibles (marcados, no probados):** `S ≠ TODOS` con `T ≠ SECCION`; `O = A_ELEGIR_PERMITIDAS` con `T ≠ LISTA`; `G = APAGADA` sin opciones; `X = FUERA` con `O = FIJAS` y entrada sin configuración (nada que elegir).

**Reglas esperadas:**
1. **Se acepta** si y solo si: la promo se ofrece hoy en la sucursal (vigencia, activa, módulo), **y** `X = DENTRO`, **y** `P = DISPONIBLE`, **y** (con `A_ELEGIR`) toda opción elegida está permitida **y** `G = ACTIVA`, **y** cada grupo cumple su mínimo y su máximo con lo elegido, **y** `Q = EN_RANGO`.
2. **Se rechaza** sin escribir nada en cualquier otro caso. Códigos esperados: entrada no elegible o fuera del lugar → `ENTRADA_NO_DISPONIBLE`; opción no permitida → `OPCION_NO_PERMITIDA_EN_PROMO`; mínimo o máximo → su mensaje; opción de otra versión → `OPCION_CAMBIO`; `P ≠ DISPONIBLE` → `ENTRADA_NO_DISPONIBLE`.
3. Con `G = APAGADA` en un grupo **obligatorio** y sin otra opción permitida activa: la entrada **no es elegible** (no se ofrece).
4. `S = NINGUNO` con mínimo > 0: la promo **no se puede armar**; nunca «todos» (falla cerrado).
5. **El total cobrado no depende de lo elegido** (I4): cualquier combinación aceptada cobra exactamente el precio de la promo.

**Cómo se prueba (nivel 10, después de aprobar):** la regla es una función **pura** (`core/pos`): se recorre el producto cartesiano **completo** de las dimensiones válidas contra una tabla escrita aparte en `docs/` (oráculo legible), como `oraculo-combinaciones-compras-etapa-2a`. Con T×S×O×X×P×G×Q = 3×3×2×2×3×2×3 = 648 combinaciones crudas, menos las imposibles, es exhaustivo y barato. Contra Postgres real: un subconjunto por pares, concurrencia (dos agregados a la vez; administrador cambiando lo permitido mientras el mozo agrega) e idempotencia (misma clave). **Guardián** que falla si aparece una dimensión nueva (una columna de modo, una clave) sin declarar si cambia el resultado. Mutaciones: filtrar mal los `grupos` → rojo; abrir `NINGUNO` a «todos» → rojo.

**Dimensiones que NO cambian el resultado (a declarar con motivo):** sucursal de la cuenta (la promo se ofrece por sucursal ya filtrada antes), el mozo que la arma (mismo permiso), medio de pago, el precio local de la promo (cambia el importe, no la elegibilidad), reserva a cliente (R, hasta N2).

---

## 11. Niveles 6 a 10: lo que queda para después de aprobar

- **Nivel 6 (persistencia):** solo lo de §6. No se diseña ni migra sin confirmar niveles 1 a 5.
- **Nivel 7 (atomicidad y concurrencia):** `agregarItems` ya es SERIALIZABLE; lo permitido se lee **adentro**. El guardado de entradas ya es SERIALIZABLE con reintento y clave natural.
- **Nivel 8 (acceso e interfaces):** un selector por grupo en `armar-promo.tsx` solo para entradas `A_ELEGIR`; en la administración, casillas de opciones permitidas por grupo, con el atajo «cargar la categoría» y el aviso de productos nuevos.
- **Nivel 9 (consultas):** `cargarEntradasDePromoParaVender` devuelve, por entrada `A_ELEGIR`, los grupos con las opciones permitidas efectivas (misma función para selector y servidor; test de paridad).
- **Nivel 10 (pruebas, migración, operación):** §10; migración aditiva (una columna) con `down.sql` que aborta si hay filas `A_ELEGIR`; **aplicación a cualquier base real solo con autorización expresa, respaldo y ensayo** (`docs/deploy-con-migraciones.md`).

---

## 12. Preguntas para el dueño (máximo 4; solo las que cambian modelo, dinero o permisos)

1. **¿El mozo elige entre las opciones permitidas solo en las promos y entradas que vos marques, o en cualquier promo con productos con opciones?** (modelo y reglas). *Recomendación: solo en las entradas que marques «a elegir»; el resto sigue como hoy (fail-closed).*
2. **«Solo los bifes» de Platos principales: ¿se arma listando los bifes en la promo (1 o pocos), o querés que la promo siga automáticamente lo que haya en la sección o la categoría?** (modelo y dinero: el precio es fijo y un producto nuevo cambia el margen). *Recomendación: lista explícita, con un atajo que carga la categoría y un aviso cuando aparece un producto nuevo; no seguir la sección ni la categoría sola.*
3. **Los adicionales con recargo (extras pagos), ¿entran dentro de la promo?** (dinero). *Recomendación: no; dentro de la promo solo preparación, proteína y guarnición incluidas, sin recargo. Un extra se pide aparte, suelto.*
4. **Proteína y preparación: ¿el precio de $55.000 es siempre el mismo, elija lo que elija el mozo (nalga o bife de chorizo)? ¿Y las guarniciones, una sola o hasta dos distintas?** (dinero y modelo). *Recomendación: precio siempre fijo (es lo que hace el prorrateo hoy) y una guarnición; «hasta dos» se puede sumar sin cambiar el modelo.*

---

## 13. Riesgos y pendientes

- **NO VERIFICADA:** la base real (grupos y opciones del «BIFE-» tal como los describió la coordinación); si existe un plan aprobado en `motor2-docs`; la presentación del ticket y la comanda de un combo con dos configuraciones distintas del mismo producto; la conducta del cobro cuando una opción permitida está agotada; la lectura del reporte «Margen de promociones» con configuraciones que varían por venta.
- Este diseño **enmienda D-6 de ADR-032**: hace falta un ADR nuevo o una enmienda de ADR-032 antes de implementar (lo decide el dueño al aprobar).
- No se tocó código, tests, migraciones, Neon ni Vercel. La maqueta usa datos de ejemplo claramente marcados.
