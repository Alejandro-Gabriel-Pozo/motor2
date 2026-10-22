# Medición «antes» del espacio del producto — 2026-10-21

Fase 6 «Interfaz del producto», paso 6.0.2. Este documento fija **cómo se mide** cuánto camino piden hoy cuatro tareas del producto y deja la tabla «antes» **para completar con los números de la primera corrida**. La medición la hace `test/e2e/medicion-tareas-del-producto.spec.ts`; el documento no trae cifras inventadas.

## 1. Para qué sirve

El bloque 2 de la Fase 6 junta lo del producto en un solo espacio (hoy está repartido entre la lista de productos, su ficha, «Editar», «Opciones de venta» del producto, «Opciones de venta» de la empresa y la carta). El umbral del dueño es:

- **No peor que hoy** en pantallas y en clics, en las cuatro tareas.
- **0 salidas del espacio** en las tareas de opciones y de publicar (b, c y d).

«Hoy» necesita números, y tienen que salir de las mismas pantallas que se van a reemplazar. Por eso esta medición se corre **antes** de tocar nada del bloque 2 y se guarda en este documento. En 6.21 la misma spec se reescribe con los recorridos nuevos, afirma los umbrales y se completa la columna «después».

## 2. Cómo se mide

Todo se mide a 1280 px de ancho, con el menú lateral a la vista, con un administrador (tiene `producto_campos_sensibles`). No mide tiempo.

| Métrica | Qué cuenta | Cómo |
|---|---|---|
| **Pantallas** | Rutas distintas visitadas, la de partida incluida. | `page.on("framenavigated")` sobre el marco principal. Cuenta cuando **cambia el path**; el mismo path con otra query (`?nivel=visibilidad`, `?guardado=alta`) o un refresco no cuentan. El id de un grupo o de un producto se normaliza a `[id]`: dos grupos distintos son la misma pantalla «`/catalogo/opciones/[id]`». |
| **Visitas** | Cambios de path tal cual, con las repeticiones. | Mismo medidor; la `secuencia` del JSON las lista en orden. Sirve para ver cuánto se vuelve atrás. |
| **Clics** | Toques que da la persona. | Un ayudante `clic` que envuelve `locator.click`, y `marcar` (un radio o una casilla es un clic). Llegar a la pantalla de partida **no** es un clic. Llegar a otra pantalla por el menú cuenta **todos** los clics que hagan falta: el panel Empresa/Sucursal y el grupo del menú, si están cerrados, y el enlace. |
| **Campos tocados** | Campos que la persona escribe o elige. | `llenar` (escribir), `elegir` (un desplegable) y `marcar` (un radio o una casilla cuenta como clic **y** como campo). Lo que se deja como viene no cuenta. |
| **Salidas del espacio** | Cuántas veces hay que dejar la pantalla de la tarea para ir a otra pantalla distinta de administración. | Solo en b, c y d. Hoy se calcula como **pantallas distintas menos 1** (la de partida no es una salida). En la tarea a no aplica. |

Cada paso del recorrido lleva un nombre. Si algo falla, el mensaje dice «`[medición <tarea>] no se pudo «<paso>»: …`», en vez de un selector suelto.

## 3. Las cuatro tareas, con los pasos de hoy

Cada tarea arranca en una pantalla de partida y se recorre solo con clics y campos; no se escribe una dirección a mitad de camino.

### a) Crear un producto directo hasta que quede vendible

Parte de la lista de productos. «Directo o base» es hoy el campo «¿Cómo se vende?», que **solo existe al editar**: el alta nace directa, así que elegir «directo» no cuesta ningún paso.

1. Abrir la lista de productos.
2. Tocar «+ Nuevo producto».
3. Elegir «Producto de venta (PV)».
4. Escribir el nombre.
5. Elegir la unidad de stock.
6. Escribir el precio de venta.
7. Tocar «Crear producto». Se llega a la ficha del producto.

**Terminó bien si:** el producto es de venta, directo, tiene el precio cargado y quedó disponible en la sucursal activa.

### b) Crear una base configurable con un grupo de precio final de 3 opciones y una opción incluida

Parte de «Opciones de venta» (`/catalogo/opciones`). Hoy son cinco bloques, en cuatro familias de pantalla.

1. **Grupo de tamaños.** Tocar «+ Nuevo grupo», escribir el nombre, elegir el tipo «Tamaño», tocar «Crear grupo», abrir el grupo creado, tocar «+ Agregar opción» y, **por cada una de las 3 opciones**, escribir su nombre, escribir su diferencia (0, porque el precio final no vive acá) y tocar «Agregar opción».
2. **Grupo de lo incluido.** Volver a «Opciones de venta», tocar «+ Nuevo grupo», escribir el nombre, elegir «Incluida sin costo», tocar «Crear grupo», abrirlo, tocar «+ Agregar opción», escribir el nombre de la opción y tocar «Agregar opción».
3. **El producto.** Ir por el menú a «Productos», tocar «+ Nuevo producto» y completarlo como en la tarea a (tipo, nombre, unidad, precio guardado, «Crear producto»).
4. **Los grupos en el producto.** En la ficha, tocar «Editar opciones». Elegir el grupo de tamaños y tocar «Agregar»; elegir «Precio propio por tamaño», escribir el **precio final de cada una de las 3 opciones** y tocar «Guardar» del grupo. Elegir el grupo de lo incluido y tocar «Agregar» (admite su opción sola).
5. **Pasarlo a «Por opción».** Volver a la ficha, tocar «Editar», elegir «Por opción» en «¿Cómo se vende?» (solo se habilita cuando el producto ya tiene el grupo con precio final) y tocar «Guardar cambios».

**Terminó bien si:** el producto quedó en «Por opción» y admite los dos grupos (el de tamaños en precio propio, con los 3 precios finales cargados, y el de lo incluido con su opción).

### c) Cambiar el precio final de una opción

Parte de la ficha de una base ya armada (sembrada en la base de pruebas).

1. En la ficha, tocar «Editar opciones».
2. En el grupo de tamaños, escribir el precio nuevo de la opción.
3. Tocar «Guardar» del grupo. «Así se cobra» muestra el precio nuevo.

**Terminó bien si:** el precio nuevo quedó guardado en esa opción y las otras siguen igual.

### d) Publicar el producto en la carta

Parte de la ficha de una base ya armada. Hoy la carta es otro módulo: la ficha del producto no tiene ningún acceso a ella.

1. Ir por el menú a «Carta pública» (abre el panel Sucursal y el grupo «Carta» si están cerrados).
2. Tocar «Visibilidad».
3. Abrir «Fuera de carta».
4. Buscar el producto por su nombre.
5. Tocar «Agregar a la carta» y elegir la sección.

**Terminó bien si:** el aviso dice que el producto ya sale en la carta y el producto tiene contenido visible en esa sección.

## 4. Cómo correrla

La spec escribe el JSON **solo si existe** `MOTOR2_MEDICIONES`:

- Si el valor termina en `.json`, es **un archivo** con el arreglo de las cuatro mediciones (cada tarea reemplaza su entrada).
- Si no, es una **carpeta** y cada tarea escribe su archivo `<tarea>.json`.
- Cada medición es `{ tarea, pantallas, rutas, clics, campos, salidas, visitas, secuencia }`. Una tarea que falla no escribe nada.

```
MOTOR2_MEDICIONES=<ruta>/antes.json MOTOR2_E2E_SERVIDOR=dev \
  node scripts/operaciones/con-env.mjs <env-e2e> -- npx playwright test medicion-tareas-del-producto
```

Es la misma corrida que cualquier spec de Playwright: la base e2e se vacía al empezar, así que **no** se puede correr a la vez que otra corrida e2e. Se corre en el commit de entrada del bloque 2, antes de 6.2 en adelante. Si cambia una pantalla de las cuatro tareas **sin** ser parte del bloque 2, hay que volver a correrla y actualizar la tabla.

Antes de fiarse de los números, dos mutaciones a mano (están en el encabezado de la spec):

1. Cambiar el selector de un paso: la tarea tiene que fallar nombrando el paso, sin escribir JSON.
2. Sacar un clic: el recorrido falla, o el número `clics` baja en uno.

## 5. Tabla «antes» (primera corrida)

Commit de la medición: c17c3c52 (spec) · Fecha de la corrida: 2026-10-21 · Servidor: `MOTOR2_E2E_SERVIDOR=dev` (4 pruebas pasaron en 1,5 min)

| Tarea | Pantallas | Clics | Campos | Salidas | Visitas |
|---|---|---|---|---|---|
| a) Producto directo vendible | 3 | 3 | 4 | no aplica | 3 |
| b) Base configurable (3 opciones + 1 incluida) | 7 | 28 | 22 | 6 | 11 |
| c) Cambiar el precio final de una opción | 2 | 2 | 1 | 1 | 2 |
| d) Publicar en la carta | 2 | 6 | 1 | 1 | 2 |

Rutas de cada tarea (`rutas` del JSON de la corrida; los ids se normalizan a `[id]`):

- **a)** `/catalogo/productos` → `/catalogo/productos/nuevo` → `/catalogo/productos/[id]`.
- **b)** `/catalogo/opciones` → `/catalogo/opciones/[id]` → `/catalogo/productos` → `/catalogo/productos/nuevo` → `/catalogo/productos/[id]` → `/catalogo/productos/[id]/opciones` → `/catalogo/productos/[id]/editar` (11 visitas: se vuelve atrás a la lista de grupos y a la ficha varias veces; para dejar la base armada hay que salir del grupo, crear el producto y volver a editarlo para pasarlo a «Por opción»).
- **c)** `/catalogo/productos/[id]` → `/catalogo/productos/[id]/opciones`.
- **d)** `/catalogo/productos/[id]` → `/carta`.

Lectura: crear una base configurable (b) es la tarea más pesada de hoy, con 7 pantallas, 28 clics, 22 campos y 6 salidas; es la vara que el espacio del producto tiene que mejorar.

## 6. Después (6.21)

La spec se reescribió con los recorridos del espacio y **afirma el umbral de DEC-12**: en las cuatro tareas, pantallas y clics **no peores** que la tabla «antes» (constantes `ANTES`, citadas del §5) y **0 salidas del espacio** en b, c y d (`salidasDelEspacio`: las visitas, después de la pantalla de partida, a una pantalla que no es del espacio del producto: el alta, la portada y sus pasos). La definición vieja de salidas (pantallas distintas menos 1) sigue en el JSON como `salidas`, para comparar con el «antes».

Corrida: 2026-10-22 · Código medido: rama `alegp/carril-b` con 6.15b, 6.15c y 6.17c (último commit de código, `6666dd43`) · Servidor: build de producción (`next start`) a 1280 px · 83 pruebas pasaron en 7,4 min (las cuatro tareas, el espacio, la línea de base y accesibilidad).

| Tarea | Pantallas | Clics | Campos | Salidas del espacio | Visitas |
|---|---|---|---|---|---|
| a) Producto directo vendible | 3 → **3** | 3 → **3** | 4 → **4** | no aplica | 3 → **3** |
| b) Base configurable (3 opciones + 1 incluida) | 7 → **5** | 28 → **13** | 22 → **16** | 6 → **0** | 11 → **6** |
| c) Cambiar el precio final de una opción | 2 → **2** | 2 → **2** | 1 → **1** | 1 → **0** | 2 → **2** |
| d) Publicar en la carta | 2 → **2** | 6 → **2** | 1 → **1** | 1 → **0** | 2 → **2** |

(«antes» → **después**.) Ninguna tarea empeora y b, c y d quedan en 0 salidas del espacio.

Recorridos nuevos (`rutas` del JSON; los ids se normalizan a `[id]`):

- **a)** `/catalogo/productos` → `/catalogo/productos/nuevo` → `/catalogo/productos/[id]`. Igual que antes: el alta ya no necesitaba más.
- **b)** `/catalogo/productos` → `/catalogo/productos/nuevo` → `/catalogo/productos/[id]` → `/catalogo/productos/[id]/opciones` → `/catalogo/productos/[id]/datos` → `/catalogo/productos/[id]` (6 visitas). Los dos grupos se crean en la ventana «+ Nuevo grupo» del paso 2 (el grupo, sus opciones y lo que el producto admite de ellas, en una sola operación), sin pasar por la biblioteca de «Opciones de venta»; «Por opción» se marca en el paso 1, a un clic desde el paso 2. Parte de la lista de productos (antes partía de «Opciones de venta»: ya no hace falta ir a otro lado a crear los grupos).
- **c)** `/catalogo/productos/[id]` → `/catalogo/productos/[id]/opciones`. Igual: el paso «Opciones y precio» es el mismo lugar que antes, dentro del marco.
- **d)** `/catalogo/productos/[id]` → `/catalogo/productos/[id]/en-la-carta`. Antes había que ir por el menú a la carta, abrir «Visibilidad» y «Fuera de carta», buscar el producto y agregarlo; ahora es el paso «En la carta» del producto: «En la carta» → elegir la sección → «Guardar contenido».

Lectura: la tarea más pesada de hoy (b) pasó de 7 pantallas, 28 clics y 6 salidas a 5 pantallas, 13 clics y 0 salidas; publicar en la carta (d) pasó de 6 clics y una salida a 2 clics y ninguna.

Las mutaciones que demuestran que el umbral muerde están en el encabezado de la spec: en (c), ir por la biblioteca (`/catalogo/opciones/[id]`) da `salidasDelEspacio` = 1 y falla; un clic de más en (c) da 3 clics contra 2 y falla.

Las dos mutaciones se corrieron (2026-10-22) y las dos dieron rojo: ir por la biblioteca en (c) (`c-cambiar-precio-final: pantallas (antes 2)`, además de 1 salida del espacio) y el clic de más (`c-cambiar-precio-final: clics (antes 2)`). Se deshicieron.

Capturas a 375 y a 1280 px (la portada recién creada, el paso 2 con la ventana «+ Nuevo grupo», el paso 2 al final de la base y el paso 4): las saca la spec del espacio con `MOTOR2_CAPTURAS_MOVIL=<carpeta> MOTOR2_E2E_SERVIDOR=start node scripts/operaciones/con-env.mjs <env-e2e> -- npx playwright test espacio-del-producto.spec`.
