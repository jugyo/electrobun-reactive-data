import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "Electrobun Reactive Data Todo",
    identifier: "dev.jugyo.electrobun-reactive-data",
    version: "0.0.0",
  },
  build: {
    mainProcess: "bun",
    bun: { entrypoint: "demo/bun/index.ts" },
    copy: {
      "dist/index.html": "views/mainview/index.html",
      "dist/assets": "views/mainview/assets",
    },
    mac: { bundleCEF: false },
    linux: { bundleCEF: false },
    win: { bundleCEF: false },
  },
  runtime: { exitOnLastWindowClosed: false },
} satisfies ElectrobunConfig;
