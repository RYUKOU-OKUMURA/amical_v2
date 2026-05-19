import { spawnSync } from "node:child_process";

const isWindowsX64 = process.platform === "win32" && process.arch === "x64";
const nativeOnly = process.argv.includes("--native-only");

if (!isWindowsX64) {
  console.log(
    `Skipping Windows helper build on ${process.platform}-${process.arch}.`,
  );
  process.exit(0);
}

const run = (command, args) => {
  const result = spawnSync(command, args, {
    shell: process.platform === "win32",
    stdio: "inherit",
  });

  if (result.error) {
    console.error(result.error.message);
    process.exit(1);
  }

  if (result.status !== 0) {
    process.exit(result.status ?? 1);
  }
};

if (!nativeOnly) {
  run("pnpm", ["--filter", "@amical/types", "generate:all"]);
}

run("dotnet", [
  "publish",
  "-c",
  "Release",
  "-r",
  "win-x64",
  "--self-contained",
  "true",
  "-o",
  "bin",
]);
