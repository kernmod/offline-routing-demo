const ACCEPTED_UNPATCHED = new Set([1138808, 1138809]);
const BUILD_ONLY_PATH = /^apps__mobile>expo>@expo\/metro>metro>image-size$/;

function paths(advisory) {
  return (advisory.findings ?? []).flatMap((finding) => finding.paths ?? []);
}

function isAcceptedUnpatched(advisory) {
  const advisoryPaths = paths(advisory);
  return (
    ACCEPTED_UNPATCHED.has(Number(advisory.id)) &&
    advisory.module_name === "image-size" &&
    advisory.severity === "high" &&
    advisory.patched_versions === "<0.0.0" &&
    advisoryPaths.length > 0 &&
    advisoryPaths.every((path) => BUILD_ONLY_PATH.test(path))
  );
}

export function evaluateDependencyAudit(report) {
  const advisories = Object.values(report?.advisories ?? {});
  const accepted = [];
  const blocking = [];
  for (const advisory of advisories) {
    if (advisory.severity !== "high" && advisory.severity !== "critical") continue;
    if (isAcceptedUnpatched(advisory)) accepted.push(advisory);
    else blocking.push(advisory);
  }
  accepted.sort((left, right) => Number(left.id) - Number(right.id));
  return { accepted, blocking };
}
