/** Stand-in for `$app/forms` when server-rendering a page: enhancement is a browser-only concern. */
export const enhance = () => ({ destroy() {} });
