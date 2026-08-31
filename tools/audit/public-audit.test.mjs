import assert from "node:assert/strict";
import test from "node:test";
import {
  mkdtempSync,
  mkdirSync,
  rmSync,
  writeFileSync
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { spawnSync } from "node:child_process";

import { auditRepository } from "./public-audit-lib.mjs";

const privateBrand = ["run", "chain"].join("");
const privateDomain = ["syntropy", ".gg"].join("");

function fixture() {
  const root = mkdtempSync(join(tmpdir(), "offline-routing-audit-"));
  writeFileSync(join(root, "README.md"), "# Public offline router\n");
  return root;
}

function git(root, ...args) {
  const result = spawnSync("git", args, { cwd: root, encoding: "utf8" });
  assert.equal(result.status, 0, result.stderr);
}

function initGit(root) {
  git(root, "init", "--initial-branch=main");
  git(root, "config", "user.name", "Audit Test");
  git(root, "config", "user.email", "audit@example.invalid");
}

function withFixture(run) {
  const root = fixture();
  try {
    run(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

test("accepts a neutral tree without a configured remote", () => {
  withFixture((root) => {
    const result = auditRepository(root);
    assert.deepEqual(result.findings, []);
    assert.equal(result.notes.some((note) => /no git remote/i.test(note)), true);
  });
});

test("does not flag short tokens or ordinary engineering vocabulary", () => {
  withFixture((root) => {
    writeFileSync(
      join(root, "notes.md"),
      "run PT tests for motion sensors; use an oracle database and an escrow account\n"
    );
    assert.deepEqual(auditRepository(root).findings, []);
  });
});

test("rejects exact private symbols and infrastructure endpoints", () => {
  withFixture((root) => {
    writeFileSync(
      join(root, "leak.txt"),
      `package com.${privateBrand}.mobile downloads https://assets.${privateDomain}/map\n`
    );
    const findings = auditRepository(root).findings;
    assert.equal(findings.some(({ kind }) => kind === "private-symbol"), true);
    assert.equal(findings.some(({ kind }) => kind === "private-endpoint"), true);
  });
});

test("rejects a private symbol in a path even when file content is neutral", () => {
  withFixture((root) => {
    writeFileSync(join(root, `${privateBrand}-adapter.ts`), "export {};\n");
    assert.equal(
      auditRepository(root).findings.some(
        ({ kind, path }) => kind === "private-symbol" && path === `${privateBrand}-adapter.ts`
      ),
      true
    );
  });
});

test("rejects high-confidence secrets but permits documented placeholders", () => {
  withFixture((root) => {
    writeFileSync(join(root, ".env.example"), "API_TOKEN=<set-in-host>\n");
    writeFileSync(
      join(root, "config.ts"),
      `const API_TOKEN = "${"a".repeat(40)}";\n`
    );
    const findings = auditRepository(root).findings;
    assert.equal(findings.some(({ kind }) => kind === "secret"), true);
    assert.equal(findings.some(({ path }) => path === ".env.example"), false);
  });
});

test("rejects environment, signing, application, native, and database artifacts", () => {
  withFixture((root) => {
    mkdirSync(join(root, "apps", "mobile", "android", ".kotlin", "errors"), {
      recursive: true
    });
    writeFileSync(
      join(root, "apps", "mobile", "android", ".kotlin", "errors", "compiler.log"),
      "generated compiler output"
    );
    for (const name of [
      ".env",
      ".env.local",
      "release.jks",
      "signing.pem",
      "demo.apk",
      "native.o",
      "native.so",
      "local.sqlite"
    ]) {
      writeFileSync(join(root, name), "artifact");
    }
    const artifactPaths = auditRepository(root).findings
      .filter(({ kind }) => kind === "artifact")
      .map(({ path }) => path);
    assert.deepEqual(
      artifactPaths.sort(),
      [
        ".env",
        ".env.local",
        "apps/mobile/android/.kotlin/errors/compiler.log",
        "demo.apk",
        "local.sqlite",
        "native.o",
        "native.so",
        "release.jks",
        "signing.pem"
      ]
    );
  });
});

test("ignores transient build outputs but still rejects source-tree native binaries", () => {
  withFixture((root) => {
    mkdirSync(join(root, "packages", "offline-router", "android", "build"), { recursive: true });
    mkdirSync(join(root, "packages", "offline-router", "android", "src", "main", "jniLibs", "arm64-v8a"), { recursive: true });
    writeFileSync(
      join(root, "packages", "offline-router", "android", "build", "libnative.so"),
      "artifact"
    );
    writeFileSync(
      join(root, "packages", "offline-router", "android", "src", "main", "jniLibs", "arm64-v8a", "libnative.so"),
      "artifact"
    );

    const findings = auditRepository(root).findings
      .filter(({ kind }) => kind === "artifact")
      .map(({ path }) => path)
      .sort();

    assert.deepEqual(findings, [
      "packages/offline-router/android/src/main/jniLibs/arm64-v8a/libnative.so"
    ]);
  });
});

test("content allowlist is exact and does not allow sibling paths", () => {
  withFixture((root) => {
    mkdirSync(join(root, "docs"));
    writeFileSync(join(root, "docs", "approved.md"), privateBrand);
    writeFileSync(join(root, "docs", "approved-copy.md"), privateBrand);
    const result = auditRepository(root, {
      contentAllowlist: new Map([["docs/approved.md", "documented test exception"]])
    });
    assert.equal(result.findings.some(({ path }) => path === "docs/approved.md"), false);
    assert.equal(result.findings.some(({ path }) => path === "docs/approved-copy.md"), true);
  });
});

test("content allowlist requires a documented reason", () => {
  withFixture((root) => {
    assert.throws(
      () => auditRepository(root, { contentAllowlist: new Map([["README.md", ""]]) }),
      /allowlist/i
    );
  });
});

test("accepts only a public-shaped repository remote", () => {
  withFixture((root) => {
    initGit(root);
    git(root, "remote", "add", "origin", "https://github.com/example/offline-routing-demo.git");
    assert.deepEqual(auditRepository(root).findings, []);
    git(root, "remote", "set-url", "origin", "git@github.com:example/offline-routing-demo.git");
    assert.deepEqual(auditRepository(root).findings, []);
    git(root, "remote", "set-url", "origin", `ssh://host.internal/${privateBrand}.git`);
    assert.equal(
      auditRepository(root).findings.some(({ kind }) => kind === "remote"),
      true
    );
  });
});

test("does not scan git internals as working-tree publication content", () => {
  withFixture((root) => {
    initGit(root);
    writeFileSync(join(root, ".git", "internal-note"), privateBrand);
    assert.equal(
      auditRepository(root).findings.some(
        ({ scope, path }) => scope === "working-tree" && path.startsWith(".git/")
      ),
      false
    );
  });
});

test("finds a private symbol in reachable history after the file was removed", () => {
  withFixture((root) => {
    initGit(root);
    writeFileSync(join(root, "old.txt"), privateBrand);
    git(root, "add", "old.txt");
    git(root, "commit", "-m", "temporary file");
    rmSync(join(root, "old.txt"));
    git(root, "add", "-u");
    git(root, "commit", "-m", "remove temporary file");

    const findings = auditRepository(root).findings;
    assert.equal(
      findings.some(({ kind, scope }) => kind === "private-symbol" && scope === "history"),
      true
    );
  });
});

test("finds endpoints, secrets, and artifacts in reachable history", () => {
  withFixture((root) => {
    initGit(root);
    writeFileSync(join(root, "old.env"), `API_TOKEN="${"b".repeat(40)}"\n`);
    writeFileSync(join(root, "old.apk"), `https://assets.${privateDomain}/fixture\n`);
    git(root, "add", "old.env", "old.apk");
    git(root, "commit", "-m", "temporary material");
    rmSync(join(root, "old.env"));
    rmSync(join(root, "old.apk"));
    git(root, "add", "-u");
    git(root, "commit", "-m", "remove temporary material");

    const historyKinds = new Set(
      auditRepository(root).findings
        .filter(({ scope }) => scope === "history")
        .map(({ kind }) => kind)
    );
    assert.equal(historyKinds.has("private-endpoint"), true);
    assert.equal(historyKinds.has("secret"), true);
    assert.equal(historyKinds.has("artifact"), true);
  });
});
