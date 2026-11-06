# Capturas: poda de género e ítem agrupado (rama temporal, NO se mergea)

PR1: #194 (servidor) · PR2: #198 (pantallas, menú, permisos). Decisión del dueño 2026-11-06: «ocultá género e ítem agrupado».

Son las **pantallas reales** del sistema, a 375 px (celular), sobre una base local descartable (`motor2_e2e`, nunca producción) con datos reales de la empresa: Varvarco, Café $4.000, Capuccino $8.000, Cerveza Patagonia $14.000, Brownie $10.000, y los géneros Agua, Agua saborizada y Huinganco más un ítem agrupado «Aguas» (Agua 500 cc y Agua con gas 500 cc).
«Antes» = interruptor encendido (así funcionaba). «Después» = interruptor apagado (como queda en producción).

| # | Pantalla | Antes | Después |
|---|---|---|---|
| 1 | Carta · Hoy (administración) | `antes-1-carta-admin-hoy.png` | `despues-1-carta-admin-hoy.png` |
| 2 | Carta · Secciones (administración): las pestañas pasan de «Secciones y géneros / Ítems agrupados» a «Secciones» | `antes-2-carta-admin-secciones.png` | `despues-2-carta-admin-secciones.png` |
| 3 | POS · selector, sección Cafetería | `antes-3-pos-selector-cafeteria.png` | `despues-3-pos-selector-cafeteria.png` |
| 4 | POS · selector, sección Bebidas: antes, carpetas Agua / Agua saborizada / Huinganco; después, lista plana | `antes-4-pos-selector-bebidas.png` | `despues-4-pos-selector-bebidas.png` |
| 5 | Carta pública | `antes-5-carta-publica.png` | `despues-5-carta-publica.png` |

Además, con el interruptor apagado `/carta/agrupados` y `/carta/parametrizacion/generos` responden **404** (con el encendido, 200).

Cosas que se ven en «después» y son a propósito: Agua 500 cc y Agua con gas 500 cc (opciones del agrupado oculto, sin contenido de carta propio) quedan en «Fuera de carta»; los demás productos salen sueltos en su sección.

Herramientas: `herramientas/` (siembra de datos reales, siembra de la carta, capturador). Se corren con un servidor en el puerto 3300 y un `.env.cap` local (no se sube).
