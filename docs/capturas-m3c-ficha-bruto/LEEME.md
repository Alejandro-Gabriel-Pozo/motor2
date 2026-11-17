# Hoja de cocina: antes y después de M3c (imprime siempre el bruto)

Capturas de la **pantalla real** (`/catalogo/recetas/[productoId]/ficha`, el componente de producción) en un navegador de verdad (Playwright, Chromium), a 375 px (celular) y 1280 px (escritorio), contra la base local descartable `motor2_e2e` sembrada con **datos de ejemplo** (el bife a la criolla). No se escribió en producción ni se leyó nada de producción.

> **Son datos de ejemplo, no las recetas del dueño.** No hay recetas reales en ninguna copia a mi alcance. Con las recetas reales del dueño las cifras cambian; lo que se ve es la regla: bruto = cantidad × (1 + merma/100) para una versión neta, y la cantidad tal cual para una versión bruta.

- **ANTES** = `main` `4cd24a7c` (la ficha imprime la cantidad escrita). **DESPUÉS** = esta rama (M3c) integrada con ese mismo `main`.
- «Receta vieja (neta)» = como están cargadas hoy (lo que lleva el plato). «Receta nueva (bruta)» = la misma comida cargada como lo que sale de la cámara (así se cargará desde M3b; hoy ningún camino de la aplicación la crea, la versión se sembró directo en la base).

| Línea (cantidad cargada · merma) | Vieja (neta) ANTES | Vieja (neta) DESPUÉS | Nueva (bruta) ANTES | Nueva (bruta) DESPUÉS |
|---|---|---|---|---|
| Bife de chorizo 0,3 kg · 15 % (bruta: 0,345) | 0,3 kg | **0,345 kg** | 0,35 kg (*) | 0,345 kg |
| Tomate perita 0,12 kg · 8 % (bruta: 0,1296) | 0,12 kg | **0,1296 kg** | 0,13 kg (*) | 0,1296 kg |
| Cebolla 0,1 kg · 10 % (bruta: 0,11) | 0,1 kg | **0,11 kg** | 0,11 kg | 0,11 kg |
| Aceite de girasol 0,03 kg · 0 % | 0,03 kg | 0,03 kg (sin cambio) | 0,03 kg | 0,03 kg |

(*) «Nueva (bruta) ANTES» es hipotético: con el código anterior la ficha redondeaba a los decimales de la unidad (2 en kg). Después de M3c una receta vieja y una receta bruta de la misma comida se leen igual en la cocina.

Archivos: `antes-vieja-375.png`, `antes-vieja-1280.png`, `despues-vieja-375.png`, `despues-vieja-1280.png`, `antes-bruta-*.png`, `despues-bruta-*.png`; el texto de cada ingrediente, tomado de la pantalla, en `antes-textos.json` y `despues-textos.json`.
