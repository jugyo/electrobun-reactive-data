export default {
  packageManager: "npm",
  electrobun: { version: "2.0.1" },
  scripts: {
    dev: "npm run build:view && hutch electrobun dev",
    build: "npm run build:view && hutch electrobun build --env=stable",
  },
};
