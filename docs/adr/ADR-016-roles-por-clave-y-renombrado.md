# ADR-016: Los roles se identifican por su clave técnica; el nombre es una etiqueta que se puede renombrar

> Redactado el 2026-10-03 (cierre del bloque G, pasos G1–G3). **Decidido. Estado (2026-10-03): implementado** (G1 y G2 desplegados en zuluhub y
> stockhneuquen; G3 con la migración `20261007120000_accion_renombrar_rol` aplicada en ambas bases y el código listo para desplegar). Completa
> ADR-008 (RBAC acción + contexto) y ADR-010 (dos paneles): ninguno de los dos dice cómo se reconoce al rol administrador, y el código lo hacía
> comparando el nombre `"admin"`. Las decisiones de G3 son del dueño de producto, del 2026-10-03.

## Contexto

Hasta G1 el sistema sabía «cuál es el rol administrador» comparando `Rol.nombre === "admin"` (y lo mismo con «operador»). Eso hacía imposible renombrar
un rol de sistema: la empresa que quisiera llamar «Jefatura» a su administrador habría perdido sus permisos de gobierno sin aviso. Los nombres, además,
eran lo único que impedía que un rol creado a mano se hiciera pasar por uno de fábrica.

| Hallazgo | Evidencia | Estado |
|---|---|---|
| El administrador se reconocía por su nombre | comparaciones de `rol.nombre` en `core/permisos`, `core/auth`, acciones de usuarios y sucursales | VERIFICADO EN CÓDIGO (antes de G1) |
| Renombrar un rol de sistema lo habría dejado sin función | el nivel «administrador» salía del nombre | consecuencia derivada |

## Decisión

### 1. Clave técnica (G1)

`Rol.clave` (texto, nulo en los roles creados a mano, único por empresa, formato `^[a-z][a-z0-9_]*$`) identifica a los roles de sistema: `admin` y
`operador`. La migración `20261006120000_clave_de_rol_de_sistema` la agrega y rellena desde los nombres de entonces. **Ningún renombrado toca la clave.**

### 2. Decide la clave, no el nombre (G2)

Solo `core/permisos` lee la clave (`jerarquia.ts`: `CLAVE_ROL_ADMIN`, `esRolAdmin`, `nivelDeRolPorClave`; `filtros.ts`: los filtros por la clave del
rol administrador; `invariantes.ts`: el rol de sistema intacto; `gestion-de-usuarios.ts`; `gerencia.ts`). Fuera de esa carpeta nadie compara un rol ni
busca un rol de sistema por nombre: lo hace cumplir la regla 4 de `test/arquitectura/acceso-solo-por-el-guard.test.ts`. Las invariantes de gobierno
(administrador efectivo, gerente con sucursal, rol de sistema no desactivable, etc.) se miden por clave y dentro de la transacción de la escritura.

> **Rutas movidas (Hito 3, Fase II de la rama `pureza-integracion`, 2026-10-08).** Las lecturas de decisión de gobierno salieron de `core/permisos` a
> `server/lecturas/permisos` (ADR-026) con el mismo nombre y firma, y no nombran la clave: piden los filtros puros de `core/permisos/filtros.ts`
> (contrato C1). Las de las invariantes están en `src/server/lecturas/permisos/gobierno.ts`; `conInvariantesDeGobierno` (medir, escribir, volver a
> medir), en `src/server/actions/con-gobierno.ts`; las del techo de privilegio (quien actúa desde la base, a quien se toca, el rol admin, si se
> reactiva a un admin), en `src/server/lecturas/permisos/gestion-de-usuarios.ts`. Desde el contrato C4, un caso de uso o una persistencia tampoco lee `rol.clave` ni la pide en un
> `select`: el rol se lee con `SELECCION_DE_ROL_PARA_JERARQUIA` y se le pasa entero a `core/permisos` (regla 4 ampliada).

### 3. Renombrar un rol es una acción propia, `renombrar_rol` (G3)

- **Acción nueva**, no `gestion_roles`: es más específica, y el proyecto sigue la regla de una clave de permiso por acción. Contexto empresa, piso
  **administrador**, semilla de edición `admin`. La migración `20261007120000_accion_renombrar_rol` es aditiva e idempotente: inserta la acción y copia
  `PermisoRol` y `CapacidadSucursal` desde `gestion_roles`, así cada empresa conserva quién podía gestionar roles.
- **Se pueden renombrar todos los roles, incluidos los de sistema.** Cambia `Rol.nombre`; la clave, el nivel y los permisos no cambian. El cambio
  queda en la auditoría (entidad `Rol`, campo `nombre`, valor anterior y nuevo).
- **Nombres normalizados como al crear un rol** (`crearRol`): sin espacios en los bordes, en minúscula, espacios interiores juntos, 80 caracteres como
  máximo y el mismo alfabeto del catálogo. Dos roles de una empresa no pueden llamarse igual.
- **Nombres de fábrica reservados** (`core/permisos/nombres-de-rol.ts`): «admin» y «administrador» solo los lleva el rol con clave `admin`; «operador»
  y «operario», el de clave `operador`; «gerente» no lo lleva ningún rol (la gerencia es `UsuarioEmpresa.rolEmpresa`, no un rol). Rige al crear y al
  renombrar; **no es retroactiva** (un rol que ya se llama así no se toca). Un rol de sistema puede volver a su nombre de fábrica.
- **Pantalla de roles**: marca los roles de sistema con su clave técnica (solo lectura), no ofrece «Desactivar» en ellos y muestra «Renombrar» solo a
  quien tiene permiso de editar `renombrar_rol`.

## Alternativas descartadas

- **Reusar `gestion_roles` para renombrar.** Mezcla crear/desactivar con renombrar y no deja dar uno sin el otro.
- **Dejar fijos los nombres de los roles de sistema.** Evita el problema pero obliga a todas las empresas a hablar con las palabras del código.
- **Reservas retroactivas** (renombrar a la fuerza lo que ya choca). Toca datos de producción sin que nadie lo pida.

## Correcciones a otros ADR

Los ADR originales no se reescriben; ADR-008 y ADR-010 llevan una línea de estado que apunta a este.

1. **ADR-010, alternativa «Decidir por rol (`esAdmin`)».** Allí «por el nombre del rol» describía el criterio descartado para armar el menú; desde G2 el
   rol administrador se reconoce por su clave y el menú sigue saliendo de los permisos. No cambia la decisión de ADR-010.
2. **ADR-008, catálogo de acciones.** Se suma `renombrar_rol` (124 acciones). Las claves de «gestión de accesos» que siempre conservan al
   administrador entre sus roles de Editar siguen siendo las de `ACCIONES_QUE_REQUIEREN_ADMIN_SIEMPRE`.

## Consecuencias

- Una empresa puede llamar a su administrador «Jefatura» sin perder gobierno: la clave `admin` manda en el guard, las invariantes y la gerencia.
- Los scripts y tests que buscaban el rol de sistema por nombre (`seed`, fixtures de e2e, tests de integración) lo buscan por
  `empresaId_clave`.
- Mensajes al usuario: ya no dicen «admin» como nombre de rol sino «administrador»; las invariantes conservan la frase «admin activo» (la comparan
  tests de integración).
- Pendiente fuera de este ADR: el diagnóstico `diagnostico-roles-de-sistema.ts` sigue contando el rol llamado «admin» (por nombre) solo para avisar
  si falta la clave; con roles renombrados ese aviso depende de que la clave exista, que es lo que verifica el build.
