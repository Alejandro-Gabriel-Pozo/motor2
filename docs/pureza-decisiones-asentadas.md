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
