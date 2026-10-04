export function parseAdbDevices(output) {
  return output
    .split(/\r?\n/)
    .slice(1)
    .map((line) => line.trim().split(/\s+/))
    .filter((parts) => parts[0] && parts[1] === "device")
    .map((parts) => parts[0]);
}

export function overallCertificationStatus(checks) {
  if (checks.some((check) => check.status === "fail")) return "failed";
  if (checks.some((check) => check.status === "manual")) return "manual-required";
  return "passed";
}

function xmlEscape(value) {
  return String(value)
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&apos;");
}

export function reportToJUnit(report) {
  const failures = report.checks.filter((check) => check.status === "fail").length;
  const skipped = report.checks.filter(
    (check) => check.status === "skip" || check.status === "manual"
  ).length;
  const cases = report.checks
    .map((check) => {
      const attrs =
        `name="${xmlEscape(check.name)}" classname="android.mvp" time="${(
          (check.durationMs ?? 0) / 1000
        ).toFixed(3)}"`;
      if (check.status === "fail") {
        return `  <testcase ${attrs}><failure message="${xmlEscape(
          check.detail ?? "failed"
        )}"/></testcase>`;
      }
      if (check.status === "skip" || check.status === "manual") {
        return `  <testcase ${attrs}><skipped message="${xmlEscape(
          check.detail ?? check.status
        )}"/></testcase>`;
      }
      return `  <testcase ${attrs}/>`;
    })
    .join("\n");

  return [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<testsuite name="Verge Android physical-device certification" tests="${report.checks.length}" failures="${failures}" skipped="${skipped}">`,
    cases,
    "</testsuite>",
    ""
  ].join("\n");
}

export function certificationSummary(report) {
  const counts = { pass: 0, fail: 0, skip: 0, manual: 0 };
  for (const check of report.checks) {
    counts[check.status] = (counts[check.status] ?? 0) + 1;
  }
  return [
    `Verge Android certification: ${report.status}`,
    `Room: ${report.roomId}`,
    `Pass: ${counts.pass} · Fail: ${counts.fail} · Skip: ${counts.skip} · Manual: ${counts.manual}`,
    `Artifacts: ${report.artifactDir}`
  ].join("\n");
}
