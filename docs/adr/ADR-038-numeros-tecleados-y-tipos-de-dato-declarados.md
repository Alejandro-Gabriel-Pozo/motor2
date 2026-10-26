# ADR-038: Números tecleados, tipos de dato declarados y bloqueantes

> Redactado el 2026-10-22 (rama `alegp/stoic-davinci-185dm4`, Fase 6: micro-paso «2c», el analizador numérico, y lote 6.33, «tipos de dato declarados y bloqueantes»). **Estado: implementado en el código. Sin migraciones.** La regla numérica la decidió el dueño el 2026-10-20 («Notación argentina + mostrar lo que entendió»). Las decisiones abiertas están al final.

## Contexto

En un campo de importe, «21.000» se leía como $ 21, sin aviso. Cada pantalla leía los números a su manera: `<input type="number">` con la notación del navegador, `Number(formData.get(…))` (que lee un campo vacío como 0 y acepta `1e3`) o `new Date(texto)` para los días. El servidor no siempre validaba con la misma regla que la pantalla, y un mismo texto puede significar cosas distintas según lo que se carga: «1.205» son mil doscientos cinco pesos, pero en kilos puede ser 1,205 o 1205.

## Decisión

1. **Un solo analizador de lo que teclea la persona**: `interpretarNumeroTecleado(texto, contexto)` en `src/core/datos/numero-tecleado.ts`, que es puro. Lo leen con el MISMO contexto la pantalla y el servidor.
   - El contexto es `ContextoNumerico { tipo, decimales }`. `tipo` vale `"importe"` o `"cantidad"`.
   - Los contextos de base son `CONTEXTO_IMPORTE` (2 decimales), `contextoDeCantidad(decimales)` (los decimales de la unidad o de la columna) y `CONTEXTO_CANTIDAD_SIN_UNIDAD` (los 4 de `Decimal(14,4)`).
   - El canal de valor que viaja en los formularios (dígitos y un punto decimal) se lee aparte, con `leerNumeroCanonico`.

2. **La regla: notación argentina.** Verificada ejecutando `interpretarNumeroTecleado` y en `test/core/datos-numero-tecleado.test.ts` y `test/core/datos-numero-tecleado-contexto.test.ts`.
   - **La coma es el decimal, siempre.** «12.345,6» y «21.000,00» valen en un importe. La coma con más cifras que los decimales del contexto es error de decimales: «21,000» en un importe da el error con la pista «Para 21000 escribí 21000 o 21.000,00».
   - **Varios puntos bien agrupados son miles**: «1.000.000». El primer grupo lleva de 1 a 3 cifras sin cero inicial y los siguientes, 3.
   - **Un solo punto con 1 o 2 cifras detrás es decimal**: «21.5» vale 21,50, por el teclado numérico. «0.125» (entero 0) también es decimal.
   - **Un solo punto con exactamente 3 cifras detrás y un entero de 1 a 3 dígitos sin cero inicial** («21.000», «1.205») depende del contexto. Lo decide `elPuntoConTresCifrasEsMiles`:
     - es **miles** en un IMPORTE y en una cantidad de unidad SIN decimales (g, ml, unidad; y `tipo="entero"`);
     - es **AMBIGUO** en una cantidad con 1 o más decimales: error junto al campo, «¿1,205 o 1205? Escribí 1205 o 1,205.». No se adivina.

     En el sembrado (`prisma/seed.ts`), kg y l tienen 2 decimales: «1.205» kg da error.
   - **Un importe admite a lo sumo 2 decimales** (`DECIMALES_IMPORTE`). Más se rechaza, no se redondea. Una cantidad admite los decimales de su unidad.
   - **Tecleo a medias**: «5,» y «21.» valen 5 y 21 (el separador final sin cifras se ignora). «,5» y «.5» valen 0,5.
   - Notación científica, símbolos y texto son error de formato. Vacío es `null`. Nunca se borra ni se redondea en silencio.

   | Tecleado | Importe | Cantidad sin decimales (g) | Cantidad con 2 decimales (kg, l) |
   |---|---|---|---|
   | `21.000` | 21000 | 21000 | error: ambiguo |
   | `1.205` | 1205 | 1205 | error: ambiguo |
   | `21.5` | 21,5 | error: decimales | 21,5 |
   | `21,000` | error: decimales | error: decimales | error: decimales |
   | `1,205` | error: decimales | error: decimales | error: decimales (con 3 decimales vale 1,205) |
   | `12.345,60` | 12345,6 | error: decimales | 12345,6 |
   | `5,` / `21.` | 5 / 21 | 5 / 21 | 5 / 21 |

3. **`CampoNumero.tipo` es obligatorio** (`src/components/campo-numero.tsx`): `importe`, `cantidad`, `entero` o `porcentaje` (`TipoDeCampoNumerico`). Si falta, lo bloquea el compilador. El contexto sale de `contextoDelCampo` (`src/core/datos/campo-numero-logica.ts`).
   - Lo que no se entiende se dice debajo del campo, con cómo escribirlo. El campo queda inválido y `setCustomValidity` frena el envío.
   - Hoy hay 50 usos de `CampoNumero` en `src/`, todos con su tipo.

4. **Un código de dígitos no es un número**: `CampoCodigo` (`src/components/campo-codigo.tsx`) pide el teclado numérico, pero el texto viaja tal cual, con sus ceros a la izquierda y sus guiones. No se opera ni se parsea. Quien lo usa declara su `longitudMaxima`, su `autoComplete` y, si hace falta, su `patron`. Hoy lo usa el CUIT de la invitación (`src/app/invitacion/formulario-de-aceptacion.tsx`).

5. **El servidor valida con el mismo contexto y nunca confía en el cliente.**
   - `numeroDeEntrada(valor, contexto)` lee un texto con `interpretarNumeroTecleado`. Es la base de `validarImporte` (`src/core/datos/importe.ts`, `CONTEXTO_IMPORTE`), de `validarCantidad` (`src/core/datos/cantidad.ts`, con los decimales de la unidad) y de los validadores de porcentaje, factor, descuento y food cost de `src/core/datos/`.
   - Lo que llega de un POST crudo en `src/server` se valida con `esNumeroEstricto` (`test/arquitectura/sin-numero-flexible-en-server.test.ts`).
   - Los números de un formulario se leen con `numeroDelCampo`, que devuelve vacío, el número o `NaN` (nunca 0).

6. **Cuatro cercos trinquete**: no pueden subir, y bajan con `BAJAR_CERCOS=1`. Cada entrada lleva su motivo por archivo. El mecanismo está en `test/arquitectura/cercos/trinquete.ts`. La línea de base, contada hoy en `test/arquitectura/cercos/linea-de-base/*.json`:

   | Regla | Test | Base al crearse (79c62436) | Base hoy |
   |---|---|---|---|
   | `campo-type-number`: `<input>` o `<Campo>` con `type="number"` fuera de `src/ui/` | `test/arquitectura/cerco-campo-type-number.test.ts` | 24 en 12 archivos | **24 en 12** |
   | `numero-de-formulario-a-mano`: `Number`, `parseFloat` o `parseInt` de un `formData.get(…)` | `test/arquitectura/cerco-numero-de-formulario.test.ts` | 14 en 4 | **0 (meta alcanzada)** |
   | `fecha-de-texto-a-mano`: `new Date(texto)` fuera de `src/core/tiempo/` | `test/arquitectura/cerco-fecha-de-texto.test.ts` | 28 en 15 | **8 en 6** |
   | `inputmode-numerico-a-mano`: teclado numérico pedido a mano | `test/arquitectura/cerco-inputmode-numerico.test.ts` | 20 en 12 | **19 en 11** |

   La meta de las cuatro reglas es 0. `CampoNumero` y `CampoCodigo` son los únicos que piden el teclado numérico por derecho.

7. **Un precio que cambia más de 30 % pide confirmación**, y siempre se muestra el «antes → después». El 30 % exacto no confirma. Está en `cambioDePrecio` (`src/core/catalogo/cambio-de-precio.ts`). Hoy solo lo usa el precio de la sucursal del paso 2 del espacio del producto (ADR-037).

## El hallazgo: un error de mil veces en el stock

La primera versión del analizador (commit da3828b3) decidía si el punto era miles **por la cantidad de decimales del contexto**, con `DECIMALES_QUE_VUELVEN_AMBIGUO_EL_PUNTO = 3`: el punto con tres cifras era ambiguo solo con 3 o más decimales. Pero en el sembrado kg y l tienen 2 decimales, los mismos que un importe, así que «1.205» kg se leía como **1205 kg**.

La corrección lleva el TIPO en el contexto (`ContextoNumerico { tipo, decimales }`; commits 68e43362 en el núcleo, da6e1b4c en el campo y 6ee7570c en el servidor). Ahora un importe y una cantidad con los mismos decimales se leen distinto. La tabla de casos sumó una columna para los kg y l del sembrado. Las mutaciones demostradas: ignorar el tipo dio 9 rojos; volver al umbral por decimales, 8.

## Consecuencias

- «21.000» en un precio son veintiún mil pesos, y «1.205» en kilos ya no se convierte en 1205 en silencio: se pide aclarar.
- **«1,205 kg» hoy se rechaza** por tener 3 decimales cuando kg admite 2. La regla del dueño lo daba como válido («un kilo 205 g»): depende de la decisión abierta sobre los decimales de kg y l.
- La pantalla y el servidor leen igual. Cambiar la regla es cambiar una función y su tabla de casos, no cada formulario.
- Los cercos impiden que vuelva un número leído a mano. Lo que queda (24 + 8 + 19) es deuda declarada, con su motivo por archivo.

## Lo que todavía no está

- **«Se entendió».** La decisión pedía mostrar siempre cómo se entendió lo tecleado, en es-AR («$ 21.000,00», «1,205 kg»). Lo que hay hoy:
  - al salir del campo, `CampoNumero` vuelve a mostrar el número formateado en es-AR (`textoParaVer`), sin el símbolo (va como prefijo, fuera del valor) y sin forzar los dos decimales;
  - algunas pantallas tienen una lectura en vivo debajo del campo: la cantidad de un ingrediente de la receta (`LecturaDeCantidad`) y el precio de cada opción en el espacio del producto (`LecturaDePrecio`, sobre `LecturaEnVivo`).

  No existe un rótulo literal «Se entendió: …» en todos los campos. **A confirmar** con el dueño si alcanza con esto.
- La confirmación del 30 % solo existe en el precio de la sucursal del paso 2 (ver ADR-037).

## Decisiones abiertas para el dueño

1. **kg y l con 3 decimales.** Con 3, «1,205 kg» y «0,125 kg» se pueden escribir, y «1.205» sigue siendo ambiguo (pide aclarar). El cambio no necesita migración:
   - en una base existente, se hace desde la pantalla Unidades (`actualizarDecimalesUnidad`, clave `unidades`, de 0 a 6 decimales). Subir los decimales no rompe nada guardado, y las columnas de cantidad tienen 4;
   - para las instalaciones nuevas, se cambia el sembrado (`prisma/seed.ts`).

   **Pendiente de decisión.**
2. **El dinero sigue siendo `number`** con la aritmética exacta encerrada en `src/core/moneda.ts` (decimal.js, solo para multiplicar y redondear) y columnas `Decimal(14,2)` en la base. Pasarlo a enteros de centavos (`bigint`) o a `Decimal` de punta a punta es un refactor grande. Queda **para después del PR**, si el dueño lo decide.
