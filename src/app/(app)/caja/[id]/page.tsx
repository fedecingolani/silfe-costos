import { notFound } from "next/navigation";
import { PaginaCuenta, type ParametrosCuenta } from "../../finanzas/PaginaCuenta";

export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ id: string }>;
  searchParams: Promise<ParametrosCuenta>;
}) {
  const [{ id }, parametros] = await Promise.all([params, searchParams]);
  if (!UUID.test(id)) notFound();
  return <PaginaCuenta tipo="caja" id={id} parametros={parametros} />;
}
