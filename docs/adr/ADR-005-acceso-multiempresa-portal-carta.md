# ADR-005: Acceso multi-empresa al portal de carta — deployment + token por empresa, no dominio dinámico

> Redactado el 2026-09-29, durante el diseño del schema de Fase A (carta
> multisucursal). Decisión del dueño tomada en la misma conversación,
> después de investigar el código real de `restaurant-menu-design` (repo
> bajado en `Downloads/restaurant-menu-design-main (2)/restaurant-menu-design-main`,
> no una copia vieja). Reemplaza cualquier idea de dominio/subdominio
> dinámico resuelto en tiempo de request — no hay tal idea ya decidida en
> ningún documento previo, así que esto no reabre una decisión, la fija por
> primera vez.

## Contexto

Con `Empresa` existiendo (Fase A), el portal público de la carta
(`GET /api/carta/tenants`, `SucursalPublica`, consumido por la app externa
`restaurant-menu-design`) necesita algún mecanismo para que, el día que haya
más de una empresa real (Fase B), cada una tenga su propio portal — sin que
las sucursales de una empresa aparezcan mezcladas con las de otra.

La primera idea evaluada fue subdominio/dominio dinámico por empresa,
resuelto en tiempo de request (Host header → empresa → filtrar tenants).
Investigar el código real de ambos lados cambió la conclusión:

- **`SucursalPublica.dominio` es dato muerto en motor2 hoy**
  (`docs/plan-registro-tenants-2026-09-24.md`, línea 30): nada lee
  `headers()` para resolver por Host.
- **`restaurant-menu-design` tiene la misma máquina muerta del otro lado**:
  `getTenantByDomain(host)` existe en `lib/tenants.ts` pero un grep sobre
  todo el repo (`app/`, `components/`, `lib/`) confirma que **nunca se
  llama** — la única función de resolución de tenant que se usa de verdad
  es `getTenantBySlug`, desde `app/carta/[sucursal]/page.tsx`. No hay
  `middleware.ts` en el repo.
- **El deployment ya es 1:1:1 por diseño**: `docs/setup-sucursal.md`
  (sección 7) documenta una sola tanda de variables "una vez para todo el
  deploy" — `MOTOR2_CARTA_TOKEN` tiene que ser "el mismo valor que
  `CARTA_API_TOKEN` en el proyecto de Vercel de motor2". Un deployment de
  `restaurant-menu-design` = un token = un negocio.
- **La autorización de motor2 ya es todo-o-nada, sin noción de empresa**:
  `autorizarServicioCarta` (`src/core/carta/autorizar-servicio.ts`) compara
  el `Authorization: Bearer` contra un único `CARTA_API_TOKEN` de proceso,
  usado igual por los 3 endpoints que lee la carta externa (menú, tema,
  registro de tenants).

Con esta evidencia, resolver esto con dominio dinámico significaría
construir de cero infraestructura (DNS wildcard, certificados, lectura de
Host en ambos lados) para reemplazar algo que la app externa YA resuelve de
otra forma — y que el dueño explícitamente prefiere no tocar (ver
`docs/plan-registro-tenants-2026-09-24.md`, D10: el ruteo por dominio para
sucursales individuales quedó fuera de alcance porque "prefiere que todo
siga como `/carta/<slug>`").

## Decisión

**Una empresa = un deployment de Vercel de `restaurant-menu-design`, con su
propio `CARTA_API_TOKEN`.** Nada de dominio/subdominio resuelto en tiempo de
request.

- Al crear una empresa, motor2 genera un `CARTA_API_TOKEN` propio para esa
  empresa (hoy es una sola variable de entorno global; pasa a ser un valor
  por empresa — detalle de schema/gestión de secretos a resolver en la
  implementación, no en este ADR).
- `autorizarServicioCarta` deja de comparar contra un token único: resuelve
  A QUÉ EMPRESA pertenece el token presentado, y esa empresa es la que
  filtra `SucursalPublica`/menú/tema en los 3 endpoints (`/api/carta/[sucursal]`,
  `/api/carta/[sucursal]/tema`, `/api/carta/tenants`).
- El subdominio que pidió el dueño ("lo ideal sería que obtengan subdominio
  cuando crean empresa") sale gratis de Vercel: cada proyecto nuevo recibe
  un `<proyecto>.vercel.app` automático, sin DNS wildcard ni certificados a
  mano. Un dominio propio (custom domain) sigue siendo posible después, por
  empresa, con el mecanismo estándar de Vercel — no hace falta nada especial
  de motor2 para eso.
- **Cero cambios en `restaurant-menu-design`**: ya funciona exactamente así
  (una base + un token por deployment). Se reutiliza tal cual, deployment
  por deployment.
- Automatizable a futuro: el alta de una empresa podría llamar a la API de
  Vercel para crear el proyecto y cargar sus variables de entorno
  (`MOTOR2_CARTA_URL`, `MOTOR2_CARTA_TOKEN`) sin intervención manual — no se
  decide acá SI se automatiza ahora o se documenta como proceso manual para
  la v1 (mismo criterio que el resto del provisioning de empresa, ver
  `empresa.schema.ts`: "el alta sigue siendo manual/semi-manual en la v1").

## Alternativas consideradas

- **Dominio/subdominio dinámico, resuelto por Host header en tiempo de
  request**: descartada. Requiere construir infraestructura nueva (DNS
  wildcard, certificados, lectura de `headers()` en dos repos) para
  reemplazar un flujo que ya funciona por variables de entorno, y revive
  una dirección (ruteo por dominio) que el dueño ya había descartado una
  vez para el caso más simple de sucursal individual (D10).
- **Un solo deployment de `restaurant-menu-design` para todas las
  empresas, filtrando por algún parámetro de ruta o query**: descartada —
  obligaría a versionar el contrato externo (`RegistroTenantsV1`/`Tenant`)
  y a tocar el routing de la carta (`app/carta/[sucursal]/page.tsx` pasaría
  a necesitar el segmento de empresa también), cuando la alternativa
  elegida no toca ese repo en absoluto.
- **Reactivar `getTenantByDomain`/`dominio` tal como están**: descartada —
  seguirían sin resolver el problema real (motor2 no sabe filtrar por
  empresa igual) y sumarían la complejidad operativa de dominios por
  SUCURSAL, que es un problema distinto (y ya descartado, D10) al de
  aislar el portal por EMPRESA.

## Consecuencias

**Más fácil:**
- Cero trabajo en `restaurant-menu-design`: el aislamiento entre empresas
  vive enteramente en cómo se despliega y configura, no en código nuevo de
  ese repo.
- El subdominio pedido por el dueño existe desde el día uno de cada
  empresa, sin gestión de DNS/SSL.
- Consistente con la arquitectura ya elegida para el resto del dato (ADR-002,
  tabla compartida + `empresaId`): acá el "aislamiento" es a nivel de canal
  de acceso (token + deployment), no de tabla, pero la responsabilidad de no
  filtrar cruzado sigue siendo de motor2, igual que el resto del sistema.

**Más difícil / a resolver en la implementación:**
- `CARTA_API_TOKEN` pasa de una variable de proceso a un dato por empresa —
  necesita su propio modelo de datos (probablemente en `Empresa` o una
  tabla aparte) y su propia rotación (hoy la rotación es "viejo,nuevo" en
  una sola variable; por empresa, cada una rota la suya).
- `autorizarServicioCarta` y los 3 endpoints que la usan tienen que resolver
  la empresa ANTES de filtrar — hoy no reciben ningún parámetro de empresa,
  se apoyan en que hay una sola.
- N empresas reales significan N proyectos de Vercel de `restaurant-menu-design`
  para mantener (variables de entorno, builds, dominios) — costo operativo
  real que crece con la cantidad de empresas, a diferencia de un único
  deployment compartido. Aceptable en el orden de ~50 empresas proyectado
  (ADR-002); revisar si ese número cambia sustancialmente.

## Revisar cuando

- El número de empresas crece lo suficiente como para que mantener N
  proyectos de Vercel (uno por empresa) sea operativamente pesado — ahí sí
  valdría reconsiderar un único deployment con resolución dinámica (la
  alternativa descartada acá), pero recién con esa presión real, no antes.
- Si `restaurant-menu-design` cambia de proveedor de hosting (deja de ser
  Vercel): el subdominio automático gratis es una propiedad de Vercel
  específicamente, no de cualquier hosting — revisar si el nuevo proveedor
  ofrece el mismo mecanismo antes de asumir que sigue aplicando.
