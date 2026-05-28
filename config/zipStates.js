// ZIP3 (first three digits) → US state, via the standard USPS prefix allocation.
//
// EXHAUSTIVE/guaranteed for the firm's operating states: OH = 430–459, MI = 480–499.
// Immediate neighbors are included; anything else returns null ("other/unknown").
//
// ZIP is a STRONG residence signal — unlike a phone number, a ZIP on file reflects where the
// client actually lives and doesn't "port" when they move (they get a new one). It also feeds
// the federal district (county-level) when paired with us_court_districts. So ZIP→state ranks
// ABOVE phone in resolveState() (see services/queries/states.js). Read-only reference data.

// Inclusive integer ZIP3 ranges: [min, max, state]. Non-overlapping.
export const ZIP3_RANGES = [
    [150, 196, 'PA'],
    [247, 268, 'WV'],
    [400, 427, 'KY'],
    [430, 459, 'OH'],
    [460, 479, 'IN'],
    [480, 499, 'MI'],
    [530, 549, 'WI'],
    [600, 629, 'IL'],
];

// First three digits of a ZIP, or null if there aren't enough digits.
export function zip3(rawZip) {
    if (!rawZip) return null;
    const digits = String(rawZip).replace(/\D/g, '');
    if (digits.length < 3) return null;
    return digits.slice(0, 3);
}

// Resolve a postal code to a 2-letter state, or null if the prefix isn't in a mapped range.
export function zipToState(rawZip) {
    const z3 = zip3(rawZip);
    if (z3 === null) return null;
    const n = parseInt(z3, 10);
    if (Number.isNaN(n)) return null;
    for (const [min, max, state] of ZIP3_RANGES) {
        if (n >= min && n <= max) return state;
    }
    return null;
}

export default { ZIP3_RANGES, zip3, zipToState };
