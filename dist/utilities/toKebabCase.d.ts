/**
 * Convert a string to kebab-case.
 *
 * - Lowercases
 * - Replaces whitespace, underscores, and dots with hyphens
 * - Removes non-alphanumeric characters (except hyphens)
 * - Collapses consecutive hyphens
 * - Trims leading/trailing hyphens
 */
export declare const toKebabCase: (input: string) => string;
