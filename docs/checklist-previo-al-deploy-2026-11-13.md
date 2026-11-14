# Checklist previo al deploy: las dos migraciones de la auditoría y las claves de correo — 2026-11-13

Estado: **documento de operación, sin código ni migraciones nuevas.** Nada de lo que está acá se ejecutó. **Producción congelada** (orden del dueño, 2026-11-12, vía el orquestador): ni deploy, ni migración aplicada, ni escritura en ninguna base de producción ni en las variables de Vercel. Las migraciones ya están en `main` (#250 y #251, integradas el 2026-11-13) pero **no se aplicaron en ninguna base**.

Cuándo se despliega (el dueño, 2026-11-12, chat del dueño con el orquestador): «Cuando todos los cambios estén en main, es que vamos a desplegar. Sin cambios, prefiero mantener la versión vieja que quedó estable. Y ya cuando estén todas las decisiones que podamos ejecutar todo el trabajo en conjunto y decir, ok, las pantallas quedaron bien, es mobile first, es igual a pedernal. Ahí recién desplegamos.» Este checklist **no** dispara ningún deploy: es el plan para cuando el dueño lo decida.

Autorización: el dueño autorizó **integrar** las migraciones («Sí, autoricé las migraciones; que la sesión integre en orden», 2026-11-12, vía el orquestador) y confirmó el merge de #250 y #251 sin aplicarlos («Si te di permiso», 2026-11-13, chat del dueño con el orquestador). **La autorización expresa para APLICARLAS en una base real no existe todavía** (PENDIENTE): hace falta una por base, dicha por el dueño. Este checklist es el plan para pedirla y ejecutarla; no la reemplaza.

Este documento complementa a `docs/deploy-con-migraciones.md` (el flujo general: `con-env.mjs`, `npm run migrar:aprobar`, el build que verifica y no migra, Instant Rollback). Acá solo va lo propio de estas dos migraciones.

Marcas: **(V)** verificado en el código de `main` al 2026-11-13; **NO VERIFICADO** no se pudo comprobar desde acá.

---

## 0. Qué se despliega

| Orden | Migración | Qué hace | Si hay una fila que no cumple |
|---|---|---|---|
| 1 | `20261112160000_checks_de_datos_basicos` (#250) | 3 CHECK: `Empresa.moneda` = 3 letras mayúsculas; `CotizacionDolar.fuente` ∈ {BNA, BCRA}; `Cliente.descuentoPorcentaje` ≥ 0 y < 100. Cada uno se agrega `NOT VALID` y se valida en el acto, todo en una transacción | **Aborta entera, sin dejar nada a medias** (V: `migration.sql`) |
| 2 | `20261112170000_nombre_unico_sin_mayusculas` (#251) | 2 índices únicos: `Cliente` y `SeccionCarta` por `(empresaId, lower(nombre))` | `CREATE UNIQUE INDEX` falla y **no queda nada** (V) |

Las dos son **aditivas**: el código anterior sigue funcionando con ellas aplicadas (solo se rechaza lo que la app ya rechazaba). El código de #251 también tolera que el índice **no** exista (se comporta como antes, sin la protección de la carrera) (V: cuerpo del PR #251, 59 de 62 pruebas con el índice ausente). Por eso el Instant Rollback de Vercel es seguro en cualquiera de los dos sentidos.

**Orden obligatorio: migraciones primero, deploy después.** El build de Producción corre `prisma migrate status` y **falla a propósito** si hay migraciones pendientes (`docs/deploy-con-migraciones.md`, «Qué hace `npm run build`»). Desde que #250 y #251 están en `main`, **cualquier deploy de producción desde `main` falla hasta que las dos estén aplicadas en esa base**. No es un error: es la garantía de que no queda código nuevo sobre una base vieja. Para un Preview no aplica (no migra ni verifica).

---

## 1. Antes: lecturas de auditoría (solo lectura, solo sobre la COPIA del ensayo)

Regla de este proyecto: nada se escribe en producción para ensayar y las lecturas sobre una base real las autoriza el dueño. Las consultas se corren **sobre la rama de ensayo de Neon (copia de la base)**, no sobre la real. Todas tienen que dar **0 filas**:

```sql
-- #250: filas que violarían los CHECK
SELECT id, moneda FROM "Empresa" WHERE moneda !~ '^[A-Z]{3}$';
SELECT id, fuente FROM "CotizacionDolar" WHERE fuente NOT IN ('BNA', 'BCRA');
SELECT id, "empresaId", nombre, "descuentoPorcentaje" FROM "Cliente"
 WHERE NOT ("descuentoPorcentaje" >= 0 AND "descuentoPorcentaje" < 100);

-- #251: nombres repetidos sin distinguir mayúsculas dentro de la misma empresa
SELECT "empresaId", lower(nombre) AS nombre_sin_mayusculas, count(*) FROM "Cliente"
 GROUP BY 1, 2 HAVING count(*) > 1;
SELECT "empresaId", lower(nombre) AS nombre_sin_mayusculas, count(*) FROM "SeccionCarta"
 GROUP BY 1, 2 HAVING count(*) > 1;
```

- Si alguna devuelve filas, **parar y avisar**: no se aplica nada hasta decidir qué hacer con esos datos (corregirlos o cambiar la regla, decisión del dueño).
- Verificado en solo lectura el 2026-11-12 contra las dos bases de producción que existían entonces (zuluhub y empresab): 0 filas en las 5 consultas (V: cuerpo de #250 y #251). **Hay que repetirlo el día del deploy**: son datos vivos. Qué bases de producción existen ese día: NO VERIFICADO (el documento `deploy-con-migraciones.md` del 2026-10-11 habla de una sola instalación; los PR de esta auditoría consultaron dos).
- Los estados de la base: `node scripts/operaciones/con-env.mjs <archivo-env> -- npx prisma migrate status` tiene que mostrar como pendientes **exactamente estas dos** y ninguna más. Si aparece otra, parar y avisar.

## 2. Antes: las claves de correo (DEC-0011) — sin pegar la clave en ningún chat

La aplicación **no arranca** si `CORREO_AVISOS_RESEND_API_KEY` o `CORREO_OPERATIVO_RESEND_API_KEY` no cumplen `re_` + letras, números o `_` (V: `src/env.ts`, `claveDeResend`; cambió en #249, paso 5; decisión **DEC-0011 ACEPTADA** por el dueño el 2026-11-13: «Aceptar y verificar la clave antes de desplegar (Recomendada)», chat del dueño con el orquestador; está en `docs/registro-de-decisiones.md`). **Verificar el formato de la clave de Resend ANTES de desplegar es obligatorio**. Antes, bastaba con que empezara con `re_` y no tuviera espacios.

El dueño verifica **sin mostrar el valor**, con la clave cargada en una variable de su terminal:

```bash
printf %s "$CORREO_AVISOS_RESEND_API_KEY"   | grep -Eq '^re_[A-Za-z0-9_]+$' && echo "avisos: OK" || echo "avisos: NO CUMPLE"
printf %s "$CORREO_OPERATIVO_RESEND_API_KEY" | grep -Eq '^re_[A-Za-z0-9_]+$' && echo "operativo: OK" || echo "operativo: NO CUMPLE"
```

- Si alguna dice «NO CUMPLE», **no desplegar**: se genera otra clave en Resend (o se decide aflojar la regla; es una línea, DEC-0011). Una variable sensible de Vercel no se puede leer; se compara contra la copia local o la caja de claves del dueño.
- DEC-0012 (ACEPTADA el 2026-11-13: «Aceptar (Recomendada)»; los espacios Unicode raros no entran en el asunto de un correo) **no pide nada antes del deploy**: solo afecta asuntos con esos caracteres, que el código del sistema no arma.

## 3. Ensayo general (rama de Neon, copia de la base)

Lo hace el dueño; el asistente de desarrollo no ve credenciales ni corre nada contra Neon (`deploy-con-migraciones.md`).

Sobre el ensayo general y la base de producción (el dueño, 2026-11-12, chat del dueño con el orquestador): «Bueno, sí, el ensayo general puede ser. Siempre y cuando no afectemos la base de producción de Stockage Neuquén. Porque mañana, mañana se presenta la carta como existe hoy, digamos.» **Condición innegociable:** el ensayo corre solo en una rama de Neon **copia** (nunca en la base de producción de empresab, ni con el Preview, que comparte esa base) y no se escribe nada en producción ni en sus variables de Vercel. Si algún paso del ensayo exigiera tocar esa base, se frena y se le pregunta al dueño.

1. Rama de **respaldo** de Neon de la base destino (es el rollback del DEPLOY: código viejo + base vieja).
2. Rama de **ensayo** (otra copia). En ella: las consultas de la sección 1, y después `node scripts/operaciones/con-env.mjs <env de ensayo> -- npx prisma migrate deploy`.
3. Verificar en la rama, como dueño:
   ```sql
   SELECT conname, convalidated FROM pg_constraint
    WHERE conname IN ('Empresa_moneda_chk', 'CotizacionDolar_fuente_chk', 'Cliente_descuentoPorcentaje_chk');   -- 3 filas, convalidated = true
   SELECT indexname FROM pg_indexes
    WHERE indexname IN ('Cliente_empresaId_nombre_lower_key', 'SeccionCarta_empresaId_nombre_lower_key');       -- 2 filas
   ```
4. Probar en la rama que lo inválido se rechaza y lo válido pasa (ver «Prueba del dueño», sección 6) y **volver atrás y subir otra vez** (sección 5) para comprobar que `down.sql` y la migración son repetibles.
5. Recorrido real de la app contra la rama de ensayo (no el Preview de `empresab`: **comparte la base de producción**, ADR-007): login, alta de un cliente, alta de una sección de carta, carta pública.
6. Borrar la rama de ensayo.

## 4. Aplicar (solo con la autorización expresa del dueño, base por base)

1. Confirmar con el dueño: «¿Aplico `20261112160000` y `20261112170000` en la base X?» — la respuesta es la autorización (PENDIENTE hoy).
2. Respaldo (rama de Neon) hecho y la sección 1 en 0 filas **sobre la base real, en lectura**, el mismo día.
3. `node scripts/operaciones/con-env.mjs .env.vercel.<despliegue> -- npm run migrar:aprobar` (aplica en orden: primero la 160000, después la 170000).
4. `... -- npx prisma migrate status` al día; repetir las dos verificaciones SQL de la sección 3, paso 3.
5. **Recién ahí** el deploy (build en modo `verificar`: pasa si no hay pendientes).
6. Vigilar Sentry 48 horas: errores `23514` (violación de CHECK) y `23505` (único) que lleguen **sin** el mensaje amable de «nombre repetido» (señal de un camino que no pasa por los casos de uso).

## 5. Vuelta atrás

- **Código:** Instant Rollback de Vercel. Es seguro con las dos migraciones aplicadas o no (aditivas).
- **Base** (solo si hace falta; a mano, como dueño; ambos `down.sql` son idempotentes y no tocan datos):
  ```bash
  psql <conexión del dueño> -1 -v ON_ERROR_STOP=1 -f prisma/migrations/20261112170000_nombre_unico_sin_mayusculas/down.sql
  npx prisma migrate resolve --rolled-back 20261112170000_nombre_unico_sin_mayusculas
  psql <conexión del dueño> -1 -v ON_ERROR_STOP=1 -f prisma/migrations/20261112160000_checks_de_datos_basicos/down.sql
  npx prisma migrate resolve --rolled-back 20261112160000_checks_de_datos_basicos
  ```
  Se baja en **orden inverso** (primero la 170000). Con los `down.sql` aplicados, lo inválido vuelve a poder entrar en la base (la app lo seguiría rechazando).
- Probado «aplicar → volver atrás → volver a aplicar» sobre una base descartable con toda la cadena (V: `test/aislamiento/checks-de-datos-basicos-subir-bajar-subir.test.ts`, `test/aislamiento/nombre-unico-sin-mayusculas-subir-bajar-subir.test.ts` y `m1-mostrador-subir-bajar-subir.test.ts`, que lista las dos en orden).

## 6. Prueba del dueño, sin leer código (en la rama de ensayo o después del deploy)

1. En **Clientes**, dos pestañas: «Pepe Prueba» en una y «pepe prueba» en la otra, guardar las dos casi a la vez. Resultado: **un solo cliente**, y la otra pestaña muestra «Ya existe un cliente llamado…».
2. Mismo ejercicio con el nombre de una **sección de carta**: «Ya existe la sección de carta…».
3. Desde una consola SQL (solo en la rama de ensayo): `UPDATE "Cliente" SET "descuentoPorcentaje" = 100 WHERE …` debe fallar con «violates check constraint "Cliente_descuentoPorcentaje_chk"»; con 99.99 debe pasar.
4. En la app no cambia nada más: ninguna pantalla nueva. Si se saca captura, a 375 px y con los datos reales de la empresa (regla del 2026-11-05).

## 7. Lo que NO se sabe (NO VERIFICADO)

1. **Comportamiento de `lower()` con letras no ASCII** («Ñandú» contra «ñANDÚ»): depende de la collation de la base de producción de Neon; las pruebas locales usan `C.UTF-8`. En el peor caso el índice es más permisivo que la regla de la app, nunca al revés (V: cuerpo de #251).
2. **Qué bases de producción existen el día del deploy** y su usuario de `DATABASE_URL` (secreto en Vercel): sin confirmar desde acá.
3. **Si alguna clave de Resend de producción cumple la forma nueva** (sección 2): el asistente no ve las variables.
4. **Cuánto tarda** la validación de los CHECK y la creación de los índices sobre los datos reales: no se midió (hoy son pocas filas; en la medición del 2026-10-12 la base tenía N empresa y N productos).

## 8. Lo que ya está en `main` y viaja en el mismo deploy (código, sin migración)

Verificado el 2026-11-13 sobre `main` en `a172974a`: desde #251 **no entró ninguna migración nueva** (`prisma/` sin cambios) y `src/env.ts` solo cambió en #249 (la clave de Resend). Lo que sí viaja:

- **#254 «Todo nace cerrado (PR 3)»**: las 11 validaciones que quedaban por lista de prohibidos pasan a declarar lo permitido. Es código; un dato guardado que ya no cumpla se rechaza **recién al volver a guardarlo**. Qué cambia exactamente: cuerpo del PR #254 (no lo revisé para este documento: NO VERIFICADO).
- **#257 «Duplicar producto» (E4)**: copiar ficha, receta y opciones a un producto nuevo. Trae tres decisiones **ACEPTADAS por el dueño el 2026-11-13** (DEC-0007 «Aceptar como está (Recomendada)», DEC-0008 «Aceptar: nace en $0 (Recomendada)», DEC-0009 «Central (Recomendada)»; chat del dueño con el orquestador) en `docs/registro-de-decisiones.md`: **DEC-0007** (el duplicado nace disponible en todas las sucursales si quien duplica tiene `producto_campos_sensibles`, y apagado en todas si no), **DEC-0008** (un original que se vende por opción se duplica con precio guardado en $0 y exige esa clave) y **DEC-0009** (el selector «Sacar la receta de» arranca en «Central»). Costo de revertir cada una: bajo o muy bajo, sin migración.
  - **Prueba del dueño** (con datos reales, a 375 px si se captura): duplicar «Bife a criolla» como «Bife con chimichurri». Resultado esperado: aparece un producto nuevo con la ficha, la receta y las opciones del original, **con la disponibilidad que dice DEC-0007** (disponible en todas las sucursales si el usuario tiene `producto_campos_sensibles`; apagado en todas si no) y sin tocar el original. Duplicar dos veces seguidas con el mismo nombre debe dar «ya existe» y no dos productos.

## 9. Pendientes que no son de este checklist

- **Ninguna decisión de los agentes queda pendiente de OK en el registro** (todas aceptadas el 2026-11-13, DEC-0001 a DEC-0009, DEC-0011 y DEC-0012; DEC-0010 no existe). Lo único obligatorio del lado del dueño antes de desplegar es la verificación de la clave de Resend (sección 2).
- #255 (alícuota de IVA, **sin migración**; espera la respuesta del dueño a la pregunta de permisos A/B/C), #252 (ficha de parte, solo diseño, **sin autorización de migrar**; espera su respuesta a «¿un cliente por ficha?» y a las reglas de §6.2) y #256 (menú del día) no entran en este despliegue.

## 10. Después del deploy: cargar el nombre público de la empresa (solo cuando el código del nombre público esté en `main`)

Hoy el nombre que la carta pública muestra en los títulos es un texto fijo en el código. Cuando entre el diseño `docs/diseno-nombre-publico-de-la-empresa-en-la-carta-2026-11-14.md` (el nombre pasa a ser un dato de cada empresa) el despliegue deja los títulos **neutros** hasta que se carga el dato. Decisión del dueño, 2026-11-14 (chat con el orquestador): **«Lo carga el administrador al desplegar (Recomendada)»**, sin migración.

- [ ] **Inmediatamente después del despliegue, cargar el nombre público en `/carta/portal`** («Nombre público de la empresa», zona «Encabezado y títulos») con **el texto exacto que la carta muestra hoy** (se lee del título actual de la carta pública, no de memoria) y guardar.
- [ ] **Verificar que la carta lo muestra**: abrir el portal y la carta de una sucursal (ventana privada, a los 60 s de guardar como máximo) y confirmar que el título de la pestaña, la descripción compartida y el nombre del sitio dicen exactamente lo mismo que antes del despliegue.
- [ ] Si algo no coincide: corregir el texto en `/carta/portal` y guardar de nuevo; nada se rompe mientras tanto (el título neutro es el estado seguro).

