// Static NANP area-code → US state reference for the States / Geographic MCP section.
//
// EXHAUSTIVE for the firm's operating states (MI, OH) — these must be correct because the
// OH-vs-MI split is the whole point. Immediate neighbors (IN, IL, KY, WV, PA, WI) are
// included so out-of-region numbers get a sensible label; any code not listed resolves to
// null, which the tools report as "other/unknown" rather than guessing.
//
// IMPORTANT: a phone number does NOT carry residence the way an address does — people keep
// their cell number when they move across state lines, and overlay codes muddy things. So
// phone area code is a FALLBACK signal only (see resolveState() priority in
// services/queries/states.js). Read-only reference data, no DB access.

export const AREA_CODES_BY_STATE = {
    MI: ['231', '248', '269', '313', '517', '586', '616', '679', '734', '810', '906', '947', '989'],
    OH: ['216', '220', '234', '283', '326', '330', '380', '419', '440', '513', '567', '614', '740', '937'],
    // Neighbors — best-effort, for nicer "other" breakdown only
    IN: ['219', '260', '317', '463', '574', '765', '812', '930'],
    IL: ['217', '224', '309', '312', '331', '447', '464', '618', '630', '708', '773', '779', '815', '847', '872'],
    KY: ['270', '364', '502', '606', '859'],
    WV: ['304', '681'],
    PA: ['215', '223', '267', '272', '412', '445', '484', '570', '582', '610', '717', '724', '814', '835', '878'],
    WI: ['262', '274', '414', '534', '608', '715', '920'],
};

// Reverse index: areaCode (string) -> 2-letter state
export const STATE_BY_AREA_CODE = {};
for (const [state, codes] of Object.entries(AREA_CODES_BY_STATE)) {
    for (const code of codes) STATE_BY_AREA_CODE[code] = state;
}

// Extract the 3-digit area code from a phone in any format (E.164, national, punctuated).
// Returns null when the input isn't a recognizable 10-digit NANP number (e.g. a foreign
// number, a short code, or junk) so we never misclassify it.
export function extractAreaCode(rawPhone) {
    if (!rawPhone) return null;
    const digits = String(rawPhone).replace(/\D/g, '');
    if (digits.length === 11 && digits.startsWith('1')) return digits.slice(1, 4);
    if (digits.length === 10) return digits.slice(0, 3);
    return null;
}

// Resolve a phone number to a 2-letter state, or null if the area code isn't mapped.
export function areaCodeToState(rawPhone) {
    const code = extractAreaCode(rawPhone);
    if (!code) return null;
    return STATE_BY_AREA_CODE[code] || null;
}

export default { AREA_CODES_BY_STATE, STATE_BY_AREA_CODE, extractAreaCode, areaCodeToState };
