# Línea de base de pureza y del gate (2026-10-06, PR 0.1 del plan de pureza)

**Para qué sirve.** Antes de tocar nada de la Fase 0, esto fija DÓNDE estamos: qué da cada uno de los 8 comandos del gate sobre `main` (`3283de1`) y cuántos archivos hay en cada nivel de pureza. Cada paso posterior se compara contra esta línea: ninguna cantidad de tests o specs puede bajar, y las cifras de pureza solo pueden mejorar.

El plan completo (qué se hace, en qué orden y por qué) está en el informe de auditoría del dueño: `auditoria-pureza-fronteras-y-escalado-motor2.md` (carpeta de planes, fuera del repo). Resumen del criterio del dueño (2026-10-06): **pureza total primero, antes de construir lo nuevo**; la deuda heredada solo puede achicarse, nunca crecer.

## 1. Los 8 comandos del gate sobre `main`

| # | Comando | Resultado en la línea de base |
|---|---|---|
| 1 | `npx tsc --noEmit` | Salida vacía, código 0 |
| 2 | `npm run lint` | 0 errores, 0 warnings, código 0 |
| 3 | `npm run arquitectura` | Código 0 y «no dependency violations found (678 modules, 2703 dependencies cruised)» |
| 4 | `npm run analizar:muerto` | 0 hallazgos, código 0 |
| 5 | `npm test` | **498 archivos, 5.902 tests** (local: 5.862 pasan y 40 se omiten; en CI pasan los 5.902). 0 fallan |
| 6 | `npm run build` | Compila. 76 páginas estáticas (CI de `main`, run 37450679137) |
| 7 | `npm run plataforma:build` | Compila. 4 páginas estáticas (mismo run) |
| 8 | `npm run test:e2e` | **508 tests pasan** en ~19,6 min (CI, mismo run) |

Los comandos 1 a 5 se corrieron además en local el 2026-10-06. Los comandos 6 a 8 se toman del CI verde de `main` porque son idénticos a los locales y tardan ~25 minutos.

**Cómo leer el resultado.** `npm run arquitectura` devuelve un código de salida de 8 bits: se lee SIEMPRE el resumen «no dependency violations found», no solo el código. El criterio de aceptación de cada paso de la Fase 0 es: los 8 comandos en la MISMA corrida, todos limpios, y tests y specs ≥ esta línea de base (más los nuevos del paso).

## 2. Pureza del código (de `npm run inventario:arquitectura`)

Niveles (definidos en `scripts/arquitectura/analizar-fuente.ts`): **P0** puro · **P1** puro salvo tipos de Prisma · **P2** valores de Prisma, reloj, azar o entorno · **P3** consulta o escribe la base, red, disco, o importa el cliente · **P4** depende del servidor o del framework (`server-only`, `react`, `next/*`).

| Capa | Archivos | P0 | P1 | P2 | P3 | P4 |
|---|---|---|---|---|---|---|
| `core` | 220 | 114 | 14 | 15 | 73 | 4 |
| `core/features` (contratos de entrada, guard/schema) | 36 | 25 | 5 | 0 | 6 | 0 |
| **`core` + `core/features`** | **256** | **139** | **19** | **15** | **79** | **4** |
| `server/actions` | 59 | 14 | 1 | 0 | 38 | 6 |
| `server/casos-de-uso` | 25 | 0 | 0 | 0 | 0 | 25 |
| `server/consultas` | 8 | 0 | 0 | 0 | 0 | 8 |
| `server/persistencia` | 27 | 0 | 0 | 0 | 2 | 25 |
| `app` | 181 | 94 | 1 | 1 | 3 | 82 |
| `components` | 46 | 12 | 0 | 0 | 0 | 34 |
| `lib` | 7 | 3 | 1 | 1 | 0 | 2 |
| `plataforma/app` | 18 | 2 | 0 | 0 | 0 | 16 |
| `plataforma/servidor` | 13 | 3 | 0 | 1 | 5 | 4 |
| otros (`env.ts`, `proxy.ts`, `instrumentation*`…) | 10 | 2 | 0 | 4 | 0 | 4 |
| **Total** | **650** | | | | | |

Solo el nivel del **`core`** es la medida de pureza del dominio: fuera de él, P4 y P3 son lo esperado (las acciones y la persistencia viven en el servidor). La meta del plan es llevar el `core` a P0 en su totalidad, salvo una lista cerrada y con motivo de infraestructura (primitivas de criptografía, por ejemplo).

**Señales de impureza en `core` + `core/features`** (cantidad de archivos): Prisma como valor 6 · Prisma como tipo 72 · importa el cliente de base 3 · lee la base 78 · escribe en la base 15 · reloj 19 · azar 7 · entorno 5 · red 2 · `server-only` 2 · React o Next 4.

**Contraste con la auditoría.** El inventario reproduce las cifras del informe de auditoría casi al dígito (P3 = 79, P2 = 15, P4 = 4, Prisma de valor = 6, reloj = 19, azar = 7, entorno = 5, red = 2). Difiere en un archivo entre P0 (139 frente a 140) y P1 (19 frente a 18); el resto de las señales coincide. Esta tabla es la que vale de acá en adelante porque la reproduce un script del repo.

**Limitaciones del análisis (a propósito):** es sintáctico (sin el verificador de tipos), no sigue imports transitivos (de eso se ocupa `npm run arquitectura`) y solo ve accesos a la base hechos con el nombre de un modelo de `prisma/schema.prisma`.

## 3. Cómo se reproduce

```
npm run inventario:arquitectura                 # resumen por capa y por nivel (JSON)
npm run inventario:arquitectura -- --detalle    # además, una fila por archivo
npx vitest run test/arquitectura/inventario-de-pureza.test.ts   # el analizador (15 casos)
```

El analizador (`scripts/arquitectura/analizar-fuente.ts`) es la base de las reglas de pureza por carpeta de los pasos siguientes (0.5 en adelante).
