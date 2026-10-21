// True once the learner app's scripts are running in the browser. The server
// renders it false, so controls that need the scripts start disabled instead
// of posting a plain form that reloads the page.
export const hydration = $state({ ready: false });
