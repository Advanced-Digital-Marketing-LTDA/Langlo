import { parentPort, workerData } from 'node:worker_threads';
import { OfficeParser } from 'officeparser';

const controller = new AbortController();
const abortTimer = setTimeout(() => controller.abort(), 15_000);

try {
  const ast = await OfficeParser.parseOffice(Buffer.from(workerData.buffer), {
    fileType: workerData.extension,
    allowRemoteAssets: false,
    extractAttachments: false,
    ocr: false,
    ignoreNotes: true,
    ignoreComments: true,
    ignoreHeadersAndFooters: true,
    abortSignal: controller.signal,
    decompressionLimits: {
      maxUncompressedBytes: 20 * 1024 * 1024,
      maxZipEntries: 5000,
      maxTableCells: 250_000,
      maxXmlElements: 200_000,
      maxRawContentLength: 0,
      maxRepeatedContent: 2_000_000
    },
    pdfParserConfig: {
      separateProcess: true,
      processMemoryMb: 128,
      maxTimeMs: 5000,
      maxTextItems: 20_000,
      maxOperators: 100_000
    }
  });
  const { value } = await ast.to('text');
  parentPort.postMessage({ text: value });
} catch {
  parentPort.postMessage({
    code: controller.signal.aborted
      ? 'LIBRARY_PARSE_TIMEOUT'
      : 'INVALID_LIBRARY_DOCUMENT'
  });
} finally {
  clearTimeout(abortTimer);
}
