import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  typedRoutes: false,
  // AGENTS.md está escrito a mano; evita que `next dev` le agregue su bloque de reglas.
  agentRules: false,
};

export default nextConfig;

import('@opennextjs/cloudflare').then(m => m.initOpenNextCloudflareForDev());
