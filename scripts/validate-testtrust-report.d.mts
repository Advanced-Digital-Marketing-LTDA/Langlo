export function parseTestTrustReport(
  source: string,
  options: {
    baseRef: string;
    expectedFileCount: number;
    cliExitCode: number;
    failThreshold: number;
  }
): {
  version: string;
  filesAnalyzed: number;
  findingCount: number;
  verdict: 'pass' | 'neutral' | 'fail';
  score: number;
};
