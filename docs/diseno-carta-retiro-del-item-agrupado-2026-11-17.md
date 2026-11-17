# Carta: retirar el ítem agrupado (etapas R2 a R5), niveles 1 a 10

> **Estado:** Fase 1, Frente 7 (CARTA), 2026-11-17. Solo documento; **no se escribió código ni migración**. Reemplaza el plan R1 a R5 de `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md` §6.5 (que suponía migrar datos del ítem agrupado a familias con una lista de pérdidas para el dueño): las respuestas del dueño de más abajo lo vuelven innecesario.
> **Decisiones del dueño que rigen (2026-11-17, literales):** «Sobre item agrupado se va una vez que entra familia» · «Solo el nombre, como Pedernal» · «no hay items agrupados o si hay, no me interesa» (no hace falta la lista de pérdidas ni mostrarle nada) · «no urge» (el hueco de carrera familia/ítem agrupado) · «quiero que construyas lo que falta, ya. ahora.» Fuentes: `motor2-docs`, rama `alegp/stoic-davinci-185dm4`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Carta como Pedernal: respuestas del Frente 7 (2026-11-17)», y el chat del dueño con el orquestador general (registrado en `motor2-docs` d335641).
> **Estados:** CONFIRMADA (dicha por el dueño) · PROPUESTA · PENDIENTE · NO VERIFICADO (†).

## Hallazgos que cambian el plan (verificados en el código real y en la base, solo lectura)

1. **Datos reales: no hay ítems agrupados.** Consulta solo de lectura (solo `SELECT`, 2026-11-17) a la rama `main` del proyecto Neon «motor2-multitenancy-fase-a»: 2 empresas, 1 sucursal, 0 productos, 0 platos de carta, **0 ítems agrupados, 0 opciones, 0 géneros**. No hay nada que migrar ni perder hoy. † Solo se miró esa base; antes de cada retiro real hay que contar de nuevo en la base de destino (la verificación previa de la migración lo hace y frena si hay filas, ver §6).
2. **El ítem agrupado ya está APAGADO en el código.** `GENERO_E_ITEM_AGRUPADO_VISIBLE = false` (`src/core/carta/genero-e-item-agrupado.ts:22`): la carta pública, el selector del POS y las lecturas que ubican productos en la carta **ignoran** la estructura (un producto que fuera opción sale suelto); no se borra nada. Es la «etapa R4» (ocultar, reversible) del plan anterior: **ya está hecha**. El mismo archivo dice que «el retiro definitivo es una etapa aparte que exige autorización expresa del dueño».
3. **Lo que queda es el retiro definitivo** (la «etapa R5»): borrar el código, las pantallas, los permisos y las dos tablas (`ItemAgrupadoCarta`, `OpcionItemAgrupadoCarta`), y sacar el invariante transitorio de la etapa F1 (los disparadores familia/ítem agrupado). Como no hay datos, **la «etapa R2» (migrar datos a familias) no tiene nada que hacer**: se descarta como etapa de datos y queda como una verificación previa que cuenta filas.
4. **Qué toca (inventario real, no de un documento):** 55 archivos de `src/` (más `prisma/schema.prisma` y un seed) nombran el ítem agrupado: 12 casos de uso de acciones de carta, 3 acciones, `src/server/lecturas/carta/*` (menú, orden de renglones, choque de nombre, componentes de promo), `src/server/consultas/carta/*`, `src/server/lecturas/pos/selector-carta.ts`, `src/core/pos/*`, `src/core/carta/*`, `src/core/features/carta/*`, pantallas `src/app/(app)/carta/agrupados` y el selector del POS, y 97 archivos de test. **Incluye código mío ya mergeado:** el renglón `ITEM_AGRUPADO` del orden por sección (O1) y el cruce de F1 (`productoEstaEnUnItemAgrupadoDeLaSucursal`, `PRODUCTO_YA_AGRUPADO`, `YA_EN_FAMILIA`).

## 1. Propósito y alcance

Que el ítem agrupado deje de existir en el producto y en la base, porque la familia lo reemplaza (CONFIRMADA). **Dentro del alcance:** código, pantallas, permiso `carta_items_agrupados`, las dos tablas y los disparadores de F1. **Fuera del alcance:** los **géneros** de carta (`GeneroCarta`, `ContenidoCartaProducto.generoCartaId`, permiso `carta_generos`): nadie pidió quitarlos y siguen siendo usados por el contenido de carta (ver la pregunta del §11). La familia, el portal, el orden y la identidad no se tocan.

## 2. Actores y contexto

El dueño decide y autoriza cada base; el gerente y el administrador dejan de ver «Ítems agrupados» en la carta; el mozo (POS) y el comensal no notan nada (ya no lo ven por el interruptor). El orquestador general ordena los turnos de las zonas restringidas; el Frente 6 (Pantallas) retira las pantallas que le pertenecen.

## 3. Casos de uso

Ninguno nuevo: es una **resta**. Se retiran los comandos de ítem agrupado (guardar, activar, agregar/quitar/ordenar opción) y el renglón `ITEM_AGRUPADO` del orden de renglones; no se agrega ninguna función.

## 4. Conceptos y ciclo de vida

El ítem agrupado pasa por: encendido (hasta ahora) → **apagado** (hoy, interruptor) → **retirado** (esta etapa: el código y las tablas desaparecen). No hay «archivo» de datos: no hay datos. Si una base futura los tuviera, se respalda antes (ver §6).

## 5. Invariantes y políticas

- **I1.** Retirar no puede cambiar lo que ven el comensal ni el mozo: ya no ven el ítem agrupado. Prueba: los goldens de la carta pública y del selector del POS salen **idénticos** (con interruptor apagado, que es el estado actual) antes y después.
- **I2.** El retiro destructivo (borrar las tablas) **no corre solo**: exige autorización del dueño por base y una verificación previa que cuenta filas (`CONFIRMADA`: «se aplica solo con autorización por base», orquestador, 2026-11-17).
- **I3.** El orden importa en la base: **primero** se quitan los disparadores de F1 sobre `MiembroDeFamilia` y `OpcionItemAgrupadoCarta` (el de `MiembroDeFamilia` consulta la tabla de opciones: si se borrara la tabla antes, **todo alta de miembro fallaría**), **después** se borran las tablas, en una sola transacción.
- **I4.** Las claves de permiso viejas (`carta_items_agrupados`) que ya estén guardadas en roles quedan huérfanas e inofensivas; la matriz deja de mostrarlas. Nada se borra de `PermisoRol` (historia).
- **I5.** Al sacar el disparador de exclusión desaparece también el hueco de carrera familia/ítem agrupado que el dueño aceptó («no urge»).

## 6. Historia y persistencia

**Una migración destructiva, una sola, con `verificacion-previa.sql` y `down.sql`** (bloque `20261117160000–169999`, timestamp posterior a F1, portal y los demás):
1. Verificación previa (en `verificacion-previa.sql`, a correr a mano antes): cuenta `ItemAgrupadoCarta`, `OpcionItemAgrupadoCarta` y lo que apunta a ellos; **si hay filas, no se aplica sin decisión del dueño** para esa base (con respaldo de Neon previo).
2. `DROP TRIGGER` de F1 en `MiembroDeFamilia` y en `OpcionItemAgrupadoCarta` + `DROP FUNCTION` de sus funciones; luego `DROP TABLE "OpcionItemAgrupadoCarta"`, `DROP TABLE "ItemAgrupadoCarta"` (una sentencia SQL por tabla), todo en una transacción.
3. `down.sql`: **recrea las dos tablas vacías** (estructura, índices, RLS y disparadores de F1); **los datos no se recuperan** (si existían, solo con el respaldo). Frena si se lo corre sobre una base donde las tablas ya existen.
4. Entrada en la lista del `m1`; nada se aplica a bases reales. Las únicas bases que hoy se tocarían (la de ensayo y las reales) las decide el dueño; el congelamiento de migraciones en bases reales sigue vigente.

**Cambios de esquema Prisma** (zona restringida: turno): quitar los dos modelos y sus relaciones inversas (`Empresa`, `Sucursal`, `Producto`, `SeccionCarta`, `GeneroCarta`).

## 7. Atomicidad y concurrencia

Es una migración transaccional (todo o nada). Con el código retirado no queda ningún camino que escriba ítems agrupados, así que desaparece la concurrencia familia/ítem agrupado. Orden de despliegue (compatibilidad hacia atrás): **primero el código** (sin leer ni escribir las tablas) y **después** la migración; si se invirtiera, el código viejo fallaría al leer tablas inexistentes.

## 8. Acceso e interfaces

Se retiran: las Server Actions de `items-agrupados.ts`, la clave `carta_items_agrupados` de `acciones.ts` (turno), las entradas de la matriz y del menú, las pantallas `src/app/(app)/carta/agrupados` y el bloque de ítems agrupados del selector del POS y de la ficha de carta (Frente 6). El contrato público `CartaPublicaV1` no cambia si el interruptor apagado ya no emite el ítem; † **verificar** si el contrato o sus goldens nombran el ítem agrupado (si sí, es zona restringida y turno).

## 9. Consultas y experiencia

Sin cambios para el comensal y el mozo. El gerente y el administrador dejan de ver «Ítems agrupados». Los reportes que mencionan ítems agrupados (`ventas-por-seccion`, `resumen-consolidado`, `rendimiento-recetas`) dejan de unirlos: † **verificar** que no cambian sus totales (con interruptor apagado ya los ignoran; si cambiaran, se frena y se pregunta).

## 10. Pruebas, migración y operación

- **Sin regresión (obligatoria):** los goldens de la carta pública, del portal y del selector del POS, y los combos de reportes, **idénticos** antes y después del retiro del código. Los tests que hoy prueban el ítem agrupado **se borran con el código** (no se «arreglan»); lo que prueban de la familia y del orden queda.
- **Migración:** subir/bajar/subir sobre una base de ensayo con las tablas **vacías** y otra con **filas** (la reversa y la verificación previa deben frenar o avisar según el caso, y `down.sql` recrea las tablas vacías); el disparador de `MiembroDeFamilia` fuera **antes** de las tablas (prueba: alta de miembro después de la migración funciona).
- **Combinaciones:** la única dimensión que cambia es «interruptor ítem agrupado»; con el retiro deja de existir, y el guardián `genero-e-item-agrupado-combinaciones` se reduce a lo de géneros (si los géneros quedan).
- **Operación:** se despliega el código primero; la migración se aplica por base con autorización y respaldo; ninguna base real se toca sin el OK del dueño.

## 11. Etapas y turnos

| Etapa | Qué | Datos reales | Condición |
|---|---|---|---|
| **X1 (código)** | Retirar casos de uso, acciones, lecturas, consultas, componentes, el renglón `ITEM_AGRUPADO` del orden (O1) y el cruce de F1 (`PRODUCTO_YA_AGRUPADO`/`YA_EN_FAMILIA`); borrar los tests del ítem agrupado; **sin tocar la base** (las tablas quedan, sin lectores) | No | Turnos: `acciones.ts` (clave), `.dependency-cruiser-excepciones.cjs` (acciones clasificadas), `knip.jsonc`/goldens/congeladas si cambian, textos T1 si el ítem agrupado figura; pantallas con el Frente 6 |
| **X2 (migración)** | La migración destructiva del §6 con su verificación previa y `down.sql` | Solo por base y con autorización | X1 desplegada; el dueño autoriza cada base |

**Turnos a pedir (después del portal y de F1):** (1) `schema.prisma` (quitar dos modelos) y lista `m1`; (2) `acciones.ts` y `.dependency-cruiser-excepciones.cjs`; (3) goldens o `caracterizaciones-congeladas` si los textos o contratos nombran el ítem agrupado; (4) coordinar con el Frente 6 el retiro de `src/app/(app)/carta/agrupados` y del bloque del POS.

**Pregunta abierta (UNA, para el orquestador/dueño, no urge):** ¿los **géneros** de carta se quedan? (PROPUESTA mía: se quedan; nadie pidió quitarlos, siguen en `ContenidoCartaProducto` y en el permiso `carta_generos`; Pedernal no tiene géneros y dice que la familia cubre esa necesidad, §12.10 de su especificación de migración.) Mientras no se responda, X1 deja los géneros intactos.

## 12. No verificado (†)

Si `CartaPublicaV1` o sus goldens nombran el ítem agrupado; si algún script (`scripts/seed-demo-carta-la-cuadra.ts` y otros) debe retirarse; si hay otra base real con datos distintos a la consultada; que los totales de los reportes no cambien al dejar de unir ítems agrupados.
