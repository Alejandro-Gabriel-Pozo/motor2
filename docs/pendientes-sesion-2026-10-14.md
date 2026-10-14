# Pendientes de la sesión del 2026-10-14

Decisiones del dueño y backlog que queda abierto al cierre de la sesión. Producción quedó desplegada con `main` en `027fde7b` (gestión de
la carta, limpieza de opciones, lectura de cantidades en recetas, lectura del factor de tamaño, «Precios» y «Ordenar» las secciones).

## Hecho en la sesión (todo en `main`)

- Gestión de la carta según el prototipo aprobado (ADR-034): Mantenimiento (Hoy, Precios, Visibilidad), Parametrización como hub, «Ordenar» las secciones tocando.
- «Precios» (F4): por defecto el precio LOCAL de la sucursal activa, sin redondeo; «En toda la empresa» con el cartel «ESTE PRECIO SE MODIFICARÁ EN: …» (solo sucursales visibles para el usuario) y casilla de confirmación que el servidor vuelve a exigir.
- Limpieza de opciones (ADR-030/032): archivar, restaurar, quitar de un producto y «Limpiar opciones», con registro y «Deshacer».
- Recetas: la pantalla dice qué entendió de la cantidad («= 300 g») y avisa «3.000». Factor de tamaño: «1,3 = 30% más» y receta antes → después.
- Arreglo de `CampoNumero` (lo tipeado reemplaza al valor anterior) y del test intermitente de `combinaciones-go3`.

## Decisiones del dueño (2026-10-14)

| Tema | Decisión |
|---|---|
| Opciones, grupos y guarniciones | Se gestionan sin miedo (archivar, restaurar, quitar, deshacer), con registro de quién y cuándo. No generan una venta por sí mismas, componen la de un producto. |
| Borrado DEFINITIVO de opciones | Sigue **pendiente**. Requiere migración con `GRANT DELETE` al rol de la app y autorización expresa (O.492). |
| «Deshacer» de un ingrediente de receta | **Descartado**: las recetas se sobreescriben al guardar; quitar un ingrediente pierde sus calibraciones por sucursal (`RendimientoLocalIngrediente`) y eso es aceptado (O.497). |
| Idea futura | «Restablecer una versión» de la receta de una sucursal, trayendo la calibración de esa versión (variante (b) de O.497, `guardar-version-de-receta.ts`). Antes de proponer, verificar qué existe hoy. |
| Menú del día «simplificado» (lista fija sin fecha) | **No se hace.** Se mantiene D-1 de ADR-032: plato del día por fecha y sucursal, falla cerrado, con «copiar el día anterior». Se reabre solo si cargar el día resulta un problema real del encargado. |
| Productos de venta sin sección de carta | Son los del menú del día y del POS, nunca salen en la carta pública (ADR-034). No son un faltante. |

## Pendientes abiertos

1. Borrado definitivo de opciones (migración + autorización expresa).
2. «Restablecer versión» de la receta de una sucursal (idea futura, ver arriba).
3. Desinstalar la app Strix de GitHub (la trial terminó y comenta en cada PR; sin referencias en el repo). Lo hace el dueño en Settings → Applications.
4. Revisar de a uno los 10 PR de Dependabot.
5. Tablas que desbordan a 375 px: `/catalogo/unidades`, `/catalogo/clientes`, `/administracion/usuarios`, `/administracion/sucursales`.
6. Antes de vender en producción, cada producto vendible necesita su receta (ADR-033).
7. Arrastrados de sesiones anteriores, sin decisión nueva hoy: sucursal de práctica vs empresa aparte; plan de seguridad y backup externo (en pausa); carga masiva de una sola vez; tamaño de letra de lo que no es producto en la carta.
