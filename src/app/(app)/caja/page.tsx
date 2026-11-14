import { PaginaCuentas } from "../finanzas/PaginaCuentas";

export const dynamic = "force-dynamic";

export default function Page() {
  return <PaginaCuentas tipo="caja" />;
}
