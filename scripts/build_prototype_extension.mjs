import { cp, mkdir, rm } from "node:fs/promises";
import path from "node:path";
import { build } from "esbuild";

const root = process.cwd();
const source = path.join(root, "prototype-extension");
const output = path.join(root, "dist", "prototype-extension");
const sdkRoot = process.env.PHANTOM_SDK_PATH || path.join(root, "forks", "phantom-connect-sdk");
const provider = path.join(sdkRoot, "packages", "browser-injected-sdk", "src", "cardano", "provider.ts");
const constants = path.join(sdkRoot, "packages", "constants", "src", "icons.ts");

await rm(output, { recursive: true, force: true });
await mkdir(output, { recursive: true });
for (const file of ["manifest.json", "content-script.js", "background.js", "approval.html", "approval.js", "approval.css"]) {
  await cp(path.join(source, file), path.join(output, file));
}

await build({
  entryPoints: [path.join(source, "src", "injected.ts")],
  outfile: path.join(output, "injected.js"),
  bundle: true,
  format: "iife",
  platform: "browser",
  target: "chrome120",
  plugins: [{
    name: "cardano-provider",
    setup(buildApi) {
      buildApi.onResolve({ filter: /^@prototype\/cardano-provider$/ }, () => ({ path: provider }));
      buildApi.onResolve({ filter: /^@phantom\/constants$/ }, () => ({ path: constants }));
    },
  }],
});

console.log(`Built prototype extension at ${output}`);
