# Compras: síntesis para el dueño (etapa mínima), 2026-11-16

Detalle técnico en `diseno-compras-paridad-pedernal-2026-11-16.md` y `diseno-compras-paridad-escalera-2026-11-16.md`. Nada de esto está construido ni aplicado.

**Qué es la etapa mínima.** Hoy, cuando cargás una compra, la mercadería entra al stock en ese mismo momento. La etapa mínima agrega un paso: la compra se carga con su factura y queda «pendiente de recibir»; el stock no se mueve hasta que un gerente o un administrador confirma que la mercadería llegó, y elige en qué depósito entra. Es lo que hace Pedernal con la recepción separada. Toda compra sigue llevando factura (tu respuesta del 2026-11-16).

**Qué vas a ver y poder hacer.**
- Cargar una compra con factura y verla como «pendiente de recibir».
- Una lista «Por recibir» con lo que falta confirmar.
- Confirmar la recepción eligiendo el depósito: ahí recién entra el stock y se registra quién y cuándo.
- Anular una compra que todavía está pendiente (no hay stock que revertir).

**Qué NO entra en esta etapa.** Orden de compra; tres vías con tolerancias y diferencias; control línea por línea (conforme / con observaciones / rechazada); notas de crédito, devolución al proveedor, saldo a favor y reintegro; corregir precio o cantidad de una línea; pago con importe o en efectivo desde la caja. Todo eso son etapas siguientes, cada una con su aprobación. Tampoco se cambia nada del stock ni del costo ya cargado.

**Riesgo.**
- Mientras una compra está pendiente, esa mercadería no figura en el stock aunque ya esté en el local; por eso la confirmación tiene que ser un hábito, y la lista «Por recibir» está para eso.
- Hoy el sistema deja anular una factura que ya tiene un pago declarado; eso conviene corregirlo antes (es un arreglo chico, sin cambios en la base) y también necesita tu visto bueno.
- Si se enciende para una empresa, los que cargan compras dejan de ver entrar el stock al instante: conviene avisarles.
- El detalle de cómo lo hace Pedernal para el control por línea (migración 0063) no se pudo leer; lo que depende de eso queda sin verificar.
