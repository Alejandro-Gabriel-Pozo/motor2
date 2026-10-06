# Plan de pureza de motor2: definición, estado y cómo retomarlo

Documento de traspaso (2026-10-06). Sirve para continuar el trabajo en otra sesión, sin depender de la memoria de la anterior. De lo general a lo específico.

## 1. Qué es esto y por qué

**Criterio del dueño:** pureza total del repositorio, y **antes** de construir lo nuevo (IVA, tributos, cierre de períodos, bienes de uso, emisor fiscal): ir «de a poco» deja pendientes que después hay que acomodar. La producción está viva pero sin datos; las fases completas son necesarias para lanzar.

**Qué significa «puro»** (niveles del analizador, `scripts/arquitectura/analizar-fuente.ts`):

| Nivel | Qué es |
|---|---|
| P0 | puro: sin Prisma, base, reloj, azar, entorno, red, disco ni framework |
| P1 | puro salvo TIPOS de Prisma |
| P2 | valores de Prisma, reloj, azar o entorno |
| P3 | consulta o escribe la base, red o disco, o importa el cliente |
| P4 | depende del servidor o del framework (`server-only`, `react`, `next/*`) |

La meta es que **todo `src/core/` sea P0**. Lo que hoy no lo es está escrito archivo por archivo, con la fase que lo limpia, en `test/arquitectura/pureza-heredada-del-nucleo.ts`, y un test lo vigila (ver §5).

## 2. Dónde está definido cada cosa

| Qué | Dónde |
|---|---|
| El plan por fases (0 a 6), con riesgos y criterios | `C:\Users\Usuario\Desktop\para motor 2\_planes\auditoria-pureza-fronteras-y-escalado-motor2.md`, §12 «Plan por fases» (y §14 la conclusión) |
| El prompt con el que se hizo la auditoría | `C:\Users\Usuario\Desktop\para motor 2\01-metodologia-y-prompts\prompt-auditoria-pureza-fronteras-y-escalado-motor2.md` |
| Las decisiones del dueño (Actualizaciones 20 y 21) | `…\_planes\_decisiones-del-dueno-2026-10-06.md` |
| La línea de base de la Fase 0 | `docs/linea-de-base-pureza-2026-10-06.md` (en el repo) |
| Cómo se mide la pureza | `npm run inventario:arquitectura` (resumen) y `… -- --detalle` (una fila por archivo) |
| **Este documento** | `docs/plan-de-pureza-y-estado.md` (en el repo) y una copia en `…\_planes\` |

El plan de gastos, compras y ventas (IVA, tributos, notas de crédito, cierre de períodos, bienes de uso, emisor fiscal) que viene **después** está en `…\_planes\plan-unificado-gastos-compras-y-ventas.md` (§6.sexies es la propuesta v1.1) y sus estudios `grounding-*.md`.

## 3. Las fases y su estado

Todas son **sin migración de base**, salvo la 5. Cada paso se verifica con los 8 comandos del gate y cada regla nueva se demuestra con una mutación (romper a propósito → rojo → revertir → verde).

| Fase | Qué hace | Estado |
|---|---|---|
| **0** Guardianes | línea de base e inventario; el Kardex solo agrega; consultas solo de lectura y UI sin base; producción sin escapes de rol; lo nuevo nace P0; ficha de caso de uso verificada; auditoría de dinero por función; páginas sin contexto al login | **Hecha y fusionada** en `main` (PR #59 a #66) |
| **1** Dinero, reloj, entorno, azar, errores | `decimal.js` propio; la hora y el azar entran por parámetro; el correo no lee el entorno; los errores de la base se reconocen por forma | **Hecha, solo en local** (ver §4). El paso 1.1 (dinero) sí está en `main` (PR #67) |
| **2** Fachadas y fronteras | `public.ts`/`public-servidor.ts` para `pos`, `stock`, `compras`; la UI no importa internos de otros dominios; `catalogo/public.ts` deja de reexportar lecturas | **Pendiente. Siguiente.** Al terminarla hay un **punto de control con el dueño**: con el costo real medido, decidir cómo seguir con las Fases 3 y 4 |
| **3** Lecturas fuera del núcleo | un dominio por paso: stock → pos → carta → catálogo → permisos → reportes; el cálculo queda puro, la consulta pasa a `server/consultas` o a un puerto | Pendiente. La más grande: 64 archivos heredados |
| **4** Escrituras solo desde casos de uso | POS → dinero de carta → configuración de catálogo y stock → `features/empresa` y `gerencia`; incluye el arreglo de recetas que se pisan (H7) | Pendiente. 15 archivos heredados |
| **5** Base `[MIG]` | tabla `SaldoStock`, índice `MovimientoStock(seccionId, productoId)`, candado del Kardex (REVOKE + trigger) | Pendiente. **Cada paso requiere autorización expresa del dueño**, simulación primero, base por base (zuluhub y stockhneuquen), con `down.sql` |
| **6** Sesión y tipos | `core/auth/{contexto,session,ir-al-login}` pasan a `server/sesion`; tipos de dominio propios en lugar de los de Prisma | Pendiente. 24 archivos heredados |
| Después | **Etapa A** del plan de gastos, compras y ventas (ADR único, funciones puras de IVA con su consumidor, etc.) | Espera a que terminen las fases anteriores |

Decisiones ya tomadas por el dueño (no reabrir): dinero con `decimal.js` detrás de `core/moneda`; reloj inyectado; candado del Kardex y tabla de saldos (ambos `[MIG]`, con autorización cuando llegue el momento); documentos nuevos solo por versiones; capas horizontales por dominio con la UI por módulo de producto y `fiscal` como dominio de negocio; exigir módulo y permiso en todas las lecturas que se pueda.

## 4. Estado exacto del repositorio (2026-10-06)

- `main` en GitHub tiene la Fase 0 completa y el paso 1.1.
- **La Fase 1 está en una rama LOCAL, sin subir: `pureza-fase-1`** (= `main` + pasos 1.2, 1.3, 1.4, 1.5 y 1.6 integrados, con sus conflictos resueltos). Verificada en local con los 8 comandos: tsc/lint/arquitectura/knip limpios, 509 archivos y 5.962 tests, builds de la app y de la consola, e2e 491 pasan.
- Existen además ramas sueltas en GitHub (`pureza-1-3-…`, `pureza-1-5-…`, `pureza-1-6-…`) y dos PR abiertos (#68 = paso 1.2, #69 = paso 1.4). Quedan **superados** por `pureza-fase-1`; se cierran cuando esta se integre.
- **Regla del dueño mientras no haya CI: todo en local, no subir nada.**

### Por qué no hay CI hoy
El CI de GitHub Actions dejó de arrancar: *«recent account payments have failed or your spending limit needs to be increased»*. El plan incluye 3.000 minutos de Actions por mes y una corrida completa gasta unos **50** (estático 3 + integración 25 + e2e 22), más otra al fusionar a `main`. Se agotaron. Opciones: aumentar el límite de gasto, esperar al ciclo de facturación, o correr el equivalente en local (§6). Con el CI de vuelta: **una sola corrida con `pureza-fase-1`**, no un PR por paso.

## 5. Cómo se trabaja (las reglas que se fueron fijando)

1. **Solo lectura primero, y un paso por vez.** Cada paso es una unidad chica con su criterio de aceptación.
2. **El gate son 8 comandos en la misma corrida, todos limpios:** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura` (leer el resumen «no dependency violations found»; el código de salida es de 8 bits), `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`. La línea de base está en `docs/linea-de-base-pureza-2026-10-06.md`.
3. **Cada regla nueva se demuestra por mutación** (se rompe a propósito en código real, se ve rojo con archivo y línea, se revierte, se ve verde).
4. **La lista de heredados solo se achica** (`test/arquitectura/pureza-del-nucleo.test.ts`): todo archivo nuevo de `src/core/` debe ser P0; un heredado no puede empeorar; si mejora, el test obliga a fijar la mejora en `pureza-heredada-del-nucleo.ts`.
5. **Fusionar solo con el «Gate (requerido)» en verde.** `git add` por nombre. Nunca imprimir credenciales.
6. **Ninguna migración ni relleno de datos sin autorización expresa**, base por base, con simulación y `down.sql`.
7. **De lo general a lo específico**, en palabras simples y con ejemplos, y con recomendación incluida.

## 6. Cómo correr el gate completo en local (con o sin Docker)

### Lo que ya funciona en tu máquina
Hay un Postgres 17 nativo (servicio `postgresql-x64-17`) con las bases `motor2_dev` y `motor2_e2e` y el rol `motor2_app`. Con eso corren, sin Docker, los 8 comandos. Los comandos de siempre: `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

### Lo único que falta para igualar el CI (los 18 e2e omitidos)
El CI corre 508 e2e; en local pasan 491 y se omiten 18, los de la **consola de plataforma**, que necesitan su propia base y su rol. Para activarlos en local, replicar lo que hace el job `e2e` de `.github/workflows/ci.yml`:

```
createdb motor2_b_e2e                                   # la segunda instalación de la consola
# migrar las dos bases E2E como dueño (DIRECT_URL = la base correspondiente):
npx prisma migrate deploy
DIRECT_URL="$MOTOR2_E2E_B_DATABASE_URL" npx prisma migrate deploy
# el rol de la consola, DESPUÉS de migrar, sobre las dos bases:
psql -d motor2_e2e   -v ON_ERROR_STOP=1 -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql
psql -d motor2_b_e2e -v ON_ERROR_STOP=1 -v clave="<clave>" -f scripts/operaciones/crear-rol-motor2-plataforma.sql
```
y definir en `.env` (nunca subirlo) `MOTOR2_E2E_PLATAFORMA_DATABASE_URL`, `MOTOR2_E2E_B_DATABASE_URL` y `MOTOR2_E2E_B_PLATAFORMA_DATABASE_URL`, con los mismos formatos que el job (ver el bloque `env` del job `e2e`). Las claves del CI son de relleno (`ci-duenio-descartable`, `ci-app-descartable`, `ci-plataforma-descartable`); en local usá las tuyas.

### Con Docker (si se prefiere un entorno idéntico al del CI)
- **Docker Desktop** para Windows (con WSL2) y, encima, **`act`** (https://github.com/nektos/act), que ejecuta el workflow de GitHub Actions en contenedores, incluido el servicio `postgres:17`. Por ejemplo: `act pull_request -j integracion` y `act pull_request -j e2e`.
- Advertencia honesta: **esto no está probado en esta máquina** (Docker no está instalado). `act` no replica al 100 % a `ubuntu-latest` (hay que elegir una imagen que traiga Node 24 y las dependencias de Playwright) y el job `e2e` instala Chromium con `playwright install --with-deps`, que en `act` suele dar guerra. Por eso la ruta recomendada es la anterior (Postgres nativo + las dos bases extra), que es más simple y más rápida.

## 7. Trampas aprendidas (para no repetirlas)

- Un job de Integración puede fallar por la **descarga de fuentes de Google** al hacer `build` (error `Can't resolve '@vercel/turbopack-next/internal/font/google/font'`): es de red, se relanza solo ese job.
- Dos PR que tocan las mismas líneas de importación generan conflictos: mezclar `origin/main` en la rama **antes** de fusionar y volver a correr los tests de arquitectura.
- Los tests con base **no pueden usar fechas absolutas futuras**; usar `enElPasado`/`enElFuturo`/`AHORA_DE_LA_CORRIDA` de `test/setup/tiempo.ts`.
- `scripts/` y las tareas manuales de la consola quedan fuera de varias reglas a propósito (benchmarks que borran filas `bench_*`).
- Vercel: ver la memoria del proyecto (`MEMORY.md`) para el estado de los tres proyectos y la regla de despliegue desde `main`.

## 8. Qué sigue, concretamente

1. Cuando haya CI (o el gate local equivalente): integrar `pureza-fase-1` en `main` con **una** corrida y cerrar #68 y #69.
2. **Fase 2** (sin migraciones): `public.ts`/`public-servidor.ts` para `pos`, `stock` y `compras` (hoy en `DOMINIOS_SIN_PUBLIC_TODAVIA` de `.dependency-cruiser.cjs`), regla que prohíbe que la UI importe archivos internos de un dominio (145 aristas hoy), y que `catalogo/public.ts` deje de reexportar `recetas-vigentes`.
3. **Punto de control con el dueño** al terminar la Fase 2.
