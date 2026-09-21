# Deuda técnica preexistente: flake de C2 + inventario ESLint (2026-09-17)

**Alcance**: tarea separada de I3, autorizada explícitamente para investigar y, si es posible, resolver dos focos de deuda técnica detectados durante la verificación de I3 pero NO causados por I3: (1) una falla intermitente observada en un test de C2, (2) el conjunto de warnings de ESLint acumulados a lo largo de toda la auditoría (N3/C2/R2/I3).

**Restricciones respetadas**: sin cambios de schema, sin migraciones, sin tocar la política/mecanismo de I3, sin cambiar contratos de Server Actions, sin tocar producción/Neon. Commit separado del de I3.

---

## Parte A — Flake de `concurrencia-idempotencia.test.ts`

### Identificación

El test exacto: `test/auditoria/concurrencia-idempotencia.test.ts`, describe "Escenario 1", it `"REGRESIÓN (Plan C2): con dos operaciones concurrentes que SÍ deberían poder convivir (stock de sobra), conTransaccionSerializable debe reintentar SIEMPRE — nunca un rechazo crudo del driver, 15/15 corridas"`. Internamente hace un loop de 15 iteraciones, cada una lanzando 2 `registrarMovimiento` CONSUMO verdaderamente concurrentes (`Promise.allSettled`) sobre el mismo producto+sección, y afirma `rechazados.length === 0` en cada iteración — es decir, que `conTransaccionSerializable` (el fix de C2) siempre absorbe el conflicto de escritura vía reintento, nunca deja escapar una promesa rechazada.

Se observó **una** falla de esta assertion en una corrida anterior (durante la verificación de I3, corriendo solo el directorio `test/auditoria/`) — no se guardó el log completo de esa corrida específica, así que no se pudo recuperar el tipo/mensaje exacto del error que causó el rechazo.

### Reproducción (secuencia exigida)

| Paso | Resultado |
|---|---|
| Reproducir aislado, 20 corridas del archivo completo filtrado a este test (cada corrida = 15 sub-iteraciones internas = 300 sub-iteraciones totales) | **20/20 limpias** |
| Reproducir dentro de la suite completa, 5 corridas completas (cada corrida incluye las 15 sub-iteraciones de este test = 75 sub-iteraciones adicionales) | **5/5 limpias, 351/351 tests** cada vez |

Total: **25 corridas, ~390 sub-iteraciones del bucle de concurrencia real, 0 reproducciones** de la falla original.

### Aislar / identificar causa

No se pudo re-observar la falla para capturar el error real, así que la causa no se pudo confirmar empíricamente. Se descartaron por evidencia, no por suposición, las siguientes categorías:

| Categoría propuesta | Descartada por |
|---|---|
| Contaminación entre tests / datos compartidos | `limpiarBaseDeTest()` en `beforeEach` vacía la base entera antes de cada test — y la falla no correlaciona con "corrida dentro de la suite" vs. "corrida aislada" (0% de fallas en ambos contextos, ~390 intentos) — si fuera contaminación cruzada, se esperaría una tasa de fallo distinta entre ambos contextos |
| Orden de ejecución | `fileParallelism: false` (vitest.config.ts) — los archivos corren secuenciales, nunca dos archivos tocan la DB al mismo tiempo; dentro del mismo archivo, los tests corren en el orden declarado, sin overlap |
| Cleanup incompleto | Mismo argumento que contaminación — `limpiarBaseDeTest()` es incondicional y total, no selectivo |
| Dependencia de Postgres / timing | Posible, no descartada — ver hipótesis abajo |
| Problema real de concurrencia (C2) | Posible, no descartada — ver hipótesis abajo |

**Lectura del código relevante** (`src/core/movimientos/con-reintento.ts`): una promesa solo puede llegar "rechazada" al `Promise.allSettled` del test si `esConflictoDeEscritura(e)` devuelve `false` para lo que sea que Postgres/el adapter haya lanzado en ese intento — la función reconoce únicamente `P2034` (Prisma) y `DriverAdapterError` con `cause.kind === "TransactionWriteConflict"` (adapter-pg), deliberadamente estrecho para no enmascarar un error real de infraestructura (ver el propio comentario del código). Dos hipótesis quedan abiertas, ninguna confirmada:

1. **Ruido de infraestructura genuino**: un hipo transitorio de la instancia local de Postgres de este contenedor (única, compartida, no un servicio gestionado) durante la ventana exacta de una de las ~390+ carreras reales ejecutadas a lo largo de toda esta sesión — coherente con que NUNCA se haya podido reproducir a pedido pese a un esfuerzo extenso.
2. **Un tipo de error de Postgres bajo contención real que `esConflictoDeEscritura` no reconoce** — ej. alguna variante de error que no mapea a `P2034` ni a `TransactionWriteConflict` pero que igual es, en el fondo, un conflicto de serialización genuino.

### No se modificó código de producción

Siguiendo la instrucción explícita ("si el problema está en producción o en C2, detenete y documentá el impacto antes de modificarlo"): **no se tocó `con-reintento.ts`**. Modificar `esConflictoDeEscritura` para ampliar qué se considera "reintentable" sin poder observar el error real que motivaría el cambio sería especulativo — el riesgo concreto es empezar a reintentar errores que en realidad SÍ son infraestructura real (conexión caída, timeout), exactamente lo que ese diseño evita a propósito.

**No se aumentó el timeout, no se redujo la cantidad de iteraciones del test, no se agregó ningún retry al test** — el test queda exactamente como estaba.

### Verificación de que no se degradó la cobertura de C2

- Los 25 runs de reproducción (20 aislados + 5 de la suite completa) son, en sí mismos, la verificación: C2 sigue demostrando su garantía (0 rechazos crudos) de forma consistente.
- Invariantes del Kardex: la suite completa (351/351, incluyendo todos los tests de saldo/atomicidad de `test/auditoria/`, `test/movimientos/`, `test/stock/`) sigue en verde — ningún invariante de saldo/signo se rompió.

### Conclusión — clasificación

**No se puede clasificar con certeza** entre "ruido de infraestructura de este contenedor" y "un tipo de error de Postgres no cubierto" — ninguna de las dos hipótesis se pudo confirmar ni descartar sin poder observar el error real. Lo que SÍ queda descartado con evidencia (no supuesto): no es contaminación entre tests, no es orden de ejecución, no es cleanup incompleto. La tasa de reproducción observada (0 en ~390 intentos, tras una única falla previa no capturada) es consistente con un evento extremadamente raro, no con un defecto sistemático de C2.

**Esta deuda NO se declara cerrada** — queda documentada, no resuelta, tal como pidió el usuario ("yo no lo declararía cerrado hasta saber por qué ocurre"). Recomendación concreta para la próxima vez que ocurra: capturar el log completo de la corrida (no solo el resumen) antes de volver a correr nada, específicamente `rechazados[0].reason.constructor.name` y `.message` (el test ya los loggea si ocurre — ver línea 89 del archivo) — eso es lo que falta para pasar de "hipótesis" a "causa confirmada".

### Actualización 2026-09-18 — primera reproducción real capturada

Nueva sesión, mismo test, ahora contra un Postgres 16 local (paquete `postgresql-16` del contenedor, no Neon ni `docker compose` — no había daemon de Docker disponible; se migró `motor2_test` local con `prisma migrate deploy` para poder correr la suite).

**Se reprodujo la falla** (algo que las 25 corridas de la sesión anterior no habían logrado):

| Tanda | Corridas | Reproducciones |
|---|---|---|
| Aislado (`-t "REGRESIÓN"`), sin diagnóstico extra | 40 | **1** (run 3, intento 9 del loop interno) |
| Aislado, con logging de `.code`/`.meta`/`.cause` agregado (commit `97c1d40`) | 300 | 0 |
| `test/auditoria/` completo (9 archivos, contexto más parecido al de la observación original) | 30 | 0 |
| **Total** | **370** (+ las 5 corridas de suite completa de la sesión anterior no vueltas a contar acá) | **1** |

Tasa observada: ~0.27% (1/370) — sigue siendo un evento raro, no un defecto sistemático (consistente con la clasificación de la sesión anterior).

**Lo que sí se pudo capturar de la única reproducción** (log completo, no solo el resumen):

```
[auditoria] Intento 9: promesa rechazada — PrismaClientKnownRequestError
Invalid `tx.operacion.create()` invocation in
/home/user/motor2/src/server/actions/movimientos/movimientos.ts:290:44
```

Esto **confirma la hipótesis 2** del análisis anterior, no la 1: no es un `DriverAdapterError` crudo (ruido de infraestructura/conexión) — es un `PrismaClientKnownRequestError` real, lanzado desde el propio `tx.operacion.create()` (línea 290), un tipo que `esConflictoDeEscritura()` sí sabe reconocer **cuando el código es `P2034`** — pero el mensaje capturado es el prefijo genérico que Prisma arma para *cualquier* `*KnownRequestError` en un `.create()` (incluye siempre la misma cita del código fuente alrededor de la línea de la invocación), así que **no alcanza para saber si el `.code` era `P2034`** (y por lo tanto `esConflictoDeEscritura` sí lo reconoció pero igual escaló porque ya era el último de los 5 intentos de `conTransaccionSerializable`) **o si era un código distinto que la función no cubre** (ej. algún otro error de Postgres bajo contención real, mapeado a un `PrismaClientKnownRequestError` en vez de al `DriverAdapterError` esperado).

Para distinguir esos dos casos hacía falta `.code` — no se guardó en la corrida anterior porque el logging de entonces solo capturaba `constructor.name` y los primeros 200 caracteres del `.message`. Se amplió el log del test (commit `97c1d40`, sin tocar `con-reintento.ts` ni ningún código de producción) para capturar `.code`/`.meta`/`.cause`/mensaje completo la próxima vez — las 300 corridas posteriores a ese cambio no volvieron a reproducir la falla, así que **sigue sin confirmarse cuál de las dos ramas es**.

**Nueva hipótesis, ahora más acotada, para cuando vuelva a ocurrir**:
- Si el `.code` resulta ser `P2034`: el bug no está en qué se reconoce como conflicto, sino en que **5 intentos no alcanzan** bajo la contención real de este escenario — subiría `maxIntentos` (o backoff) a discutir, no ampliar `esConflictoDeEscritura`.
- Si el `.code` es distinto de `P2034` (o no hay `.code`, ej. un error de validación real): ahí sí habría un tipo de conflicto de escritura genuino que `esConflictoDeEscritura` no cubre, y correspondería ampliarla — pero solo con el código real en mano, no antes.

Sigue sin cerrarse. El logging ampliado queda commiteado y en la rama de forma permanente (no es instrumentación descartable: es exactamente el dato que falta) — la próxima corrida de CI o de auditoría que lo reproduzca ya va a traer la respuesta en el log.

### Actualización 2026-09-18 (misma sesión, más tarde) — causa confirmada: rama `P2034`, no la del código no cubierto

Se corrieron 400 tandas más (551 a 950), mismo test aislado, mismo Postgres local, con el logging ampliado ya activo. **2 reproducciones nuevas** (runs 595 y 820 — intentos 12 y 11 del loop interno respectivamente), ambas con el mismo diagnóstico exacto:

```
code= P2034
meta= {"modelName":"Operacion","driverAdapterError":{"name":"DriverAdapterError","cause":{"originalCode":"40001","originalMessage":"could not serialize access due to read/write dependencies among transactions","kind":"TransactionWriteConflict"}}}
```

Esto responde la pregunta que quedaba abierta: **es la rama `P2034`, no la del código no cubierto.** `esConflictoDeEscritura()` funciona exactamente como está documentado — reconoce el conflicto en cada uno de los intentos — pero en estas dos corridas **las dos operaciones concurrentes chocaron en los 5 de 5 intentos** de `conTransaccionSerializable` (sin backoff/jitter entre reintentos: el `catch` hace `continue` inmediato), así que en el último (`intento === maxIntentos - 1`) ya no reintenta y deja escapar la promesa rechazada — comportamiento esperado del código tal como está escrito, no un bug de reconocimiento.

**Total acumulado de la sesión**: 950 corridas aisladas + 30 del directorio completo, **3 reproducciones** (~0.3%). Tasa baja pero ya no es "ruido no clasificable" — es agotamiento de reintentos bajo colisión repetida, reproducible con evidencia consistente dos veces seguidas.

**Esto ya se puede clasificar y cerrar la investigación** (queda pendiente decidir si se actúa sobre el hallazgo, ver más abajo):
- ~~Ruido de infraestructura genuino~~ — descartado: el `.code`/`.meta` es un conflicto de serialización real de Postgres (`40001`), no un error de conexión/timeout.
- ~~Un tipo de error no cubierto por `esConflictoDeEscritura`~~ — descartado: es exactamente el caso que la función reconoce.
- **Confirmado**: `maxIntentos = 5` sin backoff ocasionalmente no alcanza cuando dos transacciones `SERIALIZABLE` sobre la misma fila reintentan en un timing lo bastante parecido como para volver a chocar varias veces seguidas — más probable cuanto más rápido y sincrónico es el reintento (sin jitter, las dos transacciones tienden a reintentar casi al mismo tiempo).

**No se modificó `con-reintento.ts` en esta sesión tampoco** — la causa recién quedó confirmada, y subir `maxIntentos` y/o agregar backoff con jitter es un cambio de comportamiento real de producción (afecta latencia/reintentos de toda escritura del sistema, no solo del test) que corresponde decidir con el usuario, no aplicar unilateralmente en la misma pasada que la investigación.

---

## Parte B — Inventario y limpieza de ESLint

### Metodología

Se comparó el estado actual del repo contra el commit `82556df` ("Marcar resuelta la Ficha técnica sin modo vista y cerrar el backlog completo") — el commit inmediato anterior al inicio de TODA la auditoría (Fase 0), usando un **worktree de git aislado** (`git worktree add`, no `git checkout -- .` en el árbol de trabajo) para evitar el problema ya señalado en esta misma auditoría: `checkout -- .` no borra archivos que no existían en el commit destino, así que una comparación anterior contra este mismo commit (documentada en §12 del documento madre, "5 errores, 24 warnings — idénticos... comparando contra 82556df") **quedó contaminada** por archivos de test nuevos que seguían presentes en el árbol de trabajo — confirmado con `git cat-file -e 82556df:<archivo>`, que muestra que esos archivos **no existen en 82556df**. Esa cifra anterior (24 warnings en baseline) es, por lo tanto, **incorrecta** — se corrige acá de forma transparente.

### Inventario ANTES de esta tarea

| | Baseline real (82556df, worktree aislado) | Estado previo a esta tarea (post-I3) |
|---|---|---|
| Errores | 5 | 5 |
| Warnings | 6 | 22 |
| Total | 11 | 27 |

**Los 5 errores son idénticos en ambos puntos** (mismo archivo, línea, regla, mensaje) — ninguno fue introducido por N3/C2/R2/I3:

| Archivo | Línea | Regla | Tipo |
|---|---|---|---|
| `scripts/seed-demo-pizzeria.ts` | 407:11 | `prefer-const` | error preexistente |
| `src/app/(app)/movimientos/precio-local/precio-local-form.tsx` | 23:7 | `react-hooks/set-state-in-effect` | error preexistente |
| `src/components/campo-numero.tsx` | 72:18 | `react-hooks/set-state-in-effect` | error preexistente |
| `src/components/selector-producto.tsx` | 49:37 | `react-hooks/set-state-in-effect` | error preexistente |
| `src/components/sidebar-nav.tsx` | 22:17 | `react-hooks/set-state-in-effect` | error preexistente |

**Los 16 warnings nuevos** (22 actuales − 6 de baseline) se rastrearon con `git blame` hasta su commit de introducción — todos son de la **fase de investigación/evidencia de la auditoría** (commits "Fase 4", "Cerrar Pivotes 1/3/5/6", anteriores incluso a la implementación de N3), no de I3 específicamente:

| Archivo | Línea | Regla | Tipo | Commit que lo introdujo |
|---|---|---|---|---|
| `test/auditoria/concurrencia-casos-2-3.test.ts` | 56,88,106,123 (×4) | `no-console` disable sin uso | warning | "Cerrar Pivotes 1, 3, 5 y 6 con evidencia técnica completa" |
| `test/auditoria/concurrencia-idempotencia.test.ts` | 60,89,121 (×3) | `no-console` disable sin uso | warning | "Fase 4 (parcial): pruebas de concurrencia/idempotencia..." |
| `test/auditoria/precision-produccion-sin-redondeo.test.ts` | 50,76 (×2) | `no-console` disable sin uso | warning | "Cerrar Pivote 4 (Precisión numérica) — CERRADO CON CAMBIO N3" |
| `test/auditoria/precision-roundtrip-y-reparto.test.ts` | 25 | `@typescript-eslint/no-unused-vars` | warning | "Cerrar Pivote 4 (Precisión numérica) — CERRADO CON CAMBIO N3" |
| `test/auditoria/precision-roundtrip-y-reparto.test.ts` | 64,105,128 (×3) | `no-console` disable sin uso | warning | ídem |
| `test/auditoria/traspasos-en-transito.test.ts` | 152,159 (×2) | `no-console` disable sin uso | warning | "Fase 4/5: pruebas de traspasos en tránsito y precisión numérica" |
| `test/auditoria/traspasos-en-transito.test.ts` | 217 | `@typescript-eslint/no-unused-vars` | warning | "Cerrar Pivotes 1, 3, 5 y 6 con evidencia técnica completa" |

(La tabla usa los números de línea de antes de esta limpieza — ya no existen, ver diff.)

**Los 6 warnings de baseline (preexistentes desde antes de toda la auditoría)**:

| Archivo | Línea | Regla |
|---|---|---|
| `scripts/seed-demo-pizzeria.ts` | 407:11 | `@typescript-eslint/no-unused-vars` |
| `src/app/(app)/movimientos/conteo-fisico/conteo-fisico-grid.tsx` | 79:22 | `@typescript-eslint/no-unused-vars` |
| `src/components/campo-numero.tsx` | 73:5 | disable sin uso |
| `src/components/selector-producto.tsx` | 47:3 | disable sin uso |
| `src/components/selector-producto.tsx` | 107:9 | `jsx-a11y/role-has-required-aria-props` |
| `test/reportes/resumen-consolidado.test.ts` | 7:10 | `@typescript-eslint/no-unused-vars` |

### Clasificación

| Hallazgo | Clasificación |
|---|---|
| 5 errores `react-hooks/set-state-in-effect` (4) + `prefer-const` (1) | Errores reales de código, no de configuración — la regla está bien puesta, el patrón que señala era real |
| 16 warnings nuevos (`no-console` disable sin uso, `no-unused-vars`) | Deuda técnica — residuos mecánicos de refactors de tests durante la auditoría (un `console.log` que dejó de necesitar su disable, una variable que dejó de usarse) |
| 6 warnings de baseline | Mixto: 2 destructuring-para-omitir-clave (patrón legítimo, no configuración mal puesta), 2 disable-sin-uso (deuda mecánica), 1 unused-var real, 1 a11y real |
| Ningún warning requirió una decisión arquitectónica | — |

### Corrección aplicada

**Los 5 errores** — los 4 `react-hooks/set-state-in-effect` se resolvieron con el patrón que React mismo documenta para "ajustar estado cuando cambia un valor externo" (comparar contra un "valor anterior" guardado en estado y llamar a `setState` **durante el render**, no dentro de un efecto) — preserva el comportamiento exacto sin el round-trip extra de un efecto:

| Archivo | Qué cambió |
|---|---|
| `precio-local-form.tsx` | El único uso sincrónico problemático (limpiar `precioGlobal` cuando no hay producto elegido) se removió del efecto — el efecto ahora solo hace el fetch async (su único uso legítimo); el guard se movió al punto de lectura (`productoId && precioGlobal !== null`) |
| `campo-numero.tsx` | Se removió el `useEffect` que reformateaba `texto` cuando `valorReal` cambiaba desde afuera sin foco — reemplazado por el patrón de ajuste-durante-render, comparando contra `valorRealSincronizado` |
| `selector-producto.tsx` | Mismo patrón para `limpiarSenal` (reemplaza el `useEffect` + su disable de `exhaustive-deps`, que también estaba en la lista de warnings de baseline — se resuelve el error y el warning adyacente juntos) |
| `sidebar-nav.tsx` | Mismo patrón para `pathname` (comparando contra `pathnamePrevio`) |
| `scripts/seed-demo-pizzeria.ts` | `contadorEntregaVerduleria` era una variable genuinamente muerta (nunca incrementada ni leída, a diferencia de sus dos hermanas `contadorEntregaHarinas`/`contadorEntregaLacteos`, que sí se usan) — se eliminó la declaración |

**Los 16 warnings nuevos** — se removieron mecánicamente los 14 comentarios `// eslint-disable-next-line no-console` que ya no hacían falta (el `--fix` de ESLint los detecta automáticamente; se limpiaron a mano las líneas en blanco que dejó el autofix) y las 2 variables sin uso (`insumoId` en `precision-roundtrip-y-reparto.test.ts`, `admin` en `traspasos-en-transito.test.ts` — este último se resolvió quitando el binding pero **conservando el `await` del `findFirstOrThrow`**, porque la llamada cumple una función de precondición: lanza si la membresía no existe, más allá de su valor de retorno, que nunca se usaba).

**Los 6 warnings de baseline**:
- `conteo-fisico-grid.tsx:79` (`_omitida`, patrón de destructuring para omitir una clave) → se agregó un `eslint-disable-next-line` **puntual y justificado en un comentario** (no una excepción amplia ni una regla desactivada globalmente) — es la forma correcta de expresar "esta variable es intencionalmente descartada" sin cambiar la config global de `no-unused-vars` para todo el repo.
- `selector-producto.tsx:47` (disable de `exhaustive-deps` sin uso) → se resolvió como parte del fix del error de esa misma línea (arriba).
- `selector-producto.tsx:107` (a11y, combobox sin `aria-controls`) → se agregó `useId()` + `aria-controls`/`id` enlazando el input con el listbox — arreglo real, no cosmético (mejora el soporte de lectores de pantalla).
- `seed-demo-pizzeria.ts:407` (unused-var) → resuelto junto con el error de la misma línea.
- `resumen-consolidado.test.ts:7` (`registrarMovimiento` importado sin uso) → import eliminado.

### Inventario DESPUÉS

```text
$ npx eslint .
(sin salida)
$ echo $?
0
```

**0 errores, 0 warnings** en todo el repositorio.

### Archivos modificados

```text
scripts/seed-demo-pizzeria.ts
src/app/(app)/movimientos/conteo-fisico/conteo-fisico-grid.tsx
src/app/(app)/movimientos/precio-local/precio-local-form.tsx
src/components/campo-numero.tsx
src/components/selector-producto.tsx
src/components/sidebar-nav.tsx
test/auditoria/concurrencia-casos-2-3.test.ts
test/auditoria/concurrencia-idempotencia.test.ts
test/auditoria/precision-produccion-sin-redondeo.test.ts
test/auditoria/precision-roundtrip-y-reparto.test.ts
test/auditoria/traspasos-en-transito.test.ts
test/reportes/resumen-consolidado.test.ts
```

Ningún archivo de I3 (schema, migraciones, `src/core/movimientos/idempotencia.ts`, las 4 Server Actions de I3, los 4 formularios de frontend de I3) fue tocado — confirmado por `git status --short` antes de este commit.

### Pruebas ejecutadas

| Chequeo | Resultado |
|---|---|
| `eslint .` | 0 errores, 0 warnings (antes: 5 errores, 22 warnings) |
| `tsc --noEmit` | Mismos 3 archivos con errores preexistentes de siempre (`scripts/auditoria-benchmark-reportes.ts`, `precision-costos-precios-reversiones.test.ts`, `traspasos-en-transito.test.ts` — este último por el patrón `envio.id!` ya documentado, no tocado por esta limpieza) — ninguno nuevo |
| `next build` | Turbopack compila correctamente (`✓ Compiled successfully`) |
| Suite completa (`vitest run`) | **57/57 archivos, 351/351 tests** — corrida como parte de la reproducción del flake (5 veces) y una vez más después de los fixes de ESLint, todas verdes |
| Smoke test de rutas que usan los componentes tocados (`precio-local`, `/` [sidebar], `reclasificar`) | 307 hacia `/login` sin error de servidor — no hubo click-through interactivo autenticado (mismo límite ya documentado para I3: sin credenciales de OAuth en este entorno) |

### Errores preexistentes restantes

**Ninguno de ESLint.** De `tsc --noEmit`, siguen los 3 archivos ya documentados repetidamente a lo largo de esta auditoría (`scripts/auditoria-benchmark-reportes.ts`, `test/auditoria/precision-costos-precios-reversiones.test.ts`, `test/auditoria/traspasos-en-transito.test.ts`) — deliberadamente fuera de alcance de esta tarea (son errores de TypeScript, no de ESLint, y el pedido fue específicamente sobre la deuda de ESLint + el flake de C2).

**Actualización 2026-09-17 (más tarde, mismo día) — resuelto en commit `f13f6fc`**: los 3 errores de TypeScript de arriba bloqueaban `next build` (que corre su propio typecheck sobre todo lo que entra en `tsconfig.json`, incluyendo `scripts/` y `test/`) en cada deploy de Vercel desde que se agregó `prisma migrate deploy` al build — se arreglaron ese mismo día, ya fuera de esta tarea puntual pero antes de que este documento se cerrara. Verificado de nuevo el 2026-09-18: `tsc --noEmit` sobre todo el repo da **0 errores**.

### Actualización 2026-09-18 (misma sesión) — instrumentación de observación en producción (investigación, no fix)

A pedido del usuario, y explícitamente como investigación (no como cambio de comportamiento): se agregó logging en `con-reintento.ts` para medir en producción real qué tan seguido pasa esto — la única evidencia hasta ahora es un test que fuerza concurrencia perfecta en loop (`Promise.allSettled` de dos llamadas simultáneas), no representativo de cómo chocan dos personas reales.

**Alcance del choque, aclarado antes de instrumentar** (no hace falta medir esto, sale del schema): la ventana de conflicto es siempre `productoId + seccionId` exacto, y `Seccion.sucursalId` es obligatorio (una sección pertenece a una sola sucursal) — así que el choque **nunca cruza sucursales**, y dentro de una sucursal solo afecta a quien toque el mismo producto en la misma sección al mismo instante (dos cajeros, dos pestañas del mismo usuario, doble-click, etc.).

**Qué se agregó** (sin cambiar ningún `if`/reintento/threshold existente):
- `console.log("[con-reintento][investigacion] conflicto de escritura resuelto por reintento", {...})` cuando algún intento > 0 tuvo éxito — nivel `log` a propósito, no `warn`: un solo reintento resuelto es el camino sano y esperable de SERIALIZABLE ante dos escrituras genuinamente simultáneas (confirmado con un smoke test: en el loop de 15 iteraciones del test de C2, esto dispara en la enorme mayoría de las corridas — no es indicio de problema, así que no debe generar alertas).
- `console.error("[con-reintento][investigacion] conflicto de escritura agotó los reintentos", { maxIntentos, code })` solo cuando se agotan los `maxIntentos` y la promesa se rechaza de verdad — este sí es el incidente real (equivalente al fallo que sufre un usuario), y el que hay que contar para decidir si vale la pena actuar.

Verificado después de agregarlo: `tsc --noEmit` limpio, `eslint .` 0/0, suite completa 57/57 archivos y 355/355 tests en verde (sin cambios de comportamiento).

**Próximo paso** (fuera de esta sesión): dejarlo unas semanas en producción y buscar `[con-reintento][investigacion] conflicto de escritura agotó los reintentos` en los logs de Vercel — si nunca aparece, la corrección de `maxIntentos`/backoff queda como optimización prematura; si aparece, recién ahí decidir el fix con datos reales de frecuencia (no solo el test sintético).

### Criterio para considerar la deuda cerrada

- **Flake de C2**: causa CONFIRMADA (2026-09-18, ver actualización arriba) — agotamiento de los 5 intentos de `conTransaccionSerializable` sin backoff, no un hueco de `esConflictoDeEscritura` ni ruido de infraestructura. La investigación en sí queda cerrada. **Se actuó sobre el hallazgo el 2026-09-21** (a pedido del usuario): backoff exponencial con jitter COMPLETO entre reintentos — espera = `aleatorio() * min(250 ms, 25 ms * 2^intento)`, techos de 25, 50, 100 y 200 ms (peor caso acumulado 375 ms, esperado ~187 ms) — en `src/core/movimientos/reintentar.ts`. **`maxIntentos` sigue en 5** a propósito: se cambia una sola variable por vez para poder leer la evidencia. `esConflictoDeEscritura` no se tocó (la hipótesis de un error no reconocido ya estaba descartada). Los logs `[con-reintento][investigacion]` ahora incluyen `esperaTotalMs`. Cobertura: 19 tests sin Postgres en `test/core/con-reintento.test.ts` (valores exactos con `dormir` y `aleatorio` inyectados), con demostración rojo→verde de seis mutaciones. Verificación contra Postgres real: en 25 corridas del test de regresión de C2 (375 pares de operaciones simultáneas) hubo 325 conflictos resueltos por reintento, 0 agotamientos y 0 corridas en rojo — **esto solo detecta una regresión burda**: la tasa histórica del flake era de ~0,3 % (2 reproducciones en 950 corridas). **Criterio de cierre real, todavía abierto:** que `[con-reintento][investigacion] conflicto de escritura agotó los reintentos` no vuelva a aparecer en los logs de producción. Si aparece, recién ahí decidir subir `maxIntentos` (aparte). Nota de medición: con la intercepción de consola de Vitest activa esos logs no se ven en la salida; para contarlos, correr con `--disableConsoleIntercept`.
- **ESLint**: cerrado para esta tarea — 0 errores, 0 warnings, sin reglas desactivadas globalmente ni excepciones amplias (el único `eslint-disable` agregado es puntual, de una línea, con justificación en el comentario). Se reabre si una futura corrida vuelve a mostrar hallazgos nuevos — en ese caso, el mismo método de comparación contra el commit base (con un worktree aislado, no `checkout -- .`) es el que hay que repetir.
