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
