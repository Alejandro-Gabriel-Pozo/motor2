# Frente 2 — Etapa R4: fracciones (2, 4 y 8) y unidad de venta separada (2026-11-16)

> Pieza hermana de `docs/diseno-unidades-y-clasificacion-paridad-pedernal-2026-11-16.md`. **Solo documento: sin código, sin migraciones, sin DEC.** El diseño completo y con sus 10 niveles **ya existe**: `docs/diseno-fracciones-y-peso-como-pedernal-2026-11-15.md` (**FR**, #295) y su núcleo puro está en `main` (`src/core/catalogo/fracciones-y-peso.ts`, #302, **etapa E0 hecha**, sin conectar). Esta pieza **no lo repite**: agrega lo que cambió hoy (la ratificación del dueño y lo que Pedernal ya construyó), los niveles 1 a 5 de lo **nuevo** y la primera pregunta concreta.
> **Marcas.** **V** = lo leí en el código (Pedernal `ZuluHub-ERP` `ad4a9a4`, Motor2 `main` `d6471e06`); **CONFIRMADA**, **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**.

## 1. Lo que cambió

**Pedido (CONFIRMADA).** Dueño, 2026-11-16, a si se suman porciones y unidad de venta separada: «Sí, como Pedernal (2, 4 y 8)» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, «Fase 1 de los frentes»; llega por el orquestador general). Esto es la **ratificación de la etapa** que FR §1 marcaba como PENDIENTE («no encontré una cita específica para Motor2»). **No autoriza ninguna migración ni su aplicación** (regla del 2026-11-16: «las migraciones van a estar aprobadas cuando ya tengamos todo el código igual»).

**Corrección importante al encargo: en Pedernal esto YA ESTÁ construido en el servidor** (**V**). La ficha `ZuluHub-docs/…/conceptos/porciones.md` dice «decidida sin construir», pero está **desactualizada**: existen `migraciones/0051_porciones_del_producto.sql` (columna `porciones_ofrecidas smallint[]` con un único `CHECK` de las 7 listas posibles; con fracciones el paso **es** 1 ÷ la porción más fina; solo de productos por unidad y de clase vendible o reventa), el caso de uso `cambiarFormaDeVenta` (`src/modulos/catalogo/casos-de-uso/cambiar-forma-de-venta.ts`; permisos `productos.editar` **y** `productos.cambiar_precio`; bloqueo del producto, versión esperada, «sin cambios», y **cambio de unidad con conversión de precios todo o nada**: `SOLO_PASO` / `CONVERTIDO` / `QUEDO_EN_PRECIO_ABIERTO`), el dominio `porciones.ts` y la perilla `venta_por_fracciones_y_peso` (`perillas.ts:120`, INTERRUPTOR, ámbito EMPRESA, **apagada de base**). **No tiene pantalla** (`apps/web` sin rastro de «Cómo se vende» ni de porciones; solo la maqueta `productos.html`). Quedan **NO VERIFICADAS** las pruebas y la reversión.

**Consecuencia sobre las «cinco preguntas abiertas» de Pedernal** (todas eran de la ficha vieja):

| # | Pregunta de la ficha | Estado hoy |
|---|---|---|
| 1 | ¿El paso se deriva de las porciones o es un campo? | **Resuelta en Pedernal**: se deriva (migración 0051 cita al dueño, 14/11/2026: «el paso mínimo se deriva de las fracciones que se ofrecen»). En Motor2, FR E1 ya lo propone igual → **PROPUESTA**, cubierta por el «Sí, como Pedernal» |
| 2 | Tercios y sextos | **Fuera «hasta nueva orden»** (dueño de Pedernal, 12/11; 0051 solo admite 2, 4 y 8). Motor2: **CONFIRMADA** solo 2, 4 y 8 («Sí, como Pedernal (2, 4 y 8)») |
| 3 | ¿Pizza por fracciones o por la opción «Media»? | **PENDIENTE** (no lo dijo ningún dueño). **No bloquea datos**: cada producto usa una de las dos (FR §1); se pregunta cuando el dueño cargue una pizza |
| 4 | Textos de «Cómo se vende» | **PENDIENTE**; solo «Porciones» y «Borrar» figuran confirmados en Pedernal; van por el frente de Textos (T1) y de pantallas |
| 5 | La palabra «porción» (fracción / rinde de la receta / Motor2) | **PENDIENTE**; propuesta de Pedernal: «Porciones» solo para la fracción del producto y «Rinde» para la receta. **NO VERIFICADO** qué dice la pantalla de recetas de Motor2 |

## 2. Etapa mínima y etapas (de FR §8, sin cambios salvo lo marcado)

| Etapa | Qué | Migración | Datos | Estado |
|---|---|---|---|---|
| **E0** | Reglas puras + oráculo | No | No | **Hecha** (#302) |
| **E1** | `Producto.porcionesOfrecidas` + `CHECK` + caso de uso «cambiar la forma de venta» (**con** `FOR UPDATE` y versión) + pantalla «Cómo se vende» | Aditiva, `down.sql` | No | Ratificada hoy; **no escrita** |
| **E1b** | Convertir los pasos libres de hoy a la fracción más cercana, **reversible** (columna del paso original) | Aditiva + **paso de datos** | **Sí** | Q1 CONFIRMADA en dirección; **«requiere autorización expresa por base, con respaldo y ensayo»** |
| **E2** | Perilla `ventaPorFraccionesYPeso` (columna de **empresa**, no de plan) y freno del paso libre, **después** de E1b | Aditiva | Cambia comportamiento | Q2 CONFIRMADA; **coordinar con el frente 4** (perillas) |
| **E3** | Congelar el paso en la línea vendida | Aditiva (`CuentaItem`) | No | **Comparte `CuentaItem` con E3 de clasificación**: un solo turno de `schema.prisma` para ambas columnas |
| **E4** | Podar el «Paso de venta» libre (interruptor, luego borrado con aviso) | No | Borra | Con aviso al dueño |
| **E5 (nueva)** | **Unidad de venta separada de la de stock** (kilo ↔ gramo, con conversión de precios todo o nada, como Pedernal): `Producto.unidadDeVentaId` | **Sí**, aditiva | Conversión de precios | **CONFIRMADA (b)** (dueño, 2026-11-16: «También en otra unidad, como Pedernal»); **corrige FR Q3** (15/11: la más nueva manda). Va **después de las 14 unidades** (U1b y U2) y **«requiere autorización expresa por base, con respaldo y ensayo»** para convertir precios existentes |

**Lo más barato para empezar a usarlo:** E1 sin perilla (solo porciones 2/4/8 en productos por unidad). El peso y la unidad separada esperan la respuesta de §4.

## 3. Niveles 1 a 5 de lo nuevo (el resto está en FR §1 a §6)

| Nivel | Qué | Estado |
|---|---|---|
| 1 Propósito | Motor2 vende por mitad, cuarto u octavo, solo 2, 4 y 8 (una o varias a la vez), igual a Pedernal. Cita: «Sí, como Pedernal (2, 4 y 8)» (2026-11-16) y «Necesitamos ser iguales en todo…» (2026-11-13) | **CONFIRMADA** |
| 1 Propósito | Unidad de venta separada de la de stock (kilo ↔ gramo, con conversión de precios) | **CONFIRMADA**: «También en otra unidad, como Pedernal» (2026-11-16); corrige FR Q3 |
| 2 Actores | Quien cambia la forma de venta: gerente y administrador (`productos.editar` + `productos.cambiar_precio` en Pedernal). En Motor2 las claves de hoy: **NO VERIFICADO** el mapa exacto (el diseño FR §10 lo resuelve al implementar; sin clave nueva) | PROPUESTA |
| 3 Casos de uso | Elegir las fracciones ofrecidas; ver el paso derivado; vender ½ ¼ ⅛ (stock = consumo × cantidad, con el arrastre de redondeo ya construido, Task #27); escribir «1/2» en papel; (E5) cambiar la unidad de venta convirtiendo precios todo o nada | PROPUESTA (E5 CONFIRMADA) |
| 4 Conceptos | Porciones = lista de {2,4,8} ordenada y sin repetir; paso = 1 ÷ la más fina (2 y 8 → 0,125; así ⅛ + ⅛ = ¼ vale aunque ¼ no se ofrezca); solo productos «por unidad» de clase vendible o reventa | **CONFIRMADA** (Pedernal, 12 y 14/11; Motor2 por el «Sí, como Pedernal») |
| 5 Invariantes | Todo nace cerrado: lista de **permitidos**; cantidad y paso en enteros de diezmilésimos, **sin coma flotante** (ya así en `fracciones-y-peso.ts`; la regla vigente `venta-fraccionada.ts` usa coma flotante con tolerancia y convive hasta E1); múltiplo del paso se **rechaza**, nunca se redondea; la unidad de conteo se valida en el servidor y luego con disparador (un `CHECK` no mira otra tabla); «1 ÷ paso entero» se conserva en el peso (diferencia declarada, FR §15) | PROPUESTA |

## 4. Unidad de venta separada: RESPONDIDA (b)

Dueño, 2026-11-16: «También en otra unidad, como Pedernal» (registrada en `motor2-docs`, «cuarta tanda»; la cita llega por el orquestador general). **CONFIRMADA la opción (b):** la unidad de venta puede ser otra que la de stock (misma dimensión; kilo ↔ gramo), convirtiendo los precios **todo o nada** (si algo no convierte exacto, el producto queda en «precio abierto», sin error), como `cambiarFormaDeVenta` de Pedernal. **Corrige FR §13 Q3** («Sí, siempre en la unidad de stock», 2026-11-15): la respuesta más nueva manda. Consecuencias:
- Hace falta `Producto.unidadDeVentaId` (columna aditiva) y la regla «misma dimensión, conversión exacta»; **depende de las 14 unidades** (U1b y U2): sin equivalencia declarada no hay dimensión ni factor. **No se construye antes.**
- Los precios (`Producto.precioVenta`, precios locales, recargos de opciones) y el paso se convierten juntos; es **dinero**: todo en enteros, sin coma flotante, y la conversión de lo ya cargado **«requiere autorización expresa por base, con respaldo y ensayo»**.
- La diferencia con Pedernal que FR §15 declaraba («Sin unidad de venta aparte») **se retira**.
- No hay pregunta nueva al dueño por esto.

## 5. «¿Qué pasa si…?» de lo nuevo

| Comando | Repetición | Concurrencia | Tiempo | Incertidumbre | Reintento | Error parcial | Datos faltantes | Permisos |
|---|---|---|---|---|---|---|---|---|
| **Cambiar fracciones ofrecidas** (E1) | misma forma → `SIN_CAMBIOS`, sin escribir ni auditar | `FOR UPDATE` del producto + versión esperada: dos editores, gana el primero y el otro ve `VERSION_DESACTUALIZADA` | rige desde el guardado; lo vendido no cambia (E3 congela el paso) | lista inválida o paso a mano **y** porciones a la vez → rechazo, nunca se adivina | idempotente por la forma pedida | **una transacción**: forma, paso y auditoría juntos | producto sin unidad por conteo → `FORMA_DE_VENTA_INVALIDA` | `productos.editar` y la del precio, en el servidor; perilla apagada → `FORMA_DE_VENTA_NO_SOPORTADA` |
| **Convertir pasos libres** (E1b) | segunda corrida: no cambia nada (conserva el paso original) | una transacción por base; ventas en curso usan el paso que lee su transacción | histórico intacto | lo que no cae exacto queda «pendiente de completar», **no se redondea** | idempotente | todo o nada por base | paso nulo → no se toca | autorización expresa por base; el script corre como dueño |
| **Vender una fracción** | la clave de la venta ya es idempotente | el stock usa el arrastre de redondeo (dos medias = 1 bollo) | paso vigente al vender (E3: el de la línea) | cantidad no múltiplo → rechazo | idéntico | venta y stock en una transacción (ya así) | producto sin paso → entero | permiso de venta de hoy |
| **Cambiar la unidad de venta** (E5) | misma unidad → `SIN_CAMBIOS` | bloqueo del producto | los precios vigentes se convierten **todos o ninguno** | si algo no convierte exacto → «precio abierto» (sin error) | idempotente | todo o nada | sin precios → solo cambia la unidad | `productos.editar` + `productos.cambiar_precio` |

## 6. Migraciones de esta etapa (inventario)

Ninguna existe como archivo. **E1** y **E3**: aditivas con `down.sql` (E3: la reversión destruye lo congelado). **E1b**: reescribe datos → **autorización expresa por base, con respaldo y ensayo**. **E2**: aditiva, pero **cambia comportamiento** (frena el paso libre) → misma autorización por base. **E5** (confirmada): aditiva + conversión de precios → **autorización expresa por base**.

## 7. Carril y dependencias de esta etapa

- **Mío (Fase 2):** `src/core/catalogo/fracciones-y-peso.ts`, `venta-fraccionada.ts`, `conversion-de-paso-libre.ts`, el caso de uso nuevo de forma de venta y su guard; modelo `Producto` (**`porcionesOfrecidas`; y `unidadDeVentaId` (E5)**, por turno: `Producto` también lo tocan Ocultar y clases).
- **Por turno:** `CuentaItem` (E3, **junto con** el camino de clasificación) y `Empresa` o la tabla de perillas (E2, **frente 4**).
- **Consumidores que cambian de resultado y no son míos:** venta de mostrador (`src/core/movimientos/linea-de-venta.ts:49`), POS (`src/core/pos/cantidad-pedido.ts`), comanda y ticket («1/2»): se avisa al frente 1 (caja) y al 6 (pantallas) antes de E1; **NO VERIFICADO** quién es dueño de cada uno.
- **Pantalla «Cómo se vende»:** frente 6; los textos, el frente de Textos.
