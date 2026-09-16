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

### 3.5 Acción sobre el reporte

- Ver varias sucursales lado a lado para la misma línea de receta (la
  comparación que motivó todo esto: "¿quién gasta más?").
- Un botón "Usar este valor como nuevo estándar" en la fila de UNA
  sucursal → abre el editor de receta (`/catalogo/recetas/[productoId]`)
  prellenado con ese número, usando `actualizarIngredienteDeReceta` (ya
  existe) → genera versión nueva si se confirma. Ninguna actualización
  automática — siempre pasa por la pantalla de edición real, con el número
  ya cargado como punto de partida.

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
- Ninguna receta por sucursal — la receta sigue siendo una sola, global.
- Ningún proceso de "Desposte" (1 insumo → N salidas) — eso quedó
  descartado como no aplicable a este negocio en
  `docs/grounding-desposte-grocy.md` (ni siquiera Grocy lo tiene de verdad).
- La Fase 2 (regresión multivariable) no se construye antes que la Fase 1
  (división simple) esté funcionando y probada con datos reales.
