# Diseño: rendimiento real de recetas por sucursal (estimación estadística)

Documento de diseño, no de grounding — sintetiza la conversación completa
sobre "carne compartida entre platos sin disciplina de registro en la
cocina", apoyado en los tres relevamientos previos
(`docs/grounding-ficha-tecnica-tandoor.md`,
`docs/grounding-merma-productos-compartidos.md`,
`docs/grounding-desposte-grocy.md`). No se implementa nada acá — es la
base para decidir antes de tocar código.

---

## 1. El problema real (resumen de la conversación)

El negocio compra materias primas (ej. nalga, bife, lomo, cuadrada) que se
usan de forma intercambiable en varios productos de venta (ej. Milanesa,
Bife), y la cocina no tiene — ni va a tener realistamente — disciplina de
registro de "qué corte fue a qué plato". Esto no es un caso especial de la
carne: se confirmó que **ningún** ingrediente tiene una proporción confiable
hoy, ni siquiera los aparentemente simples (huevo, pan rallado) — la
pregunta de fondo es "¿cuánto consume realmente cada plato?", para todo.

Restricción de arquitectura ya confirmada: **la Receta es global**
(`Producto`/`RecetaVersion`/`RecetaIngrediente`, sin `sucursalId`, viven en
el Catálogo Central compartido por las 5 sucursales — `prisma/schema.prisma:216,414,427`).
Las Compras y Ventas, en cambio, sí son por sucursal
(`MovimientoStock.sucursalId`). Cada sucursal tiene su propio cocinero, con
hábitos de consumo genuinamente distintos.

## 2. Principios de diseño acordados

1. **Un solo modelo, no dos intercambiables.** No hay modo "declarativo" vs.
   "estimado" — toda cantidad en `RecetaIngrediente` es siempre "la mejor
   estimación vigente", sea que se haya tipeado a mano o aceptado de una
   sugerencia. Evita tener que clasificar cada ingrediente de antemano y
   evita mantener dos caminos de código.
2. **La Receta es el ESTÁNDAR elegido, no "la verdad".** Si el consumo real
   varía genuinamente entre sucursales (cocineros distintos), no existe una
   receta física "exacta" única para descubrir — existe un estándar que el
   negocio elige (puede arrancar siendo una receta de internet), y una
   medición de cuánto se desvía cada sucursal de ese estándar. Misma lógica
   que ya usa el stock físico en todo el sistema: no se persigue precisión
   perfecta, se mantiene una aproximación razonable y se corrige
   periódicamente con una herramienta real (ahí Conteo Físico, acá este
   reporte).
3. **Reutilizar Insumo para lo sustituible, no crear una tabla de "pool"
   nueva.** Nalga/bife/lomo/cuadrada agrupadas bajo un mismo `Insumo` (ya
   construido en la sesión de "hermanar productos"). La receta de un plato
   sigue apuntando a UNA MP ancla; `resolverConsumoPorFamilia` (ya
   existente) decide solo, por FEFO, de cuál corte real descontar en cada
   venta. La estimación estadística trabaja a nivel del POOL completo (todo
   lo comprado del Insumo), no por corte individual — menos incógnitas, más
   resoluble.
4. **El cálculo corre POR SUCURSAL, nunca mezclado entre sucursales.**
   Mezclar promedia al cocinero que gasta poco con el que gasta mucho y
   destruye la señal que hace falta para comparar. Cada sucursal tiene su
   propio coeficiente estimado, calculado solo con sus propios datos.
5. **Aceptar una sugerencia genera una versión nueva de receta** — reusa el
   versionado append-only que ya existe (`guardarReceta`), no inventa un
   mecanismo de actualización paralelo. Es siempre una decisión humana, el
   sistema nunca actualiza la receta solo.
6. **Sin cambios de schema en Catálogo.** `Producto`, `RecetaVersion`,
   `RecetaIngrediente`, `Insumo` quedan exactamente como están. Todo lo
   nuevo es lectura (un reporte) sobre datos que `MovimientoStock` ya
   guarda hoy (Compra y Venta, con fecha y sucursal).

   > **Actualización 2026-09-26 (docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, decisión del dueño):** este
   > principio SE MANTIENE en su forma original — `RecetaVersion`/`RecetaIngrediente` (ingredientes, pasos, unidades)
   > siguen siendo una sola fila global, sin `sucursalId`, editable solo desde el editor central. Lo que cambió es que
   > "Usar este valor" (§3.5, reescrita más abajo) dejó de escribir esa fila central: ahora escribe una tabla NUEVA,
   > `RendimientoLocalIngrediente` — un override LIVIANO de `cantidad`/`mermaPorcentaje` por (línea de receta, sucursal),
   > exactamente el mismo patrón que `PrecioLocalProducto` (precio local por sucursal, ya existente). No es una
   > excepción al principio 6: la Receta (qué ingredientes lleva, en qué unidad, con qué pasos) sigue siendo una sola;
   > lo que ahora puede variar por sucursal es cuánto rinde en la práctica cada línea, igual que el precio de venta ya
   > podía variar por sucursal sin que eso hiciera del Producto algo "por sucursal".

## 3. Qué se agrega — el reporte

### 3.1 Alcance de una corrida

Por sucursal (una sucursal por vez o varias en paralelo, cada una calculada
por separado), un rango de fechas (semanal o mensual — necesita varios
períodos para que el sistema de ecuaciones sea resoluble, ver §4).

### 3.2 Qué consulta trae los datos (reusa el patrón ya existente)

Mismo patrón que `src/core/reportes/periodo.ts` (`calcularVentasDelPeriodo`,
filtro por `sucursalId`+`proceso`+rango de fecha sobre `MovimientoStock`):

- **Compras**: `SUM(cantidad)` de proceso `COMPRA`, agrupado por semana ×
  Insumo (si el producto tiene `insumoId`, se agrupan todos sus hermanos
  activos juntos — es el pool completo) o por `productoId` (si no tiene
  Insumo asignado, va solo).
- **Ventas**: `SUM(cantidad)` de proceso `VENTA`, agrupado por semana × PV,
  para cada PV cuya receta vigente tiene una línea que apunta a ese
  Insumo/producto.

### 3.3 Dos casos, dos niveles de esfuerzo (fase 1 y fase 2 — no construir la 2 sin necesitarla)

**Caso simple (un solo PV consume de ese Insumo/producto) — Fase 1, sin
regresión de verdad:**

```
coeficiente = Σ(compras del período) / Σ(ventas de ese PV en el período)
```

Es una división. No hace falta álgebra lineal para esto — la mayoría de los
ingredientes de la mayoría de los negocios van a caer acá (ej. pan rallado,
si solo lo usa Milanesa). Construir esto primero: barato, cubre el caso más
común, con valor inmediato.

**Caso compartido (2+ PVs consumen del mismo Insumo/producto) — Fase 2,
regresión real:**

Para cada semana `t` con datos:

```
compras_pool(t) ≈ Σ_j  ventas_PVj(t) × coeficiente_j   +  error(t)
```

Con `S` semanas de historial y `J` platos que comparten el pool, es un
sistema de `S` ecuaciones y `J` incógnitas (los `coeficiente_j`) — resoluble
por mínimos cuadrados si `S > J` y hay variación real en la mezcla de
ventas semana a semana (si siempre se vende la misma proporción de
Milanesa/Bife, el sistema queda mal condicionado — no hay forma matemática
de separar cuánto aportó cada uno, y el reporte tiene que decirlo
explícitamente en vez de devolver un número engañoso).

### 3.4 Salida — por sucursal, nunca promediada

Para cada sucursal incluida en la corrida, por cada línea de receta:

| Plato | Insumo/MP | Receta actual (estándar) | Estimado esta sucursal | Desvío | Confianza |
|---|---|---|---|---|---|
| Milanesa | Carne vacuna (pool) | 180 g | 210 g | +17% | Alta (12 semanas, buena variación) |
| Bife | Carne vacuna (pool) | 220 g | 195 g | −11% | Alta |
| Milanesa | Pan rallado | 40 g | 38 g | −5% | Media (6 semanas) |

"Confianza" es una señal simple (cantidad de períodos con datos + cuánta
variación real hubo en la mezcla de ventas), no una probabilidad estadística
formal — el objetivo es que el dueño sepa cuándo confiar en el número y
cuándo el sistema todavía no tiene suficiente para opinar.

### 3.5 Acción sobre el reporte (reescrita 2026-09-26 — ver decisión del dueño)

**Versión original de este documento (descartada):** un botón "Usar este valor como nuevo estándar" abría el editor de
receta CENTRAL prellenado, vía `actualizarIngredienteDeReceta` — la sugerencia terminaba siempre en la fila global,
sin importar desde qué sucursal se la haya aceptado. Ese es justo el bug que motivó todo el plan de 2026-09-26: nunca
había forma de calibrar "lo que rinde ACÁ" sin tocar lo que rinde en todas las demás sucursales a la vez.

**Versión implementada:**

- Ver varias sucursales lado a lado para la misma línea de receta sigue existiendo — ahora es una pantalla propia,
  `/reportes/rendimiento-recetas/por-sucursal` (D8): columnas = central + una por sucursal de `ctx.membresias`,
  comparando el BRUTO (`cantidad × (1 + merma/100)`, para que no engañe si dos sucursales calibraron mermas
  distintas), con el desvío contra la central marcado en ámbar.
  Ninguna sucursal fuera de `ctx.membresias` aparece nunca, ni su calibración.
- "Usar este valor" en una fila del reporte principal (`/reportes/rendimiento-recetas`) YA NO navega a ningún lado:
  pide confirmación EN LA MISMA FILA (el porqué a la vista — comprado/vendido/confianza, o platos/semanas/ajuste R²
  para un pool) y, si se confirma, calibra la **sucursal activa** con `fijarRendimientoLocal` — nunca la receta
  central, nunca otra sucursal (la acción no recibe `sucursalId` por parámetro, siempre usa la de la sesión). La
  confirmación deja claro que el cambio es local: "Esto cambia solo el rendimiento de «Centro». La receta central (1
  kg) y las otras sucursales no se tocan.", con un enlace a la comparación de arriba.
- **Regla de la merma congelada (D4, decisión del dueño):** al aplicar una sugerencia se escriben `cantidad` (el
  estimado NETO, igual que antes) Y `mermaPorcentaje` — la merma EFECTIVA que se usó para calcular ese estimado — a
  la vez. Antes de esta decisión, calibrar solo la cantidad y dejar la merma vieja podía hacer que el número
  guardado ya no coincidiera con el que motivó la sugerencia.
- Si la sucursal ya calibró esa línea, aparece "Volver al valor central" (pone la calibración en `null`, no borra la
  fila — mismo criterio "nunca DELETE" del resto del catálogo).
- **Regla del arrastre entre versiones (D3):** la receta central se sigue editando y versionando (append-only) sin
  ninguna restricción nueva. Cuando se guarda una versión nueva, cada calibración local existente se copia al
  ingrediente nuevo que tenga el MISMO insumo Y la MISMA unidad; si la unidad cambió, o el insumo salió de la receta,
  la calibración se DESCARTA (nunca se arrastra "resucitada" con otra unidad) y queda auditada. Un cambio de
  cantidad/merma CENTRAL, sin cambiar unidad ni sacar el insumo, NO descarta nada — la calibración es de la sucursal,
  no una copia del valor central.

### 3.6 Dónde vive en la navegación

Como un reporte nuevo bajo `Reportes` (ej. `/reportes/rendimiento-recetas`),
no mezclado en `/catalogo/recetas` — mismo criterio de separación ya
aplicado esta sesión (lista vs. editor, grounded contra Dolibarr). Desde la
fila de un ingrediente en el editor de receta, un link "Ver rendimiento
real" linkea para acá filtrado a ese producto — atajo, no la única entrada.

## 4. Caveats honestos (no vender esto de más)

- **Necesita historial real.** Con pocas semanas de datos, o un negocio
  nuevo, el reporte va a decir "datos insuficientes" para la mayoría de las
  líneas — es lo correcto, no un bug.
- **Necesita variación en la mezcla de ventas** para el caso compartido
  (Fase 2). Un negocio que vende siempre la misma proporción de Milanesa y
  Bife nunca va a poder separar cuánto aporta cada uno — el sistema queda
  matemáticamente indeterminado, y el reporte tiene que decir eso
  explícitamente en vez de inventar un número.
- **Es un promedio, no una verdad por transacción.** Nunca va a decir "el
  martes se usaron 3 nalgas para milanesas" — dice "en las últimas 8
  semanas, en promedio, así rindió".
- **Sensible a todo lo que no sea Compra/Venta puras.** Merma real,
  robos, productos regalados, stock inicial mal cargado — todo eso mete
  ruido en las compras sin que haya una venta correspondiente. El reporte
  no lo distingue de "el plato usa más de lo que dice la receta" — otra
  razón por la que la salida es una sugerencia a revisar, no un hecho.

## 5. Qué NO se construye (a propósito, en esta fase)

- Nada de "modo declarativo vs. estimado" — ya descartado, ver §2.1.
- Ninguna tabla nueva de "pool de receta" — se reusa Insumo tal cual está.
- Ninguna receta por sucursal — la receta (ingredientes/pasos/unidades) sigue siendo una sola, global. **Matiz
  agregado 2026-09-26:** lo que SÍ puede variar por sucursal, desde el plan de esa fecha, es cuánto RINDE cada línea
  (cantidad/merma efectivas) — ver la actualización de la nota del principio 6 y la §3.5 reescrita más arriba. La
  receta en sí (qué lleva, en qué unidad) sigue sin tener ninguna variante por sucursal.
- Ningún proceso de "Desposte" (1 insumo → N salidas) — eso quedó
  descartado como no aplicable a este negocio en
  `docs/grounding-desposte-grocy.md` (ni siquiera Grocy lo tiene de verdad).
- La Fase 2 (regresión multivariable) no se construye antes que la Fase 1
  (división simple) esté funcionando y probada con datos reales.

## 6. Pendientes fuera de alcance (D9, docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md, paso 12)

Explícitamente NO resueltos por el plan de calibración por sucursal — quedan anotados, no implementados:

- Quién puede editar la receta global (separado a propósito de quién puede calibrar su sucursal, D5).
- Estimación de rendimiento real de OTRAS sucursales lado a lado, más allá de la comparación de valores ya calibrados
  (D8) — es decir, correr la estimación estadística de este documento (§3) para varias sucursales a la vez y
  mostrarlas juntas, no solo comparar lo que cada una ya calibró.
- Calibrar a mano una línea sin que exista una sugerencia previa (evaluado y recortado en el paso 7 del plan).
- Mostrar "quién" (qué usuario) calibró cada versión, en el historial de versiones de la receta central.
- `MovimientoStock` no se recalcula nunca con el rendimiento efectivo: `costo-historico.ts` sigue usando la receta
  vigente (ahora la efectiva de la sucursal) para días pasados, no la que regía ese día.
