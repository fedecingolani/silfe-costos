"use client";

import { useActionState, useState, type FormEvent } from "react";
import Link from "next/link";
import { ModalError } from "@/components/ModalError";
import { Tarjeta, Vacio, Pastilla } from "@/components/ui";
import { aNumero, numero, pesos, porcentaje } from "@/lib/formato";
import { crearListaPrecio, type ItemListaEnviado } from "../acciones";

/** Fila del editor. Los precios y el IVA se guardan como texto para aceptar coma decimal. */
export type FilaEditor = ItemListaEnviado & { clave: string };

export type DatosIniciales = {
  nombre: string;
  titulo: string;
  notas: string;
  filas: FilaEditor[];
};

let contador = 0;
function nuevaClave() {
  contador += 1;
  return `manual-${Date.now()}-${contador}`;
}

function filaManualVacia(): FilaEditor {
  return {
    clave: nuevaClave(),
    es_repuesto: false,
    producto_id: null,
    codigo: "",
    descripcion: "",
    presentacion: "",
    alicuota_iva: "21",
    precio_sugerido: null,
    precio_final: "",
  };
}

/** Ítem de producto que no tiene precio sugerido (falta el precio de alguna materia prima). */
function sinSugerido(fila: FilaEditor) {
  return fila.producto_id !== null && fila.precio_sugerido === null;
}

/** Devuelve el primer problema de una fila, o null si está bien. */
function problemaDeFila(fila: FilaEditor): string | null {
  if (fila.descripcion.trim() === "") return "falta la descripción";
  const precio = aNumero(fila.precio_final);
  if (precio === null) return sinSugerido(fila) ? "no tiene precio sugerido: cargá el precio a mano" : "falta el precio final";
  if (precio < 0) return "el precio final no puede ser negativo";
  const iva = aNumero(fila.alicuota_iva, 21);
  if (iva === null || iva < 0 || iva > 100) return "el IVA tiene que estar entre 0 y 100";
  return null;
}

function diferencia(fila: FilaEditor): number | null {
  const precio = aNumero(fila.precio_final);
  if (precio === null || fila.precio_sugerido === null || fila.precio_sugerido <= 0) return null;
  return ((precio - fila.precio_sugerido) / fila.precio_sugerido) * 100;
}

const CAMPO_TABLA = "campo mt-0 px-2 py-1 text-sm";

export function EditorLista({ iniciales }: { iniciales: DatosIniciales }) {
  const [estado, accion, pendiente] = useActionState(crearListaPrecio, undefined);
  // Campos controlados: React 19 limpia los no controlados después de cada envío,
  // y un error del servidor no debe borrar lo que se cargó.
  const [nombre, setNombre] = useState(iniciales.nombre);
  const [titulo, setTitulo] = useState(iniciales.titulo);
  const [notas, setNotas] = useState(iniciales.notas);
  const [filas, setFilas] = useState<FilaEditor[]>(iniciales.filas);
  const [errores, setErrores] = useState<string[]>([]);
  const [conProblema, setConProblema] = useState<Set<string>>(new Set());

  function cambiar(clave: string, campo: keyof ItemListaEnviado, valor: string) {
    setFilas((actuales) => actuales.map((f) => (f.clave === clave ? { ...f, [campo]: valor } : f)));
  }

  function mover(indice: number, paso: -1 | 1) {
    setFilas((actuales) => {
      const destino = indice + paso;
      if (destino < 0 || destino >= actuales.length) return actuales;
      const copia = [...actuales];
      [copia[indice], copia[destino]] = [copia[destino], copia[indice]];
      return copia;
    });
  }

  function quitar(clave: string) {
    setFilas((actuales) => actuales.filter((f) => f.clave !== clave));
  }

  function validar(e: FormEvent<HTMLFormElement>) {
    const mensajes: string[] = [];
    const marcadas = new Set<string>();

    if (nombre.trim() === "") mensajes.push("La lista necesita un nombre.");
    if (filas.length === 0) mensajes.push("La lista necesita al menos un ítem.");

    filas.forEach((fila, i) => {
      const problema = problemaDeFila(fila);
      if (problema) {
        marcadas.add(fila.clave);
        mensajes.push(`Ítem ${i + 1}${fila.descripcion.trim() ? ` (${fila.descripcion.trim()})` : ""}: ${problema}.`);
      }
    });

    setErrores(mensajes);
    setConProblema(marcadas);
    if (mensajes.length > 0) {
      e.preventDefault();
      window.scrollTo({ top: 0, behavior: "smooth" });
    }
  }

  const items: ItemListaEnviado[] = filas.map((f) => ({
    es_repuesto: f.es_repuesto,
    producto_id: f.producto_id,
    codigo: f.codigo,
    descripcion: f.descripcion,
    presentacion: f.presentacion,
    alicuota_iva: f.alicuota_iva,
    precio_sugerido: f.precio_sugerido,
    precio_final: f.precio_final,
  }));
  const faltantes = filas.filter((f) => sinSugerido(f) && aNumero(f.precio_final) === null).length;

  return (
    <form action={accion} onSubmit={validar} className="space-y-4" noValidate>
      <input type="hidden" name="items" value={JSON.stringify(items)} />

      {errores.length > 0 && (
        <div className="rounded-xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-700">
          <p className="font-semibold">Revisá estos datos antes de guardar:</p>
          <ul className="mt-1 list-disc space-y-0.5 pl-5">
            {errores.map((m) => (
              <li key={m}>{m}</li>
            ))}
          </ul>
        </div>
      )}

      <Tarjeta titulo="Datos de la lista">
        <div className="grid gap-3 p-4 md:grid-cols-2">
          <div>
            <label className="etiqueta">Nombre *</label>
            <input name="nombre" required value={nombre} onChange={(e) => setNombre(e.target.value)} className="campo" />
            <p className="mt-1 text-xs text-stone-500">Nombre interno, para encontrarla en el índice.</p>
          </div>
          <div>
            <label className="etiqueta">Título</label>
            <input name="titulo" value={titulo} onChange={(e) => setTitulo(e.target.value)} className="campo" />
            <p className="mt-1 text-xs text-stone-500">Encabezado que se imprime en la lista.</p>
          </div>
          <div className="md:col-span-2">
            <label className="etiqueta">Notas</label>
            <textarea name="notas" rows={2} value={notas} onChange={(e) => setNotas(e.target.value)} className="campo" />
          </div>
        </div>
      </Tarjeta>

      <Tarjeta
        titulo={`${filas.length} ítems`}
        descripcion="Precios sin IVA. El precio final se precarga con el sugerido redondeado hacia arriba a la centena."
        acciones={
          <div className="flex items-center gap-2">
            {faltantes > 0 && <Pastilla tono="ambar">{faltantes} sin precio sugerido</Pastilla>}
            <button
              type="button"
              onClick={() => setFilas((actuales) => [...actuales, filaManualVacia()])}
              className="boton-secundario"
            >
              + Agregar ítem
            </button>
          </div>
        }
      >
        <div className="overflow-x-auto">
          <table className="tabla">
            <thead>
              <tr>
                <th className="w-8">#</th>
                <th>Código</th>
                <th className="min-w-72">Descripción</th>
                <th>Presentación</th>
                <th className="num">IVA %</th>
                <th className="num">Precio sugerido</th>
                <th className="num">Precio final</th>
                <th className="num">Dif. %</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {filas.length === 0 && <Vacio mensaje="La lista no tiene ítems. Agregá uno." colSpan={9} />}
              {filas.map((fila, i) => {
                const manual = fila.producto_id === null;
                const falta = sinSugerido(fila);
                const marcada = conProblema.has(fila.clave) && problemaDeFila(fila) !== null;
                const dif = diferencia(fila);
                return (
                  <tr
                    key={fila.clave}
                    className={marcada ? "bg-red-50" : falta ? "bg-amber-50" : undefined}
                  >
                    <td className="text-xs text-stone-400">{i + 1}</td>
                    <td className="whitespace-nowrap">
                      {manual ? (
                        <input
                          value={fila.codigo}
                          onChange={(e) => cambiar(fila.clave, "codigo", e.target.value)}
                          className={`${CAMPO_TABLA} w-24`}
                          aria-label={`Código del ítem ${i + 1}`}
                        />
                      ) : (
                        <span className="text-xs text-stone-500">{fila.codigo}</span>
                      )}
                    </td>
                    <td>
                      <div className={`flex items-center gap-2 ${fila.es_repuesto ? "pl-6" : ""}`}>
                        {fila.es_repuesto && <span className="text-stone-300">↳</span>}
                        <input
                          value={fila.descripcion}
                          onChange={(e) => cambiar(fila.clave, "descripcion", e.target.value)}
                          className={`${CAMPO_TABLA} w-full`}
                          aria-label={`Descripción del ítem ${i + 1}`}
                        />
                        {manual && <Pastilla>Manual</Pastilla>}
                      </div>
                    </td>
                    <td className="whitespace-nowrap">
                      {manual ? (
                        <input
                          value={fila.presentacion}
                          onChange={(e) => cambiar(fila.clave, "presentacion", e.target.value)}
                          className={`${CAMPO_TABLA} w-28`}
                          aria-label={`Presentación del ítem ${i + 1}`}
                        />
                      ) : (
                        <span className="text-stone-600">{fila.presentacion || "—"}</span>
                      )}
                    </td>
                    <td className="num">
                      {manual ? (
                        <input
                          value={fila.alicuota_iva}
                          onChange={(e) => cambiar(fila.clave, "alicuota_iva", e.target.value)}
                          inputMode="decimal"
                          className={`${CAMPO_TABLA} w-16 text-right`}
                          aria-label={`IVA del ítem ${i + 1}`}
                        />
                      ) : (
                        <span className="text-stone-600">{numero(aNumero(fila.alicuota_iva))}</span>
                      )}
                    </td>
                    <td className="num whitespace-nowrap text-stone-500">
                      {falta ? <Pastilla tono="ambar">Sin precio</Pastilla> : pesos(fila.precio_sugerido)}
                    </td>
                    <td className="num">
                      <input
                        value={fila.precio_final}
                        onChange={(e) => cambiar(fila.clave, "precio_final", e.target.value)}
                        inputMode="decimal"
                        placeholder={falta || manual ? "Cargar precio" : undefined}
                        className={`${CAMPO_TABLA} w-32 text-right`}
                        aria-label={`Precio final del ítem ${i + 1}`}
                      />
                    </td>
                    <td
                      className={`num whitespace-nowrap ${
                        dif === null ? "text-stone-400" : dif < 0 ? "text-red-700" : "text-marca-800"
                      }`}
                    >
                      {dif === null ? "—" : `${dif > 0 ? "+" : ""}${porcentaje(dif)}`}
                    </td>
                    <td className="whitespace-nowrap text-right">
                      <div className="flex justify-end gap-1">
                        <button
                          type="button"
                          onClick={() => mover(i, -1)}
                          disabled={i === 0}
                          className="boton-secundario px-2 py-1 text-xs"
                          aria-label={`Subir el ítem ${i + 1}`}
                          title="Subir"
                        >
                          ↑
                        </button>
                        <button
                          type="button"
                          onClick={() => mover(i, 1)}
                          disabled={i === filas.length - 1}
                          className="boton-secundario px-2 py-1 text-xs"
                          aria-label={`Bajar el ítem ${i + 1}`}
                          title="Bajar"
                        >
                          ↓
                        </button>
                        <button
                          type="button"
                          onClick={() => quitar(fila.clave)}
                          className="boton-peligro px-2 py-1 text-xs"
                          aria-label={`Quitar el ítem ${i + 1}`}
                          title="Quitar"
                        >
                          Quitar
                        </button>
                      </div>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </Tarjeta>

      <div className="flex flex-wrap items-center justify-end gap-2">
        <Link href="/listas-precios" className="boton-secundario">
          Cancelar
        </Link>
        <button disabled={pendiente} className="boton-primario">
          {pendiente ? "Guardando…" : "Guardar lista"}
        </button>
      </div>
      <p className="text-right text-xs text-stone-500">
        Una lista guardada no se puede modificar. Para corregirla, se duplica.
      </p>

      <ModalError estado={estado} />
    </form>
  );
}
