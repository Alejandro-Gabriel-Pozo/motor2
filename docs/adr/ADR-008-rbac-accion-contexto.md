# ADR-008: RBAC por acción y contexto, con jerarquía de niveles y un gerente por empresa

> Redactado el 2026-10-01. Recoge las decisiones del dueño del 2026-09-30 (tras auditar tres fugas de alcance de permisos) y lo ya
> implementado en `f0f6bfa`, `def9ea4`, `d991688` y `2ad044d`. Complementa ADR-007 (instalación multiempresa): ahí se decidió que una
> empresa es un dato; acá se decide cómo se reparte el poder dentro de ella. El schema NO cambia por lo decidido acá (vive en código y en
> migraciones de datos); la única excepción es la partición de las promos (§5), que sí lo toca — ver `20261001180000_promo_de_empresa`.
>
> Actualizado el 2026-10-02 (Tanda 8): el traspaso de gerencia ya tiene pantalla y clave propia (`traspasar_gerencia`), y `conGerenteDeEmpresa` se
> eliminó. El test `test/arquitectura/adr-al-dia.test.ts` verifica que las claves y las rutas que cita este ADR existan.

## Contexto

Una auditoría de alcance encontró tres fugas: (1) la gestión de usuarios apagaba la cuenta GLOBAL de una persona que podía pertenecer a
otras empresas; (2) quien tenía `gestion_usuarios` podía dar, tocar o desactivar a un admin; (3) las filas de auditoría de cambios de
empresa (roles, receta central), que no tienen sucursal, las veía cualquiera con la clave de auditoría. Las tres tienen la misma raíz: el
permiso decía QUÉ se puede hacer pero no DÓNDE vale ni QUIÉN está por encima de quién, y cada action tenía que recordarlo a mano.

**Requisitos del dueño:**

- Cada acción es un permiso propio (una clave por cosa que una persona puede hacer) y cada reporte es un permiso propio. Motivo: que el
  superadmin de plataforma elija los permisos desde el inicio de la app y, como add-on, que una empresa pueda o no editar/otorgar permisos
  a un usuario; y que los tests sean tan específicos que, si uno falla por error, otro avise (defensa en profundidad).
- El alcance de un permiso (empresa o sucursal) tiene que ser explícito en el catálogo, no depender de la memoria de cada action.
- Hay una jerarquía y nadie escala sobre el de arriba, por más que se elijan permisos desde la matriz.
- Decisión «X reemplaza Y» ⇒ vale para todas las capas, sin alcance parcial.

## Decisión

### 1. RBAC = acción + contexto

Cada entrada de `ACCIONES` (`src/core/permisos/acciones.ts`) declara dos cosas además de su clave y descripción:

- **`contexto`: `"empresa"` o `"sucursal"`.** Una acción de sucursal se evalúa en la sucursal activa del usuario (`requierePermiso`,
  `conPermiso`). Una acción de empresa se evalúa en todas sus membresías activas de la empresa: vale si el rol de CUALQUIERA de ellas la
  tiene (`requierePermisoDeEmpresa`, `conPermisoDeEmpresa`), y respeta la capacidad que la Central habilitó para cada sucursal.
- **`nivelMinimo`: `"operario" | "administrador" | "gerente"`** (el piso, ver sección 2).

El tipo `AccionClave` es estrecho y se parte en `AccionDeSucursal` y `AccionDeEmpresa`: pasarle a `conPermisoDeEmpresa` una acción de
sucursal no compila. El `contexto` vive solo en código (no hay columna): el catálogo es la fuente de verdad y la base solo guarda qué rol
tiene qué fila de `PermisoRol`.

Un test de arquitectura (`guardas-por-contexto.test.ts`) recorre `src/` y falla si una acción de empresa se guarda con una guarda de
sucursal, o al revés, y si una acción de empresa del catálogo no se guarda en ningún lado con la guarda de empresa.

### 2. Jerarquía de niveles y piso por acción

Niveles, de menor a mayor: **operario < administrador < gerente (uno por empresa) < superadmin de plataforma.**

- **Piso (`nivelMinimo`).** Cada acción declara el nivel mínimo para hacerla. El rol llega al piso así: `nivelDeRol(nombre)` es
  «administrador» solo para el rol de nombre `admin`; cualquier otro (`operador` y todo rol personalizado, p. ej. «mozo») es «operario».
  Las acciones de piso gerente no las alcanza ningún rol: las tiene solo el gerente de la empresa (`UsuarioEmpresa.rolEmpresa = "gerente"`, activo y con
  alguna membresía activa en la empresa; el gate lo resuelve con `esGerenteDeEmpresa`), no entran a la matriz ni a la capacidad de la Central, y por eso
  son siempre de contexto empresa. Hoy son dos: `ver_auditoria_empresa` y `traspasar_gerencia`.
- **Se hace cumplir en dos lugares.** `guardarPermisos` rechaza dar una acción por encima del nivel del rol (todo o nada: un lote con una
  celda ilegítima no guarda ninguna; sí deja SACAR una fila vieja). Y el gate ignora la fila de un rol por debajo del piso aunque exista
  (permiso, menú y lecturas), así un dato viejo o una migración no se convierten en acceso. Las filas viejas por encima del piso quedan en
  la base: no se limpian, se ignoran.
- **La matriz** marca esas celdas con 🚫 y muestra la columna «Piso».
- **Test guardián anti-escalada** (`jerarquia-de-niveles.test.ts`, `gate-piso-gerente.test.ts`): cubre el catálogo, `guardarPermisos`, cada
  función del gate, el menú, un usuario con dos membresías de distinto nivel y dos empresas.
- **El gerente conserva su rol por sucursal** (normalmente `admin`) y suma lo suyo; el piso gerente se chequea aparte.

Las dos acciones de piso gerente se declaran en `ACCIONES` con `rolesEditarSemilla: []` y sin clave madre (no había nada que heredar). Se gatean con
`conPermisoDeEmpresa` / `requierePermisoVerDeEmpresa`, nunca con un chequeo de gerente suelto: `conGerenteDeEmpresa` ya no existe.

### 3. Un solo gerente por empresa

El gerente es `UsuarioEmpresa.rolEmpresa = "gerente"` y hay uno por empresa. Se hace cumplir **en código primero**:

- La empresa nunca queda sin gerente. Lo traspasa el propio gerente (`transferirGerencia`, `conPermisoDeEmpresa("traspasar_gerencia")`, desde `/administracion/gerencia`, y confirmando con el email de la persona elegida) o la
  plataforma (la función del core, `transferirGerenciaDeEmpresa`, sin guarda de rol: la plataforma la llama con su propio contexto).
- El destino tiene que ser un admin activo de la empresa, con la cuenta activa en la empresa y `activoGlobal`. La baja del gerente anterior
  es condicional (`updateMany` sobre `rolEmpresa = "gerente"`): si la gerencia cambió mientras tanto, el traspaso se rechaza. Queda fila
  de auditoría (`UsuarioEmpresa`, campo `rolEmpresa`).
- Nadie más que el gerente modifica al gerente (rol, sucursales ni cuenta). El gerente no puede desactivar su propia cuenta ni quedarse sin
  ninguna sucursal activa (sin ninguna no tendría contexto y la gerencia quedaría huérfana): traspasa antes.
- El bootstrap de un usuario nuevo no crea un segundo gerente.
- **Migración de datos** `20261001120000_gerente_unico_por_empresa`: por empresa, si hay varios gerentes queda el más antiguo; si no hay
  ninguno, el admin activo más antiguo (el creador de la empresa; en dev, `alepogabriel@gmail.com`). Idempotente y probada con dos empresas.

### 4. Cuenta, techo del admin y auditoría

- **Desactivar una cuenta es por EMPRESA**: el interruptor es `UsuarioEmpresa.activo`. `User.activoGlobal` queda solo para la plataforma.
  Una cuenta compartida entre empresas se apaga solo en la que lo decide.
- **Techo del admin**: dar, tocar o desactivar a un admin lo hace un admin de esa sucursal o el gerente; `gestion_usuarios` sola no alcanza.
- **Auditoría**: las filas sin sucursal (cambios de empresa) no las ve cualquiera; el alcance de cada vista lo decide el contexto de la
  acción que la gobierna. `ver_auditoria_empresa` (empresa, piso gerente, sin matriz) reemplazó el chequeo de gerente de la página de auditoría.

### 5. Partición de claves (una clave por acción)

Es la consecuencia operativa de «una clave por acción». Se hace con **expand/contract** y sin schema:

- **Expand**: cada clave nueva se crea con una migración de DATOS que copia las filas de `PermisoRol` de la clave madre (con `empresaId`
  explícito, idempotente, probada con dos empresas), de modo que nadie pierde ni gana acceso en el deploy.
- **Contract**: borrar las claves madre (`Accion`) en un deploy POSTERIOR, cuando ningún código las lea.
- Orden: infraestructura → reportes → operaciones/POS/carta/catálogo → administración → contract.
- Hecho: infraestructura; reportes (26 claves `reporte_*` reemplazan a las 4 `ver_reportes_*`; migración
  `20261001100000_particion_permisos_reportes`); piso `nivelMinimo`; un gerente por empresa; operaciones/POS/catálogo grupo A (19 claves,
  `20261001130000_particion_permisos_stock_pos_catalogo`; el banco de pruebas de migraciones de partición es reutilizable); grupos B
  (`motivos_*`, `traspaso_*`) y C (`carta_*`); administración (`gestion_roles`, `activar_usuario_sucursal`, `notas_usuario_sucursal`,
  `apagar_cuenta_empresa`, `activar_sucursal`, `renombrar_sucursal`, `ver_auditoria_empresa`; migración
  `20261001160000_particion_permisos_administracion`); catálogo: la última clave mixta, `editar_producto`, pasa a `producto_editar`,
  `producto_asignar_insumo` y `producto_sincronizar_precio_carta` (las tres de empresa; migración `20261001170000_particion_permisos_producto`).
  Las nuevas de administración son todas fijas para el admin (piso administrador).
  Promos (2026-10-01, schema autorizado por el dueño): «promociones, un solo concepto». Una promo es SOLO la promo compuesta de la carta
  (`PromoCarta`), definida una vez por empresa y prendida por sucursal (`PromoCartaSucursal`, con precio local opcional). `carta_promos` se
  parte en `carta_promo_definir` (empresa), `carta_promo_activar` y `carta_promo_precio_local` (sucursal); desaparecen `promociones_config`,
  `promociones_activar`, `promociones_marcar_combo`, el reporte `/reportes/promociones`, `PromocionProducto` y `Sucursal.promocionesHabilitadas`
  (migración `20261001180000_promo_de_empresa`, con `down.sql`; el banco de pruebas de partición aprendió `desdeMarca` y `retiradasDespues`).
  Un producto suelto con descuento NO es una promo: es «producto con descuento» (porcentaje en la carta, Fase 2, aparte).
  Fase 2 (2026-10-01, schema autorizado): «producto con descuento». El porcentaje vive por sucursal (`DescuentoProductoSucursal`, migración
  `20261001190000_descuento_producto_sucursal`) y lo fija `carta_producto_descuento` (contexto sucursal; copia lo que cada rol tenía en
  `carta_contenido_producto`, que es de empresa: estrechamiento deliberado). Reporte propio `reporte_descuentos_productos` (migración de datos
  `20261001191000`). Rige en carta y POS, NO en mostrador; con el descuento del cliente se aplica SOLO EL MAYOR (no cascada).
- Se retiraron `ejecutar_tests` y `sincronizar_proveedores` del catálogo (sin consumidor; sus filas `Accion` quedan hasta el contract). Los catálogos CRUD simples (proveedores, categorías,
  secciones, unidades, clientes) se dejan con Ver/Editar, sin partir. Las claves de admin de usuarios/permisos son fijas para el admin.

## Alternativas descartadas

- **Clonar `Rol`/`PermisoRol` a nivel empresa.** Cualquier tabla o columna nueva de permisos por contexto requeriría schema; el contexto
  vive en el catálogo de código y no hace falta.
- **Agrupar permisos (p. ej. 4-5 claves `ver_reportes_*`).** Era la decisión del 2026-09-19; el dueño la reemplazó por una clave por reporte
  (más control y tests más específicos).
- **Dejar que cada action recuerde su alcance.** Es la causa de las tres fugas; por eso el contexto es dato del catálogo y hay un test que
  cruza catálogo y guardas.
- **Que el piso se aplique solo al guardar.** Un dato viejo o una migración lo saltearían; el gate también ignora la fila.
- **Gerente por sucursal.** El gerente es de la empresa; una acción de piso gerente es por definición de contexto empresa.

## Consecuencias

- Agregar una acción obliga a declarar contexto y piso, y los tests de catálogo/guardas/matriz fallan si no coincide con el uso.
- Cada permiso nuevo cuesta una migración de datos y su prueba con dos empresas; a cambio el despliegue no cambia el acceso de nadie.
- Un rol personalizado nunca llega a una acción de administrador, aunque alguien lo intente desde la matriz o con datos viejos.

## Riesgos y pendientes abiertos

- ~~**Índice único del gerente en la base**~~ — HECHO (migración `20261001240000_gerente_unico_indice`, aplicada también en stockhneuquen).
- ~~**UI del traspaso de gerencia**~~ — HECHO (2026-10-02, Tanda 3): `/administracion/gerencia`, clave propia `traspasar_gerencia` (contexto empresa, piso
  gerente), confirmación escribiendo el email del destino (se compara sin espacios ni mayúsculas) y auditoría con emails.
- **Gerente cuyo rol de sucursal no es `admin`**: no alcanza las acciones de piso administrador (el piso sale del rol de la sucursal). Hoy
  el gerente es siempre un admin activo al asumir, pero nada impide después cambiarle el rol en una sucursal. Decisión de diseño abierta.
- **Superadmin de plataforma**: no existe como concepto en el código; hoy es una función del core que su herramienta puede llamar.
- **Add-on «la empresa edita/otorga permisos»** y catálogo/plan de permisos por empresa: el CABLEADO ya está (2026-10-01, sin schema): `politicaDeEmpresa`
  (`core/permisos/politica-de-empresa.ts`, hoy siempre `permisosEditables: true`) y el gate `conEdicionDePermisos` (`server/actions/con-permiso.ts`) que
  usan `guardarPermisos`, `crearRol` y `actualizarActivoRol`; el guardián `escrituras-de-permisos-por-politica.test.ts` exige que toda escritura de
  `PermisoRol`/`Rol` de `src/` pase por él (excepción: el alta de empresa). Falta el DATO (dónde se guarda la perilla y el plan/catálogo de permisos
  por empresa), que sí necesita schema y autorización expresa; cuando exista, solo cambia el cuerpo de `politicaDeEmpresa`.
- **Suscripción** (próxima acción de piso gerente): no existe; hace falta schema y su propia clave.
- **Partición pendiente**: solo el contract (borrar las `Accion` padre en un deploy posterior). Ya no queda ninguna clave mixta.
- **Contexto empresa de las claves de producto**: vale si CUALQUIER membresía activa de la empresa la tiene (más laxo que la sucursal activa),
  igual que `alta_producto`. Un producto es dato de empresa, así que es lo coherente; la edición por campo (p. ej. el precio) no se partió.
