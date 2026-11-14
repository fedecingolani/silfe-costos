"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import { useId, useMemo, useSyncExternalStore } from "react";

/** Ítem sin `href`: la pantalla todavía no existe y se muestra como "Próximamente". */
type Item = { texto: string; href?: string };

const INICIO: Item = { href: "/", texto: "Dashboard" };

const SECCIONES: { titulo: string; items: Item[] }[] = [
  {
    titulo: "Ventas",
    items: [
      { href: "/comprobantes", texto: "Comprobantes" },
      { href: "/cobranzas", texto: "Cobranzas" },
      { href: "/clientes", texto: "Clientes" },
      { href: "/cuentas-corrientes", texto: "Cuentas corrientes" },
      { href: "/presupuestos", texto: "Presupuestos" },
      { href: "/remitos", texto: "Remitos" },
      { href: "/seguimiento", texto: "Seguimiento" },
      { href: "/listas-precios", texto: "Listas de precios" },
      { href: "/transportes", texto: "Transportes" },
    ],
  },
  {
    titulo: "Compras",
    items: [
      { href: "/compras/comprobantes", texto: "Comprobantes" },
      { href: "/compras/pagos", texto: "Pagos" },
      { href: "/proveedores", texto: "Proveedores" },
      { href: "/compras/cuentas-corrientes", texto: "Cuentas corrientes" },
      { texto: "Órdenes de compra" },
      { href: "/compras/remitos", texto: "Remitos" },
    ],
  },
  {
    titulo: "Producción",
    items: [
      { href: "/materias-primas", texto: "Materias primas" },
      { href: "/mano-obra", texto: "Mano de obra" },
      { href: "/procesos", texto: "Procesos" },
      { href: "/productos", texto: "Productos" },
      { texto: "Stock" },
    ],
  },
  {
    titulo: "Finanzas",
    items: [
      { href: "/bancos", texto: "Bancos" },
      { href: "/caja", texto: "Caja" },
      { href: "/cheques", texto: "Cheques" },
      { texto: "Conciliación bancaria" },
    ],
  },
  {
    titulo: "Configuración",
    items: [
      { href: "/unidades", texto: "Unidades" },
      { href: "/configuracion", texto: "Parámetros" },
      { href: "/configuracion/empresa", texto: "Empresa" },
      { href: "/configuracion/arca", texto: "ARCA" },
      { href: "/configuracion/integraciones", texto: "Integraciones" },
    ],
  },
];

const HREFS = [INICIO, ...SECCIONES.flatMap((seccion) => seccion.items)]
  .map((item) => item.href)
  .filter((href): href is string => href !== undefined);

/**
 * Ítem activo: el href más largo que coincide con la ruta, para que
 * "/configuracion/arca" marque "ARCA" y no también "Parámetros".
 */
function hrefActivo(pathname: string): string | undefined {
  return HREFS.filter((href) => (href === "/" ? pathname === "/" : pathname.startsWith(href))).sort(
    (a, b) => b.length - a.length,
  )[0];
}

function ItemMenu({ item, activoHref }: { item: Item; activoHref: string | undefined }) {
  if (!item.href) {
    return (
      <span
        aria-disabled="true"
        className="flex cursor-default items-center justify-between gap-2 rounded-lg px-3 py-1.5 text-sm text-stone-400"
      >
        {item.texto}
        <span className="text-[10px] uppercase tracking-wide">Próximamente</span>
      </span>
    );
  }

  const activo = item.href === activoHref;
  return (
    <Link
      href={item.href}
      aria-current={activo ? "page" : undefined}
      className={`block rounded-lg px-3 py-1.5 text-sm transition ${
        activo ? "bg-marca-600 font-medium text-white" : "text-stone-600 hover:bg-stone-200/70 hover:text-stone-900"
      }`}
    >
      {item.texto}
    </Link>
  );
}

const CLAVE_ABIERTAS = "nav:secciones-abiertas";

function seccionDe(href: string | undefined): string | undefined {
  return SECCIONES.find((seccion) => seccion.items.some((item) => item.href === href))?.titulo;
}

/** Secciones que el usuario abrió o cerró a mano: título → abierta. */
type Preferencias = Record<string, boolean>;

const EVENTO_PREFERENCIAS = "nav:preferencias";
/** Última preferencia de esta pestaña; manda aunque localStorage no la haya podido guardar. */
let preferenciasEnMemoria: string | null = null;

function leerPreferencias(): string {
  if (preferenciasEnMemoria !== null) return preferenciasEnMemoria;
  try {
    return localStorage.getItem(CLAVE_ABIERTAS) ?? "{}";
  } catch {
    return "{}";
  }
}

function guardarPreferencias(preferencias: Preferencias) {
  preferenciasEnMemoria = JSON.stringify(preferencias);
  try {
    localStorage.setItem(CLAVE_ABIERTAS, preferenciasEnMemoria);
  } catch {
    // Sin almacenamiento disponible: el estado vive sólo en esta pestaña.
  }
  window.dispatchEvent(new Event(EVENTO_PREFERENCIAS));
}

function suscribir(avisar: () => void) {
  // Un cambio hecho en otra pestaña reemplaza la copia en memoria de esta.
  const alCambiarEnOtraPestana = (evento: StorageEvent) => {
    if (evento.key !== CLAVE_ABIERTAS) return;
    preferenciasEnMemoria = null;
    avisar();
  };
  window.addEventListener(EVENTO_PREFERENCIAS, avisar);
  window.addEventListener("storage", alCambiarEnOtraPestana);
  return () => {
    window.removeEventListener(EVENTO_PREFERENCIAS, avisar);
    window.removeEventListener("storage", alCambiarEnOtraPestana);
  };
}

function parsear(crudo: string): Preferencias {
  try {
    const valor: unknown = JSON.parse(crudo);
    if (!valor || typeof valor !== "object" || Array.isArray(valor)) return {};
    return Object.fromEntries(Object.entries(valor).filter(([, v]) => typeof v === "boolean"));
  } catch {
    return {};
  }
}

function Chevron({ abierta }: { abierta: boolean }) {
  return (
    <svg
      aria-hidden="true"
      viewBox="0 0 20 20"
      fill="currentColor"
      className={`size-5 shrink-0 text-stone-500 transition-transform ${abierta ? "rotate-90" : ""}`}
    >
      <path
        fillRule="evenodd"
        d="M7.21 14.77a.75.75 0 0 1 .02-1.06L11.17 10 7.23 6.29a.75.75 0 1 1 1.04-1.08l4.5 4.25a.75.75 0 0 1 0 1.08l-4.5 4.25a.75.75 0 0 1-1.06-.02Z"
        clipRule="evenodd"
      />
    </svg>
  );
}

export function Nav() {
  const pathname = usePathname();
  const activoHref = hrefActivo(pathname);
  const seccionActiva = seccionDe(activoHref);

  // Por defecto sólo está abierta la sección de la pantalla actual; lo que el
  // usuario abre o cierra a mano se recuerda entre visitas.
  const crudo = useSyncExternalStore(suscribir, leerPreferencias, () => "{}");
  const preferencias = useMemo(() => parsear(crudo), [crudo]);
  const estaAbierta = (titulo: string) => preferencias[titulo] ?? titulo === seccionActiva;

  function alternar(titulo: string) {
    guardarPreferencias({ ...preferencias, [titulo]: !estaAbierta(titulo) });
  }

  const dashboardActivo = activoHref === INICIO.href;
  const idBase = useId();

  return (
    <nav className="space-y-1">
      <Link
        href={INICIO.href!}
        aria-current={dashboardActivo ? "page" : undefined}
        className={`block rounded-lg px-3 py-2 text-sm font-bold uppercase tracking-wide transition ${
          dashboardActivo ? "bg-marca-600 text-white" : "text-stone-800 hover:bg-stone-200/70"
        }`}
      >
        {INICIO.texto}
      </Link>
      {SECCIONES.map((seccion, indice) => {
        const abierta = estaAbierta(seccion.titulo);
        const idLista = `${idBase}-seccion-${indice}`;
        const contieneActivo = seccion.titulo === seccionActiva;
        return (
          <div key={seccion.titulo} className="border-t border-stone-200 pt-1">
            <button
              type="button"
              onClick={() => alternar(seccion.titulo)}
              aria-expanded={abierta}
              aria-controls={idLista}
              className={`flex w-full items-center justify-between rounded-lg px-3 py-2 text-left text-sm font-bold uppercase tracking-wide transition hover:bg-stone-200/70 ${
                contieneActivo ? "text-marca-700" : "text-stone-800"
              }`}
            >
              {seccion.titulo}
              <Chevron abierta={abierta} />
            </button>
            <ul id={idLista} hidden={!abierta} className="space-y-0.5 pb-2 pl-2">
              {seccion.items.map((item) => (
                <li key={item.href ?? `${seccion.titulo}-${item.texto}`}>
                  <ItemMenu item={item} activoHref={activoHref} />
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </nav>
  );
}
