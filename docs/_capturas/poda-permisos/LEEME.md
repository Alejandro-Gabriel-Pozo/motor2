# Maqueta: poda de permisos (PR #187 capacidades y PR #190 matriz)

Rama temporal `alegp/tmp-capturas-poda-permisos` (no se mergea). Capturas de la **pantalla real del sistema** (servidor de producción `next start`) sobre una **base local descartable** con las sucursales reales de la empresa (Oficinas NQNTUR, Varvarco, Huinganco, Manzano Amargo, Las Ovejas, Los Miches), sembrada con el guion de la maqueta de correcciones. Celular = 375 px, escala 2.

- **ANTES** = `origin/main` compilado. **DESPUÉS** = esta rama sobre #190 (incluye #187).
- Cada captura es un recorte de la página completa: **cabecera de la tabla** arriba y, debajo, las filas de interés (separadas por una banda gris; entre bandas hay filas omitidas). No se alteró nada de lo dibujado.
- La tabla es más ancha que el celular: cada pantalla va en dos mitades, la izquierda (nombre + Default) y `-derecha` (las sucursales).
- Estado preparado **por la pantalla**: en «Capacidades» se apagó la columna **Default** de `alta_producto`, para ver qué dice cada sucursal que no tiene fila propia. (Para poder hacerlo, el usuario de la maqueta `gerente@maqueta.local` quedó como gerente de la empresa en la base local: solo el gerente cambia capacidades.)

## Qué NO es real (declarado)
- Usuario/roles: `gerente@maqueta.local` con el rol `admin`; el segundo rol de la matriz es el «operador» de fábrica. Las filas de permisos son las de fábrica, no las de producción.
- Se leyeron de producción solo los nombres de sucursales (en lectura); nada se escribió en producción.

## Capturas
| Archivo | Muestra |
|---|---|
| `capacidades-antes-recorte` / `-derecha` | ANTES. Aparecen las filas de interruptores muertos (`activar_usuario_sucursal`, `apagar_cuenta_empresa`, `gestion_permisos`, `gestion_roles`, `gestion_usuarios`) y `compra_recibir`; la fila `alta_producto` tiene Default ⛔ pero las sucursales dicen ✅ (engañoso: el acceso las da por apagadas). |
| `capacidades-despues-recorte` / `-derecha` | DESPUÉS. Las filas muertas y `compra_recibir` ya no están; `alta_producto`: Default ⛔ y las sucursales ⛔ «hereda del Default». |
| `matriz-antes-recorte` / `-derecha` | ANTES. `compra_recibir` está listada; los reportes (`reporte_compras`, `reporte_conteos`, …) tienen casilla «Editar» (✅). |
| `matriz-despues-recorte` / `-derecha` | DESPUÉS. `compra_recibir` no está; en los reportes la columna «Editar» es un guion «—» (solo ver). |

`herramientas/` tiene los guiones para reproducirlas (`sembrar-datos-reales.ts`, `capturas.ts`, `recortar.py`).
