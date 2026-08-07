import path from "node:path";

export const KIB = 1024;
export const TOTAL_RELEASE_RAW_KIB = 2048;

export const CHUNK_BUDGETS = Object.freeze([
  { id: "startup-js", pattern: /^(index|mountMainWindow)-[^.]+\.js$/, rawKib: 580, gzipKib: 155 },
  { id: "css", pattern: /\.css$/, rawKib: 350, gzipKib: 54 },
  { id: "large-route-js", pattern: /^(NeteasePage|SettingsPage)-.*\.js$/, rawKib: 180, gzipKib: 45 },
  { id: "route-js", pattern: /\.js$/, rawKib: 90, gzipKib: 30 }
]);

const normalizeRelativePath = (relativePath) => relativePath.replaceAll("\\", "/");

export const kib = (bytes) => bytes / KIB;

export const chunkBudgetFor = (relativePath) => {
  const fileName = path.posix.basename(normalizeRelativePath(relativePath));
  const match = CHUNK_BUDGETS.find((budget) => budget.pattern.test(fileName));
  if (!match) {
    throw new Error(`No bundle budget configured for ${relativePath}`);
  }
  return match;
};

export const debugArtifactReason = (relativePath) => {
  const normalized = normalizeRelativePath(relativePath).toLowerCase();
  const segments = normalized.split("/");

  if (normalized.endsWith(".map")) return "source map";
  if (normalized.endsWith(".pdb")) return "program database";
  if (normalized.endsWith(".debug")) return "debug symbols";
  if (normalized.endsWith(".dwo") || normalized.endsWith(".dwp")) {
    return "split debug symbols";
  }
  if (segments.some((segment) => segment.endsWith(".dsym"))) {
    return "debug symbol bundle";
  }
  return null;
};

export const evaluateReleaseInventory = (
  files,
  { totalRawKib = TOTAL_RELEASE_RAW_KIB } = {}
) => {
  const normalizedFiles = files.map((file) => ({
    ...file,
    relativePath: normalizeRelativePath(file.relativePath)
  }));
  const totalRawBytes = normalizedFiles.reduce((total, file) => total + file.rawBytes, 0);
  const totalBudgetBytes = totalRawKib * KIB;
  const chunks = normalizedFiles
    .filter((file) => /\.(?:js|css)$/i.test(file.relativePath))
    .map((file) => ({ ...file, budget: chunkBudgetFor(file.relativePath) }))
    .sort(
      (left, right) =>
        (right.gzipBytes ?? 0) - (left.gzipBytes ?? 0) ||
        left.relativePath.localeCompare(right.relativePath)
    );
  const chunkFailures = chunks.filter(
    (chunk) =>
      kib(chunk.rawBytes) > chunk.budget.rawKib ||
      kib(chunk.gzipBytes ?? 0) > chunk.budget.gzipKib
  );
  const forbiddenArtifacts = normalizedFiles.flatMap((file) => {
    const reason = debugArtifactReason(file.relativePath);
    return reason ? [{ ...file, reason }] : [];
  });
  const structuralFailures = [];

  if (!normalizedFiles.some((file) => file.relativePath === "index.html")) {
    structuralFailures.push("release input is missing index.html");
  }
  if (!chunks.some((chunk) => chunk.relativePath.endsWith(".js"))) {
    structuralFailures.push("release input contains no JavaScript chunks");
  }

  const totalFailure =
    totalRawBytes > totalBudgetBytes
      ? { actualBytes: totalRawBytes, budgetBytes: totalBudgetBytes }
      : null;
  const failureCount =
    chunkFailures.length +
    forbiddenArtifacts.length +
    structuralFailures.length +
    (totalFailure ? 1 : 0);

  return {
    chunks,
    chunkFailures,
    failureCount,
    forbiddenArtifacts,
    structuralFailures,
    totalBudgetBytes,
    totalFailure,
    totalRawBytes
  };
};
