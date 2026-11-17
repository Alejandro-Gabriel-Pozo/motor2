# Diseño corto — «Producto nuevo» igual a Pedernal (alta de producto) — 2026-11-17

Frente 2 · Pedido del dueño (cambio de prioridad, 2026-11-17, chat con el orquestador, registrado en `motor2-docs` 12d2cd4): «un nuevo producto no tiene todas las categorías que tiene el otro. O sea, no tiene todos los estados. Porque el nuevo producto, materia prima, tiene se produce, tiene receta propia o se fabrica por lote, activo en todas las sucursales. Esas son cosas que Pedernal sacó. […] las pantallas no parecen las de Pedernal siquiera». **Lo visible va primero.**

Este documento **no reemplaza** el diseño de clases (`docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md`, niveles 1 a 10, E0 a E6) ni el de productos (`docs/diseno-productos-igual-a-pedernal-2026-11-13.md`, §D3 «Nuevo producto»): los usa para separar **lo que se puede cambiar ya, solo en la pantalla** de **lo que cambia el modelo y pide turno de schema**.

Estados: **CONFIRMADA** (dicha por el dueño, con cita), **PROPUESTA**, **NO VERIFICADO**. Fuentes leídas el 2026-11-17: `ZuluHub-docs` `552042f` (`10-ux-ui/prototipos-gastronomia/productos.html`, estados «Nuevo producto», «¿Qué es? (insumo)», «Materia prima», «Elaborado», «Alta rápida desde la compra»; `11-especificaciones/conceptos/producto.md`; `auditoria-de-motor2-informes/playwright-alta-de-producto.md`) y `motor2` `859408c8` (`src/app/(app)/catalogo/productos/producto-form.tsx`, `campo-alicuota-iva.tsx`).

## 1. Qué ve hoy el dueño (captura real de Motor2 a 375 px, datos de ejemplo)

Capturas en `motor2-docs`, rama `alegp/stoic-davinci-185dm4`, carpeta `_coordinacion/capturas-producto-nuevo-2026-11-17/` (no van al repositorio público; base local descartable, nombres de ejemplo «Salsa de la casa» y «Milanesa napolitana»):

- `antes-alta-materia-prima-375.png` y `antes-alta-producto-de-venta-375.png` (y sus versiones a 1280 px): Motor2 pide **«Materia prima (MP)» o «Producto de venta (PV)»** y debajo, para una materia prima, **«Se produce (tiene receta propia, se fabrica por lote)»**, **«Activo en todas las sucursales»** y «Es consignación».
- `pedernal-nuevo-producto.png`, `pedernal-que-es-materia-prima.png`, `pedernal-elaborado.png`, `pedernal-alta-rapida-desde-la-compra.png`: la pantalla del prototipo de Pedernal. Lo primero que pide es **«¿Qué es?»**, un desplegable con **cinco** clases y una línea que explica la elegida; no hay tilde de «Se produce» ni de «Activo en todas las sucursales».

## 2. Qué ofrece Pedernal al crear / qué ofrece Motor2 hoy / diferencia

| # | Qué | Pedernal (maqueta aprobada, `productos.html`) | Motor2 hoy (`producto-form.tsx`, `main` `859408c8`) | Diferencia | ¿Solo pantalla o cambia el modelo? |
|---|---|---|---|---|---|
| 1 | **¿Qué es?** | Desplegable con 5 clases: Materia prima, Insumo, Reventa, Elaborado, Producto vendible; debajo, la descripción corta de la elegida. De la clase depende qué campos y pestañas aparecen | Dos botones: «Materia prima (MP)» / «Producto de venta (PV)» | Faltan **Insumo** y **Reventa**; los nombres y las descripciones no se parecen; sin «¿Qué es?» | **Solo pantalla** para las 3 que se derivan de lo que ya existe (Materia prima = MP, Elaborado = MP que se produce, Producto vendible = PV). **Modelo** para Insumo y Reventa (no se pueden deducir: columna nueva, diseño de clases E1 y E4) |
| 2 | **Se produce / receta propia / por lote** | No existe como tilde: «Elaborado» es una clase («Se produce en el negocio y se usa como componente») | Casilla «Se produce (tiene receta propia, se fabrica por lote)» en una materia prima | Pedernal lo resuelve eligiendo la clase | **Solo pantalla** (el valor `seProduce` sale de elegir «Elaborado»). El dueño ya confirmó el 2026-11-15 que «se produce» no se prende ni se apaga en una materia prima ya cargada (diseño de clases, §11.1, pregunta 3) |
| 3 | **Activo en todas las sucursales** | No existe: el producto es de la empresa; se oculta por local después («Ocultar») | Casilla, tildada por defecto (decisión previa del dueño, «lo común tiene cero fricción») | Pedernal no lo ofrece | **Solo pantalla** si se mantiene el efecto de hoy (nace disponible en todas las sucursales). **Supuesto declarado:** el dueño dijo que es algo que «Pedernal sacó»; no pidió cambiar el efecto |
| 4 | Nombre / Nombre de cocina | Nombre (1 a 120); nombre de cocina solo en lo que se vende | Igual (nombre de cocina solo en un PV) | Ninguna | — |
| 5 | **Código interno** | Campo opcional | «Código (opcional, se autogenera)» | Mismo resultado | — |
| 6 | **Código de barras** | Campo opcional | No existe (no hay columna: `grep` en `prisma/schema.prisma`) | Falta el campo | **Modelo** (columna nueva; el diseño del 2026-11-13 ya lo marca «requiere migración») |
| 7 | **Unidad** | Una sola «Unidad» (la base) | «Unidad de stock» + «Unidad de compra» + «Factor de conversión» (materia prima) | Pedernal resuelve la compra en la pestaña «Cómo se compra» (presentaciones), después de guardar | **Solo pantalla** (ordenar el alta); las presentaciones ya existen detrás de un interruptor. **NO VERIFICADO:** cuántas materias primas actuales dependen de la unidad de compra del alta |
| 8 | **Alícuota de IVA** | «Alícuota de IVA» solo si se vende, sin valor por defecto, error «Elegí la alícuota» | «IVA de venta» (PV) / «IVA de compra» (MP) con «Sin declarar» y «Pendiente de completar» | En Pedernal la materia prima no lleva IVA | **Solo pantalla** (no ofrecer «IVA de compra» al crear una materia prima). **NO VERIFICADO:** si el costo de compra usa ese IVA |
| 9 | **Precio** | No se carga al crear: «precios y opciones se habilitan una vez guardado» | «Precio de venta» en el alta de un PV (o $0 sin la clave sensible) | Pedernal crea y después pone el precio | **Solo pantalla**, pero cambia el flujo de venta (hoy un PV nace con precio). **PROPUESTA: no se toca ahora** |
| 10 | **Departamento / Sección de la carta** | «Departamento» (árbol de clasificación) y «Sección de la carta» en Datos | «Categoría» plana + «+ Nueva categoría» | Falta el árbol | **Modelo** (E1 de clasificación, ya diseñado; sin turno de schema todavía) |
| 11 | **Insumo (familia) y «¿Ya comprás esto a otro proveedor?»** | No existe en el alta | «Sin insumo» + «+ Nuevo insumo» + asistente de agrupar | Solo Motor2 | **Solo pantalla** (esconderlo del alta; **PROPUESTA**: no se toca hasta que el dueño lo pida) |
| 12 | **Consignación** | No existe en el alta | Casilla «Es consignación» | Solo Motor2 | Igual que 11: **no se toca** (nadie lo pidió) |
| 13 | **Se controla el stock** | Tilde para lo que no es vendible puro | No existe (siempre se controla) | Concepto distinto | Fuera de alcance (el diseño de clases lo deja afuera) |
| 14 | **Alta rápida desde la compra** | Nombre, «¿Qué es?» (Materia prima, Insumo, Reventa; en la receta: Materia prima, Elaborado, Reventa), Unidad | «Alta rápida de producto» (solo materia prima) | Faltan las clases | Misma separación que 1 |

## 3. Qué se construye ahora (solo pantalla, sin schema, con interruptor reversible)

Pedido del dueño, 2026-11-17: que el producto nuevo tenga los estados de Pedernal y no tenga lo que Pedernal sacó. Lo que se puede hacer **sin tocar el modelo** (filas 1 a 3):

1. **«¿Qué es?»** reemplaza a los dos botones MP/PV en el alta, con las **tres clases que hoy se pueden guardar** y sus descripciones literales de Pedernal («Se compra y es componente de lo que se elabora y se vende.» / «Se produce en el negocio y se usa como componente.» / «Se arma o se produce y se vende; tiene composición.»). Cada una se guarda como hoy: Materia prima = tipo MP; Elaborado = tipo MP con «se produce»; Producto vendible = tipo PV.
2. **Desaparece la casilla «Se produce (tiene receta propia, se fabrica por lote)»**, del alta y de la edición (la clase se ve, no se cambia).
3. **Desaparece «Activo en todas las sucursales»** del alta: el producto nace disponible en todas las sucursales, como con el tilde puesto (el valor de hoy). Si quien crea un producto de venta no tiene la clave de campos sensibles, el aviso de que nace sin poder venderse se mantiene.
4. **Interruptor reversible** (`ALTA_DE_PRODUCTO_COMO_PEDERNAL`, una línea): en `false` vuelve la pantalla anterior, sin migración.

**Qué NO entra (nadie lo pidió o necesita el modelo):** Insumo y Reventa (columna `claseDeUso`, diseño de clases E1 y E4), «Código de barras», el árbol de departamentos, sacar el precio del alta, esconder consignación e insumo.

## 4. Qué cambia el modelo (se pide turno de schema; nada se construye)

Para ofrecer las **cinco** clases hace falta la columna `Producto.claseDeUso` (migración aditiva y reversible, con `down.sql`): está diseñada con sus niveles 6 a 10 en `docs/diseno-clases-de-producto-como-pedernal-2026-11-15.md` §6 (columna con `CHECK`, disparador de inmutabilidad, relleno solo con lo seguro: «Solo lo seguro; Insumo y Reventa para altas nuevas», dueño, 2026-11-15) y E1 a E4 en §13. **Pedido al orquestador general:** turno de schema para **E1 (la columna)**, luego E2 (alta con las 5 clases), E3 (Insumo) y E4 (Reventa). «Código de barras» y el árbol de departamentos quedan para sus propios turnos.

## 5. Pruebas y verificación

- Combinaciones (regla del 2026-10-28): dimensiones = clase (3) × permiso de campos sensibles (con/sin) × interruptor (encendido/apagado); oráculo escrito aparte; un guardián falla si el alta ofrece una clase que no se puede guardar.
- Pruebas de pantalla (jsdom y e2e a 375 px) del alta con las tres clases, de que ya no están las dos casillas y de que el producto nace disponible en todas las sucursales; el interruptor apagado devuelve la pantalla anterior.
- Captura ANTES/DESPUÉS con datos de ejemplo declarados (regla de maquetas); compuerta: CI de GitHub.

## 6. Preguntas abiertas

Ninguna para lo que se construye ahora. **Una para el dueño, con ejemplo** (si responde que no, no cambia nada de lo anterior): al crear un producto de venta, hoy Motor2 pide el **precio** en la misma pantalla; Pedernal lo pide después de guardar, en la pestaña «Precios». ¿Querés que el precio salga del alta (el producto se crea primero y se le pone precio después, como Pedernal)? **Recomendada: no tocarlo ahora**, porque hoy un producto sin precio no se puede vender y el aviso «nace sin poder venderse» ya lo explica.
