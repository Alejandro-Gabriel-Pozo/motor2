# Plan: módulo central de validación de datos, fase 1 (compras y precio local) — 2026-09-25

Rama `feat/validacion-datos-compras`. Plan diseñado por un agente de planificación contra el código real (ejecutando la lógica, no
solo leyéndola), confirmado por el dueño del producto e implementado un commit por paso (A, B, C1, C2, C3, D, E), con TDD: cada
guarda nueva se escribió primero y se vio en rojo contra el código anterior. Sin migración ni cambio de `schema.prisma`.

## 1. El problema

`CampoNumero` borraba en silencio todo lo que no fuera dígito o separador, y el servidor convertía lo que no entendía en 0:

| Tecleado | Antes (`normalizar`) | Precio de compra guardado | Precio local |
|---|---|---|---|
| `...,.,.,...` | `"........"` → NaN | **0, sin aviso** | rechazado con el mensaje equivocado («no puede ser negativo») |
| `1.000.000` | NaN | **0, sin aviso** | rechazado con el mensaje equivocado |
| `abc`, `Infinity` | `""` → `Number("")` = 0 | 0 | **0** (con Enter; con clic el blur vaciaba el campo y lo frenaba el `required`) |
| `1,2,3` | `"1.23"` | 1,23 | 1,23 |
| `1e3` | `"13"` | 13 | 13 |
| `5-3` | `"53"` | 53 | 53 |
| `--5` | `"-5"` | 0, sin aviso | rechazado |
| `12,345` (importe) | 12.345 | lo redondeaba la columna | ídem |

Además, en una compra: una línea con cantidad basura o 0 **desaparecía sin aviso**, un peso real negativo o NaN se ignoraba, y 2,5 en
una unidad entera se redondeaba a 3.

## 2. Dónde está y cómo se usa

`src/core/datos/` — todo PURO (sin React, Prisma, `server-only` ni `@/core/movimientos`), así la MISMA función valida en la pantalla y
en la Server Action:

| Archivo | Qué hace |
|---|---|
| `resultado.ts` | `ResultadoDato<T> = { ok: true; valor } \| { ok: false; codigo; mensaje }`, asignable al `Resultado<T>` de la carta. `codigo`: `vacio`, `formato`, `negativo`, `cero`, `decimales`, `rango`, `largo`, `sin_alfanumerico`, `caracteres`. |
| `numero-tecleado.ts` | `interpretarNumero` (parser es-AR estricto), `textoCanonico`, `numeroDelCampo` (vacío → `undefined`, inválido → `NaN`, nunca 0), `tieneALoSumoDecimales`, `numeroDeEntrada` (base de los validadores numéricos). |
| `importe.ts` | `validarImporte(valor, { etiqueta, obligatorio?, permitirNegativo?, permitirCero? })`. `DECIMALES_IMPORTE = 2`, `IMPORTE_MAXIMO = 1e12` (tope de `Decimal(14,2)`). |
| `cantidad.ts` | `validarCantidad(valor, { nombre, decimales }, { etiqueta, obligatorio?, permitirNegativo?, permitirCero? })`. `CANTIDAD_MAXIMA = 1e10` (tope de `Decimal(14,4)`). |
| `nro-factura.ts` | `validarNroFactura(valor)`: recortado, vacío → `null`, hasta `LARGO_MAXIMO_NRO_FACTURA` (60), al menos una letra o número. |
| `nombre-catalogo.ts` | `validarNombreCatalogo(valor, etiqueta, { obligatorio })`: `validarTextoCatalogo` + no vacío si es obligatorio + al menos una letra o número. Todavía no lo usa ningún circuito (fase futura). |

Criterios comunes: aceptan `unknown` (protegen igual a una llamada directa, un script, un seed o una futura API); los mensajes siguen
el patrón de `texto.ts` (`${etiqueta} …`); `texto.ts` y `numero.ts` quedan intactos para los circuitos no migrados;
`redondearMoneda` y `redondearACantidadDeUnidad` siguen siendo para montos y cantidades CALCULADOS. Para la ENTRADA, «redondeo
uniforme» significa **rechazar** más decimales de los admitidos, no redondear en silencio.

**Pantalla**: `CampoNumero` interpreta con `interpretarNumero`. Emite `""` si está vacío, el texto canónico (`"1234.56"`) si es un
número, y el texto TAL CUAL si no lo es (nunca `""` ni `"0"`, así un `required` o un `!== ""` lo cuentan como cargado). Con texto
inválido queda `aria-invalid` y con `setCustomValidity(mensaje)`: el navegador frena el envío con la validación nativa. Props
opcionales y serializables: `tipo` (`"importe"` usa `validarImporte`; `"cantidad"` usa `validarCantidad`), `etiqueta`, `decimales`,
`permitirNegativo`. Los formularios migrados convierten con `numeroDelCampo`, nunca con `Number()`.

**Servidor**: vuelve a validar todo con las mismas funciones (la garantía real para lo que no pasa por la pantalla). Las firmas de las
Server Actions siguen tipadas `number` en esta fase.

## 3. Reglas por tipo de dato

- **Número tecleado** (`interpretarNumero`): recorta espacios; vacío → `null`. Un solo `-` al inicio (si el signo está permitido lo
  decide cada validador). Cualquier carácter que no sea dígito, `,` o `.` es error de formato (`$`, espacios internos, `e`, `+`, `%`,
  `Infinity`). Un solo separador es el DECIMAL, sea coma o punto. El mismo separador repetido es de MILES y tiene que agrupar bien
  (primer grupo de 1 a 3 dígitos, los siguientes de 3). Con los dos separadores, el último es el decimal (una sola vez) y el otro tiene
  que ser una agrupación de miles válida. Acepta `,5` y `5,` (tecleo a medias).
- **Importe**: número finito; no negativo salvo `permitirNegativo`; el 0 se acepta salvo `permitirCero: false`; menor que 1e12; a lo
  sumo 2 decimales. Vacío: `null`, o «Falta …» si es obligatorio.
- **Cantidad**: número finito; mayor que cero salvo `permitirCero` / `permitirNegativo`; menor que 1e10; a lo sumo los decimales de
  SU unidad (`Unidad.decimales`). En una compra, la unidad es la de compra efectiva: la presentación elegida, si no
  `producto.unidadCompra`, si no la de stock. El peso real se mide en la unidad de stock.
- **N.º de factura**: texto libre del proveedor (`#`, `/`, `*` o un `-` inicial son válidos), recortado, hasta 60 caracteres y con al
  menos una letra o número. No se cambia ninguna otra normalización: el valor es la clave del índice
  `Operacion_factura_unica_vigente_key`.

### Tabla de compatibilidad del parser

| Texto | Antes (`normalizar` → número) | Ahora |
|---|---|---|
| `10`, `1000`, `-5`, `1,5`, `1.5`, `0,07`, `1.234,56`, `1,234.56`, `1.000.000,50` | mismo número | mismo número |
| `1.234` / `1,234` | 1,234 | 1,234 (ambigüedad a propósito: un solo separador es el decimal; si es un importe, lo frena la regla de 2 decimales) |
| `,5` / `5,` | 0,5 / 5 | 0,5 / 5 |
| `1.000.000` | NaN (→ 0 en el servidor) | **1.000.000** |
| `1,000,000` | **1** | **1.000.000** |
| `1,2,3` | 1,23 | error de formato |
| `1.23,4` | 123,4 | error de formato |
| `1.2.3`, `...,.,.,...` | NaN (→ 0 en el servidor) | error de formato |
| `abc`, `Infinity`, `NaN` | `""` (→ `Number("")` = 0 en el formulario) | error de formato |
| `1e3`, `5-3`, `--5`, `+5` | 13 / 53 / -5 / 5 | error de formato |
| `$ 100`, `$100`, `1 000`, `10%` | 100 / 100 / 1000 / 10 | error de formato |

(Columna «Antes» obtenida ejecutando el `normalizar` de `b7aaf98`, no leyéndolo.)

## 4. Decisiones

- **Sin Zod ni dependencias nuevas.** Zod no interpreta «1.234,56» (habría que escribir el parser igual, envuelto en
  `.transform/.refine`); el proyecto ya tenía su convención `Resultado<T>` con mensajes exactos que varios tests exigen; `CampoNumero`
  es cliente y lo usan 13 pantallas; las Server Actions reciben argumentos tipados, no `FormData`. Reconsiderar si llega una API
  pública o una importación con payloads de objetos (puede envolver estas mismas funciones). `next-safe-action` no se evalúa: choca con
  `ResultadoAccion`, con `conPermiso` como primera línea obligatoria y con los tests de arquitectura que analizan ese patrón.
- **Compra Y Devolución a proveedor** (decisión del dueño): la validación nueva se activa para los dos procesos que comparten
  `transicion.aplicaFactorConversion` (mismo bloque de código, mismos campos). Los otros 7 procesos de `registrarMovimiento` siguen con
  `!(cantidad > 0)` (saltean la línea) y `esNumeroFinito`, sin cambios.
- **Cantidad 0 en una compra se RECHAZA** (decisión del dueño): «La cantidad de "X" tiene que ser mayor que cero.», en vez de saltear
  la línea en silencio.
- **`$` y espacios internos se rechazan**: el símbolo va al costado del campo (prop `prefijo`), nunca dentro de lo tecleado.
- **Precio de compra vacío sigue permitido** (se guarda 0) y el 0 también.
- **Límite de esta fase**: en la compra la pantalla no conoce los decimales de la unidad (`SelectorProducto` no los trae); la regla
  de decimales por unidad la aplica SOLO el servidor.
- **Limitación de persistencia anterior a este plan (no se resuelve acá)**: `MovimientoStock.precioTotal` no admite null (default 0):
  «compra sin precio» y «precio 0» siguen siendo iguales EN LA BASE (el validador sí los distingue en memoria). Hacer la columna
  nullable requiere autorización expresa.

## 5. Qué cambió en esta fase

| Circuito | Archivo | Cambio |
|---|---|---|
| Todas las pantallas con `CampoNumero` | `src/components/campo-numero.tsx` | parser central, `aria-invalid` + `setCustomValidity` con texto inválido |
| Compra / Devolución a proveedor (servidor) | `src/server/actions/movimientos/movimientos.ts` | `validarCantidad` (unidad de compra), `validarImporte` (precio total), `validarCantidad` (peso real), `validarNroFactura` |
| Corrección de compra | `src/core/compras/correccion.ts`, `formulario-corregir-compra.tsx` | `validarNroFactura`; `maxLength` con la constante |
| Compra (pantalla) | `panel-movimiento-form.tsx` | `numeroDelCampo`; precio total con `tipo="importe"` |
| Precio local | `precio-local.ts`, `precio-local-form.tsx` | `validarImporte` en las dos acciones y en el campo; `numeroDelCampo` |

**Guarda de arquitectura**: `test/arquitectura/validacion-de-datos-en-un-solo-lugar.test.ts`. Los archivos de su lista `MIGRADOS` no
pueden volver a usar `esNumeroFinito(` ni `validarLargoTexto(` (y las pantallas, `Number(` sobre lo que viene de un `CampoNumero`).
Cada fase futura agrega los archivos que migra. `movimientos.ts` queda afuera a propósito (los procesos no migrados siguen usando
`esNumeroFinito`).

**Riesgo aceptado**: las pantallas fuera de alcance que envían con `onClick` (no con el submit de un form) mandan ahora un texto
inválido como `NaN` en vez de `""`/0; se cubre cuando se migre cada circuito.

## 6. Fuera de este plan — a replicar en fases siguientes

- **Ventas**: `venta.ts` (N.º de factura), `registrar-venta.ts` (`cantidadVendida`), `venta-form.tsx`.
- **Los otros 7 procesos de `registrarMovimiento`** (Producción, Consumo, Ajuste, Transferencia, Merma, Devolución al consignante,
  Devolución de cliente).
- **Conteo físico.**
- **Traspasos entre sucursales, reclasificación, stock mínimo y frecuencia de conteo.**
- **Pago a consignante** (`reportes/consignacion.ts`).
- **Productos**: `precioVenta`, `precioConsignacion`, `factorConversion`, presentaciones y la sincronización de precio de grupo.
- **Recetas.**
- **POS**: `validarCantidadPedido`, mesas.
- **Carta**: `validarPrecioCarta`.
- **Nombres de catálogo** (unidades, productos, proveedores, categorías, insumos, grupos, secciones, roles, sucursales) con
  `validarNombreCatalogo`: hoy pasan nombres como `"()"` o `"..."`.
- **Las otras 11 pantallas con `CampoNumero`** (producto, recetas, venta, conteo físico, stock mínimo, reclasificar, frecuencia de
  conteo, traspasos ×2, presentaciones, pago a consignante): hoy solo reciben el parser, sin `tipo`.
- **Pasar los `decimales` de la unidad a `CampoNumero` en la compra** (hoy la regla por unidad la aplica solo el servidor).
- **Ampliar las firmas de las Server Actions a `number | string`** para importaciones.

## 7. Convención nueva (2026-09-25, decisión del dueño): guard por feature

A partir de este plan, la regla es: **cada feature que recibe o modifica datos tiene su propio guard, que USA las funciones
comunes de `src/core/datos/` en vez de reemplazarlas.**

```text
src/core/datos/            src/core/features/
├── importe.ts             ├── compras/
├── cantidad.ts             │   ├── compra.schema.ts   (tipos: entrada sin validar, salida validada)
├── nro-factura.ts          │   └── compra.guard.ts     (formato + normalización, puro)
├── nombre-catalogo.ts      ├── ventas/…
└── numero-tecleado.ts      └── …
```

El guard NO hace de todo: cubre formato (vía `src/core/datos/`) y normalización de lo que se tecleó, ANTES de que la Server Action
calcule o toque la base. Las reglas que necesitan Prisma (producto existe, factura duplicada, stock alcanza) siguen en la Server
Action, que resuelve lo que hace falta de la base y le pasa al guard los datos YA resueltos (ver `guardLineaCompra`: recibe la
unidad de compra efectiva ya calculada, no la busca ella misma) — mismo principio que ya usa el resto de `src/core/` en este
proyecto: puro, sin Prisma ni permisos.

**Retrofit de este plan** (Paso C1, hecho ANTES de mergear, sin cambio de comportamiento — los 91 tests de
`registrar-movimiento`/`compras-correccion`/`compras-corregir`/la guarda de arquitectura siguieron en verde sin tocarlos):
`src/core/features/compras/compra.guard.ts` con `guardLineaCompra` (cantidad + precio total + peso real de una línea) y
`guardNroFacturaCompra` (mismo validador en la carga y en la corrección). `registrarMovimiento` y `core/compras/correccion.ts`
llaman al guard en vez de a `validarCantidad`/`validarImporte`/`validarNroFactura` directamente.

**Fases futuras**: cuando se migre Ventas, Precios, Ajuste de stock, etc. (sección 6), cada una arma su propio
`src/core/features/<feature>/<feature>.guard.ts` con el mismo patrón — no un guard genérico para todas.
