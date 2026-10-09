# Decisiones y registros de la pureza que no estaban escritos (asentados el 2026-10-07)

> Reúne lo que la auditoría independiente de las Fases 0 a 3 encontró «hecho pero no asentado»: decisiones que se tomaron y no quedaron en un documento, y un plan que nunca se escribió.
> Lo que sigue pendiente de decidir está en `docs/pureza-integracion.md`, sección 4. Las decisiones del dueño del 2026-10-07 están en `para motor 2\_planes\_decisiones-del-dueno-2026-10-07.md`.

## 1. La Fase 1, escrita retroactivamente (sub-pasos 1.1 a 1.6)

**No existió un plan detallado de la Fase 1**: los sub-pasos solo vivían en los mensajes de los PR (#67, #70, #71) y en `docs/plan-de-pureza-y-estado.md`. Se escribe acá, con lo que cada uno hizo de verdad y lo que quedó pendiente (la auditoría de la Fase 1 y su corrección están en `docs/plan-fase-4-pureza.md`, sección 11, y en los trabajos 1.4 a 1.7 de `docs/pureza-integracion.md`).

| Paso | Qué pedía | Qué entregó (PR) | Qué quedó pendiente y dónde se cierra |
|---|---|---|---|
| **1.1** Dinero | `decimal.js` propio detrás de `core/moneda` (decisión 1 del dueño, 2026-10-06) | #67: `decimal.js` 10.5.0 fijado a la versión que Prisma trae por dentro; `moneda.ts` pasa a P0; prueba de equivalencia con Prisma sobre miles de entradas, con mutación. #71 corrigió que la consola no lo declaraba (rompía su despliegue en Vercel) y agregó el test de dependencias de la consola | Ningún objeto `Decimal` sale de `core/moneda`: **el dinero dentro de `core` sigue siendo `number`** (las sumas de `core/reportes` son de coma flotante). Es una decisión del dueño pendiente: dejarlo escrito como diseño o abrir un paso (`docs/pureza-integracion.md`, sección 4, decisión 4) |
| **1.2** Reloj en los casos de uso | Ningún caso de uso lee la hora: entra como `actor.ahora` | #70: los 13 casos de uso la reciben; la regla de la ficha es absoluta; 3 tests con hora fija | Faltaban 10 de los 13 tests con hora fija (trabajo 2.1) |
| **1.3** Reloj en `core` | La hora entra por parámetro | #70: `conPermiso` la fija una vez por pedido (`ContextoDeAccion`); temas, fechas, rangos, guards y resúmenes | `core/auth/{acceso,invitacion}.ts` siguen leyéndola (heredados de las Fases 4 y 6, B3 saca la de `invitacion.ts`); consultas y lecturas con reloj propio (trabajos D.3/O.22) |
| **1.4** Correo | El correo no lee el entorno | #70: `enviar.ts` ya no lee `process.env`; lo arma `src/lib/enviar-correo.ts` | El cliente HTTP de Resend seguía en `core` (`fetchFn = fetch`): **salió a `src/lib/correo/resend.ts` en el trabajo 1.6** |
| **1.5** Azar | El azar entra por un puerto | #70: `FuenteDeAzar` y su adaptador `lib/azar.ts`; 7 funciones inyectadas | `reintentar.ts` conservaba `Math.random` como valor por defecto: **inyectado desde el borde en el trabajo 1.5** (la transacción trae su fuente) |
| **1.6** Errores de la base | Reconocerlos por forma, sin importar el ORM | #70: `core/datos/errores-de-base.ts`, puro | Tres sitios fuera de `core` seguían con `instanceof Prisma…` (dos perdían la rama de idempotencia I3): **corregidos en el trabajo 1.7** |

## 2. Un tipo `FichaCasoDeUso` fue reemplazado por la línea `@ficha` (decisión de diseño sin registrar)

La auditoría (§12, paso 0.6) pedía un tipo `FichaCasoDeUso` en `core` con un valor `FICHA_PENDIENTE`. El PR #66 lo reemplazó por una **línea `@ficha` en el docstring de cada caso de uso**, de vocabulario cerrado y verificada contra el código por un test (`test/arquitectura/ficha-de-caso-de-uso.test.ts`). Razón: el tipo en `core` no podía observar lo que el archivo hace (transacción, auditoría, reloj, permiso de la Server Action que lo envuelve); la línea sí, por AST. **Queda asentado como decisión de diseño**: la ficha es la línea `@ficha`; no hay tipo en `core`. El campo `periodo` (para el cierre de períodos de la Etapa A) se agregó a la ficha el 2026-10-08 por decisión del dueño (decisión 5): `periodo=NO_APLICA` hoy en todas las fichas y `VERIFICA_CIERRE` para el caso de uso que llame a `verificarPeriodoAbierto`, la función de `core/periodos` que trae la Etapa A.

## 3. El punto de control de la Fase 2

El plan decía «punto de control con el dueño al terminar la Fase 2». **No consta que se haya hecho como una revisión explícita de lo entregado por el PR #72**: se pasó directamente a decidir la Fase 3 (decisiones del 2026-10-06, `docs/plan-fase-3-pureza.md` §2). Queda asentado que el punto de control **no se hizo en su momento** y que su equivalente es la auditoría independiente de las Fases 0 a 3 del 2026-10-07 (`docs/plan-fase-4-pureza.md`, sección 11), cuyos hallazgos de la Fase 2 se corrigen en esta rama (trabajos 1.8, 1.9, 1.12, O.26, O.27, O.29).

## 4. Vocabulario de los guardianes de la Fase 0, paso 0.5

La auditoría pedía reglas de dependency-cruiser llamadas `core-sin-prisma` y `core-sin-db-tipos`. No existen con esos nombres: la cobertura la da el test AST `test/arquitectura/pureza-del-nucleo.test.ts` (más estricto: por archivo, y `Db` cuenta como tipo de Prisma). Queda asentado que **la regla es el test, no una regla de dependency-cruiser**.

## 5. El dinero dentro de `core` es `number` por diseño (decisión del dueño, 2026-10-08)

La decisión «dinero con `decimal.js`» (2026-10-06) se cumplió como **`decimal.js` detrás de `core/moneda`**: ningún objeto `Decimal` sale de ese módulo y el resto de `core` trabaja con `number`. El dueño decidió el 2026-10-08 **dejarlo escrito como diseño y medir**: la plata exacta vive en la base (columnas `Decimal`, el Kardex) y en `core/moneda` (multiplicar, repartir y redondear con `decimal.js`); `core/reportes` suma en `number` y redondea al presentar. No se migra por adelantado: una prueba de propiedades (trabajo 2.8 de `docs/pureza-integracion.md`) compara los reportes contra el cálculo exacto, y **solo si muestra diferencias de centavos** se abre el paso de migración a `Decimal`.

**Medición (2026-10-08, trabajo 2.8):** `test/core/reportes-dinero-medicion.test.ts` compara compras y ventas del período contra el cálculo exacto. Con importes en centavos (lo que guarda la base) la suma en `number` redondeada es IGUAL a la exacta. Solo en las ventas ESTIMADAS (líneas viejas sin precio guardado: cantidad × precio vigente sin redondear por línea) 7 de 20.000 totales difieren por un centavo. Arreglo APLICADO por decisión del dueño (2026-10-08): `calcularVentasDelPeriodo` redondea cada línea estimada con `importeDeLinea` antes de sumar. No hace falta migrar los reportes a Decimal.

## 6. El PV que se produce reparte entre lotes (O.40 (1), 2026-10-08)

`elegirSeccionDeStockPropio` (`core/movimientos/origen-venta.ts`) tenía la «simplificación» de mandar todo el pedido al lote que vence antes, aunque no alcanzara: lo dejaba en negativo con stock en otro lote. Se resolvió como los ingredientes (`asignarConsumo`): FEFO por lote dentro de la sección (el «sin lote» al final), tomando de cada lote lo que tiene; lo que ningún lote cubre queda en el último lote tomado. Diferencia con los ingredientes: la fila VENTA lleva precio, así que con más de un lote se parte en UNA FILA POR LOTE y el importe se reparte con `repartirImporte` por cantidad (la suma es exactamente el importe de la línea). El total vendido no cambia; la anulación revierte cada fila. No cambia el reparto entre SECCIONES (sigue sin repartir) ni la validación del stock propio (H4, pendiente).

## 7. El descuento de cliente alcanza a los componentes de una promo (O.40 (2))

No es un error: es D2 de `docs/plan-promo-combo-2026-09-26.md` (el descuento por cliente se suma sobre el precio ya prorrateado de cada componente). Lo fija la escena D1 de `venta-matriz-ampliada`.

## 8. El escritor de la auditoría vive en `server/auditoria/`, entrada «Permanente», sin `server-only` (Hito 5, pieza 5.4, B3 y B5; 2026-10-08)

`registrarCambioAuditado`, el único punto que escribe `RegistroAuditoria`, salió de `core/permisos/auditoria.ts` a `src/server/auditoria/registrar-cambio-auditado.ts` (mismo nombre, firma y cuerpo; `5dcfb088`). En `core` quedó lo puro, incluida `filaDeAuditoria` (el cálculo de la fila, `142b04b2`). La capa la fija la regla `auditoria-capa` de `.dependency-cruiser.cjs` y la lista cerrada de `test/arquitectura/server-auditoria.test.ts` (`17587f6b`); el detalle está en la nota de ADR-026.

- **«Permanente» en `escrituras-fuera-de-persistencia`.** El escritor de la auditoría escribe una tabla fuera de `server/persistencia` a propósito: lo llama el caso de uso dentro de la transacción del cambio que audita (y las operaciones de plataforma y la sesión), nunca la persistencia. No es una deuda de ninguna fase: queda con fase «Permanente» y el motivo escrito. Al mudarlo, la clave de la lista se reemplazó (no se sumó), así que `TOPE_DE_ENTRADAS` no cambió por esto.
- **Sin `import "server-only"`.** Lo cargan dos scripts que corren con `tsx` fuera de Next (`scripts/modulos-empresa.ts` y `scripts/politica-empresa.ts`, a través de las operaciones de plataforma), donde ese paquete tira al importarse. Ponérselo obligaba a correrlos con `--conditions=react-server` y a editar `package.json`. Se verificó en la mudanza: con el `import` puesto, el primer script revienta; sin él, los dos terminan con «Faltan --slug y --actor…». No hace falta protegerlo: recibe la base por parámetro y no lee sesión, cookies ni entorno. Un test (`server-auditoria`) exige que NO lo tenga y que su cabecera diga por qué.

## 9. `core-sin-consultas` mira todo `core`; quedan 4 pendientes de la Fase 6 (Hito 5, 5.4-B6, `60c96804`)

Hasta esta rama la regla «`core` no consulta la base» se activaba por carpeta (14 carpetas en la apertura de la rama, 16 antes de B6). Ahora `test/arquitectura/core-sin-consultas.test.ts` recorre TODO `src/core/` (incluidos los archivos sueltos `excel.ts`, `moneda.ts`, `numero.ts`, `resultado-caso.ts` y `texto.ts`). La única excepción es `ARCHIVOS_PENDIENTES`, con su motivo, verificada en las dos direcciones, y con un chequeo cruzado: cada pendiente tiene que figurar en `PUREZA_HEREDADA_DEL_NUCLEO` con un `pendiente` que empiece con «Fase 6» (así un resto de la Fase 4 no se esconde acá). Los 4 pendientes:

- `core/auth/base.ts`, `core/auth/contexto.ts` y `core/auth/rol-de-ejecucion.ts`: la sesión y la base por empresa; la Fase 6 los muda juntos a `server/sesion`, sin tocar su código.
- `core/fiscal/factura-autorizada.ts`: recibe `Db` y la usa la consola de plataforma, que no puede importar `src/server`; queda para la Fase 6.

Si el test marca un archivo que no está en la lista, NO se agrega a pendientes: se frena y se informa. Límite conocido: el detector no ve el tipo de la base escrito como `import("…").Db`.

## 10. El Kardex queda con 3 escritores (O.13) y el `EXPLAIN` de sus índices (Hito 5, 5.4-A; 2026-10-08)

Las escrituras de líneas del Kardex (`movimientoStock.create*`) pasaron de 5 funciones a 3, que es la condición para que la Fase 5 [MIG] tenga UN solo escritor por cada forma de escribir (y `SaldoStock`, después, uno solo): `escribirLineasDeMovimientoStock` (el motor genérico y la venta), `escribirContraAsiento` (las dos anulaciones, `a6f4ae6a`) y `escribirMovimientoDeTraspaso` (las dos escrituras de traspasos, `96ecd0c8`). Las dos mudanzas se apoyan en una huella de las escrituras (`4af23e8b`, congelada en `159cca95`) que registra la presencia o ausencia de cada clave (la anulación de venta NO manda `claveIdempotencia`; la de compra la manda siempre, con `null` si no hay). La lista es cerrada: `ESCRITORES_DEL_KARDEX` en `test/arquitectura/kardex-solo-agrega.test.ts` (`c2af2cdd`), en las dos direcciones.

El `EXPLAIN` (sin `ANALYZE`) de las dos lecturas que la Fase 5 tocaría —`seccionesConStock` y la deuda de redondeo— es un test versionado (`test/persistencia/kardex-indices-de-saldo.test.ts`, `bd5670ab` y `a81c7107`): ambas usan `MovimientoStock_productoId_seccionId_loteVencimiento_idx` solo por `productoId`. **Desvío del «solo lectura» del plan, declarado:** con la tabla vacía el planner no elige ese índice ni con el escaneo secuencial apagado (el predicado de RLS le hace creer que el índice por `empresaId` ya deja una fila), así que el test SIEMBRA ~24.000 líneas de Kardex por SQL en la base LOCAL de tests y corre el `ANALYZE` antes de mirar el plan. Escribe, pero solo en la base de pruebas (nunca contra producción). La medición con volumen real y el índice `(seccionId, productoId)` quedan para la simulación de la Fase 5.

## 11. El lector de capacidades en `server/acceso` sin `server-only`; el precio local en `server/lecturas/catalogo` (Hito 5, 5.2; 2026-10-08)

Autorizado por el dueño el 2026-10-07 (4A-5). `sucursalTieneCapacidad` y `capacidadesDeSucursal` salieron de `core/permisos` a `src/server/acceso/capacidades-sucursal.ts` (`6eed7686`); en `core` quedaron las dos reglas puras. **Sin `server-only`, por excepción declarada:** la carta pública llega hasta ese archivo y a la carta la cargan fixtures de Playwright y un script `tsx`, donde el paquete tira. La excepción está en `SIN_SERVER_ONLY` de `test/arquitectura/server-acceso-lista-cerrada.test.ts` (verificada en las dos direcciones) y como excepción permanente `esperados: 2` en `test/arquitectura/acceso-solo-por-el-guard.test.ts` (regla 3, igual que `modulos-de-empresa.ts`). El **precio local** (`precioLocalActivoEn`, `preciosLocalesVigentes`) fue a `src/server/lecturas/catalogo/precio-local.ts` (`96346787`), no a `server/acceso`: es lectura compartida entre pantalla y escritura (ADR-026) y así la carta alcanza un solo archivo de `acceso`. También sin `server-only` (entrada propia de `SIN_SERVER_ONLY` de consultas y lecturas). `ALCANCE_CARTA_PUBLICA` suma exactamente esos dos archivos (de 4 a 6 entradas) y un guardián nuevo calcula lo que la carta alcanza y exige que sea EXACTAMENTE esa lista (`4370da2f`). `resolverPrecioVenta` salió aparte a `server/lecturas/movimientos/precio-venta.ts` (con `server-only`; la carta no lo alcanza).

## 12. `con-reintento` se parte (Hito 5, 5.3-1, `240d29a1`)

Los clasificadores de errores (`esConflictoDeEscritura`, `esChoqueDeIndiceUnico`) quedan en `core/movimientos/con-reintento.ts`, ahora puros (sin Prisma ni `lib`). `conTransaccionSerializable`, que abre la transacción y escribe en la consola, salió a `src/lib/transaccion-serializable.ts` (como `lib/correo`, `lib/azar` y `lib/db-tipos`), sin `server-only` (la cargan tests y scripts). Descartado: dejarlo en `core` con otro nombre (esquiva la regla que cierra ese hueco) y llevar todo a `lib` (amplía lo que alcanza la consola, que importa `esChoqueDeIndiceUnico` por la fachada de `core/movimientos`). La regla `accion-migrada-sin-orquestacion` suma `src/lib/transaccion-serializable.ts` para que una acción ya migrada no lo esquive. La pureza total de `core/movimientos` (5 archivos que todavía importan tipos de Prisma) queda para la Fase 6.

## 13. Los commits que no pasan el gate solos, y por qué NO se aplastan (cierre de la rama)

La regla de la rama es «un commit, un cambio, verde por sí solo». Seis commits no la cumplen; todos se arreglaron en un commit posterior de la misma rama (no se enmendaron: ya estaban referenciados como evidencia):

| Commit | Qué deja mal | Lo arregla |
|---|---|---|
| `fdd0d146` (B3-7) | no compila: quedó solo con el `git mv`; el contenido no entró | `d1530499` (B3-7b), el commit que le sigue |
| `e1925c89` (O35-1) | `tsc` en rojo (el propio test usa `p.name` sin estrechar el tipo; vitest no tipa y por eso corría verde) | `f40f32fe` (O35-1b) |
| `1cb0fb14` (H8-7) | `knip` en rojo (un export sin uso: `requerirSesionEnSucursal`); compila y los tests pasan | `21eb933f` (H8-7b) |
| `4af23e8b` (A2) y `159cca95` (A3) | `test/arquitectura` en rojo (`fechas-fijas-en-tests-con-base` no declaraba la fecha de lote de la huella del Kardex) | `3f3f0f48` (A3b) |
| `bd5670ab` (A7) | `test/arquitectura` en rojo (`sin-empresa-por-defecto` admite el preset de empresa solo en `test/setup/empresa-de-prueba.ts`) | `a81c7107` (A7b) |

**Decisión:** no se aplastan ni se reescriben. Reescribir la historia (309 commits al empezar este bloque) invalidaría todos los hashes que las filas de `docs/pureza-integracion.md` citan como evidencia, y la fusión es con merge commit justamente para conservar la reversión paso a paso. **Indicación:** al usar `git bisect` en esta rama, saltar esos seis con `git bisect skip fdd0d146 e1925c89 1cb0fb14 4af23e8b 159cca95 bd5670ab`. Límite de lo verificado: la lista sale de los mensajes de los commits que se auto-corrigen; no se corrió el gate completo en cada uno de los 309 commits.

## 14. Las 8 acciones de configuración de carta se migraron en la rama, y una revalidación cambió de momento (Hito 5, bloque D; 2026-10-08)

Eran resto de la Fase 4 (que es el alcance de la rama) y seguían marcadas «Fase 4» en `escrituras-fuera-de-persistencia`: `contenido-producto`, `copiar-carta`, `generos`, `items-agrupados`, `portal-empresa`, `registro-publico`, `secciones` y `tema` (19 funciones). **El dueño decidió el 2026-10-08 migrarlas ahora**, con el molde del Hito 4 (red de caracterización antes, un archivo por commit); el detalle y los hashes están en la fila 5.4-D de `docs/pureza-integracion.md`. Resultado: `TOPE_DE_ENTRADAS` 21 → 13 y 0 entradas «Fase 4».

Un matiz que cambia de comportamiento sin cambiar el resultado para el usuario: **`copiarCartaDeSucursal` ahora revalida la carta pública en la Server Action, DESPUÉS de confirmar la transacción y UNA sola vez.** Antes lo hacía adentro del callback serializable, antes de confirmar, y una vez por intento (si la transacción se reintentaba, invalidaba la caché varias veces, y la primera podía correr antes de que los datos nuevos estuvieran confirmados). Es el mismo criterio que `fijarRendimientoLocal` (H4C-5) y lo fija la red `copiar-carta-mensajes`. Otro matiz de forma: el alta de un ítem agrupado con productos recibe un tercer parámetro `avisos` para conservar la cuenta de invalidaciones sin importar Next en el caso de uso.

## 15. Hueco anterior que la pieza 5.2 NO arregló y se arregló después: O.47 (filtro de empresa en la fila «por defecto» de capacidades)

> **Actualización (2026-10-08): arreglado en `b44d4682`**, a pedido del dueño, que al pedir cerrar todas las reservas de la auditoría del Hito 5 aprobó este cambio. Misma consulta (un filtro de relación dentro del mismo `where`), con test propio y mutación; la matriz de acceso y `ALCANCE_CARTA_PUBLICA` no cambian. El texto de abajo es el de antes, como historia.

`sucursalTieneCapacidad` y `capacidadesDeSucursal` leen la fila «por defecto» de `CapacidadSucursal` (`sucursalId: null`) sin filtrar por empresa. Con RLS no se cruzan empresas; con un cliente que se saltea RLS sí (el mismo hueco que S-11 cerró para el menú). Es anterior a la rama y se hizo explícito al planificar la pieza 5.2, que debía ser mudanza pura: arreglarlo cambia el SQL que comparten el gate de acceso y la carta pública. Queda como fila `[ ]` (O.47) de `docs/pureza-integracion.md`, con propuesta, aprobación del dueño y commit propio.
