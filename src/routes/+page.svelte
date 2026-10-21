<script lang="ts">
  import { resolve } from '$app/paths';
</script>

<p class="eyebrow">A private place to practise grammar</p>
<h1>Language Grammar Coach</h1>
<p>
  Build confidence one grammar skill at a time, with clear explanations and
  review of the mistakes you choose to keep.
</p>
<nav class="auth-actions" aria-label="Account">
  <a class="button secondary" href={resolve('/login')}>Sign in</a>
  <a class="button" href={resolve('/signup')}>Sign up</a>
</nav>
<section aria-labelledby="scope">
  <h2 id="scope">Planned study tracks</h2>
  <ul>
    <li>French A1, with English explanations</li>
    <li>German A1 and A2, with English explanations</li>
    <li>English A1 and A2, with Brazilian Portuguese explanations</li>
  </ul>
  <p class="status">
    The local foundation is running. Accounts, prepared lessons, assessment and
    native flashcard study are still being built.
  </p>
</section>

<style>
  .auth-actions {
    display: flex;
    flex-wrap: wrap;
    gap: 0.8rem;
    margin-top: 1.5rem;
  }
  .button {
    display: inline-flex;
    align-items: center;
    justify-content: center;
    min-height: 44px;
    padding: 0.4rem 1.1rem;
    background: #1b5982;
    color: white;
    border: 1px solid #1b5982;
    border-radius: 0.6rem;
    text-decoration: none;
    font-weight: 650;
  }
  .secondary {
    background: white;
    color: #1b5982;
  }
  .eyebrow {
    color: #49617a;
    font-weight: 650;
  }
  section {
    margin-top: 2.5rem;
    padding: 1.5rem;
    background: white;
    border: 1px solid #d9e2ef;
    border-radius: 0.8rem;
    max-width: 48rem;
  }
  ul {
    padding-left: 1.3rem;
  }
  .status {
    border-top: 1px solid #d9e2ef;
    padding-top: 1rem;
    color: #49617a;
  }
</style>
