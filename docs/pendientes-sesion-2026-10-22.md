# Pendientes al cierre de la Fase 6 (sesión del 2026-10-22)

Lo que queda abierto después de cerrar la Fase 6 de la ola «precio y carta» (PR #130). La Fase 7 (módulo por módulo) quedó para otro día.
Estado al cierre: rama `alegp/stoic-davinci-185dm4` en `7039be35`, CI completa en verde. Decisiones del dueño: `docs/decisiones-cerradas-ola-precio-y-carta-2026-10-19.md`; decisiones de diseño: ADR-035, ADR-037 y ADR-038.

## Alertas de CodeQL del PR #130 (revisadas el 2026-10-26)

13 alertas nuevas (9 altas y 4 medias según CodeQL), **ninguna de producción con riesgo real**:
- `src/core/reportes/cotizacion-dolar.ts:158` («Incomplete URL substring sanitization»): falso positivo. Es `error.startsWith("dolarapi.com")` sobre un texto de error interno para clasificarlo; no valida ninguna dirección ni recibe entrada de un usuario.
- 12 en archivos de tests: escapes de texto (`cerco-tipografia.test.ts`, `carta-publica-formas.test.tsx`, `contenido-del-producto.test.tsx`, `lectura-de-precio.test.tsx`), condiciones de carrera de archivos en los chequeos locales (`trinquete.ts`, `escrituras-auditadas.test.ts`), un número al azar en un spec de e2e (`usuarios-invitacion.spec.ts`) y cuatro `replace(" ", " ")` de espacios no cortantes (`admision-de-grupo`, `nueva-opcion-en-el-grupo`, `nuevo-grupo-en-el-producto`, `precio-de-la-sucursal`).
- Qué hacer: descartarlas en la pestaña de seguridad de GitHub como «falso positivo» o «solo en tests» (lo hace el dueño desde la interfaz), o limpiarlas en un cambio aparte. `trinquete.ts` es archivo del mecanismo: cambiarlo exige su aprobación DEC-03.
- El chequeo «CodeQL» del PR queda en rojo por esto; el requerido para fusionar es «Gate (requerido)», que está en verde.

## Menú del día / Plato del día / Menú (GO-3d) — rediseño del modelo
Planteo del dueño: el PLATO DEL DÍA es un producto con receta, temporal (fecha + sucursal), que probablemente NO está en la carta. El MENÚ es una oferta armada, también temporal: partes fijas, partes a elegir entre pocas opciones y partes de libre elección (bebida, postre o café). Hoy ambos usan el mismo mecanismo (promo con lugares) y eso limita:
- Soportado hoy (VERIFICADO en el código): plato del día fuera de la carta (candidatos = PV disponibles en la sucursal con receta y precio); varios platos el mismo día en un lugar «del día»; lugares de tipo SECCION (elegir cualquier producto de una sección de la carta), LISTA (entradas armadas a mano, con configuración fija posible) y DEL_DIA; falla cerrado si no hay plato cargado hoy; copia del día anterior; hasta 13 días de anticipación.
- NO soportado: que el plato del día o una opción elegida dentro de un menú tengan opciones obligatorias o a elegir (café por tamaño; milanesa de carne o de pollo; pizza; cualquier base «Por opción» de la Fase 4); un plato del día suelto sin armar una promo; precio propio por plato/día (el precio es el de la promo; hipótesis a confirmar).
- Propuesta de diseño (a validar con casos de cocina): plato del día = cosa simple y temporal con su precio y opciones si hace falta; menú = composición de partes fijas / a elegir / de libre elección (una de ellas puede ser el plato del día) y las partes pueden pedir opciones.
- Consecuencia para la Fase 7: DEC-24 mudó «Menú del día» a Promociones; con este planteo conviene mudar SOLO la entrada del menú y dejar el rediseño real para después.
- Código actual: `core/carta/menu-del-dia.ts`, `server/consultas/carta/menu-del-dia.ts`, `server/actions/carta/menu-del-dia.ts` y casos de uso, `core/pos/promo-combo.ts`, `server/lecturas/pos/entradas-de-promo-para-vender.ts`, pantalla `movimientos/menu-del-dia`, ADR-032 (D-1, D-5, D-6).
- Pregunta abierta de producto: ¿la carta pública debe MOSTRAR el plato del día (hoy no lo muestra; solo el salón)?

### Ampliación (2026-10-20): ¿se puede armar un menú del día que NO esté en la carta? (VERIFICADO en prisma/schema.prisma y server/lecturas/carta/componentes-de-promo.ts)
- Productos fuera de la carta en una promo: SÍ en lugares LISTA («un producto de venta aunque no esté en la carta», con configuración fija opcional) y DEL_DIA (cualquier PV disponible en la sucursal, con receta y precio, cargado por fecha). NO en lugares SECCION: toman solo productos con `visibleEnCarta = true` de una sección de la carta de la sucursal.
- Sección fija «invisible»: NO existe. `SeccionCarta` solo tiene `activa` (baja lógica). Usar una sección apagada para esconderla es un uso no previsto y no verificado (la consulta de cupos SECCION no revisa `SeccionCarta.activa`, pero la carta pública sí oculta sus productos): no recomendado.
- La PROMO en sí NO puede estar fuera de la carta: `PromoCarta.seccionCartaId` es obligatorio y mientras la promo esté activa en la sucursal se muestra al cliente en su sección con título, descripción y precio. No hay interruptor «solo para el salón». Los PLATOS sí pueden estar fuera de la carta; la promo, no.
- Dirección de rediseño: (1) interruptor «solo salón / no mostrar en la carta pública» en la promo (o un tipo de oferta de salón sin sección de carta); (2) plato del día como cosa simple y temporal (precio propio, opciones si hace falta); (3) partes de un menú con opciones propias; (4) buscador/filtro al elegir platos entre todos los productos (hoy se elige de la lista de productos de venta disponibles; no verifiqué si hay filtro).

### Decisión y concepto del dueño (2026-10-20, noche)
- DECISIÓN: OCULTAR el «Menú del día» a la vista (entrada de menú y la opción «lugar del día» al armar promos) hasta que el rediseño esté definido; reversible con un interruptor (como `PRECIOS_EDITABLES`). Se hace después de la tanda A de la Fase 5, como paso chico aparte; los goldens de menú se regeneran declarándolo.
- Producción (consulta de solo lectura del 2026-10-20): 2 promos (ambas activas), 0 lugares «del día», 0 lugares de lista, 0 platos del día cargados, 1 promo vendida → el menú del día NO se usa hoy; ocultarlo no rompe a nadie.
- CONCEPTO del dueño para el rediseño: flexibilidad total. Se puede elegir lo que se quiera de la carta o NO, tanto por SECCIÓN como por PLATOS sueltos. Operativamente: las personas van AGREGANDO opciones al menú del día (un conjunto/«pozo» de opciones) y, al tomar el pedido, el mozo elige entre todas esas opciones; NO hay que cargar una opción nueva todos los días. Sin la limitante de componer partes fijas ni de fijar un precio rígido (precio a definir: fijo del menú / por opción).
- Idea de diseño a evaluar (ingeniero): reutilizar el mecanismo «agotado hoy» (Opciones agotadas hoy) como control diario: todas las opciones del menú están disponibles por defecto y se apaga lo que hoy no hay, en vez de cargar el plato cada día.

### Precisiones del dueño (2026-10-20, noche, 2.ª parte)
- PRECIO del menú: FIJO, un solo precio (se podrá cambiar más adelante si hace falta; no se define precio por opción).
- Idea a nivel PRODUCTO (NO definida; se omite por ahora): poder marcar de forma VOLUNTARIA «este es el plato que hoy se sirve», lo que podría mostrar un pop-up en la carta pública («hoy tenemos este platillo», con foto del plato).
- CONJUNTO DE OPCIONES (lo más práctico, a juicio del dueño): poder AGREGAR UNA SECCIÓN y poder QUITAR de la sección ítems puntuales. HUECO ACTUAL DE PROMOCIONES (VERIFICADO: `componentes-de-promo.ts` toma TODOS los productos visibles de la sección, sin exclusiones; un lugar SECCION no admite sacar ítems): hoy «elegí una opción de la sección» no permite «bebidas sin alcohol»; el único rodeo es una LISTA armada a mano (estática) o crear una sección nueva en la carta.
- Diseño a evaluar: un lugar de la promo = FUENTES (secciones completas y/o productos sueltos, estén o no en la carta) MENOS EXCLUSIONES (ítems quitados de esa sección). Pregunta abierta: ¿un producto que se agrega después a la sección entra solo a la promo (dinámico, con la lista de exclusiones) o hay que sumarlo a mano? (Recomendación del ingeniero: entra solo, mostrando «N productos incluidos» y la lista de excluidos.)

### Principio decidido (2026-10-20, noche, 3.ª parte): lo nuevo NO entra solo (fail-closed)
- Respuesta del dueño a la pregunta «¿un producto nuevo de la sección entra solo a la promo?»: NO. Lo más seguro es que nazca EXCLUIDO; agregarlo es VOLUNTARIO (alguien lo suma a propósito). Razón: es más difícil que alguien se acuerde de quitar algo que entró solo que de agregar algo que faltó (ej.: una bebida con alcohol nueva no puede colarse en «bebidas sin alcohol»).
- Coherente con lo que el sistema ya hace: la carta es opt-in («fila ausente = no se muestra», `ContenidoCartaProducto`), la disponibilidad por sucursal también, y el menú del día falla cerrado; en el código, las listas cerradas (`PUBLICACION_CARTA`, `CLAVES_DE_LA_CARTA`) y los cercos con trinquete de la Fase 1 hacen que algo nuevo no declarado FALLE.
- Consecuencia de diseño: la pertenencia al conjunto es EXPLÍCITA (productos nombrados: ya existe `EntradaDeCupo`, que admite productos aunque no estén en la carta). «Agregar una sección» = FOTO del momento (se incorporan sus productos de hoy como miembros explícitos) y se pueden QUITAR ítems; los que se agreguen a la sección después NO entran hasta que alguien los sume. Sin exclusiones dinámicas ni «incluir todo lo futuro».
- Límite que sigue vigente: un producto con opciones obligatorias (café por tamaño, base «Por opción») no puede entrar tal cual a un lugar de la promo (el mozo no elige opciones dentro del combo, ADR-032 D-6); al «agregar una sección» esos productos deberían quedar señalados («pide tamaño: no puede entrar tal cual») o resolverse con configuración fija; pendiente de diseño.

### Misma regla para productos con opciones (2026-10-20, noche, 4.ª parte) — reemplaza el «límite» del principio anterior
- Al agregar una sección a la promo, un producto con opciones (café por tamaño y/o tipo) entra con TODAS sus opciones de ese momento (foto), no «queda señalado como que no entra».
- Después se puede EXCLUIR/INCLUIR a la medida de lo que define el precio: un tamaño; un tipo; o una celda (tamaño × tipo) cuando el precio depende de los dos ejes. Una opción o un tipo NUEVO agregado al producto después nace EXCLUIDO de la promo.
- Consecuencia de modelo (a diseñar en el rediseño del menú del día): el miembro de la promo ya no es solo «producto» sino «producto + conjunto de opciones/celdas permitidas» (extiende `EntradaDeCupo`); y el POS tiene que dejar ELEGIR dentro de lo permitido (hoy el mozo no elige opciones dentro del combo: ADR-032 D-6; eso cambia).
- Pregunta abierta de negocio: precio fijo único vs. celdas con recargo (café grande cuesta más en la carta): ¿la promo absorbe la diferencia o se excluye lo que tiene recargo? Decidir en el rediseño.

### Decisión (2026-10-20, noche, 5.ª parte): la promo puede valer menos que la suma (o que el costo)
- Cierra la pregunta abierta: la promo tiene precio fijo y ABSORBE cualquier diferencia con los precios sueltos (incluso vender a pérdida a propósito: «noche del café a $1, compenso con tortas»). Es decisión del comercio; el sistema NO bloquea ni exige justificar.
- No hace falta excluir opciones «con recargo» por ese motivo: si una opción está incluida, entra al precio fijo de la promo.
- A verificar en el rediseño (no asumido): cómo reparte hoy `promo-combo.ts` el precio de la promo entre los componentes para los informes de venta/margen por producto (que el stock se descuente de cada componente igual, y que el reporte muestre la promo con su descuento real, no precios sueltos inflados).
- Opcional, solo informativo y sin bloquear: mostrar en la pantalla de la promo «suma de precios sueltos: $X · promo: $Y» para que el dueño vea cuánto está regalando.

### Propuesta (2026-10-20, noche, 6.ª parte): Promoción y Menú del día = UN solo concepto
- Hoy el código ya los modela casi igual: `PromoCarta` (precio fijo, vigencia) + lugares (`PromoCartaCupo`: SECCION / LISTA / DEL_DIA). El «menú del día» es una promoción que tiene al menos un lugar DEL_DIA (se carga por fecha y sucursal, `EntradaDelDiaDeCupo`).
- Con las decisiones tomadas (precio fijo único, pertenencia explícita y fail-closed, opciones por celda permitida, la promo absorbe la diferencia) la ÚNICA diferencia real queda: el lugar «del día» (rotativo, se carga cada día, puede ser un plato con receta que no está en la carta) frente al lugar fijo (sección/lista).
- Diseño propuesto: una sola pantalla y un solo modelo «Promoción»; cada lugar es «fijo» (productos y opciones elegidos explícitamente) o «del día» (se carga por fecha). «Menú del día» = plantilla/atajo de promoción con un lugar del día + vigencia diaria. El «plato del día» (vender sí o sí algo con receta) es otra cosa y se resuelve aparte.
- A confirmar al arrancar el diseño: leer de nuevo el código real (puede haber diferencias que hoy no veo, p. ej. en POS, caja y reportes).

### Aclaración (2026-10-20, noche, 7.ª parte): lo «del día» se distingue sobre todo por el pop-up
- El dueño ve que lo que distingue de verdad a lo «del día/por fecha» frente a una promo fija es el POP-UP en la carta pública (ventana con foto de lo que hoy se sirve).
- Lectura propuesta: son dos cosas separables. (1) Datos: un lugar que se carga por fecha (se mantiene como tipo de lugar). (2) Presentación: «destacar en la carta con ventana emergente», una propiedad OPCIONAL (voluntaria, nace apagada) de la promoción o del plato del día; no es otro concepto. Sigue pendiente decidir si el pop-up es de la promo o del «plato del día» (que es otra cosa).

### Decisión (2026-10-20, noche, 8.ª parte): menú del día = promoción; «plato del día» = ventas no recurrentes con receta, fuera de la carta
- Confirmado: el pop-up es opción de ambos (promoción y plato del día), apagada por defecto.
- El menú del día ES una promoción (el dueño se había enredado separándolos). 
- Los productos que NO están en la carta pero necesitan receta y stock (ñoquis, tortas fritas: se venden «de vez en cuando») se venden bajo el concepto «del día»: es el nombre genérico de las ventas no recurrentes. 
- Propuesta de modelo: NO crear un tercer concepto. «Plato del día» = una promoción con UN solo lugar «del día» y su propio precio fijo (cargado por fecha y sucursal). Si además lleva bebida/postre, es el menú completo: misma estructura con más lugares.
- A verificar en el rediseño (no asumido): que el producto fuera de la carta (sin fila en `ContenidoCartaProducto`) se pueda vender por el POS solo en su fecha, descuente stock por receta y no aparezca en la carta pública salvo por el pop-up; y que el precio del plato del día salga de la promo (no del producto).

### Corrección de rumbo (2026-10-20, noche, 9.ª parte): SIN fecha obligatoria; es una promoción y punto
- El dueño no quiere cargar fechas (molesto). Flujo buscado en el salón: «vendo un menú del día» → elijo entre las opciones que tiene la promoción → se cobra al precio de la promo. Nada más.
- Se descarta como flujo normal la carga por fecha y sucursal con 13 días de anticipación (`EntradaDelDiaDeCupo`). Queda, a lo sumo, como vigencia desde/hasta OPCIONAL y apagada por defecto.
- Propuesta (a confirmar con el dueño): lo que rota (ñoquis hoy) se maneja con «Sumar para hoy» = un toque en la promo, el producto queda disponible hasta el corte del día (Argentina, UTC-3) y se apaga solo; nadie escribe fechas. Los miembros permanentes siguen la regla de inclusión voluntaria. Un olvido deja la promo con MENOS opciones, nunca con de más (fail-closed). Se puede quitar antes con otro toque. Reusa la lógica de «Carta › Hoy» (operario).

### Decisión (2026-10-20, noche, 10.ª parte): la promoción NO tiene vigencia desde/hasta, ni carga por fecha
- El dueño pide que la vigencia desde/hasta no exista. Anula lo «opcional» de la parte anterior. Consecuencia de migración (avisar antes, es destructivo): `PromoCarta` hoy tiene vigencia y existe `EntradaDelDiaDeCupo`; retirarlos es un cambio de modelo del rediseño, con respaldo y autorización expresa.
- «Sumar para hoy» no se entendió: se descarta salvo que el dueño lo pida. Base más simple: los lugares de la promo se agregan y se quitan a mano (producto, o producto con opciones); el que no está, no se vende. Para lo del momento («hoy no hay más ñoquis») se usa el «agotar» ya previsto en Carta › Hoy, no un mecanismo propio de la promo.

### Decisión (2026-10-20, noche, 11.ª parte): promoción = nombre + precio + lugares; sus platos pueden NO estar en la carta; se maneja con ACTIVAR/DESACTIVAR
- Dos usos de la misma promoción: (a) la clásica, con ítems/secciones de la carta; (b) la «especial» (ej.: «Promo 25 de Mayo») con platos que no existen en la carta (producto del catálogo con receta, sin fila en la carta). Se crea, se vende mientras está activa y se DESACTIVA. Sin fechas.
- Ya existe `PromoCarta.activa` (default true): el interruptor encender/apagar ya está en el modelo; lo único a retirar es la vigencia (`vigenteDesde/Hasta`, `diasDeSemana`) y la carga por día (`EntradaDelDiaDeCupo`), con respaldo y autorización expresa.
- Un plato que solo vive dentro de una promo: el producto existe en el catálogo (para receta y stock) pero no se publica en la carta; la promo es la que lo vende y le pone el precio.

### Principio de diseño (2026-10-20, noche, 12.ª parte): flexibilidad, no imponer cómo se opera el negocio
- El dueño corrige un sesgo mío: yo proponía fechas, vigencias y «sumar para hoy» (funciones que nadie pidió) por (1) heredar lo que ya existía en el código (ADR-032: vigencia, carga por día) sin cuestionarlo y (2) querer protegerlo de olvidos. Eso es decidir cómo opera su negocio. REGLA: la herramienta es flexible; el comercio se hace cargo de activar/desactivar/limpiar. No agregar automatismos ni funciones sin que el dueño las pida.
- Modelo final de promoción: nombre + precio + lugares; se agrega una sección entera (entran todos sus platos), se sacan de a uno los que no van; se activa/desactiva. Nada más.
- Pop-up: opción de la promoción (y del plato especial) para «promocionar la promoción»; también debe poder promocionar una promo de las de siempre, o mostrar UNA imagen que junte varias promociones. Flujo propuesto: ver respuesta; detalle por cerrar: qué pasa con dos pop-ups activos a la vez.

### Completa el modelo (2026-10-20, noche, 13.ª parte): tres formas de poner algo en una promoción
- Una promoción puede incorporar, a decisión del negocio (sin imponerle nada): (1) una SECCIÓN de la carta entera (entran todos sus platos; se sacan de a uno); (2) un PRODUCTO suelto de la carta; (3) un PRODUCTO QUE NO ESTÁ EN LA CARTA (existe en el catálogo con su receta y stock; se vende solo dentro de la promo).
- En los tres casos, un producto con variantes/tipos entra con todas sus opciones de ese momento; se excluye/incluye cada opción o celda; las opciones nuevas nacen excluidas (regla de la 4.ª parte).
- Estado del código hoy (a revisar al diseñar): `EntradaDeCupo` ya admite producto aunque no esté en la carta, con configuración fija opcional; falta el conjunto de opciones permitidas y la elección en el POS.

### Decisión (2026-10-20, noche, 14.ª parte): la promoción tiene visibilidad propia en la carta; el POS siempre la ve
- Supuesto confirmado: el negocio puede armar una promoción con un plato fuera de la carta (incluso uno que solo se venda por esa promo y se muestre en la carta).
- La promoción puede estar en la carta pública o NO (opción voluntaria, nace sin publicar, coherente con «fila ausente = no se muestra»). En el POS el mozo la ve siempre que esté activa. Ejemplos reales del dueño: menú ejecutivo para empresas, menús para agencias de viaje, menú del día de boca a boca: no los compra el cliente común y no van en la carta.
- Valor operativo: los platos que entran a ese menú están definidos de antemano; el mozo solo elige y ofrece, y se SACA COMO COMANDA (cocina) aunque haya varios clientes/grupos a la vez.
- Consecuencia de modelo: `PromoCarta.seccionCartaId` es hoy NOT NULL (la promo cuelga de una sección de la carta). El rediseño debe separar la promo de la carta (la sección pasa a ser solo una forma de publicarla).
- A verificar al diseñar: que la comanda de cocina de una promo saque cada componente elegido (y sus opciones), y varios grupos simultáneos en distintas cuentas/mesas. Posible extensión (NO decidida, solo si el dueño la pide): marcar para qué cliente/agencia es el menú.

## ORDEN DE TRABAJO (confirmado por el dueño, 2026-10-20 noche)
1. Terminar la ola actual: Fase 5 (en curso) → Fase 6 → Fase 7.
2. Si da el tiempo, los otros tres puntos de la lista que armé: (2) ocultar el Menú del día y seguir con el resto de las fases, (3) compras con reparto por sucursal (Etapa C de ADR-029), (4) rediseño de promociones/menú del día. Orden propuesto de más rápido a más largo: 2 → 4 → 3. Nota: ocultar el Menú del día (cambio chico, interruptor reversible) el dueño ya lo pidió para ahora, así que va dentro de esta ola.
3. Después, retomar cuestiones de producto: pop-up de promociones, imágenes de los platos, y versión de la carta en INGLÉS (nombre y descripción en inglés de productos, secciones y promociones).
- Extensión posible de promociones (solo anotada, hoy no necesaria): marcar para qué cliente/agencia es un menú.
- La compra con reparto por sucursal: el modelo ya existe (ADR-029, M3–M7); faltan los casos de uso y las pantallas (Etapa C). No se encontró prototipo en el repo; buscarlo (sesiones de diseño / documento «resultado esperado») antes de planificar.

## Para DESPUÉS de las fases (decisión del dueño, 2026-10-21): contingencias de la carta
- Salida de emergencia por producto: opción «forzar esta forma» (lista / tabla / columnas), APAGADA por defecto, que anula la forma derivada. Ya estaba prevista como columna opcional aparte `ContenidoCartaProducto.presentacionBase`. REQUIERE AUTORIZACIÓN EXPRESA + respaldo + ensayo (migración). Hacerla solo cuando aparezca un caso real, o junto con el resto del producto.
- Diccionario editable de las palabras fijas de la carta («Sin cargo», el separador «·», «Precios vigentes al», rótulos) junto con la carta en INGLÉS.
- Principio del dueño: lo configurable por pantalla es mejor que lo fijo en el código («qué pasa si y cómo lo resuelvo»); toda decisión fija debe tener su salida de contingencia pensada.
- Pendiente menor de código: dos comentarios de `src/core/carta/escala.ts` (líneas ≈ 6 y 31) todavía citan «Elegí:» / «Incluidas:».

## Para DESPUÉS de las fases: auditoría de «fallos abiertos» en todo el sistema (pedido del dueño, 2026-10-21)
- Principio: toda regla se declara UNA sola vez en un lugar central y un guardián impide declararla suelta o dejarla afuera («algo no puede existir sin declarar sus usos»); lo no declarado FALLA (fail-closed), nunca queda con un valor permisivo por defecto. El bug de los separadores negros de la carta (2026-10-21) fue un fallo ABIERTO: el color por defecto del borde es el del texto.
- Ya aplica (verificar en la auditoría): RLS por empresa/sucursal con clasificación obligatoria de tablas (`clasificacion-de-tablas`, `alcance-de-sucursal`), matriz de denegación por defecto (`test/aislamiento/denegacion-por-defecto.test.ts`), `paginas-con-guarda`, `ACCIONES`/permisos como lista cerrada, `PUBLICACION_CARTA` y `CLAVES_DE_LA_CARTA` (la carta solo publica lo declarado), cercos con trinquete de la Fase 1, `frontera-aresultadoaccion`, `ui-sin-negocio`, «fila ausente = no se muestra».
- A auditar (hipótesis, sin verificar): server actions o consultas nuevas sin permiso/filtro de empresa que hoy dependan de que alguien se acuerde; valores por defecto permisivos en el modelo (columnas con DEFAULT que habilitan algo), reglas duplicadas en varios archivos sin guardián, rutas/consultas sin `empresaId` explícito, validaciones que «dejan pasar» lo desconocido, enums/listas abiertas que aceptan valores nuevos sin decidir.
- Método: agente Explore + auditor independiente (como en las otras auditorías), informe con cada hallazgo y su guardián propuesto; NO se arregla todo junto: se prioriza por riesgo (dinero, permisos, aislamiento primero).

## PLAN: «contratos compartidos declarados» (agente Plan Opus, 2026-10-21; texto completo en /tmp/claude-0/-home-user/3304bfd3-087d-5166-897c-306c0c1d1da2/tasks/aff020637ec37ed93.output)
- Motor común en tests (`test/arquitectura/contratos/`): manifiesto TS tipado (sin campos opcionales: fuente con marca `@contrato <id>`, alcance, señales, declaración, definición, consumidores, excepciones con motivo, modo duro|trinquete), adaptadores clases-tsx/css/ts, reporte `archivo:línea:columna [contrato · tipo]`, trinquete reutilizado (+ extensión `detallar`). Un solo recorrido; dentro de `npm test`; sin dependencias nuevas.
- Pilotos: separador-de-carta (portar C13), redondeo-de-dinero (hallazgos: reportes/compras/page.tsx:118 y cotizacion-dolar.ts:169 usan Math.round(x*100)/100 en vez de redondearMoneda), formato-de-moneda (MONEDA idéntico duplicado en server/actions/pos/cuenta-comun.ts:26).
- Pasos: 1 motor, 2 extensión trinquete, 3 portar C13 (borrar el test local), 4 redondeo (trinquete), 5 corregir 2 sitios de dinero [DECISIÓN D5: cambia solo empates de medio centavo], 6 formato-de-moneda [D3], 7 deduplicar MONEDA, 8 ADR-036 + receta de 5 pasos, 9 tokens-visuales dentro de la Fase 6.1, 10 pantalla-y-su-clave antes de la Fase 7.
- Recomendación del plan: hacerlo ANTES del Bloque 1 de la Fase 6 (mínimo viable: pasos 1 a 3); los pilotos de dinero (4 a 7) pueden ir en paralelo. Sin migraciones.
- Lo que ya falla cerrado y no se toca: aislamiento/RLS, permisos (ACCIONES), publicación de la carta, zona horaria, idempotencia.

### Requisito reforzado por el dueño (2026-10-21): FAIL-CLOSED estricto en los contratos compartidos
- Si un archivo USA un contrato y NO declara de cuál depende, el control FALLA y el CI se pone rojo. «No alcanza con que nadie se haya quejado»: cada uso tiene que tener su respuesta escrita.
- Ajustes al plan de contratos: (1) NADA de líneas de base que solo cuentan: la deuda existente se escribe uso por uso (archivo + fragmento + motivo ≥20 caracteres + hasta cuándo/con qué paso se resuelve), la lista solo puede bajar y una entrada sin uso real o sin motivo también falla; (2) un contrato sin consumidores declarados, o una fuente sin marca/ancla, falla; (3) el test de contratos DEBE correr en el CI sin poder saltearse (ver D2: encadenarlo también en `npm run arquitectura` para el job estático) y el dueño debe marcar ese check como obligatorio en GitHub (configuración del repositorio: la hace el dueño); (4) la «declaración» tiene que ser verificable por máquina dentro del propio archivo consumidor (importar el ancla en TS, la clase compañera en CSS/clases).

### Requisito de GOBERNANZA de los contratos (2026-10-21, texto completo del dueño; ver el prompt del agente Plan a7c8f95dac2387683)
- Cada módulo declara sus contratos (o que no depende de ninguno); el guardián compara declaración vs usos reales (omisiones y declaraciones falsas/obsoletas); descubre módulos nuevos solo y FALLA ante rutas sin clasificar o exclusiones implícitas; excepciones con motivo, responsable, aprobación, alcance mínimo y vencimiento (si vence, falla); protección del propio mecanismo (revisión independiente de cambios a la regla/guardián/CI, checks obligatorios, prueba de que detecta intentos de desactivarlo o debilitarlo); evidencia por corrida (qué corrió y qué cubrió); compatibilidad/versión de contratos y de migraciones; verificación del resultado real (navegador/integración/runtime según el contrato); límites declarados cuando algo no se puede automatizar. 12 capas y matriz «¿qué pasa si…?».
- Anti-sobrediseño (del dueño): NO un framework universal de entrada; primero el mecanismo común de gobernanza + contratos concretos donde hay riesgo real; sin burocracia por constante o archivo (granularidad = módulo/carpeta).
- Lo externo al repo (protección de rama, checks requeridos, code owners, rulesets) lo configura el dueño en GitHub: ningún test puede garantizarlo; el plan lo redacta paso a paso.

## Comprobantes, búsqueda y filtros (dueño, 2026-10-21)
- Ticket de venta ya tiene número. Compras entran con factura: N.º de factura (`Operacion.nroFactura`, ya existe) y punto de venta del proveedor (`PuntoDeVentaDeProveedor`, `FacturaProveedor` ya existen). Ventas con comprobante propio (tipo, punto de venta, número, CAE…): HOY NO EXISTE; es parte de «facturación» (modelo de datos nuevo; requiere decisión del dueño antes de diseñarlo).
- Búsqueda y filtros transversales (patrón común `FiltrosDeLista`, en la URL, servidor, con permisos y sucursal): Productos (tipo en palabras, activo, disponible acá, por opción/directo, «le falta algo»), Compras (proveedor, sucursal, fechas, producto, **N.º de factura y punto de venta**), Tickets (fecha, mesa, medio de pago, estado, importe, **N.º de ticket**), Stock, Usuarios. Si algún filtro exige un índice nuevo = migración, se consulta aparte. Empieza en el bloque 3 de la Fase 6 (Productos como primera lista).

## Agregados el 2026-10-22 (tarde)

- **Consola de plataforma sin primitivas (inventario del carril C, 6.32a):** es otra app Next, sin Tailwind y con paleta propia (`--fondo`, `--texto`...) y selectores globales sin capa. Migrarla pide un lote de infraestructura previo (Tailwind + `@source` a `src/ui` + tokens compartidos o hoja extraída, con test de sincronía) y luego 3 a 4 commits (11 botones, 18 inputs, ~18 avisos, 10 pantallas). Mantener ids `#email #codigo #factor` y `[role=alert]` (spec `consola-plataforma`). Decidir después de la Fase 6; `plataforma:build` obligatorio. Entradas de plataforma siguen en los cercos (por diseño, hasta entonces).
- **Arnés de la matriz de mutaciones:** declarar `app` → `tokens-visuales` rompe 2 mutaciones (la de «el área deja de declarar tokens» no encuentra hallazgo en `src/app/page.tsx`). Por eso `src/app/page.tsx` queda con su entrada `escala` (1). Para el cierre de gobernanza (Etapa 2).
- **Alias `.pos-shell` (15) sin consumidores en `globals.css`:** no se pudieron borrar con su deuda DEC-03 porque dos tests de gobernanza buscan un contrato real con deuda (`aprobaciones.test.ts` «verde: cambiar SOLO la deuda», `evidencia.test.ts` «pasado el vencimiento»). Decidir si pasan a un contrato sintético. Vence 2026-12-20.
- **Migración completa de la pantalla de receta (733 líneas) y de `opciones/[grupoId]/*` a `components` (31 controles):** pendiente de tamaño L, anotado por el carril B.
- **Variante táctil de `Selector`** (44 px en escritorio), anotado en 6.28.
- **Mantenimiento de carta / ordenar-secciones:** quedan como el prototipo aprobado (`carta-mant.module.css`); decisión de producto para el checklist del dueño.
- **Flakes por tiempo (5 s por defecto de Vitest) en tests pesados:** guardianes que recorren todo el código (`acceso-solo-por-el-guard`, `rol-nivel-solo-desde-cambiar-nivel`, `sin-modo-oscuro`, `transaccion-serializable-sin-tope-propio`, `contratos.test.ts`) cortan por tiempo con la máquina saturada; pasan solos. Para el programa de CI: regla «test > 3 s sin timeout propio» + timeout propio en estos.
- **Concurrencia de ventas:** el tope por cantidad de intentos (ahora 8) puede agotarse con muchas ventas simultáneas en una sucursal; alternativas de fondo: presupuesto por tiempo o lock por sucursal (`pg_advisory_xact_lock`) antes de leer. Medir antes de decidir.
- **Decisiones menores tomadas sin el dueño (para el checklist):** «activo» de producto = disponibilidad por sucursal; «+ Opción» / «+ Extra» exigen las mismas dos claves que «+ Nuevo grupo»; avisos de advertencia de la receta pasan de role=alert a role=status; criterio de tipografía del POS (≤12 px → text-xs, 12,5–14 → text-sm, 15–16 → text-base, nada se achica).
- **Firmas:** varios commits de integración del 2026-10-22 (hasta 8b16384d aprox.) llevan `Co-Authored-By` y `Claude-Session`, contra la regla del dueño (sin firmas); los siguientes no. Decidir si se reescriben antes del PR (squash).

## Tipos de dato declarados y bloqueantes (pedido del dueño, 2026-10-22) — lote 6.33 propuesto
Origen: comparación ZuluHub vs motor2 (relevamiento Explore). ZuluHub NO tiene la regla «todo campo declara su tipo» (su CampoImporte aún no se usa en pantallas; sus controles bloquean conversiones y `number` para dinero en el núcleo). Es una regla nueva para ambos.
Pasos (sin cambiar el modelo de datos), DESPUÉS del micro-paso 2c del carril B (toca CampoNumero):
1. `CampoNumero.tipo` obligatorio (`importe | cantidad | entero | porcentaje`; la cantidad con los decimales de la unidad).
2. Cercos trinquete (solo bajan): `type="number"` (base 25 líneas / 14 archivos), `Number(formData.get…)` (14 / 4 archivos: recetas page, receta-de-la-sucursal, fila-simple, fila-compartida), `new Date(texto)` fuera de `core/tiempo` (reportes/compras, reportes/consignacion, stock/reclasificar, core/reportes/historial-vistas), `inputMode` numérico en input/Campo crudos.
3. El servidor valida con el mismo analizador por tipo en cada acción que recibe dinero/cantidad/fecha (`numeroDelCampo`).
4. Tests de propiedades para fecha y zona (hoy solo existen para el número).
5. Test `sin-reloj-ni-azar` para las primitivas nuevas.
NO portar ahora: `Importe` como bigint con moneda en todo el sistema (hoy el dinero viaja como `number` y se redondea con decimal.js en los puntos clave; la base lo guarda exacto). Es una refactorización grande: decisión del dueño para después del PR.
