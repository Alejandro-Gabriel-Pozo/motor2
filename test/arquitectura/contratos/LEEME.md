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
4. **Corré** `npx vitest run test/arquitectura/contratos`. Cada hallazgo que aparezca es un uso real: arreglalo (declaralo) o, si es legítimo, escribilo. Primero decidí **qué es**:
   - `casosLegitimos: [{ archivo, fragmento, motivo }]` si el uso es legítimo **y permanente**: forma parte de lo que el contrato quiere decir (ver «Casos legítimos» más abajo). Es obligatorio en el contrato (`[]` si no hay);
   - `excepciones: [{ archivo, fragmento, motivo, responsable, aprobacion, creada, renovaciones, vence }]` si es un uso que el contrato deja pasar por un tiempo acotado (motivo de 20 caracteres o más; vence como mucho a los 60 días). Una excepción NUNCA es para siempre: si hay que renovarla una y otra vez, o es un caso legítimo o es deuda;
   - `deuda: [{ archivo, fragmento, motivo, resuelveEn, responsable, aprobacion, creada, renovaciones, vence }]` si se paga después: UNA entrada por cada uso real (dos usos iguales son dos entradas), con el motivo (20 caracteres o más) y dónde se resuelve (un paso, una fase). El reporte informa cuánta deuda hay.
   La excepción y la deuda llevan gobierno, todo obligatorio: `responsable` (lista cerrada; hoy solo `"dueño"`), `aprobacion: { por, referencia }` con la referencia `PR #n`, `commit <sha>` o `DEC-nn`, `creada` (`AAAA-MM-DD`), `renovaciones` (`[]` si no hubo; cada una `{ fecha, motivo, aprobacion }`, con motivo de 20 caracteres o más y aprobación válida: no se renueva sin justificación) y `vence` (`AAAA-MM-DD`, rige hasta el final de ese día). El plazo se cuenta desde la última renovación (o desde `creada`) y los topes están en `politica.ts`: toda excepción y toda deuda vencen como mucho 60 días después (decisión del dueño: «cualquier excepción requiere justificación y aprobación explícitas, responsable y fecha de vencimiento, con un máximo de 60 días»; las exclusiones de clasificación de `gobernanza/exclusiones.ts` también). Vencida, con responsable o aprobación inválidos, o más allá del tope: rojo. Avisos sin fallar: vence en 14 días o menos; una deuda con más de 2 renovaciones.
   El `fragmento` es el que imprime el reporte (la cadena de clases entera, o el texto que coincidió, con los espacios colapsados). Una entrada sin uso real (sobrante) o sin motivo falla, sea caso legítimo, excepción o deuda. Si un uso coincide con un caso legítimo, ése manda: una excepción o una deuda del mismo uso sobra.
5. **Demostrá una mutación roja sobre el repo real** (sacar la declaración de un consumidor), anotala en el mensaje del commit, revertila y corré el gate completo de AGENTS.md.

## Casos legítimos (parte de la definición del contrato) frente a excepción temporal

Un **caso legítimo** es un uso que el contrato nunca quiso vigilar: es parte de su definición, no una excusa. Ejemplo: el contrato `borde-propio-de-carta` vigila al elemento que dibuja un borde con ancho SIN color (un separador); el borde punteado de los puntitos de `FilasDeOpcion` es una línea guía y la flecha de página es un botón circular con su propio color. Seguirán siendo así dentro de un año: no hay nada que pagar ni que renovar, y por eso un caso legítimo **no tiene vencimiento, responsable ni aprobación** (los define quien define el contrato).

| | Caso legítimo (`casosLegitimos`) | Excepción (`excepciones`) | Deuda (`deuda`) |
|---|---|---|---|
| Qué es | un uso permanente que el contrato no regula | un uso que se deja pasar a propósito por un tiempo | un uso que está mal y se arregla después |
| Vencimiento | no | sí, 60 días como mucho | sí, 60 días como mucho |
| Gobierno | solo `motivo` (20 caracteres o más) | responsable, aprobación, `creada`, `renovaciones`, `vence` | lo mismo, más `resuelveEn` |

Mínimo, dentro del objeto `Contrato` (el campo es obligatorio; `[]` si no hay):

```ts
casosLegitimos: [
  {
    archivo: "src/components/carta-publica/seccion.tsx",
    fragmento: "min-w-3 flex-1 -translate-y-1 border-b-[1.5px] border-dotted",
    motivo: "los puntitos entre la opción y su precio son decoración, no un separador entre productos",
  },
],
```

El alcance es **archivo + fragmento exacto** (los espacios colapsados): el mismo texto en OTRO archivo sigue en rojo; cubre todos los usos de ese archivo con ese fragmento. Se revisa en las dos direcciones: sin uso real, `caso-legitimo-sobrante`; sin motivo de 20 caracteres o más, `caso-legitimo-sin-motivo`. Antes de poner uno, preguntate si el uso es de verdad permanente: si lo único que cambia es el apuro, es deuda; si es un permiso temporal, es una excepción.

## Reporte

Una línea por hallazgo, ordenadas por archivo, línea y columna:

```
src/malo.ts:2:10  [redondeo-de-dinero · uso-sin-declarar]
  redondea a centavos con Math.round sin declarar el contrato → importá `redondearMoneda` de «src/core/moneda.ts»
  fuente: src/core/moneda.ts:2 · fragmento (para excepción o deuda): «Math.round(n * 100) / 100»
```

Tipos de hallazgo (cerrados): `uso-sin-declarar`, `definicion-duplicada`, `consumidor-fantasma`, `declaracion-sin-uso`, `fuente-ausente`, `marca-desconocida`, `marca-duplicada`, `caso-legitimo-sobrante`, `caso-legitimo-sin-motivo`, `excepcion-sobrante`, `excepcion-sin-motivo`, `deuda-sobrante`, `deuda-sin-motivo`, `excepcion-vencida`, `deuda-vencida`, `excepcion-sin-responsable`, `excepcion-sin-aprobacion` (también para la deuda), `horizonte-excedido`, `alcance-vacio`. La última línea del reporte resume: contratos, archivos leídos, deuda declarada (por contrato), excepciones y casos legítimos (cantidad por contrato: así no crecen en silencio).

## Límites a conocer

- Un caso legítimo no vence y NO lleva aprobación propia: ampliar o agregar uno es editar el archivo del contrato (`contratos/<id>.ts`), y hoy nada más lo frena que la revisión del cambio. Límite conocido: cuando el mecanismo guarde un hash aprobado de la definición de cada contrato, agregar o cambiar un caso legítimo (parte de esa definición) exigirá la aprobación que hoy no exige; mientras tanto el reporte cuenta los casos por contrato para que no crezcan en silencio.
- Un manifiesto mal armado (id repetido o no kebab-case, declaración incompatible con sus señales, sin señales, un `vence` que no es una fecha válida) **lanza un error**, no es un hallazgo.
- Las marcas se buscan en `.ts`, `.tsx` y `.css` de `src`, `plataforma`, `scripts`, `prisma` y `test`.
- `@/` se resuelve siempre a `src/`. Los nombres dinámicos (`--x-${rol}`) no se enumeran: para `nombre-definido-en-la-fuente` la fuente tiene que escribirlos.
- `hoy` se inyecta al motor; el guardián real usa `fechaUtcDeHoy()` (reloj UTC del sistema) y NO lee variables de entorno: no hay forma de mover la fecha desde afuera.
- Sin dependencias nuevas: el lector de CSS es propio y el de TypeScript es el AST de `typescript`.
