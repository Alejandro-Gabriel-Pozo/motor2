# Seguridad de aplicación en el pipeline (CI/CD)

Fecha: 2026-10-10. Alcance: controles automáticos que detectan dependencias vulnerables, fallos en el código, secretos filtrados, problemas HTTP e inputs maliciosos.
**No toca la lógica de negocio** ni desactiva ningún control existente (`ci.yml`, el gate de 8 comandos, `auditar:dependencias`, las cabeceras CSP).

## Resumen

| # | Control | Dónde corre | Cuándo | ¿Bloquea? |
|---|---|---|---|---|
| 1 | `npm audit` (alto y crítico) | `seguridad.yml` → `dependencias` | push a `main`/`ci/**`, PR a `main`, semanal, manual | **Sí**: un aviso ALTO/CRÍTICO sin excepción vigente deja el job en rojo |
| 2 | CodeQL (JS/TS) | `codeql.yml` | push, PR, semanal (miércoles), manual | Los hallazgos van a *Security → Code scanning*; bloquean el PR si se configura la regla de protección de rama «Code scanning results» |
| 3 | Gitleaks (código + historial completo) | `gitleaks.yml` | push, PR, semanal, manual | **Sí**: cualquier secreto sin excepción deja el job en rojo |
| 4 | OWASP ZAP baseline | `seguridad.yml` → `zap` | push, PR, semanal, manual | **Sí** solo para las reglas en `FAIL` de `.zap/reglas-baseline.tsv`; el resto es advertencia |
| 5 | Pruebas de SQL injection / XSS | Vitest en `ci.yml` (`npm test`) y en `seguridad.yml` → `pruebas-de-seguridad`; Playwright en `ci.yml` → `e2e` | cada push/PR | **Sí** (son tests del gate) |

Todos usan `permissions: contents: read` (CodeQL suma `security-events: write` y `actions: read`, lo mínimo que exige). Ninguno usa secretos: las claves de los workflows son de relleno y de la base del propio runner.

## Ejecutar cada control en tu máquina

Requisito común: `npm ci`. Para las pruebas con base: Postgres local descartable (`docker compose up -d`) con las bases `motor2_dev` y `motor2_e2e` migradas, como dice el README.

```bash
# 1) Dependencias (el comando del proyecto: con excepciones que vencen)
npm run auditar:dependencias
npm audit --audit-level=high            # el comando crudo (incluye dev y excepciones aceptadas), informativo

# 2) CodeQL: se corre en GitHub. Local (opcional): instalar la CLI de CodeQL y
codeql database create /tmp/codeql-db --language=javascript-typescript --source-root=.
codeql database analyze /tmp/codeql-db codeql/javascript-queries:codeql-suites/javascript-security-extended.qls --format=sarif-latest --output=/tmp/codeql.sarif

# 3) Gitleaks (Go instalado; versión fija igual que el workflow)
go install github.com/zricethezav/gitleaks/v8@v8.30.1
gitleaks git --no-banner --redact -v --config .gitleaks.toml .      # todo el historial
gitleaks git --no-banner --redact --config .gitleaks.toml --pre-commit --staged .   # solo lo que vas a commitear

# 4) OWASP ZAP baseline (Docker). Siempre contra una instancia LOCAL con base descartable `_e2e`
export MOTOR2_E2E_DATABASE_URL=postgresql://motor2:motor2@localhost:5432/motor2_e2e
export MOTOR2_E2E_APP_DATABASE_URL=postgresql://motor2_app:<clave>@localhost:5432/motor2_e2e
npx tsx scripts/seguridad-sembrar-para-zap.ts            # se niega si la base no es local y `_e2e`
npm run build:e2e && PORT=3101 AUTH_TRUST_HOST=true npm run start:e2e &
mkdir -p zap-informe && cp .zap/*.tsv zap-informe/ && chmod -R a+rwx zap-informe
docker run --rm --network host -v "$PWD/zap-informe:/zap/wrk:rw" ghcr.io/zaproxy/zaproxy:stable \
  zap-baseline.py -t http://localhost:3101 -c reglas-baseline.tsv -r informe.html     # informe en zap-informe/

# 5) Pruebas de SQL injection y XSS
npx vitest run test/seguridad/inyeccion-sql-y-xss.test.ts      # acciones reales contra Postgres (acciones reales: SQL, XSS y caracteres que Postgres no admite)
npx playwright test test/e2e/seguridad-xss-y-sqli.spec.ts       # navegador real contra `next build` + `next start`
```

## Qué cubre cada pieza

**1. npm audit.** El comando crudo (`npm audit --audit-level=high`) hoy falla *siempre* por la cadena del CLI de Prisma (`prisma → @prisma/config → deepmerge-ts`, `mysql2`), que se usa en build/migraciones y no se carga en la app, y cuyo único arreglo ofrecido es bajar Prisma a 6.x. Por eso el job bloqueante es `npm run auditar:dependencias` (ya existente, S-15): mismo umbral (alto y crítico), pero cada aviso aceptado queda en `scripts/auditoria-dependencias-excepciones.ts` con motivo y fecha de vencimiento. El comando crudo corre aparte, solo informativo, para verlo en el log.

**2. CodeQL.** `javascript-typescript`, `build-mode: none`, consultas `security-extended`. Hace falta *Code scanning* habilitado: gratis en repositorios públicos; en uno privado requiere GitHub Advanced Security. Si no está disponible, el paso `analyze` falla con un mensaje claro y el resto no se ve afectado.

**3. Gitleaks.** Historial completo (`fetch-depth: 0`). Reglas oficiales más las propias de `.gitleaks.toml`: cadena de conexión a Neon / a Postgres con clave real, clave de Resend (`re_…`), `AUTH_SECRET`/`AUTH_GOOGLE_SECRET` con entropía de secreto, secreto de cliente de Google (`GOCSPX-…`), token de Sentry; claves privadas y tokens genéricos vienen de las oficiales. Los valores de relleno del CI (`ci-…-descartable`, `ci-…-de-relleno`) y los marcadores `${CLAVE}` / `<CLAVE_X>` de las guías no cuentan. El log nunca muestra el valor (`--redact`).
Verificado: corrida sobre el repositorio real (65 commits) → 22 coincidencias iniciales, **todas falsos positivos** (ver abajo) → 0 tras las excepciones; y sobre un repositorio de prueba con 5 secretos inventados sembrados (Neon, Resend, `AUTH_SECRET`, Google, clave privada) → los detectó a los 5.

**4. OWASP ZAP.** Baseline = rastreo + reglas **pasivas** (no envía ataques). El objetivo está fijo en `localhost`: la app se compila y levanta dentro del runner con una base Postgres descartable (`motor2_e2e`, sembrada con una carta pública de prueba por `scripts/seguridad-sembrar-para-zap.ts`, que reutiliza las guardas de los E2E: solo base local cuyo nombre termina en `_e2e`). No hay ninguna entrada del workflow que permita apuntarlo a otra URL, y nunca se apunta a producción. Revisa cabeceras, cookies, CORS, rutas expuestas y configuraciones inseguras. El escaneo **activo** (inyección SQL, XSS reflejado, traversal…) existe pero solo a mano: *Actions → Seguridad → Run workflow → `escaneo-zap: completo`*, siempre sobre esa misma app descartable. Salida: `0` limpio, `2` solo advertencias (no bloquea), `1`/`3` bloquea. Informe HTML/JSON/MD como artefacto 14 días, y el resumen en la pantalla del workflow.

**5. Pruebas de SQL injection y XSS.**

- `test/seguridad/inyeccion-sql-y-xss.test.ts` (Vitest, acciones reales, sin mocks de datos): 19 payloads (`' OR '1'='1`, `'; DROP TABLE …`, `UNION SELECT`, `pg_sleep`, `<script>`, `<img onerror>`, `<svg onload>`, `javascript:`, `{{…}}`, bidi, 100 000 caracteres, saltos de línea, comodines `%`/`_`) contra: alta de proveedor, de cliente y de producto rápido; búsqueda del selector de productos, del listado de catálogo y del historial; consulta del historial con SQL crudo (`$queryRaw`); contenido de la carta pública; formas equivocadas (`null`, objeto, arreglo, número); descuentos inválidos; valores de 1 MB; y los endpoints de cron con `Authorization` de ataque. Cada caso afirma: base intacta (mismas tablas, mismos usuarios/roles/acciones/unidades), texto guardado literal o rechazado, búsquedas que no devuelven «todo», y respuestas sin detalles internos (Prisma, SQLSTATE, rutas, stacks).
- `test/e2e/seguridad-xss-y-sqli.spec.ts` (Playwright, producción real): XSS **almacenado** sembrado directo por Prisma (saltando los validadores, el peor caso) en producto, descripción, etiquetas, sección e ítem agrupado de la carta pública y en proveedor/producto/cliente de la administración → nada se ejecuta ni se vuelve DOM; XSS **reflejado** y *open redirect* por `aviso` y `volver` de `/login`; slugs maliciosos en las rutas de la carta; filtros maliciosos en 4 reportes (incluido `pg_sleep`); cabeceras de seguridad y CSP; cron cerrado (401).
- Defensas que ya existían y que ahora quedan fijadas: lista blanca de caracteres para nombres de catálogo (`RE_TEXTO_CATALOGO`, 80 caracteres), SQL crudo siempre con *tagged templates* parametrizados (no hay `queryRawUnsafe` en `src/`), escapado de React, CSP con nonce en la app.

## Hallazgos

Fuera de «solo controles»: tocan `src/`. Los dos primeros se dejaron a propósito como *brecha conocida* (un test que pasaba con `it.fails` / `test.fail()` y se ponía **rojo cuando alguien la arreglara**) y ya están **corregidos**: los tests se dieron vuelta a tests normales que afirman el comportamiento correcto.

1. **CORREGIDO — Búsqueda con NUL (`\u0000`) o sustituto UTF-16 suelto → error 500.** Postgres no admite esos caracteres; el error de Prisma subía sin atrapar. Sin inyección ni fuga y exige sesión con permiso. Medido antes de arreglar: el NUL daba 500 en las CINCO lecturas con texto de búsqueda (selector de productos y listado de catálogo, historial —`buscarProductoParaHistorial`—, trazabilidad por producto y filtro de N.º de factura de compras) y también como identificador o cursor que viene de la URL (`?productoId=%00`, `?idOperacion=%00`, `?cursor=%00`, `?proveedorId=%00`); el sustituto suelto daba 500 en el selector y el listado (los que usan el cliente de base de la sesión). Arreglo, en dos puntos y sin tocar lo que se guarda: `textoDeBusqueda()` en `src/core/texto.ts` (`texto()` + sacar el NUL y los sustitutos sueltos; los pares completos —emojis—, acentos y ñ quedan intactos) que usan las cinco lecturas (y el cursor del listado), y `unicosDeUrl()` (`src/core/datos/parametros-de-url.ts`, por donde pasan los parámetros de toda página) que saca esos caracteres de cada parámetro de la URL. Una búsqueda con ellos devuelve «sin resultados» (o lo que sí era texto: `ñand%00ú` encuentra «Ñandú»). **Lo que se GUARDA no se toca:** las altas con NUL o con un sustituto suelto (proveedor, cliente, producto rápido) ya se rechazaban con un mensaje claro por la lista blanca de caracteres de catálogo (medido); este saneo es solo de búsqueda. Pruebas: `test/seguridad/inyeccion-sql-y-xss.test.ts` (bloque «caracteres que Postgres no admite…»), `test/core/texto-busqueda.test.ts` y `test/e2e/seguridad-xss-y-sqli.spec.ts` («un NUL (`%00`) en la URL…»). Límite: no cubre los identificadores con NUL que un cliente malicioso mande directo a una Server Action de lectura/edición (`obtenerProducto(id)`, etc.); eso necesitaría validar el id en cada una o una guarda en el cliente de base (propuesta, no hecha).
2. **CORREGIDO — Un `%` mal escapado en la ruta → 500** («failed to decode param»). Medido: no era solo `/carta-publica/<empresa>/%25`; daba 500 cualquier segmento de la carta de una sucursal con un `%` suelto o un UTF-8 inválido (`%zz`, `a%`, `%ff`, `%C0%AF`, `%E0%A4%A`), `/carta-publica/%25/x`, y también las rutas dinámicas de la aplicación con un escape inválido (`/catalogo/productos/%zz/editar`, antes de pedir login). La carta es ISR y Next decodifica su ruta DOS veces, así que hasta un `%25` bien escapado fallaba. Es pública: cualquier anónimo podía generar 500s (ruido en Sentry, no explotable ni con fuga: el cuerpo era «Internal Server Error»). Arreglo: `src/proxy.ts` corta con un 404 limpio (con las cabeceras de seguridad, cuerpo «Not Found») todo path cuyo segmento no se puede decodificar, que decodifica a un NUL (`%00`), o —solo bajo `/carta-publica`, donde ningún slug lleva `%`— que decodifica a algo con `%` (`src/core/seguridad/ruta-servible.ts`). Un path válido no cambia (la carta de una sucursal, `/catalogo/productos/%25/editar` sin sesión sigue yendo al login). Pruebas: `test/core/proxy-seguridad.test.ts` y `test/e2e/seguridad-xss-y-sqli.spec.ts` (un `%` suelto o un escape inválido…).
3. **Dos avisos ALTOS de dependencias sin excepción** hoy: `sharp` (<0.35.5, vía `next`, optimización de imágenes) y `source-map-js` (<1.2.2, vía PostCSS/Tailwind, build). Arreglo sin cambio mayor: `npm audit fix`, que solo actualiza `package-lock.json`. Sobre la base del #96 el `package-lock.json` ya traía ese parche (mi commit quedó vacío y no se incluyó); si el aviso reaparece, `npm audit fix` o, si preferís otra vía, agregás excepciones con fecha en `scripts/auditoria-dependencias-excepciones.ts`.
4. **CORREGIDO — Los comodines `%` y `_` funcionaban como comodines de búsqueda** (Prisma no los escapa en `contains`: buscar `%` devolvía todo, `pan_i` encontraba también «Pan integral», y una barra invertida escapaba el `%` que Prisma agrega al final). No era inyección ni salía del alcance autorizado (RLS por empresa sigue filtrando); era solo comportamiento de búsqueda. Arreglo central: `escaparComodinesLike()` (`src/core/texto.ts`: escapa `\`, `%` y `_`) en las cinco búsquedas con `contains` (nueve filtros `contains`: selector y listado de productos, historial, trazabilidad por producto, N.º de factura de compras), y `test/arquitectura/busquedas-sin-comodines.test.ts` falla si aparece un `contains:` nuevo que no lo use. Pruebas: bloque «comodines de LIKE» de `test/seguridad/inyeccion-sql-y-xss.test.ts`, `test/reportes/compras-registradas.test.ts` y `test/reportes/trazabilidad.test.ts`. Efecto visible: buscar `%` o `_` ahora busca el carácter literal (los códigos de producto llevan `_`, p. ej. `MP_HARINA`, y se siguen encontrando).
5. Los documentos `docs/guion-produccion-2026-10-05.md` muestran los *hostnames* de los endpoints de Neon de producción (sin clave). No es un secreto, pero es información de infraestructura; conviene saberlo.

## Falsos positivos y excepciones

- **Gitleaks** (`.gitleaks.toml`, cada excepción exige archivo **y** valor a la vez, así un secreto real en el mismo archivo igual salta): huella congelada de la alta del admin ficticio `dueno@plataforma.test` (`test/auth/caracterizacion/…golden.txt`: 18 coincidencias de secretos TOTP de prueba); token inventado de `sentry-limpiar.test.ts`; vector público de RFC 6238 en `totp.test.ts`; `Bearer dev-token` de un plan en `docs/`; `contrasenia-secreta` de `test/plataforma/entorno.test.ts`; `clave-que-no-sale` de 3 tests; `.env.example`. Valores de relleno del CI por patrón.
- **ZAP**: la carta pública necesita `script-src 'unsafe-inline'` y `img-src https:` (decisión documentada en `cabeceras.ts`) → ZAP lo marca como advertencia (10055); «contenido almacenable en caché» (10049) es el ISR de la carta a propósito; «cookie sin Secure» (10011) aparece por correr en `http://localhost`, en producción va por https. Están en `WARN`/`IGNORE`.
- **CodeQL**: suele marcar `dangerouslySetInnerHTML`, redirecciones con parámetros y construcción de URLs; revisar caso por caso en *Security → Code scanning* y descartar con motivo (*Dismiss → Used in tests / False positive*).
- **npm audit**: ver punto 1; las dos excepciones de Prisma vencen el 2026-12-01.

## Lo que no pude verificar acá

- **ZAP no se corrió** (no hay Docker en esta sesión). Sí se verificó: que el workflow pasa `actionlint`, que la app levanta en `localhost:3101` con la base sembrada y devuelve 200 en `/login`, `/carta-publica/e2e` y `/carta-publica/e2e/zap`, y las cabeceras que ZAP evalúa (spec de Playwright). La lista de reglas en `FAIL` sale de lo que el repositorio ya cumple; **la primera corrida real puede mostrar un falso `FAIL`**: en ese caso, bajar esa regla a `WARN` en `.zap/reglas-baseline.tsv` con el motivo al lado.
- **CodeQL** no se corrió (se ejecuta en GitHub).
- El gate completo de 8 comandos: ver el cierre del trabajo para lo que se corrió.

## Para activarlo del todo (hace falta tu mano en GitHub)

1. *Settings → Code security*: habilitar **Code scanning** (CodeQL) y, si querés, **Secret scanning + push protection** (complementa a Gitleaks).
2. *Settings → Branches → regla de `main`*: agregar como obligatorios los checks `Dependencias (npm audit)`, `Escanear secretos` y `Pruebas de seguridad`. **No marcar `OWASP ZAP` ni CodeQL como obligatorios hasta ver una primera corrida verde.**
3. Dependabot ya propone las actualizaciones de las acciones de GitHub (ecosistema `github-actions`, que trae el #96).
4. Las acciones están fijadas por SHA, como `ci.yml` (`checkout`, `setup-node` y `upload-artifact` con los mismos SHA). **Pendiente:** `actions/setup-go@v5` (gitleaks) y `github/codeql-action@v4` (CodeQL) quedan por etiqueta, porque desde esta sesión no pude verificar el SHA de esas dos; hay que fijarlos al SHA de su última versión (o dejar que Dependabot lo proponga).
