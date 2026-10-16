<script lang="ts">
  let {
    name,
    options,
    value = $bindable(''),
    describedby
  }: {
    name: string;
    options: readonly string[];
    value?: string;
    describedby?: string | undefined;
  } = $props();
</script>

<div class="options" role="radiogroup" aria-describedby={describedby}>
  {#each options as option (option)}
    <label class="option">
      <input type="radio" {name} value={option} bind:group={value} />
      <span>{option}</span>
    </label>
  {/each}
</div>

<style>
  .options {
    display: grid;
    gap: 0.5rem;
  }

  .option {
    align-items: center;
    border: 2px solid currentColor;
    border-radius: 0.5rem;
    display: flex;
    gap: 0.75rem;
    min-height: 3rem;
    padding: 0.5rem 0.75rem;
  }

  .option input {
    height: 1.25rem;
    width: 1.25rem;
  }
</style>
