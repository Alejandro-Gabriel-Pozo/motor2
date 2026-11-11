<!-- BEGIN:nextjs-agent-rules -->

## This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

## Diseño de planes de implementación (pendientes de backlog)

Al diseñar el plan de un pendiente de backlog que ya no depende de una
decisión de negocio (auditorías, hallazgos de code review, ítems de
`docs/pendientes-*.md`), usar la skill `plan-con-verificacion-e2e`
(`.claude/skills/plan-con-verificacion-e2e/SKILL.md`): un agente de
planificación por pendiente (`Agent`, `subagent_type: "Plan"`, `model:
"opus"`), lanzados en paralelo cuando son independientes, cada uno con la
instrucción de verificar el código real antes de proponer nada (un
pendiente descrito en un documento puede estar resuelto o mal atribuido) y
con un paso final obligatorio de verificación end-to-end contra la suite
TOTAL del proyecto (tipos, lint, arquitectura, tests unitarios/integración,
build y e2e con Playwright — comandos concretos y criterio de éxito, nunca
"correr los tests" en abstracto).

Gate de verificación obligatorio (desde 2026-09-27, Task #41 Fase A3; 7
comandos desde la Fase K3 y 8 desde que existe la consola de plataforma,
`plataforma:build`): en la MISMA corrida y todos limpios — `npx tsc
--noEmit`, `npm run lint`, `npm run arquitectura` (dependency-cruiser,
`.dependency-cruiser.cjs`; excepciones con motivo en
`.dependency-cruiser-excepciones.cjs`), `npm run analizar:muerto` (knip, CON
código de salida — 0 hallazgos obligatorio; excepciones legítimas con motivo
en `knip.jsonc`), `npm test`, `npm run build`, `npm run plataforma:build` (la
consola, otra app Next: un fallo de dependencias solo aparece al construirla) y
`npm run test:e2e`.

## Diseño de módulos y features nuevos (regla del dueño, 2026-10-26)

Todo módulo o feature nuevo (compras, reservas, ventas, caja, clientes, lo que venga) y todo arreglo sustancial de uno existente se diseña ANTES de tocar tablas o pantallas, con la escalera de diseño de 10 niveles: 1 propósito y alcance, 2 actores y contexto, 3 casos de uso, 4 conceptos y ciclo de vida, 5 invariantes y políticas, 6 historia y persistencia, 7 atomicidad y concurrencia, 8 acceso e interfaces, 9 consultas y experiencia, 10 pruebas, migración y operación.

- Compuerta: no se diseñan ni migran tablas (nivel 6) sin tener confirmados los niveles 1 a 5. Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA. Para cada comando, la tabla «¿qué pasa si…?»: repetición, concurrencia, tiempo, incertidumbre, reintento, error parcial, datos faltantes, cambio de permisos.
- Escalera de producto N0 a N5 por módulo (lo que ve el cliente): peldaños acumulativos que no rompen lo cargado; formalidad y detalle son ejes separados; lo que falta se muestra como «pendiente de completar», nunca se inventa. Es una escalera distinta de la de diseño: se cruzan en el nivel 5.
- Se diseña el modelo completo y escalable en papel, pero SOLO se migran las tablas de la etapa que se implementa, con puntos de extensión previstos (relaciones opcionales, estados con CHECK, historial que solo agrega) y migraciones aditivas y reversibles. Nada de tablas «a ciegas» que nadie escribe.
- Antes de crear un modelo, inventariar lo que ya existe con otro nombre (validar contra el código real, no contra documentos). Antes de diseñar o auditar un módulo, revisar también el repositorio `motor2-docs` (`_planes/`, decisiones del dueño, ADR): puede haber un plan aprobado que el código todavía no tiene (la auditoría de abastecimiento del 2026-10-27 dijo «bienes de uso: no existe» por mirar solo `src/`). Reutilizar módulos, planes, permisos y centros de costos existentes antes de inventar tablas de niveles o reglas.
- Los arreglos sobre lo ya construido siguen el mismo método: auditar el módulo contra la escalera (invariantes, concurrencia, niveles) y corregir en pasos chicos, sin refactorizar lo que no se pidió.
- Primero la opción más barata (regla del dueño, 2026-10-27): ante una idea o un faltante, antes de proponer pantallas o tablas nuevas verificar si ya existe en el código y, si no, proponer la forma MÁS BARATA que permita empezar a usarlo (configuración, reutilizar lo existente, un cambio chico) y dejar lo grande como etapa posterior con nombre. «Si no, el sistema jamás está terminado y hay que empezar a usarlo.»
- Combinaciones (regla del dueño, 2026-10-28, vale para TODO el sistema, no solo la carta): cada módulo o feature declara en su diseño (nivel 10, pruebas) las DIMENSIONES cuyas combinaciones cambian dinero, permisos, visibilidad o stock, con una tabla de reglas esperadas escrita aparte del código (un oráculo legible), y un test que recorre todas las combinaciones (exhaustivo si son pocas; propiedades con `fast-check` o pares si son muchas) contra esa tabla. Un guardián debe fallar si aparece una dimensión nueva (una columna, una opción, una clave) sin declarar si afecta o no. Sin librerías nuevas sin avisar. Mapa de lo que ya existe y lo que falta: `docs/mapa-cobertura-de-combinaciones-2026-10-28.md`.
- Poda (regla del dueño, 2026-10-28): se prefiere que el sistema crezca y se achique las veces que haga falta antes que mantener funciones u opciones que no vienen del producto original ni resuelven una necesidad. Cada feature declara en su diseño la NECESIDAD que resuelve (quién la pidió y dónde está escrita); toda opción o dimensión cuyas combinaciones dan el mismo resultado, o que no se puede ligar a una necesidad, es candidata a ocultarse (interruptor reversible) y después a borrarse, con el aviso al dueño. Un cero de uso en producción es evidencia débil mientras haya pocos datos reales: la que manda es la necesidad.
- Alcance de la petición (regla del dueño, 2026-10-28): el agente hace SOLO lo que se pide y no asume nada ni suma funciones que nadie pidió (un cupo extra, días de disponibilidad, opciones «por las dudas»). Si la petición es ambigua, no hace nada hasta resolver la ambigüedad con UNA pregunta; mientras tanto deja constancia como pregunta abierta, no como supuesto. Antes de construir se verifica que la necesidad esté escrita (quién la pidió y cuándo); si hay una forma más simple con lo que ya existe (subir el cupo original, apagar los días que no valen), se propone esa.
- El documento de diseño vive en `docs/diseno-<modulo>-AAAA-MM-DD.md` (ver el piloto de clientes, convenios y facturación externa).

## Quién escribe código (regla del dueño, 2026-11-04)

Los modelos **Opus** y **Fable** (cualquier versión) **no escriben código** en este proyecto: planifican, revisan y verifican. El código (`src/`, `test/`, `prisma/`, `scripts/` y la configuración) lo escribe **Sonnet**.

- Una sesión que corre en Opus o Fable no edita código con sus propias herramientas: delega cada cambio a un subagente Sonnet (`Agent` con `model: "sonnet"`), revisa el diff y corre las verificaciones. Los arreglos que salgan del gate también los hace un Sonnet.
- Todo subagente que se lance para escribir código es Sonnet. Los agentes de planificación (`Plan`, `model: "opus"`, ver «Diseño de planes») entregan texto, no código.
- En el informe final de cada tarea se declara qué código salió de qué modelo.
- Alcance (supuesto declarado, el dueño lo corrige si no es así): la regla es sobre código. Los documentos de diseño (`docs/`) y las operaciones de git no la alcanzan.

## Maquetas con pantallas y datos reales (regla del dueño, 2026-11-05)

Toda maqueta o captura que se le muestre al dueño para aprobar es la **pantalla real del sistema con datos reales de su empresa** (el bife, el jugo Fresli, sus proveedores y precios), no un dibujo HTML armado aparte con datos inventados: así se pierde el contexto y no se entiende.

- Si la pantalla todavía no existe, se arma la pantalla real mínima en una rama (sin migración ni lógica extra) y se captura sobre datos reales.
- Los datos reales se leen de producción solo en lectura, o se copian a una base local descartable; nunca se escribe en producción para una maqueta. Los datos de prueba con sufijos numéricos no sirven para que el dueño apruebe: confunden.
- Capturas a 375 px (celular) y, si hace falta, a escritorio.
- Las maquetas HTML anteriores al 2026-11-05 (carpeta `_maquetas/` de `motor2-docs`) quedan como antecedente; la de promos, ya aprobada, se respeta.
- Detalle y motivo: `motor2-docs/memoria-claude/feedback-maquetas-con-datos-y-pantallas-reales.md`.

## Lo que el dueño no pidió no entra (regla del dueño, 2026-11-11)

Ningún agente ni sesión anidada agrega al producto algo que el dueño no pidió. Lo puede **sugerir** (en el PR, nunca en código) y puede **registrar decisiones chicas** que esperan su OK, como en Pedernal. Caso real que la motiva: en promociones aparecieron «días de disponibilidad» que el dueño nunca pidió y hubo que borrarlos. Diseño y decisiones citadas (fecha y palabras del dueño): `docs/diseno-aceptacion-del-dueno-2026-11-11.md`. «Producto» = lo que ven o usan las personas: campos, opciones, textos, reglas de negocio, funciones, permisos y valores por defecto.

- **I1 Aceptación válida.** Solo del dueño, con fecha AAAA-MM-DD, texto literal entre « » y fuente localizable. No valen «lo aprobó el orquestador», «lo decidió la sesión», «el padre lo autorizó» ni «confirmada por omisión». Previene: que un agente se autorice solo. Chequeo: apartado «Pedido y aceptación del dueño» de la plantilla de PR.
- **I2 Silencio no es aceptación.** Una decisión pendiente no se presenta como definitiva, se cuenta y no desaparece sola; lo que no es decisión (una mejora) y no tiene pedido no entra. Previene: funciones «por las dudas». Chequeo: cada renglón de «Qué entra al producto» lleva su cita.
- **I3 Las sugerencias no son código.** Van en «Sugerencias (no implementadas)» o en `docs/`; ningún rastro en `src/`, `prisma/` ni `test/`. Previene: «implementado esperando OK». Chequeo: revisión del orquestador sobre el diff.
- **I4 Un `SUPUESTO` en el código solo existe como `SUPUESTO(DEC-n)` con su entrada en el registro de decisiones.** Previene: decisiones de negocio escondidas en comentarios. Chequeo: guardián de E2; hasta entonces, la revisión del orquestador.
- **I5 Se pregunta antes** lo que cambia qué se construye, el comportamiento, los datos, el dinero, los permisos, los textos que ve el cliente o la prioridad (UNA pregunta; las partes no ambiguas avanzan, regla del 2026-10-28). La decisión registrada (DEC) es solo para lo que no se puede frenar. Previene: construir sobre una interpretación propia.
- **I6 Tope de 10 DEC pendientes abiertas;** con 10 no se agrega una nueva, se pregunta. Las de más de 14 días van primero en el resumen de cada PR (apartado «Decisiones mías que esperan tu OK», la más vieja primero, con su costo de revertir). Previene: que el registro se vuelva el lugar donde nadie revisa (en Pedernal, 79 de 80 sin revisar).
- **I7 Una DEC nunca suma funcionalidad, campos ni opciones:** solo elige la opción más chica y reversible dentro de lo pedido, necesaria para terminar. Una mejora es sugerencia, no DEC.
- **I8 Lo técnico interno** (pruebas, guardianes, reorganizar, arreglos de seguridad) sigue con la autonomía del 2026-10-08, siempre dentro de lo pedido.
- **I9 Las aceptaciones no vencen solas;** solo las revoca el dueño con una cita nueva, y un PR propio saca lo revocado.

Estados de una DEC: `PENDIENTE_DE_OK` → `ACEPTADA` | `CORREGIDA` | `REVOCADA`, siempre con la cita del dueño. Los PR de Dependabot están exentos (PROPUESTA, pendiente de confirmar). La plantilla `docs/pull_request_template.md` ordena el resumen que lee el dueño. El registro `docs/registro-de-decisiones.md` y su guardián llegan con E2, y el chequeo del cuerpo del PR con E3; hasta E2 los supuestos los controla la revisión del orquestador. Límite honesto: una máquina no puede saber si una cita es realmente del dueño, solo que está y tiene forma.

## Exploración con Explore

Antes de tocar código en una tarea que obliga a ubicar algo en más de ~10 archivos
(dónde se usa X, qué acciones no pasan por el caso de uso, qué lecturas exigen qué
permiso), lanzar primero el agente `Explore` (`Agent`, `subagent_type: "Explore"`)
con el nivel de profundidad que corresponda ("medium" o "very thorough").

- Explore solo ubica; no audita ni cierra nada. El cierre de cada hito lo decide
  el auditor independiente, nunca el resultado de Explore.
- Sus conclusiones son punto de partida: verificar en el código real antes de
  actuar, sobre todo en seguridad, dinero y permisos.
- Archivo conocido o búsqueda corta: leer directo, sin Explore.
- Varias búsquedas independientes: lanzarlas en paralelo.

