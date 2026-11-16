# Anexo: forma de los datos como Pedernal — tablas con DELETE, «¿qué pasa si…?», oráculo y niveles 6 a 10 (borrador)

Anexo de `docs/diseno-datos-paridad-pedernal-2026-11-16.md`. Solo documento.

## A. Modelos que conservan DELETE (Motor2 `903c0f6d`)

Cálculo: los 114 modelos de `prisma/schema.prisma` menos los 53 que alguna migración recorta con `REVOKE ALL … FROM motor2_app`. Los 61 restantes conservan el `GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES` de `scripts/operaciones/crear-rol-motor2-app.sql`, salvo recortes por columna que esta lectura no ve (NO VERIFICADO contra una base viva; un modelo puede estar recortado por una migración que usa otra forma de `REVOKE`):

`Accion, Account, CapacidadSucursal, CategoriaProducto, Cliente, ContenidoCartaProducto, ConteoFisico, CotizacionDolar, Cuenta, CuentaItem, DescuentoProductoSucursal, DestinoConsumo, DisponibilidadProducto, EjemplarTicket, Empresa, FrecuenciaConteoProducto, GeneroCarta, Grupo, IndicePrecio, Insumo, ItemAgrupadoCarta, MargenObjetivo, Mesa, MotivoMerma, MovimientoStock, OpcionItemAgrupadoCarta, Operacion, PagoConsignante, PermisoRol, PortalCartaEmpresa, PrecioLocalProducto, Presentacion, Producto, PromoCarta, PromoCartaCupo, PromoCartaSucursal, PromoCuenta, Proveedor, ProveedorPorProducto, RecetaIngrediente, RecetaPaso, RecetaPasoIngrediente, RecetaSucursal, RecetaVersion, RendimientoLocalIngrediente, Rol, Seccion, SeccionCarta, SeccionHabitualProducto, Session, StockMinimoProducto, Sucursal, SucursalPublica, SustitutoRecetaIngrediente, TemaCartaSucursal, TraspasoSucursal, Unidad, User, UsuarioEmpresa, UsuarioSucursal, VerificationToken`

De esos, el código tiene borrado real en 13 lugares (documento principal §2.3). Los otros ~48 no se borran desde el código: el `REVOKE DELETE` de E-4(1) no rompe nada que se use hoy (a confirmar con una búsqueda de `.delete(`/`deleteMany(` y SQL crudo en cada etapa).

## B. Tabla «¿qué pasa si…?» por comando

Comandos: **C1** alta con id de la aplicación · **C2** guardar un texto · **C3** intento de borrar · **C4** derivar la fecha de negocio · **C5** convertir una columna vieja · **C6** alta de empresa con zona. Estado de cada respuesta: PROPUESTA (salvo lo ya construido, marcado).

| Dimensión | C1 alta con id de la app | C2 guardar un texto | C3 intento de borrar | C4 fecha de negocio | C5 convertir columna | C6 empresa con zona |
|---|---|---|---|---|---|---|
| Repetición (doble clic) | mismo id y mismo contenido → devuelve la fila existente; no duplica (ya construido en `Parte`: clave única por empresa + `payloadHash`) | mismo texto → mismo resultado (canónico NFC, espacios colapsados); no cambia nada | la segunda vez da el mismo rechazo | misma entrada → misma salida (función pura, sin reloj) | la migración revisa si ya se aplicó y se detiene (patrón de las migraciones actuales: `RAISE EXCEPTION` si ya existe) | un alta con la misma clave no crea otra empresa |
| Concurrencia (dos a la vez) | `INSERT … ON CONFLICT` sobre la clave única: uno gana, el otro recibe la fila del ganador | dos ediciones del mismo nombre: gana la última con control de versión (`WHERE version = ?`); sin `version` hoy → E-5 | los dos rechazados | n/a (solo lectura) | `ALTER … TYPE` toma bloqueo exclusivo: se hace sin tráfico y con `lock_timeout` (la práctica ya documentada en `docs/deploy-con-migraciones.md`) | restricción única por clave de alta |
| Tiempo (corte de día, cambio de zona) | `creadoEn` lo fija la base (`now()`), no la app | n/a | n/a | un instante a las 03:00 con corte 04:00 pertenece al día anterior; con corte 00:00, al mismo día (Pedernal igual; Motor2 hoy no tiene corte: el resultado de la caja difiere hasta que lo construya el frente 1) | `AT TIME ZONE 'UTC'` conserva el instante solo si se guardó en UTC (NO VERIFICADO por columna) | zona IANA validada; Argentina sin horario de verano, pero la fórmula es general |
| Incertidumbre (no sé si llegó) | el cliente reintenta con la misma clave y no duplica | el cliente puede reenviar; idempotente | si no sé si se borró, no hay borrado que dudar (nunca se borra) | n/a | si no sé si se aplicó, `verificacion-previa.sql` y `_prisma_migrations` lo dicen | n/a |
| Reintento automático | seguro por la clave única | seguro (sin efectos laterales) | seguro | seguro | no hay reintento automático: lo corre el dueño a mano | seguro |
| Error parcial | alta + auditoría en una transacción (regla vigente de atomicidad): o ambas o ninguna | validar antes de abrir la transacción; nada a medias | n/a | n/a | `psql -1 -v ON_ERROR_STOP=1`: una sola transacción; si falla, no queda nada (el `down.sql` además existe) | alta de empresa y de su primer gerente en una transacción |
| Datos faltantes | sin clave de alta → rechazo explícito (en las tablas con clave obligatoria); en las viejas con clave opcional, sigue el «rollout gradual» | vacío → «Falta el nombre» según la pantalla; `null` en una ficha opcional → «sin dato» | n/a | instante inválido o fuera de 0001–9999 → error con código, nunca un día inventado (Pedernal: `INSTANTE_INVALIDO`) | filas con `NULL` en la columna: se conservan `NULL` | zona vacía → rechazo; no se asume Buenos Aires en silencio salvo decisión del dueño (pregunta 3) |
| Cambio de permisos | quien ya no tiene permiso queda rechazado por el servidor aunque reintente con la misma clave | idem | el rol de la app no tiene DELETE: el rechazo sale de la base aunque el código falle | n/a | solo el dueño de la base corre migraciones | solo la plataforma crea empresas (consola) |

## C. Oráculo de combinaciones (diseño; Fase 2 lo implementa)

Regla del 2026-10-28: cada módulo declara las dimensiones cuyas combinaciones cambian dinero, permisos, visibilidad o stock.

- **Dimensiones de este frente que cambian resultado:** (1) ficha de texto (PRODUCTO, ELECCION, NOMBRE_DE_COCINA, RAZON_SOCIAL) × (2) con o sin signos de catálogo × (3) clase de carácter (latino, tilde, ñ, dígito, signo base, signo de catálogo, emoji, control, bidi, cirílico, `<`, `_`) × (4) posición (inicio, medio, fin) × (5) largo (límite −1, límite, límite +1). Ya existe `test/core/oraculo-texto-de-catalogo.ts` con su guardián `texto-de-catalogo-declarado`; no se rehace.
- **Dimensiones nuevas que declara este frente:** (a) forma de tabla nueva = {tipo de id, tipo de instante, privilegio DELETE, versión, función de texto}; el test recorre las migraciones posteriores al corte y compara con una tabla escrita aparte (el oráculo es la tabla del documento principal §4 E-0). (b) corte de jornada × instante: lo declara y prueba el frente 1; este frente exige que exista.
- **Guardián de dimensión nueva:** falla si una migración nueva agrega una columna de texto o de instante, o un `GRANT … DELETE`, sin figurar en la tabla de declaraciones o en la lista corta de excepciones con motivo.
- Sin librerías nuevas: se usa lo ya instalado (`fast-check` figura en `package.json`).

## D. Niveles 6 a 10 (BORRADOR, no se diseñan ni migran tablas hasta que el dueño confirme 1 a 5)

- **6 Historia y persistencia:** E-2 crea funciones (sin tablas nuevas). E-4 a E-6 son columnas y privilegios de tablas existentes. Ninguna tabla «a ciegas».
- **7 Atomicidad y concurrencia:** cada migración en una transacción (`psql -1`), `lock_timeout` en E-6, `down.sql` con las mismas reglas que las ya escritas (se detiene si hay datos que se perderían).
- **8 Acceso e interfaces:** ninguna pantalla nueva. El único cambio visible es el rechazo de nombres con caracteres fuera de lista (mensaje genérico ya aprobado) y, en E-4(2), cómo se quita lo que antes se borraba (pregunta 2).
- **9 Consultas y experiencia:** nada nuevo; lo desactivado no aparece en listas por defecto (a diseñar con el frente dueño de cada pantalla).
- **10 Pruebas, migración y operación:** `verificacion-previa.sql` de solo lectura (cuántas filas violarían cada regla) antes de E-3 y E-6; ensayo en rama de Neon; autorización expresa por base.

## E. Límites de este anexo

No se corrió ninguna base ni el gate. Los conteos son de texto sobre migraciones y esquema. La lista de §A es un cálculo, no una consulta a `information_schema`.
