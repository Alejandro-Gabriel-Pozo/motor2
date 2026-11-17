# Diseño M3d — rendimiento, «Usar este valor» y calibración por sucursal bajo la base bruta (niveles 1 a 5)

Fecha: 2026-11-17 · Frente 2 (unidades y clasificación) · Etapa M3d de `docs/diseno-merma-sobre-bruto-como-pedernal-2026-11-15.md` (§7.3, §7.4 y §15). **Solo diseño: ninguna tabla, migración ni código de M3d hasta que el orquestador general lo confirme.**

Estados de cada decisión: **CONFIRMADA** (dicha por el dueño, con cita), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADO**. Reglas de método: escalera de diseño de 10 niveles (acá 1 a 5), primero la opción más barata, y lo que el dueño no pidió no entra.

Fuentes leídas el 2026-11-17: `ZuluHub-ERP` `26c7fc5` (`src/modulos/stock/dominio/merma.ts`, búsqueda de «calibr» y «rendimiento» en `src` y `migraciones`), `ZuluHub-docs` `dab0e47` (`11-especificaciones/conceptos/rendimiento.md`, `bruto-y-neto.md`, `ficha-de-cocina.md`, `receta-propia-y-receta-de-la-central.md`, `catalogo-y-niveles-maqueta.md` decisiones 74 y 75) y, de Motor2, `docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md` y el código real (inventario de lectores de merma del 2026-11-17).

## 0. En una frase

Motor2 ya tiene dos funciones propias que Pedernal **no construyó**: el reporte «Rendimiento de recetas» (con «Usar este valor») y la **calibración por sucursal** de la cantidad y la merma de una línea. Todo lo que escriben o muestran hoy está en base **neta**. Cuando existan versiones **brutas** (M3b), esas dos funciones tienen que seguir diciendo la verdad. M3d es ese ajuste; no agrega funciones nuevas.

## 1. Nivel 1 — Propósito, necesidad y alcance

| # | Necesidad | Quién la pidió y dónde está escrita | Estado |
|---|---|---|---|
| M3d-1 | Que el reporte «Rendimiento de recetas» y el cálculo del bruto teórico sigan siendo correctos con versiones brutas (hoy multiplican la merma sobre la cantidad escrita) | Consecuencia de N-2, N-3, N-5, N-9 (diseño de merma §1: dueño 2026-11-13 «Bruto, cargo el bruto…», 2026-11-14 «Marcar cada receta con «cómo se cargó»…», 2026-11-15 «La misma regla que las recetas») | **CONFIRMADA** (derivada) |
| M3d-2 | «Un valor calibrado nunca se aplica solo»: «Usar este valor» exige el clic y la confirmación | Dueño, 2026-11-08, chat: «el 75 es correcto» (`catalogo-y-niveles-maqueta.md` decisión 75, `ZuluHub-docs`) | **CONFIRMADA** |
| M3d-3 | Que exista la **calibración por sucursal** (cantidad y merma propias de una línea en la sucursal activa, sin tocar la receta central) | Dueño, 2026-09-26: autorizó la tabla `RendimientoLocalIngrediente`, el permiso `calibrar_rendimiento_local` y que «la merma se congela junto con la cantidad» (`docs/plan-rendimiento-receta-por-sucursal-2026-09-26.md`, «Decisiones de autorización YA RESUELTAS por el dueño del producto»); y 2026-11-08 «el 74 es correcto» (receta versionada, receta propia, «merma y rendimiento por línea») | **CONFIRMADA** (existe y está autorizada; **no** es una función de Pedernal) |
| M3d-4 | Que la cantidad calibrada de una línea de una receta **bruta** sea también bruta | **No hay cita**: el dueño fijó el 2026-09-26 que «`cantidad` es SIEMPRE el estimado NETO» (D4), antes de decidir el 2026-11-13 cargar el bruto | **PENDIENTE** (la pregunta de §8) |

**Alcance.** Entra: el reporte de rendimiento (bruto teórico, estimado, desvío, rótulos), «Usar este valor» y «Volver al valor central», la calibración al guardar una versión nueva (arrastre), la comparación entre sucursales y los rótulos «Neto»/«Bruto» de las pantallas de receta e historial. **No entra:** escribir versiones brutas y convertir (M3b: exige la confirmación expresa del dueño, diseño de merma §11 texto X), stock y costo (M3a, hecho), la ficha impresa (M3c, hecha), merma de lote de producción, desarme, nada de tablas nuevas.

## 2. Nivel 2 — Actores y contexto

| Actor | Qué hace | Permiso real en Motor2 |
|---|---|---|
| Administrador / gerente | Edita la receta central; mira el reporte | `guardar_receta` (administrador, contexto empresa) |
| Quien opera la sucursal | Calibra la línea de su sucursal; crea o edita la receta propia | `calibrar_rendimiento_local` (D5, sembrado solo para admin); `receta_sucursal_editar` (operario) |
| El sistema | Arrastra o convierte las calibraciones al guardar una versión central nueva | — |

Contexto: una sucursal activa por pedido (la acción de calibrar **nunca** recibe `sucursalId`: usa la de la sesión); empresa única por base con RLS; costo y stock ya leen la base de la versión (M3a).

## 3. Nivel 3 — Casos de uso

| # | Caso | Resultado esperado |
|---|---|---|
| CU-1 | Ver el reporte de una receta **neta** | Igual a hoy (el bruto teórico es `cantidad × (1 + merma/100)`) |
| CU-2 | Ver el reporte de una receta **bruta** | El bruto teórico es la `cantidad` (sin sumar la merma otra vez); el «neto» se muestra derivado (`cantidad × (100 − merma)/100`, como Pedernal) |
| CU-3 | «Usar este valor» sobre una línea de receta **neta** | Calibra la línea de ESTA sucursal en neto, como hoy (D4 del plan de 2026-09-26); no cambia nada de lo ya confirmado |
| CU-4 | «Usar este valor» sobre una línea de receta **bruta** | **PENDIENTE** (§8): propuesta: calibra el bruto estimado tal cual |
| CU-5 | «Volver al valor central» | Sin cambios: deja los dos campos en `null` y lo audita |
| CU-6 | Guardar una versión **central** nueva que tiene calibraciones de sucursales | Hoy se arrastran si la unidad no cambió (D3). Con versiones de distinta base: ver §5, R-6 |
| CU-7 | Comparar el bruto entre sucursales | Cada lado se pasa a bruto con la base de **su** versión (ya decidido en el diseño de merma §15) |
| CU-8 | Las pantallas de receta, historial y editor rotulan «Neto»/«Bruto» según la base de la versión que muestran | Rótulo derivado de la marca; sin la marca legible se cierra |

## 4. Nivel 4 — Conceptos y ciclo de vida

- **Base de la versión** (`NETA` | `BRUTA`, M2): una por versión, nace con ella, no cambia. La **calibración hereda la base de la línea a la que cuelga** (diseño de merma §4); no lleva marca propia.
- **Calibración de una línea en una sucursal:** par (`cantidad`, `merma`) opcionales, uno por (línea, sucursal), con auditoría y de solo agregar a nivel de historia (los campos vuelven a `null`, la fila no se borra).
- **Valor medido vs calibrado** (CYN 75, dueño): el sistema mide o estima, la persona decide; un valor calibrado nunca se aplica solo.
- **Ciclo de una calibración:** sin calibrar → calibrada → (descartada por cambio de unidad o por salir el ingrediente de la receta, auditado) o → vuelta al valor central. Al guardarse una versión central nueva: se arrastra, se convierte (si cambia la base) o se descarta con aviso.

## 5. Nivel 5 — Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| R-1 | El bruto es lo que sale del stock y se costea en las dos bases; el neto es derivado, solo para mostrar (diseño de merma I1; Pedernal `merma.ts`: «La receta guarda el BRUTO… El neto… sale ÚNICAMENTE de `netoDeBruto`») | **CONFIRMADA** (N-2, N-3) |
| R-2 | Un valor calibrado nunca se aplica solo: la acción exige el clic y, si convierte o descarta algo, la confirmación estricta | **CONFIRMADA** (CYN 75) |
| R-3 | La calibración nunca recibe la sucursal por parámetro: usa la de la sesión | **CONFIRMADA** (plan 2026-09-26, D4; ya en el código) |
| R-4 | La calibración se rechaza si la línea ya no es la vigente de su receta (reporte desactualizado) | **CONFIRMADA** (ya en el código) |
| R-5 | En una versión bruta la merma es menor que 100; con 100 o más se rechaza, no se acota | **CONFIRMADA** (N-4: dueño 2026-11-13 y 2026-11-14) |
| R-6 | Al guardar una versión central nueva con calibraciones: base igual → se arrastran como hoy; base distinta (la vieja neta, la nueva bruta) → se **convierten** con la regla única del diseño de merma I13 y se muestran en la vista previa; si no se pueden convertir (dato fuera de rango) se descartan y se auditan | **PROPUESTA** (deriva de N-8 «Al editarla se convierte a bruto» y del diseño de merma I9, I13, I15) |
| R-7 | La cantidad calibrada de una línea de receta **bruta** es bruta | **PENDIENTE** (§8) |
| R-8 | Estas funciones **no se tocan** para nada que no sea la base: ni textos, ni permisos, ni pantallas nuevas, ni opciones | **CONFIRMADA** (regla «Lo que el dueño no pidió no entra») |
| R-9 | Hoy ningún camino escribe BRUTA: hasta M3b todo esto es lectura equivalente (resultado idéntico al de hoy con la marca en NETA) | **PROPUESTA** (diseño de merma I2, M3a) |

### «¿Qué pasa si…?» para los dos comandos que escriben

| Situación | «Usar este valor» (calibrar una línea) | Guardar versión central con calibraciones |
|---|---|---|
| Repetición (clic doble) | Idempotente por (línea, sucursal): el segundo clic escribe lo mismo | La versión esperada rechaza la segunda con «la receta cambió» |
| Concurrencia | Transacción serializable con reintento; si la línea dejó de ser vigente se rechaza | Serializable; la segunda pierde la carrera de forma limpia |
| Tiempo | Con el reporte abierto y una versión nueva guardada en medio: se rechaza (R-4) | Sin cambio |
| Incertidumbre (no hay conteos) | No ofrece valor: nunca se inventa (CYN 75) | — |
| Reintento tras corte de red | Mismo resultado; no duplica auditoría | No duplica versión ni descartes |
| Error parcial | Todo o nada (una transacción) | Todo o nada: versión, calibraciones y auditoría |
| Datos faltantes | Sin marca legible: **cierra** con error; nunca se asume una base | Ídem |
| Cambio de permisos | Se chequea en el servidor en cada llamada (`calibrar_rendimiento_local`) | `guardar_receta` en cada llamada |

## 6. Qué hace Pedernal hoy (leído, 2026-11-17)

- **Receta:** guarda el **bruto** (`composicion`/componente: «se carga el BRUTO; neto = bruto × (1 − merma)», dueño 2026-11-13); el neto sale solo de `netoDeBruto` (`ZuluHub-ERP` `26c7fc5`, `src/modulos/stock/dominio/merma.ts`), con un solo redondeo a 4 decimales; la merma menor que 100 se impone también en la base (`componente_perdida_ck`).
- **Rendimiento medido («Pasar a la receta»):** **decidido y sin construir** (`conceptos/rendimiento.md` §2: «B. Decidida sin construir»; no hay nada en `src` ni en `migraciones`). Pedernal define que el valor medido nunca se aplica solo y que «Pasar a la receta» abre la edición y se guarda como versión nueva si la persona lo decide.
- **Calibración por sucursal:** **no existe** en Pedernal (`receta-propia-y-receta-de-la-central.md`: la «calibración por sucursal» figura como «otra idea», con la decisión 75). Pedernal tiene **receta propia por sucursal** completa.
- **NO VERIFICADO:** el código de `ZuluHub-ERP` se buscó por texto («calibr», «rendimiento medido»); no se recorrió módulo por módulo.

## 7. Diferencias declaradas con Pedernal (cada una con su motivo)

| Diferencia | Motivo | Estado |
|---|---|---|
| Motor2 tiene calibración por sucursal y Pedernal no | Función propia que el dueño autorizó el 2026-09-26 y confirmó con «el 74 es correcto» (2026-11-08); la regla de paridad no obliga a quitar lo ya autorizado | **CONFIRMADA**; candidata a revisar con la regla de poda si el dueño lo pide |
| «Usar este valor» escribe la calibración de la sucursal y Pedernal diría «Pasar a la receta» (abre la edición) | Mismo origen; en las dos el valor nunca se aplica solo | **CONFIRMADA** |
| Motor2 mantiene dos niveles (receta propia **y** calibración); Pedernal solo receta propia | Ídem | **CONFIRMADA** |

## 8. Pregunta abierta (una sola, para quien no programa)

**«Cuando una sucursal ajusta, con “Usar este valor”, cuánto de un ingrediente usa en su cocina, y esa receta está cargada como “lo que sale de la cámara” (bruto), ¿el número que se guarda también tiene que ser “lo que sale de la cámara”?»**

- Contexto: el 2026-09-26 vos dijiste que ese número es «SIEMPRE el estimado neto» (lo que lleva el plato). El 2026-11-13 decidiste cargar las recetas como bruto. Las dos decisiones no pueden valer a la vez para una receta bruta.
- **Recomendada: sí, bruto.** Así el número que se calibra es el mismo que descuenta stock y costo, y no hace falta convertir cada vez (menos riesgo de errores de redondeo). Para las recetas viejas (neto) no cambia nada.
- Costo de decidir al revés (neto siempre): hay que convertir cada calibración al guardarla y al leerla, y aparecen restos de redondeo.
- Hasta la respuesta: R-7 y CU-4 quedan **PENDIENTE**; no se construye nada de esa parte.

## 9. Lo que sigue (sin tablas ni migraciones)

1. Respuesta del dueño a §8.
2. Con R-7 confirmada: pasos chicos y reversibles, todos de código sobre la marca ya existente (M2): (a) el bruto teórico y el estimado del reporte leen la base, (b) «Usar este valor» escribe según la base, (c) el arrastre convierte con la vista previa, (d) los rótulos.
3. Pruebas con el método de siempre: oráculo escrito aparte, mutaciones por sitio, y la tabla «¿qué pasa si…?» de §5.
4. Sugerencias (no implementadas): retirar la calibración por sucursal si, con las recetas reales, nadie la usa y la receta propia alcanza (regla de poda; hoy no hay recetas reales a mano para medir el uso).
