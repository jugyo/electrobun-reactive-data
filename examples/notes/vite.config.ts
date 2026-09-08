import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";
export default defineConfig({
  root: "src/mainview",
  plugins: [
    react(),
    ...(process.env.ERD_NATIVE_TEST === "1"
      ? [
          {
            name: "native-test-entry",
            transformIndexHtml: {
              order: "pre" as const,
              handler(html: string) {
                return html.replace(
                  'src="/main.tsx"',
                  'src="/@fs/' +
                    resolve(import.meta.dirname, "test/view.ts") +
                    '"',
                );
              },
            },
          },
        ]
      : []),
  ],
  base: "./",
  resolve: {
    alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")),
  },
  build: { outDir: "../../dist", emptyOutDir: true },
});
