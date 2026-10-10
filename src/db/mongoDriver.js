// Online driver: MongoDB through Mongoose's connection (native collections, string _id values).
class MongoCollection {
  constructor(col) { this.col = col; }
  async find(filter = {}, { sort, skip = 0, limit = 0 } = {}) {
    let cur = this.col.find(filter);
    if (sort) cur = cur.sort(sort);
    if (skip) cur = cur.skip(skip);
    if (limit) cur = cur.limit(limit);
    return cur.toArray();
  }
  async findOne(filter) { return this.col.findOne(filter); }
  async get(id) { return this.col.findOne({ _id: id }); }
  async count(filter = {}) { return this.col.countDocuments(filter); }
  async insert(doc) { await this.col.insertOne(doc); return doc; }
  async findOneAndUpdate(filter, patch) {
    return this.col.findOneAndUpdate(filter, { $set: patch }, { returnDocument: "after" });
  }
  async update(id, patch) { return this.findOneAndUpdate({ _id: id }, patch); }
  async remove(id) { return (await this.col.deleteOne({ _id: id })).deletedCount > 0; }
  async removeWhere(filter) { return (await this.col.deleteMany(filter)).deletedCount; }
  async clear() { await this.col.deleteMany({}); }
  async ensureIndex(spec, opts) { await this.col.createIndex(spec, opts); }
}

export async function createMongoDriver(uri) {
  const { default: mongoose } = await import("mongoose");
  return {
    kind: "mongo",
    location: uri.replace(/\/\/[^@]*@/, "//***@"),
    async connect() {
      if (mongoose.connection.readyState === 1) return;
      await mongoose.connect(uri, { serverSelectionTimeoutMS: 8000 });
      this.location = `${mongoose.connection.host}/${mongoose.connection.name}`;
    },
    collection(name) { return new MongoCollection(mongoose.connection.collection(name)); },
    async close() { await mongoose.disconnect(); },
  };
}
