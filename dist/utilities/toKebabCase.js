/**
 * Convert a string to kebab-case.
 *
 * - Lowercases
 * - Replaces whitespace, underscores, and dots with hyphens
 * - Removes non-alphanumeric characters (except hyphens)
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 */ export const toKebabCase = (input)=>input.toLowerCase().replace(/[\s_.]+/g, '-').replace(/[^a-z0-9-]/g, '').replace(/-{2,}/g, '-').replace(/^-|-$/g, '');

//# sourceMappingURL=toKebabCase.js.map