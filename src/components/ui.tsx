import Link from "next/link";
import type { ReactNode } from "react";

export function Encabezado({
  titulo,
  descripcion,
  acciones,
}: {
  titulo: string;
  descripcion?: string;
  acciones?: ReactNode;
}) {
  return (
    <div className="mb-6 flex flex-wrap items-start justify-between gap-4">
      <div>
        <h1 className="text-2xl font-semibold text-stone-900">{titulo}</h1>
        {descripcion && <p className="mt-1 max-w-2xl text-sm text-stone-500">{descripcion}</p>}
      </div>
      {acciones && <div className="flex flex-wrap items-center gap-2">{acciones}</div>}
    </div>
  );
}

export function Tarjeta({
  titulo,
  descripcion,
  acciones,
  children,
  className = "",
}: {
  titulo?: string;
  descripcion?: string;
  acciones?: ReactNode;
  children: ReactNode;
  className?: string;
}) {
  return (
    <section className={`tarjeta ${className}`}>
      {(titulo || acciones) && (
        <header className="flex flex-wrap items-center justify-between gap-3 border-b border-stone-200 px-4 py-3">
          <div>
            {titulo && <h2 className="text-sm font-semibold text-stone-900">{titulo}</h2>}
            {descripcion && <p className="text-xs text-stone-500">{descripcion}</p>}
          </div>
          {acciones}
        </header>
      )}
      {children}
    </section>
  );
}

export function Kpi({
  etiqueta,
  valor,
  detalle,
  acento = false,
}: {
  etiqueta: string;
  valor: string;
  detalle?: string;
  acento?: boolean;
}) {
  return (
    <div className={`tarjeta px-4 py-3 ${acento ? "border-marca-300 bg-marca-50" : ""}`}>
      <p className="text-xs font-medium uppercase tracking-wide text-stone-500">{etiqueta}</p>
      <p className={`mt-1 text-xl font-semibold tabular-nums ${acento ? "text-marca-800" : "text-stone-900"}`}>
        {valor}
      </p>
      {detalle && <p className="mt-0.5 text-xs text-stone-500">{detalle}</p>}
    </div>
  );
}

export function Vacio({ mensaje, colSpan }: { mensaje: string; colSpan: number }) {
  return (
    <tr>
      <td colSpan={colSpan} className="px-3 py-8 text-center text-sm text-stone-400">
        {mensaje}
      </td>
    </tr>
  );
}

export function Pastilla({
  children,
  tono = "neutro",
}: {
  children: ReactNode;
  tono?: "neutro" | "verde" | "ambar" | "rojo" | "azul";
}) {
  const tonos = {
    neutro: "bg-stone-100 text-stone-600",
    verde: "bg-marca-100 text-marca-800",
    ambar: "bg-amber-100 text-amber-800",
    rojo: "bg-red-100 text-red-700",
    azul: "bg-sky-100 text-sky-800",
  } as const;
  return <span className={`pastilla ${tonos[tono]}`}>{children}</span>;
}

export function Migas({ items }: { items: { href?: string; texto: string }[] }) {
  return (
    <nav className="mb-3 flex items-center gap-1.5 text-xs text-stone-500">
      {items.map((item, i) => (
        <span key={i} className="flex items-center gap-1.5">
          {i > 0 && <span className="text-stone-300">/</span>}
          {item.href ? (
            <Link href={item.href} className="hover:text-marca-700 hover:underline">
              {item.texto}
            </Link>
          ) : (
            <span className="text-stone-700">{item.texto}</span>
          )}
        </span>
      ))}
    </nav>
  );
}

export function BotonEliminar({ children = "Eliminar", title }: { children?: ReactNode; title?: string }) {
  return (
    <button
      type="submit"
      className="boton-peligro px-2 py-1 text-xs"
      aria-label={title ?? (typeof children === "string" ? children : "Eliminar")}
    >
      {children}
    </button>
  );
}
