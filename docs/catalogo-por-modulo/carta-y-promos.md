# Catálogo del módulo CARTA Y PROMOCIONES (2026-11-06)

**Estado:** inventario de SOLO LECTURA, sin cambios de código, tests ni migraciones. Base: `main` `50c1153`. Alimenta el catálogo común (sesión `session_01FWp2khZQzz6smR9NEeR2ww`). Diseño de partida: `docs/diseno-flujos-y-pasos-2026-11-06.md` (rama `alegp/diseno-flujos-y-pasos`). Los pasos de §1 son PROPUESTA; lo que depende del dueño, PENDIENTE. Lo no comprobado: NO VERIFICADO. Uso real en producción: lo dicho por el dueño (0 ítems agrupados, 2 géneros sin productos), no verificado por mí.

## 1. FLUJOS
| Flujo | Finalidad | Pasos (columnas) |
|---|---|---|
| F1 Plato en la carta (continúa V4 de «producto vendible») | Que el cliente vea y pida un plato de la sucursal | P1 existe en la carta: `ContenidoCartaProducto.{sucursalId,productoId,visibleEnCarta}` (`persistencia/carta/contenido-producto.ts:54`) · P2 ubicado: `seccionCartaId`,`orden` · P3 presentado: `descripcion`,`tags`,`especial`,`nombreEnCarta` (único por sucursal, `lecturas/carta/choque-de-nombre.ts`), `mostrarNombreArriba` (solo base configurable) · P4 clasificado para el mozo: `generoCartaId` (PENDIENTE: el dueño dijo que las marcas van por opciones) |
| F2 Sección de carta | Ordenar la carta | P1 `SeccionCarta.{nombre,orden,activa}` · P2 `titulo`,`descripcion`,`imagenUrl` (opcionales de presentación) |
| F3 Ítem agrupado (pendiente de confirmar si sigue; 0 en producción) | Mostrar varios productos como un solo renglón | P1 `ItemAgrupadoCarta.{nombre,seccionCartaId,activo}` · P2 `OpcionItemAgrupadoCarta.{productoId,orden}` · P3 `descripcion`,`tags`,`especial`,`generoCartaId` |
| F4 Género (PENDIENTE: dueño) | Carpetas del selector del POS | `GeneroCarta.{nombre,orden,activo}` |
| F5 Promo de carta (combo) | Vender una composición a precio fijo | P1 definida (empresa): `PromoCarta.{seccionCartaId,titulo,precio,orden,descripcion}` · P2 armada: `PromoCartaCupo.{tipo,seccionCartaId,nombre,cantidadMinima,cantidadMaxima,orden,activo}`; si el lugar es LISTA: `EntradaDeCupo.{productoId,claveConfiguracion,modoDeOpciones,orden,activa}` + `OpcionDeEntradaDeCupo.{opcionId,cantidad}`; si es DEL_DIA: `EntradaDelDiaDeCupo.{sucursalId,fecha,productoId,activa,actualizadoPorId}` · P3 prendida en la sucursal: `PromoCartaSucursal.{promoCartaId,sucursalId,activa}` · P4 precio local: `PromoCartaSucursal.precioLocal` (exige capacidad `precio_local`, `core/carta/promo-sucursal.ts:31`) · P5 dónde se ve: `PromoCarta.soloSalon` · lateral: `vigenteDesde`,`vigenteHasta`,`diasDeSemana` (interruptor apagado) · salida: `PromoCarta.activa=false` (apaga en toda la empresa) |
| F6 Descuento de producto | Mostrar tachado y cobrar con % | `DescuentoProductoSucursal.{productoId,sucursalId,porcentaje}`; fila ausente = sin descuento (fuera de tu lista, pero lo escribe `persistencia/carta/descuento-producto.ts`) |
| F7 Publicación | Que la carta salga a internet | P1 `SucursalPublica.{sucursalId,slug}` (alta, `registro-publico.ts:14`) · P2 `etiqueta`,`subtituloPortal`,`orden` · P3 `posX/posY/posW/posH` (mapa) · P4 `publicada` · P5 `TemaCartaSucursal.{valores,aplicarEnCarta}` (estilo) · P6 `PortalCartaEmpresa.valores` (apariencia del portal de la empresa) |
| F8 Armar promo en el POS (solo lectura de la promo) | Agregar el combo a una cuenta | Lee `PromoCarta`+`PromoCartaSucursal` (`wherePromoOfrecidaEn`), cupos activos, entradas, platos del día y vigencia: `lecturas/pos/promo-para-agregar.ts:59-67`, `entradas-de-promo-para-vender.ts:65-72`, `selector-carta.ts:94-140` |

## 2. COLUMNAS (no técnicas; se omiten id, empresaId, creadoEn, actualizadoEn). Escritor = `persistencia/carta/…`
| Modelo.columna | Flujo/paso | Para qué | Escritor | Lectores | Clase | Observación |
|---|---|---|---|---|---|---|
| SeccionCarta.nombre/titulo/descripcion/imagenUrl/orden | F2 P1-P2 | Rótulo y orden de sección | secciones.ts:23,31,45 | lecturas/carta/menu.ts, consultas/carta/admin.ts, mantenimiento.ts, POS selector | ciega (no entra al guardián: no es de significado) | `orden` lo escriben 2 funciones (`cambiarDatos…` y `fijarOrden…`, secciones.ts:31,45) |
| SeccionCarta.activa | F2 P1 | Apagar sección | secciones.ts:40 | menu.ts:73 | visibilidad (declarada) | — |
| ContenidoCartaProducto.visibleEnCarta | F1 P1 | Aparece en la carta | contenido-producto.ts:31,41,54; copiar-carta.ts:76 | menu.ts, selector-carta.ts, choque-de-nombre.ts, mantenimiento.ts | visibilidad (declarada) | 3 escritores de la misma fila (upsert completo, upsert visible, create). `fijarVisibleEnCarta` crea fila con el resto vacío (:41) |
| ContenidoCartaProducto.seccionCartaId/orden | F1 P2 | Ubicación | contenido-producto.ts:31,54; copiar-carta.ts | menu.ts, admin.ts | ciega | seccionCartaId nulo permitido con visible=true (NO VERIFICADO si algún CHECK lo impide) |
| ContenidoCartaProducto.descripcion/tags | F1 P3 | Texto del plato | contenido-producto.ts:31 | menu.ts:67 | ciega | — |
| ContenidoCartaProducto.especial | F1 P3 | Marca visual (icono) | contenido-producto.ts:31 | carta-publica/iconos.tsx, seccion.tsx | **deuda** (sin declarar, linea-de-base) | cambia lo que ve el cliente |
| ContenidoCartaProducto.nombreEnCarta | F1 P3 | Nombre de cara al cliente | contenido-producto.ts:31,87 (`fijarNombreEnCartaSiVacio`); copiar-carta.ts | armar-menu.ts:289, selector-carta (POS), nombres-para-el-ticket.ts, busqueda-de-producto.ts | visibilidad (declarada) | **doble sentido**: lo lee el ticket del cliente vía POS (interfaz §8); CHECK 1–80 car. |
| ContenidoCartaProducto.mostrarNombreArriba | F1 P3 | Base: nombre como encabezado u oculto | contenido-producto.ts:31; copiar-carta.ts | armar-menu.ts, nombre-para-mostrar.ts, selector-carta | visibilidad (declarada) | `undefined` = no se toca (comportamiento de Prisma) |
| ContenidoCartaProducto.generoCartaId | F1 P4 / F4 | Carpeta del selector | contenido-producto.ts:31 | selector-carta.ts (POS), admin.ts | ciega | **la carta pública no lo lee** (menu.ts sin género): solo POS |
| ItemAgrupadoCarta.{nombre,seccionCartaId,descripcion,tags,orden,sucursalId} | F3 P1/P3 | Renglón agrupado | items-agrupados.ts:24,30; copiar-carta.ts:31 | menu.ts:174, selector-carta | ciega | 0 en producción (dueño) |
| ItemAgrupadoCarta.activo / .especial | F3 | Apagar / marca | items-agrupados.ts:36 / :24,30 | menu.ts:97 | **deuda** ambas | — |
| ItemAgrupadoCarta.generoCartaId | F3 P3 | Carpeta POS | items-agrupados.ts | selector-carta | ciega | — |
| OpcionItemAgrupadoCarta.{itemAgrupadoCartaId,productoId,orden} | F3 P2 | Qué productos agrupa | items-agrupados.ts:41,46,51; copiar-carta.ts:52 | menu.ts, selector-carta, choque-de-nombre | ciega | única vía que **borra** (`deleteMany`, :51): excepción a «se apaga, no se borra» |
| OpcionItemAgrupadoCarta.sucursalId | F3 P2 | Sucursal | items-agrupados.ts:41 | whereCartaDeSucursal | ciega | **doble fuente**: también está en el ítem; la FK es solo `(empresaId, itemAgrupadoCartaId)` (schema.prisma:1976), la coherencia es solo de la app (NO VERIFICADO trigger) |
| GeneroCarta.{nombre,orden,sucursalId} | F4 | Carpeta | generos.ts:13,19; copiar-carta.ts:13 | selector-carta, admin.ts | ciega | 2 sin productos en producción (dueño) |
| GeneroCarta.activo | F4 | Apagar | generos.ts:25 | selector-carta | **deuda** | — |
| PromoCarta.{titulo,descripcion,seccionCartaId,orden} | F5 P1 | Datos de la promo | promos.ts:22,34 | menu.ts:85, selector-carta:94, admin.ts, combos.ts | ciega | — |
| PromoCarta.precio | F5 P1 | Precio de empresa (Decimal 14,2) | promos.ts:22,34 | promo-sucursal.ts:31, POS | dinero (no es columna de significado; la audita `guardar-promo-carta`) | — |
| PromoCarta.activa | F5 salida | Apagado general | promos.ts:50 | `wherePromoOfrecidaEn` y `menu-del-dia.ts:21` (inline) | **deuda** (sin declarar) | cambia qué se vende y no tiene versión ni auditoría (ficha `actualizar-activa-promo-carta.ts`: DOCUMENTO_PROPIO, sin transacción) |
| PromoCarta.soloSalon | F5 P5 | No va a la carta pública | promos.ts:34,116 | `wherePromoOfrecidaEn` (único lector, guardián `promo-sucursal-en-un-solo-lugar`) | visibilidad (declarada) | con `version` |
| PromoCarta.vigenteDesde/Hasta/diasDeSemana | F5 lateral | Vigencia | combos.ts:38 | selector-carta.ts:140, promo-para-agregar.ts:65 | dinero (declaradas) | UI apagada (`VIGENCIA_DE_PROMO_VISIBLE=false`, vigencia-de-promo.ts:18); la carta pública NO la evalúa (descartado por el dueño, `diseno-modulo-carta-2026-10-28.md`) |
| PromoCarta.version | F5 | Control optimista | promos.ts:116, combos.ts:38 | guardar-solo-salon…, guardar-vigencia… | ninguna (declarada) | solo lo usan 2 comandos de los ~8 que escriben `PromoCarta` |
| PromoCartaSucursal.activa | F5 P3 | Prender en la sucursal | promos.ts:22,55 | `wherePromoOfrecidaEn` | visibilidad (declarada) | fila ausente = no ofrecida (opt-in) |
| PromoCartaSucursal.precioLocal | F5 P4 | Precio local | promos.ts:104 | promo-sucursal.ts:31 | dinero (no declarada; no es booleano) | conserva valor si se apaga la capacidad (intencional, R1) |
| PromoCartaCupo.tipo / .activo | F5 P2 | Tipo de lugar / baja lógica | promos.ts:71,91,96 | selector-carta.ts:94, componentes-de-promo.ts | dinero (declaradas) | «expandir y contraer»: lectores filtran `tipo='SECCION'` |
| PromoCartaCupo.nombre / .seccionCartaId | F5 P2 | Nombre del lugar / sección | promos.ts:71 | combos.ts, selector-carta | **deuda** ambas | CHECKs en migración go3d |
| PromoCartaCupo.cantidadMinima/Maxima/orden | F5 P2 | Cuántas unidades por lugar | promos.ts:71,91 | piso-de-promo.ts, promo-combo.ts | ciega (cambia dinero: piso de precio) | no declarada |
| EntradaDeCupo.activa / .modoDeOpciones | F5 P2 | Entra al combo / FIJAS-A_ELEGIR | combos.ts:15,27 | entradas-de-promo-para-vender.ts:65 | dinero (declaradas) | identidad inmutable |
| EntradaDeCupo.claveConfiguracion | F5 P2 | Canónico de las opciones | combos.ts:15 | promo-combo.ts, agregar-entrada-de-cupo.ts | **deuda** | derivada de `OpcionDeEntradaDeCupo` → **doble fuente** (clave + filas) |
| EntradaDeCupo.productoId/orden; OpcionDeEntradaDeCupo.{opcionId,cantidad} | F5 P2 | Qué entra | combos.ts:15-20 | componentes-de-promo.ts:108 | ciega | 0 lugares LISTA en producción (dueño) |
| EntradaDelDiaDeCupo.activa / .fecha | F5 P2 DEL_DIA | Plato del día | combos.ts:50,59 | entradas-de-promo-para-vender.ts:72, menu-del-dia.ts:29 | dinero (declaradas) | pantalla apagada (`MENU_DEL_DIA_VISIBLE=false`) |
| EntradaDelDiaDeCupo.actualizadoPorId | F5 | Quién | combos.ts:59 | **ninguno en pantalla** (solo se escribe) | ciega | trazabilidad sin lector (la cadena de auditoría sí) |
| SucursalPublica.slug/etiqueta/subtituloPortal/orden | F7 P1-P2 | URL y rótulo del portal | registro-publico.ts:14,32 | lecturas/carta/publica.ts:25 | ciega | `slug` se genera una vez (slugTenant) |
| SucursalPublica.posX/Y/W/H | F7 P3 | Mapa | registro-publico.ts:32,50 | portal-vista.tsx | ciega | **2 escritores** (guardar completo y mover en mapa) |
| SucursalPublica.publicada | F7 P4 | Visible en el portal | registro-publico.ts:32 | publica.ts, sitemap | visibilidad (declarada) | — |
| TemaCartaSucursal.valores | F7 P5 | 64 claves de estilo | tema.ts:17 | publica.ts:101 | ciega | JSON validado por catálogo `CLAVES_TEMA_V1` |
| TemaCartaSucursal.aplicarEnCarta | F7 P5 | Borrador vs aplicado | tema.ts:19-20 (siempre `true`) | publica.ts:106, admin.ts:347 | ninguna (declarada) | **sin escritor de `false`**: `cambiarAplicacionTema` (citada en `diseno-modulo-carta`) no existe en `src`; hoy es constante `true` tras guardar |
| PortalCartaEmpresa.valores | F7 P6 | 22 claves del portal | portal-empresa.ts:15 | publica.ts | ciega | — |
| DescuentoProductoSucursal.porcentaje | F6 | % de descuento | descuento-producto.ts:22 | lecturas/carta/descuentos.ts, selector-carta | dinero (modelo de dinero, sin columna de significado) | borra fila (`delete`, :14) |

## 3. FUNCIONES Y PRIMITIVAS
| Nombre | Archivo | Qué hace | Copias/variantes | ¿Fuente única declarada? |
|---|---|---|---|---|
| `nombreDeCarta` | core/carta/armar-menu.ts:289 | nombre en carta o, si vacío, del producto (trim) | `p.nombreEnCarta ?? p.nombre` en `app/(pos)/mesas/[mesaId]/selector-carta.tsx:100,138` y `actualizar-visible-en-carta.ts:48` (no tratan «vacío» igual: `??` no mira blancos); `nombreParaMostrar` la envuelve (nombre-para-mostrar.ts:25) | NO (es la «regla única» por comentario, sin guardián) |
| `claveDeNombreDeCarta` | core/carta/nombre-en-carta.ts | normaliza nombres (tildes, mayúsculas, espacios) | otros normalizadores de nombre fuera del módulo (NO VERIFICADO cuántos) | NO |
| `wherePromoOfrecidaEn` | core/carta/promo-sucursal.ts:16 | «promo ofrecida» = activa+sucursal activa(+no soloSalon) | filtro inline `promoCarta:{activa:true}` en `consultas/carta/menu-del-dia.ts:21` | SÍ (guardián `promo-sucursal-en-un-solo-lugar` solo cubre `soloSalon`) |
| `precioDePromo` | promo-sucursal.ts:31 | precio local si hay capacidad, si no empresa | `precioDeCarta` (armar-menu.ts, para productos) | parcial (`precio-local-en-un-solo-lugar.test.ts`) |
| `promoVigenteEl` + `diaDeColumnaDate` | core/carta/vigencia-de-promo.ts:63 | ¿vale hoy? | llamadas repetidas con la misma conversión en `selector-carta.ts:140` y `promo-para-agregar.ts:65-67` | función única; chequeo duplicado en 2 lectores |
| `whereCartaDeSucursal` | core/carta/carta-de-sucursal.ts:11 | filtro por sucursal | — | SÍ (`carta-estructura-lectores-inventariados.test.ts`) |
| `diferenciaDeCupos` | core/carta/cupos-de-promo.ts:99 | diff por clave natural | — | única |
| `pisoDePrecioDePromo` | core/carta/piso-de-promo.ts:22 | precio mínimo según cupos | — | única |
| `validarPrecioCarta` | core/carta/validaciones.ts | valida importe | validador propio de importes en línea de base `primitivas-de-dominio.json` (:8) | deuda: debe usar `core/datos/importe.ts` |
| `formatearPrecioCarta` | core/carta/precio-carta.ts:9 | formato de dinero | el formato de dinero de todo el sistema tiene copias (documento de diseño §E5: 143 usos) | NO |

## 4. FUENTES DE VERDAD
| Hecho | Lugares | Manda | Intencional o accidental |
|---|---|---|---|
| «El plato está en la carta» | `ContenidoCartaProducto.visibleEnCarta` + `DisponibilidadProducto.disponible` + fila ausente + `ItemAgrupadoCarta/Opcion…` | visible=true Y disponible (menu.ts:60) | intencional (opt-in), pero 3 estados («fila ausente», visible=false, no disponible) dicen «fuera» |
| «La promo se ofrece» | `PromoCarta.activa`, `PromoCartaSucursal.{fila,activa}`, `soloSalon`, capacidad, vigencia | `wherePromoOfrecidaEn` (+ vigencia solo en POS) | intencional; la carta pública ignora vigencia por decisión del dueño |
| Precio de la promo | `PromoCarta.precio`, `PromoCartaSucursal.precioLocal`, `PromoCuenta.precio` (congelado al agregarla, schema.prisma:2373) | precioDePromo | intencional (congelar al vender) |
| Nombre visible del plato | `Producto.nombre`, `nombreEnCarta`, `CuentaItem.nombreEnTicket` (congelado al agregar) | `nombreDeCarta` | intencional, con 3 variantes de cálculo (§3) |
| Sucursal de una opción de ítem agrupado | `OpcionItemAgrupadoCarta.sucursalId` y `ItemAgrupadoCarta.sucursalId` | la app | accidental (sin restricción) |
| Configuración fija de una entrada | `EntradaDeCupo.claveConfiguracion` y filas `OpcionDeEntradaDeCupo` | la app las escribe juntas (combos.ts:15-20) | accidental (derivado guardado; coherencia sin CHECK cruzado) |
| Tema aplicado | `TemaCartaSucursal.aplicarEnCarta` y existencia de fila | fila + `true` | accidental: el estado `false` solo viene del DEFAULT |
| Qué estructura es de empresa o de sucursal | secciones y promos: empresa; contenido, ítems, géneros: sucursal; entradas del día: sucursal | ADR-009 | intencional |

## 5. ESCRITURAS (casos de uso: `server/actions/carta/casos-de-uso/`; ficha `@ficha`)
| Caso de uso | Qué escribe | ¿De más? | Intención |
|---|---|---|---|
| guardar-contenido-carta-producto | upsert de TODOS los campos del contenido (siempre completos) | sí: pisa campos que el formulario no tocó (salvo los `undefined`) | accidental; protegido con `FOR UPDATE` del producto |
| actualizar-visible-en-carta | upsert que **crea** fila vacía si no existía | crea una fila con solo `visible` | intencional («crea la fila con el resto vacío») |
| agregar-producto-a-la-carta / quitar-producto-de-la-carta | create / **delete** del contenido | `quitar` borra la fila (rompe «nada se borra»), pero audita cada dato antes | intencional (decisión 2026-10-14) |
| copiar-carta-de-sucursal | createMany de géneros, ítems, opciones, contenidos | no copia promos | intencional |
| guardar-promo-carta | create/update `PromoCarta` + fila `PromoCartaSucursal` | crea fila de sucursal en el alta | intencional (S-10) |
| actualizar-activa-promo-carta(-en-sucursal) | `activa` | sin transacción, sin auditoría, sin versión | accidental (otras columnas de la promo sí tienen versión) |
| guardar-solo-salon / guardar-vigencia | `PromoCarta` con `version` | no | intencional |
| guardar-precio-local-promo-carta | upsert `PromoCartaSucursal` (crea APAGADA) | no | intencional |
| guardar-cupos-promo-carta | crea/cambia/da de baja cupos (diff) | no | intencional |
| agregar-entrada-de-cupo, agregar/quitar-plato-del-dia, copiar-menu-del-dia-anterior | entradas y platos del día | crea de más al copiar el día (otra fecha) | intencional |
| guardar-tema-carta | upsert `TemaCartaSucursal` con las 64 claves + `aplicarEnCarta=true` | reescribe todo | accidental (no hay «borrador») |
| guardar-seccion-carta, genero, item-agrupado, sucursal-publica, portal, mover-en-mapa | updates simples, sin transacción (`transaccion=NINGUNA`) | `guardarRegistroPublico` y `moverEnMapa` escriben `posX/posY` ambos | accidental (doble escritor) |
| quitar-opcion-item-agrupado | `deleteMany` de la opción | borra | intencional |

## 6. INVARIANTES
| Regla | Documento | Test |
|---|---|---|
| Carta propia por sucursal; `whereCartaDeSucursal` en cada lectura | `core/carta/carta-de-sucursal.ts` | `test/arquitectura/carta-estructura-lectores-inventariados.test.ts`, `test/carta/carta-propia-por-sucursal.test.ts` |
| Promo ofrecida = activa + sucursal activa; `soloSalon` en un solo lugar; audiencia falla cerrado | `promo-sucursal.ts` | `promo-sucursal-en-un-solo-lugar` (arq.), `promo-audiencia-falla-cerrado.test.ts`, `test/carta/visibilidad-de-promos-matriz.test.ts` |
| Cupo: SECCION⇔`seccionCartaId` no nulo; `tipo` en lista; nombre fuera de SECCION | migración go3d (CHECKs) | `test/persistencia/migracion-go3d.test.ts` |
| Un cupo no se borra; entrada/plato del día solo se desactivan | `persistencia/carta/combos.ts` | `test/carta/cupos-sin-borrar-go3.test.ts`, `entradas-de-cupo-go3.test.ts` |
| Promo con cupo de tipo nuevo no se ofrece (falla cerrado) | `cupos-de-promo.ts` | `test/carta/cupos-tolerantes-go3.test.ts` |
| Nombre visible único por sucursal | `nombre-en-carta.ts` | `test/carta/contenido-nombre-en-carta-choque.test.ts`, `nombre-en-carta.test.ts` |
| Edición concurrente de la promo (versión) | ADR-032 | `test/carta/precio-local-de-promo-concurrencia.test.ts`; alta de ítem agrupado: `items-agrupados-carrera(-real).test.ts`; registro público: `registro-publico-carrera.test.ts` |
| Dinero de la carta se audita en una transacción | — | `test/carta/dinero-de-carta-auditoria-atomica.test.ts`, `cupos-promo-auditados.test.ts` |
| Combinaciones de plato oculto, incluye/va con, forma de la carta | diseños carta B | `*.oraculo.test.ts(x)` (`forma-de-la-carta`, `incluye-en-carta`), `grupo-oculto-en-carta-combinaciones.test.ts` |
| Doble clic de «activar/apagar promo» no duplica | — | sin test de repetición propio (NO VERIFICADO) |
| `aplicarEnCarta=false` oculta el tema | `publica.ts:106` | sin test del estado `false` reproducible desde la app (nadie lo escribe) |
| Vigencia fuera de rango no vende | `vigencia-de-promo.ts` | `test/carta/vigencia-de-promo-interruptor.test.tsx` (solo la UI); el filtro del POS: NO VERIFICADO |
| Mismo producto en dos cupos de la misma promo | schema.prisma comentario | `@@unique([promoCartaId, seccionCartaId])` (BD) |

## 7. DEUDA
| Ítem | ¿Vence? | Dónde |
|---|---|---|
| 8 columnas del módulo sin declarar en el guardián: `ContenidoCartaProducto.especial`, `EntradaDeCupo.claveConfiguracion`, `GeneroCarta.activo`, `ItemAgrupadoCarta.{activo,especial}`, `PromoCarta.activa`, `PromoCartaCupo.{nombre,seccionCartaId}` | NO (sin fecha; meta «bajar a 0») | `test/arquitectura/cercos/linea-de-base/columnas-de-significado.json:34,61,97,115,118,196,199,202` |
| `validarPrecioCarta` fuera de `core/datos/importe.ts` | NO | `linea-de-base/primitivas-de-dominio.json:8` |
| Controles, diálogos, colores y tipografía a mano en pantallas de carta (`mantenimiento-de-carta.tsx`, `parametrizacion/formularios.tsx`, `editor-portal.tsx`, `selector-carta.tsx`…) | NO | `controles-a-mano.json:41-85`, `dialogos-y-avisos-a-mano.json:47-68`, `colores.json`, `tipografia.json`, `campo-type-number.json:10-40` |
| 3 interruptores apagados: `VIGENCIA_DE_PROMO_VISIBLE`, `SUMAR_LUGAR_DE_LISTA_VISIBLE`, `MENU_DEL_DIA_VISIBLE` (columnas y servidor siguen vivos) | NO (borrado futuro, «con autorización») | `core/carta/vigencia-de-promo.ts:18`, `cupos-de-promo.ts:20`, `menu-del-dia.ts:5` |
| `core/carta/alcance.ts` sin importadores en `src` (solo su test) y apoya tablas inexistentes (`SeccionCartaSucursal`) | NO | `src/core/carta/alcance.ts:1-14`, `test/core/carta-alcance.test.ts` |
| Documentación stale: `cambiarAplicacionTema` | NO | `docs/diseno-modulo-carta-2026-10-28.md` |
| Ítems agrupados y géneros (0 y 2 sin productos en producción) | NO | modelos §1 F3/F4 (poda: PENDIENTE del dueño) |

## 8. INTERFACES con otros módulos
- **POS**: lee `PromoCarta`, cupos, entradas, platos del día, `ContenidoCartaProducto`, géneros, descuentos (`lecturas/pos/selector-carta.ts`, `promo-para-agregar.ts`, `entradas-de-promo-para-vender.ts`); congela nombre en `CuentaItem.nombreEnTicket` (lee `lecturas/carta/nombres-para-el-ticket.ts`); `PromoCuenta` guarda `promoCartaId` (reporte `consultas/reportes/margen-promociones.ts:35` lee `PromoCarta.titulo`).
- **Catálogo**: lee `Producto`, `DisponibilidadProducto`, `PrecioLocalProducto`, `OpcionDeGrupo`, `GrupoDeOpciones` (prefijoEnCarta), `ProductoAdmiteGrupo.seMuestraEnCarta`, capacidad `precio_local`; `filtros-de-productos.ts:90` lee `contenidosCarta`.
- **Ventas/Reportes**: `consultas/carta/ventas-por-seccion.ts` lee ventas.
- **Auditoría y permisos**: `escrituras-auditadas`, claves `carta_*`, `promo_*`, `core/permisos/auditoria.ts`.
- **Tiempo**: `core/tiempo/zona-horaria.ts` (día de calendario para vigencia y plato del día).
- **Plataforma/host**: `core/carta/host.ts`, `registro-tenants.ts`, `carta-empresa-unica.ts` (add-on apagado por defecto).

## 9. NO VERIFICADO
- Uso real en producción (solo lo dicho por el dueño); si hay promos con vigencia/días cargados en datos reales.
- Si algún CHECK impide `visibleEnCarta=true` con `seccionCartaId` nulo, y si hay trigger que garantice sucursal igual entre ítem y opción agrupada.
- Si el POS filtra realmente la vigencia con un test que cruce fechas; `test/carta/vigencia-de-promo-interruptor.test.tsx` prueba solo la pantalla.
- Cuántos normalizadores de nombre existen fuera de `core/carta`.
- Si `knip` (`analizar:muerto`) tolera `alcance.ts` por ser usado desde un test.
- Repetición (doble clic) de los comandos sin transacción (`actualizar-activa-*`, `guardar-seccion`, `guardar-tema`, `guardar-sucursal-publica`).
- El contenido de las pantallas `src/components/carta-publica` y `src/app/(carta-publica)` fue revisado solo por búsqueda de columnas, no línea a línea.

## 10. ¿El módulo esconde un módulo con identidad propia? (pedido del dueño, vía otra sesión; PROPUESTA, sin cambios)
**Tamaño medido** (carpetas del alcance + `src/app/(carta-publica)`): 15 modelos con 131 campos escalares (los 14 pedidos + `DescuentoProductoSucursal`), 185 archivos `.ts/.tsx` y 18.586 líneas, 35 casos de uso, 13 pantallas/rutas (9 de administración, 4 públicas), 13 claves de permiso `carta_*`/`promo_*` (`core/permisos/acciones.ts:63-78,258`).
**Método y límite:** los subconjuntos se armaron por nombre de archivo (palabras clave, script de conteo de `import`; 96 de 185 archivos quedan en el «resto» = núcleo de carta). Los imports por la fachada `core/carta/public.ts` cuentan como del resto; las cifras son orden de magnitud, no exactas.

| Candidato (nombre propuesto) | Tablas y archivos | Cohesión (números) | Qué lo ata hoy | Veredicto (PROPUESTA) |
|---|---|---|---|---|
| **Promociones y combos** | `PromoCarta`, `PromoCartaSucursal`, `PromoCartaCupo`, `EntradaDeCupo`, `OpcionDeEntradaDeCupo`, `EntradaDelDiaDeCupo` (+ `PromoCuenta` del POS). 36 archivos / 3.487 líneas: `core/carta/{promo-sucursal,cupos-de-promo,piso-de-promo,vigencia-de-promo,menu-del-dia}.ts`, `persistencia/carta/{promos,combos}.ts`, 13 casos de uso, pantalla `parametrizacion/promociones` | 64 imports internos contra 23 hacia el resto de carta y 10 desde él. Fuera del módulo lo usan 9 archivos de POS (`core/pos/{promo-combo,armar-promo-estado,…}`, `lecturas/pos/*`, `armar-promo.tsx`) y el reporte `margen-promociones`. Permisos propios: `carta_promo_definir/activar/precio_local`, `promo_menu_del_dia` con `modulo: "promociones"` | `SeccionCarta` (cupo tipo SECCION y `PromoCarta.seccionCartaId`), la lectura de «elegibles» de la carta (`selector-carta`), el nombre único en la carta (`choque-de-nombre`), `copiar-carta` | **Es módulo propio.** Ya lo es para permisos y habilitación (`core/modulos/catalogo.ts:33`, `requiere: ["carta"]`); el código y la carpeta no lo reflejan, y su consumidor principal es el POS, no la carta. Actor y vocabulario propios (dueño arma combos; mozo los vende). Podría probarse solo con una sección y un producto de entrada. |
| **Publicación y portal** | `SucursalPublica`, `PortalCartaEmpresa`. 39 archivos / 3.800 líneas: `components/carta-publica/*`, `lecturas/carta/publica.ts`, `registro-publico`, `core/carta/{host,registro-tenants,robots-sitemap,metadatos,carta-empresa-unica}.ts`, rutas `(carta-publica)` | 37 internos contra 35 hacia el resto y 23 desde él; solo 2 importadores fuera del módulo. Actor distinto (cliente anónimo, sin sesión) y reglas propias (slug, host, caché por empresa, sitemap) | Consume el menú armado por la carta (`armar-menu`, `lecturas/carta/menu`) y el tema | **No concluyente.** Tiene identidad de actores y reglas, pero depende de todo lo demás para mostrar algo y no tiene permiso ni habilitación propios (`carta_portal`, `modulo: "carta"`). Lo que sí podría separarse como infraestructura es host/tenants/sitemap; el resto es la «vista pública» de carta. Sin decisión del dueño sobre venderlo aparte, queda dentro. |
| **Tema visual** | `TemaCartaSucursal` (1 tabla). 13 archivos / 1.482 líneas: `core/carta/{tema,estilo,color-css,css-valores,escala}.ts`, `editor-tema.tsx`, `campo-color.tsx`, pantalla `carta/tema` | 13 internos contra 13 hacia el resto y 14 desde él; 0 importadores fuera del módulo | Lo lee `lecturas/carta/publica.ts:101-106` y se edita desde la pantalla de apariencia | **Es parte de este módulo** (sub-función de la presentación pública): una sola tabla, un permiso `carta_tema`, sin actores propios. |
| **Núcleo de carta** (lo que queda) | `SeccionCarta`, `ContenidoCartaProducto`, `GeneroCarta`, `ItemAgrupadoCarta`, `OpcionItemAgrupadoCarta` (+ `DescuentoProductoSucursal`); ~96 archivos | Es el centro al que apuntan los otros tres | Catálogo (`Producto`, disponibilidad, precio local) | Se queda como módulo «carta». Ítems agrupados y géneros (0 y 2 sin productos en producción) son candidatos de **poda**, no de módulo. |

**Resumen:** el único candidato claro es **Promociones y combos**: ya está separado donde importa (permisos y habilitación) y todavía mezclado en la carpeta de carta, con el POS como cliente principal. Antes de moverlo hay que decidir (PENDIENTE, dueño) si se vende y se habilita aparte de la carta; hoy el catálogo de módulos dice que sí. NO VERIFICADO: que el reparto por nombre de archivo no deje afuera archivos de promo con otro nombre (p. ej. dentro de `consultas/carta/admin.ts` y `lecturas/carta/menu.ts`, que leen promos pero son del núcleo).
