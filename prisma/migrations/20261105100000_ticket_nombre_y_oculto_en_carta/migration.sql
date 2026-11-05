-- «EL TICKET DEL CLIENTE USA EL NOMBRE DE LA CARTA Y RESPETA LO OCULTO» (pedido del dueño, 2026-11-04; docs/diseno-ticket-respeta-lo-oculto-2026-11-04.md; REQUIERE AUTORIZACIÓN EXPRESA PARA APLICAR EN PRODUCCIÓN, base por base, con respaldo y ensayo en una rama de Neon):
--  - `CuentaItem.nombreEnTicket`: el nombre con que el TICKET DEL CLIENTE nombra el producto de la línea, CONGELADO al agregarla al pedido (el «Nombre en la carta» de la sucursal de la cuenta, si lo tenía). NULL = el ticket
--    usa el nombre del producto, como siempre (toda línea anterior a esta migración). Solo lo lee el ticket del cliente: la comanda de cocina, el stock y los reportes no lo usan.
--  - `OpcionElegidaEnLinea.ocultaEnCarta`: la carta ocultaba esa opción AL VENDER (`ProductoAdmiteGrupo.seMuestraEnCarta = false` y el grupo no cambia el precio en ese producto). El ticket del cliente la omite; la comanda y
--    el detalle interno no. DEFAULT false = toda foto anterior se sigue imprimiendo como se imprimió.
-- Congelar al vender garantiza que reimprimir un ticket cerrado da EXACTAMENTE lo mismo que el original aunque después cambie el nombre de carta o el interruptor «Mostrar este grupo en la carta».
-- ADITIVA: el código anterior no lee ni escribe las columnas (sus `data` son explícitos y los INSERT toman NULL / false). Sin políticas ni GRANT nuevos: las dos tablas son de solo agregar (`GRANT SELECT, INSERT` de TABLA), que
-- cubre las columnas nuevas. ADD COLUMN NULL (o con DEFAULT constante) no reescribe la tabla; validar el CHECK recorre las filas (todas en NULL).
-- CHECK `CuentaItem_nombre_en_ticket_chk`: NULL, o de 1 a 80 caracteres, que empiezan y terminan con un carácter visible y sin saltos de línea (el mismo que `ContenidoCartaProducto_nombre_en_carta_chk`).
-- Reversa: down.sql (a mano, como dueño; ABORTA si alguna línea tiene un nombre congelado o alguna foto `ocultaEnCarta` en true; después marcar la migración como revertida).

ALTER TABLE "CuentaItem" ADD COLUMN "nombreEnTicket" TEXT;
ALTER TABLE "CuentaItem" ADD CONSTRAINT "CuentaItem_nombre_en_ticket_chk"
  CHECK ("nombreEnTicket" IS NULL OR ("nombreEnTicket" ~ '^\S(.*\S)?$' AND "nombreEnTicket" !~ '[\r\n]' AND char_length("nombreEnTicket") <= 80));

ALTER TABLE "OpcionElegidaEnLinea" ADD COLUMN "ocultaEnCarta" BOOLEAN NOT NULL DEFAULT false;
