import { defineConfig } from "vite";
import react from "@vitejs/plugin-react";
import tailwindcss from "@tailwindcss/vite";
import { resolve } from "node:path";

// Languages actually used by the novel writing app
const USED_LANGUAGES = new Set([
  "text", "typescript", "javascript", "jsx", "tsx", "json", "css", "scss",
  "html", "xml", "markdown", "python", "bash", "sh", "zsh", "powershell",
  "rust", "go", "java", "c", "cpp", "sql", "yaml", "toml", "ini",
  "diff", "regex", "latex", "bibtex", "makefile", "dockerfile",
  "ruby", "php", "swift", "kotlin", "dart", "lua", "perl", "r",
  "haskell", "elixir", "clojure", "scheme", "lisp", "scala",
  "vue", "svelte", "astro",
]);

const vendorChunkRules: ReadonlyArray<[string, ReadonlyArray<string>]> = [
  [
    "vendor-react",
    [
      "/node_modules/react/",
      "/node_modules/react-dom/",
      "/node_modules/scheduler/",
    ],
  ],
  [
    "vendor-ui",
    [
      "/node_modules/@base-ui/",
      "/node_modules/@radix-ui/",
      "/node_modules/class-variance-authority/",
      "/node_modules/clsx/",
      "/node_modules/cmdk/",
      "/node_modules/lucide-react/",
      "/node_modules/motion/",
      "/node_modules/tailwind-merge/",
      "/node_modules/zustand/",
    ],
  ],
  [
    "vendor-ai",
    [
      "/node_modules/@ai-sdk/",
      "/node_modules/ai/",
    ],
  ],
];

function manualChunks(id: string): string | undefined {
  const normalizedId = id.replace(/\\/g, "/");
  if (!normalizedId.includes("/node_modules/")) return undefined;

  for (const [chunkName, packagePathFragments] of vendorChunkRules) {
    if (packagePathFragments.some((fragment) => normalizedId.includes(fragment))) {
      return chunkName;
    }
  }

  return undefined;
}

function filterShikiLangs() {
  return {
    name: "filter-shiki-langs",
    enforce: "pre" as const,
    resolveId(source: string) {
      const langMatch = source.match(/shiki[/\\]dist[/\\]langs[/\\]([^.]+)\.mjs$/);
      if (langMatch) {
        const langId = langMatch[1].replace(/-[^-]*$/, "");
        const langName = langId.split("-")[0];
        if (!USED_LANGUAGES.has(langId) && !USED_LANGUAGES.has(langName)) {
          return { id: "\0shiki-empty-lang", moduleSideEffects: false };
        }
      }
      return null;
    },
    load(id: string) {
      if (id === "\0shiki-empty-lang") {
        return { code: "export default [];", map: null };
      }
      return null;
    },
  };
}

export default defineConfig({
  plugins: [react(), tailwindcss(), filterShikiLangs()],
  resolve: {
    alias: {
      "@": resolve(__dirname, "src"),
    },
  },
  server: {
    port: 4567,
    proxy: {
      "/api/v1/events": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4659"}`,
        changeOrigin: true,
        selfHandleResponse: true,
        configure: (proxy) => {
          proxy.on("proxyRes", (proxyRes, _req, res) => {
            res.writeHead(proxyRes.statusCode ?? 200, proxyRes.headers);
            proxyRes.pipe(res);
          });
        },
      },
      "/api": {
        target: `http://localhost:${process.env.INKOS_STUDIO_PORT ?? "4659"}`,
        changeOrigin: true,
      },
    },
  },
  build: {
    target: "chrome61",
    cssTarget: "chrome61",
    chunkSizeWarningLimit: 900,
    rollupOptions: {
      output: {
        manualChunks,
      },
    },
  },
});
