import { lstatSync, readFileSync, readdirSync } from "node:fs";
import { basename, join, relative, sep } from "node:path";
import { spawnSync } from "node:child_process";

const PRIVATE_BRAND = ["run", "chain"].join("");
const PRIVATE_DOMAIN = ["syntropy", ".gg"].join("");

const PRIVATE_SYMBOLS = [
  ["private product name", new RegExp(`\\b${PRIVATE_BRAND}\\b`, "i")],
  ["private mobile namespace", new RegExp(`com\\.${PRIVATE_BRAND}\\b`, "i")],
  ["private native package", /react-native-local[-_]?judge-native/i],
  ["private core crate", /\bcore_(?:runtime|gameplay|motion|map_format|gps_judge|oracle|shared|trail)\b/i],
  ["private map format", /\.rcmap\b/i],
  ["private route identity", /\broute[_-]?hash\b/i],
  ["private race symbol", /\bsegment[_-]?race\b/i],
  ["private judge symbol", /\blocal[_-]?judge\b/i],
  ["private protocol mirror", /\bprotocol[_-]?constants\b/i],
  ["private capability symbol", /\bpledge[_-]?oracle[_-]?cap\b/i],
  ["private proof symbol", /\bmotion[_-]?proofs?\b/i],
  ["private login symbol", /\bzk[_-]?login\b/i]
];

const PRIVATE_ENDPOINTS = [
  ["private domain", new RegExp(PRIVATE_DOMAIN.replace(".", "\\."), "i")],
  ["private host path", new RegExp(`/etc/${PRIVATE_BRAND}(?:/|$)`, "i")],
  ["private VPN subnet", /\b10\.43\.0\.\d{1,3}\b/]
];

const SECRET_PATTERNS = [
  ["private key", /-----BEGIN (?:RSA |EC |OPENSSH |PGP )?PRIVATE KEY-----/],
  ["GitHub token", /\bgh[pousr]_[A-Za-z0-9]{30,}\b/],
  ["AWS access key", /\bAKIA[0-9A-Z]{16}\b/],
  ["JSON web token", /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/],
  ["credential in URL", /\b[a-z][a-z0-9+.-]*:\/\/[^\s/:]+:[^\s/@]+@[^\s/]+/i]
];

const NAMED_SECRET = /(?:api[_-]?(?:key|token)|access[_-]?token|auth[_-]?token|client[_-]?secret|password)\s*[:=]\s*["']?([^\s"';,}]{16,})/i;
const SAFE_PLACEHOLDER = /^(?:<[^>]+>|\$\{[^}]+\}|example|placeholder|changeme|replace-me|process\.env)/i;
const IGNORED_DIRECTORIES = new Set([
  ".git",
  ".pnpm-store",
  ".turbo",
  ".wrangler",
  "build",
  "coverage",
  "node_modules",
  "playwright-report",
  "target",
  "test-results"
]);
const ARTIFACT_EXTENSIONS = new Set([
  ".a",
  ".aab",
  ".apk",
  ".class",
  ".db",
  ".dll",
  ".dylib",
  ".exe",
  ".ipa",
  ".jks",
  ".keystore",
  ".key",
  ".o",
  ".p12",
  ".pem",
  ".so",
  ".sqlite",
  ".sqlite3"
]);

function normalizePath(path) {
  return path.split(sep).join("/").replace(/^\.\//, "");
}

function runGit(root, args, encoding = "utf8") {
  return spawnSync("git", args, {
    cwd: root,
    encoding,
    maxBuffer: 32 * 1024 * 1024
  });
}

function isGitRepository(root) {
  const result = runGit(root, ["rev-parse", "--is-inside-work-tree"]);
  return result.status === 0 && result.stdout.trim() === "true";
}

function walk(root, current = root, files = []) {
  for (const entry of readdirSync(current, { withFileTypes: true })) {
    if (entry.isDirectory() && IGNORED_DIRECTORIES.has(entry.name)) continue;
    const absolute = join(current, entry.name);
    if (entry.isDirectory()) walk(root, absolute, files);
    else if (entry.isFile() || entry.isSymbolicLink()) files.push(normalizePath(relative(root, absolute)));
  }
  return files;
}

function trackedFiles(root) {
  if (!isGitRepository(root)) return [];
  const result = runGit(root, ["ls-files", "-z"]);
  if (result.status !== 0) return [];
  return result.stdout.split("\0").filter(Boolean).map(normalizePath);
}

function publishFiles(root) {
  return [...new Set([...walk(root), ...trackedFiles(root)])].sort();
}

function artifactReason(path) {
  const name = basename(path).toLowerCase();
  if (normalizePath(path).split("/").includes(".kotlin")) {
    return "generated Kotlin compiler artifact";
  }
  if (name.startsWith(".env") && !/^\.env\.(?:example|sample|template)$/.test(name)) {
    return "environment file";
  }
  const dot = name.lastIndexOf(".");
  const extension = dot >= 0 ? name.slice(dot) : "";
  return ARTIFACT_EXTENSIONS.has(extension) ? `generated or sensitive ${extension} artifact` : null;
}

function isBinary(buffer) {
  return buffer.subarray(0, Math.min(buffer.length, 8192)).includes(0);
}

function finding(kind, scope, path, message, commit) {
  return { kind, scope, path, message, ...(commit ? { commit } : {}) };
}

function scanText(path, text, scope, commit) {
  const findings = [];
  for (const [label, pattern] of PRIVATE_SYMBOLS) {
    if (pattern.test(path) || pattern.test(text)) {
      findings.push(finding("private-symbol", scope, path, `contains ${label}`, commit));
    }
  }
  for (const [label, pattern] of PRIVATE_ENDPOINTS) {
    if (pattern.test(text)) findings.push(finding("private-endpoint", scope, path, `contains ${label}`, commit));
  }
  for (const [label, pattern] of SECRET_PATTERNS) {
    if (pattern.test(text)) findings.push(finding("secret", scope, path, `contains ${label}`, commit));
  }
  for (const line of text.split(/\r?\n/)) {
    const match = line.match(NAMED_SECRET);
    if (match && !SAFE_PLACEHOLDER.test(match[1])) {
      findings.push(finding("secret", scope, path, "contains a hard-coded named credential", commit));
    }
  }
  return findings;
}

function scanBuffer(path, buffer, scope, commit) {
  return isBinary(buffer) ? [] : scanText(path, buffer.toString("utf8"), scope, commit);
}

function validateAllowlist(contentAllowlist) {
  if (!(contentAllowlist instanceof Map)) throw new TypeError("content allowlist must be a Map");
  for (const [path, reason] of contentAllowlist) {
    if (path !== normalizePath(path) || typeof reason !== "string" || reason.trim().length < 8) {
      throw new TypeError(`invalid content allowlist entry: ${path}`);
    }
  }
}

function auditWorkingTree(root, contentAllowlist) {
  const findings = [];
  for (const path of publishFiles(root)) {
    const artifact = artifactReason(path);
    if (artifact) findings.push(finding("artifact", "working-tree", path, artifact));
    if (contentAllowlist.has(path)) continue;
    try {
      const absolute = join(root, path);
      if (!lstatSync(absolute).isFile()) continue;
      findings.push(...scanBuffer(path, readFileSync(absolute), "working-tree"));
    } catch (error) {
      if (error?.code !== "ENOENT") throw error;
    }
  }
  return findings;
}

function isPublicRemote(url) {
  return /^(?:https:\/\/github\.com\/|git@github\.com:|ssh:\/\/git@github\.com\/)[A-Za-z0-9_.-]+\/offline-routing-demo(?:\.git)?\/?$/i.test(url);
}

function auditRemotes(root) {
  const findings = [];
  const notes = [];
  if (!isGitRepository(root)) {
    notes.push("No git remote: directory is not a Git repository.");
    return { findings, notes };
  }
  const names = runGit(root, ["remote"]).stdout.trim().split(/\r?\n/).filter(Boolean);
  if (names.length === 0) notes.push("No git remote configured; configure and re-run before publication.");
  for (const name of names) {
    const urls = runGit(root, ["remote", "get-url", "--all", name]).stdout.trim().split(/\r?\n/).filter(Boolean);
    for (const url of urls) {
      if (!isPublicRemote(url)) findings.push(finding("remote", "git-metadata", name, `unexpected remote URL: ${url}`));
    }
  }
  return { findings, notes };
}

function auditHistory(root, contentAllowlist) {
  if (!isGitRepository(root)) return [];
  const revisions = runGit(root, ["rev-list", "--all"]);
  if (revisions.status !== 0) return [];
  const findings = [];
  for (const commit of revisions.stdout.trim().split(/\r?\n/).filter(Boolean)) {
    const tree = runGit(root, ["ls-tree", "-r", "--name-only", "-z", commit]);
    if (tree.status !== 0) continue;
    for (const rawPath of tree.stdout.split("\0").filter(Boolean)) {
      const path = normalizePath(rawPath);
      const shortCommit = commit.slice(0, 12);
      const artifact = artifactReason(path);
      if (artifact) findings.push(finding("artifact", "history", path, artifact, shortCommit));
      if (contentAllowlist.has(path)) continue;
      const blob = runGit(root, ["show", `${commit}:${rawPath}`], null);
      if (blob.status !== 0) continue;
      findings.push(...scanBuffer(path, blob.stdout, "history", shortCommit));
    }
  }
  return findings;
}

export function auditRepository(root, options = {}) {
  const contentAllowlist = options.contentAllowlist ?? new Map();
  validateAllowlist(contentAllowlist);
  const remotes = auditRemotes(root);
  return {
    findings: [
      ...auditWorkingTree(root, contentAllowlist),
      ...auditHistory(root, contentAllowlist),
      ...remotes.findings
    ],
    notes: remotes.notes
  };
}
