# Diseño: arnés de matrices de combinaciones (pendiente con nombre) — 2026-11-03

Estado del documento: **E0 implementada (2026-11-03)**; E1 a E3 siguen **en papel**. No hay migración ni librería nueva. Rama `alegp/diseno-arnes-de-matrices` (desde `origin/main` `bc9d1282`). Todo lo contado de `test/` se verificó leyendo los archivos el 2026-11-03; no se corrió ningún test.

## Resumen para el dueño

- **Pregunta del dueño (2026-11-03):** «¿no se puede automatizar con arneses, y que al ser operatorias parecidas se validen varias cosas a la vez o se reutilice código, para ahorrar escritura?». Respuesta: **sí, y ya se hace en parte** (inventario en §1). Lo que falta es el molde común de las *matrices de combinaciones* que pide la regla del 2026-10-28.
- **Recomendación (opción más barata primero):** no construir un «framework». Tres etapas con nombre, cada una frenable:
  - **E0 (casi gratis):** una convención de 4 reglas, más dos arreglos baratos a las matrices que ya existen (que las listas de estados y operaciones salgan del enum y no se escriban a mano).
  - **E1 (un ayudante chico, ~60 líneas):** recién cuando se escriba la **cuarta** matriz real. Se extrae de las que ya funcionan, no se inventa antes.
  - **E2 (guardián de columnas nuevas):** la matriz 8 del mapa del 2026-10-28, apoyada en el motor de «trinquete» que ya existe.
  - **Parqueado:** mutación automática por PR (hoy manual; ver §10).
- **Ahorro honesto:** las matrices actuales tienen 77 a 122 líneas; el ayudante ahorraría del orden de 15 a 25 por matriz. Vale la pena por las 8 que faltan, no por las 3 que ya están. Por eso E1 espera.
- **Una sola pregunta** (§11): ¿arrancamos por E0 y dejamos E1 para cuando haya una cuarta matriz? **Respondida: sí, E0 (CONFIRMADA por el dueño el 2026-11-03: «Sí, arrancá por E0»).** E1, E2 y E3 no se hacen todavía.

## 1. Propósito y alcance, y lo que ya existe (nivel 1 + inventario)

**Necesidad (poda):** la regla del dueño del 2026-10-28 (`AGENTS.md`, «Combinaciones») exige, para cada módulo, dimensiones declaradas, una tabla de reglas escrita aparte del código y un test que recorra todas las combinaciones. `docs/mapa-cobertura-de-combinaciones-2026-10-28.md` lista 8 matrices que faltan. La pregunta del 2026-11-03 pide que escribirlas no cueste de más. **CONFIRMADA** (la regla y el pedido de diseñarlo, dichos por el dueño).

**Inventario verificado (código real de `main`):**

| Pieza | Cantidad / lugar | Para qué sirve hoy |
|---|---|---|
| Archivos de test (Vitest) | 1175 en `test/`, más 163 specs de Playwright | todo |
| Tablas de casos (`.each`) | 154 archivos | mismas aserciones, distintos datos |
| Propiedades con `fast-check` | 58 archivos (20 con «propiedades» en el nombre) | dinero, idempotencia, reparto, precio con opciones, Kardex |
| Oráculos escritos aparte | ~28 archivos lo nombran | comparar el código con una tabla o cálculo independiente |
| Matrices exhaustivas | 3 modelos sólidos: `test/core/features/traspasos/traspaso-guard.test.ts` (6 operaciones × 7 estados × 3 lados), `test/permisos/matriz-esperada.ts` (`Record<AccionClave, FilaEsperada>`), `test/movimientos/seccion-desactivada.test.ts` (`Record<ProcesoGenerico, …>`) | la regla de combinaciones, ya cumplida en esos tres |
| Guardianes de «cosa nueva sin declarar» | 193 archivos en `test/arquitectura/`; motor común `test/arquitectura/cercos/trinquete.ts` (416 líneas) + `probar-cerco.ts` (24) | tablas, claves, acciones, columnas `Decimal`, colores, tipografía… |
| Goldens / caracterizaciones | 18 archivos + `caracterizaciones-congeladas` | fotos de comportamiento |
| Siembra y fábricas | 30 ayudantes en `test/setup/`, 16 en `test/e2e/fixtures/` | datos de prueba |
| Mutación automática | Stryker 10: `stryker.config.mjs` (server, Postgres real) y `stryker.piloto.config.mjs` (`src/core/moneda.ts`, 74,6 % → 90 %, techo 90,8 %) | auditoría manual, fuera del gate |

**Hallazgos de esa lectura (afectan al diseño):**
1. **Dos patrones de guardián gratis ya conviven.** (a) `Record<Enum, …>` (permisos y secciones): si el enum gana un valor, el archivo deja de compilar, y no hace falta ningún test extra. (b) Listas escritas a mano (`ESTADOS`, `OPERACIONES` en `traspaso-guard.test.ts:13-14`; `ESTADOS` en `test/reportes/ventas-por-opcion.test.ts:47`): si el enum gana un valor, nadie se entera. Esto último es el «arreglo barato» que ya anotaba el mapa. Prisma genera el enum en runtime (`Object.values(Proceso)` ya se usa en `test/reportes/historial-vistas.test.ts:16`).
2. **No existe** guardián para columnas nuevas (booleana, fecha, con CHECK) en modelos de dinero, visibilidad o stock (matriz 8 del mapa).
3. **No existe** un molde compartido: las tres matrices repiten el mismo esqueleto (dimensiones → producto cartesiano con `flatMap` → tabla esperada → `it.each` → 1 o 2 invariantes globales).
4. **NO VERIFICADO:** la sesión de compras está escribiendo un oráculo de 32 filas (número × letra × permiso × operación) con un guardián de dimensiones probado por mutación. Es el cuarto caso real; vive en su rama y no lo leí. **Antes de E1 hay que leerlo** y decidir si el molde sale de ahí también.

**Fuera de alcance:** reescribir las matrices existentes (funcionan; se tocan solo en E0, y solo las listas); un framework de tests; librerías nuevas; correr mutación en el gate.

## 2. Actores (nivel 2)

El dueño (define qué es «una combinación que cambia dinero, permisos, visibilidad o stock» y valida las tablas de reglas, porque las entiende como negocio) y el ingeniero (escribe el molde y los tests). Los agentes que implementan cada módulo usan el molde. No hay usuario final ni pantalla: es infraestructura de pruebas.

## 3. Casos de uso (nivel 3)

| # | Caso | Quién | Resultado |
|---|---|---|---|
| CU1 | Escribir la matriz de un módulo nuevo (p. ej. cobro de línea) | agente de ese módulo | declara dimensiones y tabla esperada; el molde recorre y reporta |
| CU2 | Alguien agrega un estado, proceso o clave al enum | cualquiera | la matriz falla (o no compila) hasta declarar qué hace la nueva fila |
| CU3 | Alguien agrega una columna que afecta dinero/visibilidad/stock | cualquiera | un guardián falla hasta que se declare «afecta: sí/no» con motivo (E2) |
| CU4 | Falla una combinación | quien corre los tests | el mensaje dice la combinación exacta, lo esperado y lo obtenido, sin abrir el código |
| CU5 | Revisar que el test detecta lo que dice | revisor | mutación temporal → rojo → revertir → verde (regla de la skill del repo) |

## 4. Conceptos y ciclo de vida (nivel 4)

- **Dimensión:** un eje con valores finitos (estado, operación, lado, permiso). Se declara con su origen: *derivada de un enum o catálogo del código* (preferida) o *escrita a mano con motivo*.
- **Oráculo:** la tabla de reglas esperadas, en un archivo propio, escrito a mano, **sin importar lógica de `src/`** (solo tipos y enums). Es lo que el dueño puede leer.
- **Recorrido:** producto cartesiano de las dimensiones; cada fila se compara con el oráculo.
- **Declaración de «afecta»:** para columnas y claves, una lista con `afecta: sí/no` y motivo.
- Ciclo: se declara → se recorre en cada corrida → cambia solo editando el oráculo a propósito, en el mismo PR que el cambio de regla (el diff muestra los dos lados).

## 5. Invariantes y políticas (nivel 5)

| # | Regla | Estado |
|---|---|---|
| I1 | El oráculo se escribe aparte y a mano; **nunca** se genera ejecutando el código que se prueba (sería un test que se prueba a sí mismo). | VIGENTE (E0, confirmada 2026-11-03) |
| I2 | Las dimensiones que salen de un enum se **derivan** del enum; si no se puede, se declara el motivo. | VIGENTE (E0, confirmada 2026-11-03) |
| I3 | El test afirma el **tamaño** del producto (p. ej. 6×7×3 = 126) para que quitar una dimensión por descuido falle. | VIGENTE (E0, confirmada 2026-11-03; ya lo hace `traspaso-guard.test.ts`) |
| I4 | Hasta ~500 combinaciones: exhaustivo. Más: `fast-check` contra el oráculo, o pares. | PROPUESTA (la regla del dueño ya lo dice) |
| I5 | Un fallo imprime la combinación completa y lo esperado vs. obtenido. | VIGENTE (E0, confirmada 2026-11-03) |
| I6 | El molde recorre y reporta; **no oculta** la intención: la tabla sigue legible. | PROPUESTA |
| I7 | Sin librería nueva (Vitest `it.each`, `fast-check` y el motor de trinquete alcanzan). | PROPUESTA (regla de `AGENTS.md`) |
| I8 | La mutación **no** entra en el gate de 8 comandos. | CONFIRMADA (ya figura en `stryker.config.mjs`) |

## 6. Historia y persistencia (nivel 6)

Ninguna tabla, columna ni migración. Los únicos artefactos son archivos de test y, en E2, una línea de base JSON del trinquete (`test/arquitectura/cercos/linea-de-base/<regla>.json`, patrón existente). Se escribe y se ve en el diff.

## 7. Atomicidad y concurrencia (nivel 7)

No aplica a datos. Dos puntos operativos: (1) los tests de Postgres corren con `fileParallelism: false`, así que el molde no debe abrir transacciones propias; (2) un guardián que lee `prisma/schema.prisma` es de solo lectura y determinista.

## 8. Acceso e interfaces (nivel 8)

Interfaz del ayudante (E1), solo como boceto para decidir; no se implementa todavía:

```
recorrerMatriz({
  nombre,                       // «Cobro de línea»
  dimensiones: { a: [...], b: [...] },   // derivadas de enums cuando se puede
  esperado: (fila) => ...,      // lee la TABLA escrita aparte (datos, no lógica de src/)
  obtenido: (fila) => ...,      // llama al código bajo prueba
  tamanoEsperado: 126,          // I3
})
```

Genera un `describe` con un `it` por fila y los dos chequeos globales opcionales («cada operación tiene exactamente una combinación válida», «los estados terminales no admiten nada») como funciones que recibe el ayudante.

## 9. Consultas y experiencia (nivel 9)

La experiencia es el mensaje de fallo (CU4): «Cobro de línea — {tipo: combo, precioLocal: sí, descuentoCliente: 10 %}: esperado $X, obtenido $Y». Y la **lectura de la tabla por el dueño**: el oráculo debe poder leerse como una planilla, sin código en el medio.

## 10. Pruebas, migración y operación (nivel 10)

**Tabla «¿qué pasa si…?»**

| Si… | Qué pasa (PROPUESTA) |
|---|---|
| Se agrega un valor a un enum usado como dimensión | Con `Record<Enum, …>`: no compila. Con lista derivada del enum: el producto crece y las filas nuevas fallan hasta tener oráculo. Con lista a mano: nada pasa (**el hueco de hoy**, se arregla en E0). |
| Se agrega una columna que afecta dinero/visibilidad/stock | Hoy nada. Con E2: el guardián falla hasta declarar `afecta` con motivo. |
| Alguien copia la salida del código al oráculo | Es un test tautológico. Defensa: I1 + revisión; el oráculo no importa lógica de `src/`. |
| La matriz es enorme (miles de filas) | Pasa a `fast-check` o pares (I4); el tiempo de corrida se mide antes de aceptarla. |
| Una fila falla | Se imprime la combinación completa (I5). |
| El ayudante esconde demasiado | Se vuelve a escribir la matriz «a mano» en ese módulo; el ayudante no es obligatorio (poda). |
| Cambia una regla de negocio | Se edita el oráculo y el código en el mismo PR; el diff lo hace visible. |
| La mutación sobrevive en una fila | Se agrega una fila al oráculo, o se anota como equivalente con motivo (criterio del piloto de `moneda.ts`). |

**Combinaciones de este propio diseño:** sin dinero, permisos, visibilidad ni stock. Las dimensiones son internas de pruebas; no aplica la regla a sí misma.

**Etapas (cada una se puede frenar; ninguna toca la base):**

| Etapa | Qué hace | Costo estimado | Depende de |
|---|---|---|---|
| **E0** (CONFIRMADA por el dueño el 2026-11-03) | Convención de 4 reglas (I1–I3, I5) escrita en un documento de pruebas del repo (a ubicar) + derivar `ESTADOS`/`OPERACIONES` de `traspaso-guard.test.ts` y `ESTADOS` de `ventas-por-opcion.test.ts` del enum (cambio de 2–3 líneas por archivo) | muy bajo | nada |
| **E1** | Ayudante `recorrerMatriz` (~60 líneas) en `test/` extraído de las matrices que ya existen, **recién** al escribir la 4.ª matriz real (cobro de línea, factura repartida, IVA de compras o proceso × Kardex) | bajo | leer el oráculo de compras (§1 hallazgo 4) |
| **E2** | Guardián de columnas: parsea `prisma/schema.prisma` y falla ante booleano/fecha/máscara/CHECK nueva en modelos de dinero, visibilidad o stock sin declaración. Usa el motor `trinquete.ts`, sin motor nuevo | medio | E0 |
| **E3 (parqueado)** | Mutación incremental sobre los archivos tocados por un PR | a medir | decisión del dueño; hoy ~0,4 s/mutante en `core` puro y mucho más contra Postgres |

**Verificación de cada etapa cuando se implemente:** gate completo de 8 comandos en la misma corrida, conteo de tests antes/después (nunca menos), y para cada guardián la demostración de que detecta (agregar la dimensión falsa → rojo → revertir → verde).

## Convención vigente (E0)

Rige desde el 2026-11-03 (CONFIRMADA por el dueño). Vale para toda matriz de combinaciones nueva o que se toque; no obliga a reescribir las que ya andan.

1. **I1 — El oráculo se escribe aparte y a mano.** La tabla de lo esperado nunca se genera ejecutando el código que se prueba (sería un test que se prueba a sí mismo) y no importa lógica de `src/`: solo tipos y enums.
2. **I2 — Las dimensiones se derivan de la fuente.** Si un eje sale de un enum de Prisma (`Object.values(Enum)`) o de un `Record<Tipo, …>` exhaustivo (`Object.keys`), se deriva: así un valor nuevo no pasa desapercibido. Si no hay fuente en runtime (tipo local, columna de texto libre), la lista queda a mano **con un comentario que dice el motivo**.
3. **I3 — El test afirma el tamaño del producto** (p. ej. 6×7×3 = 126). Con la lista derivada, un valor nuevo cambia el producto y el test falla hasta que alguien lo declare en el oráculo.
4. **I5 — Un fallo imprime la combinación completa y lo esperado vs. obtenido** (nombre de cada caso con todas sus dimensiones, y comparación de la fila entera, no de un campo suelto).

**Aplicado en E0:** `test/core/features/traspasos/traspaso-guard.test.ts` (`ESTADOS` sale de `EstadoTraspaso`; `OPERACIONES` sale de las claves de `ESPERADO`) y `test/reportes/ventas-por-opcion.test.ts` (`ESTADOS` queda a mano: `Estado` es un tipo local, la anulación de una venta es un registro nuevo y no un enum).

## 11. Preguntas abiertas

1. **(Dueño, una sola)** ¿Arrancamos por **E0** (convención + 2–3 líneas por matriz existente) y dejamos el ayudante (E1) para cuando se escriba la cuarta matriz? Recomiendo que sí: ahorrar escritura en 3 matrices que ya andan no compensa; sí compensa en las 8 que faltan.
2. **NO VERIFICADO:** el oráculo y el guardián de la sesión de compras (rama `alegp/compras-etapa-1`). Se lee antes de E1.
3. **NO VERIFICADO:** si el tiempo de una corrida exhaustiva de las matrices 1 (cobro) y 5 (Kardex) entra en los ~300 s de la suite actual; se mide al escribirlas.
