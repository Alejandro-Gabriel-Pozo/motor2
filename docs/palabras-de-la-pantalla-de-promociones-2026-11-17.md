# Palabras de la pantalla de Promociones: hoy vs. maqueta de Pedernal (2026-11-17)

Pedido del dueño (2026-11-17, vía el orquestador): «Yo veo el combo y veo en Pedernal algo limpio, mientras que en Motor 2 veo algo apretado. Mientras en Pedernal veo pocas palabras bien elegidas, en Motor 2 veo párrafos explicativos.»

Todo esto vale SOLO con el interruptor `ARMADO_DE_PROMO_COMO_PEDERNAL` encendido (hoy nace apagado: con `false` la pantalla queda como siempre). Los textos viven en `src/core/carta/textos-de-promociones.ts`; la lista cerrada la fija `test/carta/textos-de-promociones.test.ts`.

Vocabulario aprobado por el dueño el 09/11/2026 en la maqueta `combos.html` de Pedernal: Combos, Nuevo combo, Activo, Pausado, No disponible, Nombre, Precio, Qué lleva, Agregar componente, Cantidad, Un producto fijo, A elegir en una sección de la carta, Lo que el cliente puede elegir, Cómo lo ve el cliente, Reparto del precio, Guardar versión, Todavía no lleva nada, Quitar, Cancelar, y la frase del reparto. «Guardar versión» NO se usa (Motor 2 no tiene versiones, decisión del 2026-11-17): donde hoy se guarda, dice «Guardar».

## Tabla

| Dónde | Texto de hoy | Texto con el interruptor encendido | Fuente |
|---|---|---|---|
| Barra de arriba, título | Promociones | Combos | Decisión del dueño 2026-11-17 (vía el orquestador): lo que Pedernal ya resolvió se hace como Pedernal; el módulo se llama Combos |
| Barra de arriba, subtítulo | Combos y cupos | (no se dibuja) | Repetir «Combos» no aporta |
| Fila de pestañas y menú «Carta» | Promociones | Combos | Ídem |
| Título de la lista | Promos | Combos | Maqueta (aprobado 09/11) |
| Párrafo de la lista | «Una promo se define una sola vez para toda la empresa. Cada sucursal decide si la prende… (mientras está prendida se vende; cuando termina, se apaga).» | (no se dibuja) | Se saca |
| Alta, título del formulario | Nueva promo (queda prendida en esta sucursal) | Nuevo combo | Maqueta |
| Alta, botón | Crear promo | Guardar | Decisión del orquestador (sin versiones) |
| Rótulo del título (alta, edición, solo lectura) | Título | Nombre | Maqueta |
| Rótulo del precio (alta y edición) | Precio * | Precio | Maqueta (sin asterisco) |
| Rótulo de la descripción | Descripción (opcional) | Descripción | Sin equivalente: se conserva el rótulo corto, se saca «(opcional)» |
| Edición, botón | Guardar promo | Guardar | Decisión del orquestador |
| Rótulo del precio de la sucursal | Precio en esta sucursal (vacío = el de la empresa) | Precio en esta sucursal | Sin equivalente: se conserva el rótulo, se saca la ayuda |
| «Dónde se ve», casilla | Solo salón: se vende desde el POS, pero no aparece en la carta pública (web, QR ni impresa) | Solo salón | Sin equivalente: se conserva el rótulo corto |
| «Dónde se ve», ayuda de la casilla (también en el alta) | Útil para un menú pactado con una empresa: el precio no queda publicado. | (no se dibuja) | Se saca |
| «Dónde se ve», solo lectura | Solo salón (no aparece en la carta pública) | Solo salón | Sin equivalente: se conserva el rótulo corto |
| Aviso de «solo salón» sin cupos | «Esta promo está en «solo salón» pero no tiene cupos… » | (no se dibuja) | Se saca |
| Título del armado | Cupos | Qué lleva | Maqueta (ya estaba con el interruptor) |
| Párrafo del armado | «Las partes de la promo se arman tildando secciones… » (con el interruptor, antes de este cambio: «Cada componente es una sección de la carta… cantidad exacta… rango…») | (no se dibuja) | Se saca |
| Aviso del «peor caso» y piso de $ 0,01 | «Con los cupos de hoy, el peor caso son N unidades y el precio mínimo permitido es…» | (no se dibuja) | Se saca de la pantalla; el servidor sigue rechazando un precio bajo el piso con su mensaje |
| Botón del armado | Guardar cupos (con el interruptor, antes: Guardar lo que lleva) | Guardar | Decisión del orquestador |
| Promo sin nada que lleve | Sin cupos: esta promo es solo informativa, el POS la ignora. (con el interruptor, antes: Sin componentes: … ; en el renglón y en «Cómo lo ve el cliente»: Sin componentes todavía (solo informativa)) | Todavía no lleva nada | Maqueta |
| Plegable del resto de las secciones | Agregar un componente | Agregar componente | Maqueta |
| Párrafo dentro del plegable | «Tildá la sección de la carta de la que el mozo elige y poné cuántos productos (mín. y máx.).» | (no se dibuja) | Se saca |
| Ayuda bajo lo que lleva | Para quitar un componente, destildalo y guardá. | (no se dibuja) | Se saca |
| Leyenda de sumar un lugar | Sumar un lugar (opcional) | Sumar un lugar | Sin equivalente: se conserva, se saca «(opcional)» |
| Lugar sin entradas | Sin entradas todavía: sumá los productos que se pueden elegir acá. | Todavía no lleva nada | Maqueta |
| Botón de una entrada | Sacar «X» | Quitar «X» | Maqueta |
| Reparto, frase de abajo | Se reparte en proporción al precio de lista. Para el ejemplo se usa el primer producto disponible de cada elección. | Igual (ya era la de la maqueta) | Maqueta |
| Reparto, con partes de rango | + «En las partes cargadas con un rango se usa la cantidad máxima.» | (no se dibuja) | Se saca |
| Lista vacía | La empresa no tiene promos cargadas. | La empresa no tiene combos cargados. | Dudoso: frase de hoy con la palabra «combo» |
| Sin secciones para armar | Para cargar una promo hace falta al menos una sección de carta activa. | Para cargar un combo hace falta al menos una sección de carta activa. | Dudoso: ídem |

Sin cambio (se conservan tal cual, no hay equivalente en la maqueta): Sección de carta, Orden, Precio de la empresa (solo lectura), Dónde se ve, Guardar dónde se ve, Guardar precio de esta sucursal, Apagar/Prender «X» en esta sucursal o en toda la empresa, Volver a ofrecer «X», mín., máx., Cantidad (ya era), Cómo lo ve el cliente, Reparto del precio, el renglón de la lista (Activo, Pausado en esta sucursal, Pausado en toda la empresa, solo salón, precio de esta sucursal).

## Aire (solo con el interruptor encendido)

Los bloques de cada promo (formulario, precio de la sucursal, dónde se ve, cómo lo ve el cliente, reparto, qué lleva, cada lugar) van con `gap-5`; los formularios del armado con `gap-4`; las filas de cantidad (mín./máx./Cantidad) van una debajo de la otra también en celular, con su rótulo arriba; «Sumar un lugar» apilado. Sin colores nuevos ni librerías.

## Dudoso / pregunta abierta para el dueño

1. «Pausado en esta sucursal» / «Pausado en toda la empresa»: la maqueta dice solo «Pausado». Se dejó el renglón como está porque la diferencia (sucursal o empresa) es información que hoy no está en otro lado del renglón. ¿Pasa a «Pausado»?
2. «Solo salón»: no existe en la maqueta. Se conserva el rótulo corto, sin la explicación.
3. Aviso del «peor caso» y piso de $ 0,01: se saca de la pantalla encendida; el servidor sigue rechazando con su mensaje.
4. (Resuelto 2026-11-17) El encabezado, la pestaña y el menú pasan a «Combos» con el interruptor encendido, por decisión del dueño; se quita el subtítulo «Combos y cupos» para no repetir.
5. La explicación del reparto con rango («se usa la cantidad máxima») se saca; quien lee el reparto de una parte heredada con rango no ve cómo se contó.
6. «Todavía no lleva nada» también para un lugar de lista sin entradas (la maqueta la usa para el combo entero).
7. «Descripción» y «Sumar un lugar» pierden «(opcional)»: ya no se avisa que es opcional.
8. «La empresa no tiene combos cargados» y «Para cargar un combo…» son frases de hoy con una palabra cambiada, no textos de la maqueta.
9. Los encabezados de lugar («Bebida · viene fijo» / «se elige N») se dejaron: la maqueta tiene «Un producto fijo» y «A elegir en una sección de la carta», pero son tipos de componente, no el mismo dato.
