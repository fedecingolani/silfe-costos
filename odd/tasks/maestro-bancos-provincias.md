# Maestro de bancos y provincias

> Estado: **en curso** (14/11/2026).
> Rama: `feat/maestro-bancos-provincias` (sale de `main` en 49947c9).
> Copia en Engram: `odd/maestro-bancos-provincias/tasks`.

## Objetivo

Elegir bancos y provincias de una lista en lugar de escribirlos a mano, para que no haya
variantes del mismo dato ("Banco Nación", "BNA", "Nacion").

## Problema y por qué

Hoy la provincia del cliente y de sus sucursales, el banco de las cuentas de fondos y el banco
de los cheques de terceros son texto libre. Cada variante es un dato distinto: los listados,
las búsquedas y los PDF quedan inconsistentes.

## Alcance

**Entra:**
- Provincias: lista fija compartida (las 24 jurisdicciones) y desplegable en el formulario del
  cliente y de la sucursal. Normalización de los valores ya cargados que coinciden sin
  importar mayúsculas ni tildes.
- Bancos: tabla `banco` editable (nombre único, activo), precargada con los bancos que operan
  en Argentina, con ABM en Configuración → Bancos.
- Selector de banco en lugar del texto libre en la cuenta de fondos y en el cheque de terceros
  del recibo.

**No entra:** unificar bancos duplicados ya cargados (queda para después), código BCRA y
detección del banco por CBU, `recibo_medio.banco` (transferencia, dato heredado) y
`orden_pago_medio.banco` (se completa con el banco o el nombre de la cuenta), restricción en
la base para provincia.

## Decisiones

- **Tabla editable para bancos** (usuario, 14/11/2026); las provincias quedan como constante,
  porque son 24 y no cambian.
- **Clave foránea por nombre** (`banco text references banco(nombre)`) en `cuenta_fondos` y
  `cheque`, sin columna `banco_id`. Las funciones SQL, descripciones de movimientos y PDF que
  leen `banco` como texto siguen funcionando sin cambios.
- **Renombrar un banco en uso:** `cuenta_fondos` acompaña el cambio (`on update cascade`);
  `cheque` es inmutable (trigger de cobranzas), así que su FK no acompaña y un banco usado en
  cheques no se puede renombrar: se desactiva y se crea otro. El ABM muestra ese mensaje.
- **Datos existentes:** antes de crear las FK, la migración inserta en `banco` cada valor
  distinto ya cargado que no esté en la lista, para no perder ni romper nada.
- **Entrega:** un PR por tarea contra `main`, como en finanzas (inferido del historial).

## Tareas

| ID | Tarea | Ruta | Estado |
|----|-------|------|--------|
| T1 | Provincias: constante compartida, desplegable en cliente y sucursal, normalización | delegada (escritor, 2+ archivos) | hecha (959e8ca) |
| T2 | Tabla `banco` + RLS + precarga + ABM en Configuración | delegada | hecha (fa35c78) |
| T3 | FK y selector de banco en cuenta de fondos y cheque de terceros | delegada | hecha (1821209) |

- [x] T1: commit 959e8ca. typecheck, lint y 1330 tests ok; migración aplicada en local y probada con filas de ejemplo (rollback). Riesgo medio, under_budget: la revisión queda para el tramo.
- [x] T2: commit fa35c78. 53 bancos precargados; índice único sólo entre activos (las grafías viejas de cheques quedan como bancos inactivos). typecheck, lint y 1340 tests ok; migraciones aplicadas en local.
- [x] T3: commit 1821209. FK en cuenta_fondos (cascade) y cheque (sin cascade); valores existentes sin coincidencia se agregan como bancos (cheques: inactivos si ya hay uno equivalente). Selector en cuenta de fondos y cheque del recibo; Bancos en el menú. typecheck, lint y 1342 tests ok; migración aplicada en local y probada con rollback.

## Criterios de aceptación

- No se puede guardar una provincia fuera de la lista desde la pantalla; un valor viejo fuera
  de la lista se muestra y no se pierde al editar.
- Configuración → Bancos lista, crea, edita y desactiva bancos; los inactivos no aparecen en
  los selectores pero se siguen viendo en los registros existentes.
- La base rechaza un banco que no está en la tabla en `cuenta_fondos` y `cheque`.

## Verificación

`npm run typecheck`, `npm run lint`, `npm test`, y las migraciones aplicadas en la base local.

## Avance

T1, T2 y T3 hechas. Revisión RDD: riesgo medio, declinada por el usuario para este candidato (14/11). Pendiente: probar en el navegador y PR. Variantes con palabras distintas ("Banco Galicia" vs "Banco de Galicia") quedan como bancos separados: falta unificar duplicados.
