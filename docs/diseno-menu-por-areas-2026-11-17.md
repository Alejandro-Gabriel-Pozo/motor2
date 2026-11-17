# Menú por áreas, como Pedernal (Frente 6, paso 5) — 2026-11-17

Estados: CONFIRMADA (dicha por el dueño), PROPUESTA, PENDIENTE, NO VERIFICADA.

## 1. Propósito y alcance
- **Necesidad** (quién la pidió y dónde está escrita): el dueño pidió «Las pantallas que quedan ser igual a Pedernal» (2026-11-16) y eligió «Sí, el menú por áreas (Recomendada)» (2026-11-16, pregunta del orquestador). La maqueta de Pedernal `menu-por-areas.html` y su menú real (`apps/web/ui/navegacion/menu.ts`, ZuluHub-ERP `main`) son la referencia. CONFIRMADA.
- **Qué entra**: el menú lateral (escritorio) y el cajón (celular) pasan de 8 grupos de módulo con dos paneles Empresa/Sucursal a **cuatro áreas** — Ventas, Catálogo, Compras y Cuenta (fija, al final) — con grupos adentro. Solo presentación: las pantallas, las rutas y los permisos no cambian. CONFIRMADA (estructura de Pedernal: áreas Ventas · Catálogo · Compras · Cuenta, dueño 12/11/2026 en el registro de Pedernal).
- **Qué NO entra**: íconos de área («por ahora, solo texto», 15/11/2026 en Pedernal), selector de departamento, «Más», ninguna pantalla nueva, ninguna perilla.

## 2–4. Actores, casos de uso y conceptos
- Toda persona con sesión ve el menú que arma el servidor con SUS permisos (`filtrarMenuPorPermiso`); el menú por áreas **solo reubica** esos mismos ítems (`armarMenuPorAreas`, función pura). Un área sin ítems no aparece.
- Concepto: área → grupo (subencabezado) → pantalla. Una sola tabla declarativa (`FILAS_DEL_MENU`, `src/core/navegacion/menu-por-areas.ts`): mover una pantalla de grupo o área es cambiar UNA fila.

## 5. Invariantes y políticas
1. No se pierde ni se repite ninguna pantalla (guardián en `test/navegacion/menu-por-areas.test.tsx`).
2. Todo ítem del menú tiene su fila (guardián): un ítem nuevo se ubica a propósito; sin fila cae en el área de su grupo de origen (no desaparece).
3. Lo que el rol no puede ver no aparece (el permiso se aplica antes de agrupar).
4. El interruptor `MENU_POR_AREAS` (hoy `true`) vuelve al menú de siempre, con los dos paneles.
5. Con las áreas, la política de empresa `dosPaneles` (ADR-010, perilla de plataforma) **no tiene efecto visible**: no hay paneles. Sigue guardada y vuelve a valer con el interruptor apagado. PROPUESTA, a confirmar con el Frente 4 (planes y perillas).

## Reparto de pantallas (PROPUESTA: el dueño la corrige en captura)
| Área | Grupo | Pantallas de Motor2 |
|---|---|---|
| Ventas | Salón | Mapa de mesas, Mostrador |
| Ventas | Clientes | Clientes con descuento («Clientes deberían estar en ventas», dueño 12/11/2026) |
| Ventas | Reportes | los 26 reportes (por prefijo `/reportes`) |
| Catálogo | Productos | Productos, Biblioteca de opciones, Maestros |
| Catálogo | Carta | Carta, Promociones, Apariencia y publicación |
| Catálogo | Stock | Existencias, Registrar movimiento, Merma, Conteo físico, (Carga de ventas sin ticket mientras no esté oculta), Configuración |
| Catálogo | Traspasos | Bandeja, Solicitar, Enviar directo |
| Compras | Compras | Compra |
| Compras | Proveedores | Proveedores («Los proveedores son de las compras», maqueta) |
| Cuenta | Empresa | Perfil de la empresa, Gerencia, Roles, Permisos, Capacidades por sucursal, Sucursales |
| Cuenta | Sucursal | Usuarios, Auditoría |

Lugar reservado, sin crear nada: **Compras › Órdenes de compra** (`/movimientos/ordenes-de-compra`, módulo `ordenes_de_compra`, acción `orden_de_compra_ver`; datos del Frente 5). Se suma la fila cuando exista la ruta y el módulo/permiso lo permitan.

## Diferencias con Pedernal (con motivo)
| Diferencia | Motivo |
|---|---|
| Existe el área Compras | La maqueta aprobada la tiene; el código de Pedernal todavía no la construyó. Motor2 ya tiene Compra y Proveedores. |
| Salón, Reportes, Stock, Traspasos, Carta y Maestros dentro de las áreas | Son funciones de Motor2 que Pedernal no tiene; «lo de Motor2 que Pedernal no tiene queda dentro de cada área, declarado». El reparto es PROPUESTA. |
| Grupos de Cuenta «Empresa» y «Sucursal» con la administración de Motor2 | Pedernal: Configuración fiscal y Medios de pago (Empresa), Contacto (Sucursal); acá van Roles, Permisos, etc. |
| «Cerrar sesión» no está en el menú | Motor2 lo tiene en el encabezado («Salir»); no se mueve. |

## 6–10. Historia, concurrencia, interfaces, consultas, pruebas
- No hay tablas ni migración: nada que persistir. Concurrencia/idempotencia/dinero/fechas: no aplican (presentación).
- Interfaces: `AppShell` arma el menú; `SidebarNav` y `MenuCelular` reciben `porAreas`; el botón de cada área lleva `aria-expanded`.
- **Combinaciones (regla del 2026-10-28)**: dimensión que cambia la visibilidad: el permiso del rol × el área. Oráculo escrito aparte del código: `ESPERADO` en `test/navegacion/menu-por-areas.test.tsx` (qué pantalla va en qué área y grupo, en orden) y guardián que falla si aparece un ítem sin fila.
- Pruebas: unitarias (oráculo, guardianes, los dos estados del menú lateral) y e2e `menu-por-areas.spec.ts`; los casos de los dos paneles (`menu-paneles.spec.ts` y partes de `permisos-plataforma.spec.ts`) se saltan con las áreas y corren con el interruptor apagado.

## Preguntas abiertas
- (PENDIENTE, una) ¿Los reportes viven todos en Ventas › Reportes, o cada uno en el área de lo que mide (ventas en Ventas, costos y stock en Catálogo, compras en Compras)? La propuesta es lo más barato: un solo grupo.
