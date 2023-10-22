export const escapeHTML = (unsafe: string) =>
  unsafe
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;")
    .replace(/'/g, "&#039;");

export class ErrorWithStatusCode extends Error {
  constructor(message: string, public statusCode: number) {
    super(message);
  }
}
