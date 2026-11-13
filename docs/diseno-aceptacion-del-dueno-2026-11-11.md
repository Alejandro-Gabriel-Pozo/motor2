# Diseño: lo que el dueño no pidió no entra; las decisiones del agente quedan registradas y a la vista — 2026-11-11

Estado: **niveles 1 a 5 CONFIRMADOS por el dueño el 2026-11-11** (alcance y modelo, ver «Decisiones del dueño citadas»). Solo diseño: sin código y sin migración. Estados: **CONFIRMADA** (lo dijo el dueño, con fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Es la «decisión 3» de la comparación con Pedernal (otro proyecto del dueño: `Alejandro-Gabriel-Pozo/ZuluHub-ERP`, su CLAUDE.md, viñetas «No supongas», «Alcance cerrado» y «Lo que el dueño no aprobó lleva su fuente»).

## 0. Resumen para el dueño (lenguaje de proceso)
1. Un agente **no agrega** al producto nada que el dueño no pidió (campos, opciones, textos, reglas, funciones, permisos, valores por defecto). Puede **sugerirlo** en el PR; no lo programa.
2. Lo que **sí** puede pasar, como en Pedernal: ante una elección chica **necesaria para terminar lo pedido** y de la que el resto depende, el agente avanza con la opción más chica y reversible, la marca como supuesto y la **registra como «pendiente de tu OK»**, con su costo de revertir. El dueño la acepta, la discute o la corrige; queda escrito como **aceptada** o **corregida**, con su cita.
3. Tres cuidados para que no se repita lo de Pedernal (79 de 80 decisiones sin revisar): (a) cada PR trae arriba «Decisiones mías que esperan tu OK»; (b) tope de **10 pendientes abiertas**: con 10 abiertas no se avanza con una nueva, se hace una pregunta; (c) un guardián impide dejar un supuesto en el código sin su entrada en el registro.
4. Se pregunta **antes** lo que cambia qué se construye, cómo se comporta, los datos, el dinero, los permisos, los textos que ve el cliente o la prioridad; las decisiones registradas son solo para lo que no se puede frenar.
5. Lo técnico interno (pruebas, guardianes, orden del código, arreglos de seguridad) sigue con la autonomía del 2026-10-08, dentro de lo pedido.
6. Límite honesto: una máquina no puede saber si una cita es realmente del dueño; controla que el supuesto esté registrado, que haya a lo sumo 10 abiertos y que el cuerpo del PR tenga su apartado. La revisión final sigue siendo leer el resumen de cada cambio.

## Nivel 1. Propósito, necesidad y alcance
- **Necesidad (CONFIRMADA, 2026-11-11):** «ninguna gente, ninguna sesión anidada escriba algo que no fue pedido. Sí lo puede sugerir y tiene que haber una aceptación del dueño citada». Caso real: con las promociones había «días de disponibilidad» que el dueño nunca pidió y hubo que borrarlos (nadie se lo mostró).
- **Alcance (CONFIRMADA, 2026-11-11):** lo que ven o usan las personas, «sobre todo lo que tiene que ver con campos, opciones, textos».
- **Fuera de alcance:** reescribir el historial; migrar los `_decisiones-del-dueno-*.md` de `motor2-docs`; tocar la base de datos.

## Nivel 2. Actores y contexto
| Actor | Rol |
|---|---|
| Dueño | Único que acepta, discute o corrige |
| Orquestador | Reparte el trabajo, arma el PR, transcribe las citas literales; **no acepta en nombre del dueño** |
| Agentes (Plan/Opus, Sonnet) | Diseñan, sugieren, escriben; registran sus decisiones; ninguno acepta |
| Dependabot | Exento (PROPUESTA) |
| CI de GitHub | Único check requerido hoy: `Gate (requerido)` |

## Nivel 3. Casos de uso
1. Cambio pedido: el PR cita el pedido (fecha y texto) y lista lo que entra, cada renglón con su cita.
2. Mejora no pedida (algo que sumaría funcionalidad, campos u opciones): va a «Sugerencias (no implementadas)»; **no** es una decisión registrable, es una sugerencia y no entra al código.
3. Elección necesaria para terminar lo pedido y de la que el resto depende: el agente avanza con la opción más chica y reversible, con marcador `SUPUESTO(DEC-n)` y entrada en el registro como `PENDIENTE_DE_OK`.
4. El dueño resuelve una decisión pendiente: la acepta, la corrige o la revoca; el orquestador transcribe su cita literal y fecha en el registro; si corrige, el cambio va en un PR propio.
5. Ambigüedad sin dependencia: el agente no hace esa parte y deja UNA pregunta abierta.
6. Tope de 10 pendientes abiertas alcanzado: no se avanza con una nueva; se hace la pregunta y se espera.

## Nivel 4. Conceptos y ciclo de vida
- **Pedido:** lo que el dueño pidió, con fecha, cita literal entre « » y fuente.
- **Sugerencia:** texto en el PR o en `docs/`, nunca código.
- **Decisión del agente (DEC):** una elección chica, reversible y necesaria para terminar lo pedido. Nunca agrega funcionalidad, campos ni opciones. Entrada en `docs/registro-de-decisiones.md` con: `DEC-NNNN`, fecha, quién la tomó, qué decidió, por qué, **costo de revertir**, dónde (archivo:línea) y estado.
- **Estados de una DEC:** `PENDIENTE_DE_OK` → `ACEPTADA` (cita del dueño) | `CORREGIDA` (cita; la corrección va en un PR propio) | `REVOCADA` (cita). Una DEC pendiente **nunca** se presenta como definitiva ni se cuenta como aceptada.
- **Resumen en cada PR:** apartado «Decisiones mías que esperan tu OK» con las DEC pendientes (ordenadas de la más vieja a la más nueva) y su costo de revertir.

## Nivel 5. Reglas e invariantes
| # | Regla | Estado |
|---|---|---|
| I1 | Una aceptación válida es solo del dueño, con fecha AAAA-MM-DD, texto literal entre « » y fuente localizable. No valen «lo aprobó el orquestador», «lo decidió la sesión», «el padre lo autorizó» ni «confirmada por omisión» | CONFIRMADA |
| I2 | **Silencio no es aceptación:** una DEC pendiente no se presenta como definitiva, no desaparece sola y se cuenta; lo que no es DEC (una mejora) y no tiene pedido no entra | CONFIRMADA (modelo aceptado 2026-11-11) |
| I3 | Las sugerencias no son código: ningún rastro en `src/`, `prisma/` ni `test/` | PROPUESTA |
| I4 | Un `SUPUESTO` en el código solo existe con `SUPUESTO(DEC-n)` y su entrada en el registro | CONFIRMADA |
| I5 | Se pregunta antes lo que cambia qué se construye, el comportamiento, los datos, el dinero, los permisos, los textos que ve el cliente o la prioridad; la DEC es solo para lo que no se puede frenar | CONFIRMADA (regla de Pedernal y del 2026-10-28) |
| I6 | Tope de **10 DEC pendientes abiertas**; con 10 no se agrega una nueva. Las pendientes de más de 14 días van primero en el resumen de cada PR | CONFIRMADA (modelo aceptado 2026-11-11) |
| I7 | Una DEC solo puede elegir la opción más chica y reversible dentro de lo pedido; nunca suma funcionalidad, campos ni opciones | PROPUESTA |
| I8 | Lo técnico interno sigue con la autonomía del 2026-10-08, dentro de lo pedido | CONFIRMADA |
| I9 | Las aceptaciones no vencen solas; solo las revoca el dueño | PROPUESTA |

## Decisiones del dueño citadas
- **Pedido (2026-11-11):** «ninguna gente, ninguna sesión anidada escriba algo que no fue pedido. Sí lo puede sugerir y tiene que haber una aceptación del dueño citada».
- **Alcance (2026-11-11):** «Es la primera. Sobre todo lo que tiene que ver con campos, opciones, textos. Básicamente como lo tiene Pedernal, ¿sí?». CONFIRMADA.
- **Cómo trabaja en Pedernal (2026-11-11):** «Pedernal trabaja de forma bastante autónoma. Yo acepto pantallas, acepto textos. Y acepto decisiones o sugerencias o recomendaciones que sugiere o las discuto, digamos. Y ahí es cuando salen que fueron aceptadas por el dueño o que la decisión del dueño es otra.»
- **Modelo (2026-11-11):** «Ok, me parece bien tu sugerencia de tu modelo.» (respuesta a: avanzar con decisiones chicas y reversibles registradas como pendientes de su OK, con apartado en cada PR, tope de 10 y guardián). CONFIRMADA.
- **Precio 0 del alta de un producto de venta base (2026-11-11):** «Sí, precio cero del alta de un producto yo lo usé porque el producto de venta como base, si tiene producto, si tiene cero de precio, es porque seguramente el precio vaya a las opciones». Aceptación para `src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts:38` y `test/catalogo/campos-sensibles-del-alta.test.ts:130`: entran al registro como DEC `ACEPTADA` y su comentario deja de decir «SUPUESTO».
- **Contradicción con la autonomía del 2026-10-08:** el dueño la reconoce («esa regla hizo que vos escribieras cosas de más») y la acota con I5, I7 e I8.

## «¿Qué pasa si…?»
| Situación | Qué pasa |
|---|---|
| Repetición: dos PR citan la misma aceptación | Válido; la cita no se «gasta»; cada PR lista solo lo suyo |
| Concurrencia: dos PR abren la décima DEC a la vez | El guardián mira cada PR por separado; el segundo en fusionarse queda en 11 y falla; se resuelve con una pregunta o con la revisión del dueño |
| Tiempo: el dueño revoca una DEC aceptada | Estado `REVOCADA` con su cita; el guardián falla mientras el código siga citándola; el cambio va en un PR propio |
| Tiempo: una DEC pendiente supera los 14 días | Va primero en el resumen de cada PR; sigue contando para el tope; nunca se da por aceptada |
| Incertidumbre: «dale» sin contexto | No vale solo: la cita incluye la pregunta y el «sí»; si falta, queda pendiente |
| Error parcial: un PR hace 3 cosas y solo 2 están pedidas | El apartado «Qué entra» falla en el chequeo (E3) si un renglón no tiene cita; si ni está listado, lo debe ver el orquestador al revisar el diff (límite declarado) |
| Datos faltantes: DEC sin costo de revertir o sin ubicación | El guardián falla |
| Datos faltantes: PR anterior a la regla | No se revisa hacia atrás |
| Cambio de reglas | Se edita la sección de AGENTS.md con fecha |
| El agente intenta registrar como DEC una mejora no pedida | Va contra I7; el orquestador la devuelve a «Sugerencias» |

## Alternativas (de la más barata a la más cara)
| Alt. | Qué es | Detecta / No detecta | Costo | Recomendación |
|---|---|---|---|---|
| 0 (E1) | Sección en `AGENTS.md` (I1 a I9) + `.github/pull_request_template.md` con «Pedido y aceptación del dueño», «Qué entra al producto», «Decisiones mías que esperan tu OK» y «Sugerencias (no implementadas)» | Nada automático; ordena la conducta y le da al dueño un resumen legible | Muy bajo | Sí |
| a1 (E2) | `docs/registro-de-decisiones.md` + guardián `test/arquitectura/registro-de-decisiones.test.ts`: todo `SUPUESTO(DEC-n)` del código existe en el registro; toda entrada tiene los campos y su estado; no más de 10 `PENDIENTE_DE_OK`; un `SUPUESTO` sin `(DEC-n)` falla | Detecta el supuesto no registrado (el caso de los «días de disponibilidad» si se hubiera marcado) y la cola descontrolada; no detecta una decisión sin marcador | Bajo-medio | Sí |
| a2 (E3) | `scripts/verificar-pedido-del-pr.ts` (puro, probado) + workflow aparte sobre el cuerpo del PR: los cuatro apartados, cita con fecha por renglón, fuente que no sea un agente, cada DEC citada existe | No detecta que la cita sea real ni que el diff haga más de lo listado | Medio-bajo | Sí, como check visible; volverlo requerido en GitHub **REQUIERE AUTORIZACIÓN EXPRESA** |
| c | Registro completo estilo Pedernal con controlador sobre archivos sensibles | «Una entrada cualquiera alcanza» | Alto | No (el registro de a1 ya cubre lo útil, con tope) |

Detalle técnico: los PR se fusionan «squash» con mensaje corto, así que el cuerpo del PR no queda en git; por eso el diseño que acompaña a cada PR repite la cita en su línea «Necesidad» y las DEC viven en el registro del repositorio.

## Etapas (un PR cada una, sin migración, el código lo escribe Sonnet)
- **E1:** regla en `AGENTS.md` (I1 a I9) y plantilla de PR con los cuatro apartados. Reversible borrando dos textos.
- **E2:** `docs/registro-de-decisiones.md` + guardián (con mutaciones demostradas: un `SUPUESTO` sin DEC → rojo; una DEC pendiente número 11 → rojo; entrada sin costo de revertir → rojo; revertir cada una → verde) y reescritura de los dos supuestos vivos como DEC `ACEPTADA` con la cita del dueño.
- **E3:** chequeo del cuerpo del PR (script puro con prueba + workflow aparte; el cuerpo del PR se pasa por variable de entorno, nunca interpolado). Volverlo requerido en la protección de rama: solo con autorización expresa.

**Paso FINAL en cada etapa, sobre la suite TOTAL y en la MISMA corrida, todo limpio:** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`. Línea de base antes de tocar nada.

## Hallazgos aparte
1. `AGENTS.md` (sección «Quién escribe código») trae su propio «supuesto declarado» sobre el alcance de esa regla: pasa a ser una DEC o una pregunta.
2. La memoria `feedback-autonomia-segun-principios.md` (2026-10-08, en `motor2-docs`) debe actualizarse con I5, I7 e I8.
3. `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md` usa «CONFIRMADA por omisión»: conviene renombrarlo «FUERA DE ALCANCE (no pedido)».
4. El registro de decisiones del dueño vive en otro repo (`motor2-docs/_planes/`) y termina el 2026-10-08; el CI no lo ve.
