"use client";

import { useEffect, useState } from "react";
import { buscarClientes, type ClienteEncontrado } from "./acciones";

/**
 * Buscador de clientes por razón social, CUIT o código legado. Busca en el
 * servidor con la misma lógica que el listado de clientes.
 */
export function BuscadorCliente({
  cliente,
  onCambiar,
  deshabilitado = false,
}: {
  cliente: ClienteEncontrado | null;
  onCambiar: (cliente: ClienteEncontrado | null) => void;
  deshabilitado?: boolean;
}) {
  const [texto, setTexto] = useState("");
  const [resultados, setResultados] = useState<ClienteEncontrado[]>([]);
  const [buscando, setBuscando] = useState(false);

  useEffect(() => {
    if (texto.trim().length < 2) return;
    let vigente = true;
    const espera = setTimeout(async () => {
      setBuscando(true);
      const encontrados = await buscarClientes(texto);
      if (vigente) {
        setResultados(encontrados);
        setBuscando(false);
      }
    }, 250);
    return () => {
      vigente = false;
      clearTimeout(espera);
    };
  }, [texto]);

  if (cliente) {
    return (
      <div className="flex items-start justify-between gap-2 rounded-lg border border-stone-200 bg-stone-50 px-3 py-2 text-sm">
        <div>
          <p className="font-medium text-stone-900">{cliente.razon_social}</p>
          <p className="text-xs text-stone-500">
            {cliente.cuit ? `CUIT ${cliente.cuit}` : "Sin CUIT"} · {cliente.condicion_iva ?? "sin condición IVA"}
            {cliente.codigo_legado !== null && ` · código ${cliente.codigo_legado}`}
          </p>
        </div>
        {!deshabilitado && (
          <button
            type="button"
            onClick={() => {
              setTexto("");
              setResultados([]);
              onCambiar(null);
            }}
            className="boton-secundario px-2 py-1 text-xs"
          >
            Cambiar
          </button>
        )}
      </div>
    );
  }

  const conTexto = texto.trim().length >= 2;
  return (
    <div className="relative">
      <input
        type="search"
        value={texto}
        onChange={(e) => setTexto(e.target.value)}
        placeholder="Razón social, CUIT o código"
        disabled={deshabilitado}
        className="campo"
        aria-label="Buscar cliente"
      />
      {conTexto && (
        <ul className="absolute z-10 mt-1 max-h-64 w-full overflow-y-auto rounded-lg border border-stone-200 bg-white text-sm shadow-lg">
          {buscando && resultados.length === 0 && <li className="px-3 py-2 text-stone-400">Buscando…</li>}
          {!buscando && resultados.length === 0 && (
            <li className="px-3 py-2 text-stone-400">Ningún cliente activo coincide.</li>
          )}
          {resultados.map((c) => (
            <li key={c.id}>
              <button
                type="button"
                onClick={() => onCambiar(c)}
                className="block w-full px-3 py-1.5 text-left hover:bg-marca-50"
              >
                <span className="text-stone-900">{c.razon_social}</span>
                <span className="ml-2 text-xs text-stone-500">{c.cuit ?? "sin CUIT"}</span>
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
