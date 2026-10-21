# Contratos compartidos declarados

Un **contrato** es una regla transversal con UNA fuente (un símbolo exportado, o la regla de CSS que dice cómo se hace algo) y muchos consumidores. El motor (`motor.ts`) exige que cada consumidor **declare de cuál depende** de una forma que una máquina verifica dentro del propio archivo, y falla cerrado: si un archivo usa lo que el contrato regula y no lo declara, el test se pone rojo. No hay líneas de base que solo cuentan: la deuda existente se escribe **uso por uso** dentro del contrato.

Corre dentro de `npm test` (`contratos.test.ts`, un solo recorrido del repo). Sus mutaciones están en `motor.test.ts`. El índice de contratos es `manifiesto.ts`.

## Cómo se declara que se depende (`declaracion`)

| Declaración | El consumidor… | Va con señales |
|---|---|---|
| `importar-ancla` | importa el ancla de la fuente (nombrado, con alias, por defecto, o `import * as ns` usando `ns.ancla`) | `ts` |
| `clase-companera` | lleva la clase compañera en la MISMA cadena de clases; en CSS, la nombra en el selector de la regla | `clases`, `css` |
| `nombre-definido-en-la-fuente` | usa un nombre (`var(--x)`) que la fuente define; un nombre definido que nadie usa también falla | `css/variable`, `ts/codigo` |

Un comentario del tipo «dependo de X» no declara nada. Una mención en un comentario o en un texto tampoco es un uso (los detectores `ts/codigo` miran el código sin comentarios ni interior de strings).

## Receta: declarar un contrato nuevo

1. **Elegí la fuente única.** Si no existe, creala primero, en su propio commit. Ponele un comentario con la marca `@contrato` seguida del id del contrato (exactamente UNA marca en todo el repo; en `.ts`, `.tsx` o `.css`) y que exporte el ancla (símbolo) o tenga la regla (selector).
2. **Escribí el contrato** (un objeto `Contrato`, completo: `tsc` no deja omitir nada) y agregalo a `manifiesto.ts`. Elegí `consumidores`: `"descubiertos"` (consumidor = archivo del alcance que declara; tiene que haber al menos uno) o una lista cerrada, que se revisa en las dos direcciones. Si no hay nada que detectar en un campo, escribilo a propósito (`definicion: []`).
3. **Agregá sus pruebas a `motor.test.ts`**: un caso rojo por cada detector (uso sin declarar, definición duplicada) y uno verde (un uso declarado, una mención en un comentario).
4. **Corré** `npx vitest run test/arquitectura/contratos`. Cada hallazgo que aparezca es un uso real: arreglalo (declaralo) o, si es legítimo, escribilo:
   - `excepciones: [{ archivo, fragmento, motivo, responsable, aprobacion, creada, renovaciones, vence }]` si es para siempre (motivo de 20 caracteres o más);
   - `deuda: [{ archivo, fragmento, motivo, resuelveEn, responsable, aprobacion, creada, renovaciones, vence }]` si se paga después: UNA entrada por cada uso real (dos usos iguales son dos entradas), con el motivo (20 caracteres o más) y dónde se resuelve (un paso, una fase). El reporte informa cuánta deuda hay.
   Las dos llevan gobierno, todo obligatorio: `responsable` (lista cerrada; hoy solo `"dueño"`), `aprobacion: { por, referencia }` con la referencia `PR #n`, `commit <sha>` o `DEC-nn`, `creada` (`AAAA-MM-DD`), `renovaciones` (`[]` si no hubo; cada una `{ fecha, motivo, aprobacion }`, con motivo de 20 caracteres o más y aprobación válida: no se renueva sin justificación) y `vence` (`AAAA-MM-DD`, rige hasta el final de ese día). El plazo se cuenta desde la última renovación (o desde `creada`) y los topes están en `politica.ts`: una excepción vence como mucho 365 días después y una deuda 60. Vencida, con responsable o aprobación inválidos, o más allá del tope: rojo. Avisos sin fallar: vence en 14 días o menos; una deuda con más de 2 renovaciones.
   El `fragmento` es el que imprime el reporte (la cadena de clases entera, o el texto que coincidió, con los espacios colapsados). Una entrada sin uso real (sobrante) o sin motivo falla.
5. **Demostrá una mutación roja sobre el repo real** (sacar la declaración de un consumidor), anotala en el mensaje del commit, revertila y corré el gate completo de AGENTS.md.

## Reporte

Una línea por hallazgo, ordenadas por archivo, línea y columna:

```
src/malo.ts:2:10  [redondeo-de-dinero · uso-sin-declarar]
  redondea a centavos con Math.round sin declarar el contrato → importá `redondearMoneda` de «src/core/moneda.ts»
  fuente: src/core/moneda.ts:2 · fragmento (para excepción o deuda): «Math.round(n * 100) / 100»
```

Tipos de hallazgo (cerrados): `uso-sin-declarar`, `definicion-duplicada`, `consumidor-fantasma`, `declaracion-sin-uso`, `fuente-ausente`, `marca-desconocida`, `marca-duplicada`, `excepcion-sobrante`, `excepcion-sin-motivo`, `deuda-sobrante`, `deuda-sin-motivo`, `excepcion-vencida`, `deuda-vencida`, `excepcion-sin-responsable`, `excepcion-sin-aprobacion` (también para la deuda), `horizonte-excedido`, `alcance-vacio`. La última línea del reporte resume: contratos, archivos leídos, deuda declarada (por contrato) y excepciones.

## Límites a conocer

- Un manifiesto mal armado (id repetido o no kebab-case, declaración incompatible con sus señales, sin señales, un `vence` que no es una fecha válida) **lanza un error**, no es un hallazgo.
- Las marcas se buscan en `.ts`, `.tsx` y `.css` de `src`, `plataforma`, `scripts`, `prisma` y `test`.
- `@/` se resuelve siempre a `src/`. Los nombres dinámicos (`--x-${rol}`) no se enumeran: para `nombre-definido-en-la-fuente` la fuente tiene que escribirlos.
- `hoy` se inyecta al motor; el guardián real usa `fechaUtcDeHoy()` (reloj UTC del sistema) y NO lee variables de entorno: no hay forma de mover la fecha desde afuera.
- Sin dependencias nuevas: el lector de CSS es propio y el de TypeScript es el AST de `typescript`.
