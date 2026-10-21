# Contratos compartidos declarados

Un **contrato** es una regla transversal con UNA fuente (un símbolo exportado, o la regla de CSS que dice cómo se hace algo) y muchos consumidores. El motor (`motor.ts`) exige que cada consumidor **declare de cuál depende** de una forma que una máquina verifica dentro del propio archivo, y falla cerrado: si un archivo usa lo que el contrato regula y no lo declara, el test se pone rojo. No hay líneas de base que solo cuentan: la deuda existente se escribe **uso por uso** dentro del contrato.

Corre por DOS caminos que se vigilan entre sí: dentro de `npm test` (`contratos.test.ts`, un solo recorrido del repo) y, sin Vitest, en `npm run arquitectura` (`ejecutar.ts`, que además deja la evidencia de lo que corrió: ver «Evidencia por corrida»). Sus pruebas con árboles chicos están en `motor.test.ts`; la prueba de que el guardián protege los contratos REALES (rompe cada cosa que un invariante necesita y exige el hallazgo) está en `mutaciones-de-contratos.test.ts` (ver «Matriz de invariantes y mutaciones»). El índice de contratos es `manifiesto.ts`.

## Cómo se declara que se depende (`declaracion`)

| Declaración | El consumidor… | Va con señales |
|---|---|---|
| `importar-ancla` | importa el ancla de la fuente (nombrado, con alias, por defecto, o `import * as ns` usando `ns.ancla`) | `ts` |
| `clase-companera` | lleva la clase compañera en la MISMA cadena de clases; en CSS, la nombra en el selector de la regla | `clases`, `css` |
| `nombre-definido-en-la-fuente` (con `prefijoDeNombre`) | usa un nombre (`var(--x)`, o una clase como `bg-papel`) que la fuente define; un nombre definido que nadie usa también falla | `css/variable`, `ts/codigo`, `clases` |

### `nombre-definido-en-la-fuente`: fuente CSS con regla ancla y tokens en clases

La declaración es `{ tipo: "nombre-definido-en-la-fuente", prefijoDeNombre }` (`prefijoDeNombre: ""` si no hay señales de clases). Qué hace el motor con ella:

- **Solo cuenta la regla ancla.** Si la fuente es CSS, un nombre está «definido» únicamente si lo declara una propiedad `--x` DENTRO de la regla ancla (`reglaDelAncla`: la primera regla cuyo selector es el ancla; un at-rule como `@theme static` es una regla más, y sus reglas anidadas cuentan). Las variables del resto del archivo (un `.pos-shell { --paper: … }`) no son definiciones de la fuente. Las fuentes TS no cambian: todo `--x` escrito en su código.
- **La fuente CSS se revisa como consumidor** si está dentro del alcance del contrato: sus señales, sus definiciones y su declaración se miran como en cualquier archivo, y se DESCARTA lo que cae entre el principio y la `}` de la regla ancla (`ReglaCss.desde` y `hasta`): lo que define la propia fuente no es un uso. Un `var(--x)` sin definir fuera del ancla es `uso-sin-declarar`; un nombre ya definido antes en el ancla y definido otra vez (en el ancla o fuera de ella) es `definicion-duplicada` (hace falta un detector `definicion` que lo reconozca, p. ej. `css/define-variable`). Con la fuente en el alcance puede figurar en una lista cerrada de `consumidores`. Con la fuente fuera del alcance todo sigue como antes (sus usos propios cuentan como usos de los nombres).
- **Las clases pueden nombrar un token.** Un detector `clases` con esta declaración lleva el grupo con nombre `(?<nombre>…)` en su regex; el nombre que se verifica es `prefijoDeNombre + grupos.nombre` (`--color-` + `papel` = `--color-papel` para `bg-papel`) y CUENTA CADA TOKEN de la cadena, no solo el primero (`coincidenciasPorToken`). Las variantes (`hover:`, `md:`) y el `!` se ignoran para casar el nombre, pero el hallazgo apunta a la posición del token tal como está escrito. El motor lanza si falta `prefijoDeNombre` o el grupo. El regex tiene que casar también el nombre MAL escrito (`bg-papell`): si solo casa nombres válidos, un error de tipeo no se detecta. En TS, los grupos con nombre se escriben con `new RegExp("…")` (el `target` del repo no admite el literal).

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

**Dónde está.** `mutaciones/matriz.ts` es el registro: cada invariante tiene `id`, `descripcion`, `elementos { definen, aplican, verifican }` (elementos concretos con su ruta: la regla de CSS y la marca, los consumidores, el manifiesto, el motor, los tests…), `mecanismo` y `mutaciones`. Cada mutación dice su CLASE, el elemento que rompe, el operador (con parámetros) y el hallazgo esperado (`verifica`: motor, clasificación, áreas, pruebas, cumplimiento, aprobaciones o evidencia; `tipo`, `archivo`, `linea`, `mensajeIncluye`) y, si otro mecanismo tiene que decir algo de la misma mutación, `ademas` (la lista de hallazgos que también tienen que aparecer: por ejemplo el cumplimiento del cableado y, además, la huella del registro de aprobaciones). `mutaciones/operadores.ts` es el catálogo de operadores (cómo se rompe algo, sobre una copia: borrar o renombrar el ancla, quitar la marca, sacar el contrato del manifiesto, mover el alcance de carpeta, una excepción vencida…). `mutaciones/arnes.ts` aplica cada mutación a una COPIA mínima y fiel del repo (nunca al repo), corre el motor, la clasificación y las áreas (y, en las mutaciones de evasión y en las que tocan el mecanismo, también el cumplimiento del cableado, el registro de aprobaciones y los controles estructurales de la evidencia: ver «Guardián del guardián y aprobaciones» y «Evidencia por corrida»), revierte y comprueba que el guardián vuelve a 0 hallazgos. `mutaciones-de-contratos.test.ts` lo corre dentro de `npm test` (unos 25 a 35 s, según la máquina; la matriz sola, unos 23 s) y trae los meta-tests. El mismo arnés lo corre también el ejecutor de evidencia, sin Vitest (`npm run arquitectura`).

**Las seis clases.** `eliminacion` (se borra el elemento), `alteracion` (se cambia), `duplicacion` (se copia), `desconexion` (el elemento sigue pero ya no está conectado: el contrato queda fuera del manifiesto, el área no lo declara, el consumidor ya no importa el ancla), `exclusion-del-analisis` (se saca del alcance o de la clasificación: carpeta movida, extensión que nadie analiza, exclusión agregada, archivo ignorado) y `evasion` (un intento de neutralizar el propio guardián: apagar el test, excluirlo en `vitest.config.ts`, renombrarlo, vaciar el manifiesto, bajar un plazo de 60 a 365, quitar el paso del CI). Cada invariante cubre cada clase o declara `noAplica: { clase, motivo }` (motivo de 20 caracteres o más).

**Qué invariantes hay.** Uno por CADA contrato del manifiesto, derivado solo (`contrato/<id>`: un contrato nuevo entra con las mutaciones estándar, y le hace falta su entrada en `EJEMPLOS_DE_CONTRATOS`), y los propios del guardián (`guardian/…`): clasificación completa de rutas, áreas declaradas, gobierno de excepciones, deuda, casos legítimos y exclusiones, política de plazos, mecanismo aprobado (el registro de aprobaciones), marcas únicas y conocidas, manifiesto consistente, guardián no neutralizable y **evidencia no vacía** (la corrida deja evidencia y falla si pasó en vacío: manifiesto vaciado, aprobación de un contrato quitada, alcance movido, piso subido o bajado, ejecutor sacado de `npm run arquitectura` o borrado; ver «Evidencia por corrida»).

**Cómo agregar un invariante.** Si es de un contrato, no hay que escribirlo: se deriva. Si es del guardián, agregá su bloque en `invariantesDelGuardian` de `matriz.ts` (descripción, elementos, una mutación por clase aplicable o su `noAplica`) y, si hace falta una forma nueva de romper algo, un operador en `operadores.ts`: un objeto `{ id, aplicaA, aplicar(base, parametros) }` que devuelve la `Mutacion` (cambios sobre la copia, o el manifiesto, las áreas, las reglas o la fecha alterados en memoria, más la línea esperada calculada del árbol ya mutado) o `{ noAplica: "razón" }` (un operador que no aplica lo dice, no se omite en silencio). Los operadores se reusan entre invariantes del mismo tipo.

**Cómo se lee una falla.**

```
HUECO: contrato/borde-propio-de-carta · eliminacion · src/app/globals.css · la regla `.carta-shell .carta-borde` (ancla de la fuente): el guardián no protege esto
  mutación: borra el ancla «.carta-shell .carta-borde» de src/app/globals.css [ancla]
  esperado: motor/fuente-ausente · src/app/globals.css:calculada · «la fuente de «borde-propio-de-carta» no tiene el ancla»
  real:     ningún hallazgo (la verificación pasa)
```

`HUECO` quiere decir que la mutación **sobrevivió**: la verificación pasó, o dio otro hallazgo (el «real» lo muestra), o dio el correcto pero en otra línea o con un mensaje que no dice qué corregir. Hay que arreglar el guardián (o el operador, si la mutación está mal armada: `ERROR-DEL-OPERADOR`). `HUECO-YA-PROTEGIDO` quiere decir que un hueco conocido ya se detecta: pasalo a `protegido` y sacá su deuda. `AISLAMIENTO-ROTO`, que después de revertir el guardián no volvió a 0.

**Huecos conocidos (hoy, ninguno).** Hasta G6 siete intentos de neutralizar el guardián no tenían mecanismo: apagar el test (`describe.skip`), excluirlo en `vitest.config.ts`, renombrarlo a un `.ts`, reemplazar el paso de `npm test` del CI, ponerle `continue-on-error: true`, quitar el script `test` de `package.json` y agregar un caso legítimo que tape un uso. Desde el paso G6 son mutaciones PROTEGIDAS: el cumplimiento del cableado las ve con archivo y línea, y el registro de aprobaciones, además, la huella del archivo cambiado (o de los campos gobernados del contrato). También están «alterar la política» (60 → 365: las pruebas de borde con literales Y el registro) y «agregar una exclusión» (la huella de las exclusiones). `DEUDA_DE_HUECOS` quedó vacía, pero el mecanismo sigue: una mutación puede marcarse `estado: "hueco-conocido"` (con un id de `hueco`) y entonces el arnés comprueba que SIGUE sin detectarse y el meta-test exige una entrada de `DEUDA_DE_HUECOS` (motivo, responsable, aprobación, `creada`, vencimiento de 60 días como máximo, `resuelveEn: "G6"`, evaluada con las mismas reglas de la deuda del motor); falla si un hueco no tiene su deuda, si la deuda venció, si sobra una deuda o si alguien marca `protegido` una mutación que sobrevive.

**Meta-tests.** (i) cada invariante cubre cada clase o declara `noAplica`; (ii) cada tipo de hallazgo del motor (`TIPOS_DE_HALLAZGO`), de las áreas, de la clasificación, del cumplimiento y del registro de aprobaciones lo produce alguna mutación, o está en `CUBIERTOS_EN_MOTOR_TEST` (clave `verifica/tipo`) con el título exacto de un test que existe (los tipos del cumplimiento los cubre el meta-test de `cumplimiento.test.ts`, que exige un caso rojo para cada uno); (iii) un contrato o un área nuevos sin entradas de matriz fallan («actualizá la matriz»); (iv) los huecos conocidos tienen su deuda vigente; (v) el arnés es un `.test.ts` bajo `test/` y `vitest.config.ts` no lo excluye.

**Evidencia.** `tablaComoTexto(filas)` y `tablaComoJson(filas)` (en `mutaciones/arnes.ts`) devuelven la tabla *invariante · clase · elemento · mutación · esperado · real* que el ejecutor de evidencia (G5) resume y guarda en `resultado-contratos.json`; el arnés no escribe archivos en el repo.

**Límite honesto.** El arnés prueba el MECANISMO sobre los contratos declarados: que el guardián protege que la fuente única exista, esté marcada, esté declarada por quien la usa y no se copie. NO muta el comportamiento de una función de negocio (por ejemplo, qué devuelve `redondearMoneda`): eso lo cubren las pruebas de esa función, y la prueba de mutación real del código con StrykerJS se corre aparte. Las constantes de la política de plazos sí se mutan (60 → 365, motivo mínimo, responsables), pero se verifican corriendo las pruebas de borde del propio guardián en un banco aparte, no con un hallazgo.

## Evidencia por corrida (paso G5): «pasó» no es «no encontró nada»

Un guardián que recorre cero archivos, que perdió un contrato o cuyo alcance quedó vacío también termina sin hallazgos y en verde. El **ejecutor de evidencia** (`ejecutar.ts`, con `tsx`, SIN Vitest) corre el motor, la clasificación de rutas, las áreas, el cumplimiento del cableado, el registro de aprobaciones y la matriz de mutaciones sobre el repo real, imprime qué corrió y qué cubrió, y **sale con código 1** si algo de lo siguiente falla. Está encadenado en `npm run arquitectura` (`depcruise … && tsx test/arquitectura/contratos/ejecutar.ts`): corre en el job `estatico` del CI (no necesita base) y en el gate local, sin un noveno comando. Es el CAMINO B del guardián: si Vitest dejara de correr los guardianes (un `exclude`, un test renombrado, el paso de `npm test` reemplazado), este camino sigue corriéndolos y el cumplimiento del cableado lo dice; si alguien sacara el ejecutor de `npm run arquitectura`, lo ve el cumplimiento (`script-distinto`) desde `npm test`.

**Falla (código 1) si:** (1) el conjunto de ids de contratos del manifiesto no es EXACTAMENTE el de los contratos aprobados en el registro (`ids-distintos-del-aprobado`: un manifiesto vaciado, un contrato perdido o sumado sin aprobar); (2) algún contrato tiene alcance de 0 archivos (`alcance-cero`); (3) el motor leyó menos que el **piso** aprobado (`archivos-bajo-el-piso`); (4) hay CUALQUIER hallazgo del motor, la clasificación, las áreas, el cumplimiento o el registro de aprobaciones (`hallazgos`); (5) la matriz tiene una mutación que sobrevive (`matriz-con-huecos`). Los tres primeros son los controles estructurales de `gobernanza/evidencia.ts` (`problemasEstructurales`, función pura): la matriz los demuestra con mutaciones (invariante `guardian/evidencia-no-vacia`).

**El piso.** `PISO_DE_ARCHIVOS_LEIDOS` (`politica.ts`) está en **2.254**: el 90 % (redondeado hacia abajo) de los **2.505 archivos que el motor leyó el 2026-10-21** (`Resumen.archivosLeidos`: los `.ts`, `.tsx` y `.css` de `src`, `plataforma`, `scripts`, `prisma` y `test` más los alcances). El 10 % de margen absorbe que el repo se achique de a poco; bajarlo es cambiar `politica.ts`, que está congelado por hash en el registro de aprobaciones, y subirlo con el repo es lo esperable (volver a medir y tomar el 90 %).

**Qué deja.** Por consola, un resumen legible; ejemplo real (el repo el 2026-10-21):

```
Evidencia de contratos · commit 69896bb51097 · hoy 2026-10-21 · huella del mecanismo e3128fe50a (28 piezas)
Contratos: 3 (borde-propio-de-carta, separador-de-lista-de-carta, tokens-visuales) · aprobados: borde-propio-de-carta, separador-de-lista-de-carta, tokens-visuales
  tokens-visuales: 278 archivos en alcance (lista 61fda13d81) · 2 detectores de uso y 3 de redefinición · 1 consumidor (descubiertos) · 0 hallazgos
Archivos leídos por el motor: 2505 (piso aprobado 2254)
Áreas: 66 · 64 declaran [] · 2 declaran contratos
Archivos por tipo (2964): frontend 276, …, pruebas 1348, … · sin clasificar: 0
Vencimientos: excepciones 0 · deuda 18 (la primera en 60 días, 2026-12-20) · exclusiones 1 (la primera en 60 días, 2026-12-20) · casos legítimos 2
Cumplimiento del cableado: 16 tests protegidos · 0 hallazgos
Registro de aprobaciones: 28 piezas vigiladas · 38 aprobaciones · 0 hallazgos
Matriz de mutaciones: 12 invariantes · 131 mutaciones · 129 protegidas · 0 huecos conocidos · 0 fallan · 23.2 s
RESULTADO: OK · 3 contratos (el conjunto aprobado), todos con alcance > 0, 2505 archivos leídos (piso 2254) y 0 hallazgos
```

La evidencia entera (commit, huella del mecanismo —el sha1 de las huellas de todas sus piezas—, por contrato id, archivos en alcance con el sha de la lista ordenada, detectores, consumidores y hallazgos; áreas; archivos por tipo; excepciones, deuda y exclusiones con los días hasta vencer; avisos; el resultado del cumplimiento y del registro de aprobaciones; la tabla de la matriz) es el tipo `Evidencia` de `gobernanza/evidencia.ts`. Se escribe en dos destinos, ambos opcionales:

| Variable | Qué escribe | Si no se puede escribir |
|---|---|---|
| `CONTRATOS_EVIDENCIA=<ruta>` | `resultado-contratos.json`, la evidencia entera (unos 150 KB), al terminar y aunque falle. Antes de correr crea la carpeta, borra un resultado viejo y prueba que se puede escribir, y no deja nada mientras corre (un archivo suelto en la raíz lo vería la clasificación de rutas); si el proceso muere a mitad de camino no queda ningún resultado. Sin la variable no escribe nada | FALLA (código 1), con el nombre de la variable y la causa, antes de correr nada: una evidencia que se pierde en silencio no es evidencia |
| `GITHUB_STEP_SUMMARY` | el mismo resumen en Markdown, que GitHub Actions muestra en la corrida | igual: falla claro |

Ninguna de las dos cambia lo que hace un guardián (son adonde se escribe lo ya calculado); el ejecutor, como el resto, NO lee ninguna variable para la fecha ni para nada que afecte un veredicto. En local conviene escribirlo fuera del repo o borrarlo después: la corrida siguiente borra el viejo antes de empezar, pero cualquier otra herramienta que corra con el archivo en la raíz lo vería como una ruta sin clasificar.

**En el CI (paso G7).** El job `estatico` de `.github/workflows/ci.yml` corre `npm run arquitectura` con `CONTRATOS_EVIDENCIA: resultado-contratos.json` y, a continuación, el paso «Evidencia de contratos (artefacto)» sube ese archivo con `actions/upload-artifact` (el mismo SHA que `resultado-vitest`, `retention-days: 7`, `if-no-files-found: error`, sin `if` ni `continue-on-error`): si el ejecutor no dejó la evidencia, el job falla. El resumen en Markdown llega solo al `GITHUB_STEP_SUMMARY` de la corrida (lo escribe el propio ejecutor, también cuando falla), así que se lee en la pestaña de la corrida sin bajar nada. El job `gate` sigue dependiendo de `estatico`: por eso la evidencia es parte del único check requerido. El cumplimiento exige las dos cosas (`ci-sin-evidencia`) y que el gate espere a `estatico` (`ci-gate-sin-needs`); la matriz las muta (quitar la subida, `if-no-files-found: ignore`, sacar la variable, quitar `estatico` de `needs`). En el mismo paso, `playwright.config.ts` pasó a llevar `forbidOnly: !!process.env.CI`.

**Tiempos.** `npm run arquitectura` pasó de unos 6 s (solo dependency-cruiser) a unos 33 s: el ejecutor suma unos 27 s, de los cuales unos 23 s son la matriz de mutaciones (el mismo trabajo que `mutaciones-de-contratos.test.ts` hace dentro de `npm test`, ahora también sin Vitest).

**Cómo se prueba.** `gobernanza/evidencia.test.ts`: casos sintéticos rojo y verde de los controles (borde del piso: 99 de 100 rojo, 100 verde; conjunto de ids; alcance 0), la evidencia armada sobre el repo real (tiene que dar `ok`), y el ejecutor (código de salida, el JSON, el Markdown, la ruta no escribible). La matriz agrega las mutaciones sobre una copia exacta del repo: vaciar el manifiesto, subir el piso, quitarle al registro la aprobación de un contrato, mover el alcance de un contrato, sacar el ejecutor de `npm run arquitectura`, borrarlo o bajar el piso a 1.

**Qué NO hace.** No prueba que cada detector detecte bien (eso es el motor y las mutaciones); prueba que la corrida no fue en vacío. El piso es una cota gruesa: un recorrido que pierde el 5 % de los archivos no lo atrapa (sí lo atrapan el alcance y el sha de la lista de cada contrato, que queda en la evidencia para comparar entre corridas).

## Guardián del guardián y aprobaciones (paso G6)

Decisiones del dueño: fail-closed estricto; todo guardián necesita su guardián; la «aprobación independiente» es SOLO DETECCIÓN (el dueño trabaja solo: sin cuenta aparte y sin CODEOWNERS obligatorio); toda excepción y toda deuda vencen como mucho a los 60 días; los casos legítimos permanentes son parte de la definición del contrato; cambiar el mecanismo tiene que quedar registrado y aprobado. Dos piezas lo cumplen, las dos dentro de `npm test` (y en el arnés de mutaciones):

- **Registro de aprobaciones** (`gobernanza/aprobaciones.ts`, probado por `aprobaciones.test.ts`): la huella de cada pieza del mecanismo y quién aprobó cada cambio. Es el patrón de `test/arquitectura/caracterizaciones-congeladas.test.ts`.
- **Cumplimiento** (`gobernanza/cumplimiento.ts`, probado por `cumplimiento.test.ts`): evaluadores PUROS del cableado (texto de entrada, hallazgos con `archivo:línea` y corrección) para `ci.yml`, `package.json`, `vitest.config.ts` y los tests protegidos. Dice POR QUÉ un cambio apaga al guardián aunque alguien ya lo haya aprobado en el registro.

### Qué se hashea y por qué

La huella es el hash de blob de git (`git hash-object`) del contenido normalizado a LF; en las formas canónicas, el blob del JSON de claves ordenadas. Cada pieza (la «clave» del registro) es un archivo o `archivo#forma`:

| Pieza | Forma | Por qué |
|---|---|---|
| `motor.ts`, `tipos.ts`, `politica.ts` (con el piso de archivos leídos), `indice.ts`, `ejecutar.ts`, `adaptadores/*.ts` (cada uno), `gobernanza/{clasificacion,usos,cumplimiento,evidencia}.ts`, `mutaciones/{arnes,operadores}.ts`, `vitest.config.ts`, `playwright.config.ts`, `.gitignore` | archivo entero | es el mecanismo: un byte distinto es otro guardián (`.gitignore` esconde código, las configuraciones deciden qué corre) |
| `gobernanza/areas.ts#logica`, `gobernanza/exclusiones.ts#logica`, `gobernanza/aprobaciones.ts#logica` | el archivo SIN sus datos (`AREAS`, `IDS_DE_CONTRATO`, `EXCLUSIONES`, `APROBACIONES`) | los datos cambian a menudo y los vigila otra pieza; solo se sacan sentencias que son datos puros (literales, listas, objetos, referencias a otra constante): una que llame a una función o haga una cuenta se queda en el hash |
| `contratos/<id>.ts#gobernado` (uno por contrato) | `{ id, excepciones, casosLegitimos }` canónico | son los dos campos que pueden SILENCIAR un uso; el resto de la definición cambia con el contrato y lo vigilan el motor y las mutaciones |
| `gobernanza/exclusiones.ts#exclusiones` | las exclusiones de la clasificación, enteras | es la única puerta para dejar un archivo fuera de las reglas de rutas |
| `gobernanza/areas.ts#politica-de-tipos` | qué tipos de ruta declaran contratos | un tipo que pasa a «no declara» se exime de toda declaración |
| `package.json#scripts` | solo la clave `scripts`, canónica | Dependabot cambia las dependencias y no tiene que disparar nada |
| `.github/workflows/ci.yml#sin-sha` | el workflow con `uses: dueño/repo@<sha> # versión` reducido a `uses: dueño/repo@SHA` | una actualización de Dependabot no pone rojo cada pull request (los SHA los vigila `despliegues-y-cadena-de-suministro.test.ts`); cualquier otro cambio del workflow sí |

**Lo que NO se hashea:** la deuda (ya la gobiernan los vencimientos de 60 días), `manifiesto.ts`, `matriz.ts`, los tests y el resto de la definición de cada contrato (`senales`, `alcance`, `declaracion`). Es el costo de no congelar cada cambio legítimo: ver los límites de abajo.

### Cómo se agrega una aprobación

1. Hacé el cambio. El guardián se pone rojo con el archivo, la huella actual y la línea para pegar:

```
test/arquitectura/contratos/motor.ts:1:1  [aprobaciones · huella-distinta]
  «test/arquitectura/contratos/motor.ts» (archivo del mecanismo, entero) cambió: huella actual 3f2a…, aprobada a6d7… → si el cambio es a propósito, agregá la aprobación (referencia + motivo) al registro APROBACIONES de test/arquitectura/contratos/gobernanza/aprobaciones.ts; si no, revertí el cambio. Entrada para pegar al final: { archivo: "test/arquitectura/contratos/motor.ts", blob: "3f2a…", referencia: "DEC-nn | PR #n | commit <sha>", motivo: "por qué cambia (20 caracteres o más)" },
```

2. Pegá esa entrada AL FINAL de `APROBACIONES`, con la referencia real (`PR #n`, `commit <sha>` o `DEC-nn`) y un motivo de 20 caracteres o más. Las entradas viejas no se editan ni se borran: el registro es el historial, y la huella vigente de una pieza es la de su última entrada.
3. Una pieza nueva (un adaptador nuevo, un contrato nuevo) sale como `sin-aprobacion`; una que se borra, como `archivo-ausente`. Para retirarla a propósito, agregá una entrada con `blob: "retirado"`.
4. Cambiar `ci.yml`, `vitest.config.ts` o un script de `package.json` es cambiar el mecanismo: va con su entrada. Cuando cambia `cumplimiento.ts` (por ejemplo `CONDICIONES_PERMITIDAS` o `SCRIPTS_ESPERADOS` porque el CI ganó un paso), su entrada va en el mismo commit.

La primera carga (la línea de base del mecanismo, `referencia: "DEC-03"`) queda pendiente de que el dueño la ratifique antes del pull request.

### Qué revisa el cumplimiento

| Evaluador | Qué exige | Tipos de hallazgo |
|---|---|---|
| `evaluarWorkflow` (`ci.yml`) | `estatico` corre `npm run arquitectura` e `integracion` corre `npm test`, sin `if`, `working-directory` ni `shell`; `gate` necesita los cinco jobs, su expresión los nombra y se llama «Gate (requerido)»; ningún `continue-on-error` (salvo `false`); ningún `if` fuera de `CONDICIONES_PERMITIDAS` (cada una con su motivo); sin `paths` ni `paths-ignore` en `on:`; ni `CREAR_CERCOS`, `BAJAR_CERCOS`, `REGENERAR_*`, `GOLDEN_ACTUALIZAR` ni `CONTRATOS_*` en ningún lugar (la única `CONTRATOS_*` permitida es `CONTRATOS_EVIDENCIA`, que solo dice adónde se escribe lo ya calculado); **la evidencia (G7):** el paso `npm run arquitectura` define `CONTRATOS_EVIDENCIA: resultado-contratos.json` y un paso POSTERIOR de `estatico` lo sube con `actions/upload-artifact` y `if-no-files-found: error` | `ci-ilegible`, `ci-job-ausente`, `ci-sin-paso`, `ci-paso-alterado`, `ci-continue-on-error`, `ci-condicion-no-permitida`, `ci-gate-sin-needs`, `ci-gate-expresion`, `ci-gate-renombrado`, `ci-filtro-de-rutas`, `ci-variable-prohibida`, `ci-sin-evidencia` |
| `evaluarScripts` (`package.json`) | `scripts.test` vale `vitest run`, `scripts.arquitectura` vale lo que hoy (`depcruise … && tsx test/arquitectura/contratos/ejecutar.ts`: sacar dependency-cruiser o el ejecutor de evidencia es un `script-distinto`), y no hay `pretest`, `posttest`, `prearquitectura` ni `postarquitectura` | `package-ilegible`, `script-ausente`, `script-distinto`, `script-de-ganchos` |
| `evaluarConfigDeVitest` (`vitest.config.ts`, AST) | ningún `test.exclude` deja afuera un guardián protegido, un `test.include` los cubre, `allowOnly` no es true, ni `projects`, `workspace`, `dir`, `root` ni `testNamePattern`; lo que no se puede analizar (una propagación, un glob raro) es un hallazgo | `vitest-excluye-guardian`, `vitest-include-no-cubre`, `vitest-allowonly`, `vitest-clave-peligrosa`, `vitest-no-analizable` |
| `evaluarConfigDePlaywright` (`playwright.config.ts`, AST) | `forbidOnly: !!process.env.CI` (o `Boolean(process.env.CI)` o `true`): sin él, un `test.only` olvidado en un spec pasa en el CI sin avisar y el resto de los specs no corre; una propagación (`...`) o un archivo que no exporta `defineConfig({ … })` es un hallazgo | `playwright-sin-forbidonly`, `playwright-no-analizable` |
| `evaluarPruebaProtegida` (AST) | ningún `skip`, `only`, `todo`, `skipIf`, `runIf`, `ctx.skip`, `xit`, `xdescribe` en los tests protegidos, y al menos un `it`/`test`; una mención en un texto o un comentario no cuenta | `prueba-desactivada`, `guardian-sin-pruebas` |
| `evaluarCableado` | los guardianes esperados existen, están bajo `test/` y terminan en `.test.ts`; un `.ts` con `describe`/`it`/`test` que no termina en `.test.ts` no corre | `guardian-ausente`, `guardian-mal-cableado`, `prueba-sin-sufijo-test` |
| `evaluarManifiesto` | el manifiesto no está vacío y su conjunto de ids es el de los contratos aprobados en el registro (que cada contrato tenga alcance > 0 archivos lo hace el motor: `alcance-vacio`) | `manifiesto-vacio`, `contrato-sin-aprobar`, `aprobado-ausente-del-manifiesto` |

**Tests protegidos:** todo `test/arquitectura/contratos/**/*.test.ts` que exista (se descubre solo: un test nuevo queda protegido sin tocar nada) más los que `GUARDIANES_ESPERADOS` y `GUARDIANES_ADICIONALES` nombran (los de esta carpeta, y `caracterizaciones-congeladas`, `despliegues-y-cadena-de-suministro`, `rol-de-pruebas-solo-local`, `dominios-clasificados`, `entornos-y-escapes` y `cercos/trinquete`). Uno que se borra o se renombra falla aunque nadie lo haya listado dos veces.

Un reporte tiene la misma forma que los demás:

```
test/arquitectura/contratos/contratos.test.ts:15:1  [cumplimiento · prueba-desactivada]
  `describe.skip` desactiva o recorta pruebas de un guardián protegido (`.skip`) → sacá `.skip`: los tests de un guardián corren todos, siempre
```

`revisarCumplimiento(raiz)` corre todos los evaluadores sobre un árbol (el repo real o la copia del arnés). Tarda menos de un segundo; el registro de aprobaciones, unas decenas de milisegundos.

### Qué NO puede garantizar

- **Un cambio coordinado.** Quien en un mismo commit cambia el guardián, su huella y el registro (o `cumplimiento.ts` y su aprobación) pasa los tests: solo lo frena la lectura del diff por el dueño. La «aprobación independiente» es solo detección porque el dueño trabaja solo; no hay una segunda llave. El registro hace que ese cambio sea visible y tenga motivo escrito, no que sea imposible.
- **La configuración externa de GitHub.** Un administrador del repositorio puede cambiar la regla de la rama, sacar el gate de los checks requeridos, desactivar Actions o fusionar sin esperar al CI; y un despliegue manual (`vercel deploy --prod`) no pasa por el CI. Eso se vigila fuera del repo; cómo se cablea el CI en GitHub es el paso siguiente.
- **Lo que no se hashea.** Editar los tests (`contratos.test.ts` con otra aserción, por ejemplo), `manifiesto.ts`, `matriz.ts` o las señales y el alcance de un contrato no pone rojo el registro; lo cubren el motor, las pruebas de cada contrato y la lectura del diff. Los evaluadores de `cumplimiento.ts` revisan el cableado (que los tests existan, corran y no estén apagados), no que cada aserción siga siendo la de siempre.
- **Que el CI corra de verdad.** El workflow dice que la evidencia se sube; que GitHub Actions corra (facturación, minutos) y que el gate sea el check requerido de la rama es configuración externa. Que el job `gate` baje el artefacto y compruebe que existe y no está vacío (independiente del script que lo escribió) es una etapa posterior del plan.
- **Los evaluadores de YAML son de texto** (sin dependencias nuevas): un workflow reescrito con una sintaxis que el lector no entiende es un hallazgo (`ci-ilegible`, `ci-sin-paso`), no un «todo bien»; el hash es la defensa principal.

## Límites a conocer

- Un caso legítimo no vence y NO lleva aprobación propia dentro del contrato, pero agregar, cambiar o sacar uno cambia la huella de los campos gobernados del contrato (`contratos/<id>.ts#gobernado`, ver «Guardián del guardián y aprobaciones») y pone rojo el registro hasta que se suma la aprobación (referencia + motivo). Además el reporte cuenta los casos por contrato para que no crezcan en silencio.
- Un manifiesto mal armado (id repetido o no kebab-case, declaración incompatible con sus señales, sin señales, un `vence` que no es una fecha válida) **lanza un error**, no es un hallazgo.
- Las marcas se buscan en `.ts`, `.tsx` y `.css` de `src`, `plataforma`, `scripts`, `prisma` y `test`.
- `@/` se resuelve siempre a `src/`. Los nombres dinámicos (`--x-${rol}`) no se enumeran: para `nombre-definido-en-la-fuente` la fuente tiene que escribirlos. Para mutar un contrato de este tipo el arnés tiene tres operadores propios (`mutaciones/operadores.ts`): `quitar-declaracion` también rompe un consumidor que usa un token en una clase (`bg-papel/50` pasa a `bg-papel-inexistente/50`, con la opacidad intacta), `quitar-token` borra de la regla ancla la definición de un token que algo usa y `agregar-token` agrega uno que nadie usa; los tres se activan solos cuando el contrato es de nombres con una fuente CSS (con consumidores en clases, solo cuando existe uno real). El ejemplo de la matriz puede traer `extensiones: { uso, definicion }` para que el uso crudo vaya en un `.tsx` y la redefinición en un `.css` (`tokens-visuales`). Una entrada de `deuda` que cubre el mismo tipo de hallazgo en el mismo archivo que otra se prueba una sola vez (los 15 alias del salón de `tokens-visuales` son una mutación, no 15).
- `hoy` se inyecta al motor; el guardián real usa `fechaUtcDeHoy()` (reloj UTC del sistema) y NO lee variables de entorno: no hay forma de mover la fecha desde afuera.
- Sin dependencias nuevas: el lector de CSS es propio y el de TypeScript es el AST de `typescript`.
