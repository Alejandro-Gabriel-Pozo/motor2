# Maqueta «una sola compra» (U0 + U1): la pantalla real a 375 px

Capturas de la pantalla REAL del sistema (rama `alegp/compra-unica-u1`, U0 + U1), a 375 px de ancho (celular), sobre una **base local descartable** (nunca producción). Se generan con `test/e2e/capturas-compra-unica.spec.ts`.

## Qué es real y qué no
- **Real:** las pantallas, los botones, los textos y los mensajes (los arma el sistema, no están dibujados).
- **Del dueño:** el proveedor **CORDECC** y los productos **Cerveza Patagonia** y **Agua 500 cc**.
- **Ejemplo (NO real):** todos los importes y cantidades (24 cervezas a $36.000, 48 aguas a $24.000, etc.), los números de factura (los genera la prueba), el texto «cómo lo llama el proveedor».
- **Del entorno de pruebas (NO real):** la sucursal («Central»), el depósito («Depósito E2E») y el usuario (`e2e-admin@local.test`). No tengo a mano las sucursales reales del dueño; si hacen falta, se repiten las capturas con ellas.
- **Supuesto:** una compra «pagada ahora» no registra el medio de pago (queda «pendiente de completar»).

## Las pantallas
1. `01a-revisar-y-confirmar.png` / `01b-compra-guardada.png` — cargar una compra «pagada ahora» y el mensaje «Se guardaron 1 movimiento(s).».
2. `02-compras-registradas.png` — Compras registradas con una compra con factura: «Pago: Pagada al cargar», «Corregir proveedor y factura» y «Anular compra» (con su campo de motivo).
3. `03a-anular-confirmacion.png` / `03b-anulada.png` — anular con motivo y el resultado («Factura anulada (…): se revirtieron 1 movimiento(s)… El número queda libre para volver a cargarla.»).
4. `04a-corregir-formulario.png` / `04b-corregida.png` — corregir el N.º de factura y el resultado.
5. `05-factura-repetida.png` — volver a cargar una factura con un número que ya existe: «Ya hay una factura de este proveedor con ese número…».

## Cosas que se ven y conviene decir
- No hay captura «antes»: no armé el sistema anterior (`main`) para compararlo. Lo que cambia respecto de antes está descrito en el PR #202.
- La tabla de líneas de la compra se corta a la derecha en 375 px (columna «Sección»): ya era así, no lo cambia este trabajo.
- Después de anular, el mensaje de éxito aparece pero el botón «Anular compra» sigue visible hasta recargar la página; al recargar la compra queda marcada «Anulada».
- El mensaje de la anulación dice «Factura anulada…» (no «Compra anulada»): es el texto del caso de uso de la factura.
