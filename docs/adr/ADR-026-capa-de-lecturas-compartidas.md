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

## Aclaración (2026-10-08, rama `pureza-integracion`)

La UI **no** importa `server/lecturas`, ni con excepciones: las páginas, los layouts y los componentes piden sus datos a `server/consultas`. Cuando una pantalla necesita una lectura compartida, una consulta la compone o la envuelve (`cadenasDeGrupos`, `cargarCostosYMargenes`, `cargarSelectorCartaDeLaMesa`); lo que solo usan las pantallas vive directamente en `server/consultas` (la disponibilidad de un producto por sucursal). Lo vigila la regla `paginas-solo-consultas` de dependency-cruiser, con la lista de excepciones vacía. Decisión del dueño, 2026-10-08.

## Nota (2026-10-08, Hito 3, Fase II: las lecturas de decisión de gobierno)

Las **lecturas de decisión de gobierno** (las que miden, dentro de la transacción de una escritura de usuarios, roles o sucursales, a quien actúa, a quien se toca y el estado de las invariantes) viven en `server/lecturas/permisos/`: `src/server/lecturas/permisos/gobierno.ts` (invariantes), `src/server/lecturas/permisos/gestion-de-usuarios.ts` (techo de privilegio) y `src/server/lecturas/permisos/gerencia.ts` (gerencia). Salieron de `core/permisos` con el mismo nombre y firma (§5; `db` primero, como estaban en `core`), y en `core/permisos` quedaron las reglas, puras. Tres particularidades de esta carpeta:

- **`import "server-only"` obligatorio** (lo vigila `test/arquitectura/dependencias.test.ts`): a diferencia de otras lecturas compartidas, ningún script de Playwright las importa; solo los casos de uso de gobierno, la transacción de gobierno (`src/server/actions/con-gobierno.ts`) y el seed, que corre con `--conditions=react-server`.
- **No nombran la clave del rol**: los predicados de «administrador» son los filtros puros de `core/permisos/filtros.ts` (contrato C1 de O.35), y la regla de un rol que ya se leyó se le pregunta a `core/permisos`. Un caso de uso o una persistencia no lee la clave de un rol ni la escribe en un `select` o un `where` (contrato C4, regla 4 ampliada de `test/arquitectura/acceso-solo-por-el-guard.test.ts`): pide el rol con `SELECCION_DE_ROL_PARA_JERARQUIA` (C3) y se lo pasa entero a `core/permisos`.
- **Corren con el cliente que les pasan**, casi siempre la transacción serializable de la escritura (`tx`): leerlas afuera abriría la carrera que las invariantes cierran.

## Nota (2026-10-08, Hito 5: la capa del escritor de la auditoría, `src/server/auditoria/`)

El **escritor de la auditoría** (`registrarCambioAuditado`, el único punto que escribe `RegistroAuditoria`) ya no vive en `core/permisos/auditoria.ts`: salió con el mismo nombre, la misma firma y el mismo cuerpo a `src/server/auditoria/registrar-cambio-auditado.ts`. En `core/permisos/auditoria.ts` quedó lo puro (el catálogo de entidades auditables, el tipo `CambioAuditable`, las claves de acción renombradas, `descripcionParaMostrar` y `filaDeAuditoria`, que calcula la fila). No es una capa de lecturas, pero se asienta acá porque es la misma idea que este ADR: lo que toca la base sale de `core` a una carpeta de `server` con una regla que dice quién puede importarla.

- **La regla es `auditoria-capa`** (`.dependency-cruiser.cjs`, dos entradas con el mismo nombre; la lista cerrada de archivos la fija `test/arquitectura/server-auditoria.test.ts`). Hacia afuera: `server/auditoria/` no importa la UI, ni `lib/` (la base entra por parámetro, nunca `lib/db`), ni lo demás de `server/` (acciones, consultas, lecturas, persistencia, acceso, sesión, carta pública, adaptadores, operaciones de plataforma), ni Next, ni `core/auth`; solo depende de `core`. Hacia adentro: no la importan la UI, `lib/`, el proxy, el entorno, ni las consultas, las lecturas, la persistencia, el acceso, la carta pública ni los adaptadores.
- **La llama el caso de uso, nunca la persistencia** (tampoco una lectura): la auditoría se registra dentro de la transacción del cambio que audita y en el orden que fija la ficha del caso de uso. Un escritor llamado desde la persistencia escribiría una fila sin que el caso de uso lo supiera. Las otras entradas legítimas son las operaciones de plataforma (`src/server/operaciones-de-plataforma/cambiar-modulos-de-empresa.ts` y `src/server/operaciones-de-plataforma/cambiar-politica-de-empresa.ts`) y la sesión (`src/server/sesion/vincular-cuenta.ts`).
- **Sin `import "server-only"`, a propósito.** Lo cargan scripts que corren con `tsx` fuera de Next (`scripts/modulos-empresa.ts` y `scripts/politica-empresa.ts`, a través de las operaciones de plataforma), donde el paquete `server-only` tira al importarse; ponérselo obligaría a correrlos con `--conditions=react-server` y a editar `package.json`. No hace falta: recibe la base por parámetro y no lee sesión, cookies ni entorno, así que no hay nada de servidor que proteger de un componente de cliente. Es la misma excepción declarada que el lector de capacidades de `src/server/acceso/capacidades-sucursal.ts`; el test `test/arquitectura/server-auditoria.test.ts` exige la ausencia del import (y que la cabecera diga por qué).
- **Sin reloj, azar, entorno, red ni disco**, y escribe exactamente `registroAuditoria.create`. Una Server Action ya migrada a caso de uso tampoco puede importarlo (`accion-migrada-sin-orquestacion`): pasa por su caso de uso.
- En el registro de excepciones de escrituras fuera de persistencia (`test/arquitectura/escrituras-fuera-de-persistencia.ts`) figura con fase «Permanente»: es el escritor único del registro de auditoría.
