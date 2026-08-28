import { defineConfig } from "tsdown";

export default defineConfig({
  entry: ["src/index.ts", "src/stall/index.ts"],
  format: ["esm"],
  dts: true,
  sourcemap: true,
  deps: {
    neverBundle: ["react", "react-dom"],
  },
});
