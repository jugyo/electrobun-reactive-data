import type { ElectrobunConfig } from "electrobun";
export default {
  app: {
    name: "Reactive Notes Consumer",
    identifier: "dev.jugyo.electrobun-reactive-notes-consumer",
    version: "0.0.0",
  },
  build: {
    mainProcess: "bun",
    bun: {
      entrypoint:
        process.env.ERD_NATIVE_TEST === "1"
          ? "test/main.ts"
          : "src/bun/index.ts",
    },
    copy: {
      "dist/index.html": "views/notes/index.html",
      "dist/assets": "views/notes/assets",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
