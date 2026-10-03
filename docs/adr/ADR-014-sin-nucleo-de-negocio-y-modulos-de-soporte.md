# ADR-014: Sin núcleo de negocio, módulos de soporte calculados y Salón con venta rápida

> Redactado el 2026-10-03 (Bloque 5A del plan de plataforma, antes de implementar). **Decidido, todavía sin implementar**: ni la tabla de
> módulos ni el campo `modulo` de las acciones existen aún. Corrige ADR-011 en dos puntos (el «núcleo» del §2 y las dependencias del §3) y lo
> completa con los módulos de soporte. Lo escribió el dueño de producto en sus respuestas D1 y D2 del 2026-10-03; este ADR las registra con su
> motivo y con las consecuencias que se derivaron de leer el código. No toca la política de empresa, los planes (ADR-013) ni la identidad de
> plataforma (ADR-012).
>
> Ampliado por ADR-015 (2026-10-03): la tabla de dependencias del §3 se reemplaza por una completa (Stock como requisito de Compras, Traspasos y
> Consignación; Recetas como módulo propio; Clientes básico lo trae Salón).

## Contexto

ADR-011 definió un **núcleo sin filas**: Stock, lo que Stock exige (productos, insumos, unidades, sucursales, usuarios y roles, Proveedores) y
Administración. Al bajarlo a cuáles de las 123 acciones de `ACCIONES` caen en el núcleo, salieron 55, y el dueño lo corrigió: un núcleo grande
significa que nadie puede vender una versión chica, y obliga a que Stock, Compras o Mostrador se «incluyan» aunque el cliente no los use. La
pregunta de fondo es qué es lo único que de verdad no se puede apagar.

Estado verificado en el código el 2026-10-03 (etiquetas: VERIFICADO EN CÓDIGO / AUSENTE / PROPUESTA / NO VERIFICADA EN EJECUCIÓN):

| Hecho | Evidencia | Estado |
|---|---|---|
| El cierre de cuenta del Salón descuenta stock con el mismo motor que la venta de mostrador (`registrarVentaEnTx`) | `src/core/movimientos/registrar-venta.ts` (función `registrarVentaEnTx`), llamada desde `src/server/actions/pos/casos-de-uso/cerrar-cuenta.ts` | VERIFICADO EN CÓDIGO |
| El cierre de cuenta pasa `permitirStockNegativo: true`; el mostrador sigue rechazando la venta sin stock | `cerrar-cuenta.ts` (opción), `src/server/actions/movimientos/casos-de-uso/registrar-venta.ts` (comentario de cabecera) | VERIFICADO EN CÓDIGO |
| El POS sin carta cae a «Fuera de carta»: el Salón no necesita una carta armada para vender | `src/core/pos/selector-carta-consulta.ts` | VERIFICADO EN CÓDIGO |
| El mostrador permite fechar una venta hasta 400 días atrás; esa ventana es genérica (también la usan inventarios y pagos) | `src/core/datos/fecha-operacion.ts` (`DIAS_HACIA_ATRAS`) | VERIFICADO EN CÓDIGO |
| Una promoción de carta apunta por clave foránea a secciones de la carta | modelos `PromoCarta` y `PromoCartaCupo` en `prisma/schema.prisma` | VERIFICADO EN CÓDIGO |
| Hoy no existe ningún módulo, ni la tabla, ni el campo `modulo` en `ACCIONES` | `src/core/permisos/` (catálogo sin ese campo) | AUSENTE (es lo que implementa el 5A) |
| Qué capacidad de sucursal (ADR-009) hoy habilita el mostrador y si «venta rápida» debe exigir la del salón | — | NO VERIFICADA: se decide en el bloque que construya la venta rápida |

## Decisión

### 1. No hay núcleo de negocio: todo es módulo, incluido Stock

Lo **único fijo** es **Administración**: ingreso al sistema, usuarios, roles, permisos, sucursales, auditoría y datos de la empresa. Es la misma
lógica que ya aplica `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` (lo que, si se perdiera, deja a la empresa sin forma de administrarse): esas acciones
pertenecen a Administración, que no se registra, no se activa ni se desactiva y nunca bloquea.

Todo lo demás es un módulo con su fila en el registro: **Stock** (movimientos, inventarios, requerimientos, stock mínimo), **Compras**,
**Traspasos**, **Consignación**, **Salón**, **Carta**, **Promociones**, **Producción**, y los que vengan. Una empresa puede tener Salón sin Compras,
o Compras sin Salón, sin que nada «venga incluido».

Esto **corrige ADR-011 §2** (el núcleo ya no es «Stock y lo que Stock exige») y vuelve falsa una consecuencia de ADR-011: «una empresa sin
ninguna fila sigue teniendo núcleo» pasa a ser «una empresa sin ninguna fila tiene solo Administración».

### 2. Módulos de soporte: partes compartidas, calculadas y sin filas

Hay piezas que varios módulos necesitan pero que no se venden solas. Se llaman **módulos de soporte** y son tres, por ahora:

- **Proveedores básico**: el alta del proveedor (nombre, CUIT, contacto). Hoy es la acción `proveedores`.
- **Catálogo básico**: productos, unidades y categorías.
- **Clientes básico**: el alta del cliente.

Reglas:

1. Un módulo de soporte **no se vende ni se asigna** (no aparece en un plan de ADR-013 ni en el registro).
2. **Se calcula, no se guarda**: el conjunto efectivo de módulos de una empresa es la **clausura por `requiere`** de sus módulos vendibles activos.
   Si tiene Compras y Compras requiere Proveedores básico, lo tiene; si no tiene ningún módulo que lo requiera, no lo tiene. No hay filas que
   mantener ni que puedan quedar desalineadas del resto.
3. La consola de plataforma (ADR-012) muestra cada módulo calculado como **«incluido por X»** (los módulos que lo traen), para que quien administra
   vea por qué está y qué pasa si saca X.
4. Un módulo vendible puede **ampliar** un soporte (Compras = Proveedores básico + comparar precios + precios por proveedor + compras). El soporte
   queda con lo básico; lo que Compras agrega es de Compras.

### 3. Dependencias entre módulos (corrige ADR-011 §3)

Se mantiene la distinción dura (`requiere`) / blanda (`usaSiExiste`) / `datosRequeridos` de ADR-011, y se fijan estas relaciones:

| Módulo | Requiere (duro) | Usa si existe (blando) | Nota |
|---|---|---|---|
| Salón | Stock | Carta, Promociones | El cierre de cuenta usa el motor de movimientos, de ahí Stock duro. Con Carta apagada el POS vende «Fuera de carta» y venta rápida |
| Promociones | Carta | Salón | Clave foránea a las secciones de la carta |
| Consignación | Proveedores básico | Salón | **No requiere Compras**: tener consignación y compras a la vez es un armado de plan (ADR-013), no una dependencia |
| Compras | Proveedores básico | — | Más sus propias acciones (comparar precios, precios por proveedor) |
| Producción | Stock, Recetas | — | Hoy es la acción `proceso_produccion` |

**Salón → Carta es blanda** (decisión del dueño, confirmada). Sin carta, el Salón se usa solo con venta rápida; la carta suma el selector y las
promociones cuando está. El resto de la tabla es la propuesta derivada del código y queda sujeta al mapeo de acciones del 5A.

### 4. Mostrador pasa a ser parte del Salón: «venta rápida»

El módulo Mostrador deja de existir como módulo propio. Su función se ofrece dentro del Salón como **venta rápida / venta sin mesa**, vendiendo
desde la carta y usando el mismo motor de cierre. Consecuencias que se dejan **abiertas para el bloque que construya la venta rápida** (no se
deciden acá):

- **Regla de stock**: el mostrador rechaza vender sin stock; el Salón lo permite. Hay que elegir cuál rige para venta rápida (**PROPUESTA**: la de
  hoy del mostrador, es decir rechazar, para no cambiar lo que ya hace).
- **Fechas atrasadas**: el mostrador acepta hasta 400 días hacia atrás; el POS cierra «ahora». **PROPUESTA**: separar una «carga de ventas
  atrasadas» (solo administradores, dentro de Stock/Movimientos) en lugar de darle esa ventana a la venta rápida.
- **Capacidad por sucursal**: si venta rápida exige la capacidad de salón de la sucursal (ADR-009). **NO VERIFICADA**.

**En el 5A no cambia ningún comportamiento**: a las acciones de mostrador solo se les asigna el módulo Salón como etiqueta.

### 5. Acciones dudosas: a qué módulo pertenecen

Criterio, en este orden: (1) el módulo cuya pantalla o caso de uso la usa; (2) si no hay uno, el dueño del dato.

- El precio local de un producto pertenece a Catálogo/precios; «comparar precios» a Compras.
- `proceso_produccion` pertenece al módulo nuevo **Producción**, que requiere Stock y Recetas.
- Los reportes pertenecen al módulo de sus datos. Un **reporte que cruza módulos** usa dependencias blandas y **muestra solo lo que está activo**
  (en el 5A solo se le asigna un módulo dueño; ocultar secciones es posterior).
- Consignación es módulo propio: acciones `proceso_devolucion_consignacion`, `pagar_consignante` y todo lo que lleve `esConsignacion`.

La lista completa de las 123 acciones con su módulo se arma en el plan del 5A y se revisa con el dueño antes de escribir código.

## Alternativas descartadas

- **Núcleo de negocio grande** (ADR-011 §2): hace imposible una versión chica y mezcla lo que se vende con lo que se necesita.
- **Módulos de soporte como filas del registro**: obliga a mantener filas derivadas, que pueden quedar inconsistentes con los módulos que las
  justifican. Se descartó a favor del cálculo (decisión del dueño).
- **Salón → Carta dura**: obligaba a armar una carta para usar el Salón con venta rápida, cuando el POS ya funciona sin ella.
- **Mostrador como módulo aparte**: duplica el motor de venta y obliga a explicar por qué el Salón no incluye vender sin mesa.
- **Consignación requiere Compras**: confunde un armado de plan con una dependencia técnica.

## Correcciones a otros ADR

Los ADR originales no se reescriben; cada uno lleva una línea de estado que apunta a este.

1. **ADR-011, §2 «Núcleo».** El núcleo sin filas de negocio no existe: lo único fijo es Administración. Stock, Proveedores y Compras son módulos
   (los dos últimos, en parte, como soporte calculado). Lo demás de ADR-011 §2 sigue: Administración no se registra y las acciones de
   `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` le pertenecen.
2. **ADR-011, §3 «Dependencias».** Se agrega la noción de módulo de soporte calculado y se fijan las relaciones de la tabla de arriba.
3. **ADR-011, «Consecuencias».** «Una empresa nueva queda con solo el núcleo» pasa a «con solo Administración»; «el alta nunca otorga módulos por
   defecto» se mantiene.
4. **ADR-011 y la decisión D7 del plan** («Proveedores en el núcleo»). Reemplazada: Proveedores básico es un módulo de soporte, no núcleo.

## Consecuencias

- **El riesgo de despliegue sube.** Con el registro vacío, la empresa conserva solo Administración: si el código que lee el registro llega a una base
  donde la tabla todavía no existe o está sin backfill, **todas las funciones de negocio quedan bloqueadas**. La migración del registro debe estar aplicada
  y con backfill en ambas bases (zuluhub y stockhneuquen) **antes** del código que la lee. Es una migración con autorización expresa propia.
  Además, **la falla tiene que ser ruidosa, no silenciosa**: una empresa activa sin ninguna fila en el registro no debe apagarse en silencio.
  **PROPUESTA**: un script previo al deploy que cuente las empresas activas sin módulos (si hay alguna, el deploy no sigue) y, en la
  aplicación, una verificación a la vista cuando el registro de una empresa activa viene vacío. El detalle se define en el plan del 5A.
- **El backfill es más grande.** Cada empresa existente recibe todos los módulos vendibles (lo que hoy tiene), sin importar su estado, para no perder
  funcionalidad. Una empresa nueva nace solo con Administración.
- **Hay que redistribuir las 55 acciones del «núcleo» antiguo** entre Administración, Catálogo básico, Proveedores básico, Stock, los reportes de stock y
  el módulo nuevo Producción. El golden master de visibilidad (`test/modulos/`) tiene que seguir verde: con todos los módulos asignados, lo que ve cada
  rol no cambia.
- **Los módulos de soporte entran en el guard por cálculo**: la capa que lee los módulos activos devuelve ya la clausura (una sola lectura por pedido,
  como pide ADR-011 §5). La consola de plataforma y los planes solo listan módulos vendibles.
- **Una sola función calcula qué está activo**: el guard, el menú y la consola usan la misma (filas más soportes incluidos); ninguno recalcula por su
  cuenta. Un test lo prueba: con Consignación activa y sin Compras, la acción de proveedores queda habilitada y la de comparar precios no.
- **Salón pasa a depender de Stock de forma dura**: no se puede dar Salón sin Stock.
- **Venta rápida es trabajo nuevo**, no una etiqueta: la regla de stock, las ventas atrasadas y la capacidad se resuelven en su propio bloque, con su
  propio ADR si cambia una regla.
- **Decisiones del plan 5A que siguen en sus valores recomendados** hasta que el dueño diga otra cosa: backfill a todas las empresas en cualquier estado,
  motivo `SIN_PERMISO` con el caso, textos de «no activo» y «Próximamente», estado del módulo `ACTIVO`/`INACTIVO`, trigger como segundo candado de
  escritura, script de verificación en el 5A, lectura por pedido con `cache` de React y cierre por `requiere` en tiempo de ejecución.
