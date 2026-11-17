# Del ítem agrupado a la familia: qué se pierde y qué cambia (para el dueño)

> **Para quién:** el dueño (no programa). **Qué es:** el aviso previo a la etapa «R2» del reemplazo del ítem agrupado por familias. **Estado:** solo documento, 2026-11-17. **No se migró nada y nada se toca en ninguna base real.**
> **Lo que dijo el dueño (2026-11-17, literal):** «Sobre item agrupado se va una vez que entra familia» (el ítem agrupado se reemplaza por la familia) y «Solo el nombre, como Pedernal» (la familia lleva solo el nombre y dos interruptores). Fuente: `motor2-docs`, rama `alegp/stoic-davinci-185dm4`, `seguimiento-de-pedernal/decisiones-del-dueno-2026-11-14-mesa-resend-contador.md`, sección «Carta como Pedernal: respuestas del Frente 7 (2026-11-17)».
> **Diseño técnico detrás:** `docs/diseno-carta-familias-niveles-6-a-10-2026-11-17.md` (§6.5 etapas, §6.6 brechas, §6.7 «solo el nombre»).

## 1. En una frase

Pasar un ítem agrupado (por ejemplo «Gaseosas») a una familia **conserva los productos, sus precios, recetas, stock e historial de ventas**, pero **el ítem agrupado deja de existir como cosa propia**: se pierden lo que solo él tenía (descripción, etiquetas, la estrella ★, su lugar en la sección y su género) y el renglón único con «un precio» puede pasar a verse distinto. Antes de mover nada real, vas a ver la lista exacta de lo que se pierde, ítem por ítem y sucursal por sucursal, y la tenés que aprobar vos.

## 2. Qué hay hoy en la base real (consultado solo en lectura, 2026-11-17)

Se consultó, sin escribir nada, la base real de Motor2 (proyecto de Neon «motor2-multitenancy-fase-a», rama principal):

| Cosa | Cantidad hoy |
|---|---|
| Empresas | 2 |
| Sucursales | 1 |
| Productos | 0 |
| Platos en la carta | 0 |
| **Ítems agrupados** | **0** |
| Opciones dentro de ítems agrupados | 0 |
| Géneros de carta | 0 |

**Lo que significa:** hoy **no hay ningún ítem agrupado cargado, así que hoy no se perdería nada**. Tampoco hay datos reales con los que armar un ejemplo (el bife, el jugo de marca, tus proveedores todavía no están cargados en esta base), y para no confundirte no inventé uno: la lista real se genera sola el día que haya ítems agrupados cargados (ver §6).
*Límite de esta verificación:* solo miré esa base. Si existiera otra base con datos reales de otra instalación, hay que correr ahí la misma consulta antes de migrar.

## 3. Qué se pierde y qué cambia, campo por campo

| Lo que tiene hoy el ítem agrupado | ¿Lo tiene la familia? | Qué pasa al pasar | Qué ve el cliente en la carta |
|---|---|---|---|
| **Nombre** («Gaseosas») | Sí | Pasa tal cual a la familia. Si dos sucursales tienen ítems con el mismo nombre, hay un solo nombre de familia (la familia es de toda la empresa): ver §5 | Igual |
| **Productos que agrupa** | Sí (como miembros) | Cada producto pasa a miembro. Solo productos que se venden | Igual, salvo lo de «el precio» más abajo |
| **Descripción** | **No** | **Se pierde** | Desaparece el texto debajo del nombre |
| **Etiquetas** (por ejemplo «vegano») | **No** | **Se pierden** | Desaparecen las etiquetas |
| **Estrella ★ (destacado)** | **No** | **Se pierde** | Desaparece la estrella del renglón |
| **Orden propio dentro de la sección** | **No** | **Se pierde** | La familia sale después de los demás renglones de la sección, por orden alfabético (propuesta, ver §7) |
| **Género** (carpeta visual del POS) | **No** | **Se pierde** | Sin efecto en la carta; en el POS la agrupación la define la familia (etapa del POS) |
| **Activo / apagado** | Sí (la familia se activa o se desactiva) | Un ítem apagado pasa a familia desactivada | Igual: no se ve |
| **En qué sección está** | **No** (la familia no tiene sección propia) | La sección se toma de sus productos: si todos están en la misma sección, sale agrupada ahí; si no, salen sueltos | Puede cambiar |
| **«Un solo renglón con un precio»** (el precio más alto si las opciones valen distinto) | Distinto: lo decide la regla de la familia | Si la familia tiene «Agrupar en la carta» **apagado** (así nace), los productos salen **sueltos**; si está prendido y todos valen lo mismo, sale **una línea**; con medidas, una tabla | **Es el cambio más visible**: un ítem «Gaseosas desde $X» puede pasar a verse como varios productos sueltos |

## 4. Lo que NO se pierde

Los productos (nombre, código, precio de cada uno, recetas, costos, stock), el historial de ventas y de caja, las secciones, el orden de los **productos sueltos**, el contenido de carta de cada producto, el portal y la apariencia de la carta. Los datos de los ítems agrupados **no se borran** al migrar: el ítem queda guardado (oculto) hasta la etapa final, que solo se hace con tu autorización expresa.

## 5. Lo que vas a tener que decidir cuando exista la lista

1. **Dos sucursales con ítems del mismo nombre pero productos distintos:** la familia es de la empresa, con un solo nombre y un producto en una sola familia. La lista los marca y vos decidís cada caso (unir, renombrar, o dejar uno afuera).
2. **Un mismo producto agrupado de dos maneras en sucursales distintas:** tampoco entra solo; lo decidís.
3. **Productos del ítem con precios distintos:** la carta no va a poder mostrarlos en una línea; salen sueltos (o los igualás vos antes).
4. **Un producto agrupado que no está visible en la carta de su sucursal** (hoy el ítem lleva su propio contenido): para que aparezca habría que crear su contenido de carta. Eso escribe datos, así que se lista aparte y se aprueba.

## 6. Cómo se va a generar la lista (cuando haya datos)

Una consulta de **solo lectura**, que se corre sobre una copia descartable o sobre la base real sin escribir nada, y devuelve por cada ítem agrupado: empresa, sucursal, nombre, sección, cantidad de productos, precio mínimo y máximo, si tiene descripción, etiquetas y estrella, su género y su orden. Es esta (plantilla; no modifica nada):

```sql
SELECT e."nombre"            AS empresa,
       s."nombre"            AS sucursal,
       i."nombre"            AS item_agrupado,
       sc."nombre"           AS seccion,
       i."activo",
       count(o."id")         AS productos,
       min(p."precioVenta")  AS precio_minimo,
       max(p."precioVenta")  AS precio_maximo,
       (i."descripcion" IS NOT NULL AND i."descripcion" <> '') AS pierde_descripcion,
       (cardinality(i."tags") > 0)                            AS pierde_etiquetas,
       i."especial"          AS pierde_estrella,
       g."nombre"            AS pierde_genero,
       i."orden"             AS pierde_orden
FROM "ItemAgrupadoCarta" i
JOIN "Sucursal" s            ON s."id" = i."sucursalId"
JOIN "Empresa" e             ON e."id" = s."empresaId"
JOIN "SeccionCarta" sc       ON sc."id" = i."seccionCartaId"
LEFT JOIN "GeneroCarta" g    ON g."id" = i."generoCartaId"
LEFT JOIN "OpcionItemAgrupadoCarta" o ON o."itemAgrupadoCartaId" = i."id"
LEFT JOIN "Producto" p       ON p."id" = o."productoId"
GROUP BY e."nombre", s."nombre", i."id", sc."nombre", g."nombre"
ORDER BY 1, 2, 3;
```

Además se agregan dos columnas calculadas aparte: los nombres de ítems repetidos entre sucursales (§5.1) y los productos que aparecen en más de un ítem de distintas sucursales (§5.2). El resultado se te muestra **como pantalla real con tus datos reales** (capturas a 375 px y escritorio), no como dibujo aparte.

## 7. Lo que sigue y el orden (nada se adelanta sin vos)

| Etapa | Qué pasa | Tocar datos reales |
|---|---|---|
| R1 (hecha en el código: #385) | Existen las familias (tablas vacías). El ítem agrupado sigue funcionando; un producto no puede estar en los dos a la vez | No |
| **R2** | Se genera esta lista con tus datos. **Vos la aprobás.** Recién entonces se crean las familias (el ítem agrupado no se modifica ni se borra) | Sí, solo agrega |
| R3 | Se comparan carta y portal antes y después: idénticos salvo lo de esta lista | Lectura |
| R4 | Se **oculta** el ítem agrupado (reversible), solo cuando el POS y los reportes lean familias | Reversible |
| R5 | Se **borra** el ítem agrupado, con aviso expreso y autorización tuya por base, con respaldo | Destructivo |

**Propuesta mía (vos corregís):** en una sección ordenada a mano, las familias salen después de los renglones ordenados, por orden alfabético, como Pedernal. Darles lugar propio sería un campo que nadie pidió.

## 8. Riesgos y pendientes

- **Esta lista hoy está vacía** porque no hay ítems agrupados cargados; el día que los haya, la lista cambia y hay que volver a mirarla antes de migrar.
- **Límite conocido de la convivencia (aceptado por vos el 2026-11-17):** mientras convivan, dos administradores simultáneos, uno desde familias y otro desde el ítem agrupado, podrían dejar un mismo producto en los dos lados (ver el diseño §12, punto 9).
- **No verifiqué** qué ve hoy el POS del ítem agrupado ni cuántos reportes lo usan: son 30 archivos que leen ítems agrupados (inventario en el diseño §6.5); R4 no puede ocurrir hasta que cada uno lea familias.

## 9. Prueba que podés hacer sin leer código

Hoy no hay nada que probar en pantalla. Cuando exista la lista: abrila y revisá, para cada renglón, si perder la descripción, las etiquetas, la estrella o el orden te parece bien. Si hay un ítem donde no, decímelo **antes** de R2.
