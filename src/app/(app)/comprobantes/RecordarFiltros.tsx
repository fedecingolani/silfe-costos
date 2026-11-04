"use client";

import { useEffect } from "react";
import { COOKIE_FILTROS } from "@/lib/comprobantes/listado";

/**
 * Guarda los filtros del listado en una cookie de sesión, para que al volver
 * a /comprobantes (migas, menú) se apliquen los mismos.
 */
export function RecordarFiltros({ consulta }: { consulta: string }) {
  useEffect(() => {
    document.cookie = `${COOKIE_FILTROS}=${encodeURIComponent(consulta)}; path=/comprobantes; samesite=lax`;
  }, [consulta]);
  return null;
}
