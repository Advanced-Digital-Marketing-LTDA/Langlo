import { readFile } from 'node:fs/promises';
import { describe, expect, it } from 'vitest';
import { parseLibraryDocument } from '../src/lib/server/library';
import { StudyError } from '../src/lib/server/study-error';

describe('Library document uploads', () => {
  it('accepts a 10 MiB upload and rejects a larger file', async () => {
    const bytes = 10 * 1024 * 1024;
    const file = new File(['Bonjour.', ' '.repeat(bytes - 8)], 'limit.txt');
    expect(file.size).toBe(bytes);
    await expect(parseLibraryDocument(file, 'fr')).resolves.toMatchObject({
      content: 'Bonjour.'
    });
    await expect(
      parseLibraryDocument(
        new File([new Uint8Array(bytes + 1)], 'large.txt'),
        'fr'
      )
    ).rejects.toMatchObject({ code: 'LIBRARY_FILE_TOO_LARGE' });
  });

  it('accepts the text ceiling and reports oversized TXT as too much content', async () => {
    await expect(
      parseLibraryDocument(new File(['a'.repeat(1_000_000)], 'limit.txt'), 'en')
    ).resolves.toMatchObject({ content: expect.stringMatching(/^a+$/u) });
    await expect(
      parseLibraryDocument(new File(['a'.repeat(1_000_001)], 'large.txt'), 'en')
    ).rejects.toMatchObject({ code: 'LIBRARY_CONTENT_TOO_LARGE' });
  });

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
