import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { unzipSync } from "fflate";
import { assertPublicHttpUrl, fetchPublicHttp } from "../capabilities/network-safety.js";
import {
  atomicWritePrivateJson,
  ensurePrivateDirectory,
  openRegularFileNoFollow,
  readPrivateTextFile,
} from "../security/private-file.js";

const MAX_SKILL_FILE_BYTES = 2 * 1024 * 1024;
const MAX_SKILL_TOTAL_BYTES = 20 * 1024 * 1024;
const MAX_SKILL_FILES = 500;
const MAX_DOWNLOAD_BYTES = 8 * 1024 * 1024;
const MAX_SKILL_INDEX_BYTES = 2 * 1024 * 1024;

export interface InstalledSkill {
  name: string;
  description: string;
  source: string;
  enabled: boolean;
  sha256: string;
  files: number;
  bytes: number;
  installedAt: number;
  updatedAt: number;
}

interface SkillIndex {
  schemaVersion: 1;
  skills: InstalledSkill[];
}

export interface LoadedInstalledSkill extends InstalledSkill {
  content: string;
  filePath: string;
}

function skillName(value: string): string {
  const name = value.trim().toLowerCase();
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/.test(name)) {
    throw new Error("skill name must match [a-z0-9][a-z0-9_-]{0,63}");
  }
  return name;
}

function parseFrontmatter(content: string): { name: string; description: string } {
  const match = content.match(/^---\s*\n([\s\S]*?)\n---\s*(?:\n|$)/);
  if (!match) throw new Error("SKILL.md requires YAML frontmatter");
  const fields = new Map<string, string>();
  for (const line of match[1].split("\n")) {
    const row = line.match(/^([A-Za-z][A-Za-z0-9_-]*):\s*(.*?)\s*$/);
    if (!row) continue;
    fields.set(row[1].toLowerCase(), row[2].replace(/^['"]|['"]$/g, ""));
  }
  const name = skillName(fields.get("name") ?? "");
  const description = (fields.get("description") ?? "").trim();
  if (!description || description.length > 500) {
    throw new Error("SKILL.md frontmatter requires description (1-500 chars)");
  }
  return { name, description };
}

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return relative === "" || (!relative.startsWith("..") && !path.isAbsolute(relative));
}

function hashDirectory(root: string): { sha256: string; files: number; bytes: number } {
  const hash = crypto.createHash("sha256");
  let files = 0;
  let bytes = 0;
  const walk = (dir: string) => {
    const entries = fs.readdirSync(dir, { withFileTypes: true }).sort((a, b) => a.name.localeCompare(b.name));
    for (const entry of entries) {
      const absolute = path.join(dir, entry.name);
      if (entry.isSymbolicLink()) throw new Error("skill packages cannot contain symbolic links");
      if (entry.isDirectory()) {
        walk(absolute);
        continue;
      }
      if (!entry.isFile()) throw new Error("skill packages may contain only regular files");
      const opened = openRegularFileNoFollow(absolute);
      let data: Buffer;
      try {
        if (opened.stat.size > MAX_SKILL_FILE_BYTES) throw new Error(`skill file exceeds ${MAX_SKILL_FILE_BYTES} bytes`);
        data = fs.readFileSync(opened.descriptor);
      } finally {
        fs.closeSync(opened.descriptor);
      }
      files += 1;
      bytes += data.byteLength;
      if (files > MAX_SKILL_FILES || bytes > MAX_SKILL_TOTAL_BYTES) throw new Error("skill package exceeds safe size limits");
      const relative = path.relative(root, absolute).split(path.sep).join("/");
      hash.update(relative).update("\0").update(data).update("\0");
    }
  };
  walk(root);
  return { sha256: hash.digest("hex"), files, bytes };
}

function copyPackage(source: string, target: string): void {
  const sourceRoot = fs.realpathSync(source);
  const walk = (from: string, to: string) => {
    ensurePrivateDirectory(to);
    for (const entry of fs.readdirSync(from, { withFileTypes: true })) {
      const sourcePath = path.join(from, entry.name);
      const targetPath = path.join(to, entry.name);
      if (entry.isSymbolicLink()) throw new Error("skill packages cannot contain symbolic links");
      if (entry.isDirectory()) walk(sourcePath, targetPath);
      else if (entry.isFile()) {
        fs.copyFileSync(sourcePath, targetPath, fs.constants.COPYFILE_EXCL);
        fs.chmodSync(targetPath, 0o600);
      }
      else throw new Error("skill packages may contain only regular files");
    }
  };
  if (!inside(sourceRoot, fs.realpathSync(sourceRoot))) throw new Error("invalid skill source");
  walk(sourceRoot, target);
}

async function fetchBytes(url: string): Promise<Uint8Array> {
  let current = (await assertPublicHttpUrl(url)).toString();
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetchPublicHttp(current, { redirect: "manual", signal: AbortSignal.timeout(20_000) });
    if (response.status >= 300 && response.status < 400) {
      const location = response.headers.get("location");
      if (!location) throw new Error("skill download redirect has no location");
      current = (await assertPublicHttpUrl(new URL(location, current).toString())).toString();
      continue;
    }
    if (!response.ok || !response.body) throw new Error(`skill download failed: HTTP ${response.status}`);
    const declared = Number(response.headers.get("content-length") ?? "0");
    if (declared > MAX_DOWNLOAD_BYTES) throw new Error("skill download is too large");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let total = 0;
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      total += value.byteLength;
      if (total > MAX_DOWNLOAD_BYTES) throw new Error("skill download is too large");
      chunks.push(value);
    }
    const out = new Uint8Array(total);
    let offset = 0;
    for (const chunk of chunks) { out.set(chunk, offset); offset += chunk.byteLength; }
    return out;
  }
  throw new Error("skill download exceeded redirect limit");
}

function assertArchiveBounds(buffer: Uint8Array): void {
  const view = Buffer.from(buffer.buffer, buffer.byteOffset, buffer.byteLength);
  let entries = 0;
  for (let offset = 0; offset + 46 <= view.length;) {
    if (view.readUInt32LE(offset) !== 0x02014b50) { offset += 1; continue; }
    if (view.readUInt32LE(offset + 24) === 0xffffffff) throw new Error("ZIP64 skill archives are not supported");
    entries += 1;
    if (entries > 50_000) throw new Error("skill repository archive has too many entries");
    offset += 46 + view.readUInt16LE(offset + 28) + view.readUInt16LE(offset + 30) + view.readUInt16LE(offset + 32);
  }
  if (entries === 0) throw new Error("skill archive has no valid ZIP directory");
}

function githubTreeSource(source: string): { archiveUrl: string; suffix: string } | null {
  const url = new URL(source);
  if (url.hostname.toLowerCase() !== "github.com") return null;
  const parts = url.pathname.split("/").filter(Boolean);
  if (parts.length < 5 || parts[2] !== "tree") return null;
  const [owner, repo, , ref, ...folder] = parts;
  if (!/^[A-Za-z0-9_.-]+$/.test(owner) || !/^[A-Za-z0-9_.-]+$/.test(repo) || !/^[A-Za-z0-9_.-]+$/.test(ref)) {
    throw new Error("unsupported GitHub owner/repo/ref");
  }
  return {
    archiveUrl: `https://codeload.github.com/${owner}/${repo}/zip/${encodeURIComponent(ref)}`,
    suffix: folder.join("/"),
  };
}

async function materializeSource(source: string, tempRoot: string): Promise<string> {
  const local = path.resolve(source);
  if (!/^https?:\/\//i.test(source)) {
    if (fs.lstatSync(local).isSymbolicLink()) throw new Error("skill source itself cannot be a symbolic link");
    const stat = fs.statSync(local);
    if (stat.isFile() && path.basename(local).toLowerCase() === "skill.md") {
      const root = path.join(tempRoot, "package");
      ensurePrivateDirectory(root);
      const target = path.join(root, "SKILL.md");
      fs.copyFileSync(local, target);
      fs.chmodSync(target, 0o600);
      return root;
    }
    if (!stat.isDirectory()) throw new Error("local skill source must be a directory or SKILL.md");
    return local;
  }
  const tree = githubTreeSource(source);
  if (tree) {
    const archive = await fetchBytes(tree.archiveUrl);
    assertArchiveBounds(archive);
    let selectedFiles = 0;
    let selectedBytes = 0;
    const files = unzipSync(archive, {
      filter(file) {
        const parts = file.name.split("/");
        const relative = parts.slice(1).join("/");
        const selected = tree.suffix
          ? relative === tree.suffix || relative.startsWith(`${tree.suffix}/`)
          : true;
        if (!selected || file.name.endsWith("/")) return false;
        selectedFiles += 1;
        selectedBytes += file.originalSize;
        if (selectedFiles > MAX_SKILL_FILES || selectedBytes > MAX_SKILL_TOTAL_BYTES || file.originalSize > MAX_SKILL_FILE_BYTES) {
          throw new Error("selected skill folder exceeds safe expansion limits");
        }
        return true;
      },
    });
    const root = path.join(tempRoot, "package");
    ensurePrivateDirectory(root);
    const names = Object.keys(files);
    const prefix = names[0]?.split("/")[0] ?? "";
    const wanted = tree.suffix ? `${prefix}/${tree.suffix}/` : `${prefix}/`;
    for (const name of names) {
      if (!name.startsWith(wanted) || name.endsWith("/")) continue;
      const relative = name.slice(wanted.length);
      if (!relative || relative.split("/").some((part) => part === ".." || part === "")) continue;
      const target = path.join(root, relative);
      if (!inside(root, target)) throw new Error("skill archive path escapes package root");
      ensurePrivateDirectory(path.dirname(target));
      fs.writeFileSync(target, files[name], { mode: 0o600 });
    }
    return root;
  }
  const url = new URL(source);
  if (url.hostname.toLowerCase() === "raw.githubusercontent.com" && path.basename(url.pathname).toLowerCase() === "skill.md") {
    const root = path.join(tempRoot, "package");
    ensurePrivateDirectory(root);
    fs.writeFileSync(path.join(root, "SKILL.md"), await fetchBytes(source), { mode: 0o600 });
    return root;
  }
  throw new Error("remote skill source must be a GitHub tree URL or raw SKILL.md URL");
}

export class SkillStore {
  readonly root: string;
  private readonly indexPath: string;

  constructor(dataDir: string) {
    this.root = path.join(dataDir, "skills");
    this.indexPath = path.join(this.root, "index.json");
    ensurePrivateDirectory(this.root);
  }

  private readIndex(): SkillIndex {
    let raw: string;
    try {
      raw = readPrivateTextFile(this.indexPath, MAX_SKILL_INDEX_BYTES, true).text;
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code === "ENOENT") {
        return { schemaVersion: 1, skills: [] };
      }
      throw error;
    }
    const row = JSON.parse(raw) as SkillIndex;
    if (row?.schemaVersion !== 1 || !Array.isArray(row.skills)) {
      throw new Error("skill index has an unsupported or malformed schema");
    }
    return row;
  }

  private writeIndex(index: SkillIndex): void {
    atomicWritePrivateJson(this.indexPath, index, MAX_SKILL_INDEX_BYTES);
  }

  list(): InstalledSkill[] {
    return this.readIndex().skills.slice().sort((a, b) => a.name.localeCompare(b.name));
  }

  loadEnabled(): LoadedInstalledSkill[] {
    return this.list().filter((row) => row.enabled).map((row) => {
      const dir = path.join(this.root, row.name);
      const measured = hashDirectory(dir);
      if (measured.sha256 !== row.sha256 || measured.files !== row.files || measured.bytes !== row.bytes) {
        throw new Error(`installed skill '${row.name}' failed integrity verification`);
      }
      const filePath = path.join(dir, "SKILL.md");
      const content = readPrivateTextFile(filePath, MAX_SKILL_FILE_BYTES).text;
      const parsed = parseFrontmatter(content);
      if (parsed.name !== row.name || parsed.description !== row.description) {
        throw new Error(`installed skill '${row.name}' metadata does not match its receipt`);
      }
      return { ...row, content, filePath };
    });
  }

  inspect(name: string): LoadedInstalledSkill | null {
    const normalized = skillName(name);
    const row = this.list().find((skill) => skill.name === normalized);
    if (!row) return null;
    const dir = path.join(this.root, row.name);
    const measured = hashDirectory(dir);
    if (measured.sha256 !== row.sha256 || measured.files !== row.files || measured.bytes !== row.bytes) {
      throw new Error(`installed skill '${row.name}' failed integrity verification`);
    }
    const filePath = path.join(dir, "SKILL.md");
    const content = readPrivateTextFile(filePath, MAX_SKILL_FILE_BYTES).text;
    const parsed = parseFrontmatter(content);
    if (parsed.name !== row.name || parsed.description !== row.description) throw new Error(`installed skill '${row.name}' metadata does not match its receipt`);
    return { ...row, content, filePath };
  }

  async install(source: string): Promise<InstalledSkill> {
    const tempRoot = fs.mkdtempSync(path.join(os.tmpdir(), "penglai-skill-"));
    let staging: string | null = null;
    try {
      const materialized = await materializeSource(source.trim(), tempRoot);
      const skillFile = path.join(materialized, "SKILL.md");
      let skillText: string;
      try {
        skillText = readPrivateTextFile(skillFile, MAX_SKILL_FILE_BYTES).text;
      } catch (error) {
        if ((error as NodeJS.ErrnoException).code === "ENOENT") {
          throw new Error("skill package has no SKILL.md at its root");
        }
        throw error;
      }
      const parsed = parseFrontmatter(skillText);
      staging = path.join(this.root, `.staging-${parsed.name}-${crypto.randomBytes(4).toString("hex")}`);
      copyPackage(materialized, staging);
      const measured = hashDirectory(staging);
      const target = path.join(this.root, parsed.name);
      if (fs.existsSync(target)) throw new Error(`skill '${parsed.name}' is already installed; remove it before reinstalling`);
      fs.renameSync(staging, target);
      staging = null;
      const now = Date.now();
      const row: InstalledSkill = { ...parsed, source, enabled: true, ...measured, installedAt: now, updatedAt: now };
      const index = this.readIndex();
      index.skills.push(row);
      this.writeIndex(index);
      return row;
    } finally {
      if (staging && fs.existsSync(staging)) fs.rmSync(staging, { recursive: true, force: true });
      fs.rmSync(tempRoot, { recursive: true, force: true });
    }
  }

  setEnabled(name: string, enabled: boolean): InstalledSkill {
    const normalized = skillName(name);
    const index = this.readIndex();
    const row = index.skills.find((skill) => skill.name === normalized);
    if (!row) throw new Error(`skill not found: ${normalized}`);
    row.enabled = enabled;
    row.updatedAt = Date.now();
    this.writeIndex(index);
    return row;
  }

  remove(name: string): boolean {
    const normalized = skillName(name);
    const index = this.readIndex();
    const next = index.skills.filter((skill) => skill.name !== normalized);
    if (next.length === index.skills.length) return false;
    const target = path.join(this.root, normalized);
    const realRoot = fs.realpathSync(this.root);
    if (fs.existsSync(target)) {
      const stat = fs.lstatSync(target);
      if (stat.isSymbolicLink() || !stat.isDirectory()) throw new Error("installed skill path is not a safe directory");
      const realTarget = fs.realpathSync(target);
      if (!inside(realRoot, realTarget) || path.dirname(realTarget) !== realRoot) throw new Error("installed skill path escapes store root");
      fs.rmSync(realTarget, { recursive: true });
    }
    index.skills = next;
    this.writeIndex(index);
    return true;
  }
}
