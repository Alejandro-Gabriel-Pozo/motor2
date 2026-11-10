# Diseño: formato de número de SALIDA — «1.000,00» en todo el sistema (2026-11-09)

> Sesión «E-N salida». Lo que se **escribe** (campos, parseo, validación del servidor) es de la sesión «E-N entrada» y no se toca acá. Esta etapa es solo cómo se **muestran** los números. No hay migración, tabla ni librería nueva.
>
> **Marcas.** **CONFIRMADA** = la dijo el dueño (2026-11-09). **PROPUESTA** = la propone este diseño y el dueño la corrige. **PENDIENTE** = falta una decisión. **VERIFICADO** = lo medí en el código de `origin/main` (commit `d231db21`).

---

## 1. Propósito y necesidad (nivel 1)

| # | Necesidad | Quién y cuándo | Estado |
|---|---|---|---|
| N-1 | El sistema SIEMPRE muestra los números como «1.000,00» (punto de miles, coma decimal) | Dueño, 2026-11-09 | CONFIRMADA |
| N-2 | La unidad va pegada a la cantidad («0,22 kg») | Dueño, 2026-11-09 | CONFIRMADA |
| N-3 | Los números se alinean a la derecha en las tablas | Dueño, 2026-11-09 | CONFIRMADA |
| N-4 | Dinero siempre con 2 decimales y exacto, moneda ARS | Dueño, 2026-11-09 | CONFIRMADA |
| N-5 | Cantidades con los decimales que admite su unidad (`Unidad.decimales`) | Dueño, 2026-11-09 | CONFIRMADA |
| N-6 | Excel: el valor sigue siendo numérico (el formato lo pone la planilla). Las FECHAS no se tocan | Dueño, 2026-11-09 | CONFIRMADA |

El síntoma que se elimina: la receta mostraba «0.22» (punto) y la ficha de cocina «0,22» (coma) para el mismo ingrediente.

**Alcance.** Entra: una función central de salida, un `<td>` numérico, la aplicación a las pantallas de mayor visibilidad y un guardián con línea de base que solo baja. No entra: cómo se escribe un número, las fechas, Excel, la carta pública del cliente (ver §12, pregunta abierta P-1).

**Lo más barato primero (regla del dueño).** Ya existía `formatearMonto`/`formatearCantidad` (`src/core/pos/formato.ts`, usadas por el POS y 21 archivos más) y `redondearMoneda` (`src/core/moneda.ts`). No se inventó un segundo formateo: la función central **extiende** esas dos (ahora viven en `src/core/formato-de-numero.ts` y `core/pos/formato.ts` las reexporta, así no cambia ningún import existente) y se borró un duplicado (`formatearCantidad` de `server/actions/pos/cuenta-comun.ts`).

## 2. Actores y contexto (nivel 2)

Cualquier persona que lea una pantalla, un ticket, una ficha impresa o un mensaje del sistema (administrador, cocina, mozo). Una sola empresa hoy, varias a futuro: el formato es fijo es-AR/ARS (`MONEDA_FIJA`, decisión del 2026-11-06), no depende de la empresa. Es solo lectura: no hay permisos nuevos ni acciones nuevas.

## 3. Casos de uso (nivel 3)

1. Ver un importe en una tabla, un total, un mensaje: «$ 1.234,50».
2. Ver una cantidad de insumo con su unidad: «0,22 kg», «3 unidad», «1.250 g».
3. Ver un porcentaje: «12,5 %».
4. Ver un conteo (ventas, filas): «1.234».
5. Ver que falta un dato: «—» (nunca un 0 inventado).
6. Exportar a Excel: el número viaja como número.

## 4. Conceptos (nivel 4)

Cinco tipos de número mostrado: **dinero**, **cantidad** (con o sin unidad), **entero** (conteo), **porcentaje**, y **sin dato**. Una función por tipo en `src/core/formato-de-numero.ts`: `formatearMonto`, `formatearCantidad`, `formatearCantidadConUnidad`, `formatearEntero`, `formatearPorcentaje`, más `SIN_DATO = "—"`. Un número que no es de ninguno de estos (versión «v3», orden de un paso, número de mesa, número de ticket, un id) es un **identificador u ordinal** y no se formatea: va tal cual.

## 5. Invariantes y políticas (nivel 5)

| # | Regla | Estado |
|---|---|---|
| R-1 | Separador de miles SIEMPRE (`useGrouping: "always"`: sin eso, ICU puede no agrupar los de 4 cifras) | CONFIRMADA |
| R-2 | Dinero: 2 decimales con relleno; se redondea con `redondearMoneda` (decimal exacto, empates alejándose del cero, igual que `NUMERIC` de Postgres) ANTES de mostrar | CONFIRMADA (2 decimales) / VERIFICADO (redondeo existente) |
| R-3 | Cantidad: hasta los decimales de su unidad (0 a 6); sin unidad conocida, hasta 4 (la precisión de las columnas) | CONFIRMADA |
| R-4 | Cantidad SIN ceros de relleno («0,22 kg», no «0,220 kg») | PROPUESTA (alternativa: relleno fijo a los decimales de la unidad; con kg a 3 decimales se vería «0,220 kg») |
| R-5 | Separador número-unidad: espacio común; las celdas numéricas llevan `whitespace-nowrap` para que no se parta | PROPUESTA (el espacio que no se parte rompería los tests que buscan texto con espacio común) |
| R-6 | Porcentaje: «12,5 %», hasta 2 decimales sin relleno (el de las opciones de venta admite 4: «7,125 %», con `formatearCantidad(…, 4)`) | PROPUESTA |
| R-7 | Entero (conteo): con separador de miles, sin decimales | PROPUESTA |
| R-8 | Sin dato (`null`, `undefined`, `NaN`, `±Infinity`): «—», el patrón que ya usaban los reportes. Nunca se muestra un 0 que no existe. «pendiente de completar» queda para los textos de la ficha técnica (no es un número) | PROPUESTA (patrón existente) |
| R-9 | Negativo: «-$ 1.000,50», «-1,5». Un valor que redondea a cero sale sin signo («$ 0,00», no «-$ 0,00») | PROPUESTA |
| R-10 | Los números de una tabla se alinean a la derecha, con cifras de ancho fijo (`tabular-nums`) | CONFIRMADA (derecha) |
| R-11 | Si una cantidad tiene unidad, en tablas la unidad va DENTRO de la celda de la cantidad (una sola columna «Cantidad»: «0,22 kg»); se sacó la columna «Unidad» suelta | PROPUESTA |
| R-12 | Un `Decimal` de Prisma se convierte con `Number()` en el borde (ya es la práctica del repo). Un importe de hasta 2 decimales cabe exacto en un double hasta 2^53 centavos | VERIFICADO |

## 6. Historia y persistencia (nivel 6)

No cambia nada guardado. Los montos y cantidades se siguen guardando como estaban (`Decimal`/centavos); esto solo cambia el texto que se dibuja. Sin migración.

## 7. Atomicidad y concurrencia (nivel 7)

No aplica: funciones puras de texto, sin estado, sin base. Repetirlas da siempre el mismo texto (idempotentes por construcción).

## 8. Acceso e interfaces (nivel 8)

Sin permisos nuevos: cada pantalla sigue exigiendo los que ya tenía. Piezas nuevas:

- `src/core/formato-de-numero.ts`: la función central (dominio, pura, sin React).
- `src/ui/componentes/datos/celda-numerica.tsx`: `<CeldaNumerica>`, el `<td>`/`<th>` alineado a la derecha, `tabular-nums`, `whitespace-nowrap`. `TablaDeDatos` y `TablaReporte` (que ya tenían `alinear: "derecha"`) ganaron las mismas clases en esas columnas. Se reutilizó lo existente; no hay componente de tabla nuevo.
- `test/arquitectura/cerco-numero-sin-formato-central.test.ts` + `linea-de-base/numero-sin-formato-central.json`: el guardián.

## 9. Consultas y experiencia (nivel 9)

### Tabla «¿qué pasa si…?»

| Situación | Qué se ve |
|---|---|
| Cero | «$ 0,00», «0», «0 %» (es un dato real: sale cero) |
| Negativo | «-$ 1.000,50», «-1,5 kg» |
| `-0` o un resto que redondea a cero (-0,004 en dinero) | «$ 0,00», sin signo |
| `null`, `undefined` | «—» |
| `NaN`, `±Infinity` | «—» (no se imprime «NaN» ni «∞») |
| Muy grande (1e21) | «$ 1.000.000.000.000.000.000.000,00» (sin notación científica) |
| Borde de redondeo: 0,005 / 1,005 / 128,045 | «0,01» / «1,01» / «128,05» (empate alejándose del cero; `toFixed` daba «1,00» y «128,04») |
| Unidad con 0 decimales (unidad, porción) | 12,5 → «13»; 1 → «1 unidad» |
| Unidad con 3 o 4 decimales (kg) | 0,22 → «0,22 kg»; 0,0004 con 3 → «0 kg» (por debajo de lo que admite la unidad) |
| Decimales de unidad inválidos (negativo, no entero, más de 6) | caen en 4, como «sin unidad conocida» |
| `Decimal` de Prisma | se convierte con `Number()` antes; la función no recibe objetos `Decimal` |
| Impresión (ticket del POS, ficha de cocina) | el mismo texto: sale de la misma función; `@media print` no cambia |
| Dinero en un mensaje de error/éxito del servidor | la misma función (los 12 mensajes migrados) |

## 10. Pruebas, migración y operación (nivel 10)

**Dimensiones que cambian lo que se ve:** tipo (dinero, cantidad, cantidad con unidad, entero, porcentaje) × valor × decimales de la unidad (0, 2, 3, 4, ninguno) × signo × vacío.

**Oráculo** (escrito aparte del código, sin `Intl`, con aritmética exacta y el punto de miles puesto a mano): `test/core/formato-de-numero.oraculo.ts`. **Test:** `test/core/formato-de-numero.test.ts` recorre las 900 combinaciones tipo × 18 valores (incluidos los bordes de redondeo y 1e21) × 2 signos × 5 decimales, los 5 vacíos × 5 tipos, `-0`, los decimales inválidos y una tabla de casos escritos a mano (los del dueño). **Guardián de dimensiones:** el test falla si `formato-de-numero.ts` exporta algo que el oráculo no declara.

**Guardián de pantallas** (`cerco-numero-sin-formato-central`): cuenta, por archivo, `toLocaleString` de un número, `toFixed`, `new Intl.NumberFormat` y `Number(x)` pelado en JSX/plantillas. Línea de base que solo baja (`BAJAR_CERCOS=1`). Límite declarado: no ve un `number` ya calculado que se imprime pelado ni los enteros sueltos (el AST no tiene el tipo); eso lo cubre este inventario.

**Tests existentes que fijaban justo el formato viejo (declarados, solo formato):**
- `test/pos/formato-de-monto-unico.test.ts`: la tabla pasó de «$ 1.000» a «$ 1.000,00»; se sacó la comparación con el duplicado viejo.
- `test/pos/mesa-card-total.test.tsx`: «$ 18.400» → «$ 18.400,00», «0,5» → «0,50».
- (los demás cambios de texto, ver §11).

**Migración / operación:** ninguna. Reversible con un revert (código puro).

---

## 11. Inventario medido (VERIFICADO, `origin/main` `d231db21`, 2026-11-09)

Método: se recorrió con el compilador de TypeScript (con tipos) cada archivo de `src/` y se contó, por archivo, (a) las llamadas a `formatearMonto`/`formatearCantidad` (**central**), (b) `toLocaleString`/`toFixed`/`Intl.NumberFormat`/`toString` sobre un número (**formato propio**), (c) expresiones de tipo `number`/`Decimal` impresas sin función (**crudo**: es un *candidato*; incluye identificadores y conteos chicos que no se formatean, como la versión de una receta o el orden de un paso, por eso este número sobreestima).

**Total:** 276 archivos de `src/` muestran números: 94+14 llamadas a la función central existente, 171 formatos propios, 711 candidatos crudos.

Pantallas (`.tsx` de `src/app`, `src/components`, `src/ui`): **134 archivos** muestran números. Clasificados por lo que hace el archivo:

| Familia | Archivos | Ya correctos (solo central) | Central + crudo | Formato propio | Crudo |
|---|---|---|---|---|---|
| POS / salón | 19 | 3 | 10 | 0 | 6 |
| Catálogo (productos, recetas, opciones) | 27 | 2 | 3 | 7 | 15 |
| Carta (administración) | 15 | 0 | 0 | 5 | 10 |
| Carta pública (cliente) | 4 | 0 | 0 | 0 | 4 |
| Reportes | 44 | 0 | 0 | 33 | 11 |
| Stock | 7 | 0 | 0 | 3 | 4 |
| Movimientos y traspasos | 11 | 0 | 2 | 4 | 5 |
| Componentes compartidos | 5 | 0 | 1 | 1 | 3 |
| Administración y otros | 2 | 0 | 0 | 0 | 2 |
| **Total** | **134** | **5** | **16** | **53** | **60** |

Fuera de las pantallas, 142 archivos de `core/` y `server/` (mensajes, descripciones de auditoría, el cálculo): 12 mensajes de éxito/error con importes armados a mano (`$${n.toLocaleString("es-AR")}`), los textos de reportes (`periodo-margen.ts`) y alertas.

**Qué había (hallazgos):** el POS ya usaba la función central (por eso el ticket y la mesa «estaban bien», pero con 0 a 2 decimales y sin relleno: «$ 1.234,5»); los reportes eran el grueso del formato propio (`$${x.toLocaleString("es-AR")}`: sin símbolo uniforme, sin 2 decimales: «$1234.5» según el caso); la receta mostraba `Number(ing.cantidad)` (un `Decimal` → «0.22» con punto); la ficha de cocina hacía `String(n).replace(".", ",")` (sin miles: «1250»); la comparativa de proveedores usaba `toFixed(2)` (punto).

## 11 bis. Qué se aplicó en esta etapa

**Función central + componente + guardián** (arriba) y estas pantallas, por orden de visibilidad:

- **Receta** (3 archivos): ingredientes (cantidad con unidad en una celda, merma en %), rendimiento y tamaño de ración; historial de versiones.
- **Ficha de cocina** (core + vista): ingredientes y datos con la misma función; ya no hay una columna «Unidad» aparte.
- **Productos y sus pestañas** (5): factor de conversión, paso de venta, presentaciones, precio por sucursal, margen objetivo, clientes.
- **Stock y movimientos** (14): alertas, consolidado, mínimo, configuración, por familia, reclasificar, conteo de frecuencia, conteo físico, precio local, bandeja de traspasos, reparto, panel de compra.
- **Compras:** reporte de compras + panel de compra por pasos (ya usaba la función; ahora con 2 decimales).
- **Carta / opciones:** carta, agrupados, promociones, selector de precio, `presentacion.ts` (porcentaje de opciones).
- **Costos y márgenes** (reporte con tabla: lo que se muestra en las capturas).
- **12 mensajes del servidor** con importes (éxito/error de precio, pago, mínimo).

**Línea de base del guardián** (lo que queda para las próximas etapas): ver el JSON `linea-de-base/numero-sin-formato-central.json` y el informe final. Queda pendiente el resto de los reportes (`reportes/*`, 27 pantallas con tabla), `en-dolares`, la carta pública del cliente (P-1) y `periodo-margen`.

## 12. Preguntas abiertas y decisiones para el dueño

- **P-1 (PENDIENTE).** La carta pública que ve el cliente (`src/core/carta/precio-carta.ts`) muestra precios sin ceros («$ 1.500»). ¿También con 2 decimales («$ 1.500,00»)? Es una decisión de producto para el cliente final; no se tocó.
- **D-1 (PROPUESTA, R-4).** Cantidades sin ceros de relleno («0,22 kg»). Alternativa: siempre los decimales de la unidad («0,220 kg»).
- **D-2 (PROPUESTA, R-5).** Espacio común entre número y unidad (con `whitespace-nowrap` en celdas) en vez de espacio que no se parte.
- **D-3 (PROPUESTA, R-6).** Porcentaje «12,5 %» con espacio (antes había «12%», «12 %» y «12,5%» según la pantalla).
- **Contacto con «entrada».** La lectura en vivo de lo que se teclea (`core/catalogo/lectura-de-cantidad.ts`) y `campo-numero-logica.ts` quedan como están (excepción declarada del guardián, motivo: son del lado de entrada).
