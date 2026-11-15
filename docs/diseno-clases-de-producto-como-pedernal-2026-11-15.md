# Diseño en papel — Clases de producto como Pedernal (E6, parte «clases») — 2026-11-15

Estado: **diseño en papel.** Sin código, sin migración escrita, sin tocar ninguna base. El nivel 6 es un **esquema PROPUESTO**: no se migra hasta confirmar los niveles 1 a 5 (AGENTS.md, «Diseño de módulos y features nuevos»). Aplicar en bases reales sigue congelado.

**Estados de cada decisión:** CONFIRMADA (la dijo el dueño; cita literal y fecha) · PROPUESTA · PENDIENTE · NO VERIFICADA. Siglas: `ERP:` = repositorio de Pedernal (`main`, solo lectura); `ZH-docs` = su documentación; `M2` = este repositorio en `origin/main` (`b36de06`).

## 0. Resumen en lenguaje de proceso

1. **Qué es una clase:** lo que el producto ES para el negocio, elegido al crearlo entre cinco valores cerrados: **Materia prima, Insumo, Reventa, Elaborado, Producto vendible**. De la clase depende qué datos lleva y qué puede hacer. La clase **no cambia** después de crear el producto.
2. **Qué tiene Motor2 hoy:** dos tipos (`MP`/`PV`) más la marca «se produce» (`seProduce`). Con eso se **derivan tres** de las cinco clases (Materia prima, Elaborado, Vendible). **Insumo y Reventa no existen como dato**, y no se pueden deducir con seguridad de lo cargado.
3. **Lo más barato que alcanza para empezar:** (E0) la lista ya dice las tres clases derivadas; (E1) **una columna nueva y opcional** con la clase, rellenada **solo con lo seguro** (respuesta 1 del dueño); (E2) el alta y la ficha eligen la clase y muestran su descripción corta; (E3) Insumo con sus reglas; (E4) Reventa. Cada etapa se puede usar sin la siguiente.
4. **Tres preguntas de negocio** (§11): dos **CONFIRMADAS** por el dueño el 2026-11-15 (relleno solo con lo seguro; «se produce» ya no se prende ni se apaga en una materia prima) y una **abierta**: el dueño preguntó «Como lo hace pedernal?» sobre los pares «compra + venta» actuales de lo que se revende. La respuesta con evidencia está en §11.2.
5. **Un hallazgo que conviene saber antes de leer:** en Motor2 la palabra «Insumo» ya significa **otra cosa** (el nodo de familia de Maestros → Insumos, el modelo `Insumo`). En Pedernal «Insumo» es una **clase** (packaging, limpieza). No se renombra nada sin pedido (§4.4, D-T1).

## 1. Nivel 1 — Propósito y alcance

| # | Decisión | Estado | Cita / fuente |
|---|---|---|---|
| 1.1 | **Necesidad:** que cada producto diga **qué es** y que el sistema, no la pantalla, haga cumplir lo que cada clase pide y prohíbe. Quién lo pidió y dónde está escrito: el dueño, que Motor2 tenga «las 5 de Pedernal». | CONFIRMADA | 2026-11-13, chat dueño ↔ orquestador, pregunta «¿Qué clases?»: «Las 5 de Pedernal» (`docs/diseno-productos-igual-a-pedernal-2026-11-13.md` §8, fila 2) |
| 1.2 | **Igual a Pedernal en resultado y forma** (reglas, nombres, mensajes); solo difiere lo que imponen Prisma, RLS o los datos ya existentes. | CONFIRMADA | 2026-11-13: «Necesitamos ser iguales en todo… el resultado tiene que ser el mismo y sobre todo de las mismas formas, salvo porque nosotros usamos Prisma» |
| 1.3 | **Ratificación en bloque** de E6 («Ocultar» y clases): copiar a Pedernal. **Ninguna migración queda autorizada por esa frase sola.** | CONFIRMADA en dirección | 2026-11-15, chat dueño ↔ orquestador: «Sí, copiar a Pedernal en esas cinco (Recomendada)» (`motor2-docs`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, l. 113) |
| 1.4 | **Autorización permanente condicionada** (lectura del orquestador, a corregir por el dueño): migraciones **aditivas y reversibles, con `down.sql` revisado**, de etapas ratificadas, se pueden escribir y llevar a `main`; **aplicar en bases reales sigue congelado**. | CONFIRMADA (lectura del orquestador) | 2026-11-15, mismo documento, l. 145 |
| 1.5 | **«Ocultar»** es otro diseño (`docs/diseno-ocultar-como-pedernal-2026-11-15.md`); acá solo se cruza en el oráculo (§10). | CONFIRMADA | 2026-11-15, misma ratificación |
| 1.6 | **Fuera de alcance** (nadie lo pidió): servicios (algo que no se cuenta), combos como clase, categoría y sección de la carta, familias, «Se controla el stock». Se mencionan solo donde cruzan. | PROPUESTA | Pedernal los trata aparte (`ZH-docs/11-especificaciones/conceptos/clase-de-uso.md` §3) |

**Qué NO entra (regla «lo que el dueño no pidió no entra»):** ninguna clase sexta, ningún campo nuevo en la ficha, ninguna pantalla de «administrar clases». Las clases son una lista cerrada que entiende el sistema, como en Pedernal.

## 2. Nivel 2 — Actores y contexto

| Actor | Qué hace con la clase | Permiso (hoy) |
|---|---|---|
| Gerente / administrador | Elige la clase **al crear** el producto; la ve en lista y ficha. | Los de alta de producto de Motor2 (`NO VERIFICADO` el nombre exacto de la acción; no se inventa uno nuevo: se reutiliza el del alta). |
| Operador de compras / cocina | **Ve** la clase donde ya ve el producto (alta rápida desde compra o receta: solo ofrece las clases que esa pantalla admite). No la cambia. | Sin permiso nuevo. |
| Sistema | Hace cumplir lo que la clase pide y prohíbe (base y servidor); la deduce al rellenar lo existente. | — |
| Contexto | **Multiempresa** (todo filtra por empresa) y **sucursales**; la clase es de la **empresa**, no de la sucursal. Dinero en `Decimal` con moneda; fechas en zona Argentina. | RLS de `Producto` (ya existe). |

## 3. Nivel 3 — Casos de uso

| # | Caso | Disparador | Resultado |
|---|---|---|---|
| C1 | **Crear un producto eligiendo qué es** | Alta de producto | Nace con su clase; los campos que la clase prohíbe ni se ofrecen ni se aceptan. |
| C2 | **Alta rápida** (desde compra o receta) | «Agregar producto nuevo» | Pide nombre, qué es y unidad; solo ofrece las clases que esa pantalla admite; nace «Falta completar». |
| C3 | **Filtrar la lista por «¿Qué es?»** | Chips de la lista | Todos / Materia prima / Insumo / Reventa / Elaborado / Producto vendible. |
| C4 | **Ver la clase y su descripción corta** | Alta y ficha | Línea de ayuda bajo «¿Qué es?» con la descripción de la clase elegida. |
| C5 | **Corregir una clase equivocada** | El dueño se dio cuenta | **No se cambia:** se crea el producto correcto y se desactiva el otro (Pedernal; 2026-11-13). Sin excepciones (respuesta 1 = C). |
| C6 | **Rellenar los productos existentes** | Etapa E1 | Cada producto recibe clase solo si es seguro (Materia prima, Elaborado, Vendible); nada se pierde; Insumo y Reventa solo en altas nuevas. |

## 4. Nivel 4 — Conceptos y ciclo de vida

### 4.1 Las cinco clases y sus descripciones cortas (texto aprobado en Pedernal)

Fuente: `ERP:src/capacidades/vocabulario/catalogo-catalogo.ts`, claves `catalogo.clase.descripcion.*`; según ese archivo, «son las de la decisión 69, ya aprobadas» (tabla «Textos nuevos», aprobada por el dueño el 09/11/2026). **Estado en Motor2: CONFIRMADA en dirección** (ratificación 2026-11-15, «copiar a Pedernal»); **NO VERIFICADO** que el dueño las haya leído en Motor2 (no se muestran hoy). Son textos del cliente: se copian literales.

| Clase | Nombre en pantalla | Descripción corta (literal de Pedernal) |
|---|---|---|
| `MATERIA_PRIMA` | Materia prima | «Se compra y es componente de lo que se elabora y se vende.» |
| `INSUMO` | Insumo | «Se compra y se consume para operar, sin ser parte del producto.» |
| `REVENTA` | Reventa | «Se compra y se vende tal cual.» |
| `ELABORADO` | Elaborado | «Se produce en el negocio y se usa como componente.» |
| `VENDIBLE` | Producto vendible | «Se arma o se produce y se vende; tiene composición.» |

Orden en pantalla (el de Pedernal, `ERP:apps/web/ui/plantillas/catalogo/filtros-de-productos.ts:20-26`): Materia prima, Insumo, Reventa, Elaborado, Producto vendible.

### 4.2 `vendeLaClase` y sus hermanas (Pedernal, `ERP:src/modulos/catalogo/dominio/clases.ts`)

- `vendeLaClase(clase)` = `REVENTA` o `VENDIBLE`. **Una clase que vende lleva alícuota, sección de la carta, nombre de cocina, descripción, precio y opciones; una que no vende no puede llevar ninguno** (la base lo impone con `CHECK`, `ERP:migraciones/0025_catalogo.sql:177-179`).
- `seConsumeLaClase(clase)` = `MATERIA_PRIMA`, `INSUMO` o `REVENTA` (lo que una **opción** puede consumir; hoy además el Elaborado por decisión del 12/11, ver 5.3).
- `CLASES_COMPRABLES` = `MATERIA_PRIMA`, `INSUMO`, `REVENTA` (`ERP:src/modulos/catalogo/dominio/clase-comprable.ts`).
- «Se vende» **no es la clase**: es la clase que vende **y** con alícuota **y** sin «Falta completar» (columna generada, `ERP:0025_catalogo.sql:162-163`).

### 4.3 Ciclo de vida

```
(no existe) ──crear con clase──▶ ACTIVO ──desactivar──▶ DESACTIVADO ──reactivar──▶ ACTIVO
                                   │                           (la clase no cambia en ningún paso)
                                   └─ «Falta completar» (alta rápida) ──completar datos──▶ ACTIVO
```
La clase es **inmutable** desde el alta (disparador `producto_clase_de_uso_inmutable`, `ERP:0025_catalogo.sql:330-333`). «Desactivar» y «Ocultar» son estados distintos del producto (otro diseño); ninguno cambia la clase.

### 4.4 Inventario de lo que Motor2 ya tiene con otro nombre (verificado en el código de `origin/main`, no en documentos)

| Concepto de Pedernal | Motor2 hoy | Dónde | Veredicto |
|---|---|---|---|
| Clase `MATERIA_PRIMA` | `tipo = MP` y `seProduce = false` | `prisma/schema.prisma:336-339,361,416`; `src/core/catalogo/filtros-de-productos.ts:82-85` (`claseDelProducto`) | **Derivable** |
| Clase `ELABORADO` | `tipo = MP` y `seProduce = true` (la sub-receta que se produce) | `src/core/catalogo/espacio-del-producto.ts:93`; `src/server/actions/catalogo/casos-de-uso/guardar-version-de-receta.ts:98` | **Derivable**, con la salvedad de que `seProduce` **se puede prender y apagar** después del alta |
| Clase `VENDIBLE` | `tipo = PV` (incluye el que además `seProduce`, p. ej. la medialuna que se vende y se produce) | ídem | **Derivable** |
| «Producto de respaldo de un adicional» | `tipo = PV` con `opcionQueRespalda` (lo maneja el sistema; no va suelto en la carta) | `schema.prisma:447`; `filtros-de-productos.ts:82` | Es una **cuarta etiqueta de la lista** (`respaldo`) que **no existe en Pedernal**; sigue siendo un `VENDIBLE` por clase. No se toca. |
| Clase `INSUMO` (packaging, limpieza) | **No existe como dato.** Existe la **convención «No comestibles»**: una MP cuyo `Insumo`-familia cuelga de un grupo llamado «No comestibles» | `src/core/catalogo/no-comestibles.ts:1-12` | Se puede **proponer** por regla, pero depende de un árbol que se puede mover (ver 6.4) |
| Clase `REVENTA` | **No existe.** Lo que se revende hoy son **dos productos**: una MP (se compra) y un PV con receta 1:1 (se vende). El sistema ya lo nombra «Producto de reventa» en reportes (`docs/grounding-rendimiento-recetas-decisiones-2026-09-22.md:480-502`) | ídem | **No derivable con seguridad** (un PV con receta de un solo ingrediente puede ser una reventa o un plato simple) |
| `producto.tipo = 'BIEN'` de Pedernal | No hay equivalente; `tipo` de Motor2 es MP/PV (otra cosa) | — | **Colisión de nombre:** no confundir |
| «Insumo» (clase) | **`model Insumo`** = nodo de familia, 1:1 con los productos MP; «Maestros → Insumos» | `schema.prisma:512-530` | **Colisión de nombre** (D-T1) |
| Receta: ingrediente = MP | `validarIngredientes` exige `tipo === "MP"`, incluye MP con `seProduce` | `src/core/catalogo/receta-validacion.ts:138-155` | Equivale a «materia prima y elaborado»; **hoy también entra el packaging** (rótulo `PACKAGING_NO_COMESTIBLE` en rendimiento) |
| Consignación | `esConsignacion`, `proveedorConsignacionId`, `precioConsignacion` en `Producto` | `schema.prisma:418-421` | **Ortogonal a la clase**; en Pedernal no es una clase. No se toca. |
| «Se controla el stock» | No existe como casilla; toda MP lleva stock | — | Fuera de alcance (1.6) |

## 5. Nivel 5 — Invariantes y políticas

### 5.1 Lo que cada clase pide y prohíbe (Pedernal, `ZH-docs/11-especificaciones/e2-catalogo-minimo-especificacion.md` §3.3; verificado contra `ERP:0025_catalogo.sql`)

| Clase | Alícuota | Sección | Precio y opciones | Se vende | Qué más pide |
|---|---|---|---|---|---|
| Materia prima | No | No | No | No | Unidad base; cómo se compra |
| Insumo | No | No | No | No | Ídem; queda **fuera del food cost** (decisión 77, USAR) |
| Reventa | **Sí** | **Sí** | **Sí** | Sí, con alícuota | Cómo se compra |
| Elaborado | No | No | No | No | Su receta (de tanda); ni se compra ni se vende |
| Producto vendible | **Sí** | **Sí** | **Sí** | Sí, con alícuota | Receta (sin receta se vende con aviso, decisión 140) |

### 5.2 Invariantes (cada una se hace cumplir en la base **y** en el servidor)

| # | Invariante | Estado |
|---|---|---|
| I1 | La clase es uno de los cinco valores (lista de **permitidos**, regla «todo nace cerrado»). | CONFIRMADA en dirección (1.3) |
| I2 | La clase **no cambia** después del alta. | CONFIRMADA en Pedernal: 2026-11-13, «un producto con la clase equivocada se corrige creando el correcto y desactivando el otro» (`motor2-docs/_planes/plan-de-paridad-con-pedernal-2026-11-14.md`, E6) |
| I3 | Una clase que no vende no lleva alícuota, sección, nombre de cocina ni descripción de carta; no tiene precio ni grupos de opciones. | CONFIRMADA en dirección (1.3); en Motor2 la alícuota y el precio hoy dependen de `tipo` (`PV`), ver 6.3 |
| I4 | Solo se compran **Materia prima, Insumo y Reventa**. | CONFIRMADA en dirección |
| I5 | Una **opción** consume solo Materia prima, Insumo, Reventa y —por decisión del 12/11— **Elaborado**. Nunca su propio producto. | Pedernal: CONFIRMADA (12/11, punto b; en Pedernal «el servidor todavía lo rechaza»: pendiente de su E6). En Motor2: PROPUESTA igualarlo cuando se haga. |
| I6 | La **receta** lleva solo ingredientes: Materia prima, Elaborado y Reventa. **El Insumo no va en la receta** (el servidor lo rechaza). | Pedernal: CONFIRMADA 2026-11-14 (opción A, fila «Receta e insumos operativos», `ZH-docs/11-especificaciones/conceptos/clase-de-uso.md` §6). En Motor2: aplica a las altas nuevas de Insumo; el packaging ya cargado queda como Materia prima (respuesta 1 = C) y **sigue pudiendo entrar** en las recetas hasta que el dueño decida crear los Insumos nuevos. |
| I7 | Solo **Elaborado** y **Producto vendible** tienen composición propia (receta). | Pedernal: leído en `ERP:0032_lotes_y_recetas.sql:113-124`. En Motor2: ya es así (receta solo para PV o MP que se produce). |
| I8 | Un **Elaborado** tiene stock propio (se produce en tanda); un **Vendible** lo tiene solo si se produce. | Pedernal: `ERP:0032:78`. En Motor2: ya es `seProduce`. |
| I9 | Un producto **desactivado** u **oculto** conserva su clase. | PROPUESTA (consecuencia de I2) |
| I10 | Si el producto es una clase que vende, para venderse necesita alícuota y no estar «Falta completar». | CONFIRMADA en Pedernal; en Motor2 ya existe (`alicuotaIvaVenta` opcional y «sin declarar»). |

### 5.3 Decisiones de política con su estado

| # | Decisión | Estado |
|---|---|---|
| P1 | Las clases son una **lista cerrada en el código y una restricción en la base** (no una tabla editable). | PROPUESTA (igual a Pedernal) |
| P2 | **«Elaborado» = materia prima que se produce** (supuesto ya declarado en el diseño del 13/11). | PROPUESTA — falta que el dueño la confirme (era PROPUESTA el 13/11) |
| P3 | **El producto «de respaldo de un adicional» sigue siendo un `VENDIBLE`** con su marca actual; no es una clase. | PROPUESTA |
| P4 | Una **opción** puede consumir un Insumo (el camino «para llevar») aunque la receta no. | Pedernal: CONFIRMADA 14/11 (`clase-de-uso.md` §6). Motor2: PROPUESTA. |
| P5 | El nombre de cada clase y su descripción corta se **copian literales** de Pedernal. | CONFIRMADA en dirección |
| P6 | La clase es **de la empresa**: una sucursal no la cambia ni la oculta. | PROPUESTA |

## 6. Nivel 6 — Historia y persistencia (**solo esquema PROPUESTO. «No se migra hasta confirmar niveles 1 a 5.»**)

> Condición para escribir esta migración: que el dueño responda las preguntas 1 a 3 de §11 **o** acepte la opción por defecto de cada una (la más barata). Hasta entonces, nada de lo que sigue se escribe en `prisma/`.

### 6.1 Principio: lo más barato primero

Se **agrega una columna** al `Producto` que ya existe. **No** se crea tabla nueva, **no** se toca `tipo`, **no** se reemplaza el enum `TipoProducto`. `tipo` sigue mandando en las ~63 aplicaciones del código que hoy lo usan (`grep` de `origin/main`); la clase se suma al lado y se vuelve la fuente de verdad **etapa por etapa**.

### 6.2 Esquema propuesto (migración aditiva, con `down.sql`)

Ubicación prevista: `prisma/migrations/<fecha>_clase_de_uso_del_producto/{migration.sql,down.sql}`. Prisma no declara `CHECK` ni disparadores, así que van a mano en el SQL (convención ya usada en `20261112160000_checks_de_datos_basicos`).

```sql
-- migration.sql  (PROPUESTO; no se escribe todavía)
ALTER TABLE "Producto" ADD COLUMN "claseDeUso" text;            -- NULL = «todavía sin clase» (relleno pendiente)

-- Lista de permitidos (regla «todo nace cerrado»).
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_chk"
  CHECK ("claseDeUso" IS NULL OR "claseDeUso" IN ('MATERIA_PRIMA','INSUMO','REVENTA','ELABORADO','VENDIBLE')) NOT VALID;

-- Coherencia con lo que ya existe (etapa E1: REVENTA todavía no se crea; la regla se relaja en E4).
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_tipo_chk" CHECK (
  "claseDeUso" IS NULL
  OR ("tipo" = 'MP' AND "claseDeUso" IN ('MATERIA_PRIMA','INSUMO','ELABORADO'))
  OR ("tipo" = 'PV' AND "claseDeUso" = 'VENDIBLE')) NOT VALID;

-- «Elaborado» es la que se produce; la materia prima y el insumo no (respuesta 3 = A, CONFIRMADA).
ALTER TABLE "Producto" ADD CONSTRAINT "Producto_claseDeUso_seProduce_chk" CHECK (
  "claseDeUso" IS NULL
  OR ("claseDeUso" = 'ELABORADO') = ("tipo" = 'MP' AND "seProduce")
  OR "tipo" = 'PV') NOT VALID;

ALTER TABLE "Producto" VALIDATE CONSTRAINT "Producto_claseDeUso_chk";   -- ninguna fila tiene clase todavía: valida sin riesgo
ALTER TABLE "Producto" VALIDATE CONSTRAINT "Producto_claseDeUso_tipo_chk";
ALTER TABLE "Producto" VALIDATE CONSTRAINT "Producto_claseDeUso_seProduce_chk";

-- Disparador: la clase se escribe UNA vez (de NULL a un valor) y después no cambia; sin excepciones.
-- (Motor2 ya usa disparadores en 11 migraciones: p. ej. 20261001230000_auditoria_inmutable.)
```
```sql
-- down.sql  (PROPUESTO; idempotente)
DROP TRIGGER IF EXISTS "Producto_claseDeUso_inmutable_trg" ON "Producto";
DROP FUNCTION IF EXISTS producto_clase_de_uso_inmutable();
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_seProduce_chk";
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_tipo_chk";
ALTER TABLE "Producto" DROP CONSTRAINT IF EXISTS "Producto_claseDeUso_chk";
ALTER TABLE "Producto" DROP COLUMN IF EXISTS "claseDeUso";
```

- **Compatible hacia atrás:** el código viejo no lee ni escribe la columna; con `NULL` todo se comporta como hoy. **No hay cambio destructivo.** El único dato que se descartaría al revertir es la clase misma (se puede rehacer por las reglas de 6.4).
- **Prisma:** `claseDeUso String?` (como `modoDeVenta String`, que también es texto con `CHECK` a mano), no un `enum` de Postgres: agregar un valor es cambiar un `CHECK`, reversible (mismo criterio de Pedernal y del `TIPOS_DE_GRUPO_DE_OPCIONES` de Motor2).
- **RLS y permisos de columna:** la columna cuelga de `Producto`, que ya tiene RLS por empresa. **NO VERIFICADO** si las concesiones de la aplicación son por columna (en Pedernal sí lo son); se verifica antes de escribir.
- **Historia:** no hay tabla de historial nueva. La clase se escribe una sola vez (en el alta o en el relleno); el alta y el relleno quedan en el registro de cambios auditado que Motor2 ya usa (`registrarCambioAuditado`); no se borra nada.
- **Puntos de extensión previstos (sin crear tablas muertas):** el `CHECK` se relaja para `REVENTA` en E4; `NOT NULL` se agrega en E1b cuando no queden filas sin clase; una clase sexta sería agregar un valor al `CHECK`.

### 6.3 Qué NO se migra en E1 (y por qué)

- **No** se toca `tipo`. `Producto.tipo` = `PV` sigue siendo lo que habilita precio, POS y carta; `MP`, lo que habilita compra y receta. Hacer que `REVENTA` (se compra **y** se vende) conviva con esas reglas toca ~63 archivos: es la etapa E4, aparte y con su propia migración (relajar `Producto_claseDeUso_tipo_chk`).
- **No** se crean tablas de clases ni de reglas por clase.

### 6.4 Relleno de los productos existentes (sin pérdida)

Se hace con un **script idempotente con ensayo previo (dry-run)**, no con SQL puro: la regla de «No comestibles» necesita normalizar nombres y recorrer el árbol de familias (`src/core/catalogo/no-comestibles.ts`), cosa que ya existe como función pura y no se duplica en SQL. Solo toca filas con `claseDeUso IS NULL`. **Se corre únicamente con autorización expresa, en una copia primero.**

| Producto existente | Clase rellenada | Seguridad | Marca |
|---|---|---|---|
| `MP` y `seProduce = true` | `ELABORADO` | Alta | — |
| `MP`, `seProduce = false` y fuera de «No comestibles» | `MATERIA_PRIMA` | Alta | — |
| `MP`, `seProduce = false` y bajo «No comestibles» | `MATERIA_PRIMA` (respuesta 1 = C: **no se rellena Insumo**; sale en el informe como «candidato a Insumo») | Alta (no infiere de más) | No |
| `PV` (incluye respaldo de adicional y los que además `seProduce`) | `VENDIBLE` | Alta | — |
| Un `PV` con receta de **un solo ingrediente 1:1** (posible reventa) | `VENDIBLE` | Baja | **No se infiere `REVENTA`**; sale en el **informe «candidatos a revisar»** (solo lectura, §9) |

Garantías: **sin pérdida** (no se borra ni se mueve nada; solo se llena una columna vacía); **idempotente** (repetirlo no cambia lo ya relleno: filtra por `IS NULL`); **atómico por empresa** (una transacción por empresa; si falla, esa empresa queda como estaba); **informe de lo dudoso** antes de aplicar (cuántos de cada regla, sin nombres en el repositorio). Lo que no se puede inferir (Insumo, Reventa) **no se rellena**: queda para altas nuevas y en el informe como «pendiente de completar»; no se inventa.

### 6.5 Excepción a «la clase no cambia»: **descartada**

La opción A de la pregunta 1 (marca «clase por confirmar» y confirmación única) **no fue la elegida**: el dueño eligió C (2026-11-15). No hay columna `claseSinConfirmar` ni corrección única. Si una clase rellenada resulta equivocada, rige Pedernal: se crea el producto correcto y se desactiva el otro.

### 6.6 Consulta de solo lectura para la respuesta 3 («se produce» ya no se prende ni se apaga en una materia prima)

Cuenta cuántas materias primas ya tienen «se produce» encendido y cuántas chocan con lo que un Elaborado «ni se compra ni se vende». **Es solo lectura; se corre primero en una copia descartable y, solo con autorización, en una base real; el resultado se informa sin nombres.**

```sql
-- SOLO LECTURA (PROPUESTO; no se corre)
SELECT p."empresaId",
  count(*) FILTER (WHERE p."tipo" = 'MP' AND p."seProduce")                                    AS mp_con_se_produce,
  count(*) FILTER (WHERE p."tipo" = 'MP' AND p."seProduce" AND EXISTS (
      SELECT 1 FROM "RecetaVersion" r WHERE r."empresaId" = p."empresaId" AND r."productoId" = p."id")) AS con_receta,
  count(*) FILTER (WHERE p."tipo" = 'MP' AND p."seProduce" AND NOT EXISTS (
      SELECT 1 FROM "RecetaVersion" r WHERE r."empresaId" = p."empresaId" AND r."productoId" = p."id")) AS sin_receta,
  count(*) FILTER (WHERE p."tipo" = 'MP' AND p."seProduce" AND EXISTS (
      SELECT 1 FROM "MovimientoStock" m WHERE m."empresaId" = p."empresaId" AND m."productoId" = p."id"
        AND m."proceso" = 'COMPRA'))                                                          AS tambien_comprada,
  count(*) FILTER (WHERE p."tipo" = 'PV' AND p."seProduce")                                   AS vendibles_que_se_producen
FROM "Producto" p GROUP BY p."empresaId";
```
(Nombres de tablas y columnas leídos en `prisma/schema.prisma:353-423,778,1302,974`; **NO VERIFICADO** que ejecute tal cual: se prueba en una copia.)

**Qué se hace con cada grupo (PROPUESTA):**
| Grupo | Qué pasa | Corrección |
|---|---|---|
| `con_receta` y no comprada | Se rellena `ELABORADO` (la clase coincide con lo que ya son) | **Ninguna** |
| `sin_receta` | Se rellena `ELABORADO`; sale en el informe como «Elaborado sin receta: pendiente de completar» | Ninguna: la receta se carga cuando se pueda |
| `tambien_comprada` (uso mixto: se compra y se produce) | Se rellena `ELABORADO`; **sus compras viejas no se tocan** (historia inmutable). Pedernal no deja comprar un Elaborado (I4): la compra futura de ese producto se rechaza. | **Sí, a mano por el dueño:** si de verdad se sigue comprando, crear una Materia prima nueva (o Reventa, desde E4) para lo comprado |
| `vendibles_que_se_producen` | Se rellena `VENDIBLE` (como la medialuna que se vende y se produce) | Ninguna |
| `MP` con `seProduce = false` | `MATERIA_PRIMA`; desde E1 **no puede prenderse** «se produce» (respuesta 3 = A) | Quien quiera producirla, crea el Elaborado y desactiva la materia prima |

## 7. Nivel 7 — Atomicidad y concurrencia

- **Alta con clase:** una sola transacción crea el producto con su clase; la clase se escribe en el `INSERT` (nunca en un segundo paso), así no hay estado a medias.
- **Idempotencia del alta:** la clave es la misma que ya usa Motor2 para el alta (`codigo` único por empresa; el id lo manda la app en Pedernal, **NO VERIFICADO** en Motor2): repetir el alta con los mismos datos no crea un duplicado.
- **Relleno:** una transacción por empresa; filtra `IS NULL` dentro de la transacción; dos corridas simultáneas: la segunda no encuentra filas vacías (o espera el bloqueo de fila) y no cambia nada.
- **«Se produce» en materia prima:** el `CHECK` de coherencia y el servidor rechazan el cambio; una edición que llega con «se produce» distinto del guardado falla entera (no a medias).
- **Receta/compra contra clase:** el disparador de inmutabilidad hace que una receta o una compra que miró la clase hace un instante no pueda quedar inválida por un cambio concurrente (la clase no cambia nunca).

### Tabla «¿qué pasa si…?» por comando

| Comando | Repetición | Concurrencia | Tiempo | Incertidumbre | Reintento | Error parcial | Datos faltantes | Cambio de permisos |
|---|---|---|---|---|---|---|---|---|
| **Crear producto con clase** | Mismo alta dos veces: un solo producto (único por empresa) | Dos altas del mismo nombre: gana una, la otra «ya existe» | — | Se corta la red tras el clic: reintento seguro | Idem repetición | Nada a medias (una transacción) | Sin clase: se rechaza (no hay valor por defecto) | Sin permiso de alta: se rechaza en el servidor |
| **Alta rápida** | Idem | Idem | — | Idem | Idem | Nace «Falta completar» | Pide nombre, clase y unidad | Idem |
| **Rellenar existentes** | Segunda corrida no cambia nada | Dos corridas: la segunda espera y no cambia | Una transacción por empresa | **Dudoso (Insumo, Reventa) = no se rellena**, no se inventa | Idempotente | Falla una empresa: solo esa queda sin rellenar | Producto sin `tipo` válido: se informa y se salta | Solo con permiso de plataforma/administración |
| **Prender/apagar «se produce» en una materia prima** | Rechazado siempre (respuesta 3 = A): mismo mensaje | — | — | — | — | — | — | Sin efecto: nadie puede |
| **Filtrar por clase** | (lectura) | (lectura) | — | Clase desconocida en la URL: se ignora (lista de permitidos) | — | — | Sin clase (`NULL`): aparece como «Falta completar la clase» | Solo ve productos de su empresa |

## 8. Nivel 8 — Acceso e interfaces

- **Servidor:** todo valida quién pide y que el producto sea de su empresa (el mismo error si existe en otra empresa: no se revela). La clase **no se acepta del cliente en ediciones** (la edición usa la guardada, como `editarProducto` de Pedernal).
- **Alta:** el campo «¿Qué es?» va **primero**, con su descripción corta debajo; solo se muestran los campos que la clase admite. Sin valor por defecto: el dueño elige a propósito (regla «todo nace cerrado»; en Pedernal el alta arranca en «Producto vendible» como valor de partida de la maqueta, **NO VERIFICADO** si es un valor por defecto real: se verifica antes de la pantalla).
- **Alta rápida desde compra:** ofrece Materia prima, Insumo, Reventa (las comprables). **Desde receta:** ofrece Materia prima, Elaborado, Reventa (los ingredientes; I6). Hoy ambas siempre crean MP (`dar-de-alta-producto-rapido.ts:54`): hasta E3/E4 esa pantalla sigue como está.
- **Lista:** chips «¿Qué es?» en el orden de 4.1; la etiqueta `respaldo` de Motor2 se **mantiene** (no se pidió quitarla).
- **API / acciones:** ningún permiso nuevo; se reutilizan los de alta y edición de producto.

## 9. Nivel 9 — Consultas y experiencia

- **Lista:** fila «Clase · Sección» (como Pedernal); sin clase = «Falta completar la clase».
- **Informe «candidatos a revisar» (solo lectura, E1):** cuántos productos cayeron en cada regla de 6.4 y la lista de dudosos (PV 1:1; MP bajo «No comestibles»). Es la **forma más barata de no inventar**: el dueño ve y decide, sin pantalla nueva de gestión.
- **Reportes que ya dependen de `tipo`/`seProduce`:** valuación, rendimiento de recetas, historial de producto, huecos de catálogo, conteo, traspasos, POS (`grep` de `seProduce` en `src/server/consultas/reportes/*`). En E1 **no cambian**: siguen leyendo `tipo` y `seProduce`. Pasan a leer la clase etapa por etapa, con la prueba de equivalencia de §10.
- **Food cost:** el Insumo queda **fuera** (decisión 77, USAR). Hoy Motor2 ya excluye «No comestibles» por la convención del árbol (`no-comestibles.ts`); al existir la clase, **el resultado debe ser el mismo** (prueba de equivalencia).

## 10. Nivel 10 — Pruebas, migración y operación

### 10.1 Dimensiones y oráculo de combinaciones (regla del 2026-10-28)

**Dimensiones que cambian dinero, permisos, visibilidad o stock:** clase (5) × se vende (derivado) × se compra × se produce × tiene receta × es componente de receta × lo consume una opción × stock propio × aparece en carta/POS × cuenta en el food cost. × estado (activo / desactivado / oculto).

**Oráculo (tabla escrita aparte del código; un test recorre todas las combinaciones contra ella):**

| Clase | Vende (alícuota, sección, precio, opciones) | Se compra | Tiene receta | Es ingrediente de receta | Lo consume una opción | Stock propio | En carta/POS | Cuenta en food cost |
|---|---|---|---|---|---|---|---|---|
| `MATERIA_PRIMA` | No | Sí | No | **Sí** | Sí | Sí | No | Sí |
| `INSUMO` | No | Sí | No | **No** (I6) | Sí (P4) | Sí | No | **No** (77) |
| `REVENTA` | Sí | Sí | No | **Sí** | Sí | Sí | Sí | Sí (su costo de compra) |
| `ELABORADO` | No | No | **Sí** (de tanda) | **Sí** | Sí (12/11, I5) | Sí (se produce) | No | Sí |
| `VENDIBLE` | Sí | No | **Sí** (sin receta: se vende con aviso) | No | No | Solo si se produce | Sí | Es el plato: su costo sale de su receta |

Fuente de cada celda: 5.1, 5.2 y Pedernal `0025`/`0032`. **Celdas NO VERIFICADAS contra Motor2** (se verifican antes de escribir el test): «stock propio de `REVENTA`» y «consumo de `ELABORADO` por opción» (el servidor de Pedernal lo rechaza hoy; Motor2 no tiene opciones que consuman un elaborado). Las demás celdas **ya coinciden con Motor2** en las tres clases derivadas.

- **Guardián:** falla si aparece una dimensión nueva (una columna de `Producto`, una clase, una clave del vocabulario de clases) sin declarar si afecta o no el oráculo (mismo patrón que `docs/oraculo-combinaciones-*.md`). Sin librerías nuevas: exhaustivo (5 clases × pocas dimensiones binarias son pocas combinaciones); `fast-check` solo si el cruce con estados de sucursal crece.
- **Equivalencia de resultado:** antes de que un reporte lea la clase en vez de `tipo`/`seProduce`, una prueba compara ambos resultados sobre los datos de prueba: **el resultado tiene que ser el mismo** (1.2).

### 10.2 Pruebas por etapa

| Etapa | Pruebas |
|---|---|
| E1 | `CHECK` directo contra la base (cada valor permitido y uno no permitido); disparador (cambiar la clase por `UPDATE` directo falla); relleno: tabla de reglas 6.4 fila por fila, **idempotencia** (correr dos veces = lo mismo) y **concurrencia** (dos corridas simultáneas); `down.sql` revierte y deja la base como estaba. |
| E2 | Alta con cada clase (qué campos se aceptan y rechazan: `CAMPO_NO_ADMITIDO_POR_LA_CLASE`); **alta repetida** (idempotencia) y **dos altas simultáneas** (concurrencia); aislamiento entre empresas (otra empresa ve «no encontrado»). |
| E3 | Insumo no entra en receta nueva (versiones viejas intactas); sí lo consume una opción; fuera del food cost; **equivalencia** con la convención «No comestibles». |
| E4 | Reventa: se compra y se vende; conviven con los pares MP+PV actuales; ningún reporte cambia de resultado. |

### 10.3 Operación

Orden: (1) escribir la migración E1 con `down.sql`, llevarla a `main` (autorizado, aditivo); (2) **ensayo del relleno en una copia descartable** con informe; (3) **aplicar en bases reales solo con autorización expresa** (sigue congelado). Ninguna base se toca para este diseño.

## 11. Preguntas de NEGOCIO (respuestas del dueño del 2026-11-15 y una pregunta suya abierta)

### 11.1 Respondidas (CONFIRMADAS)

| # | Clave | Respuesta del dueño (cita literal) | Estado | Qué fija |
|---|---|---|---|---|
| 1 | `relleno-clases-existentes` | «Solo lo seguro; Insumo y Reventa para altas nuevas (Recomendada)» — 2026-11-15, chat dueño ↔ orquestador (opción C) | **CONFIRMADA** | Se rellena Materia prima, Elaborado y Vendible; **Insumo y Reventa solo en altas nuevas**; el packaging existente queda como Materia prima. Sin columna «por confirmar» ni excepción a «la clase no cambia» (6.5). |
| 3 | `se-produce-en-materia-prima` | «No, como Pedernal (Recomendada)» — 2026-11-15, chat dueño ↔ orquestador (opción A) | **CONFIRMADA** | «Se produce» **no se prende ni se apaga** en una materia prima ya cargada; para producir se crea el Elaborado y se desactiva la materia prima. Puede obligar a corregir casos existentes: consulta de solo lectura y qué se hace con cada grupo en **§6.6**. |

### 11.2 Pregunta 2 — `pares-compra-venta-existentes`: **pregunta del dueño: «Como lo hace pedernal?»** (2026-11-15, chat dueño ↔ orquestador). **ABIERTA: no se eligió por el dueño.**

**La respuesta, con evidencia (código de Pedernal `main` leído el 2026-11-15; lo que no leí está marcado NO VERIFICADO):**

1. **Pedernal modela una Reventa como UN solo producto** de clase `REVENTA` que se compra y se vende tal cual. Es comprable (`ERP:src/modulos/catalogo/dominio/clase-comprable.ts:5`, `CLASES_COMPRABLES`) y se vende (`ERP:src/modulos/catalogo/dominio/clases.ts:22`, `vendeLaClase`); lleva alícuota, sección, precio y opciones (`ERP:migraciones/0025_catalogo.sql:177-179`).
2. **Sin receta 1:1.** El stock lo lleva **su propio artículo**: la base lo admite (`ERP:migraciones/0030_stock.sql:420`, `MATERIA_PRIMA`, `INSUMO`, `REVENTA`) y la venta descuenta ese artículo directo: «con artículo activo (reventa): un renglón del artículo × `q`» (`ERP:src/modulos/stock/dominio/explosion.ts:23`, resolución en `:146-155`, `situacionDeConsumo`: `ARTICULO` antes que `COMPOSICION`). Una Reventa sin artículo «no se controla» y **no** da el aviso «falta receta» (`explosion.ts:25-27`; `ZH-docs/11-especificaciones/conceptos/explosion-de-la-venta.md` §«Vender un producto sin receta ni artículo»).
3. **Receta:** una reventa no necesita receta (decisión 140, `ZH-docs/11-especificaciones/catalogo-y-niveles-maqueta.md`, línea 1430, 2026-11-08, «Aceptaste mi recomendación»). La composición propia es solo de `VENDIBLE` y `ELABORADO` (`ERP:migraciones/0032_lotes_y_recetas.sql:113-125`).
4. **Costo:** el de una materia prima o reventa sale del **último costo de compra** y, si nunca se compró, del **costo promedio del depósito de venta** (`ZH-docs/11-especificaciones/conceptos/costo-de-la-receta.md`, línea 14; `ERP:src/modulos/stock/casos-de-uso/lectura-de-recetas.ts:189-211`). Ese cálculo vale para la reventa como ingrediente de otra receta. **NO VERIFICADO:** el costo de una reventa vendida suelta (el cierre de la venta).
5. **Precio:** el del propio producto, en `precio_de_venta` con historial de solo inserción (`ERP:migraciones/0025_catalogo.sql`, K5 y K6, líneas 43-52).
6. **Marcas de lo mismo (gaseosas):** productos independientes dentro de una **familia**, cada uno con su código de barras, stock, costo y compra (`ZH-docs/11-especificaciones/decisiones-del-dueno-2026-11.md`, línea 91, 2026-11-12, punto a), que **prevalece sobre** la decisión 81 del 2026-11-08 (marcas como opciones de un solo producto).

**¿Pedernal tuvo o resolvió el caso de dos productos (materia prima + producto de venta con receta 1:1)?** **No lo tuvo.** El catálogo de Pedernal nace en `0025` como «PRIMERA migración del catálogo: no hay ninguna tabla de catálogo que migrar» (`ERP:migraciones/0025_catalogo.sql`, líneas 9-10), con la clase elegida desde el alta. El único estudio de Pedernal sobre pasar de Motor2 es `ZH-docs/11-especificaciones/migracion-de-la-carta-de-motor2-especificacion.md` (condicionado y **no confirmado** por el dueño, según su propio encabezado): ahí un `PV` de Motor2 se convierte en `VENDIBLE` o `REVENTA` **sin inferirlo** («la elige el dueño producto por producto», P3, línea 93; regla de lectura: «lo que se compra hecho y se vende igual = reventa; lo demás = vendible», línea 445), y las materias primas, recetas y stock **quedan fuera de esa tanda** (líneas 48 y 90): **no resuelve el par MP+PV**. **NO VERIFICADO:** que exista otro documento de Pedernal que lo resuelva.

**Qué pasaría en Motor2 con cada opción:**

| | **A. Conviven** | **B. Se unen, par por par, con el dueño** | **C. Se unen todos de una vez** |
|---|---|---|---|
| **Qué se hace** | Nada sobre lo cargado. Los pares siguen como Materia prima + Vendible. Reventa es para lo que se cargue desde E4. | Por cada par: se crea el producto `REVENTA` nuevo y se **desactivan** la Materia prima y el Vendible viejos (no se cambia la clase: regla del 2026-11-13). | Lo mismo, para todos los pares, sin revisar uno por uno. |
| **Stock** | La Materia prima sigue con su stock; la venta del Vendible la descuenta por la receta 1:1, como hoy. | El stock del par viejo **no se mueve solo**: el nuevo arranca con un ingreso inicial (**NO VERIFICADO** que Motor2 tenga un motivo de ajuste con costo para eso). El Kardex viejo queda intacto, en el producto desactivado. | Ídem, en bloque. |
| **Recetas** | Intactas. | La receta 1:1 del Vendible viejo queda en su historial; el Reventa nuevo no lleva receta. Las **recetas de otros platos** que usan esa Materia prima apuntan al viejo y hay que reapuntarlas a mano (**NO VERIFICADO** cuántas hay). | Ídem, y si alguna no se reapunta, ese plato descuenta del producto desactivado. |
| **Costos** | Siguen: último costo de compra de la Materia prima. | El costo **empieza de cero** en el nuevo (sin compras propias) hasta la primera compra o hasta un ingreso inicial con costo; el historial de costos queda partido en dos. | Ídem, en bloque. |
| **Ventas ya registradas** | Intactas. | Intactas: quedan apuntando al Vendible desactivado (la historia no se reescribe). Los reportes por producto muestran dos filas (viejo y nuevo). | Ídem. |
| **Riesgo / reversibilidad** | Ninguno. Convive la forma vieja y la nueva (se ven dos formas de cargar lo mismo). | Medio: es trabajo manual y cada par se puede revisar; se revierte reactivando el viejo mientras no haya movimientos nuevos. | **Alto: destructivo para los reportes y fuera de la autorización permanente** (no es aditivo ni reversible). |

**Recomendación: A.** Es lo más barato, no toca datos y deja la unión (B) para después, **si el dueño la quiere**, sin ninguna herramienta nueva: coincide con la regla de Pedernal (la clase no cambia; se crea el correcto y se desactiva el otro). **Qué pasa si no se responde:** rige **A**. **Opción C: no se recomienda.**

## 12. Decisiones técnicas (no cambian negocio; las toma el ingeniero y el dueño las puede corregir)

| # | Decisión | Estado |
|---|---|---|
| D-T1 | **No se renombra** el modelo `Insumo` (familia) ni la pantalla «Maestros → Insumos». En el alta, «Insumo» es la clase (operativo). Riesgo de confusión declarado; **sugerencia (no implementada):** llamar «Familia» al nodo en pantalla, solo si el dueño lo pide. | PROPUESTA |
| D-T2 | `claseDeUso` como **texto con `CHECK`**, no `enum` de Postgres (igual a Pedernal, agregar valor = cambiar un `CHECK`). | PROPUESTA |
| D-T3 | **Disparador de inmutabilidad** (la clase se escribe una vez). Motor2 ya usa disparadores en 11 migraciones. | PROPUESTA |
| D-T4 | Relleno por **script con ensayo previo**, no por SQL puro (reutiliza `no-comestibles.ts`; no duplica la regla). | PROPUESTA |
| D-T5 | La etiqueta `respaldo` de la lista **se mantiene** (no se pidió sacarla). | PROPUESTA |
| D-T6 | Hasta E4, `tipo` **sigue siendo la fuente** de lo que habilita compra, venta y receta; la clase se suma al lado. | PROPUESTA |
| D-T7 | Las 5 etiquetas y 5 descripciones se agregan al archivo de textos de la lista de Motor2 (`ETIQUETA_DEL_TIPO` hoy tiene 4 claves distintas) como **un solo cambio**, con test de que no falta ninguna. | PROPUESTA |

## 13. Etapas de implementación (la más barata primero; cada una se usa sola)

| Etapa | Qué | Migración | Depende de |
|---|---|---|---|
| **E0** (hecha en el diseño del 13/11) | La lista ya dice «Materia prima / Elaborado / Producto vendible» derivadas. Nada que construir. | No | — |
| **E1** | Columna `claseDeUso`, `CHECK`s, disparador, **relleno con ensayo** e informe «candidatos a revisar» | **Sí, aditiva, con `down.sql`** | Preguntas 1 y 3 (o sus opciones por defecto) |
| **E1b** | `NOT NULL` sobre `claseDeUso` cuando no queden filas vacías | Sí, aditiva | E1 aplicada y rellena |
| **E2** | Alta y ficha con «¿Qué es?» + descripción corta; la lista lee la clase real; chips de las 5 | No | E1 |
| **E3** | **Insumo**: alta, fuera de receta nueva, fuera del food cost, consumible por una opción | No (o relaja un `CHECK`) | E2; pregunta 1 |
| **E4** | **Reventa**: se compra y se vende en una sola ficha; relaja `Producto_claseDeUso_tipo_chk`; toca el uso de `tipo` | Sí, aditiva | E3; pregunta 2 |
| **E5** | Reportes leen la clase (de a uno, con prueba de equivalencia) | No | E2 |

**Verificación end-to-end de cada etapa (gate obligatorio, en la MISMA corrida y todo limpio):** `npx tsc --noEmit`, `npm run lint`, `npm run arquitectura`, `npm run analizar:muerto`, `npm test`, `npm run build`, `npm run plataforma:build` y `npm run test:e2e`.

## 14. Diferencias con Pedernal declaradas (cada una con su motivo)

| Diferencia | Motivo | Estado |
|---|---|---|
| Columna **opcional** y con relleno (Pedernal nace con la clase en el alta) | **Datos ya existentes** en producción | Imposición de los datos |
| `tipo` MP/PV sigue vivo junto a la clase | **Datos y código existentes** (~63 archivos lo leen) | Imposición |
| Etiqueta `respaldo` en la lista | Existe en Motor2 y nadie pidió sacarla | PROPUESTA |
| Columna por `Prisma` (`String?` + `CHECK` a mano) en vez de SQL puro | **Prisma** | Imposición |
| Reventa llega en E4 y el par MP+PV existente convive | Datos existentes + costo | Depende de la pregunta 2 |

## 15. Cosas NO VERIFICADAS (para que nadie las dé por hechas)

1. Si las concesiones de la aplicación sobre `Producto` son **por columna** (afecta si hace falta un `GRANT`).
2. Si el id del alta lo manda la app (idempotencia) en Motor2, o si basta el `codigo` único.
3. Si la alta de Pedernal arranca con «Producto vendible» elegido por defecto (la maqueta lo dice; no leí la pantalla real).
4. Cuántos productos reales caerían en cada regla del relleno (**no se leyó ninguna base**; el informe lo da, sin nombres, antes de aplicar).
5. Que el servidor de Motor2 acepte hoy que una opción consuma un elaborado (supuesto de P4/I5: no se leyó `guardar-consumo`).
6. El nombre exacto del permiso de alta de producto en Motor2 (se reutiliza, no se crea).

## 16. Fuentes leídas

- `AGENTS.md` (Motor2): escalera de 10 niveles, «todo nace cerrado», «lo que el dueño no pidió no entra», «paridad con Pedernal».
- `docs/diseno-productos-igual-a-pedernal-2026-11-13.md` (§8, fila 2 y M1; D2, D17).
- `motor2-docs`, rama `alegp/stoic-davinci-185dm4`: `_planes/plan-de-paridad-con-pedernal-2026-11-14.md` (E6, R6) y `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`.
- Pedernal `ERP` (`migraciones/0025_catalogo.sql`, `0030_stock.sql`, `0032_lotes_y_recetas.sql`, `0049_producto_oculto_en_stock.sql`; `src/modulos/catalogo/dominio/clases.ts`, `clase-comprable.ts`; `src/capacidades/vocabulario/catalogo-catalogo.ts`; `apps/web/ui/plantillas/catalogo/filtros-de-productos.ts`) y `ZH-docs` (`conceptos/clase-de-uso.md`, `e2-catalogo-minimo-especificacion.md` §3.3, `catalogo-y-niveles-maqueta.md` decisiones 69, 77, 131, 139).
- Motor2 `origin/main`: `prisma/schema.prisma` (`TipoProducto`, `Producto`, `Insumo`), `src/core/catalogo/*` (`filtros-de-productos`, `espacio-del-producto`, `receta-validacion`, `no-comestibles`), `src/core/movimientos/transiciones.ts` (`tieneStockReal`), `src/server/actions/catalogo/casos-de-uso/*`.
