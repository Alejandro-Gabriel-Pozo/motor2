# Plan de pureza de motor2: definición, estado y cómo retomarlo

Documento de traspaso (2026-10-06; puesto al día el 2026-10-08, al cerrar el trabajo de la rama `pureza-integracion`). Sirve para continuar el trabajo en otra sesión, sin depender de la memoria de la anterior. De lo general a lo específico.

> **Actualización 2026-10-09.** La rama `pureza-integracion` (PR #95) **se fusionó a `main`** (merge commit `057974b2`) con el endurecimiento de seguridad T1 a T16, y la app se desplegó. Quedan **desactualizadas** las partes que dicen que la Fase 4 espera fusión (secciones 3 y 4) y que «el CI de GitHub Actions funciona» (hoy no corre por la facturación de Actions). Lo que sigue y el orden propuesto están en `docs/hoja-de-ruta-despues-de-la-fusion.md`; cómo se hace cada cosa (gate, deploy, sincronización de documentos), en `procedimientos-operativos.md` del repositorio de documentación.

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
| La rama integradora: lista de control con la evidencia de cada trabajo, y el «Cierre de la rama» | `docs/pureza-integracion.md` (en el repo; copia en `…\_planes\`) |
| Decisiones de la pureza que no estaban escritas | `docs/pureza-decisiones-asentadas.md` (en el repo; copia en `…\_planes\`) |
| Los planes de ejecución de los hitos 3, 4 y 5 | `docs/plan-hito-3-pureza.md`, `docs/plan-hito-4-pureza.md`, `docs/plan-hito-5-pureza.md` (en el repo; copias en `…\_planes\`) |
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
| **4** Escrituras solo desde casos de uso | las escrituras y las lecturas dentro de transacción salen de `core` a casos de uso y persistencia; la venta (Kardex) sale del núcleo; regla `escrituras-solo-en-persistencia` | **HECHA en la rama `pureza-integracion` (2026-10-08), pendiente de fusión a `main`.** Los PR #80 a #91 se fusionaron a `main` (2026-10-06 y 07); el resto (#92, #93, B0b, B3, B4 con la migración de auth y permisos y el ADR-027, 4C-D/E/F, la matriz de la venta y su segundo tiempo, 4A-5, `con-reintento`, B5 y, además, las 8 acciones de configuración de carta) está en la rama. Resultado medido: 25 heredados (51 al empezar la fase, 38 en `main` al abrirse la rama; los 25 dicen «Fase 6» y ninguno «Fase 4»); `core-sin-consultas` cubre todo `core` con 4 pendientes de la Fase 6; escrituras fuera de persistencia 51 → 13 entradas (0 «Fase 4»). Falta el gate final de 8 comandos, la auditoría independiente y la autorización del dueño para fusionar. Detalle: `docs/plan-fase-4-pureza.md` (secciones 1, 6 y 10) y `docs/pureza-integracion.md` |
| **5** Base `[MIG]` | tabla `SaldoStock`, índice `MovimientoStock(seccionId, productoId)`, candado del Kardex (REVOKE + trigger) | **Lista para arrancar, todavía no autorizada.** **Cada paso requiere autorización expresa del dueño**, uno por uno: (1) `SaldoStock`, (2) el índice del Kardex, (3) el candado (REVOKE + trigger); simulación primero, base por base (zuluhub y stockhneuquen), con `down.sql`. La preparación sin migración está hecha (O.13): los escritores de líneas del Kardex son 3 (antes 5) y el `EXPLAIN` mostró que las lecturas de saldo usan hoy `MovimientoStock_productoId_seccionId_loteVencimiento_idx`, medido en una base local chica con volumen sembrado (`docs/plan-fase-4-pureza.md` §6); falta la medición con volumen real, que es parte de la simulación |
| **6** Sesión y tipos | `core/auth/{contexto,session,ir-al-login}` pasan a `server/sesion`; tipos de dominio propios en lugar de los de Prisma | **Pendiente, en su propia rama integradora después de fusionar esta.** Inventario medido el 2026-10-08, 25 entradas heredadas «Fase 6» (la lista completa está en `test/arquitectura/pureza-heredada-del-nucleo.ts`): (a) `core/auth/{base,contexto,ir-al-login,rol-de-ejecucion,session}` a `server/sesion`, una sola vez y sin tocar su código; (b) los tipos de Prisma en `core`: 19 archivos solo con tipos (de movimientos, reportes, catálogo, carta, stock y `features`) más `core/fiscal/factura-autorizada.ts` (que además recibe `Db` y lo usa la consola, que no puede importar `src/server`); (c) los resabios declarados de `server/sesion` (O.24): el `new Date()` y `ALLOWED_EMAIL_DOMAINS` de `acceso.ts`, que esperan a que el borde de Auth.js reciba la hora y el entorno ya leídos; (d) el único estado de módulo permitido en `core`, el `let datosDelRolDelProceso` de `core/auth/base.ts` (línea 102); (e) los 241 `vi.mock` de `core/auth/session` en 241 archivos de `test/` y `scripts/` (el plan de la Fase 4 decía 161; se contó de nuevo), que el codemod de imports (`npm run reapuntar:imports`) no reescribe y hay que cambiar a mano o con una herramienta nueva; (f) las 2 lecturas de `auth/usuarios.ts` que leen `new Date()` (D.3), que se arreglan al mudarlas a `server/consultas`; (g) el pendiente O.47 (filtro de empresa en la fila «por defecto» de capacidades), si el dueño lo aprueba antes |
| Después | **Etapa A** del plan de gastos, compras y ventas (ADR único, funciones puras de IVA con su consumidor, etc.) | Espera a que terminen las fases anteriores |

Las reservas con que quedaron las Fases 0 a 3 (auditoría independiente del 2026-10-07, `docs/plan-fase-4-pureza.md` §11) también se corrigieron en la rama `pureza-integracion`, hito por hito, y cada una figura en `docs/pureza-integracion.md` con su evidencia (Hitos 1 a 3, y los hallazgos O.1 a O.47; solo O.47 queda abierto y O.14 y O.38b, diferidos por escrito).

Decisiones ya tomadas por el dueño (no reabrir): dinero con `decimal.js` detrás de `core/moneda` (y `number` dentro de `core`, escrito como diseño y medido: `docs/pureza-decisiones-asentadas.md` §5); rama integradora con merge commit y no squash (2026-10-07); reloj inyectado; candado del Kardex y tabla de saldos (ambos `[MIG]`, con autorización cuando llegue el momento); documentos nuevos solo por versiones; capas horizontales por dominio con la UI por módulo de producto y `fiscal` como dominio de negocio; exigir módulo y permiso en todas las lecturas que se pueda.

## 4. Estado exacto del repositorio (2026-10-08)

- **`main`** (`15b863d2`) tiene las Fases 0, 1, 2 y 3 y buena parte de la Fase 4 (PR #80 a #91). Los PR #68 y #69 quedaron cerrados, superados por #70. En `main` esas fases tienen las reservas que encontró la auditoría independiente del 2026-10-07 (`docs/plan-fase-4-pureza.md`, sección 11).
- **La rama `pureza-integracion`** está abierta desde el 2026-10-07, parte de `main` y lleva 309 commits propios al empezar el bloque C (más los pocos de documentos de ese bloque). Con ella la Fase 4 está **hecha** y las reservas de las Fases 0 a 3 corregidas, **pero no está fusionada**: lo que está en `main` y en producción sigue siendo lo anterior. Antes de fusionar faltan (los hace otro paso): el gate de 8 comandos en una corrida, el CI de GitHub en verde, la auditoría independiente de la rama y la autorización expresa del dueño. La lista de verificación está en la sección «Cierre de la rama» de `docs/pureza-integracion.md`.
- Medido el 2026-10-08 sobre la rama con `npm run inventario:arquitectura`: `src/core/` tiene 311 archivos, 286 P0 y 25 no (todos «Fase 6»). Los tests de arquitectura son 112 archivos con 1139 tests, verdes. Ningún cambio de la rama toca `prisma/` (no hay migraciones).
- El CI de GitHub Actions **funciona**: cada PR corre el «Gate (requerido)» (estático, integración, e2e). Esta rama se fusiona con **merge commit** (no squash) para conservar la reversión paso a paso; si `origin/main` avanzó, se lo mezcla en la rama antes. En local se corren solo las verificaciones breves (`tsc`, `lint`, `arquitectura`, `knip`, los tests de la zona y, si es barato, el build y el e2e de lo tocado).
- Las pruebas con base de datos comparten una sola base local y la limpian al empezar: **se corren de a una**.
- Qué está hecho, qué falló y qué falta en la Fase 4: `docs/plan-fase-4-pureza.md`, sección 10. Qué se corrigió de las Fases 0 a 3: la sección 11 y la lista de control `docs/pureza-integracion.md`.

## 5. Cómo se trabaja (las reglas que se fueron fijando)

1. **Solo lectura primero, y un paso por vez.** Cada paso es una unidad chica con su criterio de aceptación.
2. **El gate son 8 comandos en la misma corrida, todos limpios:** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura` (leer el resumen «no dependency violations found»; el código de salida es de 8 bits), `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`. La línea de base está en `docs/linea-de-base-pureza-2026-10-06.md`.
3. **Cada regla nueva se demuestra por mutación** (se rompe a propósito en código real, se ve rojo con archivo y línea, se revierte, se ve verde).
4. **La lista de heredados solo se achica** (`test/arquitectura/pureza-del-nucleo.test.ts`): todo archivo nuevo de `src/core/` debe ser P0; un heredado no puede empeorar; si mejora, el test obliga a fijar la mejora en `pureza-heredada-del-nucleo.ts`.
5. **Fusionar solo con el «Gate (requerido)» en verde.** `git add` por nombre. Nunca imprimir credenciales. **Desde el 2026-10-07 el trabajo restante de la pureza va en una rama integradora** (`pureza-integracion`; las Fases 5 y 6 y la Etapa A, cada una en la suya), **no un PR por paso**: un commit por trabajo, atómico y revertible por sí solo; una auditoría independiente por hito (no por PR); `main` se mezcla en la rama al arrancar cada hito (no se rebasa); y la rama se fusiona a `main` con **merge commit, NO squash**, porque con squash se pierde la reversión paso a paso. La fusión despliega a producción: requiere la autorización expresa del dueño, el gate de 8 comandos en una corrida, el CI en verde y la auditoría final sin hallazgos críticos abiertos. Los commits que no pasan el gate solos están listados, con `git bisect skip`, en `docs/pureza-integracion.md` («Cierre de la rama») y en `docs/pureza-decisiones-asentadas.md` §13.
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

Con el trabajo de la rama terminado (2026-10-08), lo que sigue, en este orden:

1. **Cerrar y fusionar la rama `pureza-integracion`.** Es lo único pendiente de las Fases 0 a 4. Lo hace otro paso, con la lista de verificación de la sección «Cierre de la rama» de `docs/pureza-integracion.md`: el gate de 8 comandos en una corrida, el CI en verde, la auditoría independiente (con foco en la frontera de la carta pública, en el escritor de la auditoría y en la revalidación de `copiarCartaDeSucursal`), mezclar `origin/main` si avanzó, y **tu autorización expresa** (despliega a producción). Fusión con merge commit.
2. ~~Decidir O.47~~ **Hecho (2026-10-08, `b44d4682`)**: el dueño pidió cerrar todas las reservas de la auditoría del Hito 5 y con eso aprobó el filtro de empresa en la fila «por defecto» de capacidades (misma consulta, gate y carta). Ya no hay nada que decidir ahí; las seis reservas menores están cerradas (fila 5.6 de `docs/pureza-integracion.md`).
3. **Fase 5 [MIG]**, solo con tu autorización expresa por paso: `SaldoStock`, el índice del Kardex y el candado. Simulación primero, base por base, con `down.sql`; la medición del `EXPLAIN` con volumen real es parte de esa simulación.
4. **Fase 6**, en su propia rama integradora (inventario en la tabla de la sección 3). Quedan además, diferidos por escrito a una rama posterior (la de la Fase 6 u otra, a decidir), los dos restos de O.38b (recetas vigentes y precio local por capacidad para N sucursales, ya destrabados por 5.2) y la fila O.14 (lecturas repetidas de la venta).
5. **Etapa A** del plan de gastos, compras y ventas, en su propia rama de integración.

El orden detallado de lo que se hizo está en `docs/plan-fase-4-pureza.md` (sección 10.4, con el cierre de cada fila) y las correcciones de las Fases 0 a 3 en la sección 11 de ese mismo documento (hechas en la rama).
