# Línea de base de la ola «precio y carta» (Fase 0, 2026-10-19)

Documento de la **Fase 0** de la hoja de ruta «Motor2: resultado esperado» (decisiones DEC-01 a DEC-36 de la sesión del 2026-10-19). Fija, ANTES de tocar nada, tres cosas:
el estado del gate, lo que el sistema cobra y muestra hoy, y los inventarios sobre los que se apoyan las fases siguientes. Todo lo que dice «VERIFICADO» se leyó en el código o se ejecutó; las
cifras de producción vienen de consultas de solo lectura del 2026-10-19 (proyecto Neon `inventario-api`, rama `main`: 1 empresa, 6 sucursales, 51 productos de venta).

Esta fase **no cambia ninguna pantalla ni ningún comportamiento**. Los tests que agrega congelan lo que existe, incluidas las divergencias que hoy son errores (ver «Divergencias que la línea de base
congela sin corregir»): están ahí para que, cuando una fase posterior las corrija, el cambio quede escrito y declarado en `test/arquitectura/caracterizaciones-congeladas.test.ts`.

## 1. Punto de partida

| Hecho | Valor |
|---|---|
| Rama y commit | `alegp/stoic-davinci-185dm4`, `4670e36` (árbol limpio al empezar) |
| Migraciones | 141 (la última, `20261021111000_go3a_rls_sucursal_combinaciones`) |
| Node | v22.22.0 (CI usa 24: posible diferencia de conteo o comportamiento) |
| Postgres de esta corrida | 16.15 local descartable (CI usa 17) |
| Base | cluster propio en `127.0.0.1:5433`, fuera del repo; ninguna variable `*DATABASE_URL` apunta a otro host; no hay `.env` |

## 2. Línea de base del gate (8 comandos, sobre `4670e36` sin cambios)

Corrida del 2026-10-19 en un contenedor de 4 núcleos y 15 GB, contra Postgres 16 local descartable. Los 8 comandos del gate de `AGENTS.md`, sobre `4670e36` sin cambios:

| # | Comando | Resultado | Tiempo |
|---|---|---|---|
| 1 | `npx tsc --noEmit` | Salida vacía, código 0 | 13 s |
| 2 | `npm run lint` | Código 0, sin errores ni warnings | 300 s |
| 3 | `npm run arquitectura` | Código 0: «no dependency violations found» (1.178 módulos, 5.491 dependencias) | 6 s |
| 4 | `npm run analizar:muerto` | Código 0, sin hallazgos (una pista de configuración de knip sobre `.css`, no es un hallazgo) | 6 s |
| 5 | `npm test` | **13.298 tests pasados, 0 fallidos** en 1.003 archivos | 68 min |
| 6 | `npm run build` | Pasa con `NODE_OPTIONS=--max-old-space-size=6144` (153 s). Con el heap por defecto de Node 22 el paso de TypeScript de Next se queda sin memoria (código 1): es del entorno, no del código | 153 s |
| 7 | `npm run plataforma:build` | Código 0 | 38 s |
| 8 | `npm run test:e2e` | **672 pasados**, 1 falló y 3 no corrieron (676 en total) | 34 min |

Sobre el e2e: el único fallo fue `usuarios-invitacion.spec.ts:126` («con la sesión de la persona invitada…»: esperaba «Este enlace ya no sirve» al reusar el enlace). **Corrido solo, el archivo
pasa 8 de 8**, así que depende del orden o del tiempo y no de un cambio de código; los 3 que no corrieron son del mismo archivo (dependen de ese test). Se toma como **falla intermitente
preexistente**: si reaparece en el gate final de la ola no es una regresión de la ola. Condiciones del entorno: el navegador que busca Playwright (chromium 1243) no estaba instalado y se enlazó el
instalado (Chromium 141); el rol de pruebas separado no estaba definido en esta máquina (los fixtures siembran con el rol de la app, es el aviso `[tests]` del log). Un primer intento del e2e falló entero
(624 fallos) solo por el navegador faltante: no cuenta.

Referencia para comparar al cierre de la ola: **13.298 tests** de Vitest y **676 tests** de Playwright (más los que agreguen las fases).

## 3. Qué se cobra y qué se muestra hoy

El catálogo de referencia (`test/setup/referencia-precio-y-carta.ts`) reproduce las configuraciones reales de producción (pizzas con precio absoluto, milanesas con terminación absoluta y
variante «Milanesas de», café con tamaño absoluto y preparación, bife con guarnición incluida) y los casos CU-01 a CU-12 del paquete de auditoría. Las caracterizaciones que lo recorren:

- `test/caracterizacion-precio-y-carta/precios.test.ts` (funciones puras): precio de venta, vista previa del POS, resumen del POS, resumen de la carta pública y lo que la carta dibuja.
- `test/caracterizacion-precio-y-carta/combinaciones.test.ts` (funciones puras): lo mismo para las combinaciones GO-3a (CU-07 y CU-11), **en un golden aparte** para que el retiro de GO-3a (Fase 3) no mueva el golden de los demás productos. Su catálogo es `test/setup/referencia-combinaciones.ts`.
- `test/caracterizacion-precio-y-carta/cobro-y-carta.test.ts` (Postgres real): el precio que realmente se cobra al agregar la línea, las fotos congeladas y la carta resuelta.
- `test/e2e/linea-de-base-precio-y-carta.spec.ts` (navegador): el texto visible de la carta pública y de las pantallas de catálogo, y capturas PNG opcionales (`MOTOR2_LB_CAPTURAS=<carpeta fuera del repo>`).

Precedencia real del precio (VERIFICADA leyendo el código; el golden de las funciones puras la ejecuta), de lo que más manda a lo que menos:

1. Combinación inactiva: rechaza la venta (`core/opciones/combinaciones.ts:131`).
2. Precio local de la sucursal de la combinación, o el de su tarifa (`:137`, `:142-143`).
3. Precio propio de la combinación, o el de su tarifa; son excluyentes por CHECK (`:135`, `:138`, `:144`). Con un precio P la base pasa a ser P, el tamaño del eje pasa a «ABSOLUTO P» y las
   variantes de los ejes quedan sin diferencia; las opciones que no son eje se siguen sumando, con sus porcentajes calculados sobre P (`:152-161`).
4. Sin precio de combinación rige el aditivo:
   - tamaño en ABSOLUTO: la grilla de la sucursal le gana al `precioAbsoluto` (`core/pos/precio-de-configuracion.ts:22-24`) y reemplaza la base (`core/opciones/componer-precio-de-linea.ts:258-259`);
   - tamaño en DIFERENCIA y variante: la diferencia del producto le gana a la de la versión (`precio-de-configuracion.ts:26-28`);
   - **los porcentajes de una variante se calculan siempre sobre el precio base del producto, aunque haya un tamaño ABSOLUTO** (`componer-precio-de-linea.ts:19-20`, `:149-151`, `:204`); con base 0 aportan 0.
5. Base: el precio local del producto habilitado (si la capacidad `precio_local` está prendida) o `Producto.precioVenta` (`core/carta/armar-menu.ts:253-254`; `server/actions/pos/casos-de-uso/agregar-items.ts:149`).
6. Descuento de producto: se aplica sobre la lista compuesta, nunca sobre el adicional (`precio-de-configuracion.ts:175`).

La tabla §3.1 del paquete de auditoría no decía tres cosas: que tarifa y precio propio son excluyentes, que el precio local de la combinación (o de su tarifa) le gana a ambos, y que el porcentaje
se calcula sobre la base del producto.

### Casos CU-01 a CU-12: ¿hoy dan lo esperado?

| CU | Esperado (paquete) | Hoy | Resultado |
|---|---|---|---|
| 01 | $4.000 | Sin opciones, la lista es la base | Sí |
| 02 | $20.000; la guarnición no cambia el precio | La incluida aporta 0; si es distinta de 0 se rechaza | Sí |
| 03 | $20.000 más una línea hija de $2.000 | El adicional va en otra línea | Sí |
| 04 | Precio final $20.000 | Solo con tamaño ABSOLUTO, combinación con precio, o base 0 con variante. Con variante y base mayor que 0 se suma (la trampa de $38.000) | Depende de cómo se cargó |
| 05 | Un precio; una sola elección | Queda **una fila `OpcionElegidaEnLinea` por opción**; `CombinacionEnLinea` solo si hay ejes y existe la fila | Parcial |
| 06 | Napolitana + Pollo = $25.000 | Sí, con la terminación como tamaño ABSOLUTO, o como variante +5.000 sobre base 20.000 | Sí |
| 07 | 20/22/25/27 mil sin sumas accidentales | Sí con el aditivo (Pollo +2.000) y con combinación PROPIO | Sí |
| 08 | `Pizza muzzarella $18.000`, sin encabezado | El producto base sale como ítem con su nombre y la lista de «tamaños» debajo | No |
| 09 | Encabezado + Simple/Napolitana + «De: Carne · Pollo» | Con la terminación como tamaño ABSOLUTO: lista con precios y pastillas; como variante con recargo: «Adicionales: Napolitana +$5.000», relativo a la más barata | Parcial |
| 10 | Tamaño de café con precio absoluto | Existe | Sí |
| 11 | Combinación apagada no se vende | En la venta y en el POS sí; **la carta pública la sigue mostrando** | Parcial |
| 12 | Receta propia por combinación | Existe | Sí |

## 4. Divergencias que la línea de base congela sin corregir

Son comportamientos de hoy que los goldens fijan tal cual. **No están aprobados**: son la foto contra la cual se mide cada fase.

1. **La carta pública no ve las combinaciones.** Usa `resumenDePrecios` sin combinaciones (`src/server/lecturas/carta/menu.ts:7`, `:122`; `src/server/consultas/carta/mantenimiento.ts:74`) y en `src/core/carta`, `src/server/lecturas/carta` y `src/components/carta-publica`
   no aparece «combinac». Las combinaciones solo entran en el selector del POS (`src/server/consultas/pos/opciones-del-selector.ts:79`), el diálogo (`src/app/(pos)/mesas/[mesaId]/elegir-opciones.tsx:75`) y el cobro (`agregar-items.ts:165`).
   Consecuencia: con una combinación de precio propio o de tarifa, la carta muestra el precio aditivo y se cobra otro; una combinación apagada sigue visible en la carta. **Producción no tiene ninguna combinación** (0 filas).
2. **El ajuste masivo «Precios» de la carta no toca los precios de las opciones** (`core/carta/ajuste-de-precios.ts` no menciona opciones ni grupos).
3. **Un producto con base 0 y opciones sin costo no es vendible, aunque el grupo se pueda asignar.** `fijar-admision-de-grupo-en-producto.ts:162-163` corre `controlarPrecioDeLista` solo si el precio de venta es mayor que 0, así que con
   base 0 la asignación **pasa**. Lo que falla es después: el resumen de precios descarta la opción cuya lista da menos de 0,01 (`core/opciones/componer-precio-de-linea.ts:261`, `core/pos/precio-de-configuracion.ts:77-81`, `:100-103`) y, si el
   grupo era obligatorio, el producto deja de ser vendible y sale de la carta y del POS. El paquete decía que «el producto sin precio propio ya existe de hecho»: es **parcialmente falso**. Esta divergencia fundamenta la decisión de
   bloquear el precio de una base configurable **conservando el valor guardado**, no poniéndolo en 0. (Corrección del 2026-10-19: el borrador de esta fase decía que la asignación se rechazaba.)
4. **Quitar un grupo de un producto no valida nada** (`vincular-grupo-en-producto.ts:15-16,46-59`): la barrera de la venta solo frena a los productos con un grupo obligatorio admitido (`registrar-venta-en-tx.ts:131-134`), así que un producto al que se le saca
   su grupo de precio se vende como línea suelta al precio guardado (`agregar-items.ts:149,170-187`). Hoy no hay productos con modo «base», por eso no se nota; lo cierra la Fase 4.
5. **El «registro por columna» de la auditoría no vive en `core/permisos/auditoria.ts`** (ahí se registran entidades) sino en `test/arquitectura/auditoria-por-columna.test.ts` y `escrituras-auditadas.test.ts`: dato para las fases con columnas nuevas.

## 5. Inventario P6: consumidores de `Producto.precioVenta` (fuera de tests)

Son **48 archivos de `src`** que nombran `precioVenta` como palabra (el paquete decía unos 40); 6 son falsos positivos (comentarios: `core/permisos/auditoria.ts:126`, `core/features/carta/mantenimiento.schema.ts:85`, `core/carta/mantenimiento.ts:34`;
precio de la línea de venta y no del producto: `core/movimientos/filas-de-venta.ts:91-103`, `plan-de-la-venta.ts:22`; tipo del formulario: `server/lecturas/catalogo/datos-de-producto.ts`). Quedan unos 42. Fuera de `src` lo usan 6 scripts.

Las dos variantes evaluadas para un producto «base configurable»: **bloquear el precio y conservar el valor guardado**, o **dejarlo en 0**.

| Clase | Archivos (evidencia) | Si se conserva el valor | Si queda en 0 |
|---|---|---|---|
| Cobra | `pos/casos-de-uso/agregar-items.ts:149,165`; `movimientos/casos-de-uso/registrar-venta-en-tx.ts:181`; `lecturas/pos/entradas-de-promo-para-vender.ts:98`; `carta/casos-de-uso/componentes-de-combo-en-tx.ts:42-47`; `consultas/carta/menu-del-dia.ts:40`; `lecturas/movimientos/precio-venta.ts` | No cambia nada; el cobro se mantiene | **Se rompe:** cambia el cobro de lo cargado por diferencia o porcentaje; un producto sin grupos obligatorios se vende a $0 (no hay control mayor que 0 en `agregar-items.ts:142-185`); combos y menú del día rechazan el componente (`core/pos/componente-de-combo.ts:43-47`) |
| Muestra | carta: `core/carta/armar-menu.ts:253,330,371`, `lecturas/carta/menu.ts:121`, `consultas/carta/admin.ts:132,217`, `consultas/carta/mantenimiento.ts:46-47`, `carta/casos-de-uso/agregar-opcion-item-agrupado-carta.ts:84-85`, `lecturas/carta/grupo-de-producto.ts:41`; POS: `lecturas/pos/selector-carta.ts:113`; catálogo: `productos/[id]/page.tsx:126`, `[id]/editar/page.tsx:53`, `producto-form.tsx:126-128,318-328`, `consultas/catalogo/opciones-de-venta.ts:140,260`, `consultas/catalogo/combinaciones.ts:45`, `movimientos/precio-local/page.tsx:66`, `actions/movimientos/precio-local.ts:34`, `actions/catalogo/productos.ts:179` | Distorsiona: muestra un «precio de venta» que no es el que se cobra | **Se rompe:** «$0» en la ficha y en el precio local; el resumen descarta las opciones sin costo y el producto puede salir de la carta y del POS |
| Margen y costo | `core/reportes/costos.ts:195-217,371-376`; `lecturas/reportes/costos.ts`; `core/reportes/comun.ts:95`; `lecturas/reportes/comun.ts`; `core/reportes/periodo-ventas.ts:34-37`; `consultas/reportes/periodo.ts`; `reportes/costos/tabla-costos.tsx:36`; `core/reportes/periodo-precios.ts`; `consultas/reportes/periodo-precios.ts:170` | Distorsiona: margen y food cost contra un precio que no se cobra | Distorsiona: queda `SIN_PRECIO_VENTA` y margen nulo (`costos.ts:198-201`); las ventas estimadas valen $0 (`periodo-ventas.ts:36`); la auditoría registra una variación de -100 % |
| Ajuste masivo y validación | `catalogo/casos-de-uso/ajustar-precios-de-la-empresa.ts:37-61`; `movimientos/casos-de-uso/ajustar-precios-de-la-carta.ts:43-61`; `actualizar-producto.ts:94-192`; `dar-de-alta-producto.ts:72`; `actualizar-disponibilidad-producto.ts:82`; `fijar-admision-de-grupo-en-producto.ts:162`; `core/features/catalogo/productos.guard.ts:105` | Distorsiona: «Precios» de la carta mueve la base oculta; al tamaño ABSOLUTO no le hace nada, pero sí cambia lo cargado por diferencia | **Se rompe:** no deja asignar grupos sin costo; el ajuste porcentual queda en 0 sin efecto |
| Sincroniza | `catalogo/casos-de-uso/sincronizar-precio-grupo-carta.ts:44-50`; `core/carta/grupo-de-producto.ts:48`; `persistencia/catalogo/productos.ts:67-68` (escritor) | Distorsión menor | Propagaría 0 a los hermanos si se acepta |

**Conclusión para DEC-18 (columna explícita del modo del producto):** conservar el valor guardado no rompe nada y mantiene el cobro; solo distorsiona lo que se muestra y los reportes. Dejarlo en 0 rompe la asignación de grupos, la carta, el POS, los combos y el cobro de lo cargado por diferencia.

## 6. Control de versión en las escrituras de precio

La cifra del paquete («16 de 234 archivos de acciones con control de la versión vista») salía de una expresión regular angosta; con una más amplia son **29 de 234**.
**`GrupoDeOpciones` sí usa `version`:** la persistencia hace `updateMany where {id, version: versionEsperada}` con `version: {increment: 1}` (`src/server/persistencia/catalogo/opciones-de-venta.ts:34-56`), el caso de uso devuelve `VERSION_DESACTUALIZADA` (`editar-grupo-de-opciones.ts:54`) y la pantalla manda la versión que vio.

| Escritor | Control propio | ¿Lo hereda del llamador? |
|---|---|---|
| `catalogo/casos-de-uso/actualizar-producto.ts` | **No**: lee sin candado y gana el último que escribe, si tiene la clave (`:163-166`) | No: lo llama `actions/catalogo/productos.ts:343-349` sin versión |
| `movimientos/casos-de-uso/set-precio-local-producto.ts` | **No** (READ COMMITTED, `:18`) | No: lo llama `actions/movimientos/precio-local.ts:53` |
| `movimientos/casos-de-uso/guardar-precio-local-en-tx.ts` | No: es un paso compartido | Solo cuando lo llama `ajustar-precios-de-la-carta.ts:54-61` (precio visto, SERIALIZABLE); no desde `set-precio-local-producto.ts:31` ni `sincronizar-precio-local-grupo-carta.ts:38` |
| `movimientos/casos-de-uso/sincronizar-precio-local-grupo-carta.ts` | **No**: solo exige que la sucursal de la pantalla sea la activa (`core/features/movimientos/precio-local.guard.ts:26`) | No |
| `carta/casos-de-uso/guardar-precio-local-promo-carta.ts` | **No**: es SERIALIZABLE pero compara con el anterior solo para auditar (`:52-56`) | No |
| `catalogo/casos-de-uso/sincronizar-precio-grupo-carta.ts` (faltaba en el paquete) | **No** (`:25`, `:29`); escribe `Producto.precioVenta` | No |
| `catalogo/casos-de-uso/fijar-precio-local-de-opcion.ts` | **Sí**, por valor: `esperado` y `PRECIO_DESACTUALIZADO`, SERIALIZABLE (`:21-30`, `:64`) | — |
| `catalogo/casos-de-uso/fijar-precio-local-de-combinacion.ts` | **Sí**, por valor (`:16-23`, `:57`) | — |
| `ajustar-precios-de-la-empresa.ts` y `ajustar-precios-de-la-carta.ts` | **Sí**, por `precioVisto` (`:17-23,47` y `:17-21,54`) | — |

Además la venta compara el precio de lista que vio el mozo (`PRECIO_CAMBIO`, `agregar-items.ts:158-171`). **Siguen sin control los cinco escritores de precio marcados «No»**: es el alcance de la Fase 2.

## 7. Supuestos del paquete de auditoría que resultaron falsos

1. «La carpeta no incluye `.git`»: sí lo incluye.
2. «El precio por combinación se usó para lograr cómo se ve la carta y quitarlo degrada la carta real»: la carta pública no lee combinaciones (`menu.ts:122`); además producción tiene 0 combinaciones.
3. «`fijar-precio-local-de-opcion` y `-de-combinacion` no tienen control de versión»: sí lo tienen, por valor. Falta en su lista `catalogo/…/sincronizar-precio-grupo-carta.ts`, que no controla. Y `sincronizar-precio-grupo-carta` y `sincronizar-precio-local-grupo-carta` son dos archivos distintos.
4. «Unos 40 consumidores de `precioVenta`»: son 48 por palabra y unos 42 reales.
5. «Un producto con precio 0 es válido; el producto sin precio propio ya existe de hecho»: con base 0 no se pueden asignar opciones sin costo y el producto puede dejar de ser vendible.
6. La precedencia de §3.1 no decía que el porcentaje se calcula sobre la base del producto aunque rija un tamaño ABSOLUTO, ni que el precio local de la combinación o de la tarifa le gana al precio propio.
7. Las capturas del paquete (390 px) no coinciden con la convención del repo (375 y 1280 px, `test/e2e/carta-publica.spec.ts`): no es un error, es otra convención.

## 8. Qué NO hace esta fase

- No toca `prisma/schema.prisma` ni `prisma/migrations/`: **no requiere autorización de migración**.
- No crea ni borra ramas de Neon, y no escribe en ninguna base que no sea local.
- No corrige ninguna divergencia de la sección 4.

## 9. Cómo se verifica durante la ola (decisión del dueño, 2026-10-19)

Por tiempo (el gate completo tarda unas 2 horas en este equipo), `AGENTS.md` exige el gate de 8 comandos "en la misma corrida" por tarea, y para esta ola el dueño decidió un esquema por niveles:

- **Cada commit:** `tsc`, lint y los tests de lo tocado, más siempre la caracterización de precio y carta (la red del precio cobrado). Si el commit mueve importaciones o borra código: también `arquitectura` y `analizar:muerto`.
- **Cada fase:** los 4 estáticos y los tests de su zona.
- **Gate completo local (los 8 comandos):** una sola vez, **al final de la ola y antes de abrir el pull request**. El CI de GitHub solo corre en `main`, en ramas `ci/**` y en pull requests hacia `main`: empujar a la rama de trabajo no lo dispara.
- Ninguna migración se aplica a producción durante la ola; todas esperan al gate final, con respaldo, ensayo y autorización expresa.

Riesgo asumido: un fallo que solo se ve con la suite entera (por ejemplo, concurrencia) puede aparecer varios commits después. Se mitiga corriendo, junto con cada cambio, las pruebas de la zona y las de concurrencia al tocar escrituras de dinero.
