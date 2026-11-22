// Copie le solveur HiGHS (WebAssembly) dans public/ pour qu'il soit servi au navigateur.
import { copyFileSync, mkdirSync } from "node:fs";
import { createRequire } from "node:module";

const require = createRequire(import.meta.url);
mkdirSync("public/solver", { recursive: true });
copyFileSync(require.resolve("highs/runtime"), "public/solver/highs.wasm");
