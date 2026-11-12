# Diseño: poda de promos (vigencia, días de la semana, menú del día y campos sin lector) — 2026-11-12

Estado: **solo diseño, sin código ni migración.** Nada de esto se aplica hasta que el dueño lo apruebe y, para la base, hasta su aviso expreso, base por base. Estados: **CONFIRMADA** (dicha por el dueño con fecha y cita), **PROPUESTA**, **PENDIENTE**, **NO VERIFICADA**. Código leído en `main` 789f99a (grep sobre `src/`, `test/`, `scripts/`, `plataforma/`, `prisma/` incluidas migraciones y `seed.ts`, y todo `.sql`/`.mjs`/`.cjs`/`.json`/`.yml`/`.sh` del repo).

Pedido del dueño (CONFIRMADA): a la pregunta del orquestador «¿borramos la vigencia, los días de la semana, el menú del día y los campos muertos que enumeré?» contestó «Si» — 2026-11-12 — chat con el orquestador. Antecedentes escritos del dueño: revocó la vigencia el 2026-10-20 (noche; anotado en el documento del 2026-10-22) («la promoción NO tiene vigencia desde/hasta, ni carga por fecha», `docs/pendientes-sesion-2026-10-22.md:81-95`) y descartó el menú del día («se descarta como flujo normal la carga por fecha y sucursal», ídem `:77-81`); ambas quedaron **ocultas por interruptor** (`VIGENCIA_DE_PROMO_VISIBLE = false`, `MENU_DEL_DIA_VISIBLE = false`) y hoy son código muerto detrás de un `false`.

Antecedente de segunda mano (**PROPUESTA hasta que el dueño lo confirme directo**; el orquestador y la sesión de auditoría lo transcribieron, dicho «textualmente» por el dueño en el chat de esa sesión, 2026-11-12; la fuente directa es ese chat y falta que el dueño lo confirme acá): «Sí, también las promos plato del día. Solo queda la parte como promoción. Sin eso, plato del día, sin menú del día, nada de eso.» Según la regla I1 de `AGENTS.md` no vale como aceptación hasta que llegue directo con su fuente; acá solo orienta el alcance (ver §1.6 y §8).

Regla de poda (`AGENTS.md`, 2026-10-28): se prefiere achicar antes que mantener opciones que nadie pidió; primero ocultar, después borrar, con aviso al dueño. Esto es el segundo paso.

## 0. Resumen para el dueño (lenguaje de proceso)

1. Se borran del sistema tres cosas que ya no se ven: **la vigencia de una promo** (desde/hasta y días de la semana), **el menú del día** (el plato del día cargado por fecha y sucursal, su pantalla y su permiso) y **dos campos que nadie lee** (`PromoCarta.creadoEn` y `EntradaDeCupo.actualizadoEn`).
2. Se conserva todo lo que es rastro de dinero: lo que se vendió de una promo (precio congelado, fecha y quién), el orden de los lugares, el control de edición y «solo salón».
3. Se hace en **dos tiempos**. Tiempo 1: el código deja de leer y escribir esas cosas, **sin tocar la base**; si algo sale mal se revierte el cambio y listo. Tiempo 2: una migración borra las columnas y la tabla; es destructiva, así que va aparte, con respaldo, ensayo y **solo cuando vos avises, base por base**.
4. Medido hoy en la base principal (por el orquestador, solo lectura): 1 promo, 0 con vigencia, 0 lugares «del día», 0 platos del día, 0 promos vendidas. Las demás bases (demo y otras) **no están verificadas**: antes de aplicar hay que correr una consulta de conteo en cada una (§7); si alguna tiene datos, se frena y se te pregunta.
5. Sin migración en este PR; este documento no cambia nada del sistema.

## 1. Inventario contra el código real

### 1.1 Vigencia (`vigenteDesde`, `vigenteHasta`, `diasDeSemana`)

| Capa | Dónde | Qué hace hoy |
|---|---|---|
| Base | `prisma/schema.prisma` modelo `PromoCarta`; migración `20261021100000_go3d_combos_y_menu_del_dia` (CHECK `PromoCarta_vigencia_chk`, `PromoCarta_dias_de_semana_chk`) | Tres columnas nulables con dos CHECK |
| Núcleo | `src/core/carta/vigencia-de-promo.ts` (+ `VIGENCIA_DE_PROMO_VISIBLE`, `promoVigenteEl`, `validarVigenciaDePromo`, `mascaraDeDias`, `TODOS_LOS_DIAS`; reexportado en `src/core/carta/public.ts:89`); `VigenciaDePromoAdmin` en `src/core/carta/admin-tipos.ts`; `src/core/features/carta/combos.guard.ts`; `diaDeLaSemana` en `src/core/tiempo/zona-horaria.ts` (solo lo usa la vigencia) | Evalúa si la promo vale hoy |
| Servidor | `src/server/actions/carta/combos.ts` y `casos-de-uso/guardar-vigencia-promo-carta.ts` (acción `guardarVigenciaPromoCarta`, auditada); `src/server/consultas/carta/combos.ts`; `src/server/persistencia/carta/combos.ts` | Guardar y leer la vigencia |
| POS | `src/server/lecturas/pos/promo-para-agregar.ts` (si la promo tiene alguna columna de vigencia y no vale hoy → `null`); `src/server/lecturas/pos/selector-carta.ts:105-143` (filtra promos por `promoVigenteEl`) | La promo fuera de vigencia no se ofrece ni se agrega |
| Pantalla | `src/app/(app)/carta/parametrizacion/formularios.tsx` (bloque «Vigencia», oculto), `promociones/page.tsx:313` | Oculto por interruptor |
| Auditoría | `src/core/permisos/auditoria.ts:97-98` (comentario: la vigencia va con la entidad `PromoCarta`) | Filas históricas de `RegistroAuditoria` con `campo = vigenteDesde/vigenteHasta/diasDeSemana`: **se conservan** (la auditoría solo se agrega) |
| Guardianes | `test/arquitectura/guardas/columnas-de-significado.ts:117-119` (declaradas «dinero»); `cerco-columnas-de-significado.test.ts`; `escrituras-auditadas.test.ts` | Ver §5 |
| Pruebas | `test/core/carta-vigencia-de-promo.test.ts`, `test/carta/vigencia-de-promo-interruptor.test.tsx`, `test/carta/retirados-por-decision-del-duenio.test.tsx`, `test/carta/promo-solo-salon-caso-de-uso.test.ts`, `test/carta/entradas-de-cupo-go3.test.ts`, `test/carta/visibilidad-de-promos-matriz.test.ts` (oráculo), `test/aislamiento/denegacion/generadores.ts`, `test/aislamiento/paquete-go3-subir-bajar-subir.test.ts`, `test/persistencia/migracion-go3d.test.ts`, `test/catalogo/caracterizacion/dinero-tramo-c.test.ts`, `test/pos/agregar-combo-go3.test.ts`, `test/pos/selector-combos-go3.test.ts`, `test/e2e/carta-promo-cupos-lista.spec.ts` | Se actualizan o se borran con el código |
| ADR | `docs/adr/ADR-032-combos-menu-del-dia-y-combinaciones.md` (D-7: vigencia) | Se enmienda |

Verificado SIN usos: `scripts/`, `plataforma/src`, `prisma/seed.ts`, SQL crudo de reportes, `.github/`, cualquier `.sql` fuera de `prisma/migrations` (0 coincidencias para `vigenteDesde|diasDeSemana|EntradaDelDiaDeCupo`).

### 1.2 Menú del día (plato del día)

| Capa | Dónde |
|---|---|
| Base | Tabla `EntradaDelDiaDeCupo` (`schema.prisma`, modelo propio de la sucursal con RLS por sucursal: `20261021101000_go3d_rls_sucursal_menu_del_dia`); `PromoCartaCupo.tipo = 'DEL_DIA'` (CHECK `PromoCartaCupo_tipo_chk` con tres valores); relación `PromoCartaCupo.entradasDelDia`; permiso `promo_menu_del_dia`: fila en `Accion` y en `PermisoRol` (sembrada al `admin` de cada empresa por la misma migración, líneas 138-150) |
| Núcleo | `src/core/carta/menu-del-dia.ts` (`MENU_DEL_DIA_VISIBLE`, `lugarDelDiaApagado`, `DIAS_DE_ANTICIPACION_DEL_MENU`, `MENSAJE_MENU_DEL_DIA_APAGADO`), `cupos-de-promo.ts` (`TIPOS_DE_CUPO` con `DEL_DIA`), `ui-config.ts` (`PESTANAS_DE_PROMOCIONES` con la pestaña «Menú del día»), `src/core/features/carta/menu-del-dia.schema.ts` y `.guard.ts`, `combos.schema.ts`, `promos.guard.ts`, `promos.schema.ts`; `src/core/permisos/acciones.ts:269` (`promo_menu_del_dia`); `src/core/pos/promo-combo.ts` (cupo `DEL_DIA`, `MENU_DEL_DIA_SIN_CARGAR`), `armar-promo-estado.ts`, `selector-carta.ts` |
| Servidor | `src/server/actions/carta/menu-del-dia.ts`; casos de uso `agregar-plato-del-dia.ts`, `quitar-plato-del-dia.ts`, `copiar-menu-del-dia-anterior.ts`, `guardar-cupos-promo-carta.ts` (`lugarDelDiaApagado`), `componentes-de-combo-en-tx.ts`; `src/server/consultas/carta/menu-del-dia.ts` y `combos.ts`; `src/server/persistencia/carta/combos.ts`; `src/server/lecturas/carta/componentes-de-promo.ts`; `src/server/lecturas/pos/entradas-de-promo-para-vender.ts` (rama DEL_DIA y parámetro `dia`); `src/server/lecturas/pos/promo-para-agregar.ts` (parámetro `dia`); `src/server/actions/pos/casos-de-uso/agregar-items.ts` (`diaDeCalendario`, mapeo del código `MENU_DEL_DIA_SIN_CARGAR`) |
| Pantalla | Ruta `/movimientos/menu-del-dia` (`src/app/(app)/movimientos/menu-del-dia/page.tsx`, hoy `notFound()` por el interruptor); `parametrizacion/formularios.tsx` (opción «Plato del día» en «Sumar un lugar»); `promociones/page.tsx`; `promociones/lugares-del-formulario.ts`; POS: `src/app/(pos)/mesas/[mesaId]/armar-promo.tsx` |
| Auditoría | `src/core/permisos/auditoria.ts:97,100` (entidad `EntradaDelDiaDeCupo`): las filas históricas **se conservan** |
| Pruebas | `test/carta/menu-del-dia-go3.test.ts`, `menu-del-dia-interruptor.test.tsx`, `cupos-sin-borrar-go3.test.ts`, `cupos-tolerantes-go3.test.ts`, `sumar-lugar-interruptor.test.tsx`; `test/pos/agregar-combo-go3.test.ts`, `selector-combos-go3.test.ts`, `armar-promo-entradas-go3.test.ts`, `promo-combo-go3.test.ts`; `test/aislamiento/denegacion-por-defecto-carta.test.ts`, `denegacion/mundo.ts`; `test/arquitectura/semantica-sin-fila.test.ts:61`, `carta-solo-lectura.test.ts`, `pos-consume-la-carta-con-el-modulo.test.ts`, `escrituras-auditadas.test.ts`, `clases-de-claves.test.ts`, `caracterizaciones-congeladas.test.ts`; `test/permisos/piso-de-gobierno.test.ts`, `matriz-esperada.ts`; `test/navegacion/carta-en-el-menu.test.ts`; `test/setup/clasificacion-de-tablas.ts:22,129`, `migraciones-de-alcance-de-sucursal.ts:56`, `combos-go3b.ts`, `opciones.ts`, `test-db.ts`; e2e `movimientos-menu-del-dia.spec.ts`, `pos-menu-del-dia.spec.ts`, `carta-plato-del-dia-sin-rediseno.spec.ts`, `movil-carta.spec.ts`, `rutas-sin-parametros.ts`; `test/persistencia/migracion-go3d.test.ts`, `test/aislamiento/paquete-go3-subir-bajar-subir.test.ts` |

### 1.3 Campos sin lector

- `PromoCarta.creadoEn`: **0 lectores** (ninguna consulta de promo ordena ni muestra `creadoEn`: `admin.ts` ordena por `activa, orden, titulo`). Lo escribe solo el `DEFAULT now()`. **PROPUESTA: borrar.**
- `EntradaDeCupo.actualizadoEn`: **solo se escribe** (`persistencia/carta/combos.ts:27`, junto con `activa`), nadie lo lee. Está en el `UPDATE` por columna que la app tiene sobre `EntradaDeCupo` (comentario en `persistencia/carta/combos.ts:7`): **hay que sacarla también de ese permiso**. **PROPUESTA: borrar.**

### 1.4 Lo que NO se borra (se conserva por trazabilidad; el dueño lo corrige si quiere otra cosa)

`PromoCuenta.precio`, `PromoCuenta.creadoEn`, `PromoCuenta.creadoPorId` (el snapshot y el rastro de lo vendido: dinero, aunque ninguna pantalla los lea hoy); los `creadoEn` que sirven de desempate de orden (`EntradaDeCupo.creadoEn`, `OpcionDeEntradaDeCupo.creadoEn`: `consultas/carta/combos.ts:35`, `lecturas/pos/entradas-de-promo-para-vender.ts:67,74`); `PromoCartaCupo.orden`; `PromoCarta.version`, `activa`, `soloSalon`, `orden`; `EntradaDeCupo.modoDeOpciones` y todo el cupo `LISTA`.

### 1.5 Lo que parece de la vigencia o del menú y NO lo es

- **`PROMO_CAMBIO` se queda.** No es de la vigencia: lo devuelve `agregar-items.ts` cuando el `precioEsperado` que vio el mozo ya no es el de hoy (cambió el precio de la promo). Es una guarda de dinero.
- **`ENTRADA_NO_DISPONIBLE` se queda** (también la usa el cupo `LISTA` y las partes «el mozo elige»); se va solo **`MENU_DEL_DIA_SIN_CARGAR`**.
- `diaDeColumnaDate`, `fechaDeColumnaDate` y `diaDeCalendario` los usan otros módulos (compras, reportes, conteo): se quedan. `diaDeLaSemana` (`core/tiempo/zona-horaria.ts`) solo la usa la vigencia: queda sin consumidor y `npm run analizar:muerto` la va a marcar (se borra en el mismo cambio).
- El parámetro `dia` de `cargarPromoCartaParaAgregar` y `cargarEntradasDePromoParaVender` solo existe para la vigencia y el plato del día: se puede sacar. `empresaZonaHoraria` en el `actor` de `agregarItemsCasoDeUso` queda sin uso en este caso de uso (PROPUESTA: sacarlo solo si `tsc`/knip lo exigen; no refactorizar de más).

### 1.6 «Plato del día» como promo: qué cubre la poda

- **Cubierto por la poda:** el «plato del día» **como lugar de una promo** es el cupo de tipo `DEL_DIA` (con su tabla `EntradaDelDiaDeCupo` por fecha y sucursal, su permiso y su pantalla). Todo eso sale (§1.2). Es exactamente lo que la cita de segunda mano describe como «plato del día» y «menú del día».
- **NO es lo mismo y queda:** una promo cualquiera que el dueño decida llamar «Plato del día» (título libre) con cupos `SECCION` o `LISTA` sigue siendo una promo normal; la poda no mira títulos.
- **Promos ya creadas con un lugar `DEL_DIA`:** 0 en la base principal (medido por el orquestador, 2026-11-12); las demás bases **NO VERIFICADAS**. La consulta de §7 (punto 2) las cuenta antes de cada tiempo. **Si alguna base tuviera alguna, se frena y se le pregunta al dueño qué hacer con ella** (convertir ese lugar en uno `LISTA` con los mismos platos, o dar de baja la promo): no se decide en este diseño. Mientras tanto el comportamiento seguro ya existe: un cupo activo de tipo desconocido hace que su promo no se ofrezca (falla cerrado, nunca se vende mal).
- **«Solo queda la parte como promoción»:** consistente con lo que el sistema ya hace (una promo se arma de partes: lugares `SECCION` y `LISTA`); la poda no agrega ni cambia nada ahí. Si el dueño quiso decir algo más (unificar los dos tipos de parte), es la pregunta abierta de §8.

## 2. Escalera de diseño (niveles 1 a 10)

### Nivel 1. Propósito, necesidad y alcance
- **Propósito (CONFIRMADA, 2026-11-12):** sacar del sistema lo que el dueño ya descartó y hoy solo vive detrás de un interruptor apagado.
- **Necesidad escrita:** «Si» — 2026-11-12 — chat con el orquestador (ver arriba) y las decisiones del 2026-10-20/22 en `docs/pendientes-sesion-2026-10-22.md:76-84`.
- **Fuera de alcance:** cualquier cosa nueva (no se agrega nada); cupos `SECCION` y `LISTA`; el rediseño de la pantalla de partes (E2) y el POS con opciones (E1c).

### Nivel 2. Actores y contexto
| Actor | Qué le pasa |
|---|---|
| Dueño | Aprueba cada tiempo; avisa base por base antes del tiempo 2 |
| Administrador de la empresa | Pierde la acción `guardarVigenciaPromoCarta` (ya oculta) y el permiso `promo_menu_del_dia` (clase O, delegable a encargado: nadie lo usa, la pantalla da 404) |
| Mozo | Sin cambios visibles: ya no existen promos fuera de vigencia ni platos del día |
| Servidor | Deja de leer/escribir lo retirado |

### Nivel 3. Casos de uso
Se retiran: guardar vigencia de una promo; agregar/quitar/copiar plato del día; ofrecer «Plato del día» al sumar un lugar; filtrar promos por vigencia en el selector y al agregar. Quedan intactos: crear/editar promo, cupos de sección y lista, agregar la promo a la cuenta, quitar la promo, margen de promociones.

### Nivel 4. Conceptos y ciclo de vida
- Una promo **vale siempre que esté activa** (`PromoCarta.activa`, ya existe; «se maneja con ACTIVAR/DESACTIVAR», decisión del 2026-10-20). Ya es lo que pasa hoy, porque ninguna promo tiene vigencia: la poda no cambia comportamiento observable.
- Un cupo es `SECCION` o `LISTA`. Un cupo activo de un tipo desconocido sigue **fallando cerrado** (`promo-para-agregar.ts`: devuelve `null`), así que si una base tuviera un cupo `DEL_DIA` olvidado su promo dejaría de venderse en vez de venderse mal; por eso la auditoría previa (§7) es obligatoria también para el tiempo 1.

### Nivel 5. Invariantes y políticas (estados)
| # | Invariante | Estado |
|---|---|---|
| P1 | Antes de CADA tiempo, el conteo de filas retiradas es 0 en esa base; si no, se frena | PROPUESTA |
| P2 | El tiempo 1 no toca la base ni `schema.prisma` y se revierte con un `git revert` / Instant Rollback | PROPUESTA |
| P3 | El tiempo 2 aborta sin tocar nada si encuentra datos (como el `down.sql` de GO-3d) | PROPUESTA |
| P4 | Lo vendido (`PromoCuenta`, `CuentaItem`, fotos) y la auditoría histórica no se tocan | PROPUESTA |
| P5 | No se agrega ninguna función ni campo; solo se borra y se simplifica | CONFIRMADA (regla 2026-11-11) |
| P6 | Se conservan `PromoCuenta.*`, los `creadoEn` de desempate y `PromoCartaCupo.orden` | PROPUESTA (corrección del orquestador; el dueño la corrige) |

### Nivel 6. Historia y persistencia
- **Tiempo 2 (migración nueva, aditiva en estructura de migraciones, destructiva en datos):** guarda `DO $$` que cuenta filas y aborta (`RAISE EXCEPTION`) si hay alguna en `EntradaDelDiaDeCupo`, cupos `DEL_DIA`, o promos con alguna columna de vigencia no nula; si no, en una transacción con `lock_timeout`: borra las políticas y la tabla `EntradaDelDiaDeCupo`; `ALTER TABLE "PromoCartaCupo" DROP CONSTRAINT "PromoCartaCupo_tipo_chk"` y lo recrea con `('SECCION','LISTA')`; borra los CHECK y las tres columnas de vigencia de `PromoCarta`; borra `PromoCarta.creadoEn` y `EntradaDeCupo.actualizadoEn` (y la columna del `GRANT UPDATE` de la app); borra las filas `PermisoRol` (y de `CapacidadSucursal`, si hubiera) y la fila `Accion` de `promo_menu_del_dia`.
- **`PromoCartaCupo_nombre_chk` y el índice único parcial por nombre:** equivalentes con dos tipos («nombre obligatorio fuera de SECCION» = obligatorio en `LISTA`); **PROPUESTA: no tocarlos** (cambiarlos no aporta y suma riesgo); la simplificación es solo de los mensajes y del código TypeScript.
- **`down.sql` (obligatorio):** recrea, vacías, las columnas (nulables, con sus CHECK), la tabla `EntradaDelDiaDeCupo` con sus índices, claves foráneas, RLS y 4 políticas (copiadas de `20261021100000` y `20261021101000`), el CHECK de tres tipos, `PromoCarta.creadoEn DEFAULT now()`, `EntradaDeCupo.actualizadoEn`, el `GRANT` por columna y la clave `promo_menu_del_dia` (fila `Accion` y siembra `PermisoRol` al `admin`). **No recupera datos borrados**: por eso P1/P3 y el respaldo.
- **Antes de aplicar:** rama de respaldo de Neon + ensayo de `up` y `down` en esa rama (mismo procedimiento que `docs/pendientes-sesion-2026-10-22.md` exige para lo destructivo). Aplicación **base por base**, solo con aviso expreso del dueño.

### Nivel 7. Atomicidad y concurrencia
- Tiempo 2 en UNA transacción (`psql -1`, `ON_ERROR_STOP`); todo o nada. Toma `ACCESS EXCLUSIVE` breve sobre tablas chicas (1 promo en la base principal); `lock_timeout` corto para no bloquear a un mozo.
- Ventana de despliegue (expandir y contraer): el tiempo 1 ya está en producción antes del tiempo 2, y nada del código lo lee/escribe; por eso el tiempo 2 puede aplicarse con el sistema en marcha. Ensayar con una venta concurrente en la rama.

### Nivel 8. Acceso e interfaces
- Se elimina la ruta `/movimientos/menu-del-dia` (hoy 404), la pestaña «Menú del día», la opción «Plato del día» y el bloque «Vigencia».
- Permisos: `promo_menu_del_dia` sale de `ACCIONES` **en el tiempo 2** (no en el 1: `paridad-catalogo-migraciones` exige que el catálogo en código y la tabla `Accion` coincidan en las dos direcciones; sacarla del catálogo antes de borrar la fila haría caer ese guardián). En el tiempo 1 queda declarada «retirada: sin uso». **NO VERIFICADA** esta secuencia contra todos los guardianes de permisos (`clases-de-claves`, `piso-de-gobierno`, `matriz-esperada`, `caracterizaciones-congeladas`, `acciones-con-modulo`): se comprueba al implementar y, si alguno exige otra cosa, se ajusta el orden y se avisa.

### Nivel 9. Consultas y experiencia
- Sin cambios visibles para el mozo ni para el cliente de la carta pública (ninguna promo tiene vigencia ni plato del día en la base principal).
- El selector del POS deja de filtrar por vigencia y deja de recibir `dia`.
- Los reportes (`margen-promociones`) no leen nada retirado (verificado).

### Nivel 10. Pruebas, migración y operación
Dimensiones cuyas combinaciones cambian dinero, visibilidad o stock, y qué pasa con ellas:

| Dimensión (hoy) | Después de la poda | Dónde se declara |
|---|---|---|
| Vigencia de la promo (desde/hasta/días) × día de venta | Desaparece: una promo activa vale siempre | `visibilidad-de-promos-matriz.test.ts` (oráculo) pierde esa dimensión; se actualiza su tabla escrita aparte |
| Tipo de cupo (`SECCION`, `LISTA`, `DEL_DIA`) | `SECCION`, `LISTA` | `TIPOS_DE_CUPO`, `TIPOS_DE_PARTE_DECLARADOS` de `test/pos/promo-parte-de-seccion.oraculo.ts`, parity con el CHECK |
| Plato del día × fecha × sucursal | Desaparece | `semantica-sin-fila.test.ts`, `carta-solo-lectura.test.ts` |

- **Gate de 8 comandos** completo en cada PR (`tsc`, `lint`, `arquitectura`, `analizar:muerto`, `npm test`, `build`, `plataforma:build`, `test:e2e`).
- Mutaciones a demostrar en cada PR (rojo → revertido → verde): reintroducir el filtro por vigencia en el selector; dejar que un cupo de tipo desconocido se venda (debe seguir fallando cerrado).

## 3. Orden en dos tiempos

**Tiempo 1 — el código deja de leer y escribir (sin tocar la base ni `schema.prisma`; reversible con revert).** Tres PR chicos, en este orden:
1. **Vigencia:** sacar `vigencia-de-promo.ts` y sus exports, `guardarVigenciaPromoCarta` (acción y caso de uso), el bloque de pantalla, el filtro en `promo-para-agregar.ts` y `selector-carta.ts`, `diaDeLaSemana`, y los tests/oráculos; enmendar ADR-032 D-7. Las columnas siguen en la base y en `schema.prisma`; en `columnas-de-significado.ts` pasan de «dinero» a «ninguna» con motivo «retirada, sin lector, se borra en el tiempo 2».
2. **Menú del día:** sacar las acciones, casos de uso, consultas, ruta, pestaña, opción «Plato del día», la rama `DEL_DIA` de las lecturas y de `promo-combo.ts`, `MENU_DEL_DIA_SIN_CARGAR` y el parámetro `dia`. `TIPOS_DE_CUPO`, el CHECK, la tabla y el permiso **se quedan** hasta el tiempo 2 (así el guardián de paridad con el CHECK no cae). Un cupo `DEL_DIA` que apareciera se trata como tipo desconocido (falla cerrado).
3. **Campos sin lector:** dejar de escribir `EntradaDeCupo.actualizadoEn` (y de nombrar `PromoCarta.creadoEn`); siguen en la base.

**Tiempo 2 — migración destructiva (una por vez, con aviso expreso del dueño y base por base):** la migración de §2 nivel 6 + `down.sql` + actualización de `schema.prisma`, `TIPOS_DE_CUPO` (a `['SECCION','LISTA']`), `ACCIONES`, los guardianes de columnas, `clasificacion-de-tablas.ts`, `migraciones-de-alcance-de-sucursal.ts` y `test/persistencia/migracion-go3d.test.ts` / `test/aislamiento/paquete-go3-subir-bajar-subir.test.ts` (que miden la estructura viva: pasan a medir el estado posterior). Todo en el mismo PR para que cada guardián cambie junto con lo que mide.

## 4. ¿Qué pasa si…?

**Comando A: desplegar el tiempo 1.**
| Situación | Resultado |
|---|---|
| Repetición | Es un despliegue de código; repetirlo no cambia nada |
| Concurrencia | Una venta en curso con la versión vieja termina igual (nada de lo retirado afecta una venta sin vigencia); la nueva no lo lee |
| Tiempo | Efecto inmediato; la base no cambia |
| Incertidumbre (una base con datos olvidados) | Un cupo `DEL_DIA` olvidado hace que su promo no se ofrezca (falla cerrado); una vigencia olvidada se ignora y la promo vale siempre → **por eso la consulta de §7 va antes** |
| Reintento / error parcial | Se revierte con `git revert` / Instant Rollback; la base no se tocó |
| Datos faltantes | — |
| Cambio de permisos | `promo_menu_del_dia` sigue en el catálogo, sin uso |

**Comando B: aplicar el tiempo 2 en una base.**
| Situación | Resultado |
|---|---|
| Repetición | Idempotente con `IF EXISTS`; el segundo intento no hace nada |
| Concurrencia | `lock_timeout` corto; si no obtiene el bloqueo, falla sin cambiar nada |
| Incertidumbre | La guarda cuenta filas y aborta si hay datos |
| Error parcial | Una sola transacción: todo o nada |
| Reintento tras corte | Se repite; con la guarda, sin riesgo |
| Datos faltantes | — |
| Revertir | `down.sql` recrea estructuras **vacías**; los datos borrados no vuelven (por eso respaldo y P1) |
| Cambio de permisos | Se borran las filas del permiso retirado (`PermisoRol`, `CapacidadSucursal` si hubiera, `Accion`); no hay otra clave que dependa de ellas |

## 5. Guardianes y oráculos

| Guardián / oráculo | Qué pasa | Cómo no cae ni queda sin declarar |
|---|---|---|
| `columnas-de-significado.ts` (cerco de columnas) | Tiempo 1: las 3 columnas de vigencia y `EntradaDelDiaDeCupo.*` siguen en la base | Se re-declaran «ninguna» con motivo; en el tiempo 2 se borran sus entradas junto con las columnas |
| `columnas-del-esquema.ts` | `creadoEn`/`actualizadoEn` están exentas (`FECHAS_DE_AUDITORIA_TECNICA`) | Sin cambios |
| Paridad `TIPOS_DE_CUPO` ↔ CHECK (`migracion-go3d.test.ts`) | Cambia en el tiempo 2 | Constante y CHECK cambian en el mismo PR |
| Paridad `ACCIONES` ↔ tabla `Accion` | Cambia en el tiempo 2 | Idem |
| `visibilidad-de-promos-matriz.test.ts` | Pierde la dimensión «vigencia» | Se reescribe su tabla esperada |
| `test/pos/promo-parte-de-seccion.oraculo.ts` (E1a) | Declara `DEL_DIA: «sin efecto: fuera de alcance»` | Al salir `DEL_DIA` de `TIPOS_DE_CUPO` el guardián cae a propósito y se actualiza el mapa en el mismo PR |
| `semantica-sin-fila.test.ts`, `carta-solo-lectura.test.ts`, `escrituras-auditadas.test.ts`, `clasificacion-de-tablas`, `migraciones-de-alcance-de-sucursal` | Mencionan `EntradaDelDiaDeCupo` | Se limpian en el tiempo 2 |
| `tope-de-lineas` (cerco) | `promo-combo.ts` (485 líneas) y `agregar-items.ts` **bajan** al quitar `DEL_DIA`/`dia` | Solo mejora; no se sube ninguna línea de base |
| `knip` (`analizar:muerto`) | Quedan sin consumidor los exports de vigencia/menú | Se borran en el mismo cambio (0 hallazgos) |

## 6. Riesgo de conflicto con otros trabajos

- **E1c (pantalla del POS) y E2b (pantalla de partes):** tocan `armar-promo.tsx`, `armar-promo-estado.ts`, `selector-carta.ts`, `formularios.tsx`, `promociones/page.tsx` y `guardar-cupos-promo-carta.ts`, que la poda también toca (ramas `DEL_DIA`, bloque «Vigencia», opción «Plato del día»). **PROPUESTA:** hacer el tiempo 1 **antes** de E1c/E2: quita código muerto de las pantallas que esas etapas iban a reescribir y evita conflictos de tres vías.
- **#249 (auditoría) toca `promo-combo.ts`:** la poda también (rama `DEL_DIA`, `MENU_DEL_DIA_SIN_CARGAR`, `CodigoDeEleccionDePromo`). **PROPUESTA:** que #249 mergee primero y el PR 2 del tiempo 1 se base en `main` actualizado. **NO VERIFICADO** el contenido de #249 desde esta sesión.
- E1a/E1b ya están en `main` (#230, #237); `promo-combo.ts` ya tiene los campos nuevos de «Toda la sección»; la poda no los toca.

### 6.1 Orden de PR y archivos que toca cada uno (para detectar conflictos)

Orden fijado por el dueño (vía el orquestador, 2026-11-12): **1)** la cadena de la auditoría entra primero en `main` (incluye #249); **2)** recién después la poda T1 (solo con el OK del dueño a este diseño y el aviso «#249 en main»); **3)** E1c (pantalla del mozo) y E2 (armado «solo estos platos» en el admin).

Lo que **sí** se leyó de los PR abiertos (archivos de `get_files`, 2026-11-12): #249, #254, #250, #251, #238, #239. De los demás (#240 a #248, #252, #253, #255) **NO VERIFICADO** qué archivos tocan; antes de cada PR de la poda se repite el cruce contra los que sigan abiertos.

| Orden | PR | Qué toca (lo que importa para la poda) |
|---|---|---|
| 1a | #250 «CHECK en la base (paso 10)» | Migración `20261112160000_checks_de_datos_basicos`; `test/aislamiento/m1-mostrador-subir-bajar-subir.test.ts` (lista de migraciones posteriores) |
| 1b | #251 «Nombre único sin mayúsculas (paso 11)» | Migración `20261112170000_nombre_unico_sin_mayusculas`; `guardar-seccion-carta.ts`, casos de uso de clientes; el mismo `m1-mostrador-subir-bajar-subir.test.ts` |
| 1c | #238 / #239 (pasos 1 y 2) | `src/components/carta/contenido-del-producto.tsx`; `src/core/carta/validaciones.ts`; `src/core/features/carta/{contenido-producto,items-agrupados,promos,secciones}.guard.ts` |
| 1d | #249 (paso 5) y #254 (PR 3, «todo nace cerrado») | **#249 y #254 tocan la misma línea de `src/core/pos/promo-combo.ts`** (`claveDeConfiguracion`, con regex distintas: se pisan entre ellas, no con la poda); #254 además toca `AGENTS.md`, `src/core/carta/*` (armar-menu, tema, css-valores, url-https…), `src/core/correo/*`, `src/core/texto.ts`, `src/env.ts` y las líneas de base `test/arquitectura/cercos/linea-de-base/{lista-de-prohibidos,tope-de-lineas}.json` y `cercos/vencimientos.ts` |
| 2a | Poda T1 / PR 1 (vigencia) | Borra `core/carta/vigencia-de-promo.ts`, `guardar-vigencia-promo-carta.ts` y sus tests; edita `core/carta/public.ts`, `admin-tipos.ts`, `features/carta/combos.guard.ts`, `core/tiempo/zona-horaria.ts`, `server/actions/carta/combos.ts`, `server/consultas/carta/combos.ts`, `server/persistencia/carta/combos.ts`, `lecturas/pos/promo-para-agregar.ts`, `lecturas/pos/selector-carta.ts`, `carta/parametrizacion/formularios.tsx` y `promociones/page.tsx`, `permisos/auditoria.ts` (solo comentario), `guardas/columnas-de-significado.ts`, `visibilidad-de-promos-matriz.test.ts`, ADR-032 |
| 2b | Poda T1 / PR 2 (menú del día) | Lo de §1.2 más `core/pos/promo-combo.ts`, `agregar-items.ts`, `entradas-de-promo-para-vender.ts`, `armar-promo.tsx`, `armar-promo-estado.ts`, `selector-carta.ts` (core), `cuenta-pedido.schema.ts`, `features/carta/promos.guard.ts`, `ui-config.ts`, tests y e2e del menú; **baja** `promo-combo.ts` y `agregar-items.ts`, así que regenera `tope-de-lineas.json` |
| 2c | Poda T1 / PR 3 (campos) | `persistencia/carta/combos.ts` |
| 2d (más adelante) | Poda T2 (migración) | Migración nueva (fecha posterior a `20261112170000`), `down.sql`, `prisma/schema.prisma`, `core/carta/cupos-de-promo.ts` (`TIPOS_DE_CUPO`), `core/permisos/acciones.ts`, guardianes y tests de migración (§5) |
| 3 | E1c y E2 | Pantalla del POS (`armar-promo*.tsx`, `selector-carta`) y admin (`formularios.tsx`, `promociones/page.tsx`, `guardar-cupos-promo-carta.ts`): **los mismos archivos que 2a y 2b** |

Conflictos detectados y cómo se evitan:
1. **`promo-combo.ts`:** la poda (2b) borra las ramas `DEL_DIA`/`MENU_DEL_DIA_SIN_CARGAR` (partes distintas del archivo a la línea 160 que cambian #249/#254). Se espera textualmente limpio; igual, 2b se hace con `main` ya actualizado con #249 y #254, nunca antes.
2. **`tope-de-lineas.json` y `vencimientos.ts`:** #254 los edita y 2b baja el tope. La línea de base **no se edita a mano**: se regenera con `BAJAR_CERCOS=1` después de rebasar sobre `main`.
3. **`features/carta/promos.guard.ts`:** lo edita #239 (descripción multilínea) y 2b (tipo `DEL_DIA`); hunks distintos, se rebasa después de #239.
4. **Migraciones:** #250 y #251 agregan migraciones y las anotan en la lista de `m1-mostrador-subir-bajar-subir.test.ts`; la de T2 va **después** de ellas (fecha mayor) y se agrega a esa misma lista. Es el punto de conflicto más probable entre todos los PR con migración.
5. **E1c/E2:** tocan los mismos archivos de pantalla que 2a y 2b; por eso el orden recomendado es 2a/2b antes de E1c/E2 (§8).

## 7. Auditoría previa por base (obligatoria antes de cada tiempo)

Solo lectura; correr como dueño en **cada** base (principal, `zuluhub-demo` y toda otra con datos). Pegar el resultado en el PR del tiempo; si alguna cifra no es 0, **se frena y se pregunta al dueño**.

```sql
-- 1. Vigencia en uso
SELECT count(*) FILTER (WHERE "vigenteDesde" IS NOT NULL OR "vigenteHasta" IS NOT NULL OR "diasDeSemana" IS NOT NULL) AS promos_con_vigencia,
       count(*) AS promos_total
FROM "PromoCarta";
-- 2. Menú del día en uso
SELECT (SELECT count(*) FROM "EntradaDelDiaDeCupo") AS platos_del_dia,
       (SELECT count(*) FROM "PromoCartaCupo" WHERE "tipo" = 'DEL_DIA') AS cupos_del_dia;
-- 3. Permiso: quién lo tiene (informativo; se borra en el tiempo 2)
SELECT count(*) AS filas_permiso FROM "PermisoRol" WHERE "accionClave" = 'promo_menu_del_dia';
-- 4. Lo que se CONSERVA: cuánto hay vendido
SELECT count(*) AS promos_vendidas FROM "PromoCuenta";
```

Medido por el orquestador el 2026-11-12 (solo lectura) en la base principal (proyecto Neon `morning-field-10188884`): 1 promo, 0 con vigencia o días, 0 cupos `DEL_DIA`, 0 platos del día, 0 promos vendidas, 3 cupos, 0 entradas. Las otras bases: **NO VERIFICADO**.

## 8. Preguntas abiertas y hallazgos

- **Pregunta clave (una):** el tiempo 1, ¿lo hacemos antes de E1c/E2 (recomendado: menos conflictos y menos código en las pantallas que se van a reescribir) o después de ellas?
- **Abierta (sin supuesto; no se hace nada hasta que el dueño conteste):** «Solo queda la parte como promoción» ¿implica también **unificar `SECCION` y `LISTA` en un solo concepto de parte**? Hoy el diseño aprobado de E0 (#227, «Toda la sección | Solo estos platos») ya los presenta como UNA sola elección en la pantalla, pero en la base siguen siendo dos tipos de cupo (`SECCION` y `LISTA`, alternativa A de #227: sin migración). Unificarlos en el modelo sería un cambio de datos aparte (columna/CHECK, migración con aviso expreso) y **no forma parte de esta poda**. La poda deja `TIPOS_DE_CUPO = ['SECCION','LISTA']` tal cual.
- **Abierta:** la cita del dueño sobre el plato del día llegó de segunda mano; hasta que la confirme directo se trata como PROPUESTA (el pedido CONFIRMADO de la poda sigue siendo el «Si» del 2026-11-12 a la lista enumerada por el orquestador).
- Abierta (sin supuesto): `docs/` de `motor2-docs` (`_planes/`, ADR) **no se revisó** (no está en el alcance de esta sesión); puede haber un plan aprobado que dependa de la vigencia o del menú del día.
- Abierta: ¿conviene conservar las filas históricas de `RegistroAuditoria` con la entidad `EntradaDelDiaDeCupo` y los campos de vigencia? **PROPUESTA: sí, no se tocan** (la auditoría solo se agrega); las etiquetas de `auditoria.ts` se mantienen para poder mostrarlas.
- Hallazgo (sin tocar): `PROMO_CAMBIO` no es de la vigencia (ver §1.5); borrarlo por error quitaría la guarda de precio.
- Hallazgo: los tests `migracion-go3d` y `paquete-go3-subir-bajar-subir` miden la estructura viva de la base y se leen contra el archivo `migration.sql` histórico; no se puede editar la migración vieja (ya aplicada), así que en el tiempo 2 pasan a medir el estado posterior.
- Sin decisiones nuevas para el registro (`docs/registro-de-decisiones.md`): ninguna DEC nueva; siguen abiertas las 5 de antes.
