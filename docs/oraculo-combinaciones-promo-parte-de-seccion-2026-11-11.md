# Oráculo de combinaciones: partes de promo con opciones — 2026-11-11

Etapa **E1a** de `docs/diseno-promo-parte-de-seccion-2026-11-11.md` (§5 y §5.3; PR #227, solo docs). Es la tabla de reglas esperadas **escrita aparte del código** que exige la regla «Combinaciones» de `AGENTS.md`. La ejecuta `test/pos/promo-parte-de-seccion-oraculo.test.ts`, que recorre TODO el producto cartesiano de las dimensiones contra el código real (`src/core/pos/promo-combo.ts`, `plato-de-seccion.ts`, `opciones-permitidas-de-entrada.ts`, `configuracion-de-entrada-a-elegir.ts`) y compara con `test/pos/promo-parte-de-seccion.oraculo.ts` (la misma tabla en código). Si la tabla y el código discrepan, falla el test; la tabla no se genera del código.

Estado de las decisiones: las de negocio son **CONFIRMADAS** por el dueño el 2026-11-11 (diseño §7). Lo que agrega esta etapa y no está en el diseño se marca **PROPUESTA** y se detalla en «Diferencias con el §5 del diseño».

## El caso

Una parte con cupo de **3 a 4 unidades**, un plato «bajo prueba» y un plato siempre válido (`otro`, sin opciones, $ 1.500).

| Plato (K) | Grupos | Guardado | Lista de lo elegible |
|---|---|---|---|
| `SIN_GRUPOS` | ninguno | $ 18.000 | $ 18.000 |
| `SOLO_OPCIONALES` | Salsa (VARIANTE, 0 a 1: Ketchup, Mayo +$ 500) · Extras (ADICIONAL opcional: Huevo) | $ 18.000 | $ 18.000 (sin salsa o con Ketchup) · $ 18.500 (con Mayo) |
| `CON_OBLIGATORIO` | Taza (MEDIDA en diferencia, 1 a 1: Chica, Grande +$ 2.000) · Extras (ADICIONAL opcional) | $ 18.000 | $ 18.000 (Chica) · $ 20.000 (Grande) |
| `ADICIONAL_OBLIGATORIO` | Salsa · Extras con el adicional **obligatorio** (1 a 3) | $ 18.000 | no se ofrece nunca |
| `BASE_POR_OPCION` | Tamaño (MEDIDA en ABSOLUTO, 1 a 1: Chica $ 9.000, Grande $ 15.000) · Extras | $ 9.000 (no se cobra) | $ 9.000 (Chica) · $ 15.000 (Grande) |

## Dimensiones (las que cambian lo que se acepta o el peso del reparto)

| Dimensión | Valores |
|---|---|
| **M** modo de la parte (M y F del diseño juntos: F solo existe con «Solo estos platos») | `TODA_LA_SECCION` · `SOLO_ESTOS_FIJAS` · `SOLO_ESTOS_A_ELEGIR` |
| **K** tipo de plato | `SIN_GRUPOS` · `SOLO_OPCIONALES` · `CON_OBLIGATORIO` · `ADICIONAL_OBLIGATORIO` · `BASE_POR_OPCION` |
| **X** lo elegido | `DENTRO` (una opción del plato) · `SIN_ELEGIR` (el plato sin opciones) · `OPCION_FUERA` (el adicional Huevo, que nunca se ofrece) · `PLATO_FUERA` (un plato que no es de la parte) |
| **G** la opción elegida en la sucursal | `ACTIVA` · `APAGADA` |
| **P** el plato en la sucursal | `DISPONIBLE` · `APAGADO` · `SIN_ORIGEN_DE_STOCK` |
| **Q** total de la parte | `BAJO_MIN` (2) · `EN_RANGO` (3) · `SOBRE_MAX` (5) |
| **R** repetición | `DISTINTOS` (el plato y 1 unidad del otro) · `MISMO_PLATO_X2` (todas las unidades del mismo plato, en una fila: el 2x1) |
| **V** versión de la opción | `VIGENTE` · `VIEJA` |

4.320 combinaciones brutas; **540 imposibles** (se declaran y no se prueban): `X = OPCION_FUERA` con `K = SIN_GRUPOS` (no hay de qué salirse) y `G = APAGADA` con `K = SIN_GRUPOS` (no hay opción que apagar). Se prueban **3.780**.

**Declaradas sin efecto** (no son dimensión): la sucursal (la promo ya viene filtrada), quién es el mozo, el medio de pago, el precio local (cambia el importe, no lo que se acepta). El plato del día (`DEL_DIA`) no lleva opciones (ADR-032:51) y queda fuera.

## Reglas esperadas (gana la primera que se cumple, en este orden)

| # | Condición | Resultado |
|---|---|---|
| R1 | `X = PLATO_FUERA`; `P = APAGADO`; `K = ADICIONAL_OBLIGATORIO` (un adicional obligatorio rompe el precio fijo, I3); «el mozo elige» con `K = SIN_GRUPOS` (no hay nada para elegir); con «Solo estos platos», `P = SIN_ORIGEN_DE_STOCK` (la lectura no trae la entrada) | **Se rechaza: el plato no se ofrece** |
| R3 | «Solo estos platos» con opciones fijas y el mozo manda opciones | **Se rechaza**: «no se eligen opciones» |
| R7 | `Q = BAJO_MIN` / `Q = SOBRE_MAX` (el mínimo y el máximo son del conjunto de la parte, I2) | **Se rechaza**: «Elegí al menos…» / «Como máximo…» |
| R4 | `X = OPCION_FUERA` (un adicional), o `X = DENTRO` con `G = APAGADA` | **Se rechaza** `OPCION_NO_PERMITIDA_EN_PROMO` |
| R5 | `X = DENTRO` y `V = VIEJA` | **Se rechaza** `OPCION_CAMBIO` |
| R6 | `X = SIN_ELEGIR` con `K = CON_OBLIGATORIO` o `BASE_POR_OPCION` | **Se rechaza** `OPCIONES_INVALIDAS` (falta el mínimo del grupo) |
| R8 | «Toda la sección» con `P = SIN_ORIGEN_DE_STOCK` (se detecta al armar el componente) | **Se rechaza**: el plato no tiene origen de stock |
| R9 | lo demás | **Se acepta**. El total cobrado es SIEMPRE el precio de la promo (I1). El peso del reparto es el **precio de lista de la configuración elegida** (I8): $ 18.000 · $ 18.500 (con Mayo) · $ 20.000 (Grande) · $ 15.000 (Grande de la base por opción); nunca el guardado. Con «Solo estos platos» fijas lo fija la entrada. |

Además, con `R = MISMO_PLATO_X2` el resultado es **el mismo** que con `DISTINTOS` (CONFIRMADA: el 2x1 se acepta).

**I12 (aparte del producto cartesiano):** una parte sin ningún plato elegible hoy y con mínimo mayor que 0 **nunca se abre a «todos»**: cualquier plato que mande el cliente se rechaza y, sin elegir nada, falla el mínimo (`promo-parte-de-seccion-oraculo.test.ts`, último bloque).

## Diferencias con el §5 del diseño (a confirmar por el orquestador)

1. **Valor nuevo `X = SIN_ELEGIR`** (PROPUESTA): el §5.1 no lo tiene, pero la regla 6 («sin el mínimo del grupo») no se puede probar sin una elección sin opciones. El §5.1 queda en 3 valores de X y acá son 4 (por eso 4.320 brutas y no 3.240).
2. **Orden de la regla de cupo**: el §5.2 pone el mínimo y el máximo de la parte (`Q`) al final; el servidor valida primero la elección entera con sus cupos (`validarYAplanarEleccionPromo`) y recién después arma cada plato. Cambia solo QUÉ mensaje se da cuando hay dos problemas a la vez; se acepta o se rechaza exactamente igual. La tabla sigue el orden real.
3. **Reglas 1 y 2 juntas (R1)**: en el servidor «el plato no es de la parte», «está apagado» y «no se ofrece» salen por el mismo camino (el plato no está entre los elegibles), así que no se pueden distinguir por causa; se declaran como una sola.
4. **`SIN_ORIGEN_DE_STOCK`**: con «Solo estos platos» la lectura de la sucursal no trae la entrada (R1); con «Toda la sección» el plato sigue entre los elegibles y lo rechaza el armado (R8), como hoy lo hace el chequeo de receta de `agregarItemsCasoDeUso`. Es el único valor de `P` cuya causa cambia con el modo.
5. **«El mozo elige» permite todas las opciones no adicionales** del plato en este oráculo; el subconjunto de opciones permitidas (lo que el dueño tilda) lo recorre `promo-a-elegir-oraculo.test.ts` (288 combinaciones).

## Guardián

`promo-parte-de-seccion-oraculo.test.ts` falla si aparece un valor nuevo, sin declarar, en:

- `TIPOS_DE_CUPO` (`SECCION`, `LISTA`, `DEL_DIA`) → `TIPOS_DE_PARTE_DECLARADOS`;
- el CHECK `EntradaDeCupo_modo_de_opciones_chk` de la base (`FIJAS`, `A_ELEGIR`), leído de la migración `20261105120000_promo_entrada_a_elegir` → `MODOS_DE_ENTRADA_DECLARADOS`;
- `TIPOS_DE_GRUPO_DE_OPCIONES` (`MEDIDA`, `VARIANTE`, `INCLUIDA`, `ADICIONAL`) → `TIPOS_DE_GRUPO_DECLARADOS`.

Cada valor se declara como dimensión (con su regla) o «sin efecto» con el motivo. `INCLUIDA` no entra al producto cartesiano: se prueba aparte en `test/pos/plato-de-seccion.test.ts` (se elige como una variante sin recargo).

**Límite del guardián (NO VERIFICADO de punta a punta):** vigila esas tres listas cerradas. Una columna u opción nueva que cambie lo que se acepta y NO sea una de esas tres listas no la detecta sola: hay que sumarla a este documento cuando se diseñe.
