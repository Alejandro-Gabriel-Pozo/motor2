# Diseño: el ticket del cliente usa el nombre de la carta y respeta lo que la carta oculta (2026-11-04)

Corta, con la escalera de diseño (niveles 1 a 5 antes de migrar). Pedido del dueño (vía la sesión padre), CONFIRMADO: (a) el ticket del cliente usa el «Nombre en la carta» y lo **congela al vender**; (b) lo que la carta oculta, el ticket del cliente también lo oculta, **congelado al vender**; sin cambiar stock, comanda de cocina (KOT), selector del mozo, reportes ni el detalle interno.

## 1. Propósito y necesidad
Que el cliente lea en su ticket lo mismo que leyó en la carta. Caso escrito por el dueño: si no hay bife de chorizo y sale con ojo de bife, como el grupo «Proteína» está oculto en la carta, el ticket del cliente NO debe decir «ojo de bife» (esperaba bife de chorizo); la comanda y el stock SÍ muestran y descuentan lo real. Segundo caso: el ticket de un producto directo con nombre de carta dice el nombre de carta. Reimprimir un ticket cerrado da EXACTAMENTE lo mismo que el original.

## 2. Actores
Cliente (lee el ticket), mozo (elige igual todo en el selector), cocina (KOT sin cambios), administrador (decide qué grupo se oculta en la carta y el nombre de carta).

## 3. Casos de uso
Agregar al pedido (se congela). Ticket de la mesa, reimpresión y corrección de ticket (leen lo congelado). Nada más.

## 4. Conceptos
- `CuentaItem.nombreEnTicket` (NULL = el ticket usa el nombre del producto, como siempre): el nombre con que el ticket del cliente nombra el producto de esa línea, congelado al agregarla (`nombreEnCarta` de la sucursal de la cuenta, si lo tiene).
- `OpcionElegidaEnLinea.ocultaEnCarta` (DEFAULT false): la carta ocultaba esa opción al vender (`ProductoAdmiteGrupo.seMuestraEnCarta = false` Y el grupo no cambia el precio en ese producto: `seOcultaEnLaCarta`). El ticket del cliente la omite del nombre y del detalle de la línea; la comanda y el detalle interno la siguen mostrando.
- Las líneas viejas quedan en NULL / false: se siguen imprimiendo EXACTAMENTE como se imprimieron.

## 5. Invariantes (CONFIRMADAS salvo marca)
1. Lo que se cobra NUNCA se omite: una opción que cambia el precio (MEDIDA con precio, VARIANTE o ADICIONAL con recargo) no se oculta (ya lo garantiza `seOcultaEnLaCarta`; se mide sobre lo que se cobró).
2. Solo se oculta en el ticket del CLIENTE: KOT, selector, stock, reportes y el detalle interno no cambian.
3. El importe, la cantidad y el total del ticket no dependen de los nombres.
4. Una anulación (espejo) se nombra como su línea original; una línea anulada no cambia de nombre.
5. Una base con medida: el plato sigue saliendo del rótulo de la opción de la MEDIDA (que siempre cambia el precio, así que nunca se oculta); `nombreEnTicket` solo se usa en el producto DIRECTO.

## 6. Persistencia (UNA migración aditiva y reversible)
`CuentaItem."nombreEnTicket" TEXT NULL` con CHECK (NULL o 1 a 80 caracteres, sin espacios a los costados ni saltos) y `OpcionElegidaEnLinea."ocultaEnCarta" BOOLEAN NOT NULL DEFAULT false`. Ambas tablas son de solo agregar (`GRANT SELECT, INSERT`): las columnas nuevas entran por el mismo privilegio de tabla. `down.sql` ABORTA si hay filas con nombre congelado o con `ocultaEnCarta` en true (nunca se pierde un dato en silencio). Declaradas en `columnas-de-significado` (`visibilidad`).

## 7. Atomicidad y concurrencia — «¿qué pasa si…?»
| Pasa | Resultado |
|---|---|
| El administrador cambia el nombre de carta o oculta un grupo DESPUÉS de vender | El ticket ya vendido no cambia (se congeló); lo que se venda después usa lo nuevo |
| Se reimprime o se corrige un ticket cerrado | Lee lo congelado: idéntico al original |
| Dos agregados a la vez | Cada uno congela lo que vio en SU transacción; la idempotencia por clave de «agregar al pedido» no cambia |
| Línea anterior a la migración | NULL / false: se imprime como siempre |
| Una opción oculta cambia el precio (ej. se le puso recargo después) | Lo que importa es lo vigente AL VENDER: se congela `false` si ya cambiaba el precio |
| Todas las opciones de una línea están ocultas | El nombre queda en el nombre del producto, sin detalle; el cobro es el mismo |

## 8–10. Acceso, consultas y pruebas
Sin pantallas nuevas. Tres lectores del ticket (la mesa, «Tickets emitidos» y la corrección del ticket) leen lo congelado. **Oráculo (tabla escrita aparte del código, `test/pos/ticket-oculto.oraculo.ts`):** grupo {oculto sin precio, oculto con precio (no se omite), visible} × producto {directo, base} × canal {ticket, reimpresión, comanda (KOT), detalle interno} × cambio del interruptor después de vender {no, sí}. Más: test de migración subir-bajar-subir (`down.sql` aborta con datos), concurrencia/idempotencia de «agregar al pedido» (el existente) y e2e a 375 px con el caso del bife. Los conteos de consultas de «agregar al pedido» suben (una lectura del nombre de carta): se declaran.

## Preguntas abiertas
Ninguna bloqueante. Supuesto declarado: una promo con componentes usa el mismo nombre congelado que una línea suelta.
