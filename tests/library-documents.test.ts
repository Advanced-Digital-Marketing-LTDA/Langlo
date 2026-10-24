import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseLibraryDocument } from '../src/lib/server/library';
import { StudyError } from '../src/lib/server/study-error';

describe('Library document uploads', () => {
  it.each(['text.pdf', 'scanned.pdf'])(
    'rejects %s disguised as TXT',
    async (name) => {
      const file = new File(
        [await readFile(`tests/fixtures/library/${name}`)],
        'book.txt'
      );
      await expect(parseLibraryDocument(file, 'en')).rejects.toMatchObject({
        code: 'INVALID_LIBRARY_DOCUMENT'
      });
    }
  );

  it('extracts UTF-8 text and uses a safe filename title', async () => {
    const file = new File(['  Bonjour, monde.\r\nSalut.  '], '../bonjour.txt');

    await expect(parseLibraryDocument(file, 'fr')).resolves.toEqual({
      title: 'bonjour',
      language: 'fr',
      content: 'Bonjour, monde.\nSalut.'
    });
  });

  it('rejects unsupported file types with a learner-safe error', async () => {
    const file = new File(['not an ebook'], 'book.zip');

    await expect(parseLibraryDocument(file, 'en')).rejects.toMatchObject({
      code: 'INVALID_LIBRARY_FILE'
    });
  });

  it('rejects invalid UTF-8 instead of silently replacing characters', async () => {
    const file = new File([new Uint8Array([0xc3, 0x28])], 'broken.txt');

    await expect(parseLibraryDocument(file, 'en')).rejects.toBeInstanceOf(
      StudyError
    );
  });

  it.each(['text.pdf', 'document.docx', 'book.epub'])(
    'extracts readable text from %s',
    async (name) => {
      const file = new File(
        [await readFile(`tests/fixtures/library/${name}`)],
        name
      );

      const parsed = await parseLibraryDocument(file, 'fr');
      expect(parsed).toMatchObject({
        title: name.slice(0, name.lastIndexOf('.')),
        language: 'fr',
        content: expect.stringContaining('Bonjour')
      });
      expect(parsed.content).not.toContain('%PDF');
    }
  );

  it('rejects an image-only PDF with a clear document error', async () => {
    const file = new File(
      [await readFile('tests/fixtures/library/scanned.pdf')],
      'scanned.pdf'
    );

    await expect(parseLibraryDocument(file, 'en')).rejects.toMatchObject({
      code: 'INVALID_LIBRARY_DOCUMENT'
    });
  });
});
