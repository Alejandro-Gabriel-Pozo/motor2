# Caja y cobro en Motor2: síntesis para el dueño (2026-11-16)

Para decidir sin leer los tres documentos de diseño (`docs/diseno-caja-y-cobro-paridad-pedernal-*.md`). Hoy es solo diseño: no se construyó nada ni se tocó ninguna base.

## Qué es la primera etapa (C1)

Hoy Motor2 cierra una cuenta, descuenta el stock y numera el ticket, pero **no sabe con qué se pagó ni en qué caja entró la plata**. C1 agrega eso, como en Pedernal, sin cambiar lo que ya anda:

- **Abrir la caja** al empezar, con el fondo inicial (puede ser $0). Una caja por sucursal, que nace sola.
- **Medios de pago**: efectivo, débito, crédito, transferencia, QR y otro. De fábrica solo está habilitado el efectivo; los demás los habilita un administrador.
- **Cobrar una cuenta ya cerrada**: elegís uno o varios medios y la suma tiene que dar el total **al centavo**. Cobrar es un paso **aparte** de cerrar la cuenta (lo confirmaste: «Cobro aparte primero»).
- **Ingresos y egresos de efectivo** con motivo (por ejemplo, retirar para pagar algo). Un error se anula con un registro nuevo, nunca se borra.
- **Ver qué cuentas cerradas faltan cobrar.**
- **Cerrar la caja** contando los billetes y dando conforme al resto de los medios. Si no coincide, se puede cerrar igual y queda anotada la diferencia.

Qué ves: lo que se cobró por medio de pago, lo que falta cobrar y si la caja cuadra.

## Qué NO entra en C1

Cierre del día de toda la sucursal (etapa C2), datos extra del cobro como cupón o cuotas (C3), varias cajas por sucursal (C4), cerrar y cobrar en un solo gesto (C5), propina (Pedernal tampoco la tiene), cobro en partes, cuenta corriente, seña, caja grande y depósitos, y facturación electrónica con ARCA. Lo de cuenta corriente, seña y caja grande que pediste el 04/11 queda **pendiente de tu decisión**: no se construye hasta que lo pidas.

## Riesgos

1. **Corregir o anular un ticket que ya se cobró cambia su total.** Hoy se puede hacer sin límite. Con caja, la plata cobrada ya no coincide con el ticket.
2. Las cuentas cerradas **antes** de activar la caja: hay que decidir si quedan «anteriores a la caja» o se pueden cobrar después.
3. La hora de corte del día (etapa C2) necesita una columna nueva en la sucursal.
4. Nada se aplica a ninguna base hasta que apruebes todo el código igual a Pedernal.

## Próxima pregunta (una sola)

**Si ya cobraste un ticket y después hay que corregirlo o anularlo, ¿qué querés que pase?**

- **A (recomendada, como Pedernal):** se puede anular el ticket entero; la plata que se había cobrado **no sale sola de la caja**: queda como una diferencia que se explica al cerrar el día. Corregir un renglón de un ticket ya cobrado **no se permite** hasta que lo decidas.
- **B:** también se permite corregir renglones y el sistema ajusta lo cobrado (más flexible, pero cambia plata ya registrada y es más complejo).
- **C:** no se puede corregir ni anular un ticket cobrado; primero hay que deshacer el cobro.

Después, en orden: qué billetes cuenta la caja (siete denominaciones como Pedernal, de 100 a 20.000, o las diez de tu planilla del 04/11, desde 10); y si ARCA es otro frente.
