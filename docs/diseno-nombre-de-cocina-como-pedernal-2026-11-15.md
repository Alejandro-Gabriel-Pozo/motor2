# Diseño — Nombre de cocina (el nombre con el que sale el producto en la comanda), igual a Pedernal — 2026-11-15

Estado: **diseño en papel.** Sin código, sin migración, sin tocar ninguna base. Nada se desplegó ni se escribió en producción.
Método: escalera de diseño de 10 niveles (AGENTS.md, «Diseño de módulos y features nuevos»). Los niveles 1 a 5 están completos con su estado; el nivel 6 es **solo un esquema PROPUESTO: no se migra hasta confirmar los niveles 1 a 5.**
Estados: **CONFIRMADA** (dicha por el dueño, con fecha y cita) · **PROPUESTA** (de este diseño; el dueño la corrige) · **PENDIENTE** (falta decidir) · **NO VERIFICADA** (no pude comprobarlo).
Marcas de evidencia: **(V)** verificado leyendo el código de `main` de Motor2 (`b36de06`, 2026-11-15) · **(P)** verificado en el código de Pedernal (repositorio hermano, `243432a`) · **(D)** sale de la documentación de Pedernal (`b179a9f`) o de los planes de paridad, sin verificar el código.

## 0. Resumen

- **Pedido:** que la comanda diga el nombre con el que la cocina conoce el producto («bife de chorizo», «nalga») y, si el producto no lo tiene, el nombre comercial; y que Motor2 sea igual a Pedernal en todo.
- **En Motor2 hoy:** **no existe** ni el campo ni el concepto (V: ninguna aparición en `src` ni en `prisma`; solo se lo nombra en documentos). La comanda usa el nombre **interno vivo** del producto (`producto.nombre`), sin congelar: renombrar un producto cambia retroactivamente lo que dicen las reimpresiones y los avisos de anulación.
- **Qué entra:** un campo opcional «Nombre de cocina» en el producto de venta; congelarlo en la línea al venderla (como ya se hace con el nombre del ticket); la comanda, la reimpresión y el aviso de anulación lo usan; sin él, el nombre interno como hoy.
- **Etapas:** E1 columna en el producto + campo + comanda (lectura viva, la más barata) → E2 congelar en la línea (lo recomendado, en el mismo envío de trabajo) → E3 inmutabilidad en la base.
- **Pregunta de negocio abierta (1):** si el nombre de cocina también va en cada opción y componente (Q1).
- **Dividir la cuenta (0052):** no comparte tablas; ver §7.

## 1. Propósito y alcance (nivel 1)

**Necesidad y quién la pidió (escrita):**

| Qué | Fuente | Estado |
|---|---|---|
| El producto tiene dos vistas: la del cliente (carta y ticket) y la de cocina (comanda). «Carta y ticket pueden compartir, es lo que ve el cliente. Comanda, kitchen order ticket, es lo que debe ver el personal de cocina para la servucción» | Dueño, 2026-11-08, chat de Pedernal (D: decisión 71 del catálogo de Pedernal) | CONFIRMADA (para Pedernal) |
| La comanda lleva el nombre de cocina «porque así se sabe qué stock descuento»; si algo no tiene nombre de cocina, usa el comercial | Dueño, 2026-11-08 (D: decisión 72) | CONFIRMADA (para Pedernal) |
| DEC-0420: en la comanda gana el nombre de cocina y, si no hay, el comercial. Pasa de supuesto a decisión del dueño | Dueño, 2026-11-14, «las recomendaciones las apruebo, ya las vi» (D: fila (d) del 14/11) | CONFIRMADA (para Pedernal) |
| La migración 0055 (nombre de cocina en la línea de cuenta, inmutable): SQL aprobado; el dueño la aplica él mismo por el CI | Dueño, 2026-11-14 (D: fila «Pendientes del dueño resueltos», punto 6) | CONFIRMADA (para Pedernal) |
| Motor2 debe ser igual a Pedernal en todo | Dueño, 2026-11-13: «Necesitamos ser iguales en todo… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» | CONFIRMADA |
| Avanzar en Motor2 «con lo que decidió Pedernal si cambió algo para vos, de lo que ya tiene construido Motor2» | Dueño, 2026-11-15, chat con el orquestador | CONFIRMADA (en dirección) |
| Que *esta etapa concreta* (columna en producto y en línea de Motor2) está ratificada | El plan de paridad la marca «aditiva» (R7) con la decisión DEC-0420 como respaldo, pero no encontré una cita específica de migración para Motor2 | **PENDIENTE** — por eso no se migra |

**Entra:** el campo del producto; el congelado en la línea; el uso en la comanda, en su reimpresión y en el aviso de anulación; el campo en el alta y en la ficha del producto; «Duplicar producto» lo copia.
**No entra (nada de esto fue pedido para Motor2):** estación de cocina (parrilla, freidora, barra: en la documentación de Pedernal es una propuesta de extra, no una decisión); nombre de cocina por sucursal; nombre de cocina en la opción o el componente (Q1); la «ficha de cocina» de una receta (es otra cosa: la receta para cocinar); idiomas o nombres cortos; cambiar el nombre en la carta o en el ticket.

## 2. Inventario: lo que ya existe en Motor2 con otro nombre (verificado en el código)

Motor2 tiene hoy **tres** nombres para lo que se ve de un producto, y ninguno es el de cocina:

| Nombre | Dónde (V) | Quién lo ve |
|---|---|---|
| **Interno** | `Producto.nombre` (`prisma/schema.prisma`, regla de texto de Pedernal E1: 1 a 120, exige una letra, único sin distinguir mayúsculas) | La pantalla del mozo y **la comanda** (`src/core/pos/cuenta.ts:339-345` lo arma vivo desde `i.producto.nombre`; `src/core/pos/comanda.ts:94,99`: `nombreDeLinea ?? productoNombre`) |
| **En la carta** (por sucursal) | `ContenidoCartaProducto.nombreEnCarta` (`schema.prisma:1897`; diseño `docs/diseno-nombre-en-carta-2026-11-04.md`) | El cliente en la carta; el selector del mozo de esa sucursal |
| **En el ticket** (congelado) | `CuentaItem.nombreEnTicket` (`schema.prisma:2431`; migración `20261105100000_ticket_nombre_y_oculto_en_carta`) | El ticket del cliente; el espejo de anulación lo repite del original (`src/server/persistencia/pos/escribir-espejo-de-item.ts:43`) |

Otros hechos del código:

| Qué | Dónde (V) | Consecuencia |
|---|---|---|
| La comanda **no** congela nada: se arma desde los ítems vivos y no hay tabla de «envío» con foto de lo enviado (el envío es `CuentaItem.numeroEnvio`) | `armarComandas` (`src/core/pos/comanda.ts:89`); `ticket-cocina.tsx` imprime desde el navegador | Pedernal guarda una foto al enviar (D: «la copia sale idéntica»). En Motor2, congelar el nombre en la línea cubre el caso del nombre; **no** crea una tabla de envíos |
| El «nombre de la línea» es **uno solo** para lo que se muestra y para lo que se comanda («lo que se MUESTRA y se comanda») | `src/core/pos/cuenta.ts:258`; `nombreDeLineaConfigurada` (`src/core/opciones/nombre-de-la-linea.ts`) arma «producto + partes» y, en un producto base, gana el nombre de la medida | Para que la cocina vea otro nombre que el mozo hace falta un **campo propio de la comanda**, no reemplazar el existente |
| «Duplicar producto» tiene un oráculo de columnas: una columna nueva de `Producto` sin declarar pone el test en rojo | `src/core/catalogo/duplicar-producto.ts` (`COLUMNAS_DEL_DUPLICADO`), `test/catalogo/duplicar-producto-columnas.test.ts` | La columna nueva se declara ahí (propuesta: `SE_COPIA`) |
| Las reglas de texto viven en una tabla de fichas y su oráculo; un dato nuevo se declara en las dos y un guardián lo exige | `src/core/datos/fichas-de-texto.ts`, `test/core/oraculo-texto-de-catalogo.ts` | El nombre de cocina se declara como ficha nueva |
| Anular parte de un ítem enviado crea un **espejo** que repite lo congelado del original | `escribir-espejo-de-item.ts` | El nombre de cocina se repite igual que `nombreEnTicket` |
| Comanda de un producto con opciones: «Café solo chico», con lo incluido abajo y los adicionales con «+» | `ticket-cocina.tsx`, `comanda.ts` | El nombre de cocina reemplaza **solo la parte «producto»** de ese nombre |

En Pedernal (P): `producto.nombre_de_cocina` existe desde la migración 0025 (nulo o texto de catálogo de 1 a 80, solo en productos que se venden); el envío a cocina guarda el nombre por renglón; la migración 0055 agrega `linea_cuenta.nombre_de_cocina`, congelado al agregar la línea, y la hace inmutable. La regla es `nombreParaLaCocina(linea) = nombreDeCocina ?? descripcion` (`src/modulos/comandas/dominio/envio.ts:14`).

## 3. Actores y contexto (nivel 2)

| Actor | Qué hace | Permiso (V) | Estado |
|---|---|---|---|
| Quien administra el catálogo (gerente, administrador) | Carga, cambia o borra el nombre de cocina de un producto de venta | `producto_editar` (alta: `alta_producto`) | PROPUESTA (Pedernal: `productos.editar`) |
| Quien toma el pedido (mozo) | Agrega la línea; **el nombre se congela solo, no lo elige** | `pos_tomar_pedido` | V |
| Cocina | Lee la comanda | ver comandas | V (existe) |
| Quien anula | Anula parte de un ítem ya enviado; el aviso lleva el nombre con el que salió | permiso de anular ítem enviado vigente | V |

Contexto: el nombre es **del producto y de la empresa** (igual en todas las sucursales), no por sucursal (así es en Pedernal; la carta sí es por sucursal y es otro nombre). Los datos de una empresa no se mezclan con los de otra: todo acceso filtra por empresa en el servidor.

## 4. Casos de uso (nivel 3)

| CU | Caso | Estado |
|---|---|---|
| CU1 | Cargar el nombre de cocina de un producto de venta («Medallón de bife de chorizo») | PROPUESTA |
| CU2 | Cambiar o borrar el nombre de cocina (vacío = «sin nombre de cocina»: la comanda usa el interno) | PROPUESTA |
| CU3 | Agregar una línea: se congela el nombre de cocina que el producto tenía en ese momento | PROPUESTA |
| CU4 | Enviar a cocina: la comanda dice el nombre de cocina de cada línea (sin precios) | PROPUESTA |
| CU5 | Reimprimir la comanda: sale idéntica aunque después se haya renombrado el producto | PROPUESTA |
| CU6 | Anular parte de un ítem enviado: el aviso de anulación y el resto vigente llevan el nombre con el que salió | PROPUESTA |
| CU7 | Duplicar un producto: el duplicado nace con el mismo nombre de cocina | PROPUESTA |
| CU8 | Renombrar el producto (nombre interno): las líneas ya vendidas no cambian | PROPUESTA |

## 5. Conceptos y ciclo de vida (nivel 4)

- **Nombre de cocina:** texto opcional del producto de venta; cómo ve la cocina el producto. Vacío = no tiene.
- **Nombre para la cocina de una línea:** `nombre de cocina congelado ?? nombre interno del producto`, **resuelto al agregar la línea** (hay un solo punto de decisión). Una línea anterior a esta función no tiene nombre congelado (nulo): la comanda usa el interno, como hasta hoy.
- **Ciclo de vida del campo en el producto:** nace vacío → se carga → se cambia → se borra. Cambiarlo **no** afecta lo ya vendido.
- **Ciclo de la línea:** el nombre se escribe una sola vez, al agregarla; después **no cambia**. Un espejo de anulación lo repite del original.

```
producto.nombreDeCocina (editable) ──al agregar la línea──► línea.nombreDeCocina (congelado, inmutable)
                                                                  │
                                         comanda / reimpresión / aviso de anulación
                                         (si es nulo: nombre interno del producto)
```

## 6. Invariantes y políticas (nivel 5)

| # | Invariante | Estado y fuente |
|---|---|---|
| I1 | El nombre de cocina es nulo o un texto de 1 a 80, de una línea, con solo lo permitido (letras, números, puntuación y símbolos; sin saltos de línea ni caracteres invisibles) y con al menos una letra | CONFIRMADA en Pedernal (`nombre-de-cocina.ts`); el tope de 80 está marcado **supuesto sin cita del dueño** en Pedernal (DEC-0043) → PROPUESTA para Motor2 |
| I2 | Solo un producto que se vende (tipo PV) puede tener nombre de cocina | CONFIRMADA en Pedernal (INV-PROD-3: lo que no se vende no lleva nombre de cocina); PROPUESTA para Motor2 |
| I3 | En la comanda gana el nombre de cocina; si no hay, el nombre comercial | **CONFIRMADA** (dueño, 2026-11-08 y 2026-11-14: DEC-0420) |
| I4 | «Nombre comercial» en Motor2 = el **nombre interno** del producto (el que la comanda usa hoy), **no** el nombre de la carta de la sucursal | PROPUESTA (supuesto declarado, §14 T1) |
| I5 | El nombre se **congela** al agregar la línea y no cambia después (ni al renombrar el producto, ni al cambiar o borrar su nombre de cocina) | CONFIRMADA en Pedernal (0055); PROPUESTA para Motor2 |
| I6 | El nombre de cocina no entra al precio, al stock, a la receta, al ticket del cliente ni a los reportes: es solo presentación en el papel de cocina | PROPUESTA; coincide con Pedernal («solo lo lee la comanda») |
| I7 | La comanda no lleva precios | V (existe) |
| I8 | La copia (reimpresión) sale idéntica a la original | CONFIRMADA (dueño, decisiones 87 y 120 de Pedernal) |
| I9 | Todo nace cerrado: ningún producto tiene nombre de cocina hasta que alguien lo carga; no se rellena desde ningún otro dato | CONFIRMADA (regla del dueño, 2026-11-11) |
| I10 | Validación en el servidor de quién pide y si tiene permiso; el nombre se toma del producto de la empresa de la sesión, nunca de lo que manda el navegador | V (patrón vigente) |
| I11 | Trazabilidad: cargar, cambiar o borrar el nombre de cocina de un producto deja registro (quién, cuándo, antes y después) | V (`registrarCambioAuditado`, patrón del producto) |
| I12 | Lo anulado no se borra: el espejo de anulación lleva el nombre del original | V para `nombreEnTicket`; PROPUESTA para éste |

## 7. Dividir la cuenta (0052): ¿comparte tablas con esta pieza?

- **Pedernal (P):** la 0055 se llama «salón: copias y nombre de cocina» porque trae **dos** correcciones en un mismo archivo, ya que ambas vuelven a reemplazar las mismas funciones de la base (`copias_cuadran`, de la 0038, y `linea_validar_cambio`): D2 (que una copia —al trasladar o dividir— conserve la clasificación congelada de la línea) y D3 (el nombre de cocina). **Comparte con «dividir» las funciones de las líneas copiadas, no las tablas.** La 0052 (tope de partes) toca `division_de_cuenta` y `parte_de_division`; el nombre de cocina no.
- **Efecto de dividir sobre esta pieza:** una línea copiada por una división debe conservar el nombre de cocina de la origen (por eso Pedernal lo agrega a lo que `copias_cuadran` compara). **Motor2 no tiene dividir ni copias de línea** (V: `docs/diseno-ventas-salon-y-mostrador-2026-10-26.md:194` lo deja afuera; el plan de paridad dice «no aplica hoy»): no hay nada que adaptar. Si se construye, hereda este invariante (I5).
- **D2 (clasificación en las copias) no es de esta pieza:** pertenece a la clasificación comercial (R2 del plan de paridad).

## 8. Esquema PROPUESTO (nivel 6) — «no se migra hasta confirmar niveles 1 a 5»

> No se aplica ni se escribe como migración hasta que el dueño ratifique la etapa y responda Q1. Toda migración es **aditiva** y con `down.sql`; aplicarla en una base real sigue congelado.

**Etapas (la más barata primero):**

| Etapa | Qué | Migración | Costo |
|---|---|---|---|
| **E1** | Columna `Producto.nombreDeCocina` + campo en alta y ficha + «Duplicar» + la comanda lee `nombre de cocina ?? nombre interno` **vivo** | 1, aditiva | chico |
| **E2** | Columna `CuentaItem.nombreDeCocina` (congelado) + espejo + la comanda y el aviso leen el congelado | 1, aditiva | chico |
| **E3** | Inmutabilidad de la columna de la línea en la base | 1, aditiva (disparador) | chico |

**Limitación declarada de E1 (por eso se recomienda entregar E1 y E2 juntos, en dos migraciones y dos commits):** con lectura viva, renombrar o borrar el nombre de cocina cambia lo que dicen las reimpresiones y los avisos de anulación de lo ya enviado; en una cocina eso puede significar que el aviso «no preparar X» nombre algo distinto de lo que se preparó. E1 sola no cumple I5 ni I8.

**E1 — `Producto.nombreDeCocina`:**

```sql
-- up (esquema Prisma: `nombreDeCocina String?`; mismo estilo que `ContenidoCartaProducto_nombre_en_carta_chk`)
ALTER TABLE "Producto" ADD COLUMN "nombreDeCocina" TEXT;
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_nombre_de_cocina_chk" CHECK (
  "nombreDeCocina" IS NULL
  OR ("tipo" = 'PV'
      AND char_length("nombreDeCocina") BETWEEN 1 AND 80
      AND "nombreDeCocina" ~ '^\S(.*\S)?$' AND "nombreDeCocina" !~ '[\r\n]'));

-- down.sql (frena si ya hay nombres cargados: revertir los perdería)
DO $$ BEGIN
  IF EXISTS (SELECT 1 FROM "Producto" WHERE "nombreDeCocina" IS NOT NULL) THEN
    RAISE EXCEPTION 'hay productos con nombre de cocina: revertir los perdería' USING ERRCODE = '55000';
  END IF;
END $$;
ALTER TABLE "Producto" DROP CONSTRAINT "Producto_nombre_de_cocina_chk";
ALTER TABLE "Producto" DROP COLUMN "nombreDeCocina";
```

Compatible hacia atrás: columna nula, sin relleno, el CHECK lo cumplen todas las filas (todas nulas); el código anterior no la lee ni la escribe. **Límite honesto del CHECK:** Postgres no tiene `\p{L}`; el CHECK de la base cubre largo, bordes, saltos de línea y tipo PV; el conjunto de caracteres permitido lo impone el servidor con la ficha de texto (y un disparador posterior, si el dueño lo pide: Pedernal lo hace con una función de la base). Los privilegios y las políticas por empresa de `Producto` deberían cubrir la columna nueva: NO VERIFICADO, se comprueba al implementar.

**E2 — `CuentaItem.nombreDeCocina`** (equivale a la 0055 de Pedernal, D3):

```sql
ALTER TABLE "CuentaItem" ADD COLUMN "nombreDeCocina" TEXT;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_nombre_de_cocina_chk" CHECK (
  "nombreDeCocina" IS NULL
  OR (char_length("nombreDeCocina") BETWEEN 1 AND 80
      AND "nombreDeCocina" ~ '^\S(.*\S)?$' AND "nombreDeCocina" !~ '[\r\n]'));

-- down.sql: DESTRUCTIVA si hay líneas con nombre congelado (no se reconstruye): aborta si encuentra alguna.
```

Las líneas que ya existen quedan en nulo: la comanda usa entonces el nombre interno, como hasta hoy; no hay de dónde reconstruir lo que decía el producto al venderse. Es el mismo molde que `nombreEnTicket` (columna nula + CHECK de 1 a 80). Se escribe **solo al insertar** la línea; el espejo de anulación la repite del original.

**E3 — inmutabilidad:** Pedernal hace que lo congelado de la línea no se pueda editar (`linea_validar_cambio`). En Motor2 `nombreEnTicket` hoy tiene solo CHECK, no disparador de inmutabilidad (V). Propuesta: un disparador mínimo que rechace cambiar `nombreDeCocina` de una fila existente; **se decide aparte** si se aplica también a `nombreEnTicket` (no se toca lo que no se pidió).

**Lo que NO se crea:** ninguna tabla nueva (no hay tabla de «envíos» con foto), ninguna columna en opciones ni en combos (Q1), ninguna columna de estación.

## 9. Atomicidad y concurrencia (nivel 7)

- **Cargar o cambiar el nombre (CU1, CU2):** parte de la edición del producto: una transacción, con el control de concurrencia que ya usa `actualizarProducto` (NO VERIFICADO cuál: lo define el diseño del caso de uso; si es «el último gana», queda auditado). Se valida el permiso y la ficha de texto dentro del servidor.
- **Agregar una línea (CU3):** el nombre se lee del producto **dentro de la misma transacción** de agregar ítems (serializable, V) y se escribe junto con la línea: o se agrega todo el pedido con sus nombres, o nada. Si otra persona cambia el nombre justo en el medio, la serialización reintenta o la línea queda con uno de los dos valores, coherente (nunca mezclado).
- **Idempotencia:** agregar el mismo ítem dos veces ya está protegido por la clave de operación del pedido (V); el nombre congelado es parte de la misma fila. Cambiar el nombre al mismo valor es «sin cambios» (no audita).
- **Anular parte (CU6):** el espejo se crea en la misma transacción que la anulación y copia el nombre del original.

**Tabla «¿qué pasa si…?»**

| Situación | Cargar/cambiar (CU1–2) | Agregar línea (CU3) | Comanda y reimpresión (CU4–5) | Anular parte (CU6) |
|---|---|---|---|---|
| **Repetición** (doble clic, reintento) | Mismo valor: «sin cambios», no audita | La clave de operación evita duplicar la línea | Reimprimir = misma salida (I8) | No se crea un segundo espejo por la misma anulación ya registrada |
| **Concurrencia** | Dos ediciones a la vez: una guarda y queda la otra auditada (o conflicto, según T3) | Serializable: coherente | Lectura sin escritura | Fila original bloqueada: dos anulaciones no superan lo vigente |
| **Tiempo** (renombrar entre pedir y reimprimir) | Cambia el producto, no lo vendido | Congela el valor de ese instante | Sale con lo congelado | Lleva el nombre del original |
| **Incertidumbre** (no se sabe si se guardó) | Se vuelve a guardar: idempotente | Se vuelve a pedir con la misma clave | — | Ídem |
| **Reintento** | Seguro | Seguro | Seguro | Seguro |
| **Error parcial** | Una transacción | Todo el pedido o nada (V) | — | Una transacción |
| **Datos faltantes** | Producto que no es de venta → rechazo; nombre vacío = quitar el nombre; inválido → «Esta acción no está permitida» | Producto sin nombre de cocina → nulo → la comanda usa el interno | Línea anterior (nulo) → interno | Original sin nombre → el espejo también nulo |
| **Cambio de permisos** | Sin `producto_editar`, rechazo (se verifica en la transacción) | El mozo no elige el nombre: no hay permiso que cambiar | Ver comandas lo conserva | Se verifica al anular |

## 10. Acceso e interfaces (nivel 8)

- **Campo «Nombre de cocina»** en el alta y en la ficha del producto, solo para productos de venta, justo después del nombre. El rótulo es el de Pedernal («Nombre de cocina», `catalogo.dato.nombre_de_cocina`) y la posición la de su maqueta aprobada (Nombre, Nombre de cocina, Código interno, Código de barras…). **No se inventa ninguna ayuda ni texto nuevo;** lo que falte de texto va al flujo de textos por aprobar del dueño. Hoy el formulario de Motor2 (`producto-form.tsx`) no lo tiene.
- **Comanda (papel y reimpresión) y aviso de anulación:** el renglón dice `cantidad × nombre para la cocina` y, si hay opciones, lo incluido debajo y los adicionales con «+», como hoy. Para que el nombre del mozo no cambie, `ItemParaComanda` suma un **campo propio** (`nombreParaLaCocina`) que `armarComandas` prefiere; la pantalla del mozo, el ticket del cliente y los reportes siguen con sus nombres.
- **Producto de base configurable** (el plato lo da la opción de medida): la regla de hoy no cambia, gana el nombre de la medida; el nombre de cocina reemplaza solo el nombre del producto cuando éste es el que se usa. **NO VERIFICADO** qué espera el dueño para ese caso: se deja con la regla actual y se prueba (§12).
- **Permisos:** ver §3. No hay permiso nuevo.

## 11. Consultas y experiencia (nivel 9)

- La lista y la ficha del producto muestran el nombre de cocina cuando existe; cuando no, **no se inventa**: se ve como «sin cargar» (texto de la maqueta aprobada de Pedernal, a copiar tal cual).
- No hay búsqueda ni reporte por nombre de cocina (no pedido).
- «Duplicar producto» lo copia (el oráculo de columnas lo declara `SE_COPIA`).
- Lo que ve la cocina cambia **solo** cuando alguien carga un nombre: ninguna comanda de hoy cambia por aplicar la migración.

## 12. Pruebas, combinaciones, migración y operación (nivel 10)

**Dimensiones cuyas combinaciones cambian visibilidad (lo que se imprime) y datos del producto** (a declarar en el guardián; una dimensión nueva sin declarar hace fallar el test): producto con / sin nombre de cocina × tipo de producto (PV / MP) × modo de venta (DIRECTO / BASE_CONFIGURABLE) × la línea (suelta / componente de promo / adicional / espejo de anulación) × opciones (sin / con incluidas / con adicionales) × momento (antes / después de renombrar el producto o cambiar su nombre de cocina) × documento (comanda / reimpresión / aviso de anulación / pantalla del mozo / ticket del cliente / reporte) × línea anterior a la migración (nombre congelado nulo). Esto no toca dinero ni stock: I6.

**Oráculo escrito aparte del código:**

| # | Combinación | Resultado esperado |
|---|---|---|
| O1 | Producto con nombre de cocina «N» y nombre interno «I», línea nueva | comanda: «N»; mozo: «I»; ticket: lo de hoy |
| O2 | Producto sin nombre de cocina | comanda: «I» (como hoy) |
| O3 | Línea con «N» congelado; después se renombra el producto a «I2» y se cambia el nombre de cocina a «N2» | comanda y reimpresión de esa línea: «N»; línea nueva: «N2» |
| O4 | Línea con «N» congelado; después se borra el nombre de cocina del producto | comanda: «N» (lo congelado) |
| O5 | Línea anterior a la migración (congelado nulo) | comanda: el nombre interno actual del producto, como hoy |
| O6 | Anular parte de una línea con «N» | aviso de anulación y resto vigente: «N» |
| O7 | Producto de tipo MP | no admite nombre de cocina (rechazo) |
| O8 | Nombre de cocina vacío o de espacios al guardar | se guarda como «sin nombre de cocina» (nulo) |
| O9 | Nombre de 81 caracteres, con salto de línea, sin letras o con caracteres invisibles | rechazado con el mensaje genérico; no escribe |
| O10 | Producto con opciones (incluida «puré», adicional «huevo») y nombre de cocina «N» | comanda: «N» + lo incluido debajo + «+ huevo» como hoy |
| O11 | Producto base configurable con la medida «Grande» | gana el nombre de la medida, como hoy (supuesto; ver §10) |
| O12 | Componente de promo con nombre de cocina propio | cada componente dice el suyo |
| O13 | Duplicar un producto con nombre de cocina | el duplicado lo tiene |
| O14 | Mismo guardado dos veces | segunda vez «sin cambios» |
| O15 | Reimprimir dos veces | salidas idénticas |
| O16 | Sin `producto_editar` | no puede cargar ni cambiar el nombre |

**Pruebas obligatorias:** unitarias de la regla (`nombre de cocina ?? interno`) y de la ficha de texto (con su oráculo y su declaración, que el guardián de textos exige); integración contra la base: el congelado se escribe al agregar la línea, el espejo lo repite, los CHECK rechazan lo inválido aunque el código se olvide; **concurrencia** (cambiar el nombre mientras otra persona agrega una línea: la línea queda con un valor coherente, nunca mezclado; dos anulaciones simultáneas sobre un ítem); **idempotencia** (mismo guardado dos veces; mismo agregado dos veces); permisos y aislamiento entre empresas; el oráculo de columnas de «Duplicar» declara la columna nueva; migración arriba y abajo (el `down.sql` frena si hay datos). Gate completo antes de cerrar cada etapa: `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build`, `npm run test:e2e`.

**Migración y operación:** aditiva, reversible, con `down.sql`; aplicar en una base real sigue congelado hasta orden del dueño. **Aviso previo a cambios destructivos:** ninguna etapa lo es (el `down.sql` de E2 sí perdería datos si ya hay nombres congelados y por eso aborta).

**Qué ve el dueño sin leer código (para después de construir):** (1) cargar «Medallón de bife de chorizo» como nombre de cocina del bife y pedirlo en una mesa: la comanda dice el de cocina y la pantalla del mozo, el nombre de siempre; (2) renombrar el producto y reimprimir la comanda: sale igual; (3) un producto sin nombre de cocina sale en la comanda con su nombre de siempre; (4) anular parte de un ítem ya enviado: el aviso dice el mismo nombre con el que salió.

## 13. Preguntas de NEGOCIO abiertas (solo las que cambian modelo de datos, dinero o permisos)

**Q1 — ¿El nombre de cocina también va en cada opción y en cada componente?** El dueño dijo el 2026-11-08 (decisión 72 de Pedernal) que la comanda se arma «desde la composición», con el nombre de cocina de cada componente y de cada opción (por ejemplo el corte). Pedernal, en su primera versión, solo usa el nombre de cocina **del producto** más el nombre normal de la variante y de las opciones (D: especificación del salón, criterio D175 del 10/11, corregible); la propia documentación de Pedernal lo deja como contradicción sin resolver. Las dos cosas cambian el modelo de datos:
- **A (recomendada, la más barata):** solo el nombre de cocina del producto, igual que Pedernal hoy. Las opciones y los componentes salen en la comanda con su nombre de siempre. No agrega columnas fuera de las de §8.
- B: también un nombre de cocina en cada opción (y en los componentes de un combo). Agrega una columna en la versión de cada opción, su campo en la pantalla de opciones y su congelado en la foto de lo elegido; es una etapa grande y Pedernal no la tiene todavía.
- *Si no se responde:* A.

## 14. Decisiones técnicas (del ingeniero; el dueño no necesita decidirlas)

| # | Decisión | Motivo |
|---|---|---|
| T1 | «Nombre comercial» (de la regla «si no hay, el comercial») = el **nombre interno** del producto, no el de la carta de la sucursal | Es lo que la comanda dice hoy; el 2026-11-04 se declaró que comanda, ticket y reportes siguen con el nombre interno (`docs/diseno-nombre-en-carta-2026-11-04.md` §1); en Pedernal es `descripcion`, el nombre del producto. **Supuesto declarado: el dueño lo corrige** |
| T2 | El nombre de cocina es una **ficha de texto nueva** (1 a 80, exige una letra, sin los signos de catálogo `¿ ¡ ? ! % $`) declarada en `fichas-de-texto.ts` y en su oráculo | Igual que `nombre-de-cocina.ts` de Pedernal (P: `exigirUnaLetra`, sin signos de catálogo); el guardián de textos lo exige. Observación: la base de Pedernal valida con la función de catálogo (que sí admite esos signos): diferencia interna de Pedernal, NO VERIFICADO cuál prevalece |
| T3 | El control de concurrencia de la edición del producto es el mismo que ya usa `actualizarProducto` | no se agrega un patrón nuevo |
| T4 | La comanda suma un campo propio (`nombreParaLaCocina`) y no reutiliza `nombreDeLinea` | ese campo es también lo que ve el mozo (hallazgo de §2) |
| T5 | Se congela **solo el nombre**, no se crea una tabla de envíos con foto | primero la opción más barata; si más adelante se pide una foto completa del envío, es otra etapa |
| T6 | La columna se agrega a `COLUMNAS_DEL_DUPLICADO` como `SE_COPIA` | el guardián existente lo exige |
| T7 | La inmutabilidad de la línea (E3) se decide aparte | no se endurece `nombreEnTicket` sin pedido |

## 15. Diferencias con Pedernal, declaradas

| Diferencia | Motivo | Estado |
|---|---|---|
| Sin foto del envío (tabla de renglones enviados) | Motor2 no tiene esa tabla; el envío es `numeroEnvio` de la línea (V). Alcanza con congelar el nombre en la línea | PROPUESTA (T5) |
| El CHECK de la base no cubre el conjunto de caracteres permitidos | Postgres sin `\p{L}`; Pedernal usa una función de la base (`texto_de_catalogo_valido`, 0043) que Motor2 no tiene; el servidor lo impone | PROPUESTA; disparador posterior si el dueño lo pide |
| Inmutabilidad solo si E3 se aplica | Hoy las líneas de Motor2 no tienen ese disparador para lo congelado | PROPUESTA (T7) |
| «Comercial» = nombre interno, no el de la carta de la sucursal | Motor2 tiene un nombre de carta por sucursal que Pedernal no tiene | PROPUESTA (T1) |
| Sin la corrección D2 (clasificación en copias) | Es de la clasificación comercial (R2) y Motor2 no tiene copias de línea | fuera de esta pieza |

## 16. Límites honestos

- No leí ninguna base real; no hay datos de uso de ningún cliente.
- No ejecuté Motor2 ni Pedernal: todo sale de leer código y documentos.
- Pedernal: leí la migración 0055, `nombreParaLaCocina`, la primitiva `nombre-de-cocina.ts` y el nombre del test de integración; no corrí sus pruebas.
- NO VERIFICADO: el mecanismo exacto de concurrencia de `actualizarProducto`; los privilegios de base sobre la columna nueva; qué espera el dueño para un producto de base configurable.
