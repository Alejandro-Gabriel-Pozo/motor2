# Diseño: carta «B» con invitación 5+2 y descripción de las opciones (2026-11-04)

Estado: **BORRADOR en papel para el dueño.** Niveles 1 a 5 de la escalera de diseño; los niveles 6 a 10 están esbozados y **no se migra nada** hasta que el dueño confirme 1 a 5. Cada decisión lleva su estado: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE o NO VERIFICADA. Todo lo que se dice del código sale de una lectura (agente de solo lectura sobre `df3cd634`, 2026-11-04); **no se ejecutó ningún test ni se tocó ninguna base**.

Maquetas (se entregaron al dueño por fuera del repositorio: el guardián de clasificación solo admite Markdown dentro de `docs/`; los verdes de las maquetas son **solo de ejemplo**, ver I18): `en-todos-variantes.html` (cinco variantes), `invitar-a-bajar.html` (cinco formas de invitar a bajar) y `carta-b-5mas2-descripciones.html` (la composición final a tamaño real).

## 0. Resumen para el dueño

- **Qué se quiere (CONFIRMADO por el dueño, 2026-11-04):** (1) la variante **B** de carta: cada plato dice «Incluye guarnición» o «Incluye salsa», y las opciones van **al pie en texto, sin chips**, atadas a cada plato (reemplaza el rótulo «En todos»); (2) la invitación **5+2**: «elegí abajo ↓» más las palabras «guarnición» y «salsa» tocables, que bajan al bloque y marcan los platos que lo incluyen; (3) la **descripción B**: un texto opcional por opción (ej. «tomate, albahaca, ajo»), que escribe el dueño y se ve **solo en la carta**.
- **Hallazgo que cambia el tamaño:** el texto «Incluye guarnición» **no existe hoy** en el código. Hoy la carta imprime el rótulo del grupo y sus opciones («Guarnición: ensalada · papas fritas · puré») y, desde la PR #137, el rótulo «En todos». La variante B es entonces un **cambio de presentación de la carta**, además de la descripción. Tampoco existe ningún campo de descripción por opción.
- **Etapas (la más barata primero, cada una se puede frenar):** E1 carta B (sin migración) → E3 descripción (1 columna, migración reversible ya autorizada) → E2 invitación 5+2 (código de pantalla, sin migración).
- **Resuelto el 2026-11-04:** desplegable por bloque y un solo grupo por cosa, con cada plato tildando sus opciones. **Queda una decisión menor (§8):** el rótulo genérico del desplegable.

## 1. Propósito y alcance

- **Necesidad (CONFIRMADA):** el rótulo «En todos» no decía a qué platos se refería ni hasta dónde llegaba (pedido del dueño, 2026-11-03, con sus capturas «Platos principales»); el cliente no sabe qué lleva cada salsa (pedido del dueño del 2026-10-29, `docs/` y maqueta de descripciones); las opciones al pie pueden quedar fuera de la pantalla del celular (pedido del 2026-11-04, probado a tamaño real: con 5 platos y salsas descriptas el bloque termina en ~848 px y una pantalla útil llega a ~750 px).
- **Dentro:** presentación de grupos y opciones en la carta pública, impresa, vista previa del producto y «Va a mostrar»; la columna de descripción y su carga por el administrador.
- **Fuera (PROPUESTA):** ticket, comanda, POS, stock y reportes **no** muestran la descripción; no se toca el precio ni las versiones de la opción; no se toca la receta ni el stock; descripciones por sucursal o por idioma; formato con negritas o enlaces.

## 2. Actores

| Actor | Qué hace | Permiso (existente) |
|---|---|---|
| Comensal | Lee la carta en el celular o en papel; toca «guarnición» o «salsa» | ninguno (carta pública) |
| Administrador del catálogo | Escribe o corrige la descripción de una opción | `opciones_definir` (empresa, administrador); desde el producto además `producto_opciones_admitidas` |
| Cocina y caja | No ven la descripción | — |

## 3. Casos de uso

| # | Caso | Resultado |
|---|---|---|
| CU1 | El comensal ve qué incluye cada plato | «Incluye guarnición y salsa» bajo el plato; al pie, un bloque por grupo |
| CU2 | El comensal toca «salsa» | baja al bloque, lo ilumina y marca con una barra los platos que lo incluyen |
| CU3 | El administrador escribe «tomate, albahaca, ajo» en la opción «Salsa filetto» | el bloque muestra la salsa con su descripción |
| CU4 | Una opción no tiene descripción | el bloque muestra solo el nombre (como hoy) |
| CU5 | La carta se imprime | mismo texto, **sin** interacción; «elegí abajo ↓» pasa a una referencia de papel |
| CU6 | El administrador ve cómo queda | vista previa del producto y «Va a mostrar» con la misma regla |
| CU7 | Un grupo se oculta en la carta («Mostrar este grupo en la carta» apagado) | no aparece su línea «Incluye…», ni su bloque, ni las descripciones |

## 4. Conceptos y ciclo de vida

- **Descripción de la opción:** texto corto, una línea, **opcional**, editable en el lugar, **sin versión propia** (igual que el nombre y que `prefijoEnCarta` del grupo). No se borra una opción; se desactiva.
- **Línea «Incluye…» del plato:** se **deriva** de los grupos que el plato admite (`ProductoAdmiteGrupo`, respetando `seMuestraEnCarta` y el subconjunto de opciones `ProductoAdmiteOpcion`, p. ej. la pechuga «puré o ensalada»). No se guarda.
- **Bloque al pie:** uno por grupo, con título «GRUPO · elegís N» (N sale de `cantidadMinima`/`cantidadMaxima`) y sus opciones en texto; si alguna tiene descripción, una opción por renglón.
- **Marca «va con»:** la lista de platos que incluyen ese grupo (se calcula; no se guarda).

## 5. Invariantes y políticas

| # | Regla | Estado |
|---|---|---|
| I1 | Carta B: «Incluye …» bajo cada plato, bloques al pie en texto, **sin chips**; se retira el rótulo «En todos» | CONFIRMADA |
| I2 | Invitación 5+2: «elegí abajo ↓» y palabras tocables; al tocar, baja, ilumina el bloque y marca los platos | CONFIRMADA |
| I3 | Descripción B: la escribe el dueño; opcional; solo carta | CONFIRMADA |
| I4 | La descripción **no** aparece en ticket, comanda, POS, stock ni reportes. La foto de venta `OpcionElegidaEnLinea` **no** copia la descripción | PROPUESTA |
| I5 | Largo: de 1 a 120 caracteres, una sola línea (sin saltos), sin espacios a los costados; vacío = «sin descripción» (NULL) | PROPUESTA (patrón de `prefijoEnCarta`, que admite 20) |
| I6 | La descripción es texto plano, siempre escapado: nunca HTML | PROPUESTA |
| I7 | Editar la descripción **no** cambia el precio, no crea `VersionDeOpcion` y respeta el control de versión optimista de la opción (`version`) | PROPUESTA |
| I8 | La descripción de una opción desactivada, apagada en la sucursal o de un grupo oculto **no** se muestra | PROPUESTA |
| I9 | Toda edición queda auditada por columna (quién, cuándo, antes y después) | PROPUESTA |
| I10 | La carta pública sigue siendo de **lista cerrada**: la columna nueva se declara a mano en el guardián antes de leerse | PROPUESTA (lo exige el repositorio) |
| I11 | Se muestra en los cuatro lugares de carta (pública, impresa, vista previa, «Va a mostrar») con **la misma función** | PROPUESTA |
| I13 | La descripción es un campo de **cada opción de cualquier grupo** (guarnición, salsa, adicional…), no solo de las salsas: p. ej. la ensalada puede decir «lechuga, tomate, cebolla». Cada opción la tiene o no la tiene | CONFIRMADA (dueño, 2026-11-04) |
| I14 | **Cómo se muestran** las descripciones en el bloque: (1) siempre visibles, una por renglón; (2) un desplegable por bloque («Qué lleva cada salsa ▾»), con la lista de nombres siempre a la vista; (3) toque en cada opción. En papel, siempre visibles | **CONFIRMADA: desplegable por bloque** (dueño, 2026-11-04; maqueta `carta-descripciones-formas.html`) |
| I15 | Hay **un solo grupo** por cosa («Guarnición», «Salsa»); cada plato **tilda** qué opciones admite (`ProductoAdmiteGrupo` + `ProductoAdmiteOpcion`): la pechuga solo «puré o ensalada». El bloque del pie lista **todas** las opciones del grupo; la línea «Incluye…» de cada plato dice las suyas si son un subconjunto | CONFIRMADA (dueño, 2026-11-04; coincide con el modelo existente) |
| I16 | El rótulo del desplegable es **genérico**, no usa el nombre del grupo (un grupo de café o de tamaños no «lleva» nada): propuesta «Ver detalle ▾» (alternativas: «Qué lleva cada una ▾», «Más detalle ▾»). Solo aparece si alguna opción del grupo tiene descripción | PROPUESTA |
| I17 | «elegís N» del bloque sale de los límites del grupo; **cada plato puede tener límites propios** (`ProductoAdmiteGrupo.cantidadMinima/Maxima`, opcionales). Si todos los platos del bloque coinciden, se muestra N; si no, el bloque no dice N y cada plato lo aclara en su línea | PROPUESTA (a verificar en el código al implementar E1) |
| I18 | **Colores del tema, nunca fijos.** Todo color nuevo (marca de los platos, resaltado del bloque, palabras tocables, flecha, desplegable) sale de los tokens del tema de cada sucursal (`--carta-primary` = color de marca, `--carta-ink`, `--carta-ink-soft`, `--carta-bg`; hoy se arman en `carta-vista.tsx` desde `color_marca` y `color_fondo_dia`), no de un verde fijo. El texto secundario usa `--carta-ink-soft` (contraste seguro); el color de marca se usa para barra, borde, resaltado y subrayado, no para texto largo. Debe verificarse el contraste con marcas claras, oscuras y de bajo contraste. Si más adelante se quiere un color propio para estas marcas, es una clave nueva del catálogo del tema | CONFIRMADA (dueño, 2026-11-04: «no puede ser ese verde para todas las sucursales»); detalle PROPUESTA |
| I12 | Accesibilidad: las palabras tocables son botones; con «movimiento reducido» no hay animación; la barra de marca no es el único aviso (también el texto «Va con: …») | PROPUESTA |

## 6. Historia y persistencia (PROPUESTA; se diseña porque 1 a 3 están confirmados en lo que toca datos)

- **Una columna** en `OpcionDeGrupo`: `descripcionEnCarta TEXT NULL`, con `CHECK` (largo 1 a 120, sin saltos de línea ni espacios a los costados, en pareo con el patrón de `GrupoDeOpciones_prefijo_en_carta_chk`) y `GRANT UPDATE ("descripcionEnCarta")` a `motor2_app` condicional al rol. **Por qué ahí y no en `VersionDeOpcion`:** el nombre y el prefijo ya viven ahí, la versión es «solo agrega» y solo guarda precio y consumos.
- **Migración** `…_opcion_descripcion_en_carta`: aditiva y reversible; `down.sql` **aborta** si alguna opción tiene descripción (no la borra en silencio), después `REVOKE`, `DROP CONSTRAINT IF EXISTS`, `DROP COLUMN IF EXISTS`. Forma copiada de `20261021131000_grupo_prefijo_en_carta` y `20261029120000_producto_admite_grupo_se_muestra_en_carta`. Autorización: **ya dada** por el dueño el 2026-11-03 («aprobadas siempre y cuando se establezca que son reversibles»). Aviso de negocio: revertir exige antes limpiar o resguardar las descripciones cargadas.
- Nada se migra para E1 y E2.

## 7. Atomicidad y concurrencia — ¿qué pasa si…?

| Si… | Qué pasa (PROPUESTA) |
|---|---|
| Doble clic en «Guardar» | Un solo cambio: el segundo no encuentra la versión esperada o no tiene cambios y no escribe |
| Dos administradores editan la misma opción (uno el nombre, otro la descripción) | La segunda escritura recibe «cambió mientras la editabas» (`VERSION_DESACTUALIZADA`) |
| Se guarda el mismo texto otra vez | Sin cambios: no escribe ni audita |
| Se guarda en blanco | Se interpreta como «sin descripción» (NULL) |
| Falla la auditoría | No queda la descripción sin su registro: una sola transacción |
| El administrador pierde el permiso mientras edita | Rechazo en el servidor antes de escribir |
| Se desactiva la opción | La descripción queda guardada pero no se muestra |
| La carta está en caché | Se invalida con la misma clave de siempre; se sube `VERSION_DE_LA_CARTA_EN_CACHE` (convención del archivo; **no verificado** que un test lo exija) |
| Texto con `<script>` o saltos de línea | El `CHECK` y el guard lo rechazan; se escapa al mostrar |
| Descripción muy larga | Rechazo con el largo máximo en el mensaje |

## 8. Acceso, interfaces y pregunta abierta

- **Permisos:** sin claves nuevas (`opciones_definir`).
- **Pantallas del administrador:** el campo junto a «renombrar» en `catalogo/opciones/[grupoId]`, y en el alta de opción (también desde el producto). **No verificado:** si la alta en lote desde «nuevo grupo en el producto» necesita el campo.
- **Pantallas del comensal:** carta pública (sección, componente de cliente para las palabras tocables), impresa (sin interacción), vista previa, «Va a mostrar».

**Preguntas abiertas:** (1) **RESUELTA:** desplegable por bloque (I14). (2) **RESUELTA en lo esencial:** hay un solo grupo («Guarnición», «Salsa») y el nombre del grupo se usa tal cual en el plato y en el título del bloque; el dueño puede llamarlo como quiera. Si algún día se quiere un plural distinto, hace falta otra columna. (3) **PENDIENTE (menor):** el rótulo del desplegable (I16); propuesta «Ver detalle ▾».

## 9. Consultas y experiencia

- Cadena a tocar para la descripción (lectura): `src/server/lecturas/carta/opciones.ts` → `OpcionParaVender`/`GrupoParaLaCarta` → `src/core/pos/precio-de-configuracion.ts` → `src/core/carta/presentacion-en-carta.ts` → `src/core/carta/carta-publica.ts` → `texto-de-la-carta.ts` y `mantenimiento.ts` (vista previa) → `src/components/carta-publica/seccion.tsx`.
- **Para E1** se reemplaza `aclaracionesDe` (hoy lee solo nombre y recargo de la opción) y el dibujo de `GruposDeOpciones`/`Aclaraciones` en `seccion.tsx`; se retira el rótulo «En todos» (`data-en-todos`).

## 10. Pruebas, migración y operación

**Dimensiones que cambian lo que ve el comensal (regla del 2026-10-28):** A) grupo visible en la carta (sí/no); B) opción activa y no apagada en la sucursal (sí/no); C) descripción (ninguna/texto); D) canal (pública, impresa, vista previa, «Va a mostrar»); E) cantidad de opciones del grupo (1, 2 o más); F) plato incluye el grupo (sí/no/subconjunto).

**Oráculo (tabla aparte del código, a escribir a mano):** la descripción se muestra **si y solo si** A = sí, B = sí, C = texto y el canal es de carta. Con una sola opción no hay «elegís N». Un plato sin grupo no dice «Incluye». Un plato con subconjunto lo nombra («puré o ensalada»).

**Pruebas por etapa (verificadas por lectura, a confirmar corriéndolas):**

| Qué se rompe o se amplía al sumar la columna | Dónde |
|---|---|
| Lista cerrada de la carta pública | `test/arquitectura/carta-publica-lista-cerrada.test.ts` (`OpcionDeGrupo`, ~:71) |
| Salida pública inventariada | `test/carta/salida-publica-inventariada.test.ts` (`CLAVES_DE_LA_CARTA`) |
| Forma y privilegios de la tabla | `test/persistencia/migracion-grupos-de-opciones.test.ts` (~:80 y ~:209) |
| Auditoría por columna | `test/arquitectura/auditoria-por-columna.test.ts` (entrada de `editar-opcion-de-grupo`) |
| Guard del comando | `test/core/features/opciones-de-venta-guard.test.ts` (igualdad exacta: se rompe solo si la clave nueva va siempre presente) |
| Subir-bajar-subir histórico | `test/aislamiento/paquete-3-m4-subir-bajar-subir.test.ts` (**no verificado** hasta qué migración corre) |
| Test nuevo de la migración | molde: `test/persistencia/migracion-grupo-prefijo-en-carta.test.ts` |
| e2e nuevo | molde: `catalogo-grupo-se-lee-en-la-carta.spec.ts` |

Más: oráculo de combinaciones de la carta con la descripción (test nuevo que lea la tabla de reglas), prueba de que **ticket, comanda y reportes no la muestran**, prueba de que la foto de venta no la copia, mutación demostrativa de cada guardián nuevo y gate completo de 8 comandos.

**Etapas:**
| Etapa | Qué entrega | Migración | Estado |
|---|---|---|---|
| E1 | Carta B: «Incluye…» y bloques al pie; retira «En todos» | No | PROPUESTA (pide la pregunta del §8) |
| E3 | Descripción de la opción (columna, formulario, lectura en los 4 lugares) | Sí, 1 columna reversible (**autorizada**) | PROPUESTA |
| E2 | Invitación 5+2 (palabras tocables, «elegí abajo ↓», marca de platos) | No | PROPUESTA |

**Orden propuesto:** E1 → E3 → E2. La descripción necesita el bloque al pie para verse bien (una salsa por renglón); la invitación va última porque es lo más de pantalla.

## 11. NO VERIFICADO (de la lectura del código)

- Si hay disparadores en la base que rechacen un `UPDATE` de `OpcionDeGrupo` (solo se leyeron las migraciones de opciones, no todas las posteriores).
- Cómo imprime la comanda el nombre de la opción (se asume la foto de venta, como el ticket).
- Seeds y siembras de prueba que inserten opciones y pudieran necesitar el campo (si es opcional, no).
- Si el golden de cantidad de consultas de la carta cambia (no debería: se suma al mismo `select`).
- Que un test exija subir `VERSION_DE_LA_CARTA_EN_CACHE`.
