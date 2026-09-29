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
subdominio: `carta.<empresa>.<dominio>` (la empresa como base, carta como
sub-sub-dominio — no `<empresa>.carta.<dominio>` ni un guion en un solo
nivel, evaluados y descartados por el dueño).

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
   dinámico). test 292/3415, test:e2e 375/67.
5. **Fase 4**: la vista
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

**Pendiente, en el orden del plan (ver el plan completo para el detalle de
cada una — no reinventarlas de memoria):**

- **Fase 5** [HOY, opcional, con aprobación del dueño]: decisión sobre
  cambiar el layout de "libro" (slider horizontal) a scroll vertical único
  — capturas antes/después, nunca decidir solo. La Fase 3 ya construyó la
  base (resolver de estilo, navegación por datos, variables CSS) que sirve
  para cualquiera de los dos layouts.
- **Fase 6** [código HOY; DNS real requiere autorización]: rewrite en
  `next.config.ts` para `carta.<empresa>.<dominioBase>` (con
  `CARTA_DOMINIO_BASE` configurada), probado con `*.localhost` en
  Playwright sin DNS real.
- **Fase 7** [requiere autorización, operación de producción]: comparar en
  staging contra `restaurant-menu-design`, migrar los QR/links repartidos,
  retirar el deployment externo.
- **Fase 8** [código HOY, pero solo DESPUÉS de la Fase 7]: borrar el
  boundary HTTP (`src/app/api/carta/**`, `autorizar-servicio.ts`,
  `token-servicio.ts`, el contrato `RegistroTenantsV1`) — mientras el repo
  externo siga en producción, `/api/carta/*` sigue siendo su única fuente,
  no se toca.
- **Fase F** [requiere autorización en todos sus pasos]: depende de que
  `Empresa` se adopte de verdad en `prisma/schema.prisma` (ADR-004,
  "Revisar cuando") — `resolverEmpresaCarta` pasa a consultar la base en
  vez de comparar contra `CARTA_EMPRESA_SLUG`, `SucursalPublica.slug` pasa
  a único por empresa (corregir también en el schema experimental,
  `prisma/fase-a/schema.prisma`, que hoy lo tiene como único global), DNS
  wildcard real, y e2e multiempresa.
