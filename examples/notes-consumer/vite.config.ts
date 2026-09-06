import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";
import { resolve } from "node:path";
import { electrobunViteAliases } from "./.hutch/devkit/api/config/electrobun-vite";
export default defineConfig({ root: "src/mainview", plugins: [react()], base: "./", resolve: { alias: electrobunViteAliases(resolve(import.meta.dirname, ".hutch/devkit")) }, build: { outDir: "../../dist", emptyOutDir: true } });
