# ADR-026: Capa de lecturas compartidas (`src/server/lecturas/`)

> Redactado el 2026-10-06. **Estado: aceptado por el dueño; se implementa en la Fase 3 del plan de pureza** (`docs/plan-fase-3-pureza.md`). Sin migraciones. Completa ADR-011 (el acceso lo decide el guard) y la separación en capas de la Fase M (casos de uso).

## Contexto

La Fase 3 del plan de pureza saca las consultas a la base de `src/core/`. Una consulta puede salir a `src/server/consultas/` solo si todos los que la usan pueden importar desde ahí, y hoy las reglas lo impiden para un caso frecuente: **la misma lectura la usan una pantalla y una escritura** (una Server Action, un caso de uso o su persistencia). Ejemplos reales: el selector de la carta del POS (lo lee la pantalla y lo revalida la acción al agregar un ítem), las dependencias para desactivar un producto, el estado de la receta propia. Las reglas vigentes dicen:

- `acciones-sin-ui`: `server/actions/` no importa `server/consultas/`.
- `persistencia-capa`: `server/persistencia/` no importa `server/consultas/`.
- `consultas-capa`: `server/consultas/` no importa acciones ni persistencia.
- `core-sin-capas-superiores`: `core/` no importa `server/`.

Sin un lugar legal, esas lecturas tendrían que quedarse en `core` (mezcladas con el cálculo) o duplicarse (dos implementaciones de la misma regla, que es lo que los guardianes de «un solo lugar» prohíben).

## Decisión

Una capa nueva, **`src/server/lecturas/<dominio>/`**, para lecturas que se comparten entre pantalla y escritura.

1. **Solo lectura.** Sin `create`, `update`, `delete`, SQL de escritura ni transacciones (lo vigila `consultas-solo-lectura-y-ui-sin-base.test.ts`, que ahora cubre también esta carpeta).
2. **Quién la importa:** `server/consultas/`, `server/persistencia/` y `server/actions/`. Nunca `core/` (sigue valiendo `core-sin-capas-superiores`) ni la UI de cliente.
3. **Qué importa:** `core/` (el cálculo puro y las fachadas) y librerías. No importa la UI, `server/actions/`, `server/consultas/` ni `server/persistencia/` (regla `lecturas-capa`): una lectura compartida no puede depender de quien la usa.
4. **Sin guarda propia**, igual que las consultas: la guarda la pone la pantalla o la acción que la llama, antes de leer.
5. **Misma firma y mismo nombre** que tenía la función en `core`, con `db: Db` como último parámetro, para que la mudanza solo cambie la ruta del import.
6. Para los dominios, `sin-internals-de-otro-dominio` también aplica a esta capa: importa el dominio por su fachada.

## Por qué no las alternativas

- **Aflojar `acciones-sin-ui` y `persistencia-capa`** para que importen `server/consultas`: es un cambio de una línea, pero mezcla «lectura para mostrar» con «lectura para decidir» y rompe la taxonomía de lecturas de la auditoría de pureza.
- **Esperar a la Fase 4** (escrituras solo desde casos de uso): no cambia nada hoy, y seis archivos de `core` con consultas se quedarían donde están.

## Consecuencias

- Ninguna regla existente se afloja; se suma una (`lecturas-capa`) y el analizador reconoce la capa (`server/lecturas`).
- La carta pública sigue su propio régimen (ADR-006 y ADR-007): sus lecturas no entran a esta capa sin una decisión aparte (decisión D-2, PR propio).
