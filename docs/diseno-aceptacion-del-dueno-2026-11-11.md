# Diseño: nada entra al producto sin la aceptación citada del dueño — 2026-11-11

Estado: **niveles 1 a 5 CONFIRMADOS por el dueño el 2026-11-11** (alcance elegido, ver §1). Solo diseño: sin código y sin migración. Estados: **CONFIRMADA** (lo dijo el dueño, con fecha), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Es la «decisión 3» de la comparación con Pedernal (otro proyecto del dueño: `Alejandro-Gabriel-Pozo/ZuluHub-ERP`, su CLAUDE.md, viñetas «No supongas», «Alcance cerrado» y «Lo que el dueño no aprobó lleva su fuente»).

## 0. Resumen para el dueño (lenguaje de proceso)
1. Ningún agente agrega al producto algo que el dueño no pidió. Puede **sugerirlo**, y entra solo con el «sí» del dueño **citado**: fecha y sus palabras.
2. El silencio **nunca** cuenta como aceptación. Una sugerencia sin respuesta no entra al código y vence a los 14 días.
3. La regla frena **lo que ven o usan las personas**: campos, opciones, textos, reglas de negocio, funciones, permisos y valores por defecto. Las decisiones técnicas internas (pruebas, guardianes, orden del código, arreglos de seguridad) siguen con la autonomía del 2026-10-08, pero siempre dentro de lo pedido (alcance cerrado).
4. Tres pasos, de más barato a más caro: (E1) la regla escrita y un formulario fijo en cada PR; (E2) un guardián que impide la palabra `SUPUESTO` en el código; (E3) un chequeo automático del cuerpo del PR.
5. Límite honesto: una máquina no puede saber si una cita es realmente del dueño; controla que esté y tenga forma. La última revisión sigue siendo leer el resumen de cada cambio.

## Nivel 1. Propósito, necesidad y alcance
- **Necesidad (CONFIRMADA, 2026-11-11):** «ninguna gente, ninguna sesión anidada escriba algo que no fue pedido. Sí lo puede sugerir y tiene que haber una aceptación del dueño citada». Caso real que la motiva (2026-11-11): con las promociones había «días de disponibilidad» que el dueño nunca pidió y hubo que borrarlos.
- **Alcance (CONFIRMADA, 2026-11-11):** la regla alcanza a lo que ven o usan las personas, «sobre todo lo que tiene que ver con campos, opciones, textos», y es «básicamente como lo tiene Pedernal».
- **Fuera de alcance:** reescribir el historial de decisiones viejas; migrar los `_decisiones-del-dueno-*.md` de `motor2-docs`; tocar la base de datos; un registro completo de decisiones estilo Pedernal (en Pedernal 79 de 80 decisiones quedaron «pendientes de OK»: el registro se volvió el lugar donde el agente se autoriza solo).

## Nivel 2. Actores y contexto
| Actor | Rol |
|---|---|
| Dueño | El único que acepta |
| Orquestador | Reparte el trabajo, arma el PR y transcribe las citas; no acepta nada en nombre del dueño |
| Agentes (Plan/Opus, Sonnet) | Diseñan, sugieren y escriben; ninguno acepta |
| Dependabot | Abre PR sin pedido: exento (PROPUESTA; PENDIENTE de confirmar) |
| CI de GitHub | Único check requerido hoy: `Gate (requerido)`, sobre PR hacia `main` |

## Nivel 3. Casos de uso
1. Cambio pedido: el PR cita el pedido (fecha y texto) y lista lo que entra, cada renglón con su cita.
2. Un agente ve una mejora: la anota en «Sugerencias (no implementadas)» y no la programa.
3. Ambigüedad: el agente no hace esa parte y deja UNA pregunta abierta (regla de alcance del 2026-10-28).
4. El dueño acepta una sugerencia: su respuesta (fecha y cita) pasa al apartado «Pedido y aceptación» de un PR.
5. El dueño revoca algo: una cita nueva que lo revoca, y un PR propio que lo saca.
6. Sugerencia sin respuesta: vence a los 14 días y queda archivada como «no aceptada»; nunca estuvo en el código.

## Nivel 4. Conceptos y ciclo de vida
- **Pedido:** lo que el dueño pidió, con fecha, cita literal entre « » y fuente localizable.
- **Aceptación:** el «sí» del dueño a una sugerencia concreta, con la misma forma. Debe decir a qué responde (incluye la pregunta y el «sí»).
- **Sugerencia:** texto en el PR o en `docs/`, nunca código. Ciclo: abierta → aceptada | rechazada | vencida. No existe «implementada esperando OK».
- **Supuesto:** deja de existir como categoría del código: se convierte en pregunta abierta o, si el dueño lo confirma, en aceptación citada.

## Nivel 5. Reglas e invariantes
| # | Regla | Estado |
|---|---|---|
| I1 | Una aceptación válida es solo del dueño, con fecha AAAA-MM-DD, texto literal entre « » y fuente localizable. No valen «lo aprobó el orquestador», «lo decidió la sesión», «el padre lo autorizó» ni «confirmada por omisión» | CONFIRMADA |
| I2 | Silencio = no: lo que no tiene aceptación no entra | CONFIRMADA |
| I3 | Las sugerencias no son código: ningún rastro en `src/`, `prisma/` ni `test/` | PROPUESTA |
| I4 | Sin marcador `SUPUESTO` en el código | PROPUESTA |
| I5 | Ante ambigüedad se detiene esa parte y se hace una pregunta; las partes no ambiguas avanzan | CONFIRMADA (regla del 2026-10-28) |
| I6 | Las sugerencias y preguntas abiertas vencen a los 14 días; tope de 5 preguntas abiertas por vez; las aceptaciones no vencen solas, solo las revoca el dueño | PROPUESTA |
| I7 | Las reglas permanentes del dueño escritas con fecha en AGENTS.md cuentan como pedido | PROPUESTA |
| I8 | Lo técnico interno (pruebas, guardianes, reorganizar, seguridad) sigue con la autonomía del 2026-10-08, siempre dentro de lo pedido: no se suma funcionalidad visible ni opciones «por las dudas» | CONFIRMADA |

## Decisiones del dueño citadas
- **Alcance (2026-11-11):** «Es la primera. Sobre todo lo que tiene que ver con campos, opciones, textos. Básicamente como lo tiene Pedernal, ¿sí?». CONFIRMADA.
- **Los dos supuestos vivos en el código (2026-11-11):** «Sí, precio cero del alta de un producto yo lo usé porque el producto de venta como base, si tiene producto, si tiene cero de precio, es porque seguramente el precio vaya a las opciones». Aceptación citada para `src/server/actions/catalogo/casos-de-uso/dar-de-alta-producto.ts:38` y `test/catalogo/campos-sensibles-del-alta.test.ts:130`: en E2 su comentario pasa de «SUPUESTO» a «ACEPTADO por el dueño (2026-11-11)».
- **Contradicción con la autonomía del 2026-10-08:** el dueño la reconoce («esa regla hizo que vos escribieras cosas de más») y la acota con I8.

## «¿Qué pasa si…?»
| Situación | Qué pasa |
|---|---|
| Repetición: el mismo pedido se cita en varios PR | Válido; la cita no se «gasta». Cada PR lista solo lo suyo |
| Concurrencia: dos PR citan la misma aceptación y entre los dos hacen más de lo aceptado | El CI mira cada PR por separado y no lo ve; lo ve el orquestador al fusionar. Límite declarado |
| Tiempo: el dueño revoca | Una cita nueva en un PR que saca lo revocado |
| Tiempo: sugerencia sin respuesta | Vence a los 14 días; nunca estuvo en el código |
| Incertidumbre: cita ambigua («dale» sin contexto) | No vale sola: pasa a pregunta abierta |
| Error parcial: el PR hace 3 cosas y solo 2 tienen cita | El chequeo (E3) falla si el renglón está listado sin cita; si ni siquiera está listado, lo debe ver el orquestador al revisar el diff. Límite declarado |
| Datos faltantes: cita sin fecha o fuente | E3 falla |
| Datos faltantes: PR anterior a la regla | No se revisa hacia atrás |
| Cambio de reglas | Se cambia la sección de AGENTS.md con fecha |
| Un agente pone «orquestador» como fuente | E3 falla |

## Alternativas (de la más barata a la más cara)
| Alt. | Qué es | Detecta / No detecta | Costo | Recomendación |
|---|---|---|---|---|
| 0 (E1) | Sección en `AGENTS.md` + `.github/pull_request_template.md` con «Pedido y aceptación del dueño», «Qué entra» y «Sugerencias (no implementadas)» | No detecta nada automático; ordena la conducta y le da al dueño un resumen legible | Muy bajo | Sí |
| a1 (E2) | Guardián `test/arquitectura/sin-supuestos-en-el-codigo.test.ts`: falla si aparece `SUPUESTO` (palabra entera, mayúsculas); lista de excepciones con motivo como `adr-al-dia.test.ts`, vacía al empezar | Detecta el supuesto declarado; no detecta uno escrito sin la palabra («asumimos») | Bajo | Sí |
| a2 (E3) | `scripts/verificar-pedido-del-pr.ts` (puro, probado) + workflow aparte que revisa el cuerpo del PR: tres apartados, cita con fecha por renglón, fuente que no sea un agente | No detecta que la cita sea real ni que el diff haga más de lo listado | Medio-bajo | Sí, como check visible; volverlo requerido es un cambio de GitHub y **REQUIERE AUTORIZACIÓN EXPRESA** |
| b | Registro chico `docs/aceptaciones-del-dueno.md` con ids `DUE-n` | Detecta citas a decisiones inexistentes o revocadas | Medio | Solo si lo anterior no alcanza |
| c | Registro completo estilo Pedernal | Fabrica pendientes (79 de 80) | Alto | No |

Detalle técnico: los PR se fusionan «squash» con mensaje corto, así que el cuerpo del PR no queda en git; por eso el diseño que acompaña a cada PR repite la cita en su línea «Necesidad».

## Etapas (un PR cada una, sin migración, el código lo escribe Sonnet)
- **E1:** regla en `AGENTS.md` (I1 a I8) y plantilla de PR. Reversible borrando dos textos.
- **E2:** guardián de `SUPUESTO` con mutación demostrada (agregar `// SUPUESTO` → rojo; revertir → verde; excepción sobrante → rojo) y reescritura de los dos comentarios de §«Decisiones» como aceptación citada.
- **E3:** chequeo del cuerpo del PR (script puro con prueba + workflow aparte; el cuerpo del PR se pasa por variable de entorno, nunca interpolado). Volverlo requerido en la protección de rama: solo con autorización expresa.
- **E4 (posterior, solo si hace falta):** registro de aceptaciones (alternativa b).

**Paso FINAL en cada etapa, sobre la suite TOTAL y en la MISMA corrida, todo limpio:** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`. Línea de base antes de tocar nada.

## Hallazgos aparte
1. `AGENTS.md` (sección «Quién escribe código») trae su propio «supuesto declarado» sobre el alcance de esa regla: es del mismo tipo que lo que esta regla prohíbe; conviene convertirlo en pregunta o en aceptación citada.
2. La memoria `feedback-autonomia-segun-principios.md` (2026-10-08, en `motor2-docs`) debe actualizarse con I8.
3. `docs/diseno-reemplazar-carta-de-sucursal-2026-11-10.md` usa «CONFIRMADA por omisión»: conviene renombrarlo «FUERA DE ALCANCE (no pedido)».
4. El registro de decisiones del dueño vive en otro repo (`motor2-docs/_planes/`) y termina el 2026-10-08; el CI no lo ve.
