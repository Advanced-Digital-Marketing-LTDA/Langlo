<script lang="ts">
  let {
    contentVersionId,
    questionId = null,
    submissionKey,
    actionUrl = '?/report'
  }: {
    contentVersionId: string;
    questionId?: string | null;
    submissionKey: string;
    actionUrl?: string;
  } = $props();
  const target = $derived(questionId ?? contentVersionId);
</script>

<details>
  <summary>Report a content issue</summary>
  <form method="POST" action={actionUrl}>
    <input type="hidden" name="contentVersionId" value={contentVersionId} />
    <input type="hidden" name="questionId" value={questionId ?? ''} />
    <input type="hidden" name="submissionKey" value={submissionKey} />
    <p>
      This report identifies {target}, version {contentVersionId}. It does not
      change the content or your score.
    </p>
    <label for={`category-${target}`}>What needs attention?</label>
    <select id={`category-${target}`} name="category"
      ><option value="unclear">Unclear wording</option><option
        value="incorrect-answer">Incorrect answer or explanation</option
      ><option value="other">Other content issue</option></select
    >
    <label for={`comment-${target}`}>Comment (optional)</label>
    <textarea
      id={`comment-${target}`}
      name="comment"
      maxlength="2000"
      aria-describedby={`limit-${target}`}></textarea>
    <p id={`limit-${target}`}>
      Up to 1000 characters. Include only information about the content.
    </p>
    <button type="submit">Send report</button>
  </form>
</details>

<style>
  form {
    display: grid;
    gap: 0.75rem;
    max-width: 42rem;
  }
  textarea {
    min-height: 6rem;
    resize: vertical;
  }
  select,
  textarea,
  button {
    font: inherit;
    max-width: 100%;
    min-height: 2.75rem;
  }
  p {
    overflow-wrap: anywhere;
  }
</style>
