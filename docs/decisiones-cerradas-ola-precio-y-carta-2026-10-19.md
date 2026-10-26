# Decisiones cerradas de la ola «precio y carta» (2026-10-19 al 2026-10-22)

Registro de las decisiones del dueño que guiaron las Fases 4 a 6 (regla numérica en notación argentina, precio por sucursal, carta, método de trabajo). Copia del cuaderno de trabajo de la sesión; las implementadas están en ADR-035, ADR-037 y ADR-038.

## Fase 2
- D3 Consignación: VER y PAGAR con los niveles de la misma clave (botón «Registrar pago» solo para quien puede editar). Sin clave nueva ni migración. Si luego se necesita separar, se hace.

## Fase 4
1. Quién cambia el modo del producto: quien tiene `producto_campos_sensibles` (opción A). Sin clave nueva.
2. Una base NO puede ser de consignación.
3. Prefijos («De» para «Milanesas de», «Con» para el wok) y renombre de esos grupos: en un paso APARTE, con OK del dueño.
4. Siglas («BBQ» → «bBQ»): sin excepción hoy; si hace falta se agrega.
5. El campo «se lee en la carta como» solo en grupos VARIANTE y MEDIDA.
6. Margen de una base en el reporte de costos: «Por opción», sin margen (ver margen por opción = mejora aparte).
7. Ajuste masivo de precios («Precios» de Carta, sucursal y empresa): SE APAGA con el interruptor `PRECIOS_EDITABLES` (`src/app/(app)/carta/page.tsx`), en un commit propio y reversible. Borrar el código muerto: al final de la ola, si sigue sin extrañarse.
8. Marcar Pizzas y Milanesas como base en producción: recomendado a mano desde las pantallas (sin script de datos). AÚN SIN CONFIRMAR.
9. Neon (tope de 10 ramas): AÚN SIN DECIDIR qué rama liberar. No borrar nada sin OK.

## Fase 5
- DEC-11: producto base OCULTO por defecto (pizzas: «Pizza muzzarella $18.000» sin encabezado). Dos ejes (milanesas) siempre tabla con el nombre arriba. El prefijo es opcional y NO decide el encabezado.
- COLUMNA APROBADA: booleano por producto base «Mostrar el nombre arriba» (default apagado) en `ContenidoCartaProducto`. Migración aditiva en la Fase 5; aplicarla en producción se confirma aparte (respaldo + ensayo).
- Variante sin costo y sin prefijo: ACLARACIÓN («Preparación: solo, cortado, lágrima o con leche»). Con costo (recargo fijo) o con prefijo: filas.
- Precio por celda totalmente libre (como GO-3a): NO se carga; alternativas: producto aparte («Café lágrima») o recargo fijo. El porcentaje se calcula sobre el precio base, no escala con el tamaño.
- Supuestos vigentes salvo corrección: hasta 3 columnas (más → lista); descuento como «−10 %» sin tachar por celda; papel imprime la carta completa (sin «agotado hoy»); QR no se genera (dirección en texto en el pie); tags 12 px; rol Opción 16 px fijo; `modo` y `prefijo` entran a la lista cerrada `PUBLICACION_CARTA` (decisión técnica).

## Fase 3
- Pendientes de decidir: cómo desplegar código antes que tablas dentro del PR único (recomendado: migración como último commit, aplicada en una 2.ª tanda), borrar `ejeDeCombinacion` (recomendado sí), rama de Neon a liberar, si se retira también en zuluhub/demo, orden 2 antes que 3 (aprobado).

## Fase 6 / 7
- Decisiones del espacio del producto (11) y de aspecto: SIN RESPONDER; se bajan a casos de cocina antes de empezar la fase 6.
- Fase 7: emulación operable en construcción (artifact N9vFwuyYsQD7RkwjNzTsxf).

## Cerradas el 2026-10-20 (selección múltiple)
- Fase 3, despliegue: DOS PR SEPARADOS. PR 1 = toda la ola (código, incluido el retiro de GO-3a sin tocar tablas); PR 2 = solo la migración de retiro (paso 3.7), que se aplica después de que el código esté en producción. (Cambia el «un solo PR» solo para esa migración.)
- Se BORRA la columna `ProductoAdmiteGrupo.ejeDeCombinacion` en la migración de retiro.
- Retiro de GO-3a: SOLO la base de producción por ahora (otras bases: más adelante, cada una con su verificación).
- Marcar Pizzas y Milanesas como base: A MANO desde las pantallas (sin script de datos), antes de abrir el PR.
- Neon: AUTORIZADO listar ramas (solo lectura) y proponer cuál liberar; borrar lo decide el dueño.
- Pago a consignante: dos pagos simultáneos con claves distintas se DEJAN como están (DEC-31).
- `PromoCartaSucursal` es de CARTA (dueño declarado).
- Clave de reintento obligatoria: SOLO pago a consignante (otras acciones, mejora aparte).

## Fase 6 (cerradas el 2026-10-20, selección múltiple; todas = opción recomendada)
- Rutas del espacio del producto: NOMBRES NUEVOS del paso (que-se-vende, opciones, receta, en-la-carta) con redirecciones 307 de las viejas (`/editar`, `/catalogo/recetas/:id`).
- Materia prima: FICHA PROPIA (queda como hoy); el espacio de 4 pasos es solo para lo que se vende.
- Quien solo ve: SOLO LA PORTADA (datos + pendientes); no ve formularios.
- Crear grupo en ventana: UN SOLO CLIC, TODO O NADA (comando compuesto del Catálogo: crea grupo, opciones y admisión en una transacción SERIALIZABLE; permisos opciones_definir + producto_opciones_admitidas; ficha, I3, auditoría, tests de concurrencia/idempotencia/permisos).
- Vista previa: DE LO GUARDADO (proyección del servidor de la Fase 5; no calcula precio en el componente).
- Receta (paso 3): PESTAÑAS en la misma página; historial en ventana.
- Paso 4 «En la carta»: DE LA SUCURSAL ACTIVA (rotulado «En la carta de {sucursal}»).
- Consumos de una opción: editables desde el producto en ventana, CON AVISO de cuántos productos más usan el grupo.
- Fondo de toda la administración: PAPEL CÁLIDO del salón (#FAFAF8), tarjetas blancas.
- Consola de plataforma: CONSERVA su azul; solo se le quita el modo oscuro.
- Reportes en celular: TABLA CON SCROLL LATERAL (como hoy).
- Umbral de medición: NO PEOR QUE HOY en pantallas y clics + 0 salidas del espacio en las tareas de opciones y publicar.
- Decididas por el ingeniero (técnicas): nombres de tokens solo `--color-*` (@theme static) con alias en `.pos-shell`; el menú NO se toca en la Fase 6 (rediseño de navegación = Fase 7); las capturas de /carta (reemplazo de la paleta propia ADR-034) se aprueban al llegar a ese paso.

## Fase 7 (decisiones propuestas por el paquete, ratificadas por el dueño el 2026-10-20; todas = opción recomendada)
- DEC-13 Catálogo: 5 entradas (Productos, Biblioteca de opciones, Maestros con pestañas, Proveedores, Clientes con descuento).
- DEC-24 Carta: 3 entradas (Carta con pestañas Hoy · Secciones y géneros · Ítems agrupados; Promociones con el menú del día; Apariencia y publicación).
- DEC-25 Movimientos: FRECUENTES DIRECTOS (merma, compra, venta) y el resto de los procesos en un selector «Registrar movimiento»; Conteo físico aparte; Precio local, Opciones agotadas y Menú del día se mudan.
- DEC-26 y DEC-30 Glosario adoptado: Depósito (lugar de stock; hoy «Sección»), Traslado (entre depósitos de una sucursal), Traspaso (entre sucursales), Cambio de gerencia.
- DEC-27 Stock: 2 entradas (Existencias con Consolidado/Por familia/Alertas y atajo «Cambiar mínimo»; Configuración con depósitos, motivos de merma, destinos de consumo y tabla Parámetros por insumo).
- DEC-28 Administración: 5 entradas; invitaciones pendientes VISIBLES EN LA MISMA PANTALLA de Usuarios (bloque arriba, «Reenviar» al lado), no en una pestaña.
- DEC-29 Traspasos: 1 bandeja agrupada por lo que toca hacer, «Nuevo traspaso» en ventana (Pedir o Enviar).
- DEC-32 Reportes: 5 grupos por pregunta con pestañas (Ventas, Rentabilidad, Stock y pérdidas, Calidad de datos, Compras y consignación).
- DEC-33: ver ≠ escribir con NIVELES de la misma clave (sin claves nuevas ni migración); acciones contextuales de un reporte = comandos del dueño del dato.
- Precio por sucursal: en el PRODUCTO (paso 2) + lista «Precios por sucursal»; dueño Catálogo.
- DEC-31 (consignación): ya decidido (dejar como está; ver/pagar por niveles).
- PENDIENTE para ratificación final: el informe de la revisión UX independiente de la emulación y las correcciones de la emulación.

## Cerradas el 2026-10-20 (tarde)
- Precio y otras decisiones de la emulación: precio por sucursal solo en la activa; confirmación extra si un precio cambia más de 30 % (ver «Fase 7»).
- PARSER DE IMPORTES (app real, `src/core/datos/numero-tecleado.ts` y `CampoNumero` tipo importe): «21.000» se leía como $21 sin aviso. DECIDIDO: en campos de IMPORTE un separador (punto o coma) con 3 o más dígitos detrás se RECHAZA con error junto al campo («Escribí 21000 o 21,00»); «21,5» y «21.5» siguen valiendo; las CANTIDADES no cambian. PENDIENTE DE IMPLEMENTAR (micro-paso «2c», después de la Fase 3 y de integrar la 2b; toca core/datos, tests de numero-tecleado/importe/campo-numero, specs e2e de campos de precio; revisar goldens y `plan-validacion-de-datos-2026-09-25.md`).
- (2026-10-20, tarde) PARSER NUMÉRICO ÚNICO: la regla de «pedir que lo aclare» vale para IMPORTES y para CANTIDADES: un separador (punto o coma) con 3 o más dígitos detrás da error junto al campo («Escribí 21000 o 21,00» / «Escribí 2000 o 2,000»); «21,5» y «21.5» siguen válidos. (Reemplaza la frase anterior «las cantidades no cambian» y la idea de «punto = miles».) Aplica en la app real (micro-paso 2c) y en la maqueta.
- (2026-10-20, tarde) Precio por sucursal EN EL PRODUCTO (paso 2): se carga AHÍ MISMO, junto a cada opción, el precio de la sucursal ACTIVA (editable con `precio_local`); la lista «Precios por sucursal» queda para comparar las 6 (de solo lectura salvo la activa). 
- (2026-10-20, tarde) Operario y Carta › Hoy: el operario (solo `producto_disponibilidad`) ve Carta › Hoy y puede agotar OPCIONES sueltas, pero NO platos enteros (eso requiere el permiso de editar la carta).
- Registro de decisiones (a) y (b) de la emulación: (a) precios por sucursal solo de la sucursal activa; (b) «antes → después» siempre y confirmación extra si el precio cambia más de 30 %.
- (2026-10-20, tarde) AFINADO DE LA REGLA NUMÉRICA (decisión del ingeniero para no bloquear cantidades legítimas; el dueño puede corregirla): en IMPORTES, un separador con 3 o más dígitos detrás es error (un importe tiene a lo sumo 2 decimales); en CANTIDADES, solo es error el patrón AMBIGUO de magnitud: un separador (punto o coma) seguido de exactamente 3 dígitos cuando la parte entera tiene 1 a 3 dígitos y no empieza con 0 («2.000», «1.250», «2,000»); «0,125», «0.125», «2,5», «2.5», «12.345,6» siguen siendo válidos. Mensaje: «Escribí 2000 (dos mil) o 2 (dos).» Así 0,125 kg se puede escribir.
- (2026-10-20, noche) REGLA NUMÉRICA FINAL — NOTACIÓN ARGENTINA (reemplaza TODAS las formulaciones anteriores de «pedir que lo aclare»; investigación: RAE/Fundéu: coma decimal, miles con espacio en norma; en dinero se usa el punto de miles y coma decimal, «$ 12.345,60»; formato de software es-AR igual). Decidido por el dueño: «Notación argentina + mostrar lo que entendió».
  * La COMA es decimal siempre. «1,205 kg» = un kilo 205 g (válido); «12.345,6» y «12.345,60» válidos como importe.
  * PUNTO: varios puntos, o puntos antes de una coma, con agrupación de miles bien formada (primer grupo 1–3 dígitos sin cero inicial, los siguientes de 3) = MILES («1.000.000», «21.000,00»). Un solo punto con 1 o 2 cifras detrás = decimal (teclado numérico: «21.5» = 21,50). Un solo punto con exactamente 3 cifras detrás y parte entera de 1–3 dígitos sin cero inicial («21.000», «1.205», «2.000»): en IMPORTES = miles ($21.000); en cantidades de unidad SIN decimales = miles; en cantidades de unidad con 3 o más decimales (kg, l) = AMBIGUO → error junto al campo pidiendo aclarar («¿1,205 o 1205?»). «0.125» (entero 0) = decimal. Un solo punto con 4 o más cifras detrás = más decimales de los admitidos → error de decimales.
  * Un importe admite como máximo 2 decimales («21,000» → error «máximo 2 decimales; para veintiún mil escribí 21000 o 21.000,00»); una cantidad, los decimales de su unidad.
  * Al salir del campo SIEMPRE se muestra cómo se entendió, en es-AR («$ 21.000,00», «1,205 kg»). Más la confirmación extra de precios con cambio > 30 %.
  * Aplica en la maqueta (v7) y en la app real (micro-paso 2c: `numero-tecleado.ts` con contexto de tipo de campo e `decimales` de la unidad; servidor valida con el mismo contexto; tabla de casos borde como test de propiedades).
- (2026-10-20, noche) Tecleo a medias (decisión de ingeniería, coherente con el parser real que ya lo documenta): «5,» y «21.» se aceptan como 5 y 21 (separador final sin cifras = tecleo incompleto, se ignora); «,5» y «.5» = 0,5. Se muestra siempre la lectura «Se entendió: …». Revisión independiente v7: la regla numérica cumple todos los casos definidos; hallazgos menores N-13 (lectura/error dentro del label, mensaje repetido), N-14 (importe inválido sin señal al salir) a corregir en la primitiva `Campo`.

## Método de trabajo de los agentes (decisión del dueño, 2026-10-20 noche)
- El agente de cada fase/tanda es un ORQUESTADOR (Opus): piensa, explora, lee, diseña el brief de cada paso y revisa el diff. NO escribe el código.
- Quien escribe código y tests es un sub-agente Sonnet 5.5 (`Agent` con `model: "sonnet"`), uno por paso (o varios en paralelo si tocan archivos distintos). Opus revisa adversarialmente, corre la verificación liviana, commitea y empuja.
- Aplicar a TODA fase futura (5 tanda B restante, 6, 7, micro-paso 2c, y los bloques posteriores). Los prompts de lanzamiento deben decirlo explícito.

## Jerarquía de la carta (decisión del dueño, 2026-10-20 noche) — Fase 5 tanda C
Elegido con maquetas en `scratchpad/jerarquia/` (comparacion-*.png, carta.css, build.mjs):
- Regla: si la opción define QUÉ PLATO es (tipo de carne, cada pizza) → las opciones son protagonistas y el nombre paraguas es un RÓTULO; si la opción es solo CÓMO lo querés (tamaño del café) → el nombre es el protagonista.
- Tablas y listas = BC2: rótulo del paraguas sans 13 px semibold mayúsculas espaciadas #1c1b19 + línea fina de ancho completo debajo; filas serif 19 px con separador fino; precios serif 19 px; encabezados de columna (Simple/Napolitana) 16 px semibold #1c1b19 alineados con las columnas de precio.
- Café (columnas, el nombre es el plato) = variante N: «Café» serif 19 px protagonista con la línea fina debajo; encabezados de tamaño (Chico/Mediano/Grande) 15 px semibold #1c1b19; precios como hoy (16 px).
- Aclaraciones/adicionales = P1 (café y bife y todo producto con extras): etiqueta del grupo sans 14 px semibold; lo que NO cuesta en UNA línea 15 px («Elegí: ensalada, papas fritas o puré» si todas las opciones del grupo son gratis; «Incluidas: solo, cortado» si el grupo mezcla gratis y con recargo); cada opción que SÍ suma, en su PROPIA fila con el recargo a la derecha (serif marrón #92400e 16 px, «+$200») y separador fino.
- Mínimo 14 px para todo texto que el cliente necesita para decidir (excepciones: rótulos de grupo en mayúsculas espaciadas).
- Pizzas en lista: el rótulo «PIZZAS» solo aparece si el interruptor «Mostrar el nombre arriba» está prendido (si no, base oculta como está).
- Se aplica también a la impresión.

## Respuestas del dueño (2026-10-20 noche) a las dos preguntas de la tanda C
- Tandas de varios productos que comparten tamaños: REPETIR los encabezados (Chico/Mediano/Grande) debajo de cada nombre (una tabla por producto).
- Descripción de la banda de la sección (11 px): SUBIRLA a 14 px (paso C6 aprobado: piso de `--carta-fs-aclaracion`).
- «Elegí: …» en grupos opcionales gratis (suena obligatorio): «habría que verlo» → mirarlo en las capturas «después2».
- El dueño probablemente LIMPIE el catálogo y cargue los productos desde cero (afecta el despliegue: marcar bases, prefijos, etc. se hace sobre datos nuevos; la migración de retiro y el orden de despliegue deben contemplarlo cuando se decida).
## Fase 5 APROBADA por el dueño (2026-10-21): capturas despues3 (jerarquía, textos neutros, café de especialidad).

## Contratos y deuda técnica (decisiones del dueño, 2026-10-21 noche)
- Plazo máximo de la DEUDA: 60 días (no 120), con responsable y seguimiento hasta el cierre; no se renueva sin justificación escrita. Excepciones permanentes: horizonte 365 días (sin cambio, a menos que el dueño diga otra cosa).
- REGLA: si se modifica un archivo/parte que tiene deuda registrada, esa deuda se RESUELVE en el mismo cambio; no se deja pendiente ni se renueva sin justificación. El guardián lo verifica comparando los archivos cambiados (diff contra la base: en CI el destino del PR; en local el merge-base) con las entradas de deuda.
- La reducción de la deuda restante se aborda cuando terminen las fases de compras, idioma (inglés), pop-ups y fotos.
- Archivo vacío `empty` de la raíz: BORRAR. Autorizado tocar `.github/` (artefacto de evidencia y `forbidOnly`) cuando llegue ese paso. «Aprobación independiente»: NO hace falta cuenta aparte (el dueño trabaja solo): solo DETECCIÓN (guardián + hash aprobado), sin CODEOWNERS obligatorio ni revisión de terceros. `dependencia-falsa` BLOQUEA. Borde claro por defecto en la raíz de la carta: SÍ (defensa en ejecución).

## Regla de deuda técnica, versión final (dueño, 2026-10-21 noche; reemplaza la anterior sobre horizontes)
- Dos casos: (1) si un cambio toca una zona con deuda registrada, resuelve la deuda afectada EN ese cambio; (2) si la zona no tenía deuda, el cambio no puede introducir deuda nueva ni dejarla sin registrar. Cualquier excepción: justificación y aprobación explícitas, responsable y vencimiento con MÁXIMO 60 días (aplica a excepciones Y a deuda; antes las excepciones tenían 365 días). El control compara la deuda ANTES y DESPUÉS de cada cambio y bloquea la integración si aumenta sin excepción aprobada. La reducción de la deuda pendiente se hace al terminar compras, idioma, pop-ups y fotos.
- Implementación pendiente (paso «G9 diff de deuda»): comparar contra la base (en CI el destino del PR; en local el merge-base con origin/main): R1 archivo tocado con deuda registrada en la base → la entrada debe haber desaparecido; R2 entrada de deuda nueva respecto de la base → bloquea salvo excepción aprobada (justificación + aprobación + responsable + vence ≤ 60 días); R3 usos sin declarar en el head = 0 (ya lo exige el motor); inventario inicial de la deuda (cuando no hay libro en la base) = una sola vez, aprobado explícitamente por el dueño. Cambiar `politica.ts`: horizonte de excepciones 365 → 60.
- Casos legítimos permanentes (p. ej. el borde punteado que no es un separador) NO son «excepciones» de 60 días: se modelan como parte de la definición del contrato (patrón permitido), cuyo cambio exige actualizar el hash aprobado del mecanismo.

## Mutaciones del guardián nuevo (pedido del dueño, 2026-10-21 noche) — paso «G6a»
- Evaluación: el motor tiene pruebas de mutación SINTÉTICAS (motor.test.ts: fuente/ancla/marca ausentes, marca duplicada, etc.) y las del portado (contratos-de-la-carta.test.ts: usos sin declarar/definición duplicada sobre árbol temporal), pero las dos mutaciones exigidas —sacar la regla central del CSS y sacar la marca/declaración de un contrato REAL— solo se corrieron A MANO (log g3b) y NO están automatizadas; además `fuente-ausente` reporta línea 1:1 (sin posición real).
- A construir: (1) un arnés de mutaciones AUTOMÁTICO sobre el manifiesto real: por cada contrato, sobre una copia temporal de sus archivos reales, aplicar los operadores (borrar el ancla/regla de la fuente, quitar la marca @contrato, quitar la declaración de un consumidor real, insertar una definición duplicada, vaciar el alcance); cada mutación DEBE dar el hallazgo esperado con archivo y línea REALES (≥1, apuntando a la regla/marca/uso) y el id del contrato en el mensaje; si una mutación pasa en verde, el test falla indicando contrato + operador («el guardián no protege ese invariante»); un contrato nuevo queda cubierto solo; (2) mejorar el diagnóstico de `fuente-ausente` para que apunte a una línea real (la de la marca si falta el ancla; la del ancla si falta la marca) y cite dónde está definido el contrato; (3) independiente del guardián viejo (ya borrado).
- Espera a que terminen G1b (toca motor.ts/tipos.ts) y G3.

### Ampliación del paso G6a (dueño, 2026-10-21): las mutaciones valen para CUALQUIER función, declaración, contrato, manifestación, marca o constante
- Nivel 1 — CATÁLOGO de operadores de mutación por tipo de elemento (regla CSS, función/símbolo/constante exportada de la fuente, clase compañera, marca @contrato, declaración en un consumidor, entrada del manifiesto, declaración de área, excepción/deuda/caso legítimo/exclusión, constantes de política/umbrales, cableado) + META-TEST: cada tipo de hallazgo del motor y cada invariante que el guardián declara tiene ≥1 mutación real que lo produce; si no la tiene, falla.
- Nivel 2 — ARNÉS AUTOMÁTICO sobre el repo real (copia temporal): cada contrato × cada operador aplicable; la mutación DEBE dar el hallazgo esperado con archivo y línea REALES y el id del contrato; si pasa en verde, falla («el guardián no protege ese invariante»); contratos nuevos quedan cubiertos solos.
- Nivel 3 — MUTATION TESTING real del código del propio guardián (StrykerJS con runner de Vitest, dependencia de desarrollo NUEVA: requiere OK del dueño): mide qué mutantes sobreviven en `test/arquitectura/contratos/**`; umbral mínimo; sobrevivientes con archivo:línea; se corre aparte (semanal/local), NO en los 8 comandos del gate (lento).
- Límite declarado: mutar el COMPORTAMIENTO de una función de negocio (p. ej. `redondearMoneda`) lo cubren las pruebas de esa función; el guardián protege que la fuente única exista, esté declarada y no se copie. Stryker sobre `core/moneda` puede ser un piloto aparte.

### Alcance de las mutaciones = TODO EL REPO/PROYECTO (dueño, 2026-10-21)
- Honestidad de costo: Vitest corre contra Postgres real sin mocks, con `fileParallelism: false` (solo `test/arquitectura` tarda ~324 s); mutar todo el repo en una corrida es inviable. Se hace por NIVELES con cuota de riesgo:
  - A (en el gate): arnés de mutaciones de CONTRATOS sobre TODOS los contratos y áreas del repo (ya recorre todo).
  - B: `src/core` (373 archivos, puro, sin Prisma por regla de arquitectura): Stryker incremental por carpeta, umbral de puntaje con trinquete (no puede bajar), corrida aparte (semanal/a pedido); piloto `core/moneda` para MEDIR tiempo y puntaje antes de extrapolar.
  - C: `src/server` / persistencia (tests con base real): por riesgo (dinero, permisos, aislamiento, idempotencia), muestreado, después del piloto.
  - D: UI/e2e: sin mutación de código; cubierto por el arnés de contratos y las mediciones en navegador.
- Pendiente: autorización de StrykerJS (dependencia de desarrollo nueva) y cuándo empieza el programa B/C (propuesta: piloto ahora, programa completo al cerrar compras, idioma, pop-ups y fotos junto con la reducción de deuda).
- AUTORIZADO por el dueño (2026-10-21): StrykerJS como dependencia de desarrollo (runner de Vitest). Piloto sobre `core/moneda` junto con el nivel A; programa completo B/C al cerrar compras, idioma, pop-ups y fotos (propuesta aceptada por omisión: confirmar si se quiere otro momento). Verificar versión y compatibilidad con Vitest 4 / Node actual antes de instalar (no inventar APIs); registrar la dependencia en package.json con versión exacta y su motivo; `knip` debe verla como usada (script/config).

## Fase 6 bloque 1: plan verificado contra el código (2026-10-21) — `scratchpad/plan-fase-6-bloque-1-verificado.md`
- Orden: 6.0.3 capturas antes, 6.0.1, 6.0.2 → (6.2 ∥ 6.0.4 extensión E1 del motor) → 6.1 tokens + contrato → 6.5 → 6.4 → 6.6a–j primitivas → 6.7 → 6.8 lote L1 (~35 commits). 6.3 se disuelve. Menú NO se toca (solo tokens, D-3).
- Decisiones pedidas al dueño: D-1 (aplicar la regla de deuda a los cercos de la Fase 1 POR TEMA Y POR ARCHIVO — recomendado), D-2 (aprobar inventario inicial de deuda de `tokens-visuales`, 19 entradas, se le muestra antes), D-3 (pasar a tokens sidebar/menú/app-shell no es «tocar el menú»), D-4 (aprobar capturas de /carta en 6.4, obligatoria), D-5 (valores técnicos: borde-control #8A857C, marca-tinte #FBEFEA…; decide el ingeniero salvo que el dueño objete), D-6 (opcional: mover 6.6k-m al bloque 2).

### Matriz de invariantes × mutaciones (dueño, 2026-10-21) — reemplaza el enfoque «por símbolo» de G6a
- La unidad es el INVARIANTE (no cada símbolo): para cada uno se identifican los elementos que lo definen, aplican y verifican (funciones, declaraciones, contratos, manifiestos, marcas, constantes, configuración, controles) y se crean mutaciones por CLASE: eliminación, alteración, duplicación, desconexión, exclusión del análisis, y EVASIÓN (neutralizar al propio guardián: skip/only, exclusión en vitest, renombrar, mover, vaciar manifiesto, bajar umbral/plazo, quitar del workflow, continue-on-error, quitar script).
- Resultado esperado explícito (falla con diagnóstico útil); mutación sobreviviente = HUECO a corregir. Matriz verificable por meta-tests (invariante nuevo sin mutaciones falla), ejecutada como control obligatorio en CI (dentro de `npm test`; cableado vigilado por el guardián del guardián, G6/G7). Huecos aún sin mecanismo = `hueco-conocido` con DEUDA (≤60 días, resuelveEn G6).
- Implementación: el agente de G6a (a496d90c99189348e) recibió el mensaje de reorganización; siguen G6 (guardián del guardián + cableado de CI) y G7 (.github).
- Fase 6 D-1 = SÍ (regla de deuda aplicada POR TEMA Y POR ARCHIVO a los cercos de la Fase 1: si se tocan los colores de un archivo queda en 0 de colores; si se tocan sus controles, en 0 de controles; igual tipografía). D-3 = HACERLO (pasar menú/sidebar/cabecera a tokens sin cambiar entradas ni estructura; rediseño del menú = Fase 7). D-5/D-6 los decide el ingeniero y se marcan al cerrar. (2026-10-21)

## MARGEN OTORGADO por el dueño (2026-10-21): seguir Fases 6 y 7 de corrido
- El ingeniero decide por su cuenta todo lo TÉCNICO, REVERSIBLE y sin consecuencias de negocio (nombres, valores técnicos de colores nuevos, orden de pasos, partición del trabajo). Límites que se mantienen: NO aplicar ninguna migración a una base real; NO cambiar dinero, permisos ni modelo de datos sin preguntar (una sola pregunta clara en ese caso); lista de «decisiones que tomé por mi cuenta» al cierre de cada fase.
- Todo lo que depende del dueño se junta en UNA LISTA PREVIA AL PULL REQUEST (se abre recién al final): aprobación en lote de capturas (galería con antes/después por paso), inventario inicial de deuda de contratos/tokens, ratificar CA-31 (Fase 7), configuración de GitHub (Actions + regla de rama), marcar Pizzas/Milanesas como base, autorización de migraciones con respaldo y ensayo (PR 2), el vencimiento de `prisma/fase-a` (2026-12-20).

## Hallazgos de las capturas «después 6.5» (2026-10-21) — a incorporar en 6.4 y 6.8
- Fondo papel aplicado (solo el cuerpo): tarjetas, barra lateral y recuadros de administración son TRANSPARENTES, por eso se ven del mismo papel (decisión del dueño: tarjetas BLANCAS) → asignarles `bg-superficie` en las primitivas/lote L1 (6.6/6.8: AppShell, sidebar, cabecera, recuadros de datos).
- Borde por defecto: en toda la administración los recuadros y tablas con `border` sin color caen al color del texto (NEGRO): mismo fallo abierto que los separadores de la carta (preexistente, visible en «antes»). Incorporar a 6.4, cuando nace `--color-borde-control` (#8A857C, 3,6:1 → cumple 1.4.11 para controles): regla en `@layer base` `border-color: var(--color-borde-control)` por defecto (excluyendo `.carta-shell`, que ya tiene la suya), y usar `--color-borde` (decorativo, claro) explícito donde corresponda. NO usar `--color-borde` como default: los inputs con solo `border` perderían contraste de objeto (WCAG 1.4.11).
