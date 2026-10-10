import { badRequest } from "./errors.js";

// Tiny schema validator: check(input, { field: { type, required, min, max, enum, trim, default } })
export function check(input = {}, schema) {
  const out = {}, errors = {};
  for (const [key, rule] of Object.entries(schema)) {
    let v = input[key];
    if (v === undefined || v === null || v === "") {
      if (rule.required) errors[key] = "is required";
      else if (rule.default !== undefined) out[key] = rule.default;
      continue;
    }
    switch (rule.type || "string") {
      case "string": {
        if (typeof v !== "string") { errors[key] = "must be text"; break; }
        if (rule.trim !== false) v = v.trim();
        if (rule.lower) v = v.toLowerCase();
        if (rule.min && v.length < rule.min) errors[key] = `must be at least ${rule.min} characters`;
        else if (rule.max && v.length > rule.max) errors[key] = `must be at most ${rule.max} characters`;
        else if (rule.enum && !rule.enum.includes(v)) errors[key] = `must be one of: ${rule.enum.join(", ")}`;
        else if (rule.pattern && !rule.pattern.test(v)) errors[key] = rule.patternMessage || "has an invalid format";
        else out[key] = v;
        break;
      }
      case "number": {
        const n = typeof v === "string" ? Number(v.replace(/,/g, "")) : v;
        if (typeof n !== "number" || !Number.isFinite(n)) errors[key] = "must be a number";
        else if (rule.min !== undefined && n < rule.min) errors[key] = `must be at least ${rule.min}`;
        else if (rule.max !== undefined && n > rule.max) errors[key] = `must be at most ${rule.max}`;
        else if (rule.int && !Number.isInteger(n)) errors[key] = "must be a whole number";
        else out[key] = n;
        break;
      }
      case "date": {
        const d = new Date(v);
        if (Number.isNaN(d.getTime())) errors[key] = "must be a valid date";
        else out[key] = d.toISOString();
        break;
      }
      case "boolean": out[key] = v === true || v === "true"; break;
      default: out[key] = v;
    }
  }
  if (Object.keys(errors).length) throw badRequest("Validation failed", errors);
  return out;
}

export const EMAIL = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
export const PHONE = /^[+]?[0-9 ()-]{7,20}$/;
