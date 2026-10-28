# ADR-037: El espacio del producto

> Redactado el 2026-10-22 (rama `alegp/stoic-davinci-185dm4`, Fase 6 «Interfaz del producto», bloques 2 y 3; DEC-12). **Estado: implementado en el código. Sin migraciones y sin claves de permiso nuevas.** Las decisiones de producto las tomó el dueño (2026-10-20); las técnicas y reversibles las tomó el ingeniero con el margen que el dueño otorgó el 2026-10-21, y van listadas abajo, aparte, para que el dueño las ratifique o las corrija antes del pull request. ADR-036 queda reservado (contratos).

## Contexto

Armar un producto de venta estaba repartido en seis lugares: la lista de Productos, su ficha, «Editar», «Opciones de venta» del producto, la biblioteca «Opciones de venta» de la empresa y la carta. Para dejar vendible una base configurable con un grupo de precio final y uno incluido había que crear los grupos en la biblioteca, crear el producto, volver a editarlo para admitir los grupos y otra vez para pasarlo a «Por opción»: 7 pantallas, 28 clics y 6 salidas (medición «antes» de `docs/medicion-espacio-del-producto-2026-10-21.md`). Publicar en la carta obligaba a irse al módulo Carta, abrir «Visibilidad», «Fuera de carta» y buscar el producto.

El umbral del dueño (DEC-12): **no peor que hoy** en pantallas y clics en las cuatro tareas medidas, y **0 salidas del espacio** en las de opciones y de publicar.

## Decisión

1. **Un solo espacio para todos los tipos de producto** (ADDENDUM del 2026-10-21, decisión del ingeniero a pedido del dueño: «fijate qué es mejor»). La materia prima no conserva una ficha aparte: `ProductoForm` ya servía a los dos tipos con el mismo formulario, así que el marco es neutro al tipo y lo que cambia son los pasos. El núcleo puro es `src/core/catalogo/espacio-del-producto.ts` (`PASOS_DEL_ESPACIO`, `rutaDelPaso`, `pendientesDelProducto`, `pasosDelEspacio`; prueba `test/core/espacio-del-producto.test.ts`):

   | Producto | Pasos |
   |---|---|
   | De venta (PV) | Qué se vende · Opciones y precio · Receta · En la carta |
   | Materia prima que se produce | Datos · Receta |
   | Materia prima que no se produce | Datos |
   | Producto de respaldo de un adicional | Sin marco de venta (se edita como antes, con su vuelta a la ficha) |

   Un paso que no corresponde al tipo **no aparece** (no es «sin permiso»).

2. **El paso 1 vive siempre en `/catalogo/productos/[id]/datos`** (`src/app/(app)/catalogo/productos/[id]/datos/page.tsx`; el título es «Qué se vende» en un PV y «Datos» en una MP). La ruta vieja `/catalogo/productos/[id]/editar` (`src/app/(app)/catalogo/productos/[id]/editar/page.tsx`) pasa las MISMAS guardas de siempre (Ver de `producto_ver_catalogo` y Editar de `producto_editar`) y recién después redirige con `redirect()` a `/datos` (307), **siempre**, sin leer el producto ni mirar el tipo. Quien no puede editar recibe en `/editar` el mismo «No tenés permiso» de antes, sin que se le revele nada. La redirección va en la página y no en `next.config.ts` porque las de la configuración corren antes del proxy y antes de la guarda. La prueba HTTP está en `test/e2e/catalogo-ficha-producto.spec.ts` (307 con `Location` a `/datos` en un PV y en una MP, y el contraespejo: `/datos` da 200, sin un segundo salto).

3. **El marco es un componente de servidor, no un `layout.tsx`**: `MarcoDelEspacio` (`src/components/catalogo/espacio-del-producto/marco.tsx`) lo usa cada página del espacio, y cada página conserva su propia guarda, que es la barrera. El marco dibuja el `h1` con el nombre, el código y el tipo, la insignia «Directo» o «Por opción», la disponibilidad en la sucursal activa y la tira de pasos (`PestanasDeRuta`, `src/ui/componentes/navegacion/pestanas-de-ruta.tsx`). **La portada** (`src/app/(app)/catalogo/productos/[id]/page.tsx`, «Resumen») va dentro del marco para todos los tipos, salvo el producto de respaldo.

4. **Quién abre cada paso lo calcula el servidor** (`cargarMarcoDelEspacio`, `src/components/catalogo/espacio-del-producto/datos-del-marco.ts`) con el permiso de la pantalla de ese paso:
   - datos: Editar de `producto_editar`;
   - opciones y precio: Editar de `producto_opciones_admitidas`;
   - receta: Ver de `guardar_receta`;
   - en la carta: Ver de `carta_ver`, de la sucursal activa.

   Sin permiso, el paso se dibuja como texto, sin enlace y **sin dato**: `pasosDelEspacio` fuerza `sin-dato` aunque el pendiente se haya calculado, y `hechosDelProducto` ni lee lo que el usuario no puede ver (`test/catalogo/espacio-hechos.test.ts`, `test/catalogo/marco-del-espacio.test.tsx`). Si el módulo está apagado, el paso no aparece. Es cortesía de la interfaz: cada pantalla vuelve a exigir su permiso.

5. **Rutas hijas con acción propia, por patrón** (`RUTAS_HIJAS_CON_ACCION_PROPIA` en `src/core/navegacion/estructura.ts`). `accionDeRuta` no entendía segmentos dinámicos: `/catalogo/productos/x/en-la-carta` resolvía `producto_ver_catalogo` y `EnlaceInterno` habría mentido. El patrón declara que `/en-la-carta` exige `carta_ver`. El menú (`GRUPOS_NAV`) no cambia. El paso 4 no pide `producto_ver_catalogo`: quien administra la carta sin ver el catálogo entra igual, y el marco le oculta la ficha (código, tipo, Directo o Por opción, «Resumen» y «← Productos») con `fichaVisible`. La pantalla de la receta hace lo mismo.

6. **Paso 2, «Opciones y precio»** (`src/app/(app)/catalogo/productos/[id]/opciones/page.tsx`; Ver de `producto_ver_catalogo` y Editar de `producto_opciones_admitidas`). Tiene:
   - «Agregar un grupo existente» en una ventana (`src/components/catalogo/agregar-grupo-existente.tsx`);
   - «+ Nuevo grupo» (`src/components/catalogo/nuevo-grupo-en-el-producto.tsx`) y, en la tarjeta de cada grupo, «+ Opción» / «+ Extra» (`src/components/catalogo/nueva-opcion-en-el-grupo.tsx`). Los dos se dibujan solo con Editar de `opciones_definir`, calculado en el servidor;
   - la lectura del precio debajo de cada importe;
   - el precio de la sucursal activa (punto 9);
   - la vista previa de la carta (punto 8).

7. **Dos comandos compuestos, todo o nada.** El detalle de diseño está en ADR-030, sección «El comando compuesto».
   - **`crearGrupoEnElProducto`** (`src/server/actions/catalogo/opciones-de-venta.ts`; caso de uso `src/server/actions/catalogo/casos-de-uso/crear-grupo-en-el-producto.ts`) crea el grupo de la biblioteca, sus opciones y lo que el producto admite de ellas en UNA transacción SERIALIZABLE (`conTransaccionSerializable` con `tambienChoqueDeUnico`). Toma la fila del producto primero (`tomarFilaDeProducto`, `FOR UPDATE`) y reusa los cuerpos `crearGrupoDeOpcionesEnTx`, `crearOpcionDeGrupoEnTx` y `fijarAdmisionDeGrupoEnTx`.
     - **Reversión por excepción.** Devolver un `fracaso` desde adentro de la transacción confirmaría lo ya escrito. Por eso todo rechazo se lanza como `PasoRechazado` y se devuelve recién afuera, con la transacción deshecha.
     - **Idempotencia por estado, sin migración.** El nombre único del grupo (sin distinguir mayúsculas) y el de cada opción arbitran. Un grupo idéntico de la biblioteca se adopta; uno distinto da `NOMBRE_REPETIDO` y nunca se modifica.
     - **Dos claves, las mismas que pedían las dos pantallas de antes.** `producto_opciones_admitidas` la pide el envoltorio, y `opciones_definir` va como primera línea de adentro, con `exigirTambienPermisoDeEmpresa` (`src/server/actions/con-permiso.ts`). La ficha lo declara (`permiso=opciones_definir+producto_opciones_admitidas`) y `test/arquitectura/ficha-de-caso-de-uso.test.ts` lo lee del código.
     - Pruebas: `opciones-grupo-en-el-producto.test.ts`, `opciones-grupo-en-el-producto-concurrencia.test.ts`, `opciones-grupo-en-el-producto-auditoria-atomica.test.ts`, `test/permisos/grupo-en-el-producto-dos-claves.test.ts` y `test/aislamiento/grupo-en-el-producto-otra-empresa.test.ts`.
   - **`crearOpcionEnElProducto`**, su gemelo («+ Opción» / «+ Extra»; caso de uso `src/server/actions/catalogo/casos-de-uso/crear-opcion-en-el-producto.ts`), agrega una opción a un grupo que el producto ya usa: la opción (con su producto de respaldo si es un extra) y lo que ESTE producto admite de ella.
     - Usa las mismas dos claves: **sin clave nueva ni migración**. Es todo o nada, con la misma reversión por `PasoRechazado`.
     - Qué lleva la opción lo decide el tipo del grupo, leído dentro de la transacción y no enviado por el cliente.
     - Da `NOMBRE_REPETIDO` si ya hay en el grupo una opción distinta con ese nombre, o si el producto ya la admite con otro importe.
     - Respeta la versión que vio la pantalla (`versionEsperada` de la fila del grupo, que valida `fijarAdmisionDeGrupoEnTx`).
     - No cambia lo que admiten los otros productos del grupo.
     - Pruebas: `opciones-opcion-en-el-producto.test.ts`, `test/permisos/opcion-en-el-producto-dos-claves.test.ts`, `test/aislamiento/opcion-en-el-producto-otra-empresa.test.ts` y `test/e2e/catalogo-opcion-en-el-producto.spec.ts`.

8. **La lectura del precio y la vista previa no tienen cuentas propias.**
   - `src/core/opciones/lectura-de-precio.ts` (`formaDelGrupoPorRespuesta`, `leerPrecioDeOpcion`, `fraseDeLecturaDePrecio`) y `src/core/opciones/lectura-de-precio-en-admision.ts` (`referenciaDePrecioDeAdmisiones`, `leerPrecioDeFilaDeAdmision`) componen el total solo con `componerPrecioDeLinea`, el compositor de la venta (`test/core/lectura-de-precio.propiedades.test.ts`). Un grupo que suma se lee contra la opción más barata **guardada** del grupo que fija el precio.
   - La vista previa «Cómo se va a ver en la carta» (pasos 2 y 4) se calcula en el servidor (`cargarVistaPreviaDeLaCarta`, `src/server/consultas/carta/vista-previa-de-un-producto.ts`). Usa las mismas lecturas y la misma proyección de la Fase 5 que la carta pública y que el «Va a mostrar» de «Agregar a la carta»: `tablaDePreciosParaLaCarta` y `presentacionDeUnProductoSolo`, con el precio de lista de la sucursal y sin descuento.
   - El componente (`src/components/catalogo/espacio-del-producto/vista-previa-de-la-carta.tsx`) solo dibuja lo que recibe. La regla de dependency-cruiser `vista-previa-sin-calculo-de-precio` le prohíbe importar `core/pos`, `core/moneda`, el servidor y `lib`, así que no tiene con qué componer, redondear ni descontar.
   - El «nombre arriba» se lee solo si quien mira puede abrir el paso «En la carta».

9. **Precio por sucursal en el paso 2, con el comando que ya existía** (decisión del dueño del 2026-10-20: «precio por sucursal en el producto», solo el de la sucursal activa). Lo dibuja `PrecioDeLaSucursal` (`src/components/catalogo/espacio-del-producto/precio-de-la-sucursal.tsx`) con `setPrecioLocalProducto`:
   - clave `precio_local`; el campo se dibuja solo con Editar en la sucursal activa y en un producto que se cobra a su precio propio;
   - el valor visto como control de concurrencia (`PRECIO_DESACTUALIZADO`);
   - siempre «antes → después»; si el cambio supera el 30 %, una confirmación aparte. El 30 % exacto no confirma: `cambioDePrecio` compara en centavos con `UMBRAL_DE_CAMBIO_DE_PRECIO` (`src/core/catalogo/cambio-de-precio.ts`, `test/catalogo/cambio-de-precio.test.ts`).

   **No hay lógica de dinero nueva**: es otra pantalla para el mismo comando (`test/e2e/catalogo-precio-por-sucursal-en-el-producto.spec.ts`).

10. **Paso 4, «En la carta»** (`src/app/(app)/catalogo/productos/[id]/en-la-carta/page.tsx`). Muestra la ficha de carta de siempre (`ContenidoDelProducto`, `src/components/carta/contenido-del-producto.tsx`, la misma de Parametrización › Secciones, con las mismas acciones y los mismos permisos), rotulada «En la carta de «{sucursal}»» (decisión del dueño). Lee UN producto con `cargarAdminCarta` y `soloProductoId` (`test/carta/admin-un-producto.test.ts`). Todo lo que se escribe usa `ctx.sucursalId`, nunca un parámetro de la ruta.

11. **Paso 3, Receta: envuelve la pantalla existente.** `rutaDelPaso(id, "receta")` sigue siendo `/catalogo/recetas/[id]`, y esa página (`src/app/(app)/catalogo/recetas/[productoId]/page.tsx`) se dibuja dentro del marco, con «Receta» como pestaña actual, para un PV y para una MP que se produce. **La migración completa de esa pantalla queda pendiente** (ver abajo).

12. **Biblioteca.** En `/catalogo/opciones/[grupoId]`, «Productos que lo usan» lleva al paso 2 si quien mira puede editar `producto_opciones_admitidas`, y a la portada si no puede. El permiso se calcula en el servidor y es cortesía: no cambia ninguna guarda.

13. **Filtros de la lista de Productos, del lado del servidor.** La parte pura (`src/core/catalogo/filtros-de-productos.ts`, `leerFiltrosDeProductos`) valida cada valor contra su lista cerrada (`TIPOS_FILTRABLES`, `MODOS_FILTRABLES`, `DISPONIBILIDADES_FILTRABLES`, `FALTAS_FILTRABLES`) e **ignora lo demás**: la lista sale sin ese filtro, nunca con un error. El `where` lo arma `src/server/lecturas/catalogo/filtros-de-productos.ts`, dentro de la empresa y la sucursal activa. Los filtros:
    - el tipo en palabras: de venta, materia prima, se produce, respaldo;
    - el modo: directo o por opción;
    - la disponibilidad por sucursal: acá, no acá, en alguna, en ninguna. **El producto no tiene un campo «activo»**: lo que se enciende y se apaga es la disponibilidad, y «en ninguna» es el «inactivo» de la empresa;
    - «le falta algo»: sin precio, sin receta, fuera de la carta. Repite como filtro el mismo cálculo de los pendientes del espacio (`test/catalogo/filtros-de-productos.test.ts` los cruza producto por producto). «Sin receta» y «fuera de la carta» solo se ofrecen y se aplican a quien tiene ese permiso (`guardar_receta` o `carta_ver`) con el módulo prendido (`faltasQueSePuedenFiltrar`): un filtro por algo que no se ve revelaría justo eso.

    Pruebas: `test/core/filtros-de-productos.test.ts` y `test/e2e/catalogo-productos-filtros.spec.ts`.

14. **La tira de pasos a 375 px.** Cuatro pasos y el «Resumen» no entran: la tira se desplaza hacia el costado y, al montarse, deja a la vista la pestaña actual, sin mover la página. Cada pestaña mide al menos 44 px de alto (`test/ui/pestanas-de-ruta.test.tsx`; en navegador, `test/e2e/espacio-del-producto.spec.ts`).

## Medición DEC-12 (antes → después)

De `docs/medicion-espacio-del-producto-2026-10-21.md` §5 y §6, medida con `test/e2e/medicion-tareas-del-producto.spec.ts`, que **afirma el umbral**. «Antes»: 2026-10-21, commit c17c3c52. «Después»: 2026-10-22, rama `alegp/carril-b`, último commit de código `6666dd43`, build de producción a 1280 px.

| Tarea | Pantallas | Clics | Campos | Salidas del espacio |
|---|---|---|---|---|
| a) Producto directo vendible | 3 → 3 | 3 → 3 | 4 → 4 | no aplica |
| b) Base configurable (3 opciones + 1 incluida) | 7 → 5 | **28 → 13** | 22 → 16 | **6 → 0** |
| c) Cambiar el precio final de una opción | 2 → 2 | 2 → 2 | 1 → 1 | 1 → 0 |
| d) Publicar en la carta | 2 → 2 | **6 → 2** | 1 → 1 | 1 → 0 |

Ninguna tarea empeora, y b, c y d quedan en 0 salidas. Dos aclaraciones para leer bien la tabla:
- **La definición de «salidas» cambió.** En el «antes» eran las pantallas distintas menos 1. En el «después» son las visitas a una pantalla que no es del espacio (`salidasDelEspacio`). Con la definición vieja, c y d seguirían dando 1, porque el paso es otra pantalla, aunque del espacio. El JSON conserva las dos.
- **La medición no se repitió** después de los commits posteriores a `6666dd43`: los filtros, «+ Opción» / «+ Extra», el precio por sucursal y la vista previa. Ninguno agrega pasos a las cuatro tareas, pero el número exacto queda **a confirmar** en la corrida del gate final.

Las dos mutaciones del umbral se corrieron y dieron rojo: en (c), ir por la biblioteca, y un clic de más.

## Alternativas descartadas

| Alternativa | Por qué se descarta |
|---|---|
| Dos tiempos para crear un grupo (biblioteca y después «Agregar a este producto») | Deja grupos sueltos si el segundo paso falla y obliga a salir del espacio. El dueño eligió un comando, todo o nada |
| Redirección de `/editar` en `next.config.ts` | No conoce el tipo de producto y corre antes del proxy y de la guarda |
| La materia prima con ficha aparte (`/editar` como editor propio) | Dos editores del mismo formulario y una redirección que depende del tipo. Se reemplazó por un solo espacio (ADDENDUM del 2026-10-21) |
| El marco como `layout.tsx` | Un layout no conserva la guarda de cada página (`paginas-con-guarda`) |
| Vista previa con pestañas Carta / POS | El lado POS ya es el «Así se cobra» que el paso 2 tiene. Dos pestañas repetirían lo mismo |
| Vista previa en un panel lateral | El marco mide `max-w-3xl`: una columna lateral no entra. Va como una sección al pie, de solo lectura |
| Idempotencia «I3» con clave de reintento | Necesita una migración (clave, hash y mensaje en `GrupoDeOpciones` o una tabla de pedidos), y el dueño decidió que la clave obligatoria sea solo la del pago a consignante. El nombre único arbitra igual, con concurrencia probada |

## Decisiones que tomó el ingeniero (técnicas y reversibles)

- Un solo espacio para todos los tipos y `/datos` como única URL del paso 1, con `/editar` redirigiendo siempre (ADDENDUM). Esto **reemplaza** la decisión del dueño del 2026-10-20 que daba a la materia prima una ficha propia y nombraba el paso «que-se-vende»: se le consultó con «fijate qué es mejor». **A ratificar** por el dueño.
- La redirección va en la página, después de la guarda.
- El marco es un componente de servidor, sin layout.
- Los enlaces de los pasos se calculan en el servidor.
- Rutas hijas con acción propia, por patrón.
- Reversión por excepción (`PasoRechazado`) e idempotencia por estado, sin migración. Desde la ventana nunca se modifica un grupo de la biblioteca: uno idéntico se adopta y uno distinto se rechaza.
- La lectura del precio va contra la opción más barata **guardada** del grupo que fija el precio, con `formatearMonto`, el mismo formato de «Así se cobra».
- «Pasar a Por opción» sigue en el paso 1, con `producto_campos_sensibles` (decisión de la Fase 4), y el paso 2 lo marca como pendiente.
- Secciones conserva su formulario. El paso 4 es otra puerta a la misma ficha de carta.
- La vista previa va sin pestañas y sin panel lateral (ver la tabla de alternativas).
- «+ Opción» / «+ Extra» usan las mismas dos claves que «+ Nuevo grupo», sin clave nueva. El plan lo dejó como pregunta (P-3) y se implementó con el criterio que el dueño ya había aprobado para el alta del grupo. **A confirmar** que el dueño lo ratificó.
- Los goldens de la línea de base se regeneraron solo en las secciones de ADMINISTRACIÓN, con la carta pública idéntica.

## Pendientes

- **Receta como paso propio** (6.16):
  - ruta `/catalogo/productos/[id]/receta` con pestañas e historial en ventana (decisión del dueño);
  - la redirección de `/catalogo/recetas/[id]` para un producto de venta, con la consulta filtrada por una lista cerrada;
  - esconder los formularios a quien solo tiene «Ver» de `guardar_receta`;
  - la migración de la pantalla a primitivas.

  Hoy el paso envuelve la pantalla de siempre.
- **Consumos de una opción editables desde el producto**, en una ventana y con el aviso de cuántos productos más usan el grupo (decisión del dueño del 2026-10-20). Todavía no existe; también falta «Editar grupo» con el prefijo desde el producto.
- **Crear un grupo ADICIONAL («se cobra aparte») desde «+ Nuevo grupo».** Hoy la ventana ofrece incluido, suma o precio final. «+ Extra» solo agrega opciones a un grupo adicional que el producto ya usa.
- **Biblioteca adelgazada** (6.11, resto): mover `opciones/[grupoId]/*` a componentes y migrarlo a primitivas.
- `LecturaDeCantidad` y `LecturaDelFactor` sobre `LecturaEnVivo`.
- El alta del producto en tarjetas.
- La confirmación del 30 % existe solo en el precio de la sucursal del paso 2. El precio global (paso 1), el precio final de cada opción y la lista de Precio local todavía no la piden: **a decidir** si se extiende.
- La medición DEC-12 sobre el último commit, en el gate final (ver arriba).

## Notas de la fase

- **Tope de reintentos de SERIALIZABLE.** `conTransaccionSerializable` (`src/lib/transaccion-serializable.ts`) reintenta hasta 8 veces por defecto. Hasta el 2026-10-22, seis casos de uso le pasaban 5 por posición para llegar a `tambienChoqueDeUnico` (de cuando 5 era el default), y la regresión C2 (dos ventas simultáneas) volvió a agotar los reintentos. Desde entonces ninguna llamada fija su propio tope: para llegar a los argumentos de después se pasa `undefined`, como hacen los dos comandos compuestos de este ADR. Lo vigila `test/arquitectura/transaccion-serializable-sin-tope-propio.test.ts`; un tope propio legítimo iría en su lista de excepciones, con motivo.

## Consecuencias

- Las tareas de opciones y de publicar ya no salen del producto. Crear una base configurable baja de 28 a 13 clics.
- **Sin migraciones, sin claves nuevas y sin lógica de dinero nueva.** Los comandos compuestos reusan los cuerpos y las reglas que ya existían. El precio por sucursal usa el comando de siempre. La vista previa y la lectura del precio usan el compositor de la venta.
- Quien solo ve recibe la portada: los pasos de editar aparecen sin enlace y sin dato, y por URL directa cada pantalla responde «No tenés permiso».
- Los enlaces, los favoritos y las pestañas viejas a `/editar` siguen funcionando con la redirección. Un formulario enviado desde una pestaña vieja falla como después de cualquier despliegue (Next rota los ids de las acciones de página) y «Reintentar» lleva al paso nuevo.

## Actualización (2026-10-28)

- Por decisión del dueño (poda de las rutas de transición, Fase 7), se borró la ruta vieja `/catalogo/productos/[id]/editar` y su redirección: el paso 1 tiene una sola entrada, `/catalogo/productos/[id]/datos`. Lo dicho arriba sobre `/editar` queda como historia. La prueba de ausencia está en `test/arquitectura/rutas-retiradas.test.ts`.
