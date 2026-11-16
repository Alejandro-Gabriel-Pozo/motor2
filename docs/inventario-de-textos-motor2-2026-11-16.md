# Inventario de textos de Motor2: estado real medido (2026-11-16)

Pedido del dueño (2026-11-16, chat con el orquestador): «Los textos encargarte vos trata de reducir, textos, inventariar y empezar a reutilizar y que representen 1 sola cosa, definir primitivas e invariantes en texto igual que pedernal» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Textos: el orquestador se encarga…»). Diseño que lo usa: `docs/diseno-textos-en-codigo-2026-11-16.md`.

**Qué es este documento:** el inventario del estado real del código (`main` `66e20d1a`, #310), leído con un script de SOLO LECTURA (recorre `src/` y `plataforma/src/` con el árbol sintáctico de TypeScript; el script no se commitea y no toca ninguna base). **No decide nada ni aprueba ningún texto:** la columna «aprobado por el dueño» de la tabla completa dice «SIN VERIFICAR» en todas las filas, porque no hay en el código ninguna marca de aprobación que se pueda leer (ver el diseño, §1).

**† = aproximado.** El script no ve: textos armados en varias piezas por funciones, textos que vienen de la base o de un servicio, ni los literales de pruebas y seeds (no se miden). Cuenta de más: algún literal que parece frase y es un dato interno (por ejemplo una descripción de auditoría); cuenta de menos: frases de una sola palabra en minúscula y números armados. Toda cifra es una cota de orden de magnitud, no un conteo exacto.

**Dónde queda el inventario completo.** Son 5.697 filas (unos 930 KB): supera el tope de 400 líneas y queda FUERA del repo, en un CSV generado por el script (la sesión informa su ubicación en el mensaje de entrega) (columnas: archivo, línea, tipo, clave o código, texto, módulo, apariciones, dinámico, fuente, citado en test, aprobado por el dueño). Si el orquestador lo quiere en el repo, se commitea aparte (propuesta: no, queda viejo con el primer PR que cambie un texto; conviene regenerarlo por script en cada tramo).

## 1. Cifras

| Medida | Cifra † |
|---|---|
| Archivos `.ts`/`.tsx` recorridos (`src/` y `plataforma/src/`) | 1.300 |
| Archivos con al menos un texto | 718 |
| Apariciones de texto visible (una por lugar) | 5.697 |
| Textos DISTINTOS (valor normalizado: `${…}` = marcador) | 4.300 |
| Valores que aparecen más de una vez (candidatos a unir) | 668, con 2.065 apariciones |
| …de ellos, en más de un archivo | 516 (152 se repiten dentro de un solo archivo) |
| …de ellos, entre capas distintas (servidor y pantalla, núcleo y pantalla) | 236 |
| …de ellos, bajo claves o tipos de lugar distintos (etiqueta, placeholder, aria-label, mensaje) | 267 |
| Entradas que desaparecerían si se unieran TODOS los repetidos (cota máxima; muchos son homónimos legítimos) | 1.397 |
| Textos con partes que cambian (`${…}`) | 1.207 |
| Mensajes de error / de éxito de acciones y casos de uso (`ok`, `error`, `exito`, `fracaso`) | 396 de error + 163 de éxito |
| …`fracaso(codigo, mensaje)` con código público | 364, con 167 códigos distintos |
| Códigos con MÁS DE UN texto distinto (misma causa, frases distintas) | 46 de 167 |
| Textos estáticos de 12 o más caracteres, distintos | 2.747 |
| …de ellos, citados literalmente en algún archivo de `test/` (los fija una prueba) | 1.132 |
| Textos con una cita de decisión/aprobación en las 5 líneas anteriores del código | 85 (†: es una búsqueda de «DEC-n», «aprobad…» o «decisión del dueño») |
| **Textos sin fuente declarada** (el resto) | 5.612 de 5.697 |
| Textos escritos a mano en JSX (texto entre etiquetas y atributos `aria-label`, `placeholder`, `title`, `alt`, `label`…) | 1.693 + 654 = 2.347 |
| Textos escritos en acciones y casos de uso del servidor (`src/server/actions`) | 847 |

Por tipo de lugar: JSX_TEXTO 1.693, PROPIEDAD_DE_TEXTO 1.029, OTRO_LITERAL_DE_FRASE 1.520, JSX_ATRIBUTO 654, RETORNO_DE_FRASE 242, MENSAJE_ERROR 396, MENSAJE_EXITO 163.
Por capa: app (páginas) 2.590, core 1.484, server/actions 847, components 468, plataforma 207, server (otros) 77, otros 14, ui 10.

**Catálogo de textos de interfaz que ya exista en el código: 0 entradas.** No hay un lugar único donde viva la palabra (ver el diseño, §1: lo que el código llama «texto de catálogo» es la regla de validación de NOMBRES, no un diccionario).

## 2. Familias de causa repetida (misma cosa, frases distintas)

| Familia (patrón) | Apariciones † | Frases distintas † |
|---|---|---|
| «No se encontró {el/la/ese} X.» | 174 | 69 |
| «No tenés permiso/acceso…» | 19 | 14 |
| «… no puede estar vacío», «Elegí …», «Ingresá …» | 135 | 96 |
| «Ya existe / ya hay / ya está …» | 51 | 37 |
| «… Revisá tu conexión …» | 11 | 11 |
| «… no puede superar / caracteres no permitidos» | 15 | 12 |

## 3. Códigos públicos con más de una frase (los 20 con más variantes)

Un código de `fracaso(codigo, mensaje)` nombra UNA causa; acá cada causa se dice de varias maneras.

| Código | Frases distintas | Apariciones | Ejemplo 1 | Ejemplo 2 |
|---|---|---|---|---|
| `NOMBRE_REPETIDO` | 16 | 24 | Ya existe el género "{}". | Ya existe el ítem agrupado "{}". |
| `CONFIGURACION_INVALIDA` | 14 | 14 | {} ya está en «{}» {}: dala de baja si querés cambiar el modo. | «{}»: la configuración repite una opción o tiene una cantidad fuera de 1 a 10. |
| `VERSION_DESACTUALIZADA` | 8 | 8 | Otra persona cambió «{}» mientras la editabas. Recargá la pantalla y volvé a intentar. | El precio o el consumo de «{}» cambió mientras lo editabas: otra persona cargó un cambio antes. Recargá la pan |
| `PRECIO_DESACTUALIZADO` | 6 | 6 | El precio de "{}" en esta sucursal cambió mientras lo editabas ({}). Recargá la pantalla y volvé a hacer el ca | El precio vigente ahora es {}. Revisalo y volvé a intentar. |
| `SECCION_NO_ENCONTRADA` | 5 | 14 | No se encontró la sección de carta. | Alguna sección de carta de los cupos no existe. |
| `PRODUCTO_NO_ENCONTRADO` | 5 | 24 | No se encontró el producto. | No se encontró ese producto. |
| `NO_ENCONTRADO` | 5 | 9 | No se encontró ese proveedor. | No se encontró alguno de los grupos u opciones elegidos: recargá la pantalla. No se cambió nada. |
| `PRODUCTO_NO_ELEGIBLE` | 5 | 9 | «{}» no es un producto de venta: solo un producto de venta admite opciones. | «{}» es el producto de respaldo de un adicional: no admite opciones. |
| `BASE_INVALIDA` | 4 | 4 | "{}" se vende por opción y no se puede poner a la venta así: {} | «¿Cómo se vende?» no tiene un valor válido: recargá la pantalla y volvé a elegirlo. |
| `NO_ENCONTRADA` | 4 | 7 | No se encontró el depósito. | No se encontró esa fila de Frecuencia de conteo. |
| `PRODUCTO_INVALIDO` | 4 | 4 | El producto no existe. | «{}» no se puede pedir: solo se piden productos de venta (PV). |
| `NO_ES_PV` | 3 | 7 | Solo un producto de venta (PV) puede ir en la carta. | Solo un producto de venta (PV) puede tener descuento. |
| `ES_BASE_CONFIGURABLE` | 3 | 3 | «{}» se vende por opción (el precio final está en cada opción): no va en un ítem agrupado, que muestra un solo | «{}» se vende por opción: su precio en esta sucursal es el de cada opción. Cargalo en las opciones de venta de |
| `ES_ANCLA_DE_ADICIONAL` | 3 | 3 | «{}» es el producto de respaldo de un adicional: se vende solo como adicional, no va suelto en la carta. | "{}" es el producto de respaldo de un adicional: se vende solo como adicional, no se pone a la venta suelto. |
| `SUCURSAL_INACTIVA` | 3 | 3 | La sucursal «{}» está desactivada: no se pueden abrir cuentas. | La sucursal «{}» está desactivada: no se pueden abrir mesas. |
| `SUCURSAL_NO_ENCONTRADA` | 2 | 5 | No se encontró esa sucursal. | No se encontró la sucursal. |
| `NOMBRE_TOMADO` | 2 | 6 | Ya existe una sucursal "{}". | Ya existe el rol "{}". |
| `CUPO_INVALIDO` | 2 | 3 | «{}» está dado de baja en la promo: volvé a agregarlo en sus cupos. | Ese lugar de la promo no es una lista propia: sus opciones salen de una sección de la carta o del plato del dí |
| `SLUG_TOMADO` | 2 | 2 | Otra carga simultánea tomó el mismo slug. Volvé a intentar. | Otra sucursal tomó ese slug mientras guardabas. Revisalo y volvé a intentar. |
| `DATO_INVALIDO` | 2 | 2 | El nombre «{}» no sirve como nombre de carta{}: escribí uno en la ficha del producto. | Falta el nombre que tenía el proveedor al abrir la pantalla: recargala y volvé a intentar. |

## 4. Resumen por módulo (los 40 con más textos)

| Módulo (carpeta) | Apariciones | Distintos | Mensajes de acción | En JSX |
|---|---|---|---|---|
| `app/app` | 2262 | 1623 | 0 | 1706 |
| `core/features` | 406 | 327 | 0 | 0 |
| `server/actions/catalogo` | 285 | 251 | 191 | 0 |
| `core/carta` | 280 | 202 | 0 | 0 |
| `app/pos` | 255 | 205 | 0 | 176 |
| `components/catalogo` | 219 | 201 | 0 | 172 |
| `plataforma` | 207 | 183 | 0 | 90 |
| `core/permisos` | 166 | 166 | 0 | 0 |
| `server/actions/carta` | 159 | 120 | 124 | 0 |
| `core/catalogo` | 143 | 139 | 0 | 0 |
| `components/carta` | 130 | 120 | 0 | 69 |
| `server/actions/movimientos` | 124 | 105 | 70 | 0 |
| `server/actions/pos` | 88 | 80 | 69 | 0 |
| `core/opciones` | 87 | 87 | 4 | 0 |
| `server/actions/auth` | 85 | 70 | 37 | 0 |
| `core/movimientos` | 83 | 76 | 0 | 0 |
| `core/compras` | 62 | 62 | 0 | 0 |
| `core/pos` | 61 | 53 | 0 | 0 |
| `core/navegacion` | 58 | 58 | 0 | 0 |
| `server/consultas/reportes` | 40 | 40 | 0 | 0 |
| `core/datos` | 39 | 33 | 0 | 0 |
| `core/reportes` | 39 | 37 | 0 | 0 |
| `server/actions/stock` | 35 | 28 | 24 | 0 |
| `app/invitacion` | 34 | 28 | 0 | 27 |
| `server/actions/permisos` | 22 | 18 | 16 | 0 |
| `server/actions/traspasos` | 22 | 19 | 10 | 0 |
| `components/carta-publica` | 20 | 18 | 0 | 11 |
| `app/login` | 19 | 15 | 0 | 15 |
| `core/stock` | 19 | 19 | 0 | 0 |
| `components/selector-rango.tsx` | 12 | 12 | 0 | 12 |
| `core/plataforma` | 12 | 12 | 0 | 0 |
| `server/lecturas/catalogo` | 12 | 11 | 0 | 0 |
| `core/correo` | 11 | 11 | 0 | 0 |
| `server/actions/clientes` | 11 | 6 | 10 | 0 |
| `components/stock` | 10 | 10 | 0 | 10 |
| `components/mesas` | 9 | 9 | 0 | 5 |
| `components/receta` | 9 | 9 | 0 | 6 |
| `server/actions/reportes` | 9 | 9 | 3 | 0 |
| `app/carta-publica` | 8 | 7 | 0 | 5 |
| `app/api` | 8 | 7 | 0 | 0 |
| (el resto: 55 carpetas) | 137 | | | |

## 5. Los 100 valores repetidos más frecuentes

«Capas» dice dónde aparece; «lugares» el tipo de sitio (JSX_TEXTO, etiqueta, mensaje…). Que un valor se repita NO prueba que sea la misma cosa: «Estado» puede ser el de una empresa o el de una operación (ver diseño, §5, homónimos).

| # | Veces | Archivos | Texto | Capas | Lugares |
|---|---|---|---|---|---|
| 1 | 38 | 33 | Producto | app (páginas) | JSX_TEXTO, etiqueta |
| 2 | 33 | 28 | No se encontró el producto. | core, server/actions | OTRO_LITERAL_DE_FRASE, MENSAJE_ERROR |
| 3 | 29 | 25 | Cancelar | app (páginas), components, plataforma | JSX_TEXTO, etiqueta |
| 4 | 28 | 28 | Cantidad | app (páginas), components | JSX_TEXTO, etiqueta, placeholder |
| 5 | 24 | 18 | Nombre | app (páginas), components, plataforma | etiqueta, JSX_TEXTO, placeholder, aria-label |
| 6 | 23 | 20 | Acciones | app (páginas), components | JSX_TEXTO |
| 7 | 15 | 13 | Insumo | app (páginas) | etiqueta, JSX_TEXTO |
| 8 | 13 | 10 | Quitar | app (páginas), components | JSX_TEXTO, etiqueta |
| 9 | 12 | 12 | Fecha | app (páginas) | etiqueta, JSX_TEXTO |
| 10 | 12 | 10 | Editar | app (páginas) | JSX_TEXTO |
| 11 | 12 | 11 | Proveedor | app (páginas) | JSX_TEXTO, etiqueta |
| 12 | 11 | 11 | Estado | app (páginas), components, plataforma | JSX_TEXTO, etiqueta |
| 13 | 11 | 8 | Guardar | app (páginas) | JSX_TEXTO |
| 14 | 11 | 10 | Depósito | app (páginas) | etiqueta, JSX_TEXTO |
| 15 | 11 | 1 | Encabezado y títulos | core | OTRO_LITERAL_DE_FRASE |
| 16 | 10 | 9 | Activo | app (páginas), components, plataforma | JSX_TEXTO, RETORNO_DE_FRASE |
| 17 | 10 | 8 | Sección | app (páginas) | JSX_TEXTO, etiqueta |
| 18 | 9 | 6 | Importe | app (páginas) | etiqueta, JSX_TEXTO |
| 19 | 9 | 1 | Portada e identidad | core | OTRO_LITERAL_DE_FRASE |
| 20 | 9 | 7 | No se encontró la promo. | core, server/actions | OTRO_LITERAL_DE_FRASE, MENSAJE_ERROR |
| 21 | 9 | 6 | El nombre no puede estar vacío. | core, server/actions, server (otros) | OTRO_LITERAL_DE_FRASE |
| 22 | 8 | 5 | El orden | app (páginas), components, core | etiqueta, OTRO_LITERAL_DE_FRASE |
| 23 | 8 | 6 | Orden | app (páginas), components | etiqueta, JSX_TEXTO |
| 24 | 8 | 8 | Desde | app (páginas), components | JSX_TEXTO, etiqueta |
| 25 | 8 | 6 | Elegí un depósito | app (páginas) | JSX_TEXTO |
| 26 | 8 | 2 | Invitación | app (páginas), plataforma | JSX_TEXTO |
| 27 | 8 | 1 | Colores generales | core | OTRO_LITERAL_DE_FRASE |
| 28 | 7 | 7 | Crear | app (páginas), components | JSX_TEXTO |
| 29 | 7 | 4 | Email | app (páginas), plataforma | JSX_TEXTO, etiqueta, aria-label, placeholder |
| 30 | 7 | 7 | Carta | app (páginas), core | etiqueta, label |
| 31 | 7 | 7 | Cerrar | app (páginas), components, ui | JSX_TEXTO, aria-label |
| 32 | 7 | 5 | Unidad de compra | app (páginas), components | etiqueta, JSX_TEXTO |
| 33 | 7 | 7 | Detalle | app (páginas), plataforma | JSX_TEXTO, etiqueta |
| 34 | 7 | 1 | Banda e imagen de sección | core | OTRO_LITERAL_DE_FRASE |
| 35 | 7 | 6 | No se encontró el depósito. | core, server/actions | OTRO_LITERAL_DE_FRASE, MENSAJE_ERROR |
| 36 | 7 | 3 | La empresa no existe. | plataforma | mensaje |
| 37 | 6 | 6 | Página siguiente → | app (páginas) | JSX_TEXTO |
| 38 | 6 | 6 | Sucursal | app (páginas), components | etiqueta, JSX_TEXTO, label |
| 39 | 6 | 6 | Acción | app (páginas), plataforma | JSX_TEXTO, etiqueta |
| 40 | 6 | 6 | Reintentar | app (páginas), plataforma | JSX_TEXTO |
| 41 | 6 | 6 | El precio | app (páginas), components, core | etiqueta, OTRO_LITERAL_DE_FRASE |
| 42 | 6 | 5 | Categoría | app (páginas) | JSX_TEXTO, etiqueta |
| 43 | 6 | 5 | Datos | app (páginas), components, core | JSX_TEXTO, texto, RETORNO_DE_FRASE |
| 44 | 6 | 5 | Sin categoría | app (páginas), core | JSX_TEXTO, OTRO_LITERAL_DE_FRASE |
| 45 | 6 | 4 | Productos | app (páginas), core | JSX_TEXTO, aria-label, etiqueta, texto, label |
| 46 | 6 | 5 | El factor de conversión | app (páginas), components, core, server/actions, server (otros) | etiqueta |
| 47 | 6 | 6 | Merma % | app (páginas), components | placeholder, JSX_TEXTO |
| 48 | 6 | 6 | Detalle (opcional) | app (páginas) | etiqueta |
| 49 | 6 | 6 | Qué configurar | app (páginas), components | etiqueta |
| 50 | 6 | 6 | Hasta | app (páginas), components | etiqueta, JSX_TEXTO |
| 51 | 6 | 1 | Navegación y barra superior | core | OTRO_LITERAL_DE_FRASE |
| 52 | 6 | 1 | Tipografía de portada | core | OTRO_LITERAL_DE_FRASE |
| 53 | 6 | 5 | Falta {}. | core | mensaje, OTRO_LITERAL_DE_FRASE |
| 54 | 6 | 6 | La descripción | core | OTRO_LITERAL_DE_FRASE |
| 55 | 6 | 6 | El producto no existe. | core, server/actions | OTRO_LITERAL_DE_FRASE, mensaje, MENSAJE_ERROR |
| 56 | 6 | 6 | No se encontró la sección de carta. | server/actions | MENSAJE_ERROR |
| 57 | 5 | 5 | Descripción | app (páginas), components, core | etiqueta |
| 58 | 5 | 4 | Descripción (opcional) | app (páginas), components | etiqueta, aria-label |
| 59 | 5 | 3 | Por opción | app (páginas), components | OTRO_LITERAL_DE_FRASE |
| 60 | 5 | 4 | Opciones de {} | app (páginas) | aria-label |
| 61 | 5 | 5 | Grupo | app (páginas), components | JSX_TEXTO, etiqueta |
| 62 | 5 | 3 | Unidad de stock | app (páginas), components | etiqueta, JSX_TEXTO |
| 63 | 5 | 3 | ← Volver a Recetas | app (páginas) | JSX_TEXTO |
| 64 | 5 | 4 | Merma | app (páginas), core | JSX_TEXTO, titulo, label |
| 65 | 5 | 4 | El importe | app (páginas), core | etiqueta, OTRO_LITERAL_DE_FRASE |
| 66 | 5 | 4 | Sin proveedor | app (páginas), core | JSX_TEXTO, OTRO_LITERAL_DE_FRASE |
| 67 | 5 | 5 | Diferencia | app (páginas) | JSX_TEXTO, etiqueta |
| 68 | 5 | 4 | Saldo | app (páginas) | etiqueta, JSX_TEXTO |
| 69 | 5 | 2 | Motor2 | app (páginas), components | JSX_TEXTO |
| 70 | 5 | 1 | Fondo y mapa | core | OTRO_LITERAL_DE_FRASE |
| 71 | 5 | 1 | Ítems especiales | core | OTRO_LITERAL_DE_FRASE |
| 72 | 5 | 1 | Textos fijos | core | OTRO_LITERAL_DE_FRASE |
| 73 | 5 | 1 | Tipografía de índice | core | OTRO_LITERAL_DE_FRASE |
| 74 | 5 | 1 | Tipografía de ítems | core | OTRO_LITERAL_DE_FRASE |
| 75 | 5 | 4 | No se encontró la opción. | core, server/actions | OTRO_LITERAL_DE_FRASE, MENSAJE_ERROR |
| 76 | 5 | 3 | El motivo | core | OTRO_LITERAL_DE_FRASE |
| 77 | 5 | 4 | Escribí el motivo de la anulación. | core | OTRO_LITERAL_DE_FRASE, mensaje |
| 78 | 5 | 5 | «{}» no está disponible en «{}». | core, server/actions | RETORNO_DE_FRASE, mensaje, MENSAJE_ERROR |
| 79 | 5 | 3 | No se encontró esa invitación pendiente. | server/actions | mensaje, MENSAJE_ERROR |
| 80 | 5 | 5 | Solo un producto de venta (PV) puede ir en la carta. | server/actions | MENSAJE_ERROR |
| 81 | 5 | 5 | No se encontró la sección. | server/actions, server (otros) | MENSAJE_ERROR, mensaje |
| 82 | 4 | 4 | Todas | app (páginas) | JSX_TEXTO, label |
| 83 | 4 | 4 | Renombrar | app (páginas) | JSX_TEXTO |
| 84 | 4 | 3 | Sucursales | app (páginas), components, core | JSX_TEXTO, aria-label, label |
| 85 | 4 | 4 | Agregar | app (páginas), components | JSX_TEXTO |
| 86 | 4 | 4 | Sección de carta | app (páginas), components | etiqueta |
| 87 | 4 | 2 | Especial (★) | app (páginas), components | etiqueta |
| 88 | 4 | 4 | Deshacer | app (páginas), components | JSX_TEXTO |
| 89 | 4 | 4 | No tenés permiso para ver esta sección. | app (páginas), server (otros), server/actions | JSX_TEXTO, OTRO_LITERAL_DE_FRASE |
| 90 | 4 | 2 | El mínimo | app (páginas), core | etiqueta, OTRO_LITERAL_DE_FRASE |
| 91 | 4 | 2 | Promociones | app (páginas), core | etiqueta, texto, label |
| 92 | 4 | 4 | Qué maestro | app (páginas) | etiqueta |
| 93 | 4 | 4 | Nombre del grupo | app (páginas), components | aria-label, etiqueta |
| 94 | 4 | 4 | Biblioteca de opciones | app (páginas), components, core | JSX_TEXTO, label |
| 95 | 4 | 4 | Consignación | app (páginas), core | etiqueta, JSX_TEXTO, label |
| 96 | 4 | 4 | Precio local | app (páginas), core | JSX_TEXTO, texto |
| 97 | 4 | 4 | El precio de venta | app (páginas), components, core | etiqueta |
| 98 | 4 | 3 | Contacto | app (páginas) | etiqueta, JSX_TEXTO, aria-label, placeholder |
| 99 | 4 | 4 | No se encontró ese producto. | app (páginas), server/actions | JSX_TEXTO, MENSAJE_ERROR |
| 100 | 4 | 3 | &quot; | app (páginas), components | JSX_TEXTO |

## 6. Cómo se generó y qué no cubre

Script de solo lectura (no commiteado): recorre los `.ts`/`.tsx` de `src/` y `plataforma/src/`; con el árbol sintáctico toma (a) texto entre etiquetas JSX y atributos de texto; (b) el primer argumento de `ok`, `error`, `exito`, `okConId` y el segundo de `fracaso`; (c) propiedades `mensaje`, `error`, `motivo`, `titulo`, `descripcion`, `etiqueta`, `rotulo`, `ayuda`, `placeholder`, `label`, `texto`, `aviso`, `leyenda`, `detalle`, `pista`, `tooltip`; (d) `return` de una frase; (e) cualquier otro literal que empiece con mayúscula y tenga dos palabras o más. Se descartan SQL y la propiedad `nombre` (dato, no rótulo). No distingue lo que ve el cliente de lo interno (por ejemplo la descripción que se guarda en la auditoría). No mide `scripts/`, `prisma/` ni `test/`. Se corrió sobre `66e20d1a`; `674c35ca` dio 5.696 filas (±1: el cambio #310 agregó un texto).
