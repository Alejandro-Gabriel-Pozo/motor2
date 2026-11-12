# Diseño: apagar «Está bien así» y la lista de platos sin nombre de carta (2026-11-11)

Diseño breve (niveles 1 a 5). Reabre la decisión F de `docs/diseno-nombre-en-carta-2026-11-04.md` §11 (confirmada el 2026-11-04: «Sí, armalo así con el botón "Está bien así"»).

## 1. Propósito y alcance
Ocultar, con un interruptor reversible, la lista «Platos de la carta sin nombre de carta», el aviso «Nombre de carta: pendiente de completar» y el botón/acción «Está bien así». Estado: CONFIRMADA (el dueño).
**Fuera de alcance:** borrar código o la columna, el prefijo, «nombre arriba», el modo base, los ítems agrupados, la familia. **No se toca:** la columna del nombre de carta, la regla «nombre de carta, o el del producto si está vacío», la regla de no repetir nombres, la carta pública, el selector del mozo, el ticket, la comanda ni el campo «Nombre en la carta» de la ficha (sigue editable).

## 2. Actores y contexto
Quien administra la carta de una sucursal (permiso `carta_contenido_producto`). El mozo y el cliente no ven cambios.

## 3. Necesidad (quién y cuándo)
El dueño, 2026-11-11: «Me refiero al "está bien así" que tenemos nosotros, si cada producto vendible es lo que se ve en la carta ese "está bien así" queda obsoleto». Autorizó apagarlo con «Si» a «¿Ocultamos "Está bien así" y la lista de pendientes ahora, dejando reversible el campo?». Evidencia medida en producción (solo lectura, 2026-11-11): en las 5 sucursales los platos «sin decidir» son todos BASE_CONFIGURABLE (la lista los excluye a propósito) y los directos ya tienen nombre de carta igual al del producto: la lista sale vacía.

## 4. Conceptos y ciclo de vida
Interruptor `ESTA_BIEN_ASI_VISIBLE` (`src/core/carta/esta-bien-asi.ts`), valor `false`, mismo patrón que `GENERO_E_ITEM_AGRUPADO_VISIBLE` y `DESCUENTO_POR_PRODUCTO_VISIBLE`. Reversible: poner `true`. El estado del nombre (pendiente / propio / confirmado) sigue existiendo en los datos; solo deja de mostrarse y de poder confirmarse.

## 5. Invariantes y políticas
- Apagado, la acción rechaza con un mensaje fijo DESPUÉS de verificar el permiso, sin escribir ni auditar.
- La carta pública, el selector del mozo y el ticket usan siempre «nombre de carta, o el del producto si está vacío»: no leen el interruptor.
- Las 3 superficies de administración (lista de Carta › Hoy, aviso de la ficha, acción) leen el interruptor; un guardián lo verifica.
- Oráculo (en `test/carta/esta-bien-asi-apagado.test.ts`): interruptor {apagado, prendido} × estado {pendiente, propio, confirmado} × tipo {directo, base}. Prendido lo cubren los tests existentes (el setup global lo enciende).

## ¿Qué pasa si…?
| Situación | Resultado |
|---|---|
| Repetición / doble clic en «Está bien así» (por una pestaña vieja) | Rechaza las dos veces igual; no escribe ni audita. |
| Concurrencia con «Guardar» de la ficha | La acción no escribe nada: no hay carrera; «Guardar» sigue funcionando como siempre. |
| Tiempo (se prende el interruptor más adelante) | Todo vuelve como estaba; los datos no se tocaron. |
| Permisos | Sin permiso, rechazo de permisos (primero); con permiso, el mensaje del interruptor. |
| Carta nueva con nombre vacío | Sale con el nombre del producto, sin aviso ni lista. |
| Error parcial / datos faltantes | No aplica: no hay escritura. |
