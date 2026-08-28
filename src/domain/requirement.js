const COMPARISON_PATTERN = /^(>=|<=|=)\s*(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)$/i;
const RANGE_PATTERN = /^(\d+(?:\.\d+)?)\s*(ps|ns|us|ms|s)\s*\.\.\s*(\d+(?:\.\d+)?)\s*\2$/i;

export const REQUIREMENT_DSL_FORMAT = '>= 20 ns, <= 40 ns, = 25 ns, or 20 ns..40 ns.';

export function parseRequirement(text) {
  if (typeof text !== 'string') return null;
  const source = text.trim().replaceAll('≥', '>=').replaceAll('≤', '<=');
  const comparison = source.match(COMPARISON_PATTERN);
  if (comparison) {
    return {
      kind: 'comparison',
      operator: comparison[1],
      value: Number(comparison[2]),
      unit: comparison[3].toLowerCase()
    };
  }
  const range = source.match(RANGE_PATTERN);
  if (range) {
    const min = Number(range[1]);
    const max = Number(range[3]);
    if (min > max) return null;
    return { kind: 'range', min, max, unit: range[2].toLowerCase() };
  }
  return null;
}
