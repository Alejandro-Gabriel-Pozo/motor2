# ADR-002: Modelo de aislamiento entre empresas

> Redactado el 2026-09-28, Fase 0.6 del checklist de multi-tenancy
> (`Downloads/Motor 2/motor2-multitenancy-checklist (1).md`). El contenido ya
> estaba decidido en `motor2-sesion-decisiones-pre-multitenant-v3.md`
> (Bloque 3) — este documento solo lo redacta como ADR formal, no decide
> nada nuevo. Documentación pura: no toca código ni schema. RLS **no se
> activa con este ADR** — se activa modelo por modelo durante la Fase B,
> una vez que cada tabla ya tiene `empresaId` (Fase 2 del checklist).
>
> **Actualización 2026-09-29 (ADR-007):** lo de "modelo por modelo" queda
> reemplazado: RLS se activa en todas las tablas con `empresaId` a la vez
> (Migración 2 de ADR-007), con rol `motor2_app` aparte y modo «una sola
> empresa» como default. El resto de este ADR sigue vigente.

## Contexto

Con la definición de empresa ya fijada (ADR-001), hace falta elegir CÓMO se
aísla el dato de una empresa del de otra a nivel de infraestructura — no
solo a nivel de guard de aplicación. La decisión no se toma en abstracto:
se ancla a números reales de negocio.

**Preguntas respondidas por el dueño (v3, Bloque 3):**
- ¿Cuántas empresas se esperan en 12 meses? → orden de 50, tamaño similar.
- ¿Hay requisito legal/contractual de aislamiento físico? → No: la Ley
  25.326 exige medidas de seguridad *adecuadas*, no una arquitectura física
  particular. El objetivo es seguridad y confiabilidad máximas dentro de
  ese marco, no aislamiento físico por mandato legal.

## Decisión

**Tabla compartida + columna `empresaId` + RLS (Row Level Security) de
Postgres** para todas las tablas tenant-scoped, con:

- FK compuestas `[empresaId, id]`: la tabla referenciada declara
  `@@unique([empresaId, id])` y la que referencia usa
  `fields: [empresaId, productoId], references: [empresaId, id]` — evita
  que, por ejemplo, `Movimiento.productoId` apunte a un producto de OTRA
  empresa por validarse solo el `id` sin comparar el `empresaId`.
- Tests de aislamiento contra Postgres real (no fakes en memoria) — mismo
  criterio que el resto de la suite de motor2.
- RLS como reforzador a nivel de base, no solo guard de aplicación: si un
  guard de aplicación tuviera un bug, RLS sigue bloqueando la fuga.

Heurística de la matriz que sostiene esta elección:

| Escenario | Modelo recomendado |
|---|---|
| < 50 empresas, tamaño similar, sin requisito regulatorio de aislamiento físico | Tabla compartida + `empresaId` + RLS |
| Pocas empresas (< 10) pero alguna muy grande o con requisito contractual | Tabla compartida para la mayoría + base dedicada para la empresa grande |
| > 500 empresas o SaaS masivo | Tabla compartida + RLS (schema-por-empresa no escala operativamente) |

Motor2 cae en el primer escenario (orden de 50 empresas, sin requisito de
aislamiento físico) — por eso tabla compartida + RLS, sin combinar con base
dedicada ni con schema-por-empresa.

## Alternativas consideradas

- **Base de datos por empresa**: descartada. Con ~50 empresas de tamaño
  similar, sumaría superficie operativa real (migraciones, backups,
  configuración por base) sin ganar seguridad efectiva frente a RLS bien
  aplicado. Se reabre solo si aparece una empresa concreta con requisito
  contractual de aislamiento físico (ver "Revisar cuando").
- **Schema por empresa** (un schema de Postgres por empresa, misma base):
  descartada — no escala operativamente más allá de unas pocas decenas de
  empresas (cada migración se aplica N veces, una por schema), y no aporta
  una ventaja de seguridad clara sobre RLS con tabla compartida para el
  volumen esperado.
- **Solo guards de aplicación, sin RLS**: descartada — un guard de
  aplicación protege mientras nadie se olvida de escribirlo o de
  mantenerlo; RLS protege incluso si un guard tiene un bug o falta. Dado
  que el objetivo explícito es "seguridad y confiabilidad máximas", dejar
  el aislamiento solo en manos del código de aplicación no alcanza ese
  estándar.

## Consecuencias

**Más fácil:**
- Un bug en un guard de aplicación no es, por sí solo, una fuga de datos
  entre empresas: RLS bloquea la consulta cruzada incluso ahí.
- El modelo es uniforme para las ~50 empresas esperadas — no hay una
  empresa "especial" con infraestructura distinta que mantener aparte.

**Más difícil / a resolver en la Fase B:**
- Cada tabla tenant-scoped necesita su columna `empresaId` y, donde
  referencia a otra tabla tenant-scoped, la FK compuesta
  `[empresaId, id]` — más superficie de schema que un `id` suelto.
- RLS exige que el cliente de Postgres fije `app.empresa_id` dentro de
  CADA transacción (incluidas las lecturas) antes de operar — un detalle
  operativo real, no solo de schema (ver "Ideas a evaluar" en el checklist:
  rol de aplicación que no sea owner, `FORCE ROW LEVEL SECURITY`,
  comportamiento del pooler en modo transacción).
- El superadmin de plataforma y los reportes consolidados por empresa no
  encajan en un único `app.empresa_id` por transacción — necesitan un
  camino aparte, todavía sin diseñar en detalle (ver Bloque 4 de la v3 y
  la sección 1.1 del checklist).

**Pospuesto a propósito:**
- No se crea una segunda empresa real hasta que la Fase B esté completa
  (todas las tablas de la matriz clasificadas y con `empresaId`).
- RLS se activa modelo por modelo durante la Fase B, no de una vez — activar
  antes de que una tabla tenga `empresaId` sería trabajo sin efecto.

## Revisar cuando

- Aparece una empresa concreta con requisito contractual o regulatorio de
  aislamiento físico (reabre la alternativa "base dedicada para esa
  empresa, tabla compartida para el resto").
- El número de empresas supera significativamente el orden de 50
  proyectado, o el negocio pasa a un modelo tipo SaaS masivo (> 500
  empresas) — en ese escenario tabla compartida + RLS sigue siendo el
  modelo recomendado (ver matriz), pero conviene revisar la configuración
  de RLS/pooler bajo ese volumen antes de asumir que escala sin cambios.
