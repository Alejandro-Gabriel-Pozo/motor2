# Carta — «ANTES» con datos reales (etapa 1)

Pantallas REALES del sistema (main `a0ca384`) sobre una copia local descartable de los datos reales de la empresa (rama copia de Neon del 2026-11-11 23:59 UTC, solo lectura; producción no se tocó). Capturas a 375×844 (`-m`, celular) y 1366×768 (`-d`, escritorio; la captura de escritorio de páginas largas se toma a la altura completa de la página). Sin datos personales ni credenciales: el usuario de las capturas es uno de PRUEBA (`ensayo-admin@local.test`, rol admin) creado en la base local.

## Cómo se armó (para auditar)
- Datos leídos de la rama copia con `SELECT` solamente y cargados en un Postgres local (roles y migraciones como en el CI). Exportado: Empresa (nombre/slug), Sucursal, Unidad, CategoriaProducto, Seccion y Mesa (solo Huinganco las tiene), SucursalPublica, Producto (72), SeccionCarta (14), GrupoDeOpciones (47), OpcionDeGrupo (126), VersionDeOpcion (127), ProductoAdmiteGrupo (53), ProductoAdmiteOpcion (144), ContenidoCartaProducto, DisponibilidadProducto, PrecioLocalProducto (4), PromoCarta/Cupo/Sucursal («Menú ejecutivo»). Los ids se renumeraron (`prod_N`, etc.): las URLs locales no coinciden con las de producción.
- **SUPUESTO 1:** ContenidoCartaProducto y Disponibilidad se cargaron SOLO de Las Ovejas (71) y Huinganco (50). Las otras sucursales no se cargaron (las consultas Q1 a Q5 sí se corrieron sobre la rama copia entera).
- **SUPUESTO 2:** no se exportó el tema visual de la carta pública (colores, logos, fotos: son URLs externas). La carta pública sale con el tema por defecto; el contenido (nombres y precios) es el real.
- **SUPUESTO 3:** en producción ningún plato tiene receta (0 recetas). Con eso el POS no deja confirmar el pedido («… no descuenta ningún insumo: cargale el consumo a la opción… o armá la receta»; se ve en `f3`). Para poder hacer las ventas de ensayo se cargó en la base LOCAL una receta de reventa (1 insumo «Insumo de ensayo N (reventa)») a BIFE-, PV-MILANESAS y Café. No cambia nada de la carta ni de los precios; sí explica el aviso de stock negativo del cierre.
- **SUPUESTO 4:** Las Ovejas no tiene mesas cargadas en producción, así que el POS y la venta de ensayo se hicieron en Huinganco (Mesa 01).
- Venta de ensayo en la copia local (Huinganco, Mesa 01, 2 comensales): 1 Bife con chimichurri (corte «Bife de chorizo» oculto en la carta, guarnición «Papas fritas»), 1 Milanesa (proteína «Carne»), 1 Café mediano cortado. Se envió a cocina y se cerró la cuenta. La comanda y el ticket se capturaron del documento imprimible real (`window.print` anulado y medio «print» emulado).

## Qué muestra cada captura
| Captura | Qué es | Sucursal |
|---|---|---|
| `a-carta-hoy-*` | Carta › Hoy. «71 de 71 que se muestran» (Ovejas); la lista «Platos de la carta sin nombre de carta» **NO aparece** (0 pendientes: todos los platos directos visibles ya tienen nombre de carta) | Ovejas / Huinganco |
| `b-carta-visibilidad-*` | Carta › Visibilidad | Ovejas / Huinganco |
| `c-secciones-*` | `/carta/parametrizacion/secciones` completa | Ovejas / Huinganco |
| `c2-secciones-sandwich-abierto-ovejas-*` | La misma pantalla con «Minutas › Sandwich» abierto: acá vive el interruptor «Mostrar el nombre del producto arriba» + «Nombre en la carta» | Ovejas |
| `d-en-la-carta-{te,milanesas,wok}-ovejas-*` | Catálogo › producto › En la carta de «Variedad de tés», «PV-MILANESAS» y «Wok» | Ovejas |
| `e-opciones-{milanesas,bife,wok}-ovejas-*` | Catálogo › producto › Opciones y precio de «PV-MILANESAS», «BIFE-» y «Wok» | Ovejas |
| `f1-pos-seccion-platos-principales-huinganco-*` | POS, sección «Platos principales»: cada opción sale como un botón («Bife a criolla $ 30.000 · Opciones»…) | Huinganco |
| `f2*-pos-dialogo-opciones-{bife,milanesa,cafe}-*` | POS, diálogo de opciones. En el bife se ve el grupo oculto en la carta («Proteína del bife»: Nalga / Bife de chorizo) | Huinganco |
| `f3-pos-por-agregar-huinganco-*` | «Por agregar»: se nombra con el nombre INTERNO («BIFE- · Bife de chorizo · Bife con chimichurri · Papas fritas») y con el aviso de receta | Huinganco |
| `f4-pos-sin-enviar-huinganco-*` | «Sin enviar · 3» (nombres de carta: «Bife con chimichurri / bife de chorizo · papas fritas»…) | Huinganco |
| `g-comanda-impresa-huinganco`, `g-ticket-impreso-huinganco` | Comanda (cocina) y ticket del cliente, como se imprimen | Huinganco |
| `h-carta-publica-{sucursal}-laminaNN-*` | Carta pública (`/carta-publica/hoteles-del-neuquen/<sucursal>`): portada (00), índice (01), Entrada (02), Platos principales (03), Clásicos (04), Vinos (10) | Ovejas / Huinganco |

## Lo que se ve en el «antes» (observado)
- Comanda: «1 × Bife con chimichurri / bife de chorizo · papas fritas», «1 × Milanesa / carne», «1 × Café mediano café cortado». El corte oculto en la carta SÍ sale en la comanda.
- Ticket del cliente: «1 × Bife con chimichurri / papas fritas» (el corte oculto NO sale), «1 × Milanesa» (la proteína oculta NO sale), «1 × Café mediano café cortado». Total $ 54.100,00.
- Carta pública (Clásicos, Ovejas): «Milanesas» como título con «Milanesa $ 20.000» y «Milanesa napolitana $ 25.000»; «Wok» con «De verduras con pollo / con carne $ 19.000» (el prefijo «De» cargado). El corte/proteína oculto no aparece.

## Resultados de las consultas (rama copia, solo lectura, TODAS las sucursales)
- **Q1 – bases con contenido visible en alguna carta:** 26 productos BASE_CONFIGURABLE (27 en el catálogo: «Menú infantil» no tiene contenido de carta). Cada uno con su grupo MEDIDA y [opciones activas]: BIFE-[2], Bodega Agua de Fuego[1], Bodega Aicardi[1], Bodega Huellas del Limay[4], Bodega Mabellini Wines[4], Bodega Schroeder[5], Brownie[1] (solo Ovejas), Bruschetta[1] (solo Ovejas), CHIVO-DEL-NORTE[3], Empanada de carne[1] (solo Ovejas), Hamburguesa completa[2], Limonada[1] (solo Ovejas), Lomo[1] (solo Ovejas), Medialunas[2] (solo Ovejas), PV-CANELONES[1], PV-EMPANADA[1], PV-ENSALADA-FRUTAS[2], PV-MILANESAS[2], PV-PECHUGA[1], PV-SORRENTINOS[4], Pizza[6], Plato tallarines[1] (solo Ovejas), Sandwich[3], Tostados[2], Waffles[2], Wok[2]. Total de opciones activas en esos grupos MEDIDA: 56. Las bases visibles en Las Ovejas son 26 y en Huinganco 19.
- **Q2 – grupos ocultos** (`ProductoAdmiteGrupo` activo con `seMuestraEnCarta` = false): 4, todos INCLUIDA: BIFE-/«Proteína del bife», PV-MILANESAS/«Proteina Milanesa», Sandwich/«Proteina del Sandwich», Menú infantil/«Guarnición infantil».
- **Q3 – prefijos cargados** (`prefijoEnCarta` no nulo): 3: «Tipo de sandwich» = «De» (activo), «Wok preparación» = «De» (activo), «Tipo de tostada» = «con» (VARIANTE, INACTIVO).
- **Q4 – bases con «nombre arriba» y sin `nombreEnCarta`:** 8 productos (Tostados, Sandwich, Bodega Schroeder, Bodega Huellas del Limay, Bodega Mabellini Wines, Bodega Agua de Fuego, Bodega Aicardi, Waffles) × 5 sucursales con carta = 40 filas. Respuesta a «¿el cliente vería el nombre interno?»: con «arriba» y sin nombre de carta la carta pública usa el NOMBRE DEL PRODUCTO como título (se ve en `h-carta-publica-*` y en el texto de abajo: «Sandwich», «Tostados», «Waffles», «Bodega Schroeder», «Bodega Huellas del Limay», «Bodega Mabellini Wines», «Bodega Agua de Fuego», «Bodega Aicardi»). En estos 8 el nombre del producto ya es un nombre comercial legible (no un código tipo «PV-MILANESAS»), así que hoy el cliente no ve ningún código; sí lo vería en bases como PV-MILANESAS o BIFE- si se les activara «arriba» sin nombre de carta (en Ovejas PV-MILANESAS tiene «Milanesas»).
- **Q5:** `ItemAgrupadoCarta` = 0, `OpcionItemAgrupadoCarta` = 0, `GeneroCarta` = 10 (2 por sucursal: «Agua saborizada» y «Agua»), contenidos con `generoCartaId` = 0 (los géneros existen pero ningún plato los usa).

## Mediciones de «cargar o cambiar un plato HOY»
Conteos de elementos visibles en cada pantalla (escritorio, con los desplegables abiertos), medidos con el navegador sobre las pantallas reales; «pendiente» = veces que aparece la palabra en la pantalla.
| Pantalla | Campos de texto/número | Listas | Casillas | Opciones (radio) | Botones | «pendiente» en pantalla |
|---|---|---|---|---|---|---|
| En la carta — Variedad de tés (directo) | 3 | 2 | 2 | 0 | 2 | 1 |
| En la carta — PV-MILANESAS (base) | 3 | 2 | 2 | 2 | 2 | 0 |
| En la carta — Wok (base) | 3 | 2 | 2 | 2 | 2 | 1 |
| Opciones y precio — PV-MILANESAS | 6 | 0 | 5 | 2 | 12 | 8 |
| Opciones y precio — BIFE- | 9 | 0 | 9 | 2 | 18 | 14 |
| Opciones y precio — Wok | 3 | 0 | 2 | 2 | 7 | 5 |
| Datos del producto — PV-MILANESAS | 3 | 2 | 1 | 2 | 2 | 0 |
| Carta › Hoy / Visibilidad | 1 (búsqueda) | 1 (sucursal) | 0 | 0 | 30 / 46 | 0 |
- **SUPUESTO:** no se cuentan clics de un recorrido completo; el recorrido de cambiar el nombre de carta de un plato existente es: abrir el producto (desde el listado) → pestaña «En la carta» → editar «Nombre en la carta» → «Guardar» (4 pasos en la misma pantalla).
- Cantidad de productos/grupos/opciones: 72 productos (45 DIRECTO, 27 BASE_CONFIGURABLE); 47 grupos (44 activos: 29 MEDIDA, 12 INCLUIDA, 6 VARIANTE sobre el total); 126 opciones (122 activas); 53 vínculos producto-grupo (50 activos); 144 vínculos producto-opción (133 activos). Ejemplos: BIFE- tiene 3 grupos y 7 opciones; PV-MILANESAS 2 grupos y 4 opciones; Café 2 y 7; Variedad de tés 1 y 2; Wok 1 y 2.
- Entradas de la lista de pendientes («Platos de la carta sin nombre de carta»): **0** en Las Ovejas y **0** en Huinganco (la lista no se dibuja).
- Texto de la carta pública, renglón por renglón (nombre — precio), sección por sección. Las Ovejas: 73 renglones con precio; Huinganco: 53.

### Carta pública — Las Ovejas
```
Entrada
Escabeches — $ 8.000
Acompañado con pan casero
TIPOS DE ESCABECHE · ELEGÍS 1
escabeche de pollo · escabeche de chivo
Tabla de picada la fragua — $ 35.000
Comen dos - Degustación de escabeches, fiambres y quesos
Bruschetta con hummus y verduras salteadas — $ 4.000
Porción de papas fritas — $ 13.000
Empanada de carne con criolla — $ 4.000
Platos principales
Bife a criolla — $ 30.000
Incluye 1 guarnición · ver opciones ↓
Bife con chimichurri — $ 30.000
Incluye 1 guarnición · ver opciones ↓
Chivo del norte Neuquino — $ 34.000
Incluye 1 guarnición · ver opciones ↓
Estofado de chivo — $ 23.000
Incluye 1 guarnición · ver opciones ↓
Chivo al disco — $ 40.000
Incluye 1 guarnición · ver opciones ↓
Pechuga grille con salsa de mostaza y miel — $ 20.000
Incluye 1 guarnición · ver opciones ↓
Trucha — $ 53.000
PREPARACIÓN TRUCHA · ELEGÍS 1
con crema de limón · al roquefort · a la manteca negra
Lomo con salsa de hongos — $ 38.000
GUARNICIÓN · ELEGÍS 1
pure de papa · ensalada · papas fritas
Con los platos que incluyen guarnición
Qué lleva cada opción ▾
Clásicos
Milanesas
Milanesa	$ 20.000
Milanesa napolitana	$ 25.000
Wok
De verduras con pollo	$ 19.000
De verduras con carne	$ 19.000
Guiso de lentejas — $ 23.000
Pastas caseras
Sorrentinos de jamón y queso — $ 24.000
Sorrentinos de Chivo — $ 26.000
Sorrentinos de calabaza — $ 24.000
Sorrentinos de trucha — $ 25.000
Canelones de verdura — $ 21.000
Tallarines al huevo — $ 20.000
Pizzas
Pizza muzzarella — $ 18.000
Pizza fugazzeta — $ 22.000
Pizza napolitana — $ 22.000
Pizza especial — $ 26.000
Pizza de verduras asadas — $ 20.000
Pizza bomba — $ 29.000
Minutas
Ensalada de estación — $ 10.000
Empanada de carne (1/2 docena) — $ 16.000
Sandwich
De milanesa	$ 28.000
De bondiola	$ 28.000
De vegetales y queso	$ 24.000
Hamburguesa completa — $ 26.000
Hamburguesa de lentejas — $ 24.000
Bebidas sin alcohol
Agua 1500 cc — $ 5.000
Agua 500 cc — $ 4.000
Agua con gas 1500 cc — $ 6.000
Agua con gas 500 cc — $ 4.000
Agua saborizada 1500 cc — $ 7.000
Agua saborizada 500 cc — $ 5.000
Gaseosa 1500 cc — $ 9.000
Gaseosa 500 cc — $ 5.000
Jugo Fresli — $ 6.000
SABORES JUGO FRESLI · ELEGÍS 1
frutos rojos · limón con jengibre y menta · arándanos · limón con matcha
Bebidas con alcohol
Andes Botella — $ 10.000
Andes lata 473 cc — $ 5.000
Cerveza Corona 330 cc — $ 8.000
Cerveza Corona 710 cc — $ 11.000
Cerveza Kawin 1 litro — $ 13.000
Cerveza Patagonia — $ 14.000
Vinos
Bodega del fin del mundo
Vino tinto Malbec La Poderosa 700 cc	$ 15.000
Vino tinto Postales Malbec	$ 12.000
Vino tinto Ventus Malbec 750 CC	$ 12.000
Vino tinto Newen reservado Malbec 750 CC	$ 14.000
Vino tinto FIN	$ 68.000
Vino tinto Organic Vineyard Malbec	$ 29.000
Vino tinto Organic Vineyard Pinot Noir	$ 29.000
Vinto blanco Postales Roble Chardonnay	$ 13.000
Bodega Schroeder
Vino tinto Saurus Estate Malbec 750 CC	$ 28.000
Vino Saurus Select Pinot Noir 750 CC	$ 28.000
Vino Saurus Sauvignon Blanc 750 CC	$ 27.000
Vino blanco Saurus Estate Chardonnay 750 CC	$ 20.000
Espumante Deseado	$ 30.000
Bodega Huellas del Limay
Huellas del Limay Malbec	$ 41.000
Huellas del Limay Pinot Noir	$ 41.000
Zorro y Arena Malbec	$ 19.000
Zorro y Arena Merlot	$ 19.000
Bodega Mabellini Wines
Vino tinto Malbec	$ 66.000
Vino tinto Cabernet Franc	$ 66.000
Vino tinto Merlot	$ 66.000
Vino tinto Pinot-Pinot	$ 66.000
Bodega Agua de Fuego
Cutral Co Malbec	$ 14.000
Bodega Aicardi
Familia Aicardi	$ 29.000
Postres
Ensalada de frutas — $ 7.000
Ensalada de frutas con helado — $ 9.000
Helado 2 bochas — $ 7.000
Flan casero — $ 9.000
Triffle corona ★ — $ 9.000
Postre helado — $ 9.000
VARIANTES POSTRES HELADOS · ELEGÍS 1
bombón suizo · bombón escocés · almendrado
Brownie con crema americana y frutos rojos — $ 11.000
Tiramisú — $ 11.000
Cheseecake — $ 11.000
Cafetería
Café
Chico	Mediano	Grande
Café solo	$ 4.000	$ 4.100	$ 4.300
Café cortado	$ 4.000	$ 4.100	$ 4.300
Café lagrima	$ 4.000	$ 4.100	$ 4.300
Café c/ leche	$ 4.000	$ 4.100	$ 4.300
Pastelería del día — $ 8.000
PASTELERÍA DEL DÍA · ELEGÍS 1
pasta frola de batata · pasta frola de membrillo · muffin de frutos rojos · muffin de chips de chocolate · cuadraditos de frutos rojos · cuadraditos de limón · budín de limón y arándanos · tartitas de frutos rojos y crema · tartitas de durazno y crema
Tostadas — $ 3.000
TIPO DE TOSTADAS · ELEGÍS 1
con manteca · con dulce · con queso
Waffles
Con crema y frutos rojos	$ 10.000
Con helado y frutos rojos	$ 10.000
Tostados
De jamón y queso c/pan de miga	$ 9.000
De jamón y queso c/pan casero	$ 9.000
Capuccino — $ 8.000
Huevos revueltos — $ 5.000
Medialunas dulces (X3) — $ 8.000
Medialunas saladas (X3) — $ 8.000
Medialuna con jamón y queso — $ 4.000
Té — $ 3.000
VARIANTE TÉ · ELEGÍS 1
té negro · té saborizado
Submarino — $ 8.000
Tragos
Campari — $ 9.000
Fernet — $ 9.000
Gancia — $ 9.000
Gin tonic — $ 12.000
Whisky — $ 13.000
Vermut Zorro Colorado — $ 9.000
Aperol — $ 9.000
Jugos y licuados
Limonada en jarra — $ 12.000
Licuado de frutas — $ 9.000
SABORES DISPONIBLES · ELEGÍS 1
multifruta · durazno · banana
Copa saludable — $ 9.000
COPA SALUDABLE · ELEGÍS 1
con cereales y fruta · con granola y fruta
```

### Carta pública — Huinganco
```
Promociones
Tabla de picada la fragua — $ 35.000
Comen dos - Degustación de escabeches, fiambres y quesos
Entrada
Escabeches — $ 8.000
Acompañado con pan casero
TIPOS DE ESCABECHE · ELEGÍS 1
escabeche de pollo · escabeche de chivo
Platos principales
Bife a criolla — $ 30.000
Incluye 1 guarnición · ver opciones ↓
Bife con chimichurri — $ 30.000
Incluye 1 guarnición · ver opciones ↓
Chivo del norte Neuquino — $ 34.000
Incluye 1 guarnición · ver opciones ↓
Estofado de chivo — $ 23.000
Incluye 1 guarnición · ver opciones ↓
Chivo al disco — $ 40.000
Incluye 1 guarnición · ver opciones ↓
Pechuga grille con salsa de mostaza y miel — $ 20.000
Incluye 1 guarnición · ver opciones ↓
GUARNICIÓN · ELEGÍS 1
pure de papa · ensalada · papas fritas
Con los platos que incluyen guarnición
Qué lleva cada opción ▾
Clásicos
Milanesa — $ 20.000
Milanesa napolitana — $ 25.000
Wok
De verduras con pollo	$ 19.000
De verduras con carne	$ 19.000
Pastas caseras
Sorrentinos de jamón y queso — $ 24.000
Sorrentinos de Chivo — $ 26.000
Sorrentinos de calabaza — $ 24.000
Sorrentinos de trucha — $ 25.000
Canelones de verdura — $ 21.000
Pizzas
Pizza muzzarella — $ 18.000
Pizza fugazzeta — $ 22.000
Pizza napolitana — $ 22.000
Pizza especial — $ 26.000
Pizza de verduras asadas — $ 20.000
Pizza bomba — $ 29.000
Minutas
Ensalada de estación — $ 10.000
Porción de papas fritas — $ 13.000
Empanada de carne (1/2 docena) — $ 16.000
Sandwich
De milanesa	$ 28.000
De bondiola	$ 28.000
De vegetales y queso	$ 24.000
Hamburguesa completa — $ 26.000
Hamburguesa de lentejas — $ 24.000
Bebidas sin alcohol
Agua 1500 cc — $ 5.000
Agua 500 cc — $ 4.000
Agua con gas 1500 cc — $ 6.000
Agua con gas 500 cc — $ 4.000
Agua saborizada 1500 cc — $ 7.000
Agua saborizada 500 cc — $ 5.000
Gaseosa 1500 cc — $ 9.000
Gaseosa 500 cc — $ 5.000
Jugo Fresli — $ 6.000
SABORES JUGO FRESLI · ELEGÍS 1
frutos rojos · limón con jengibre y menta · arándanos · limón con matcha
Bebidas con alcohol
Andes Botella — $ 10.000
Andes lata 473 cc — $ 5.000
Cerveza Corona 330 cc — $ 8.000
Cerveza Corona 710 cc — $ 11.000
Cerveza Kawin 1 litro — $ 13.000
Cerveza Patagonia — $ 14.000
Vinos
Bodega del fin del mundo
Vino tinto Malbec La Poderosa 700 cc	$ 15.000
Vino tinto Postales Malbec	$ 12.000
Vino tinto Ventus Malbec 750 CC	$ 12.000
Vino tinto Newen reservado Malbec 750 CC	$ 14.000
Vino tinto FIN	$ 68.000
Vino tinto Organic Vineyard Malbec	$ 29.000
Vino tinto Organic Vineyard Pinot Noir	$ 29.000
Vinto blanco Postales Roble Chardonnay	$ 13.000
Bodega Schroeder
Vino tinto Saurus Estate Malbec 750 CC	$ 28.000
Vino Saurus Select Pinot Noir 750 CC	$ 28.000
Vino Saurus Sauvignon Blanc 750 CC	$ 27.000
Vino blanco Saurus Estate Chardonnay 750 CC	$ 20.000
Espumante Deseado	$ 30.000
Bodega Huellas del Limay
Huellas del Limay Malbec	$ 41.000
Huellas del Limay Pinot Noir	$ 41.000
Zorro y Arena Malbec	$ 19.000
Zorro y Arena Merlot	$ 19.000
Bodega Mabellini Wines
Vino tinto Malbec	$ 66.000
Vino tinto Cabernet Franc	$ 66.000
Vino tinto Merlot	$ 66.000
Vino tinto Pinot-Pinot	$ 66.000
Bodega Agua de Fuego
Cutral Co Malbec	$ 14.000
Bodega Aicardi
Familia Aicardi	$ 29.000
Postres
Ensalada de frutas — $ 7.000
Ensalada de frutas con helado — $ 9.000
Helado 2 bochas — $ 7.000
Flan casero — $ 9.000
Triffle corona ★ — $ 9.000
Cafetería
Café
Chico	Mediano	Grande
Café solo	$ 4.000	$ 4.100	$ 4.300
Café cortado	$ 4.000	$ 4.100	$ 4.300
Café lagrima	$ 4.000	$ 4.100	$ 4.300
Café c/ leche	$ 4.000	$ 4.100	$ 4.300
Pastelería del día — $ 8.000
PASTELERÍA DEL DÍA · ELEGÍS 1
pasta frola de batata · pasta frola de membrillo · muffin de frutos rojos · muffin de chips de chocolate · cuadraditos de frutos rojos · cuadraditos de limón · budín de limón y arándanos · tartitas de frutos rojos y crema · tartitas de durazno y crema
Tostadas — $ 3.000
TIPO DE TOSTADAS · ELEGÍS 1
con manteca · con dulce · con queso
Waffles
Con crema y frutos rojos	$ 10.000
Con helado y frutos rojos	$ 10.000
Tostados
De jamón y queso c/pan de miga	$ 9.000
De jamón y queso c/pan casero	$ 9.000
Tragos
Campari — $ 9.000
Fernet — $ 9.000
Gancia — $ 9.000
Gin tonic — $ 12.000
Whisky — $ 13.000
```

---

# ETAPA 2 — «DESPUÉS» (versión corregida: café y milanesa se quedan como producto con ejes; el bife, dos productos)

**Corrección (orquestador, 2026-11-12):** la primera versión de esta etapa cargó café y milanesa como un producto por línea (7 productos); eso era una lectura equivocada. Café es UN producto con dos ejes (tipo y tamaño, precio por tamaño) y la milanesa UN producto con un eje de preparación, tal como ya estaban en el «antes». Esta versión REEMPLAZA a la anterior (las capturas viejas se borraron de la rama). Mismas reglas: pantallas reales, datos reales, base local descartable, nada en producción, sin migraciones, nada en `main`.

## Cómo se armó
- Código: el del PR #233 (`fc6b583`, «Está bien así» y lista de pendientes apagados) levantado en local, SIN tocarlo, contra una copia NUEVA de la base del «antes» (`motor2_despues`). Las capturas `l-sin-PR-*` usan `main` (`a0ca384`) contra exactamente los mismos datos, para ver qué cambia el PR.
- Datos (SUPUESTO A: solo Huinganco y solo estos 3 platos; no se recargaron las bases de las otras sucursales):
  - **Café:** SIN CAMBIOS. Sigue siendo el producto «Café» (directo) con el grupo «Tamaño café» (chico $ 4.000 / mediano $ 4.100 / grande $ 4.300) y el grupo «variante café» (solo / cortado / lagrima / c/ leche, sin recargo): un botón «Café» en el POS, tabla 4 × 3 en la carta pública. Carga en el «después»: 0.
  - **Milanesa:** SIN CAMBIOS. Sigue siendo PV-MILANESAS (producto por opción) con el eje de preparación «Milanesa $ 20.000 / Milanesa napolitana $ 25.000» y la proteína oculta. Carga en el «después»: 0.
  - **Bife (PREGUNTA ABIERTA, ver abajo):** «Bife a criolla» y «Bife con chimichurri» (30.000 c/u) como DOS productos directos con nombre propio, cada uno con los grupos ya existentes «Proteína del bife» (corte, oculto en la carta) y «Guarnición». BIFE- (el producto base con eje de preparación) se sacó de la carta de Huinganco (SUPUESTO C) para no duplicar; sigue existiendo en el catálogo.
  - **SUPUESTO D:** igual que en el «antes», se cargó en la base LOCAL una receta de reventa a los 2 productos nuevos solo para poder vender (la receta real de cada uno quedó «Pendiente»).
- Venta de ensayo (Huinganco, Mesa 01, 2 comensales): 1 Bife con chimichurri (corte «Bife de chorizo», guarnición «Papas fritas»), 1 Milanesa («Carne»), 1 Café mediano («Café cortado»); enviada a cocina y cerrada (ticket N.º 2-A; el N.º 1-A es la venta del «antes»).

## (1) Cuánto hay que cargar — ANTES vs DESPUÉS
| | ANTES (hoy, los 3 platos de Huinganco) | DESPUÉS |
|---|---|---|
| Productos de venta en la carta | 3 (BIFE-, PV-MILANESAS, Café) | 4 (Bife a criolla, Bife con chimichurri, PV-MILANESAS, Café): **2 a cargar** (+1 neto) |
| Grupos vinculados a esos productos | 7 (bife 3, milanesa 2, café 2) | 8 (bife 2 + 2, milanesa 2, café 2) |
| Opciones vinculadas | 18 (bife 7, milanesa 4, café 7) | 21 (bife 5 + 5, milanesa 4, café 7) |
| Precios cargados | 7 | 7 (2 del bife, 2 de la milanesa, 3 del café) |
| «Nombre en la carta» a cargar | 0 en Huinganco | 0 |
| «Platos sin nombre de carta» | 0 | **Con el PR #233: 0.** Sin el PR, con estos datos: **2** (los dos bifes) y 2 «Está bien así» (`l-sin-PR-carta-hoy-*`) |
| Qué ve el cliente (carta pública, texto renglón por renglón) | — | IDÉNTICA salvo el ORDEN del bife con chimichurri (mi «Orden» 1 chocó con otro plato). Café sigue como tabla 4 × 3 y milanesa igual |
| Pantallas visitadas para cargar (medido) | no medido (ver nota) | **9** (4 por bife × 2 + 1 para sacar BIFE- de la carta) |
| Acciones medidas (clics / textos / listas / casillas / guardados) | no medido | **21 / 8 / 8 / 3 / 11** (por bife: 10 clics, 4 textos, 4 listas, 5 guardados y 1 casilla —la del corte oculto—; sacar BIFE-: 1 pantalla, 1 clic, 1 casilla, 1 guardado) |
- Recorrido de cada bife (medido): Catálogo › Productos › Nuevo (tipo, código, nombre, unidad) → «Qué se vende» (precio) → «Opciones y precio» (por cada grupo: «Agregar un grupo existente», elegir, «Agregar», «Guardar»; en el corte se destilda «Mostrar este grupo en la carta») → «En la carta» (se muestra, sección, orden, «Guardar contenido»).
- **Nota sobre el ANTES:** intenté medir el mismo recorrido para las bases y lo corté: el modo «Por opción» queda deshabilitado hasta que el producto tiene grupos cargados (otro orden de pantallas) y los precios se cargan fila por fila en cada grupo. Lo comparable con certeza son las cantidades de datos (productos, grupos, opciones, precios). Con café y milanesa sin cambios, el «después» solo suma la carga de los 2 bifes.

## (2) POS y carta pública
- **Familia:** no hace falta. Café sigue siendo UN botón («Café desde $ 4.000 · Opciones») con el cuadro de elección de tamaño y variante (`f2c-*`), y la milanesa sigue con su cuadro de preparación y proteína (`f2b-*`), igual que en el «antes». No se encendió género ni ítem agrupado (siguen apagados). Las únicas «líneas sueltas» nuevas son los 2 bifes.
- **Opciones que hoy se ocultan en el ticket:** siguen haciendo falta y el modelo no las reemplaza: el corte del bife (y la proteína de la milanesa) son grupos «incluidos sin costo» que la cocina necesita y el cliente no necesita ver. La comanda dice «bife de chorizo · papas fritas», «carne»; el ticket «papas fritas» y nada más; idéntico al «antes» (`g-comanda-impresa-*`, `g-ticket-impreso-*`). La casilla «Mostrar este grupo en la carta» destildada se repite en cada bife nuevo (2 casillas hoy: 1 en BIFE-).
- **Nombre en «Por agregar»:** el bife nuevo se nombra con su línea («Bife con chimichurri · Bife de chorizo · Papas fritas»); la milanesa sigue nombrándose con el interno («PV-MILANESAS · Carne · Milanesa», `f3-*`) porque es una base. Cambiarlo se puede renombrando el producto en «Qué se vende», pero eso lo cambia en el catálogo, no solo en la carta.
- El cuadro de opciones de la milanesa y del café muestra un atajo «Lo más pedido acá» (porque la base de datos ya tiene la venta de ensayo del «antes»); no es parte de la comparación.
- Carta pública (Huinganco): solo cambia el orden de «Bife con chimichurri» (aparece después de otros platos porque su «Orden» 1 chocó con el de otro plato); el café sigue como tabla.

## (3) Copiar receta / ficha técnica — qué hay hoy
- **Existe:** en la pantalla de la receta de un producto, «Receta de esta sucursal»: «Copiar la receta propia de otra sucursal» (el MISMO producto, de una sucursal a otra); la «Ficha técnica» (campo de la receta, «Sin ficha técnica cargada · Editar») y la «Ficha de cocina» imprimible (`/catalogo/recetas/<id>/ficha`). Ver `i-receta-*`.
- **No encontré** (búsqueda en pantallas y código por «copiar», «duplicar» y «clonar»): copiar la receta o la ficha de un producto a otro (Bife a criolla → Bife con chimichurri) ni duplicar un producto con sus grupos y su carta. Con 2 bifes hay 2 recetas y 2 fichas a mano en vez de 1 de BIFE-. En el «antes» el consumo se cargaba por opción en la Biblioteca de opciones (compartido entre productos: el grupo «Guarnición» lo usan 7 productos en el «antes» y 9 con los 2 nuevos, y la pantalla lo avisa); cada opción hoy dice «pendiente de completar» en «Qué consume cada opción».

## PREGUNTA ABIERTA — bife: ¿dos productos o un producto con eje de preparación?
En el «antes» BIFE- es UN producto con un eje de preparación (a criolla / con chimichurri, $ 30.000 cada una). En el «después» lo dejé como DOS productos con nombre propio (decisión del orquestador). Con un solo producto (eje de preparación) la carga del bife en el «después» sería 0 (ya está). Con dos: 2 productos, 8 pantallas, 20 clics, 2 recetas, 2 fichas y la casilla del corte oculto repetida. Lo que cambia para el dueño: el nombre en el POS («Bife con chimichurri · …» en vez de «BIFE- · …») y que desaparece el «nombre interno» BIFE-. Decide el dueño.

## (4) Lo que NO se pudo hacer sin código (para que decida el dueño)
1. **Copiar receta / ficha técnica de un producto a otro y duplicar un producto** (con sus grupos, precio y carta): no hay pantallas para eso. Pesa en el bife (2 productos casi iguales).
2. **Alta de varios productos parecidos de una vez:** no hay carga por planilla ni «crear otro igual»; cada bife son 4 pantallas.
3. **Ordenar sin chocar:** el «Orden» es un número a mano por producto; no hay «ponelo después de…» (el bife con chimichurri quedó mezclado con otros platos).
4. **Cambiar el nombre con que sale una base en «Por agregar» sin tocar el producto** (PV-MILANESAS): hoy depende del nombre del producto.
- No se pidió ni se hizo: encender género/ítems agrupados; recargar las otras sucursales ni otros platos (SUPUESTO A).

## Qué capturas hay (carpeta `capturas/despues/`)
`a-`, `b-`, `c-`: Carta › Hoy, Visibilidad y Secciones de Huinganco con el PR #233 · `d-en-la-carta-*` y `e-opciones-*` de «Bife a criolla», PV-MILANESAS y Café (estos dos, sin cambios) · `f1`..`f4`: POS · `g-*`: comanda y ticket impresos · `h-carta-publica-huinganco-laminaNN-*`: carta pública (00 portada, 01 índice, 04 Platos principales, 05 Clásicos, 13 Cafetería) · `i-receta-*`: pantalla de receta de «Bife a criolla» y de PV-MILANESAS · `l-sin-PR-*`: Carta › Hoy y ficha «En la carta» SIN el PR #233, con los datos del «después» (lista de 2 platos pendientes con «Está bien así»).
