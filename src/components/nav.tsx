"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";

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
      { texto: "Remitos" },
      { href: "/seguimiento", texto: "Seguimiento" },
      { href: "/listas-precios", texto: "Listas de precios" },
      { href: "/transportes", texto: "Transportes" },
    ],
  },
  {
    titulo: "Compras",
    items: [
      { texto: "Comprobantes" },
      { texto: "Pagos" },
      { href: "/proveedores", texto: "Proveedores" },
      { texto: "Cuentas corrientes" },
      { texto: "Órdenes de compra" },
      { texto: "Remitos" },
    ],
  },
  {
    titulo: "Producción",
    items: [
      { href: "/materias-primas", texto: "Materias primas" },
      { href: "/mano-obra", texto: "Mano de obra" },
      { href: "/procesos", texto: "Procesos" },
      { href: "/productos", texto: "Productos" },
    ],
  },
  {
    titulo: "Finanzas",
    items: [
      { texto: "Bancos" },
      { texto: "Caja" },
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

export function Nav() {
  const pathname = usePathname();
  const activoHref = hrefActivo(pathname);

  return (
    <nav className="space-y-5">
      <ItemMenu item={INICIO} activoHref={activoHref} />
      {SECCIONES.map((seccion) => (
        <div key={seccion.titulo}>
          <p className="px-3 pb-1 text-[10px] font-semibold uppercase tracking-widest text-stone-400">
            {seccion.titulo}
          </p>
          <ul className="space-y-0.5">
            {seccion.items.map((item) => (
              <li key={item.href ?? `${seccion.titulo}-${item.texto}`}>
                <ItemMenu item={item} activoHref={activoHref} />
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
