function refs(value) {
  return String(value).trim().split(/\r?\n/).filter(Boolean)
    .map((line) => line.trim().split(/\s+/)).filter(([, name]) => name?.startsWith("refs/") && !name.endsWith("^{}"));
}

export function assertEmptyProjectTarget({ refsOutput, commitCount, files }) {
  const references = refs(refsOutput);
  if (references.some(([, name]) => !name.startsWith("refs/heads/")) || references.length > 1) {
    throw new Error("The selected target project has tags or multiple branches and cannot be reused as an empty project");
  }
  if (!Number.isInteger(commitCount) || commitCount < 0 || commitCount > 1 || files.length > 1) {
    throw new Error("The selected target project already contains work or history; migration will not overwrite it");
  }
  for (const file of files) {
    if (!/\.prjpcb$/i.test(file.path)) {
      throw new Error(`The selected target project is not empty: ${file.path}`);
    }
    const bytes = Buffer.from(file.bytes);
    const text = bytes.toString(bytes[0] === 0xff && bytes[1] === 0xfe ? "utf16le" : "latin1");
    if (/^\[(?:Document\d+|ManagedOutputJobs\d+)\]/im.test(text)) {
      throw new Error("The selected target project already references documents or output jobs");
    }
  }
  return { empty: true, commitCount, refsOutput };
}

export function guardedProjectMirrorArgs(repositoryUrl, sourceRefs, expectedTargetRefs) {
  const expected = new Map(refs(expectedTargetRefs).map(([sha, name]) => [name, sha]));
  const source = new Map(refs(sourceRefs).map(([sha, name]) => [name, sha]));
  const names = new Set([...expected.keys(), ...source.keys()]);
  // --mirror implies unconditional force and bypasses leases. Explicit
  // refspecs plus an atomic push preserve the same refs with concurrency checks.
  return ["push", "--atomic", ...[...names].map((name) =>
    `--force-with-lease=${name}:${expected.get(name) || ""}`), repositoryUrl,
  ...[...names].map((name) => `${source.get(name) || ""}:${name}`)];
}

export function assertProjectTargetUnchanged(expected, actual) {
  const normalized = (value) => refs(value).map((entry) => entry.join(" ")).sort().join("\n");
  if (normalized(expected) !== normalized(actual)) {
    throw new Error("The target project changed after its empty-project check; reload the analysis before migrating");
  }
}

export function emptyTargetDefaultBranchAlias(sourceRefs, targetRefs, sourceHead) {
  const targetBranches = refs(targetRefs).filter(([, name]) => name.startsWith("refs/heads/"));
  if (targetBranches.length !== 1) return null;
  const name = targetBranches[0][1];
  if (refs(sourceRefs).some(([, ref]) => ref === name)) return null;
  return { name, sha: sourceHead.trim() };
}
