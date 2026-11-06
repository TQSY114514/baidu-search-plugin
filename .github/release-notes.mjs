// Prints the release notes for the package.json version: the CHANGELOG env
// var when set (the publish workflow's manual override), otherwise that
// version's section of CHANGELOG.md. Exits 1 when there are none, so a
// release can't go out without notes.
//
//   node .github/release-notes.mjs
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

// Returns the body under "## <version>" (anything after the version on the
// heading line, such as a date, is ignored), trimmed; "" when absent.
export function readReleaseNotes(changelog, version) {
  const lines = [];
  let inSection = false;
  for (const line of changelog.split("\n")) {
    if (line.startsWith("## ")) {
      if (inSection) break;
      inSection = line.slice(3).trim().split(/\s/)[0] === version;
    } else if (inSection) {
      lines.push(line);
    }
  }
  return lines.join("\n").trim();
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const root = new URL("../", import.meta.url);
  const { version } = JSON.parse(readFileSync(new URL("package.json", root), "utf8"));
  const notes =
    process.env.CHANGELOG?.trim() || readReleaseNotes(readFileSync(new URL("CHANGELOG.md", root), "utf8"), version);
  if (!notes) {
    console.error(`No CHANGELOG.md section for ${version}`);
    process.exit(1);
  }
  console.log(notes);
}
