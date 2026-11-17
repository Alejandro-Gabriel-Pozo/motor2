# E-5: «versión» en las tablas que se editan — lista para que el dueño decida (frente 3, datos)

Fecha: 2026-11-17. Estado: **PROPUESTA** (nada de esto se construye hasta que el dueño elija; «Lo que el dueño no pidió no entra»). Origen: el orquestador general pidió, citando al dueño («si antes del despliegue» → se hacen todos antes del despliegue), «armame la lista de tablas editables con la propuesta de cuáles llevan versión y por qué, redactada para el dueño».

## 1. Qué es esto, en una frase

Una columna `version` en una tabla hace que, si **dos personas abren el mismo dato a la vez** (un producto, un proveedor, una sección) y las dos guardan, la segunda reciba «cambió mientras lo editabas» en vez de **pisar sin avisar** lo que cargó la primera. Es el «control de versión» de toda la vida en un ERP: como cuando dos recepcionistas editan la misma reserva.

## 2. Qué hace Pedernal (la referencia)

Pedernal lleva `version integer NOT NULL DEFAULT 1` en **71 tablas** y un disparador (`fijar_version_y_fecha`) que, en cada UPDATE, sube la versión y actualiza la fecha **solo**, aunque el código se olvide (`migraciones/0001_base.sql`). Motor2 hoy tiene `version` en **15 de 137** tablas (las nuevas: Ocultar, Planes, Caja, Carta, Parte…), y la sube **el código** (`version: { increment: 1 }`), salvo `Parte`, que ya usa el disparador como Pedernal.

## 3. Lo que hay que saber antes de elegir (honesto)

1. **La columna sola no protege nada.** Protege cuando la pantalla de edición **manda la versión que vio** y el guardado la compara. Hoy eso existe en pocos lugares (p. ej. el stock mínimo compara el valor visto: `cambiarMinimoSiSigueComoSeVio`). Sumar la columna a una tabla sin tocar su pantalla es una decoración que nadie lee; por eso la propuesta es **por tabla y con su pantalla**, no «todas de golpe».
2. **El disparador sí es de la base** (como Pedernal): sube la versión aunque el código se olvide. Para las 15 tablas que ya la suben desde el código hay que elegir un solo dueño de la subida (disparador) y sacar el `increment` del código, **en la misma etapa**, para no subirla dos veces.
3. **Costo:** una migración aditiva por tabla (columna con DEFAULT 1, CHECK `>= 1`, disparador), reversible, sin reescribir datos. El costo grande es el de las pantallas (frente 6) y los casos de uso, no el de la base.
4. **No toda tabla que se actualiza necesita versión:** las que avanzan por **estados** (una cuenta abierta → cerrada) ya se protegen con el `UPDATE … WHERE estado = …` (si dos la cierran a la vez, gana uno); ahí la versión no suma.

## 4. La lista (PROPUESTA; 68 tablas tienen UPDATE en el código, 11 ya llevan versión)

Cómo leerla: **A** = «sí, llevaría versión» (dato maestro que una persona edita en un formulario y que otra puede estar editando); **B** = «no: avanza por estados, ya se protege con la condición del UPDATE»; **C** = «no por ahora: pertenencia o interruptor de una columna, el último que guarda gana y es lo esperable»; **D** = «ya la tiene».

| Grupo | Tablas | Por qué |
|---|---|---|
| **D — ya tienen versión** (11 con UPDATE) | OcultamientoProducto, ModoDeOrdenDeSeccionCarta, Presentacion, Parte, PromoCarta, GrupoDeOpciones, OpcionDeGrupo, ProductoAdmiteGrupo, ProductoAdmiteOpcion, MedioDePago, CuentaDeCobro | Nacieron con el molde. Pendiente solo: pasar la subida al disparador (punto 2). `RecetaVersion`, `GrupoDePrecio`, `CombinacionDeProducto`, `ValorDeLista` la tienen y hoy no se actualizan. |
| **A1 — maestros del catálogo y compras** | Producto, Insumo, Unidad, Grupo, CategoriaProducto, Proveedor, Cliente, MotivoMerma, DestinoConsumo, RecetaSucursal, SustitutoRecetaIngrediente, MargenObjetivo | Se editan en formularios de «Guardar»; dos personas editando el mismo producto o proveedor es el caso típico de pisada silenciosa (precio, nombre, datos fiscales). |
| **A2 — maestros de sucursal y carta** | Sucursal, Seccion, Rol, SeccionCarta, GeneroCarta, ContenidoCartaProducto, ItemAgrupadoCarta, OpcionItemAgrupadoCarta, PromoCartaSucursal, PromoCartaCupo, DescuentoProductoSucursal, PrecioLocalProducto, PrecioLocalDeOpcion, RendimientoLocalIngrediente, OpcionApagadaEnSucursal, DisponibilidadProducto, CapacidadSucursal, SucursalPublica, TemaCartaSucursal, PortalCartaEmpresa | Lo que el gerente configura por sucursal; los precios locales y el cupo son plata y disponibilidad: pisar uno cambia lo que ve el cliente. **Carta y catálogo tienen otros frentes dueños: se coordina con ellos, no lo toco yo.** |
| **A3 — configuración de stock** | StockMinimoProducto, SeccionHabitualProducto, FrecuenciaConteoProducto | El mínimo ya compara el valor visto; las otras dos son preferencias simples (podrían ir en C). Pregunta chica para el dueño. |
| **B — avanzan por estados** | Operacion, ConteoFisico, TraspasoSucursal, Cuenta, CuentaItem, SesionCaja, JornadaDeSucursal, Invitacion, InvitacionSucursal, FacturaProveedor, FacturaProveedorSucursal, FacturaProveedorPropuesta, PagoDeFacturaProveedor, EntradaDeCupo | Su UPDATE ya exige el estado de partida (dos cierres a la vez: gana uno). Sumar versión duplicaría la protección. |
| **C — pertenencia e interruptores** | UsuarioSucursal, UsuarioEmpresa, PermisoRol, CotizacionDolar | Alta/baja o cambio de una sola columna; el último que guarda gana y no pierde trabajo ajeno. |
| **Consola de plataforma** | Empresa, ModuloEmpresa, VersionDePlan, AdminPlataforma | Las edita solo la plataforma (pocas personas). `Empresa` es de la zona restringida (planes M1 la tocó). Propuesta: no, salvo que el dueño quiera igualar a Pedernal también ahí. |

## 5. Lo que necesito que elija el dueño (una sola pregunta, la clave)

**¿Con qué alcance hacemos E-5?**

1. **Solo A1 (maestros de catálogo y compras)** — la recomendación: es donde dos personas editan lo mismo con más frecuencia y donde un precio o dato fiscal pisado cuesta plata. Las demás quedan como están. Costo: 12 tablas, una migración aditiva cada una + su pantalla.
2. **A1 + A2 + A3 (todos los maestros)** — lo más parecido a Pedernal (71 tablas); mucho más trabajo de pantallas y coordinación con los frentes de carta y catálogo.
3. **Solo pasar las 15 que ya tienen versión al disparador de la base** — lo mínimo: igualar la FORMA de Pedernal en lo que ya existe, sin tablas nuevas con versión.
4. **Ninguna por ahora** — la protección actual (condición del UPDATE, valor visto en el mínimo) alcanza hasta que se note un problema real.

Mi recomendación: **opción 1 más la 3**, en ese orden, una tabla por vez, empezando por Proveedor (una pantalla simple, la de mayor consecuencia fiscal). Lo que falta verificar antes de construir cualquier tabla: **qué pantalla edita cada una y si ya manda algún «visto»** (NO VERIFICADO: lo leo tabla por tabla con el frente dueño).

## 6. «¿Qué pasa si…?» para un cambio de versión (cualquier tabla elegida)

| Caso | Resultado esperado |
|---|---|
| Dos personas guardan a la vez | Una guarda; la otra recibe «cambió mientras lo editabas: ahora es X» y no se pisa nada. |
| Se repite el mismo guardado (doble clic, reintento) | Con la misma versión vista el segundo ve que ya cambió y no vuelve a escribir; con el mismo contenido no cambia nada. |
| Una pantalla vieja (abierta antes del cambio) guarda | Falla cerrado: sin la versión vista no se guarda. Mensaje claro, sin pérdida. |
| La migración se aplica con la app corriendo | Aditiva: la columna nace en 1 y el código anterior no la conoce; sigue andando. |
| Se baja la migración | `down.sql` saca columna y disparador; no se pierden datos del negocio. |
| El código y el disparador suben la versión | Un solo dueño: el disparador; el código deja de incrementar (misma etapa, probado). |
