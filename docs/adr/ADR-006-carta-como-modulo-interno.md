# ADR-006: La carta pública se absorbe como módulo interno de motor2 — reemplaza ADR-005

> Redactado el 2026-09-29, minutos después de ADR-005, al leer
> `ARCHITECTURE.md` de `restaurant-menu-design` (repo bajado,
> `Downloads/restaurant-menu-design-main (2)/restaurant-menu-design-main`)
> y encontrar que esa app ya tenía "Multi-tenant — un mismo deploy sirve N
> negocios, resuelto por dominio" como prioridad 1 de su propio roadmap
> (sección 2, "Alcance cerrado: solo 1–4"), sin implementar. Decisión del
> dueño, tomada en la misma conversación. **Reemplaza ADR-005 por completo**
> — no es una corrección menor, es un cambio de dirección: no hay más app
> externa que autenticar.
>
> Plan de implementación diseñado el mismo día (agente `Plan`, modelo
> Opus) — ver el Paso 0: `TokenCartaEmpresa` (construido para ADR-005)
> revertido en el commit `f0b38f4`.

## Contexto

ADR-005 resolvía "cómo evita motor2 que el portal de una empresa mezcle
sucursales de otra" asumiendo que `restaurant-menu-design` seguía siendo
una app externa separada. Esa asunción se cae por dos datos nuevos:

1. **El roadmap de esa app ya apuntaba a resolver el negocio por dominio**,
   en un solo deploy — justo el problema que ADR-005 intentaba resolver con
   N deployments + token por empresa. Construir eso ahí significa terminar
   un camino ya empezado (`getTenantByDomain` existe, solo no tiene
   llamador) en un repo que, aun así, sigue siendo una segunda base de
   código para mantener sincronizada con motor2 (contrato versionado,
   variables de entorno espejadas, ver `docs/setup-sucursal.md`).
2. **La carta pública es chica** (~2.900 líneas medidas en el repo real):
   de eso, ~940 son pura capa de fetch + validación de contrato contra
   motor2 (`lib/*-motor2.ts`, `lib/tenants.ts`) — código que DESAPARECE
   enteramente si la carta vive en el mismo proceso que los datos, porque
   deja de haber un HTTP de por medio. El resto (~2.000 líneas) es UI/
   presentación, portable con adaptación, no reescritura desde cero.

Sumado a esto, el dueño señaló dos motivos más, independientes del punto de
"por dónde entra el tráfico":

- **Evolucionar el schema de la carta hoy es caro**: cualquier columna
  nueva en `SeccionCarta`/`PromoCarta`/etc. tiene que reflejarse en un
  contrato versionado (`RegistroTenantsV1`, `CartaMotor2V1`, `TemaMotor2V1`)
  y en los mappers/guardas de los dos lados (`src/core/carta/*.ts` acá,
  `lib/*-motor2.ts` allá) antes de que la carta externa pueda usarla. Con
  la carta adentro, agregar o cambiar una columna es un cambio de schema y
  una query — nada de contrato que sincronizar entre repos.
- **"Carta" no tiene un lugar claro en la arquitectura de hoy**: las 4
  pantallas de administración (`/catalogo/carta`, `/catalogo/carta/portal`,
  `/catalogo/carta/tema`, `/catalogo/carta/agrupados`) viven anidadas bajo
  `catalogo/`, aunque el permiso que las gatea (`accion: "carta"`) ya es
  distinto del de catálogo — la ubicación en el árbol de rutas no refleja
  que carta es su propio dominio (presentación pública de lo que el
  catálogo ya define), no una sub-función de catalogar productos.

## Decisión

**La carta pública se absorbe como módulo interno de motor2**, accedida por
subdominio: `carta-<empresa>.<dominio>` (UN solo nivel). **Cambiado el
2026-09-30 por el dueño:** la decisión original era `carta.<empresa>.<dominio>`
(dos niveles, descartando el guion en un solo nivel), pero con dos niveles un
wildcard `*.<dominio>` (DNS y certificado TLS) no cubre el host: habría que dar
de alta el host de cada empresa a mano en Vercel. Con un nivel, un único
wildcard `*.<dominio>` sirve a toda empresa nueva sin tocar nada.

- Nueva resolución de empresa por `Host`, análoga a como
  `obtenerContextoUsuario()` resuelve la sesión desde cookies
  (`next/headers`) — sin necesidad de tocar `src/proxy.ts` (el middleware
  actual, que hoy no tiene ninguna lógica de dominio): un Server Component
  puede leer `headers().get("host")` directo.
- Las ~2.000 líneas de UI de `restaurant-menu-design` (`carta-view.tsx`,
  `carta-section-image.tsx`, `carta-controls/`, `hero-utils.ts`,
  `format-utils.ts`, theming) se portan y adaptan a componentes de motor2,
  con datos que llegan por Prisma directo en vez de por `fetch` + guarda de
  forma — la capa de contrato/validación (~940 líneas) se elimina, no se
  porta.
- **Carta se reorganiza como módulo propio**, separado de `catalogo/` en la
  navegación y en el árbol de `src/app/`/`src/core/` — el detalle exacto
  (nuevo prefijo de ruta, qué se mueve de `src/core/carta/` y qué queda) es
  de implementación, no de este ADR.
- Se retira `restaurant-menu-design` como repo activo cuando la migración
  esté completa: sin más `CARTA_API_TOKEN`/`MOTOR2_CARTA_TOKEN`, sin el
  boundary HTTP `/api/carta/*` como API pública versionada (esas rutas
  pueden desaparecer o quedar como implementación interna del módulo, a
  decidir en la implementación).
- Requiere wildcard DNS + certificado para `*.<dominio>` en el proyecto de
  Vercel de motor2 — infraestructura que hoy no existe ahí (si existiera en
  el proyecto de `restaurant-menu-design`, tampoco serviría: es un dominio
  distinto).

## Alternativas consideradas

- **ADR-005: un deployment de Vercel por empresa con su propio token**:
  descartada — quedó objetivamente peor frente a las otras dos opciones
  evaluadas (ver tabla de la conversación): no elimina la duplicación de
  lógica entre los dos repos, y suma un costo operativo (N deployments)
  que crece con la cantidad de empresas sin necesidad.
- **Terminar el roadmap ya escrito de `restaurant-menu-design`** (dominio
  resuelto ahí mismo, un solo deploy de esa app para todas las empresas):
  evaluada en serio — es el camino de menor fricción inmediata porque ya
  estaba decidido y medio construido. Se descarta en favor de absorber
  porque no resuelve los dos problemas de fondo que señaló el dueño
  (evolución de schema cara vía contrato versionado; el lugar de "carta"
  en la arquitectura) — solo resuelve el ruteo por empresa, dejando la
  duplicación de código y el desacople de schema intactos.

## Consecuencias

**Más fácil:**
- Cambiar el schema de la carta (agregar una columna, una tabla) deja de
  requerir tocar dos repos y un contrato versionado — es lo mismo que
  cualquier otro cambio de schema de motor2.
- Una sola base de código, un solo deploy, un solo lugar donde buscar un
  bug de la carta pública.
- "Carta" pasa a tener un lugar propio y claro en la arquitectura, en vez
  de vivir anidada bajo `catalogo/` sin reflejar que ya es su propio
  dominio (el permiso `accion: "carta"` ya lo trataba como tal).

**Más difícil / a resolver en la implementación:**
- Hay que portar y adaptar ~2.000 líneas de UI (no trivial, aunque es
  adaptación y no diseño desde cero).
- Wildcard DNS + certificado para `*.<dominio>` es infraestructura nueva
  para el proyecto de Vercel de motor2.
- Mezclar tráfico público de alto volumen y cacheable (ISR) con la app
  autenticada y dinámica en el mismo deployment — Next.js soporta
  configuración de caché independiente por ruta, pero conviene verificar
  bajo carga real antes de asumir que no hay interferencia entre los dos
  perfiles de tráfico.
- Perder el boundary de "contrato público versionado" que hoy protege al
  schema interno de filtrarse sin querer a un consumidor externo — con
  todo en el mismo repo, hace falta disciplina de código (no de
  arquitectura forzada) para no mezclar tipos internos de administración
  con lo que se sirve en las rutas públicas de la carta.
- Retirar `restaurant-menu-design` es un cambio operativo real (dejar de
  desplegarlo, sacar sus variables de entorno, decidir qué pasa con el
  repo) que se planifica aparte, no de un día para el otro.

## Revisar cuando

- Si en algún momento aparece un cliente que necesita un dominio 100%
  propio y ajeno a `*.<dominio>` (no un subdominio de motor2) — hoy no está
  en alcance, y el mecanismo de subdominio no lo cubre directamente.
- Si el tráfico público de la carta crece lo suficiente como para que
  compartir deployment con la app autenticada sea un problema de
  rendimiento o de aislamiento real (ver "más difícil" arriba) — ahí sí
  valdría reconsiderar separar el módulo de carta en su propio deployment,
  aunque siga siendo el mismo repo/monorepo.

## Progreso de implementación

> Esta sección es la fuente de verdad del avance — no la conversación que
> lo produjo (que se compacta/pierde detalle). Antes de seguir con
> cualquier fase, leer esto y el plan completo (el mensaje del agente
> `Plan` que lo diseñó, 2026-09-29) en vez de asumir contexto de memoria.
> Rama: `multitenancy-fase-a`. Todo lo de abajo es local, sin push.

### CHECKPOINT 2026-09-29 (a prueba de compactación — leer esto primero)

- **HEAD local:** `27f8f27` sobre `27b8243` (Fase 6), `919500a` (Fase 4),
  `e8a6902`. Árbol limpio al escribir esto. Sin push (el push exige
  aprobación explícita del dueño a nivel hash). Nunca `main`.
- **Terminado (todo lo que se podía sin autorización):** Fases 0-4 y 6 con
  código, Fase 5 decidida (se queda el layout "libro"). Última línea de base
  del gate de 7 comandos: arquitectura 535 módulos, test 292/3421,
  test:e2e 379.
- **Pendiente y bloqueado por autorización:** Fase 7 (DNS wildcard,
  `CARTA_DOMINIO_BASE` en Vercel, staging, migrar QR/links, retirar el
  deployment externo), Fase 8 (después de la 7), Fase F.
- **Estado real de multitenancy:** la app NO es multitenant hoy. El schema
  real (`prisma/schema.prisma`) no tiene `Empresa` ni `empresaId`; el diseño
  (ADR-001/002/004: tabla compartida + `empresaId` + RLS) vive solo en el
  schema aislado `prisma/fase-a/schema.prisma` + migraciones manuales en
  `prisma/fase-a/migraciones-manuales/`. La carta resuelve la empresa contra
  `CARTA_EMPRESA_SLUG` (env), no contra la base.
- **REQUISITO NUEVO DEL DUEÑO (2026-09-29) para la Fase F:** la app tiene
  que poder INSTALARSE ya multitenant-capable pero ACTIVARSE con UNA sola
  empresa: el esquema (`Empresa`, `empresaId`, RLS, resolución por slug/host)
  existe siempre, y una instalación de una sola empresa funciona sin fricción
  (sin exigir subdominios/DNS wildcard, con esa empresa como default). Sumar
  una segunda empresa después = dato + configuración, no otra migración de
  estructura. **El plan de la Fase F ya está diseñado y aprobado por el
  dueño (2026-09-29): ver `ADR-007-instalacion-multiempresa-activada-con-
  una.md`** (pasos N1-N3 sin autorización; A0-A8 con autorización expresa
  por paso). Se hace en el MISMO repo, en pasos chicos integrables a la
  línea principal, con el modo «una empresa» como default.
- **Cómo retomar:** (1) `git log --oneline -6` y `git status`; (2) leer esta
  sección + el ADR-004 + `prisma/fase-a/`; (3) el siguiente paso es el PLAN de
  la Fase F (skill `plan-con-verificacion-e2e`, agente `Plan`, `opus`), sin
  implementar nada del schema real hasta que el dueño apruebe el plan;
  (4) toda tarea de schema/migración es "requiere autorización expresa".

**Hecho, en orden, cada uno gate-verificado (7 comandos: tsc, lint,
arquitectura, analizar:muerto, test, build, test:e2e) antes del commit:**

1. **Paso 0** (`f0b38f4`, y la nota de referencia en `b226ede`): revertido
   `TokenCartaEmpresa` (era de ADR-005, ya superado). Línea de base tomada:
   tsc/lint limpios, arquitectura 515 módulos, analizar:muerto 0
   hallazgos, test 287/3364, build limpio, test:e2e 369/66.
2. **Fase 1** (`29a901c`): admin de carta movida de `/catalogo/carta` a
   `/carta` (rutas, menú, redirect legado, regla de arquitectura
   `carta-admin-sin-rutas-de-catalogo`). test:e2e 370/66.
3. **Fase 2** (`e6ba7a4`): base pura de lectura —
   `src/core/carta/{estilo,publica-consulta,host,empresa-carta}.ts` +
   fachada del dominio (`public.ts`/`public-servidor.ts`, saca `carta` de
   `DOMINIOS_SIN_PUBLIC_TODAVIA`). test 291/3406.
4. **Fase 3** (`a452cea`): la carta pública nueva, servida desde motor2 —
   `src/app/(carta-publica)/` (layout, error, not-found, las 2 páginas) +
   `src/components/carta-publica/` (6 componentes, desenredados del
   diagnóstico de UI: sin duplicación mobile/desktop, sin
   `querySelectorAll`, `ResizeObserver` bien desconectado, landmarks para
   axe, piso de contraste/legibilidad). Accesible por PATH directo
   (`/carta-publica/<empresa>/<sucursal>`), todavía sin subdominio (eso es
   la Fase 6). Páginas `dynamic = "force-dynamic"` en esta fase a
   propósito: no había `revalidatePath` todavía, cachear sin invalidar
   sería peor que no cachear (encontrado con un test real: con
   `revalidate=300` un spec veía la respuesta cacheada de otro) — la
   Fase 4 lo resolvió para la página de sucursal (el portal sigue
   dinámico). test 292/3415, test:e2e 375/67. **Corrección (2026-09-30):** esta
   fase entregó el portal solo como grilla y se llegó a decir que el «modo mapa»
   (imagen de fondo + tarjetas en `SucursalPublica.posX/posY/posW/posH`) era
   código muerto de la carta anterior. Era falso: es una función real, y sin él
   el portal nuevo perdía paridad. Se portó en el punto 6.
5. **Fase 4** (`919500a`): la vista
   previa de `/carta/tema` es `CartaVista` real con `CARTA_EJEMPLO`
   (`NavegacionCarta` ganó `embebida`: alto fijo, sin landmarks propios);
   borrado `vista-previa-tema.tsx`. `/carta/portal` suma "Ver la carta de
   motor2 →" y "Ver el portal de motor2 →" (links por path, `empresaCartaActual`;
   los links externos siguen hasta la Fase 7). Caché: la página de sucursal
   vuelve a ISR (`revalidate = 300`) e invalida al instante desde las acciones
   de `src/server/actions/carta/` (`revalidarCartasPublicas`); el portal de la
   empresa sigue dinámico. Dos trampas encontradas por un e2e que se vio fallar
   (mutación → rojo → revertir → verde): (1) una ruta con segmentos dinámicos
   NO entra en ISR sin `generateStaticParams` (el build la marcaba ƒ y
   `revalidate` no hacía nada) — se devuelve `[]`; (2) `revalidatePath` con un
   patrón necesita el route group (`/(carta-publica)/carta-publica/[empresa]/[sucursal]`),
   sin él no invalida nada y no avisa. Límites conocidos: cambios fuera del
   módulo carta (precio/nombre/disponibilidad de un producto) tardan hasta 5
   min; las bandas de sección usan `vh` y en la vista previa se calculan con la
   ventana, no con el recuadro; la vista previa usa datos de ejemplo fijos (mejora
   posible: la carta real de la sucursal). test 292/3415, arquitectura 535
   módulos, test:e2e 376/67.
6. **Portal con mapa (2026-09-30, rama `multitenancy-fase-a`, sin push)**:
   `PortalVista` (`src/components/carta-publica/portal-vista.tsx`) dibuja el
   portal en dos modos que decide `decidirLayoutPortal`: MAPA (hay imagen de
   fondo y al menos una sucursal con `posX/posY/posW`; tarjeta centrada en x/y
   en %, ancho `posW`, alto `posH` o `portal_card_alto_defecto`; las sucursales
   sin posición van en una grilla DEBAJO del mapa) y GRILLA (cualquier otro
   caso). La apariencia es **por empresa** y vive en la tabla nueva
   `PortalCartaEmpresa` (1:1 con `Empresa`, `valores Json`, migración
   `20260930120000_portal_carta_empresa`, RLS `ENABLE` con la política
   `aislamiento_empresa` como las otras: pasan de 49 a 50 las tablas con
   `empresaId`). El catálogo de 22 claves está en `src/core/carta/portal.ts`
   (`CLAVES_PORTAL_V1`; validación cerrada, cada valor entra al CSS solo como
   variable `--portal-*` ya validada; incluye proporción del mapa, tamaños de
   letra de las tarjetas y overlay). Admin en `/carta/portal`: `EditorPortal`
   (formulario por zonas + vista previa en vivo con el mismo `PortalVista`),
   Server Action `guardarPortalEmpresa` (permiso `carta`, único escritor de la
   tabla) y arrastre de tarjetas en la vista previa (`moverSucursalEnMapa`;
   los números del formulario de cada sucursal siguen siendo la alternativa
   sin mouse). El portal público sigue dinámico (lee la fila en cada pedido).

**Pendiente, en el orden del plan (ver el plan completo para el detalle de
cada una — no reinventarlas de memoria):**

- **Fase 5 — DECIDIDA 2026-09-29 por el dueño: se queda el layout "libro"**
  (páginas: portada → índice → secciones, de a una). No se cambia a scroll
  vertical; no hay código que hacer. La base de la Fase 3 sigue sirviendo si
  algún día se reabre.
- **Fase 6 — código HECHO (`27b8243` + `27f8f27`; test 292/3421, arquitectura 535
  módulos, test:e2e 379); DNS real requiere autorización**:
  `reglasRewriteCarta` (`src/core/carta/host.ts`, mismo patrón de host que
  `interpretarHostCarta`) alimenta `rewrites().beforeFiles` de
  `next.config.ts`: en `carta-<empresa>.<CARTA_DOMINIO_BASE>`, `/` → portal
  y `/<sucursal>` → carta, sin `/carta-publica` en la URL. Sin la variable no
  hay reglas. Se lee AL COMPILAR (va en el env del build). e2e con
  `carta-e2e.localhost` (`test/e2e/carta-subdominio.spec.ts`, demostrado
  por mutación). Límites conocidos: (1) el host de la carta NO bloquea el
  resto de la app (`/login`, `/carta/...` de dos segmentos siguen
  resolviendo; el acceso lo deciden el layout y cada acción, como siempre);
  (2) los links internos de la carta (`hrefVolver`, links del portal) siguen
  siendo paths `/carta-publica/...` (las páginas no leen el Host, son ISR);
  en el host de la carta `reglasRedirectCarta` (`redirects()` de
  `next.config.ts`, 307) los lleva a la URL limpia (`/` y `/<sucursal>`),
  al costo de un salto por clic; en el host común no redirige. Cubierto por
  e2e y demostrado por mutación. Falta para producción (Fase 7/F): DNS wildcard
  `*.<dominioBase>` (cubre `carta-<empresa>.<dominioBase>` desde el cambio a un
  solo nivel del 2026-09-30) y configurar `CARTA_DOMINIO_BASE` en Vercel.
  **Fase 7, staging en motor2-demo (2026-09-30):** `app.zuluhub.com.ar` y
  `*.app.zuluhub.com.ar` agregados al proyecto (DNS de `zuluhub.com.ar` ya en
  Vercel), `CARTA_DOMINIO_BASE=app.zuluhub.com.ar` en Production, cartas en
  `carta-<empresa>.app.zuluhub.com.ar`. **Con `CARTA_DOMINIO_BASE` configurado,
  el host de la app ya NO sirve la carta:** `/carta-publica/<empresa>[/<sucursal>]`
  en cualquier host que no sea el de la carta redirige (307) al host de la carta
  (`reglasRedirectAppACarta`; `localhost` y `127.0.0.1` pelados quedan afuera,
  para desarrollo y e2e). Sin la variable, la carta se sirve por path como
  antes (instalación de una empresa sin subdominio propio). Demostrado por
  mutación (sin la regla, el spec recibe 200 en vez de 307).
  **Lote S-2 de seguridad (2026-10-02, informe 2026-10-01) — cambia lo anterior:**
  la carta pasa a `<empresa>.carta.zuluhub.com.ar` (`CARTA_DOMINIO_BASE=carta.zuluhub.com.ar`,
  wildcard `*.carta.zuluhub.com.ar`; sin el prefijo `carta-`). El formato viejo
  (`carta-<empresa>.<base>` y el staging `*.app.zuluhub.com.ar`) se descarta sin
  redirección: bajo la base nueva `carta-x` sería el slug de una empresa `carta-x` (404).
  El límite (1) de arriba queda resuelto: en cualquier host de la zona de cartas
  (`src/proxy.ts`) solo se sirve la raíz y `/<sucursal>`; login, `/api/*`, cron, la app,
  el dominio base pelado y los subdominios de dos niveles dan 404 (un segmento suelto
  como `/login` se reescribe a la carta y da 404 ahí). La cookie de sesión en producción
  es `__Host-authjs.session-token`, que el navegador no comparte con subdominios. La carta
  lleva CSP estática (sin nonce, para seguir siendo ISR) con `frame-ancestors 'none'` y
  `X-Robots-Tag: noindex, nofollow`; la app, CSP con nonce por pedido (`core/seguridad/cabeceras.ts`).
- **Fase 7** [requiere autorización, operación de producción]: comparar en
  staging contra `restaurant-menu-design`, migrar los QR/links repartidos,
  retirar el deployment externo.
- **Fase 8** [HECHA]: borrado el boundary
  HTTP (`src/app/api/carta/**`, `autorizar-servicio.ts`, `token-servicio.ts`,
  el contrato `RegistroTenantsV1` y sus lectores `registro-consulta.ts` /
  `tema-consulta.ts`), y las variables `CARTA_API_TOKEN` / `CARTA_PORTAL_URL`
  (`env.ts`, `.env.example`, `playwright.config.ts`). Las verificaciones
  e2e que leían `/api/carta/*` pasaron a leer la base o `resolverMenuCarta` /
  `resolverPortalCarta`; la no-filtración de datos internos en la carta
  serializada quedó en `test/carta/menu-consulta.test.ts` e
  `items-agrupados-consulta.test.ts`. Reaparecer lo borrado lo impide
  `test/arquitectura/sin-boundary-http-carta.test.ts` (y un e2e que exige 404
  en `/api/carta/*`). Se decidió borrar sin esperar la Fase 7: el dueño está en
  prueba, sin QR ni links repartidos que romper.
- **Limpieza de `SucursalPublica`** [HECHA, 2026-09-30, con autorización del
  dueño; sin push ni deploy]: con el boundary HTTP borrado, las columnas
  `dominio`, `menuDesdeMotor2`, `sheetId` y `sheetMenuNombre` (y el índice
  UNIQUE `SucursalPublica_dominio_key`) eran datos de transición sin lectores:
  el admin de `/carta/portal` solo las mostraba y guardaba. Se sacaron en tres
  commits (`c97fa68` código y tests, `5fc2d16` schema + migración
  `20260930190000_sucursal_publica_sin_columnas_de_sheet`, `03674ed` test de
  persistencia `sucursal-publica-columnas.test.ts`). La migración es
  DESTRUCTIVA (los valores cargados se pierden; en las bases conocidas estaban
  vacíos o en sus defaults) y su `down.sql` recrea columnas e índice sin
  recuperar datos. Ojo con la reversa: `prisma migrate resolve --rolled-back`
  solo acepta migraciones en estado fallido; para una ya aplicada hay que correr
  `down.sql` y borrar la fila de `_prisma_migrations`. Un deploy de esta rama
  aplica la migración en las bases reales (`prisma migrate deploy` corre en el
  build de Vercel). Quedan vivas `posX/posY/posW/posH` (mapa del portal).
- **Fase F** [requiere autorización en todos sus pasos]: depende de que
  `Empresa` se adopte de verdad en `prisma/schema.prisma` (ADR-004,
  "Revisar cuando") — `resolverEmpresaCarta` pasa a consultar la base en
  vez de comparar contra `CARTA_EMPRESA_SLUG`, `SucursalPublica.slug` pasa
  a único por empresa (corregir también en el schema experimental,
  `prisma/fase-a/schema.prisma`, que hoy lo tiene como único global), DNS
  wildcard real, y e2e multiempresa.
