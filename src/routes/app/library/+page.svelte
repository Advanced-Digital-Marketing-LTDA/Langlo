<script lang="ts">
  import { enhance } from '$app/forms';
  import { languageNames } from '../../../lib/languageNames';
  import { libraryMaxFileBytes } from '../../../lib/library-text';
  import type { ActionData, PageData } from './$types';

  let { data, form }: { data: PageData; form: ActionData } = $props();
  const languages = Object.entries(languageNames);
  let fileError = $state('');
  const progress = (index: number, count: number) =>
    Math.round((index / count) * 100);
</script>

<svelte:head>
  <title>Library · Langlo</title>
  <meta name="robots" content="noindex,nofollow" />
</svelte:head>

<h1>Library</h1>
<p>Upload a document, read it sentence by sentence, and save useful words.</p>
{#if fileError}<p class="error-box" role="alert">{fileError}</p>
{:else if form?.message}<p class="error-box" role="alert">
    {form.message}
  </p>{/if}

<section aria-labelledby="upload-heading">
  <h2 id="upload-heading">Add a document</h2>
  <form
    method="POST"
    action="?/upload"
    enctype="multipart/form-data"
    use:enhance={({ formData, cancel }) => {
      const file = formData.get('file');
      if (file instanceof File && file.size > libraryMaxFileBytes) {
        fileError = 'Choose a file smaller than 10 MB.';
        cancel();
        return;
      }
      fileError = '';
    }}
  >
    <label>
      Document language
      <select name="language" required>
        <option value="" selected disabled>Choose a language</option>
        {#each languages as [code, name] (code)}
          <option value={code}>{name}</option>
        {/each}
      </select>
    </label>
    <label>
      File
      <input type="file" name="file" accept=".txt,.pdf,.docx,.epub" required />
    </label>
    <p>TXT, text-based PDF, DOCX, or EPUB. Maximum file size: 10 MB.</p>
    <button type="submit">Upload document</button>
  </form>
</section>

<section aria-labelledby="documents-heading">
  <h2 id="documents-heading">Your documents</h2>
  {#if data.documents.length}
    <ul>
      {#each data.documents as document (document.id)}
        <li>
          <p>
            <a href={`/app/library/${encodeURIComponent(document.id)}`}
              >{document.title}</a
            >
            · {languageNames[document.language] ?? document.language}
            · Uploaded {new Date(document.createdAt).toISOString().slice(0, 10)}
          </p>
          <p>
            Progress: {progress(
              document.progressIndex,
              document.sentenceCount
            )}% ({document.progressIndex} of {document.sentenceCount} sentences)
          </p>
          <form method="POST" action="?/rename" use:enhance>
            <input type="hidden" name="documentId" value={document.id} />
            <label>
              Rename
              <input
                name="title"
                value={document.title}
                maxlength="160"
                required
              />
            </label>
            <button type="submit">Save title</button>
          </form>
          <form method="POST" action="?/delete" use:enhance>
            <input type="hidden" name="documentId" value={document.id} />
            <button type="submit">Delete document</button>
          </form>
        </li>
      {/each}
    </ul>
  {:else}
    <p>No documents yet.</p>
  {/if}
</section>
