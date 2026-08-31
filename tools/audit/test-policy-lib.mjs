import { readFileSync, readdirSync } from "node:fs";
import { relative, resolve, sep } from "node:path";

const ignoredDirectories = new Set([
  ".git",
  ".gradle",
  ".turbo",
  ".cache",
  ".cxx",
  "build",
  "coverage",
  "dist",
  "node_modules",
  "target"
]);

const jsTestFile = /(?:^|\.)((?:test)|(?:spec))\.(?:[cm]?js|jsx|tsx?)$/;

const rules = [
  {
    name: "focused-js-test",
    applies: (path) => jsTestFile.test(path),
    pattern: /\b(?:test(?:\s*\.\s*describe)?|it|describe)\s*\.\s*only\s*\(/m
  },
  {
    name: "skipped-js-test",
    applies: (path) => jsTestFile.test(path),
    pattern: /\b(?:test(?:\s*\.\s*describe)?|it|describe)\s*\.\s*(?:skip|fixme|todo)\s*\(|\b(?:skip|todo)\s*:\s*true\b/m
  },
  {
    name: "ignored-rust-test",
    applies: (path) => path.endsWith(".rs"),
    pattern: /#\s*\[\s*ignore(?:\s*=\s*[^\]]+)?\s*\]/m
  }
];

function sourceFiles(root) {
  const absoluteRoot = resolve(root);
  const files = [];

  function visit(directory) {
    const entries = readdirSync(directory, { withFileTypes: true })
      .sort((a, b) => a.name.localeCompare(b.name));

    for (const entry of entries) {
      if (entry.isSymbolicLink()) continue;
      const absolutePath = resolve(directory, entry.name);
      if (entry.isDirectory()) {
        if (!ignoredDirectories.has(entry.name)) visit(absolutePath);
        continue;
      }
      if (entry.isFile()) files.push(absolutePath);
    }
  }

  visit(absoluteRoot);
  return files.map((path) => ({
    absolutePath: path,
    path: relative(absoluteRoot, path).split(sep).join("/")
  }));
}

function location(content, index) {
  const before = content.slice(0, index);
  const line = before.split("\n").length;
  const lastNewline = before.lastIndexOf("\n");
  return { line, column: index - lastNewline };
}

export function findDisabledTests(root) {
  const findings = [];

  for (const file of sourceFiles(root)) {
    const applicableRules = rules.filter(({ applies }) => applies(file.path));
    if (applicableRules.length === 0) continue;
    const content = readFileSync(file.absolutePath, "utf8");

    for (const rule of applicableRules) {
      const match = rule.pattern.exec(content);
      if (!match) continue;
      findings.push({
        path: file.path,
        rule: rule.name,
        ...location(content, match.index)
      });
    }
  }

  return findings.sort((a, b) =>
    a.path.localeCompare(b.path) || a.rule.localeCompare(b.rule)
  );
}
