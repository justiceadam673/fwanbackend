// Offline driver: one JSON file per collection, held in memory, written atomically.
import fs from "node:fs";
import path from "node:path";
import { matches, sortDocs } from "./query.js";

class FileCollection {
  constructor(dir, name) {
    this.name = name;
    this.file = path.join(dir, `${name}.json`);
    this.docs = [];
    this.timer = null;
    if (fs.existsSync(this.file)) {
      try { this.docs = JSON.parse(fs.readFileSync(this.file, "utf8")); }
      catch { fs.copyFileSync(this.file, `${this.file}.corrupt-${Date.now()}`); this.docs = []; }
    }
  }
  _save() { clearTimeout(this.timer); this.timer = setTimeout(() => this.flush(), 60); }
  flush() {
    clearTimeout(this.timer);
    const tmp = `${this.file}.tmp`;
    fs.writeFileSync(tmp, JSON.stringify(this.docs));
    fs.renameSync(tmp, this.file);
  }
  async find(filter = {}, { sort, skip = 0, limit = 0 } = {}) {
    let out = sortDocs(this.docs.filter((d) => matches(d, filter)), sort);
    if (skip) out = out.slice(skip);
    if (limit) out = out.slice(0, limit);
    return structuredClone(out);
  }
  async findOne(filter) { const d = this.docs.find((x) => matches(x, filter)); return d ? structuredClone(d) : null; }
  async get(id) { return this.findOne({ _id: id }); }
  async count(filter = {}) { return this.docs.filter((d) => matches(d, filter)).length; }
  async insert(doc) {
    if (this.unique) for (const spec of this.unique) {
      if (this.docs.some((d) => spec.every((k) => d[k] !== undefined && d[k] === doc[k]))) {
        const e = new Error(`Duplicate key on ${this.name}(${spec.join(",")})`); e.code = 11000; throw e;
      }
    }
    this.docs.push(structuredClone(doc)); this._save(); return structuredClone(doc);
  }
  async findOneAndUpdate(filter, patch) {
    const d = this.docs.find((x) => matches(x, filter));
    if (!d) return null;
    Object.assign(d, structuredClone(patch)); this._save(); return structuredClone(d);
  }
  async update(id, patch) { return this.findOneAndUpdate({ _id: id }, patch); }
  async remove(id) { return (await this.removeWhere({ _id: id })) > 0; }
  async removeWhere(filter) {
    const before = this.docs.length;
    this.docs = this.docs.filter((d) => !matches(d, filter));
    if (this.docs.length !== before) this._save();
    return before - this.docs.length;
  }
  async clear() { this.docs = []; this.flush(); }
  async ensureIndex(spec, opts = {}) {
    if (opts.unique) { this.unique = this.unique || []; this.unique.push(Object.keys(spec)); }
  }
}

export function createFileDriver(dataDir) {
  fs.mkdirSync(dataDir, { recursive: true });
  const cache = new Map();
  return {
    kind: "file",
    location: dataDir,
    async connect() {},
    collection(name) {
      if (!cache.has(name)) cache.set(name, new FileCollection(dataDir, name));
      return cache.get(name);
    },
    async close() { for (const c of cache.values()) c.flush(); },
  };
}
