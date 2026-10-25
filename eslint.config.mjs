import nextCoreWebVitals from "eslint-config-next/core-web-vitals";
import nextTypescript from "eslint-config-next/typescript";

const config = [
  ...nextCoreWebVitals,
  ...nextTypescript,
  {
    ignores: [
      "node_modules/**",
      ".next/**",
      ".open-next/**",
      ".wrangler/**",
      "supabase/.temp/**",
      "out/**",
      "build/**",
      "next-env.d.ts",
      "cloudflare-env.d.ts",
    ],
  },
];

export default config;
