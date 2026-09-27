---
name: plan-con-verificacion-e2e
description: Diseñar planes de implementación (con Agent tool, subagent_type "Plan", modelo Opus) para un backlog de pendientes que ya no dependen de una decisión de negocio. Usar cuando hay varios ítems de backlog independientes y hace falta un plan por cada uno ANTES de tocar código. Cada plan generado debe exigir, como paso final obligatorio, verificación end-to-end contra la suite TOTAL del proyecto (no solo el área tocada), con comandos concretos y criterio de éxito explícito — nunca "correr los tests" en abstracto.
---

# Planificar con Opus + gate de verificación end-to-end obligatorio

Portable a cualquier proyecto: no asume Next.js, Prisma, Vitest ni Playwright
en particular — donde aparece un ejemplo concreto (motor2), está marcado como
tal. Lo único no negociable es la estructura del proceso: **un agente por
pendiente, modelo Opus, y un paso final de verificación total que el propio
prompt describe con comandos, no con una frase genérica**.

## Cuándo usar esto

- Hay un backlog de pendientes ya identificados (de una auditoría, un
  documento de decisiones, o hallazgos de code review) y varios de ellos
  **no dependen de que el usuario decida algo primero** — son implementables
  tal cual, aunque nadie escribió todavía el plan concreto.
- El usuario pide diseñar los planes antes de escribir código, y quiere que
  el diseño use el modelo más capaz disponible (Opus) en vez del modelo por
  defecto del agente de planificación.
- Cada pendiente es independiente de los demás → se pueden lanzar varios
  agentes de planificación **en paralelo**, en un solo mensaje con varios
  `Agent` calls, no uno por uno.

No usar esto para un pendiente que todavía necesita una decisión de negocio
(alcance ambiguo) — ahí primero hay que resolver la decisión (o pedirle al
mismo agente que devuelva variantes con trade-offs para que decida el
usuario, sin implementar ninguna a ciegas).

## El proceso

1. **Uno por pendiente, en paralelo cuando son independientes.**
   `Agent({ subagent_type: "Plan", model: "opus", description: "...",
   prompt: "..." })`. Varios pendientes independientes van en el mismo turno,
   como varios `Agent` calls — no uno detrás del otro.

2. **El prompt de cada agente tiene que incluir, explícitamente**:
   - Qué hallazgo/pendiente concreto hay que resolver (con la evidencia que
     ya se tenga: archivo, línea, comportamiento observado).
   - Instrucción de **leer el código real antes de proponer nada** — un
     pendiente descrito en un documento puede estar desactualizado (ver
     "Lección aprendida" más abajo); el agente tiene que confirmar contra el
     código actual, no asumir que la descripción del pendiente sigue siendo
     cierta.
   - Que **no implemente nada** — el agente de planificación entrega texto,
     nunca código ni migraciones.
   - Que el plan tenga pasos **chicos y reversibles** (idealmente un commit
     por paso), en orden.
   - Que cualquier paso que toque el schema/una migración de base de datos
     quede marcado explícito como **"requiere autorización expresa"**, y
     separado de los pasos que no la necesitan.
   - **El paso final obligatorio de verificación end-to-end** (ver sección
     siguiente) — sin este paso, el plan no está completo.

3. **Recolectar los planes** (llegan como hand-back de cada agente) y
   presentarle al usuario un resumen por plan: qué encontró, qué recomienda,
   qué riesgo o decisión quedó pendiente. No hace falta reproducir el plan
   entero — el usuario ya lo tiene en el mensaje del agente.

## El paso final obligatorio: qué tiene que decir el prompt

No alcanza con pedir "verificación end-to-end". Hay que pedir, en el propio
prompt del agente de planificación, que el plan **enumere los comandos
concretos** y el **criterio de éxito** de cada uno. En este proyecto
(motor2) las herramientas ya son las siguientes — usar estos comandos
literales, no una paráfrasis. Desde 2026-09-27 la batería obligatoria es de
**6 comandos**, en este orden: `npx tsc --noEmit`, `npm run lint`, `npm run
arquitectura`, `npm test`, `npm run build`, `npm run test:e2e` (la fila de
accesibilidad ya corre dentro de `npm run test:e2e`):

| Capa | Qué prueba | Comando en motor2 | Criterio de éxito |
|---|---|---|---|
| Tipos | El cambio no rompe el tipado del proyecto entero, no solo del archivo tocado | `npx tsc --noEmit` | Salida vacía (el único ruido preexistente y ajeno es `LayoutProps` de `layout.tsx`) |
| Lint | Cero errores y cero warnings nuevos | `npm run lint` (ESLint, flat config) | 0 errores, 0 warnings |
| Arquitectura | Fronteras entre capas/módulos: `core/` no importa de `app/`/`components/`/`server/` ni de React/Next, la UI no usa Prisma en runtime, `server/actions`/`consultas`/`persistencia` no se mezclan, sin ciclos, sin paquetes no declarados en `package.json` — capa nueva desde 2026-09-27 (Task #41, Fase A3) | `npm run arquitectura` (`depcruise src --config .dependency-cruiser.cjs`; excepciones con motivo en `.dependency-cruiser-excepciones.cjs`, revisadas en las dos direcciones por `test/arquitectura/dependencias.test.ts`) | Sale con código 0 (`no dependency violations found`). Nunca se baja la severidad de una regla ni se agrega una excepción sin motivo para que pase |
| Unitaria/integración | Lógica de negocio contra Postgres real, sin mocks (`fileParallelism: false`) — la suite ENTERA, nunca solo el archivo tocado | `npm test` (Vitest) | Todos los archivos en verde; conteo de tests igual o mayor a la línea de base |
| Accesibilidad (WCAG 2.1) | Que la UI no introduzca violaciones detectables automáticamente — capa nueva desde 2026-09-20, hoy solo en `test/e2e/accesibilidad.spec.ts` (login + un reporte autenticado) | `npx playwright test test/e2e/accesibilidad.spec.ts` (o la suite completa, que ya la incluye) | `violations` vacío en cada página cubierta. Al tocar una pantalla nueva, evaluar sumarle su propio chequeo con `@axe-core/playwright` (`new AxeBuilder({ page }).analyze()`) en vez de asumir que las dos páginas ya cubiertas alcanzan |
| Build | El artefacto de producción compila limpio | `npm run build` (`prisma generate && prisma migrate deploy && next build`) — ojo, aplica migraciones: apuntar `DATABASE_URL`/`DIRECT_URL` a una base local o descartable, nunca a producción | Build exitoso, sin warnings nuevos |
| E2E / navegador real | Lo que solo un navegador real detecta (HTML inválido, hidratación, formularios anidados, redirecciones) — la suite ENTERA, no un spec suelto | `npm run test:e2e` (Playwright, `workers: 1`, requiere Postgres migrado+sembrado; la propia config levanta el servidor: por defecto `next build` + `next start`, con `MOTOR2_E2E_SERVIDOR=dev` para volver a `next dev`) | Todos los specs en verde; conteo de specs igual o mayor a la línea de base |

Si el proyecto que estás planificando **no** es motor2, reemplazar esta
tabla por los comandos reales de ESE repo antes de usar la skill — ver
"Para reusar en otro proyecto" al final.

Y además, el prompt tiene que pedir:

- **Conteo de referencia (línea de base) antes de tocar nada**: correr la
  suite en el estado actual y anotar cuántos tests/specs hay. Al final, el
  conteo tiene que ser igual o mayor — nunca menos (un test que desaparece
  sin explicación es una regresión de cobertura, no una limpieza).
- **Criterio de cierre explícito y conjunto**: "el pendiente se considera
  terminado solo cuando TODOS los comandos anteriores pasan limpios en la
  MISMA corrida" — no basta con que cada uno haya pasado alguna vez por
  separado.
- **Qué specs/áreas mirar con atención especial**, más allá del veredicto
  global: cuáles son los que ejercitan justo lo que el cambio toca (rutas
  movidas, permisos nuevos, campos nuevos).
- Si el propio pendiente ES sobre testing (agregar un test, endurecer una
  guarda): pedir que el plan incluya **la demostración de que el test nuevo
  detecta lo que dice detectar** — mutar temporalmente el código para
  reproducir el bug original, mostrar el test nuevo en rojo, revertir la
  mutación, mostrarlo en verde. Un test en verde que nunca se vio fallar no
  prueba nada.

## Lección aprendida (por qué el paso de "leer el código real" no es opcional)

En la práctica, de un lote de 6 planes diseñados así, uno arrancó con la
premisa "esto nunca se ejecutó" (tomada de un documento de auditoría) y el
agente, al leer el código, encontró que **sí se había ejecutado**, con una
conclusión ya tomada, y que el pendiente real era otro (cerrar los huecos de
esa corrida, no partir de cero). Otro plan destapó que el hallazgo que se le
pasó como motivación estaba mal atribuido (dos reportes que "no consumían" un
cálculo en realidad lo ejecutaban igual, por una llamada transitiva, y lo
descartaban sin mostrarlo). **Ningún documento de backlog es la fuente de
verdad — el código sí.** Por eso el prompt exige leer y verificar antes de
diseñar, no confiar en la descripción del pendiente tal como llegó.

## Checklist adicional para cualquier plan que toque una suite E2E existente

Si el pendiente (o el plan que lo resuelve) toca specs de un navegador real
ya existentes, pedirle al agente que confirme explícitamente:

- **¿Hay aislamiento/limpieza de datos entre corridas?** Buscar
  `globalSetup`/`globalTeardown` o un `deleteMany`/reset equivalente en la
  config del runner E2E. Si no hay nada y el único mecanismo es "nombres
  únicos por timestamp", **decirlo explícito** en el plan — no asumir que la
  suite es segura de correr repetidamente solo porque hoy no falla. (Hallazgo
  real de este tipo, motor2, 2026-09-20: sin limpieza entre specs, 14/19
  specs con `Date.now()` en el nombre, datos residuales confirmados en un
  ambiente real.)
- **¿El servidor E2E corre en modo desarrollo o el artefacto de producción?**
  Si es modo desarrollo (`next dev` o equivalente), señalar que la
  compilación bajo demanda en la primera navegación a cada ruta es una fuente
  de lentitud/flakiness en CI, y que cambiar a build+start tiene su propio
  costo (separar el build de la aplicación de cualquier paso que aplique
  migraciones; confirmar que ningún spec depende de un comportamiento
  específico del modo desarrollo, como un overlay de errores más detallado;
  y, si el proyecto usa Auth.js, que `next start` deja `NODE_ENV=production` y
  entonces hace falta `AUTH_TRUST_HOST`). **Medir antes de asumir**: en motor2
  (Next 16, Turbopack) se estimaba que build+start costaba +0 a +45 s y resultó
  ~37 % MÁS RÁPIDO (129 s contra 206 s en 192 tests) porque desaparece la
  compilación bajo demanda. En Next 16 `next dev` escribe en `.next/dev`, así
  que ya no pisa el `.next` de un build (en versiones anteriores sí).

## Plantilla de prompt (para copiar y adaptar)

```
Repo: <ruta>. Investigá el código actual y diseñá un plan de implementación
(NO implementes nada) para: <descripción del pendiente, con la evidencia que
ya se tenga: archivo, línea, comportamiento observado>.

Leé el código real antes de proponer nada: <archivos relevantes>. No asumas
que la descripción de arriba sigue siendo exacta — confirmala contra el
código actual y corregila si hace falta.

El plan debe cubrir: <diseño concreto>, <alternativas si hay más de un
camino, con trade-offs>, y pasos de implementación chicos y reversibles, en
orden. Cualquier paso que toque el schema/una migración va marcado
"requiere autorización expresa" y separado del resto.

Un paso final OBLIGATORIO y explícito de verificación end-to-end sobre la
suite TOTAL del proyecto (no solo el área tocada): npx tsc --noEmit, npm run
lint, npm run arquitectura (dependency-cruiser), npm test (Vitest contra
Postgres real), npm run build, npm run test:e2e (Playwright) y, si el pendiente toca una pantalla, evaluar si conviene
sumarle su propio chequeo de accesibilidad con @axe-core/playwright junto a
los de test/e2e/accesibilidad.spec.ts — con línea de base antes de empezar y
criterio de éxito conjunto. Si el pendiente es sobre testing, agregá la
demostración de que el test nuevo detecta lo que dice detectar (mutación
temporal → rojo → revertir → verde).

Entregá el plan en texto claro, no lo implementes.
```

## Para reusar en otro proyecto

Lo único no negociable al copiar esta skill a otro repo es la estructura del
proceso: `Agent` con `subagent_type: "Plan"` y `model: "opus"`, uno por
pendiente, con un paso final de verificación total descrito con comandos.
La tabla de "paso final obligatorio" de arriba está llena con los comandos
**literales de motor2** (Node/Next/Prisma/Vitest/Playwright/axe) — es a
propósito, para que quede un ejemplo real y no una plantilla vacía, pero
**hay que reemplazarla por los comandos reales del otro proyecto** antes de
usar la skill ahí (compilador, linter, control de fronteras entre módulos, test runner, build,
e2e y, si aplica, la capa de accesibilidad — no todos los proyectos la van a tener). Si el
otro proyecto no tiene una capa (por ejemplo, no tiene suite E2E todavía),
sacar esa fila de la tabla en vez de dejarla con un comando inventado.
