// Keep the original administrator-protected endpoint for compatibility while
// serving the UI from a path that is less likely to be mistaken for analytics.
export { POST } from "../collect/route";
