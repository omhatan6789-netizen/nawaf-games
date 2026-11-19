import fs from "node:fs";
import path from "node:path";
import AdmZip from "adm-zip";

const root = process.cwd();
const archives = [
  { label: "carrom", file: "imports/carrom-game-project(1).zip" },
  { label: "gravity", file: "imports/gravity-game-project(1).zip" },
];

function extractSafely(zipPath, destination) {
  const zip = new AdmZip(zipPath);
  fs.rmSync(destination, { recursive: true, force: true });
  fs.mkdirSync(destination, { recursive: true });
  const written = [];

  for (const entry of zip.getEntries()) {
    const relative = entry.entryName.replaceAll("\\", "/");
    if (!relative || relative.startsWith("/") || relative.split("/").some(part => part === "..")) {
      throw new Error(`Unsafe archive path: ${entry.entryName}`);
    }
    const output = path.resolve(destination, relative);
    if (output !== destination && !output.startsWith(destination + path.sep)) {
      throw new Error(`Archive path escaped destination: ${entry.entryName}`);
    }
    if (entry.isDirectory) {
      fs.mkdirSync(output, { recursive: true });
      continue;
    }
    fs.mkdirSync(path.dirname(output), { recursive: true });
    fs.writeFileSync(output, entry.getData());
    written.push(path.relative(root, output));
  }
  return written;
}

for (const archive of archives) {
  const source = path.join(root, archive.file);
  if (!fs.existsSync(source)) {
    console.error(`[game-import] Missing archive: ${archive.file}`);
    process.exitCode = 1;
    continue;
  }
  const destination = path.join(root, ".game-inspection", archive.label);
  const files = extractSafely(source, destination);
  console.log(`[game-import] ${archive.label}: extracted ${files.length} files`);
  for (const file of files) console.log(`[game-import]   ${file}`);
}

const report = { generatedAt: new Date().toISOString(), games: {} };
for (const archive of archives) {
  const dir = path.join(root, ".game-inspection", archive.label);
  const files = [
    "metadata.json",
    "package.json",
    "server.ts",
    "src/App.tsx",
    "src/game/exportCarromMiniApp.ts",
    "src/game/exportMiniApp.ts",
  ];
  const game = { files: [] };
  for (const relative of files) {
    const file = path.join(dir, relative);
    if (!fs.existsSync(file) || !fs.statSync(file).isFile()) continue;
    let content = fs.readFileSync(file, "utf8");
    if (relative.endsWith("package.json") || relative === "metadata.json") {
      try {
        const parsed = JSON.parse(content);
        content = JSON.stringify(relative.endsWith("package.json")
          ? { name: parsed.name, scripts: parsed.scripts, dependencies: parsed.dependencies, devDependencies: parsed.devDependencies }
          : parsed, null, 2);
      } catch {}
    }
    game.files.push({ path: relative, content: content.slice(0, 9000) });
  }
  report.games[archive.label] = game;
}
fs.writeFileSync(path.join(root, "public", "game-inspection.json"), JSON.stringify(report));
console.log("[game-import] Wrote temporary inspection report to public/game-inspection.json");

for (const [gameName, game] of Object.entries(report.games)) {
  for (const file of game.files) {
    console.log(`[game-report] ${gameName}/${file.path}: ${JSON.stringify(file.content.slice(0, 3500))}`);
  }
}
