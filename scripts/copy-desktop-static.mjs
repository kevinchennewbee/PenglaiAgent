import { cpSync, mkdirSync } from "node:fs";
mkdirSync("apps/desktop/dist", { recursive: true });
cpSync("apps/desktop/static", "apps/desktop/dist/static", { recursive: true });
console.log("copied desktop static");
