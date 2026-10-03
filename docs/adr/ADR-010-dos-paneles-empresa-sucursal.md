# ADR-010: Dos paneles en el menú lateral, Empresa y Sucursal

> Redactado el 2026-10-01 (Lote 3, tanda B). Sin schema. Complementa ADR-008 (RBAC acción + contexto): el contexto de cada acción
> (`empresa` / `sucursal`) es lo que decide a qué panel va cada pantalla.
>
> Corregido por ADR-011 (2026-10-03): `dosPaneles` ya es una columna de `Empresa` (por defecto `true`), no una constante (§4).

## Contexto

El menú lateral mostraba un solo árbol con todos los módulos. Para quien administra la empresa mezcla dos cosas distintas: lo que afecta a
la empresa entera (roles, sucursales, catálogo compartido, recetas) y lo que es la operación de la sucursal en la que está parado
(movimientos, stock, reportes, salón). El dueño pidió separarlos en dos paneles, Empresa y Sucursal.

## Decisión

### 1. Opción B: mismo árbol de rutas, un selector de panel en el sidebar

Las URL no cambian. El sidebar muestra, arriba, un selector de dos botones (`role="group"`, «Panel del menú»; «Empresa» / «Sucursal», con
`aria-pressed`), y debajo solo los grupos del panel elegido.

Cada `ItemNav` (`src/core/navegacion/estructura.ts`) declara su `panel`: `"empresa"`, `"sucursal"` o `"ambos"` (tipo `PanelNav` en
`src/core/navegacion/panel.ts`; el panel que se muestra es `PanelActivo`, nunca `ambos`). Un ítem `ambos` aparece en los dos paneles.
Es obligatorio: un ítem nuevo sin `panel` no compila.

Funciones puras (testeadas en `test/navegacion/paneles.test.ts`):

- `particionarMenu(grupos)`: reparte los grupos por panel, descarta los grupos que quedan vacíos y conserva el orden.
- `panelDeRuta(pathname)`: el panel de la pantalla abierta, o `null` si es de ambos paneles, el inicio o una ruta desconocida. Reutiliza la
  coincidencia de `hrefActivoDelMenu` (la misma que marca el ítem activo), así que una pantalla hija (`/catalogo/recetas/x/historial`) o una
  ruta fuera del menú (`RUTAS_FUERA_DEL_MENU`) hereda el panel del ítem del que cuelga.
- `mostrarSelectorDePaneles(grupos)`: verdadero solo si el menú YA FILTRADO por permisos tiene al menos un ítem exclusivo de Empresa y el
  panel Sucursal no queda vacío. Si no (el operador, quien solo tiene el salón, quien solo ve Empresa), el menú es único, como antes.

### 2. Qué panel está activo

El panel activo es el de la pantalla abierta. En una pantalla de ambos paneles (`/catalogo/productos`), en `/inicio` o en una ruta
desconocida se conserva el último panel elegido (`localStorage`, clave `motor2:panel-del-menu`; sin dato, Sucursal). Una pantalla de un
solo panel lo guarda como el último. Entrar por URL a una pantalla de Empresa activa Empresa sin que el usuario toque el selector.

### 3. Qué va en cada panel

La regla es el **contexto de la acción** de la pantalla (ADR-008): una acción de empresa es del panel Empresa; una de sucursal, del
panel Sucursal. Un test (`paneles.test.ts`) compara el `panel` de cada ítem con `contextoDeAccion(item.accion)` y solo admite excepciones
escritas con su motivo. Hoy las únicas son los `ambos` de **Productos** y **Nuevo producto**: el catálogo es de la empresa, pero cada
sucursal lo mira y edita lo suyo (disponibilidad, precio local).

- **Empresa:** roles, permisos, capacidades por sucursal, sucursales, proveedores (y su comparativa), clientes, recetas, grupos de insumos,
  categorías, unidades, carta agrupada, portal de la carta, motivos de merma, destinos de consumo, huecos del catálogo.
- **Ambos:** Productos y Nuevo producto.
- **Sucursal:** todo lo demás (usuarios, auditoría, carta y su tema, movimientos operativos, secciones, precio local, stock, reportes,
  traspasos, mesas).

Defaults asumidos, cambiables con una línea (el `panel` del ítem): Usuarios, Auditoría y Consolidado (stock y reportes) en Sucursal;
«Calibrar recetas» (`/reportes/rendimiento-recetas`) ya está en el panel Sucursal y no se mueve (decisión del dueño, 2026-10-02).

### 4. `dosPaneles` en la política de la empresa

`politicaDeEmpresa(empresaId, db)` (`src/core/permisos/politica-de-empresa.ts`, el mismo punto donde vive `permisosEditables`) devuelve
`dosPaneles`. Hoy es una constante `true`, sin columna: igual que `permisosEditables`, el día que haya un plan por empresa será un dato
(requiere schema, autorización aparte) y una **versión «lite»** tendrá `dosPaneles: false` = el menú único de siempre. El sidebar sigue
funcionando con la política apagada (cubierto por los e2e previos al flip, que pasaron idénticos).

## Alternativas descartadas

- **Rutas separadas `/empresa/...` y `/sucursal/...`.** Rompe enlaces, marcadores, `EnlaceInterno`, el `redirect` post-login y todos los
  e2e que hacen `page.goto`; duplica o reubica pantallas que son de ambos paneles; y obliga a decidir un panel por URL cuando un ítem
  (Productos) es de los dos. El panel es una vista del menú, no una dimensión de la ruta.
- **`?panel=empresa` en la URL.** Ensucia cada enlace del menú y cada redirect, hay que propagarlo en cada navegación (se pierde al primer
  `Link` que se olvida) y el panel se puede contradecir con la pantalla abierta. Derivarlo de la ruta es más simple y no tiene estado que
  sincronizar.
- **Decidir por rol (`esAdmin`).** El panel Empresa sale de los permisos (el menú ya viene filtrado), no del nombre del rol; así un rol
  de gerente con solo algunas pantallas de Empresa también lo ve.

## Fases

- F0: `panel` en cada ítem, `panelDeRuta` / `particionarMenu` / `mostrarSelectorDePaneles`, test.
- F1: sidebar con selector detrás de `dosPaneles = false` (UI idéntica).
- F2: `dosPaneles = true`; spec e2e `menu-paneles.spec.ts` (admin ve dos paneles, un rol sin Empresa no ve selector, entrar a
  `/catalogo/categorias` activa Empresa, Productos conserva el último panel, axe en ambos paneles).
- **F3 (decidida 2026-10-02):** «Calibrar recetas» no se mueve (ya está en Sucursal). El resumen del selector se reduce a mostrar el nombre de la sucursal activa como texto visible bajo el selector; nada más.

## Consecuencias

- Un ítem de menú nuevo debe declarar `panel`; el test lo obliga a coincidir con el contexto de su acción.
- Los e2e que llegan a una pantalla con `page.goto` no cambian; uno que haga clic en un enlace del sidebar de otro panel debe elegir
  primero el panel con el selector.
- La asignación de paneles que depende de acciones se prueba por perfiles en `test/navegacion/paneles.test.ts` (admin, operador, solo salón,
  solo Empresa, mixto, vacío), porque los roles de prueba de e2e (`abrirComoRol`) nunca alcanzan el piso de administrador y no pueden ver
  pantallas de Empresa.
- El contraste de los enlaces inactivos del sidebar en modo oscuro (`text-neutral-500` sobre fondo oscuro, 4.17:1) no llega a 4.5:1; es
  anterior a este cambio (los scans axe existentes miran `main` en oscuro) y no se tocó.
