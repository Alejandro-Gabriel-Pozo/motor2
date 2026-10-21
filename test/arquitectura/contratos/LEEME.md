# Contratos compartidos declarados

Un **contrato** es una regla transversal con UNA fuente (un símbolo exportado, o la regla de CSS que dice cómo se hace algo) y muchos consumidores. El motor (`motor.ts`) exige que cada consumidor **declare de cuál depende** de una forma que una máquina verifica dentro del propio archivo, y falla cerrado: si un archivo usa lo que el contrato regula y no lo declara, el test se pone rojo. No hay líneas de base que solo cuentan: la deuda existente se escribe **uso por uso** dentro del contrato.

Corre dentro de `npm test` (`contratos.test.ts`, un solo recorrido del repo). Sus pruebas con árboles chicos están en `motor.test.ts`; la prueba de que el guardián protege los contratos REALES (rompe cada cosa que un invariante necesita y exige el hallazgo) está en `mutaciones-de-contratos.test.ts` (ver «Matriz de invariantes y mutaciones»). El índice de contratos es `manifiesto.ts`.

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
3. **Agregá sus pruebas a `motor.test.ts`**: un caso rojo por cada detector (uso sin declarar, definición duplicada) y uno verde (un uso declarado, una mención en un comentario). Y agregá su entrada en `EJEMPLOS_DE_CONTRATOS` de `mutaciones/matriz.ts` (un archivo de ejemplo con un uso crudo y otro con una redefinición, o `null` si no hay): sin ella el meta-test del arnés falla («actualizá la matriz»). El resto de la matriz del contrato se deriva sola.
4. **Corré** `npx vitest run test/arquitectura/contratos`. Cada hallazgo que aparezca es un uso real: arreglalo (declaralo) o, si es legítimo, escribilo. Primero decidí **qué es**:
   - `casosLegitimos: [{ archivo, fragmento, motivo }]` si el uso es legítimo **y permanente**: forma parte de lo que el contrato quiere decir (ver «Casos legítimos» más abajo). Es obligatorio en el contrato (`[]` si no hay);
   - `excepciones: [{ archivo, fragmento, motivo, responsable, aprobacion, creada, renovaciones, vence }]` si es un uso que el contrato deja pasar por un tiempo acotado (motivo de 20 caracteres o más; vence como mucho a los 60 días). Una excepción NUNCA es para siempre: si hay que renovarla una y otra vez, o es un caso legítimo o es deuda;
   - `deuda: [{ archivo, fragmento, motivo, resuelveEn, responsable, aprobacion, creada, renovaciones, vence }]` si se paga después: UNA entrada por cada uso real (dos usos iguales son dos entradas), con el motivo (20 caracteres o más) y dónde se resuelve (un paso, una fase). El reporte informa cuánta deuda hay.
   La excepción y la deuda llevan gobierno, todo obligatorio: `responsable` (lista cerrada; hoy solo `"dueño"`), `aprobacion: { por, referencia }` con la referencia `PR #n`, `commit <sha>` o `DEC-nn`, `creada` (`AAAA-MM-DD`), `renovaciones` (`[]` si no hubo; cada una `{ fecha, motivo, aprobacion }`, con motivo de 20 caracteres o más y aprobación válida: no se renueva sin justificación) y `vence` (`AAAA-MM-DD`, rige hasta el final de ese día). El plazo se cuenta desde la última renovación (o desde `creada`) y los topes están en `politica.ts`: toda excepción y toda deuda vencen como mucho 60 días después (decisión del dueño: «cualquier excepción requiere justificación y aprobación explícitas, responsable y fecha de vencimiento, con un máximo de 60 días»; las exclusiones de clasificación de `gobernanza/exclusiones.ts` también). Vencida, con responsable o aprobación inválidos, o más allá del tope: rojo. Avisos sin fallar: vence en 14 días o menos; una deuda con más de 2 renovaciones.
   El `fragmento` es el que imprime el reporte (la cadena de clases entera, o el texto que coincidió, con los espacios colapsados). Una entrada sin uso real (sobrante) o sin motivo falla, sea caso legítimo, excepción o deuda. Si un uso coincide con un caso legítimo, ése manda: una excepción o una deuda del mismo uso sobra.
5. **Corré el arnés** (`npx vitest run test/arquitectura/contratos/mutaciones-de-contratos.test.ts`): rompe cada cosa que el contrato necesita (el ancla, la marca, la declaración de un consumidor…) y exige el hallazgo con archivo y línea reales; si algo sobrevive, dice cuál. Después corré el gate completo de AGENTS.md.

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

`fuente-ausente` apunta a una línea REAL: si falta la marca, a la línea del ancla; si falta el ancla, a la de la marca; si falta todo (o el archivo), a 1:1 y el mensaje dice dónde está DEFINIDO el contrato (`contratos/<id>.ts:línea`) y qué corregir.

Tipos de hallazgo (cerrados; la lista está en `TIPOS_DE_HALLAZGO` de `tipos.ts`): `uso-sin-declarar`, `definicion-duplicada`, `consumidor-fantasma`, `declaracion-sin-uso`, `fuente-ausente`, `marca-desconocida`, `marca-duplicada`, `caso-legitimo-sobrante`, `caso-legitimo-sin-motivo`, `excepcion-sobrante`, `excepcion-sin-motivo`, `deuda-sobrante`, `deuda-sin-motivo`, `excepcion-vencida`, `deuda-vencida`, `excepcion-sin-responsable`, `excepcion-sin-aprobacion` (también para la deuda), `horizonte-excedido`, `alcance-vacio`. La última línea del reporte resume: contratos, archivos leídos, deuda declarada (por contrato), excepciones y casos legítimos (cantidad por contrato: así no crecen en silencio).

## Áreas (paso G3)

El motor mira ARCHIVOS; las **áreas** miran CARPETAS. Cada área (una carpeta de primer o segundo nivel: `components/carta-publica`, `core/stock`, `server/acceso`, `scripts/operaciones`…) dice en `AREAS` de `gobernanza/areas.ts` de qué contratos del manifiesto depende, o `[]` si no depende de ninguno. El campo es obligatorio para toda área de un tipo de ruta que declara (`POLITICA_DE_TIPOS`: frontend, trabajo programado, núcleo, servidor, consola y scripts; las pruebas, la documentación, la configuración, los activos, el CI, los agentes, el esquema, las migraciones y los generados no declaran, cada uno con su motivo). Las áreas se DERIVAN de la clasificación de rutas (`gobernanza/clasificacion.ts`, paso G2: cada archivo del repo cae en una regla o es un hallazgo) y se comparan con los usos reales de cada contrato (`gobernanza/usos.ts`):

| Hallazgo | Cuándo |
|---|---|
| `area-sin-declaracion` | aparece un área que no figura en `AREAS` (código nuevo en una carpeta nueva). El mensaje trae la línea exacta para pegar |
| `area-fantasma` | una entrada de `AREAS` sin ningún archivo clasificado (la carpeta se renombró o se borró) |
| `dependencia-omitida` | el área usa un contrato (algún archivo lo declara o tiene lo que regula) y no lo declara. Apunta al primer archivo que lo usa |
| `dependencia-falsa` | el área declara un contrato que nada del área usa, que no existe en el manifiesto o que repite. **Bloquea**: una etiqueta sin uso real no declara nada |
| `area-sin-clasificar` | un archivo de un tipo que declara no cae en ninguna área |

El área que contiene la FUENTE de un contrato queda eximida de declararlo. Un id de contrato nuevo se agrega a `IDS_DE_CONTRATO` (el tipo `IdDeContrato` rechaza cualquier otro). Esto complementa al motor, no lo reemplaza: el uso sin declaración por archivo sigue siendo `uso-sin-declarar` aunque el área lo declare. Sus pruebas con árboles temporales y con una copia exacta del repo están en `gobernanza/areas.test.ts` y `gobernanza/clasificacion.test.ts`.

## Matriz de invariantes y mutaciones (paso G6a)

La pregunta que responde: **«si alguien rompe algo que un invariante necesita, ¿el guardián FALLA, con un diagnóstico útil?»**. La unidad es el INVARIANTE (algo que tiene que ser verdad siempre), no cada símbolo del repo.

**Dónde está.** `mutaciones/matriz.ts` es el registro: cada invariante tiene `id`, `descripcion`, `elementos { definen, aplican, verifican }` (elementos concretos con su ruta: la regla de CSS y la marca, los consumidores, el manifiesto, el motor, los tests…), `mecanismo` y `mutaciones`. Cada mutación dice su CLASE, el elemento que rompe, el operador (con parámetros) y el hallazgo esperado (`verifica`, `tipo`, `archivo`, `linea`, `mensajeIncluye`). `mutaciones/operadores.ts` es el catálogo de operadores (cómo se rompe algo, sobre una copia: borrar o renombrar el ancla, quitar la marca, sacar el contrato del manifiesto, mover el alcance de carpeta, una excepción vencida…). `mutaciones/arnes.ts` aplica cada mutación a una COPIA mínima y fiel del repo (nunca al repo), corre el motor, la clasificación y las áreas, revierte y comprueba que el guardián vuelve a 0 hallazgos. `mutaciones-de-contratos.test.ts` lo corre dentro de `npm test` (unos 15 s) y trae los meta-tests.

**Las seis clases.** `eliminacion` (se borra el elemento), `alteracion` (se cambia), `duplicacion` (se copia), `desconexion` (el elemento sigue pero ya no está conectado: el contrato queda fuera del manifiesto, el área no lo declara, el consumidor ya no importa el ancla), `exclusion-del-analisis` (se saca del alcance o de la clasificación: carpeta movida, extensión que nadie analiza, exclusión agregada, archivo ignorado) y `evasion` (un intento de neutralizar el propio guardián: apagar el test, excluirlo en `vitest.config.ts`, renombrarlo, vaciar el manifiesto, bajar un plazo de 60 a 365, quitar el paso del CI). Cada invariante cubre cada clase o declara `noAplica: { clase, motivo }` (motivo de 20 caracteres o más).

**Qué invariantes hay.** Uno por CADA contrato del manifiesto, derivado solo (`contrato/<id>`: un contrato nuevo entra con las mutaciones estándar, y le hace falta su entrada en `EJEMPLOS_DE_CONTRATOS`), y los propios del guardián (`guardian/…`): clasificación completa de rutas, áreas declaradas, gobierno de excepciones, deuda, casos legítimos y exclusiones, política de plazos, marcas únicas y conocidas, manifiesto consistente y guardián no neutralizable.

**Cómo agregar un invariante.** Si es de un contrato, no hay que escribirlo: se deriva. Si es del guardián, agregá su bloque en `invariantesDelGuardian` de `matriz.ts` (descripción, elementos, una mutación por clase aplicable o su `noAplica`) y, si hace falta una forma nueva de romper algo, un operador en `operadores.ts`: un objeto `{ id, aplicaA, aplicar(base, parametros) }` que devuelve la `Mutacion` (cambios sobre la copia, o el manifiesto, las áreas, las reglas o la fecha alterados en memoria, más la línea esperada calculada del árbol ya mutado) o `{ noAplica: "razón" }` (un operador que no aplica lo dice, no se omite en silencio). Los operadores se reusan entre invariantes del mismo tipo.

**Cómo se lee una falla.**

```
HUECO: contrato/borde-propio-de-carta · eliminacion · src/app/globals.css · la regla `.carta-shell .carta-borde` (ancla de la fuente): el guardián no protege esto
  mutación: borra el ancla «.carta-shell .carta-borde» de src/app/globals.css [ancla]
  esperado: motor/fuente-ausente · src/app/globals.css:calculada · «la fuente de «borde-propio-de-carta» no tiene el ancla»
  real:     ningún hallazgo (la verificación pasa)
```

`HUECO` quiere decir que la mutación **sobrevivió**: la verificación pasó, o dio otro hallazgo (el «real» lo muestra), o dio el correcto pero en otra línea o con un mensaje que no dice qué corregir. Hay que arreglar el guardián (o el operador, si la mutación está mal armada: `ERROR-DEL-OPERADOR`). `HUECO-YA-PROTEGIDO` quiere decir que un hueco conocido ya se detecta: pasalo a `protegido` y sacá su deuda. `AISLAMIENTO-ROTO`, que después de revertir el guardián no volvió a 0.

**Huecos conocidos.** Algunos intentos de neutralizar el guardián NO tienen mecanismo todavía (el «guardián del guardián» y la revisión del CI son los pasos G6/G7): apagar el test (`describe.skip`), excluirlo en `vitest.config.ts`, renombrarlo a un `.ts`, quitar o desactivar el paso de `npm test` del CI, quitar el script `test` de `package.json` y agregar un caso legítimo que tape un uso. La matriz los registra con `estado: "hueco-conocido"` y exige una entrada de `DEUDA_DE_HUECOS` (motivo, responsable, aprobación, `creada`, vencimiento de 60 días como máximo, `resuelveEn: "G6"`, evaluada con las mismas reglas de la deuda del motor). El arnés comprueba que el hueco SIGUE sin detectarse; el meta-test falla si un hueco no tiene su deuda, si la deuda venció, si sobra una deuda, o si alguien marca `protegido` una mutación que sobrevive.

**Meta-tests.** (i) cada invariante cubre cada clase o declara `noAplica`; (ii) cada tipo de hallazgo del motor (`TIPOS_DE_HALLAZGO`), de las áreas y de la clasificación lo produce alguna mutación, o está en `CUBIERTOS_EN_MOTOR_TEST` con el título exacto de un test que existe; (iii) un contrato o un área nuevos sin entradas de matriz fallan («actualizá la matriz»); (iv) los huecos conocidos tienen su deuda vigente; (v) el arnés es un `.test.ts` bajo `test/` y `vitest.config.ts` no lo excluye.

**Evidencia.** `tablaComoTexto(filas)` y `tablaComoJson(filas)` (en `mutaciones/arnes.ts`) devuelven la tabla *invariante · clase · elemento · mutación · esperado · real* para el ejecutor de evidencia (G5); el arnés no escribe archivos en el repo.

**Límite honesto.** El arnés prueba el MECANISMO sobre los contratos declarados: que el guardián protege que la fuente única exista, esté marcada, esté declarada por quien la usa y no se copie. NO muta el comportamiento de una función de negocio (por ejemplo, qué devuelve `redondearMoneda`): eso lo cubren las pruebas de esa función, y la prueba de mutación real del código con StrykerJS se corre aparte. Las constantes de la política de plazos sí se mutan (60 → 365, motivo mínimo, responsables), pero se verifican corriendo las pruebas de borde del propio guardián en un banco aparte, no con un hallazgo.

## Límites a conocer

- Un caso legítimo no vence y NO lleva aprobación propia: ampliar o agregar uno es editar el archivo del contrato (`contratos/<id>.ts`), y hoy nada más lo frena que la revisión del cambio. Límite conocido: cuando el mecanismo guarde un hash aprobado de la definición de cada contrato, agregar o cambiar un caso legítimo (parte de esa definición) exigirá la aprobación que hoy no exige; mientras tanto el reporte cuenta los casos por contrato para que no crezcan en silencio.
- Un manifiesto mal armado (id repetido o no kebab-case, declaración incompatible con sus señales, sin señales, un `vence` que no es una fecha válida) **lanza un error**, no es un hallazgo.
- Las marcas se buscan en `.ts`, `.tsx` y `.css` de `src`, `plataforma`, `scripts`, `prisma` y `test`.
- `@/` se resuelve siempre a `src/`. Los nombres dinámicos (`--x-${rol}`) no se enumeran: para `nombre-definido-en-la-fuente` la fuente tiene que escribirlos.
- `hoy` se inyecta al motor; el guardián real usa `fechaUtcDeHoy()` (reloj UTC del sistema) y NO lee variables de entorno: no hay forma de mover la fecha desde afuera.
- Sin dependencias nuevas: el lector de CSS es propio y el de TypeScript es el AST de `typescript`.
