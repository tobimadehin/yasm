// tsup.config.ts
const coreOnly = process.env.YASM_CORE_ONLY === "true";
const noPersist = process.env.YASM_NO_PERSIST === "true";
const isDev =
  process.env.NODE_ENV === "development" ||
  process.env.NODE_ENV !== "production";

const baseEntry: Record<string, string> = {
  index: "src/index.ts",
};

// Add debug module (dev by default, excluded in prod unless specified)
if (!coreOnly && isDev) {
  baseEntry["debug/index"] = "src/debug/index.tsx";
}

export default {
  entry: baseEntry,
  format: ["cjs", "esm"],
  dts: true,
  external: ["react"],
  clean: true,
  esbuildOptions: (options) => {
    options.jsx = "automatic";
  },
};
