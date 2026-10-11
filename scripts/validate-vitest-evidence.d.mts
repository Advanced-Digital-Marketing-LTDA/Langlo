export function parseVitestEvidence(source: string): {
  suiteCount: number;
  testCount: number;
  passedTestCount: number;
  failedTestCount: number;
  skippedTestCount: number;
};
