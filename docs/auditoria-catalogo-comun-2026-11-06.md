# Auditoría cruzada del catálogo común (2026-11-06)

**Estado:** auditoría de SOLO LECTURA sobre main `50c11538`. No se cambió código, tests, esquema ni migraciones (orden del dueño, 2026-11-06). Todo lo que se propone es PROPUESTA; lo decide el dueño.

**Insumos:**
- Los 9 inventarios por módulo, en `docs/catalogo-por-modulo/` (índice en `INDEX.md`), copiados sin reescribir desde sus ramas `alegp/catalogo-<modulo>`.
- Los 3 informes transversales que mandó la sesión coordinadora: fuentes de verdad, escrituras de más y reglas repetidas entre pantalla y servidor. Se citan como T1, T2 y T3 con su número de punto (T1-16 es el punto 16 del informe de fuentes de verdad).
- El diseño de partida `docs/diseno-flujos-y-pasos-2026-11-06.md` (PR #165).

**Cómo leer las marcas:**
- **VERIFICADO**: el auditor lo leyó en el código real.
- **NO VERIFICADO**: lo dice un informe y no se comprobó.
- **REFUTADO**: el código dice otra cosa.

**Sección 10 de compras:** la sesión de compras no la publicó. La escribió esta sesión auditora el 2026-11-07, con autorización del dueño transmitida por la sesión coordinadora, a partir de las secciones 1 a 9 de ese módulo y de mediciones propias (`docs/catalogo-por-modulo/compras-proveedores-pagos.md` §10).

---

## 0. Resumen para el dueño: los 5 hallazgos más graves

1. **«Sin stock hoy» y «este producto se usa en la sucursal» son la misma marca** (`DisponibilidadProducto.disponible`). La pantalla «Hoy» de la carta la apaga, y con eso el producto también sale del inventario valorizado. Ejemplo: un plato que se produce, tiene saldo y se marca «sin stock hoy» desaparece del valor del inventario. VERIFICADO: la escritura está en `src/server/actions/catalogo/casos-de-uso/fijar-disponibilidad-de-hoy.ts:40` y el filtro en `src/server/consultas/reportes/valuacion.ts:22-33` (`whereDisponibleEn`).
2. **Las anulaciones se reconocen por tres señales distintas y ningún control las cubre del todo.**
   - El test que obliga a excluir las anuladas mira solo `src/core/reportes`, pero los filtros reales viven en `src/server/consultas/reportes`. VERIFICADO: `test/arquitectura/reportes-compras-anuladas.test.ts`, `RAIZ`.
   - El enlace en la base «esta reversión anula a aquella» (`Operacion.revierteAOperacionId`, que no admite repetidos) no lo escribe el contra-asiento de venta ni el de compra, aunque un comentario dice que sí. VERIFICADO: `src/server/persistencia/movimientos/escribir-contra-asiento.ts:41-55` contra el comentario de `src/server/actions/movimientos/casos-de-uso/anular-factura-proveedor.ts:39`.
   - El texto reservado «Anulación de la venta/compra…» solo se rechaza en 2 de 6 validaciones. Los traspasos, por ejemplo, lo aceptan. VERIFICADO: `esDetalleReservadoParaReversiones` aparece solo en `movimiento.guard.ts:48` y `factura-proveedor.guard.ts`.
3. **La regla de precio está escrita a mano en muchos lugares, y en un caso el error sale a $0 sin avisar.**
   - «Precio de la sucursal o, si no hay, el de lista» está copiado en 5 lugares. VERIFICADO.
   - La conversión de la diferencia de precio de una opción está en 8 lugares (T3-2, NO VERIFICADO).
   - Si no se encuentra el precio de lista de un plato dentro de una promo, pesa $0 en el reparto del precio de la promo. VERIFICADO: `src/server/actions/pos/casos-de-uso/agregar-items.ts:239`, `?? 0`.
   - Una venta real a $0 se informa a precio de hoy. VERIFICADO: `src/core/reportes/periodo-ventas.ts:33`.
4. **Hay columnas de dinero y fiscales que nadie escribe, y el guardián las declara como «dinero».**
   - `Producto.alicuotaIvaVenta` (solo tiene lectores) y `alicuotaIvaCompra`.
   - `FacturaProveedor.importeNeto/importeIva/condicionIvaEmpresa/fechaComprobante/fechaPagoDeclarada/medioPagoDeclarado`.
   - Las 4 tablas de notas de crédito.
   - La cabecera `Venta`.
   - VERIFICADO por muestreo: 0 usos de `importeNeto` y `fechaPagoDeclarada`, y ningún `venta.create` en `src/`.
   - Consecuencia: el paso «tiene precio y alícuota» del producto vendible nunca puede quedar completo, y el estado `PENDIENTE_DE_REPARTO` del diseño de partida no existe en el código (§h).
5. **Casi toda la deuda está sin vencimiento.** Hay 170 entradas en 15 listas de los cercos (las 82 columnas sin declarar son una de ellas) y ninguna trae fecha. Sus metas («Fase 6», «lote 6.33», «Fase 2») ya pasaron. Solo los contratos aplican la regla G1b; hay dos mecanismos de excepción, uno con fecha y otro sin ella. VERIFICADO: conteo propio de los 15 JSON de `test/arquitectura/cercos/linea-de-base/`.

---

## a. Código duplicado entre módulos

| # | Qué | Copias | Dónde | Módulos | Marca |
|---|---|---|---|---|---|
| a1 | Precio de la sucursal o, si no hay, el de lista | 5 | `core/carta/armar-menu.ts:295` (`precioDeCarta`), `consultas/carta/vista-previa-de-un-producto.ts:30`, `consultas/catalogo/opciones-de-venta.ts:143,:299`, `core/reportes/comun.ts:103` | catálogo, carta, reportes | VERIFICADO |
| a2 | Merma: `cantidad×(1+merma/100)` | 8 a 11 | `core/reportes/costos.ts:61,158,310`, `linea-de-venta.ts:95`, `armar-linea-de-movimiento.ts:68`, `rendimiento-recetas-vistas.ts:50` (con decimales que se redondean), `consumo-de-linea-configurada.ts:133,147` (decimal exacto) | recetas, ventas, reportes | VERIFICADO (11 líneas con el patrón) |
| a3 | `redondearCantidad` | 6 (4 con 3 decimales, 2 con 4) | `pos/cuenta.ts:27`, `pos/comanda.ts:17` y otras | recetas, reportes, POS | NO VERIFICADO, coincide en dos informes |
| a4 | Reparto por mayor resto | 2 | `core/moneda.ts:117` `repartirImporte`, `core/compras/reparto-de-factura.ts:28` `repartirEnteros` | compras, primitivas | VERIFICADO |
| a5 | «A centavos» | 4 | `moneda.ts:33` (privada), `reparto-de-factura.ts:23`, `datos/importe.ts:67` `centavosDeImporte`, `Math.round(n*100)` local en verificarSumas | compras, primitivas | VERIFICADO (3 de 4) |
| a6 | Nombre visible `nombreEnCarta ?? nombre` sin pasar por `nombreDeCarta` | ≥5 | `selector-carta.tsx:100,138`, `actualizar-visible-en-carta.ts:48`, `core/pos/ticket.ts:181,312`, `tickets-emitidos.ts:99` | carta, salón, reportes | NO VERIFICADO línea por línea; `nombreDeCarta` es única por nombre (VERIFICADO, `armar-menu.ts:289`) |
| a7 | `tieneSucursalActiva`: mismo nombre, criterio distinto | 2 | `server/sesion/acceso.ts:89`, `server/lecturas/permisos/gobierno.ts:28` | acceso | VERIFICADO que hay 2. El informe del módulo dice que el riesgo de entrar sin permiso está descartado, porque `contexto.ts` vuelve a exigir el permiso (NO VERIFICADO por el auditor) |
| a8 | Email normalizado a mano (`trim().toLowerCase()`) aunque existe `normalizarEmail` | 9 | `core/plataforma/email-reservado.ts:5` y 9 lugares | acceso | NO VERIFICADO |
| a9 | Normalizador de texto con NFD, con 2 expresiones regulares distintas | 6 | reportes-fiscal §3 | transversal | NO VERIFICADO |
| a10 | Clave de un plato dentro de una promo, en 3 formatos | 4 | `core/pos/promo-combo.ts:122-124,:290`, `lecturas/pos/entradas-de-promo-para-vender.ts:114,:134` | POS, carta | NO VERIFICADO (T3-1). El `?? 0` que la vuelve peligrosa está VERIFICADO |
| a11 | «Opción ofrecida» (`activa && admitida`) y «grupo vigente» | ~8 y ~20 | T3-13, T3-14; `gruposVigentes` es privada en `core/pos/precio-de-configuracion.ts:37` | opciones, POS, carta | NO VERIFICADO |
| a12 | Componentes de pantalla gemelos | Modal y Dialogo; 3 de activar/desactivar; el alta «nombre + Crear» copiada a mano ≥15 veces | ui-y-pruebas §3 | UI | NO VERIFICADO |
| a13 | Casos de uso `actualizar-activo/a-*` | 20 iguales; 19 no comparan antes de escribir; solo 6 auditan | T2-15, T2-17 | todos | NO VERIFICADO |
| a14 | Fábricas de prueba | `sembrar` ×35, `hacerGerente` ×7, `crearEmpresa` ×5 más la compartida | ui-y-pruebas §5 | pruebas | NO VERIFICADO |
| a15 | Saldo de stock calculado con `groupBy`/`aggregate` | 19 archivos con criterios de disponibilidad distintos | stock §3 y §4; `valuacion.ts:32` filtra (VERIFICADO) | stock, reportes | parcial |
| a16 | Margen | ≥5 definiciones | `costos.ts:202`, `periodo-margen.ts:135`, `margen-real.ts:65`, `margen-promociones.ts:103`, IPC `periodo-margen.ts:117` | recetas, reportes | NO VERIFICADO |
| a17 | Literales de modo de venta y tipo (`"BASE_CONFIGURABLE"`, `"MP" \| "PV"`) en vez de `esBaseConfigurable`, `TipoProducto` y `ModoDeVenta` | ~25 y ~12 | T3-16, T3-20 | catálogo, carta, POS | NO VERIFICADO |
| a18 | Tipos con el mismo nombre y contenido distinto (trampa al importar) | 5 | `ResultadoAbrirCuentaDeMostrador`, `PosicionPortal`, `OfertaDeProveedor`, `PropuestaParaAceptar`, `ReferenciaDePrecio` (T3-20) | varios | NO VERIFICADO |

## b. Múltiples fuentes de verdad (quién manda)

| # | Hecho | Lugares | Quién manda | Intención | Marca |
|---|---|---|---|---|---|
| b1 | Si el producto se usa o se vende hoy en la sucursal | `DisponibilidadProducto.disponible` (un solo booleano, 3 estados: sin fila, `false`, `true`) | nadie: dos hechos en una columna | accidental | VERIFICADO (ver §0.1) |
| b2 | Precio de un producto | `Producto.precioVenta`, `PrecioLocalProducto`, `DescuentoProductoSucursal` y la grilla de opción en base configurable | la lectura de precio, con 5 copias (a1) | intencional el modelo, accidental la copia | VERIFICADO a1 |
| b3 | Precio de una opción | `VersionDeOpcion`, `ProductoAdmiteOpcion`, `PrecioLocalDeOpcion`; `ProductoAdmiteGrupo.modoPrecio` dice cuál vale | la aplicación (`validar-configuracion.ts:293-345`); la base no cruza tablas | intencional, con huecos | NO VERIFICADO |
| b4 | Total de la venta | Kardex (`MovimientoStock.precioTotal`), `Operacion`, `Venta.importeTotal` (sin escritor) | Kardex | `Venta` colgada | VERIFICADO (ningún `venta.create`) |
| b5 | Que una operación está anulada | `Operacion.anuladaEn`, texto «Anulación de la…» en `detalleLibre`, las líneas inversas y (solo en factura) `revierteAOperacionId` | el texto del detalle, para reportes y posteriores | accidental (transición) | VERIFICADO |
| b6 | Que el comprobante de proveedor ya existe | `FacturaProveedor.nroFacturaNormalizado`, `Operacion.nroFactura` (texto crudo) y 3 normalizadores | `hayComprobanteVigenteEnLaEmpresa`, que normaliza al vuelo con candado | accidental | NO VERIFICADO |
| b7 | Cuándo y cómo se pagó una factura | `FacturaProveedor.fechaPagoDeclarada/medioPagoDeclarado` (sin uso) y `PagoDeFacturaProveedor` | el pago | accidental (columnas viejas) | VERIFICADO: 0 usos |
| b8 | Fecha del movimiento de stock | `Operacion.fecha`, `MovimientoStock.creadoEn`, `ConteoFisico.fecha` | ninguna regla: el historial usa `fecha`; alertas y consolidado usan `creadoEn` | accidental | NO VERIFICADO |
| b9 | Zona horaria del día | `Empresa.zonaHoraria` y `ZONA_ARGENTINA` por defecto en 43 archivos | quien llama; si se olvida, el día se corta en Buenos Aires sin error | accidental | NO VERIFICADO |
| b10 | Si alguien puede hacer algo | `PermisoRol`, piso por acción, `CapacidadSucursal`, `ModuloEmpresa`, `Empresa.permisosEditables/dosPaneles`, `UsuarioEmpresa.rolEmpresa` | `decision-de-acceso.ts`; «ver incluye editar» solo lo cuida la aplicación | accidental | NO VERIFICADO (T1-14) |
| b11 | Si un usuario, rol o sucursal está activo | 5 o 6 columnas `activo/estado` en 5 niveles | `membresiaVigente` mira 2 | accidental | NO VERIFICADO |
| b12 | Si un ítem está en la carta | AND de 8 condiciones, armado de forma distinta en 4 lugares (carta pública, admin, ventas por sección, combos) | la carta pública | parte intencional (histórico) | NO VERIFICADO (T3-12) |
| b13 | Nombre del producto | 6 columnas (`nombre`, `nombreEnCarta`, `ItemAgrupadoCarta.nombre`, `PromoCarta.titulo`, `nombreEnTicket`, `nombreOpcion`) | copias congeladas a propósito; el adicional no congela su nombre | intencional con un hueco | NO VERIFICADO |
| b14 | Cómo se compra un producto | `Producto`, `Presentacion`, `ProveedorPorProducto` | sin dueño | accidental | NO VERIFICADO |
| b15 | Último precio de compra | `ProveedorPorProducto.precioUnitario/ultimaCompra`, que se escribe en cada compra y no se entera de las anulaciones, y el Kardex | el Kardex (los lectores ya migraron) | accidental residual | NO VERIFICADO (T1-10, T2-2) |
| b16 | Precio de la promo | `PromoCarta.precio`, `PromoCartaSucursal.precioLocal`, `PromoCuenta.precio` (congelado) | la promo de la cuenta al vender | intencional | — |
| b17 | Descuento del cliente | `Cliente` → `Cuenta.descuentoPorcentaje` | la copia congelada (D7) | intencional | — |

**Bien resuelto, confirmado por stock y por T1:** el saldo es siempre la suma de `MovimientoStock.cantidad`, sin tabla paralela. El problema es que esa suma se calcula en 19 lugares (a15), no que haya dos saldos.

## c. Parámetros o columnas con doble sentido

| # | Columna o parámetro | Sentido 1 | Sentido 2 | Riesgo | Marca |
|---|---|---|---|---|---|
| c1 | `DisponibilidadProducto.disponible` | el producto se usa en la sucursal | sin stock hoy | stock y valuación (§0.1) | VERIFICADO |
| c2 | `MovimientoStock.precioTotal = 0` | venta vieja sin precio | venta real a $0 | se revalúa a precio de hoy | VERIFICADO (`periodo-ventas.ts:33`) |
| c3 | `CuentaItem.precioCartaUnitario` | en un componente de promo: precio a la carta | en una línea suelta: precio antes del descuento | un reporte que la lea como «precio de lista» se equivoca; además es parte de la clave que enlaza la línea con su venta (`cerrar-cuenta.ts:55`) | NO VERIFICADO |
| c4 | Capacidad `precio_local` | permiso | regla de precio: apagarla cambia el precio de producto, opción y promo, y quita el descuento | intencional (dueño, 2026-10-01) | NO VERIFICADO |
| c5 | `Producto.precioVenta` en `BASE_CONFIGURABLE` | precio cobrado | número guardado que no se cobra | los reportes lo tapan con `esBase` | NO VERIFICADO |
| c6 | `Empresa.permisosEditables` | clasificada «ninguna» en el guardián | gobierna los permisos | clase mal declarada | NO VERIFICADO |
| c7 | `GrupoDeOpciones.tipo` | tipo | cambia el sentido de 8 columnas más | el CHECK cubre una parte | NO VERIFICADO; además figura sin declarar en el guardián |
| c8 | `PromoCarta`: informativa o armable | — | depende de que existan cupos | apagar el último cupo cambia el tipo sin avisar | NO VERIFICADO |
| c9 | `ContenidoCartaProducto.nombreEnCarta` | nombre en la carta | nombre del ticket del cliente (vía POS) | renombrar en la carta cambia el ticket | NO VERIFICADO |
| c10 | `ReclasificacionRenglon` y la reclasificación de stock | reclasifica costo (gastos) | reclasifica stock | dos cosas con el mismo nombre | NO VERIFICADO |
| c11 | «Mostrador» | `Mesa.tipo` (puesto) | venta de mostrador clásica | según el canal se permite o no vender sin stock | NO VERIFICADO |
| c12 | Largos de texto | pantalla: nombre de grupo hasta 120 | servidor: corta en 80 | el error aparece recién al guardar | VERIFICADO (`texto.ts:61` y `alta-de-grupo.tsx:39`) |
| c13 | Merma máxima | 100 | 1000 y 9999,99 | tres topes distintos | NO VERIFICADO (T3-19) |

## d. Escrituras de más

Base: T2, cruzado con la sección 5 de los módulos. No hay escrituras dentro de lecturas ni de pantallas de solo lectura (T2, conclusión; el auditor no lo repitió).

| # | Qué | Dónde | Intención | Riesgo | Marca |
|---|---|---|---|---|---|
| d1 | La operación se crea y en el mismo trámite se actualiza para guardar `resultadoMensaje` | venta, movimiento, anular compra, aceptar propuesta, factura, reclasificar, traspasos | accidental | bajo, pero es la ruta más usada | NO VERIFICADO |
| d2 | Vínculo proveedor-producto: por cada línea de compra, 2 lecturas, 1 escritura y 1 auditoría de una columna que nadie lee | `upsert-proveedor-por-producto.ts:53-77` | decisión del 2026-10-08, hoy residual | medio: diverge del Kardex | NO VERIFICADO |
| d3 | La auditoría de una anulación repite lo que ya dicen el contra-asiento y la marca de anulada | `escribir-contra-asiento.ts` | intencional en su mayor parte | bajo | VERIFICADO el contra-asiento |
| d4 | Los toggles y los `guardar-*` escriben aunque no cambie nada (19 de 20; además Contenido, Tema, Portal y SucursalPublica mueven `@updatedAt`) | T2-15, T2-18 | accidental | bajo; en Membresía y Sucursal corre la transacción serializable de gobierno sin necesidad | NO VERIFICADO |
| d5 | Permisos: al cambiar solo «ver», la auditoría de «editar» queda `null → false` | `guardar-permisos.ts:122-135` | accidental | **ensucia la bitácora de permisos** | NO VERIFICADO |
| d6 | Receta: cada guardado crea una versión completa aunque sea idéntica | `guardar-version-de-receta.ts:184` | versionar es intencional; falta detectar «igual» | medio (volumen) | NO VERIFICADO |
| d7 | Fusionar insumos actualiza y borra sustitutos de versiones históricas de receta, que deberían solo agregarse | `persistencia/catalogo/insumos.ts:93-110` | accidental | **reescribe historia** | VERIFICADO |
| d8 | Conteo físico: el estado queda dicho en 2 columnas (estado y texto del detalle), y 2 ramas cambian el estado sin auditar | T2-8 | accidental | trazabilidad | NO VERIFICADO |
| d9 | `Invitacion.enviadaEn` se escribe dos veces con el mismo valor | T2-13 | accidental | bajo | NO VERIFICADO |
| d10 | Apagar una promo en toda la empresa: sin transacción, sin auditoría y sin versión, aunque `soloSalon` y vigencia sí tienen versión | `actualizar-activa-promo-carta.ts` | declarado a propósito («no es un precio») | apaga una venta sin dejar rastro de quién | VERIFICADO |
| d11 | Mínimo de stock global con buscar y después crear (en vez de upsert) sobre un índice parcial manual | `persistencia/stock/stock-minimo.ts:42-47` | accidental | concurrencia: dos altas a la vez | NO VERIFICADO |

## e. Lo no declarado

**e1. Modelos que mueven dinero o stock y están fuera de `MODELOS_EN_ALCANCE` del guardián de columnas:**
- `RecetaIngrediente`, `RendimientoLocalIngrediente`, `SustitutoRecetaIngrediente`, `MargenObjetivo`.
- `PagoDeFacturaProveedor`, `AnulacionDePago`.
- `EjemplarTicket`, `AgregadoDeCuenta`.
- `Grupo`, `CategoriaProducto`, `Presentacion`.
- Lo dicen recetas, compras, salón y catálogo; NO VERIFICADO contra `columnas-de-significado.ts`, salvo la exclusión de Mesa, Grupo, Categoría y Presentación, que confirman dos módulos.

**e2. Columnas sin flujo ni paso (sin escritor y sin lector):**
- `FacturaProveedor.{letra, fechaComprobante, condicionIvaEmpresa, importeNeto, importeIva, origen, recibidaEnAdministracionEn, fechaPagoDeclarada, medioPagoDeclarado}`.
- `Producto.alicuotaIvaVenta` (solo se lee) y `alicuotaIvaCompra`.
- `Empresa.llevaIvaDeCompras`, `Proveedor.condicionIva`.
- Las tablas `PuntoDeVentaDeProveedor`, `FacturaProveedorTributo` y `NotaCreditoProveedor*` ×4.
- `Venta.*` y `CombinacionEnLinea.*`; la familia GO-3a retirada (6 modelos).
- `Operacion.reemplazaAOperacionId/mermaPorAnulacionDeId/motivoAnulacion`, `MovimientoStock.devuelveAMovimientoId`.
- `Sucursal.maxMesasAbiertas`, `ProductoAdmiteGrupo.ejeDeCombinacion` (solo en la base).
- `TemaCartaSucursal.aplicarEnCarta`, que solo se escribe en `true`.
- VERIFICADO por muestreo: `importeNeto`, `fechaPagoDeclarada`, `alicuotaIvaVenta`, `Venta`, `revierteAOperacionId` y `reemplazaAOperacionId`.

**e3. Primitivas sin fuente única declarada:** dinero (`repartir`, `aCentavos`, piso de $0,01 con `IMPORTE_MINIMO` sin usar), `redondearCantidad`, merma, margen, nombre visible, normalizador de texto, email, «hoy» con la zona horaria de la empresa, saldo de stock, precio vigente y «opción ofrecida». Formato de dinero: 143 usos de `toLocaleString("es-AR")` en 66 archivos, y uno de ellos divide por 100 (`tabla-periodo.tsx:80`: NO VERIFICADO).

**e4. Invariantes sin test:**
- Que los lectores del ticket usen la misma regla de nombre.
- Que costo y descuento de Kardex usen la misma merma.
- Que todas las pantallas den el mismo saldo.
- Pago a consignante: concurrencia y anulación.
- Sustitutos de receta solo se agregan.
- `PromoCartaCupo` mínimo ≤ máximo (sin CHECK).
- La matriz precio × capacidad × modo × disponibilidad.
- Las notas de crédito D1 a D7 (solo en papel).
- La repetición (doble clic) de los comandos sin transacción de carta.

**e5. Arneses que faltan:** `recorrerMatriz` (E1) nunca se escribió aunque hay ≥5 oráculos. De 13 módulos del mapa de combinaciones, 5 no tienen guardián de dimensión: cobro y precio, factura repartida, consignación, reportes de costos y clientes con descuento (ui-y-pruebas §6, NO VERIFICADO).

**e6. Código muerto:**
- `core/precios/sincronizacion.ts`: solo lo importa su test. VERIFICADO.
- `core/carta/alcance.ts`: solo su test (NO VERIFICADO).
- Comentarios del esquema que dicen «nada de src/ la escribe» en 5 modelos de opciones que hoy sí tienen escritor.
- `creariaCiclo`, que apunta a `core/catalogo/grupo.ts`, un archivo que no existe.

## f. Deuda sin vencimiento y deuda vencida (regla G1b, tope 60 días)

| Lista | Entradas | Fecha | Meta escrita | ¿Vencida? |
|---|---|---|---|---|
| `columnas-de-significado.json` | 82 | no | «bajar a 0» | sin fecha: no se puede vencer, y esa es justamente la falla |
| `controles-a-mano.json` | 30 | no | «Fase 6» | **la meta ya pasó** (según el diseño de partida) |
| `dialogos-y-avisos-a-mano.json` | 17 | no | «Fase 6» | **sí** |
| `campo-type-number.json` | 11 | no | «lote 6.33» | **sí** |
| `inputmode-numerico-a-mano.json` | 9 | no | «lote 6.33» | **sí** |
| `dueno-unico-por-modelo.json` | 7 | no | «Fase 2» | **sí** |
| `tipografia.json` | 5 | no | «a medida que…» | sin fecha |
| `fecha-de-texto-a-mano.json` | 3 | no | «lote 6.33» | **sí** |
| `colores-de-escala.json` | 2 | no | «Fase 6» | **sí** |
| `primitivas-de-dominio.json` | 2 | no | «Fase 2» | **sí** |
| `colores.json` | 1 | no | «Fase 6» | **sí** |
| `casos-de-uso-en-guardianes.json` | 1 | no | «0» | sin fecha |
| `escritores-de-precio-con-visto`, `modo-oscuro`, `numero-de-formulario-a-mano` | 0 | — | — | en cero |
| **Total** | **170** en 15 listas (12 con entradas) | **0 con fecha** | | 88 con meta vencida y 82 sin meta fechable |

VERIFICADO: conteo propio, y `grep vence` en `linea-de-base/` da 0.

Además:
- Las ~100 excepciones de dependency-cruiser y la lista de knip no tienen fecha (ui-y-pruebas §7, NO VERIFICADO).
- Los contratos sí tienen fecha. Encontré una fecha real escrita a mano: `contratos/contratos/tokens-visuales.ts:31`, vence el 2026-12-20, faltan 44 días. Las fechas pasadas de `motor.test.ts` y `clasificacion.test.ts` son datos de prueba, no deuda real. Lo de «2 de Prisma al 2026-12-01» queda NO VERIFICADO.
- Deuda con forma de comentario y sin fecha:
  - el retiro de GO-3a (6 modelos) y de `ejeDeCombinacion`;
  - la «Etapa C» de `Venta`;
  - 3 interruptores apagados (vigencia de promo, «sumar lugar», menú del día);
  - `Sucursal.maxMesasAbiertas`, cuyo retiro es destructivo y requiere autorización.

**Discrepancia con el insumo de la sesión coordinadora:** decía «240 entradas en 11 cercos». REFUTADO: son 170 entradas en 15 listas, de las que 12 tienen entradas. El diseño de partida habla de «13 listas con entradas»: son 12.

## g. Cruces entre módulos y dependencias que deberían ser una sola primitiva

| # | Quién escribe | Dato de quién | Evidencia | Observación |
|---|---|---|---|---|
| g1 | Carta | `DescuentoProductoSucursal` (catálogo) | `persistencia/carta/descuento-producto.ts` | dos dueños para la tabla del precio |
| g2 | Salón (cierre de cuenta) | `Operacion` y `MovimientoStock` (Kardex) | `registrarVentaEnTx` | intencional; el Kardex tiene 6 dominios que lo escriben y ninguno es dueño |
| g3 | Catálogo (fusionar insumos) | `SustitutoRecetaIngrediente` (recetas) | `insumos.ts:93-110` | además reescribe historia (d7) |
| g4 | Consola de plataforma (`server/operaciones-de-plataforma`, dentro de `src/`) | `Empresa.permisosEditables/dosPaneles`, `ModuloEmpresa` | acceso §10 | tabla `Invitacion` con dos dueños (gerente o usuario) |
| g5 | Compras (cada línea) | `ProveedorPorProducto` | d2 | copia residual |
| g6 | Reportes (`registrar-pago-consignante`) | `PagoConsignante` (consignación) | stock §10 | consignación vive dentro de `reportes/` |
| g7 | Ventas | consignación (líneas de liquidación) | `armar-linea-de-movimiento.ts:80` | la consignación se ata a la venta, no al stock |

**Primitivas que conviene declarar como una sola**, en orden de riesgo:
1. **Precio vigente**: producto, sucursal, opción y descuento (a1 y b2).
2. **Saldo de stock con criterio de disponibilidad** (a15 y b1).
3. **Dinero**: `repartir`, `aCentavos`, piso y redondeo (a4 y a5).
4. **Merma y rendimiento** (a2).
5. **Anulada**: un solo criterio, que es la marca `anuladaEn` con su enlace, no el texto del detalle (b5).
6. **Nombre visible** (a6).
7. **«Hoy» de la empresa** (b9).
8. **Opción ofrecida y grupo vigente** (a11).

## h. Contradicciones

| # | Entre | Qué dice cada uno | Cuál es cierta |
|---|---|---|---|
| h1 | Diseño de partida §3 y el módulo compras | El diseño pone la compra en 4 pasos, empezando por «P1 Cargada (`PENDIENTE_DE_REPARTO`)». Compras dice que la factura nace ya CONFIRMADA y repartida | Compras. `PENDIENTE_DE_REPARTO` aparece solo en `schema.prisma:2780` (VERIFICADO). El ejemplo del diseño hay que corregirlo |
| h2 | Comentario de `anular-factura-proveedor.ts:39` y el código del contra-asiento | El comentario dice que la reversión es un AJUSTE con `revierteAOperacionId`. El código de venta y compra no la enlaza | El código (VERIFICADO). T1-29 dice que solo anular-factura-proveedor la escribe. **Corrección del auditor:** `grep` sobre `src/` encuentra `revierteAOperacionId` solo en ese comentario. NO VERIFICADO si esa ruta la escribe por SQL crudo u otro nombre |
| h3 | Esquema (`CuentaItem.nombreEnTicket`: «los reportes no la leen») y reportes y salón | `tickets-emitidos.ts:76,99` la lee | Reportes y salón |
| h4 | Esquema («nada de src/ la escribe todavía» en 5 modelos de opciones) y el código | Hoy hay escritores | El código (catálogo §7) |
| h5 | ui-y-pruebas §10 («gobernanza de reglas: la importa 1 solo archivo de afuera») y el código | Fuera de `contratos/` la importan al menos 5 archivos: `tokens-del-sistema-visual.test.ts`, `primitivas-sin-clases-de-presentacion.test.ts`, `borde-por-defecto-de-la-aplicacion.test.ts`, `sin-modo-oscuro.test.ts` y `test/carta/borde-por-defecto.test.ts` | **REFUTADO** el «1». La conclusión (módulo propio) se sostiene con menos fuerza |
| h6 | acceso §10 («catálogo de 16 módulos») y `catalogo.ts` | El archivo tiene 15 entradas | `catalogo.ts` (VERIFICADO) |
| h7 | recetas §10 y reportes §10 sobre «costos y márgenes» | Recetas: es un servicio dentro de recetas. Reportes: es un módulo propio candidato | **Contradicción abierta**: ver §j |
| h8 | stock §10 y reportes §10 sobre consignación | Stock: es módulo propio, hoy mal ubicado en `reportes/`. Reportes: «reportes de stock/lotes, incluida consignación: no concluyente» | Stock, por catálogo (`consignacion` existe como módulo vendible) y por permisos propios |
| h9 | Producción: catálogo de módulos y código | `produccion` es módulo vendible (`catalogo.ts:31`), pero no tiene un solo archivo propio: es `Operacion.proceso=PRODUCCION` dentro de movimientos | Desajuste registrado; quién manda es PENDIENTE (dueño) |
| h10 | Clientes: catálogo (`clientes_basico`, soporte) y acceso §10 | Acceso dice que Clientes no es de su módulo sino de ventas y salón | Sin contradicción con el código: el catálogo ya lo trata como soporte aparte. Lo que discrepa es solo la carpeta |
| h11 | El insumo de la sesión coordinadora («240 entradas en 11 cercos») y ui-y-pruebas («170 en 15») | | ui-y-pruebas (VERIFICADO, §f) |
| h12 | Catálogo §10 y compras §10 sobre Proveedores | Catálogo: Proveedores es módulo propio y vive en `catalogo/` por historia; «no concluyente» si es de compras | **Resuelta** (compras §10): es soporte compartido (`proveedores_basico`). Lo requieren compras, consignación y gastos, así que no es de compras ni de catálogo; solo el vínculo `ProveedorPorProducto` es de compras |

## i. Orden de atención propuesto (por riesgo de negocio, sin implementar)

El costo se estima en archivos a tocar; es orden de magnitud. Cada paso es chico y reversible, y ninguno necesita migración salvo donde se indica.

| # | Qué | Riesgo | Costo estimado | Nota |
|---|---|---|---|---|
| 1 | Separar «sin stock hoy» de «se usa en la sucursal» (b1 y c1), o como mínimo que la valuación y el consolidado no filtren por disponibilidad de hoy | stock y dinero (inventario valorizado) | 2 a 4 archivos sin migración (cambiar el filtro de lectores), o más una migración aditiva si se separa la columna | **Necesita decisión del dueño**: ¿«sin stock hoy» es una marca del día aparte? |
| 2 | Ampliar el guardián de anuladas a `src/server/consultas/reportes` y sumar el texto reservado a las 4 validaciones que faltan; decidir si se escribe `revierteAOperacionId` | dinero en reportes | 1 test y 4 validaciones, más 1 archivo si se escribe el enlace | sin migración |
| 3 | `agregar-items.ts:239`: que falle cerrado en vez de pesar $0, y unificar la clave del componente de promo | dinero cobrado | 2 a 3 archivos | sin migración |
| 4 | Primitiva única «precio vigente» con test de igualdad entre carta, venta y reportes | dinero | 5 a 6 archivos | |
| 5 | Venta real a $0 (c2): marcar la línea vieja de otra forma | dinero en reportes | 1 o 2 archivos | NO VERIFICADO si hoy existen ventas a $0 en producción (no se leyó producción) |
| 6 | Fusionar insumos sin reescribir versiones históricas (d7) | trazabilidad de stock y costo | 1 o 2 archivos | |
| 7 | Bitácora de permisos sin falsos cambios (d5) y auditoría de apagar promo (d10) | permisos y visibilidad | 2 o 3 archivos | |
| 8 | Saldo de stock con una sola lectura (a15) y un reloj único (b8) | stock | 10 a 19 archivos | grande: por etapas |
| 9 | Fechar toda la deuda: E4 del diseño (§f) | gobernanza | unos 30 archivos mecánicos | confirmado por el dueño (60 días). Unificar cercos y contratos con un solo motor de vencimiento |
| 10 | Columnas sin escritor: declararlas «pendiente de completar» en su paso, o podarlas (IVA de compra y venta, NC, `Venta`, GO-3a, `maxMesasAbiertas`) | fiscal (falla cerrada hoy) | declarar: 1 o 2 archivos. Podar: migraciones **destructivas que requieren autorización** | regla de poda |
| 11 | Sumar al guardián de columnas los modelos de dinero y stock que faltan (e1) | dinero y stock | 1 archivo más la línea de base | |
| 12 | Primitivas de dinero, merma, redondeo y nombre (a2 a a6) con contrato y copias como deuda fechada (E5) | dinero | unos 8 archivos | |
| 13 | Límites entre pantalla y servidor (c12, T3-19) | experiencia de uso | unos 10 archivos | |
| 14 | Escrituras de más de bajo riesgo (d1, d4, d9) y fábricas de prueba (a14) | rendimiento y mantenimiento | variable | baja prioridad |

## j. MÓDULOS ESCONDIDOS (agregado del dueño)

**Registro actual** (`src/core/modulos/catalogo.ts`, 15 entradas, VERIFICADO):
- **Base:** administración (fijo); catálogo básico, proveedores básico y clientes básico (soporte).
- **Vendibles disponibles:** stock, compras, traspasos, consignación, recetas, producción, carta, promociones y salón.
- **Vendibles en desarrollo:** gastos y centros de costos.

### j1. Candidatos consolidados

| Candidato | Lo propone | ¿Ya está en `catalogo.ts`? | Conteo propio del auditor | Veredicto del auditor |
|---|---|---|---|---|
| **Opciones de venta** | catálogo (firme). Salón: «línea configurada» va hacia catálogo | **No** (tiene permisos propios `opciones_definir`, `producto_opciones_admitidas`) | `src/core/opciones`: 16 archivos que solo importan `core/datos` y `core/moneda` (núcleo puro). **68 archivos de afuera lo importan**: 20 de `server/actions`, 12 de `app/(app)`, 10 de `core/pos`, 6 de `components/catalogo`, 4 de `core/carta`, 4 de `core/features`, 3 de lecturas, 3 de consultas, 2 de movimientos y 2 del POS. VERIFICADO | **Módulo propio**: identidad y núcleo limpio. Es el único candidato grande que no está en el registro. Muchos lo consumen: conviene declararlo y no moverlo todavía |
| **Promociones y combos** | carta (claro); salón (armar promo va hacia promociones) | **Sí** (`promociones`, requiere carta) | NO VERIFICADO por el auditor (carta: 64 imports internos contra 23 hacia el resto de la carta) | Ya es módulo; el código vive dentro de `carta/` y su consumidor principal es el POS. Falta que la carpeta lo refleje |
| **Traspasos** | stock | **Sí** | Fuera de `*/traspasos/` lo importa **1 solo archivo**: `core/movimientos/transiciones.ts`. VERIFICADO | Ya es módulo y está casi aislado; el único cable es el Kardex |
| **Consignación** | stock | **Sí** | Repartido en 10 carpetas: 13 de `server/actions`, 9 de `core/features`, 5 de `core/reportes`, 5 de `core/movimientos` y otros. VERIFICADO por vocabulario | Ya es módulo, **mal ubicado** (dentro de `reportes/`) y sin invariantes propios |
| **Recetas** (sacarlas de `catalogo/`) | catálogo y recetas | **Sí** | NO VERIFICADO | Ya es módulo; solo falta la carpeta |
| **Producción** | recetas (desajuste) | **Sí** | sin archivos propios (h9) | Módulo en el registro, proceso en el código. PENDIENTE (dueño) |
| **Rendimiento y mermas de cocina** | recetas (confianza media) | No (sus permisos cuelgan de `recetas`) | NO VERIFICADO | Candidato. Pregunta para el dueño: ¿se vende aparte? |
| **Costos y márgenes** | reportes (candidato). Recetas: es un servicio | No | NO VERIFICADO | **Contradicción (h7).** Propuesta del auditor: declararlo como **primitiva o servicio** («costeo») con una sola definición de margen (a16), no como módulo vendible, porque no tiene tabla ni flujo propio salvo `MargenObjetivo` |
| **Ticket y comanda** | salón (el mejor candidato del módulo, pero no cumple los 5 criterios) | No | NO VERIFICADO (salón: 10 archivos de afuera) | Parte de salón, con un borde claro; queda atado al cierre atómico |
| **Consola de plataforma** con alta de empresas | acceso | No es módulo de empresa: es otra aplicación (`plataforma/`) | NO VERIFICADO | Ya está separada como aplicación. Falta sacar de `src/` `server/operaciones-de-plataforma` (g4) |
| **Clientes** | acceso (no es de su módulo) | **Sí** (`clientes_basico`) | NO VERIFICADO | Ya es módulo; solo la carpeta está en acceso |
| **Auditoría general** y **módulos habilitados** | acceso | — | NO VERIFICADO | Infraestructura transversal, no módulos de negocio |
| **Primitivas base** (dinero, texto, fecha, número, fiscal) | reportes | No | NO VERIFICADO (reportes: `core/datos` lo importan 175 archivos) | **Núcleo transversal**: declararlo como capa base con catálogo de primitivas (E5), no como módulo vendible |
| **Sistema de diseño** (`src/ui`) | ui-y-pruebas | — | **157 archivos** de afuera importan `@/ui`; `src/ui` solo se importa a sí mismo (3 imports de `@/ui/primitivas`). VERIFICADO | Capa propia y limpia; falta mover a ella Modal, CampoNumero y activar/desactivar |
| **Gobernanza de reglas** (`test/arquitectura/contratos`) | ui-y-pruebas | — | ≥5 importadores de afuera, no 1 (h5) | Herramienta propia; debería absorber el motor de los cercos (§f) |
| **Demo y siembras** | ui-y-pruebas | — | NO VERIFICADO | Herramienta propia |
| **Proveedores** | catálogo y compras | **Sí** (`proveedores_basico`) | lo requieren 3 módulos (`catalogo.ts:27,29,37`). VERIFICADO | Soporte compartido; solo la carpeta (`catalogo/`) está fuera de lugar (h12) |
| **Cuentas por pagar / tesorería** (pagos a proveedores) | compras §10 (auditor) | No (permiso `declarar_pago_compra` en `compras`, contexto empresa) | 12 archivos de `src/`. VERIFICADO | **Candidato futuro**: hoy es un pago binario sin importe; es módulo propio cuando exista el pago con importe, y serviría también a `gastos`. Pregunta para el dueño |
| **Notas de crédito** e **IVA de compras** | compras §10 (auditor) | No | 0 escritores en `src/`. VERIFICADO | **Etapas sin construir, no módulos escondidos**: el IVA iría a `fiscal`, transversal; las notas de crédito, dentro de compras |
| **Combinaciones GO-3a** | recetas | — | 0 referencias en `src/` (lo fija un test) | Módulo muerto: retirar (migración destructiva, requiere autorización) |

### j2. Mapa de módulos resultante (PROPUESTA)

| Módulo actual (`catalogo.ts`) | Queda | Cambio propuesto | Motivo del corte |
|---|---|---|---|
| catálogo básico | sí | se le saca **Opciones de venta** (nuevo módulo, sin mover archivos al principio) | identidad, permisos y núcleo propios; 68 consumidores |
| — | **opciones de venta** (nuevo) | se declara en el registro; requiere catálogo básico; lo usan salón, carta y stock | es la única identidad grande que hoy no se puede habilitar sola. **PENDIENTE (dueño):** ¿se habilita aparte o va siempre? |
| recetas | sí | carpeta propia (hoy en `catalogo/`); queda en duda si **rendimiento y mermas** es un submódulo | permisos propios `reporte_rendimiento_*` |
| producción | sí, pendiente | decidir si es un módulo con código propio o un proceso de stock | h9 |
| stock | sí | núcleo **Kardex** con un solo dueño (primitiva); conteo, alertas y reclasificación se quedan en stock | 6 dominios escriben `Operacion` |
| traspasos | sí | sin cambio (ya está aislado) | 1 solo importador de afuera |
| consignación | sí | sacarla de `reportes/` a su carpeta | permisos y actor propios; hoy mal ubicada |
| compras | sí | absorbe «compras registradas» (hoy en reportes); los casos de uso de compra, factura y pago salen de `actions/movimientos/` a una carpeta propia; notas de crédito e IVA quedan como etapas «pendiente de completar» | reportes §10, compras §10 |
| proveedores básico | sí | carpeta propia (hoy en `catalogo/`) | lo requieren compras, consignación y gastos (h12) |
| — | **cuentas por pagar** (futuro) | solo si el dueño lo confirma, cuando exista el pago con importe | compras §10 |
| carta | sí | se le sacan promociones (carpeta); tema y portal se quedan | — |
| promociones | sí | carpeta propia; su consumidor principal es el POS | carta §10 |
| salón | sí | sin corte (ticket y mostrador son partes); `Venta` y `CombinacionEnLinea` sin escritor, para decidir o podar | salón §10 |
| clientes básico | sí | carpeta fuera de acceso | acceso §10 |
| administración | sí | permisos, usuarios y sesión; auditoría y módulos habilitados como infraestructura | — |
| gastos, centros de costos | en desarrollo | sin cambio | no se auditaron (fuera de los 9) |
| — (transversal) | **costeo** (servicio, no se vende) | una sola definición de margen y costo | h7 y a16 |
| — (transversal) | **primitivas base** | catálogo de primitivas con contratos (E5) | §e3 |
| — (fuera del producto) | consola de plataforma; sistema de diseño; gobernanza de reglas; demo y siembras | ya separadas o para separar en el repositorio; no son módulos de empresa | ui-y-pruebas §10, acceso §10 |

**Lo más barato para empezar** (regla del 2026-10-27): declarar **opciones de venta** en `catalogo.ts` sin mover archivos. Las demás mudanzas de carpeta (consignación, promociones, recetas, clientes) no cambian el comportamiento y pueden esperar.

---

## k. Lo que el auditor no verificó

- Los puntos marcados NO VERIFICADO en las tablas, en especial los de T1, T2 y T3 que no se leyeron uno por uno: a3, a8, a9, a11 a a14, a16 a a18, b3, b6 y b8 a b14, c3 a c11, d1, d2, d4 a d6, d8, d9 y d11.
- Escritores por SQL crudo, scripts o siembras de las columnas «sin escritor»: solo se buscó en `src/`.
- Datos de producción: no se leyeron. Que existan ventas a $0, productos que se producen con «sin stock hoy» o insumos fusionados con sustitutos históricos es NO VERIFICADO.
- Sección 10 de compras: la escribió el auditor a partir del inventario de esa sesión y de conteos con `grep`, no con una herramienta de grafo.
- No se corrió el gate: es un PR solo de documentos y el CI es el árbitro.
