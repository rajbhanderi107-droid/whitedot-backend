import assert from "node:assert/strict";
import { after, test } from "node:test";
import express from "express";
import jwt from "jsonwebtoken";

process.env.NODE_ENV = "test";
process.env.DATABASE_URL = "postgresql://unused:unused@127.0.0.1:1/unused";
process.env.JWT_SECRET = "unit-test-only-secret-not-a-production-credential";
let role = "SUPER_ADMIN";
let active = true;
let revoked = false;
let sourceCalls = 0;
let sourceMode = "ok";
(globalThis as any).prisma = {
  $connect: async () => {},
  user: { findUnique: async () => ({ id: "test-user", name: "Test", email: "test@example.invalid", role, isActive: active }), findMany: async () => [] },
  revokedToken: { findUnique: async () => revoked ? { id: "revoked" } : null },
  activityLog: { create: async () => ({}) },
  notification: { createMany: async () => ({ count: 0 }) },
};
const product = {
  id: "bobbin", index: "01", name: "Bobbin", mixRatio: "40% LIMEX + 60% PP",
  composition: [{ name: "LIMEX", pct: 40 }, { name: "PP", pct: 60 }],
  specs: [{ label: "Material", value: "LIMEX + PP", verified: true, source: "source" }],
};
const database = { _meta: {}, sources: { source: "Trusted test source" }, products: {
  bobbin: product, teaJarCap: { id: "teaJarCap", name: "Tea Jar Cap", tdsAvailable: false, specs: [], composition: [] },
} };
const nativeFetch = globalThis.fetch;
globalThis.fetch = async (input, init) => {
  if (String(input).startsWith("https://raw.githubusercontent.com/")) {
    assert.equal(String(input), "https://raw.githubusercontent.com/rajbhanderi107-droid/whitedot-limex.in/main/public/case-study/data/specs.json");
    assert.equal(init?.redirect, "error");
    assert.ok(init?.signal);
    sourceCalls++;
    if (sourceMode === "error") return new Response("Unavailable", { status: 503 });
    if (sourceMode === "invalid") return new Response("{}", { status: 200 });
    return new Response(JSON.stringify(database), { status: 200 });
  }
  return nativeFetch(input, init);
};
const { default: router } = await import("../src/routes/caseStudyTds.routes.js");
const { errorHandler } = await import("../src/middleware/error.middleware.js");
const app = express();
app.use("/api/case-study-tds", router);
app.use(errorHandler);
const server = app.listen(0, "127.0.0.1");
await new Promise<void>(resolve => server.once("listening", resolve));
const address = server.address() as { port: number };
const url = `http://127.0.0.1:${address.port}/api/case-study-tds/`;
const token = jwt.sign({ userId: "test-user", role: "SUPER_ADMIN", jti: "valid-test-jti" }, process.env.JWT_SECRET, { expiresIn: 3600 });
function request(id = "bobbin", bearer: string | null = token) {
  return fetch(url + id, { headers: bearer ? { Authorization: `Bearer ${bearer}` } : {} });
}
after(async () => { globalThis.fetch = nativeFetch; await new Promise<void>(resolve => server.close(() => resolve())); });

test("anonymous and forged requests fail before source fetch", async () => {
  assert.equal((await request("bobbin", null)).status, 401);
  assert.equal((await request("bobbin", "forged.jwt.value")).status, 401);
  assert.equal(sourceCalls, 0);
});
test("all lower DB roles rejected even with SUPER_ADMIN token claim", async () => {
  for (const lower of ["ADMIN", "SALES", "OPERATIONS", "VIEWER", "EMPLOYEE"]) {
    role = lower;
    const res = await request();
    assert.equal(res.status, 403, lower);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
  }
  role = "SUPER_ADMIN";
  assert.equal(sourceCalls, 0);
});
test("inactive and revoked accounts rejected", async () => {
  active = false;
  assert.equal((await request()).status, 401);
  active = true; revoked = true;
  assert.equal((await request()).status, 401);
  revoked = false;
  assert.equal(sourceCalls, 0);
});
test("expired and legacy tokens rejected", async () => {
  const expired = jwt.sign({ userId: "test-user", jti: "expired" }, process.env.JWT_SECRET!, { expiresIn: -1 });
  const legacy = jwt.sign({ userId: "test-user" }, process.env.JWT_SECRET!);
  assert.equal((await request("bobbin", expired)).status, 401);
  assert.equal((await request("bobbin", legacy)).status, 401);
});
test("superadmin receives real non-cacheable PDF and source fetch is shared", async () => {
  const responses = await Promise.all([request(), request()]);
  for (const res of responses) {
    assert.equal(res.status, 200);
    assert.match(res.headers.get("content-type")!, /application\/pdf/);
    assert.match(res.headers.get("content-disposition")!, /^attachment; filename="White-Dot-TDS-Bobbin/);
    assert.equal(res.headers.get("cache-control"), "private, no-store");
    assert.match(res.headers.get("vary")!, /Authorization/);
    const body = Buffer.from(await res.arrayBuffer());
    assert.equal(body.subarray(0, 5).toString(), "%PDF-");
    assert.ok(body.includes(Buffer.from("TECHNICAL DATA SHEET")));
    assert.ok(body.includes(Buffer.from("Trusted test source")));
  }
  assert.equal(sourceCalls, 1);
});
test("unknown and unavailable technical data return404, prototype keys cannot resolve", async () => {
  for (const id of ["unknown", "teaJarCap", "constructor", "__proto__"]) assert.equal((await request(id)).status, 404, id);
});

test("source outages and invalid schemas fail closed after cache expires", async () => {
  const now = Date.now;
  Date.now = () => now() + 120000;
  try {
    for (const mode of ["error", "invalid"]) {
      sourceMode = mode;
      const res = await request();
      assert.equal(res.status, 503);
      assert.equal(res.headers.get("cache-control"), "private, no-store");
      assert.equal((await res.json()).error.code, "TDS_UNAVAILABLE");
    }
  } finally {
    Date.now = now;
    sourceMode = "ok";
  }
});


test("credentialed CORS allows exact trusted origins and rejects deceptive prefixes", async () => {
  const { isAllowedOrigin } = await import("../src/config/cors.js");
  assert.equal(isAllowedOrigin("https://whitedotindia.in"), true);
  assert.equal(isAllowedOrigin("https://www.whitedotindia.in"), true);
  assert.equal(isAllowedOrigin("https://whitedotindia.in.attacker.example"), false);
  assert.equal(isAllowedOrigin("https://whitedotindia.in@attacker.example"), false);
  assert.equal(isAllowedOrigin("https://www.whitedotindia.in.evil.test"), false);
  assert.equal(isAllowedOrigin("https://attacker.example"), false);
});
