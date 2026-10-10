import { db, newId, now } from "../db/index.js";
import { publish } from "./events.js";

export async function notify(userId, { type, title, message, metadata = {} }) {
  const doc = { _id: newId(), userId, type, title, message, metadata, read: false, createdAt: now() };
  doc.timestamp = doc.createdAt;
  await db("notifications").insert(doc);
  publish(userId, "notification", { id: doc._id, ...doc, _id: undefined });
  return doc;
}
