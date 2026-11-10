# Diseño: campo numérico de ENTRADA (regla de números del dueño, 2026-11-09)

Etapa **E-N entrada**. Hermana: «E-N salida» (cómo se MUESTRAN los números en tablas, reportes, fichas, tickets y exportaciones; dueña del formateo de salida). Esta etapa es dueña de lo que se ESCRIBE: campo, parser de entrada, canal campo→servidor, validación del servidor y los 23 campos que todavía eran `type="number"`. Estados: CONFIRMADA (la dijo el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA. Basado en `docs/diseno-estructura-de-pantalla-1366x768-2026-11-09.md` §14 (rama `alegp/estructura-1366x768`), verificado contra el código de `main`.

## 1. Propósito y alcance

Que escribir un número en cualquier campo sea igual en todo el sistema y no tenga lecturas ambiguas. Alcance: `CampoNumero`, el parser (`src/core/datos/numero-tecleado.ts`, `campo-numero-logica.ts`), la lectura del servidor y los 23 `<Campo type="number">`. **Fuera:** fechas (CONFIRMADA: no se tocan), el formateo de salida (E-N salida), el botón «,» propio (el dueño lo DESCARTÓ: no se diseña), migraciones de base (no hay: los valores guardados no cambian).

## 2. Actores y contexto

Quien carga datos en pantalla (escritorio y celular); el servidor, que recibe un pedido que puede estar armado a mano. Un valor guardado se muestra en el formato nuevo al abrir el campo.

## 3. Casos de uso

Teclear un número; pegarlo; arrastrar texto al campo; autocompletar del navegador; editar un valor ya guardado; enviar el formulario; un pedido a mano al servidor.

## 4. Conceptos y ciclo de vida

Tres textos distintos, que no se mezclan:

| Texto | Quién | Formato |
|---|---|---|
| Lo que se escribe o pega | persona | dígitos y UNA coma (y «-» al comienzo si el campo admite negativos) |
| Lo que se muestra | sistema | `1.000,00` (punto de miles, coma decimal) |
| Canal campo→servidor (`<input hidden>`, `leerNumeroCanonico`) | máquina | dígitos y un punto decimal (`1234.56`) |

Ciclo: foco → se muestra editable (`1234,5`, sin miles) → tecla/pegado → el parser lee → el campo emite el canónico → al salir se muestra formateado.

## 5. Invariantes y políticas (todas CONFIRMADAS por el dueño salvo lo marcado)

1. El sistema SIEMPRE muestra `1.000,00`. Dinero con 2 decimales y exacto (ARS, redondeo definido en `src/core/moneda.ts`); cantidades con los decimales de su unidad.
2. El campo NO acepta el «.»: la tecla se ignora con el aviso «Los decimales van con coma: 0,5»; un pegado/arrastre con «.» se rechaza ENTERO (el campo queda como estaba) con el mismo aviso. Sin heurísticas.
3. El sistema agrega el punto de miles al mostrar; nunca se escribe.
4. Se muestra el número entendido junto al campo mientras se edita («= 1.000,00», «= $ 1.000,00»; con unidad «= 60 g»). **PROPUESTA:** solo con el foco (sin foco el campo ya muestra el número formateado) y apagable (`sinEntendido`) donde ya existe la lectura de la receta (que además convierte de unidad).
5. Teclado de celular: `inputmode="decimal"` (ya estaba). **NO VERIFICADO** en un celular real: en teléfonos cuyo teclado decimal solo ofrece «.», la tecla se ignora con aviso y no hay otra forma de escribir un decimal; el dueño descartó el botón «,» propio.
6. El rechazo del «.» vale solo para lo que escribe o pega una persona. El canal interno (canónico con punto) NO se toca (decisión del orquestador, CONFIRMADA).
7. El servidor acepta, de un texto, ÚNICAMENTE el formato canónico estricto (`^-?\d+(\.\d+)?$`); rechaza todo lo demás con código `notacion` y mensaje claro (**PROPUESTA** del texto: «Formato de número no admitido (solo dígitos y un punto decimal, sin miles ni coma).»). Los decimales se cuentan sobre el texto: «21.000» en un importe son 3 decimales (error), no veintiún mil.
8. Un campo `entero` no admite decimales: si se teclea una coma se dice «Tiene que ser un número entero.» (no se borra en silencio). Una segunda coma no se ignora: queda y el campo dice que no es un número válido. **PROPUESTA.**
9. Un negativo se acepta tecleado y lo frena la regla del tipo (`permitirNegativo`), como antes. El «orden» de la carta admite negativos (`validarOrdenCarta`): se declara `permitirNegativo`.

## 6. Historia y persistencia

Sin migración de datos ni de esquema: los valores guardados no cambian. Un valor inicial guardado (canónico, con punto) se muestra en el formato nuevo.

## 7. Atomicidad y concurrencia

No aplica a la entrada (sin escrituras nuevas). Idempotencia: leer el mismo texto dos veces da el mismo número; el campo emite lo mismo si se repite el evento.

## 8. Acceso e interfaces

Cambios internos: `interpretarNumeroTecleado` (solo persona), `numeroDeEntrada` (servidor, canónico), `numeroDeFormulario` (nuevo, lectura estricta de `unknown`; reemplaza `Number(texto)` en `validarOrdenCarta`, `validarPrecioCarta`, `validarCantidadCupoPromo`), `aplicarEdicion` / `origenDeLaEdicion` (la regla del «.» al escribir), `formatearNumeroDelCampo` / `textoParaVer(valor, tipo)` (punto de miles, sin `toLocaleString`: el ICU de es-AR no agrupa los números de 4 cifras), `textoEntendido`. `CampoNumero` suma `unidad`, `sinEntendido`, `ayuda` y `errorDeRegla`. `CodigoDato`: `ambiguo` sale; entran `punto` y `notacion`. `ContextoNumerico` pierde `tipo` (sin punto de miles ya no hay «21.000» miles/ambiguo).

## 9. Consultas y experiencia

Aviso junto al campo (`Aviso advertencia en-linea`), «= …» (`aria-live="polite"`) y el error de lo tecleado (`role="alert"` de `Campo`). Los 23 campos migrados pierden las flechitas y el `min`/`max` nativo: el rango lo valida el servidor y, donde ya existía, `errorDeRegla` (editor del portal y del tema). Lugar y mínimos/máximos de cupos: el `min=1` del «máx.» ya no frena en el navegador; lo frena el servidor.

## 10. Pruebas, migración y operación

**Combinaciones (regla del dueño, 2026-10-28).** Dimensiones que cambian lo que se guarda: tipo (importe/cantidad/entero/porcentaje), decimales de la unidad (0, 2, 3, 4), origen (tecleado/pegado), texto con/sin «.», con/sin coma, lado (cliente/servidor). **Oráculo escrito aparte:** `test/core/oraculo-numero-entrada.ts`; **recorrido exhaustivo** en `test/core/campo-numerico-entrada.oraculo.test.ts`, con un guardián que falla si aparece un tipo de campo, un código de rechazo o una propiedad de `CampoNumero` sin declarar.

### ¿Qué pasa si…?

| Situación | Resultado |
|---|---|
| Tecleo «.» al final / en el medio / en un campo vacío | se ignora la tecla, el cursor queda donde estaba, aviso |
| Pego «1.234» o «1.234,50» o «0.5» | se rechaza entero, el campo queda como estaba, aviso |
| Pego «1234,5» | se acepta |
| Arrastro texto con «.» | igual que pegar |
| Autocompletar/IME que mete varios caracteres con «.» | igual que pegar (el campo vuelve al texto anterior) |
| Lector de pantalla | el aviso es `role="status"`, el «= …» `aria-live="polite"`, el error `role="alert"` |
| Foco | el valor pasa a editable (`1234,5`) y se selecciona todo; al salir vuelve a `1.234,5` |
| Valor inicial guardado con punto (`1234.5`) | se muestra `1.234,50` (importe) o `1.234,5`; no se migra nada |
| Número gigante | el parser lo lee; el tope lo pone el validador del tipo («es demasiado grande») |
| Negativo donde no corresponde | se acepta tecleado, la regla del tipo lo frena («no puede ser negativo») |
| Vacío | `""`; el servidor decide si es obligatorio |
| Unidad con 0 / 3 / 4 decimales | cada una admite sus decimales; de más → «Admite como máximo N decimales.» |
| Moneda | importe de 2 decimales y exacto, `= $ 1.000,00` |
| Cambio de permiso | no aplica |
| Pedido a mano con «21,5» o «1.234,50» | el servidor lo rechaza con `notacion` |

**Riesgos / pendientes.** (a) Teclado de celular sin coma: NO VERIFICADO. (b) El mensaje de `validarPrecioCarta` («usá el punto…») se dejó igual para no mover los golden; solo lo ve un pedido a mano. (c) E-N salida debería usar el mismo formateador de miles (hoy `formatearNumeroDelCampo` vive en `campo-numero-logica.ts`). (d) La lectura de la cantidad de la receta sigue siendo propia (convierte de unidad).
