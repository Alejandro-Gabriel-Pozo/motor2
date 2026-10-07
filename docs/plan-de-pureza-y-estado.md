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
| **1** Dinero, reloj, entorno, azar, errores | `decimal.js` propio; la hora y el azar entran por parámetro; el correo no lee el entorno; los errores de la base se reconocen por forma | **Hecha** (PR #67 y #70, en `main`) |
| **2** Fachadas y fronteras | `public.ts`/`public-servidor.ts` para `pos`, `stock`, `compras`; `catalogo/public.ts` sin consultas; las `public.ts` no hacen entrada/salida ni arrastran Prisma; la UI importa los dominios solo por su fachada (145 aristas, 85 archivos) | **Hecha** (PR #72, en `main`) |
| **3** Lecturas fuera del núcleo | un dominio por paso; el cálculo queda puro, la consulta pasa a `server/consultas`, `server/lecturas` (ADR-026) o `server/acceso` | **Hecha** (2026-10-06): tramo A (stock, pos, carta, catálogo parcial, auth, carta pública; PR #73 a #75), tramo B (el guard: decisión pura + cáscara en `server/acceso`; #76) y tramo C (reportes: 39 lecturas a `server/consultas/reportes`; #77). **Ninguna entrada «Fase 3» queda en la lista de heredados.** Pendiente de rendimiento (no de pureza): los N+1 de `rendimiento-recetas` y las lecturas repetidas del período |
| **4** Escrituras solo desde casos de uso | las escrituras y las lecturas dentro de transacción salen de `core` a casos de uso y persistencia; la venta (Kardex) sale del núcleo; regla `escrituras-solo-en-persistencia` | **En curso (2026-10-07):** PR #80 a #91 fusionados, #92 y #93 abiertos; faltan B0b, B3, B4 (con la migración de auth y permisos y el ADR-027), 4C-D/E/F, ampliar la matriz de la venta y su segundo tiempo, 4A-5, decidir el destino de `con-reintento` y B5. Qué está hecho, qué falló y el orden que sigue: `docs/plan-fase-4-pureza.md`, sección 10 (decisiones D-1 a D-11) |
| **5** Base `[MIG]` | tabla `SaldoStock`, índice `MovimientoStock(seccionId, productoId)`, candado del Kardex (REVOKE + trigger) | Pendiente. **Cada paso requiere autorización expresa del dueño**, simulación primero, base por base (zuluhub y stockhneuquen), con `down.sql` |
| **6** Sesión y tipos | `core/auth/{contexto,session,ir-al-login}` pasan a `server/sesion`; tipos de dominio propios en lugar de los de Prisma | Pendiente. 28 entradas heredadas «Fase 6» (2026-10-07) |
| Después | **Etapa A** del plan de gastos, compras y ventas (ADR único, funciones puras de IVA con su consumidor, etc.) | Espera a que terminen las fases anteriores |

Decisiones ya tomadas por el dueño (no reabrir): dinero con `decimal.js` detrás de `core/moneda`; reloj inyectado; candado del Kardex y tabla de saldos (ambos `[MIG]`, con autorización cuando llegue el momento); documentos nuevos solo por versiones; capas horizontales por dominio con la UI por módulo de producto y `fiscal` como dominio de negocio; exigir módulo y permiso en todas las lecturas que se pueda.

## 4. Estado exacto del repositorio (2026-10-07)

- `main` tiene las Fases 0, 1, 2 y 3 y buena parte de la Fase 4 (PR #80 a #91, más el vínculo proveedor↔producto 1/2 y H7). Los PR #68 y #69 quedaron cerrados, superados por #70. **Ninguna de las cuatro primeras fases está «hecha sin reservas»:** una auditoría independiente del 2026-10-07 encontró agujeros en los guardianes y redes de pruebas sin escribir (`docs/plan-fase-4-pureza.md`, sección 11).
- El CI de GitHub Actions **funciona** otra vez: cada PR corre el «Gate (requerido)» (estático, integración, e2e) y se fusiona con `squash` cuando está verde. En local se corren solo las verificaciones breves (`tsc`, `lint`, `arquitectura`, `knip`, los tests de la zona y, si es barato, el build y el e2e de lo tocado).
- Las pruebas con base de datos comparten una sola base local y la limpian al empezar: **se corren de a una**.
- Qué está hecho, qué falló y qué falta en la Fase 4: `docs/plan-fase-4-pureza.md`, sección 10. Qué corregir de las Fases 0 a 3: la sección 11.

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

El orden vigente está en `docs/plan-fase-4-pureza.md`: la sección 10.4 (Fase 4: B0b, B3, B4, 4C-D/E/F, matriz y segundo tiempo de la venta, 4A-5 con tu autorización, destino de `con-reintento`, B5) y la sección 11.3 (correcciones de las Fases 0 a 3, en tandas: documentos, guardianes, redes de pruebas y, con tu decisión, H8 y la frontera UI → `server/lecturas`). Después vienen la Fase 5 [MIG] (cada paso con tu autorización expresa), la Fase 6 y la Etapa A en una rama de integración.
