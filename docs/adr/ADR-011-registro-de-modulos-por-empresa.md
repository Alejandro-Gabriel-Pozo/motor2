# ADR-011: Registro de módulos por empresa

> Redactado el 2026-10-03 (Bloque 0 del plan de plataforma). **Decidido. Estado (2026-10-03): implementado** en la rama `multitenancy-fase-a` (tabla
> `ModuloEmpresa` `622a7c8`, verificación en el build `fd850fb`, guard y menú `a0cce27`, alta y baja solo por la plataforma `0a3f3b0`); falta aplicar las
> migraciones en cada base antes de su deploy (`docs/deploy-con-migraciones.md`). Cuando se redactó, ni la tabla ni el campo `modulo` de las
> acciones existían. Complementa ADR-007 (una empresa es un dato), ADR-008 (permisos por acción y contexto) y ADR-010 (paneles). Lo
> implementa el bloque 5A del plan; cada migración que haga falta se autoriza por separado.
>
> Corregido por ADR-014 (2026-10-03): no hay núcleo de negocio (solo Administración es fija; Stock y Proveedores son módulos) y se agregan los
> módulos de soporte calculados (§2 y §3).

## Contexto

Hoy toda empresa tiene todo. Lo único que se puede apagar es la política de la empresa (`permisosEditables`, `dosPaneles`) y, por sucursal, la
capacidad (`CapacidadSucursal`). No existe el concepto «esta empresa contrató Compras pero no Salón», y el dueño lo necesita para vender
módulos por separado, tener versiones chicas para clientes chicos y poder sumar funciones nuevas sin que las vea quien no las contrató.

Tres cosas distintas se confunden fácil, y este ADR las separa:

| Pregunta | Quién decide | Dónde vive | Ejemplo |
|---|---|---|---|
| ¿La empresa **tiene** esta funcionalidad? | La plataforma | **Módulo** (este ADR) | Compras, Salón, Carta |
| ¿Esta **sucursal** la usa? | El gerente de la empresa | **Capacidad por sucursal** (ADR-009) | La sucursal 2 no maneja salón |
| ¿**Quién** puede hacerla? | El administrador de la sucursal | **Rol y permiso** (ADR-008) | El operador no anula ventas |

La política de empresa (`permisosEditables`, `dosPaneles`) no es ninguna de las tres: no habilita funcionalidad, cambia cómo se ve y quién
administra los permisos.

## Decisión

### 1. Un registro de módulos por empresa

Una tabla `ModuloEmpresa` (empresa, módulo, estado). Con RLS por empresa para lectura; la escritura la hace únicamente el rol de base de datos de la
plataforma (ADR-012), nunca la propia empresa. Las empresas de la instalación **no** pueden activarse ni desactivarse módulos.

El **catálogo de módulos** (qué módulos existen, sus dependencias y su estado de desarrollo) es código, versionado con la aplicación. La tabla
solo dice cuáles tiene cada empresa.

### 2. Núcleo: lo que toda empresa tiene, sin filas

El núcleo no se registra: es Stock, lo que Stock exige para funcionar (productos, insumos, unidades, sucursales, usuarios y roles,
**Proveedores** — decisión del dueño, 2026-10-03) y Administración. Una empresa sin ninguna fila en el registro sigue teniendo núcleo.
Que el núcleo no tenga filas es lo que hace seguro el despliegue: ninguna acción del núcleo puede quedar bloqueada por un registro vacío.

Toda acción de `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE` (las que dejan a la empresa sin forma de administrarse si se pierden) pertenece al núcleo.

### 3. Dependencias entre módulos

- **Dura** (`requiere`): el módulo no funciona sin el otro. Activar uno exige que el otro esté activo; desactivar uno exige que no haya activos
  que lo requieran.
- **Blanda** (`usaSiExiste`): el módulo funciona solo y se integra con el otro si está. Sin el otro, la integración simplemente no aparece
  (no es un error ni una pantalla vacía).
- **Datos requeridos** (`datosRequeridos`): datos de la empresa sin los cuales el módulo no puede activarse (por ejemplo, datos fiscales
  completos para facturar). La plataforma ve qué falta antes de activar.

Los campos que un módulo agrega a tablas existentes **amplían** y nunca son `NOT NULL` en la tabla de base: un módulo apagado no puede romper
el alta de un producto.

### 4. Cada acción declara su módulo

Cada entrada del catálogo `ACCIONES` declara su `modulo`, **obligatorio**: o un módulo del catálogo o «núcleo». Un guardián de arquitectura
rechaza una acción sin módulo, del mismo modo que hoy rechaza una acción sin contexto. Así una acción nueva no puede olvidar a qué
funcionalidad pertenece.

### 5. Un solo guard, tres filtros en orden fijo

El guard de acciones que ya existe evalúa, **en este orden**:

1. **Módulo** — ¿la empresa tiene el módulo de la acción? (el núcleo siempre pasa)
2. **Capacidad** — ¿la sucursal activa tiene la capacidad? (ADR-009)
3. **Rol** — ¿el usuario tiene el permiso en ese contexto? (ADR-008)

El orden importa para el mensaje: quien no tiene el módulo debe enterarse de eso, no de que «le falta permiso». La plataforma no se evalúa acá:
no es una acción de empresa.

El resultado de la evaluación, hoy un texto, pasa a llevar un **motivo tipado**: `MODULO_EN_DESARROLLO`, `MODULO_NO_ACTIVO`,
`SIN_CAPACIDAD` o `SIN_PERMISO`. La traducción del motivo a mensaje para el usuario se hace en **un solo lugar**, no en cada acción. Los
mensajes dicen la verdad de cada caso: «próximamente» para lo que está en desarrollo; «tu empresa no lo tiene activo, consultá a tu
administrador de plataforma» para lo no contratado.

Los módulos activos de una empresa se leen **una vez por pedido** (no una consulta por acción).

### 6. Catálogo con estado: `disponible` o `en_desarrollo`

Un módulo `en_desarrollo` aparece en el catálogo de la plataforma como «Próximamente» y **nunca se puede activar ni entrar**. Permite mostrar el
mapa de lo que viene sin construirlo todavía y ofrecer a un cliente que lo pidió algo concreto que anotar.

### 7. La política de empresa queda fuera del registro (por ahora)

`permisosEditables` y `dosPaneles` siguen en `Empresa`, y siguen siendo escritas solo por la plataforma. El dueño decidió (2026-10-03) no
migrarlas al registro todavía. Si más adelante se migran, será una decisión y una migración propias.

Una consecuencia a anotar: los atajos de código `completo` y `lite` (que fijan las dos perillas) se llamaban «planes» pero no lo son en el sentido
de ADR-013 (un plan es un dato que agrupa módulos). Se renombraron a «perfil de política» (2026-10-03): en el código, `PERFILES_DE_POLITICA` y la opción `--perfil` del script de política.

### 8. Las opciones y tipos de ítem vendible quedan fuera de esta etapa

Visión del dueño, **no se implementa ahora**: que ciertas opciones de la aplicación y ciertos tipos de ítem vendible (por ejemplo, ítems que no
son un producto con stock) dependan de un módulo. Cuando lleguen, cada opción será **una acción o un valor tipado que declara su módulo** y la
controlará el mismo guard del punto 5. Por eso:

- no hace falta construir nada extra ahora ni listar opciones en el catálogo de módulos;
- lo único que aplica desde ya: **no escribir código nuevo que asuma que todo lo vendible es un producto con stock**, y no acoplar el catálogo
  de ítems ni el futuro vínculo con la facturación al stock.

## Alternativas descartadas

- **Un `Plan` fijo en una columna de `Empresa`** (como hoy `completo`/`lite`): obliga a tocar código por cada combinación nueva y no permite que
  la plataforma arme paquetes. Los planes pasan a ser datos (ADR-013).
- **Módulo opcional en la acción** (acciones sin módulo = núcleo implícito): una acción nueva olvidada quedaría disponible para todos sin que
  nadie lo decidiera. Se exige declararlo.
- **Migrar la política de empresa al registro ya**: aumenta el alcance del bloque 5A sin necesidad; se puede hacer después sin rehacer nada.
- **Filtrar solo la UI** (esconder el menú): no protege nada; el guard de la acción es lo que cuenta, la UI solo lo refleja.

## Correcciones a otros ADR

Los ADR originales no se reescriben; lo que ya no es cierto se corrige acá y cada uno lleva una línea de estado que apunta a este.

1. **ADR-008, «Superadmin de plataforma» y «Add-on la empresa edita/otorga permisos».** Dicen que la política de empresa «hoy siempre» es
   `permisosEditables: true` y que «falta el dato». El dato existe: son las columnas `Empresa.permisosEditables` y `Empresa.dosPaneles`
   (por defecto `true`), que solo cambia la plataforma. Siguen sin existir el plan y el catálogo de permisos por empresa; la política queda
   fuera del registro de módulos (punto 7).
2. **ADR-010, §4.** Dice que `dosPaneles` «hoy es una constante `true`, sin columna». Es la columna `Empresa.dosPaneles`.
3. **ADR-007, política por empresa.** La lista de tablas «nuevas de plataforma» no registra las columnas de política de `Empresa`.

## Fases

El orden de implementación y las migraciones están en el plan de plataforma (no en este ADR): primero el registro con backfill —cada empresa
existente recibe las filas necesarias para **no perder ninguna funcionalidad que hoy usa**—, después el campo `modulo` obligatorio en las
acciones y el guard ampliado, y recién al final los módulos nuevos. Antes de tocar el guard se fija con un test «golden master» lo que hoy ve cada
rol en una empresa completa; ese test tiene que seguir verde después del registro.

## Consecuencias

- Cambia la forma del resultado del guard (de texto a motivo tipado): se toca el guard central y las acciones que lo envuelven.
- Se agrega una dependencia nueva de cada pedido (los módulos de la empresa), mitigada leyéndola una sola vez.
- Una empresa nueva queda con **solo el núcleo** hasta que la plataforma le asigne un plan o módulos: el alta nunca otorga módulos por defecto.
- Las pruebas de integración y e2e crean empresas de prueba con todos los módulos activos, para no volver a escribir cada fixture.
