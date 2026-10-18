// Stand-in for SvelteKit's `$app/state` when components are server-rendered
// outside a running app. Tests set the values through `setAppState`.
type AppStateGlobal = {
  __appState?: { pathname: string; navigatingTo: unknown };
};
const store = (): NonNullable<AppStateGlobal['__appState']> => {
  const holder = globalThis as AppStateGlobal;
  holder.__appState ??= { pathname: '/app', navigatingTo: null };
  return holder.__appState;
};
export const page = {
  get url() {
    return new URL(store().pathname, 'http://127.0.0.1');
  }
};
export const navigating = {
  get to() {
    return store().navigatingTo;
  }
};
export function setAppState(state: {
  pathname?: string;
  navigatingTo?: unknown;
}) {
  Object.assign(store(), {
    pathname: '/app',
    navigatingTo: null,
    ...state
  });
}
