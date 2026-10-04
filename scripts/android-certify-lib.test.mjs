import assert from "node:assert/strict";
import test from "node:test";
import {
  certificationSummary,
  overallCertificationStatus,
  parseAdbDevices,
  reportToJUnit
} from "./android-certify-lib.mjs";

test("parseAdbDevices returns only authorized devices", () => {
  assert.deepEqual(
    parseAdbDevices(
      "List of devices attached\nABC\tdevice product:x\nDEF\tunauthorized\nGHI\tdevice product:y\n"
    ),
    ["ABC", "GHI"]
  );
});

test("overallCertificationStatus prioritizes failures then manual checks", () => {
  assert.equal(
    overallCertificationStatus([{ status: "pass" }, { status: "manual" }]),
    "manual-required"
  );
  assert.equal(
    overallCertificationStatus([{ status: "manual" }, { status: "fail" }]),
    "failed"
  );
  assert.equal(overallCertificationStatus([{ status: "pass" }]), "passed");
});

test("JUnit output represents failures and manual checks", () => {
  const xml = reportToJUnit({
    checks: [
      { name: "connected", status: "pass", durationMs: 10 },
      { name: "audio quality", status: "manual", detail: "listen" },
      { name: "chat", status: "fail", detail: "missing message" }
    ]
  });
  assert.match(xml, /tests="3"/);
  assert.match(xml, /failures="1"/);
  assert.match(xml, /skipped="1"/);
  assert.match(xml, /<failure/);
  assert.match(xml, /<skipped/);
});

test("summary includes room and artifact path", () => {
  const summary = certificationSummary({
    status: "manual-required",
    roomId: "room",
    artifactDir: "artifacts/x",
    checks: [{ status: "pass" }, { status: "manual" }]
  });
  assert.match(summary, /Room: room/);
  assert.match(summary, /Pass: 1/);
  assert.match(summary, /Manual: 1/);
});
