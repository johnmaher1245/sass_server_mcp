/**
 * Minimal chainable mock of a MongoDB collection for unit tests.
 *
 * Cursors ignore the filter/projection and return preset arrays — filter *construction*
 * is tested separately via the pure _build* helpers; these mocks validate response shaping
 * without needing a live database.
 */
export function mockCollection({ docs = [], count = null, one, agg = [] } = {}) {
    const countQueue = Array.isArray(count) ? [...count] : null;
    const cursor = (arr) => ({
        sort() { return this; },
        skip() { return this; },
        limit() { return this; },
        project() { return this; },
        async toArray() { return arr; },
    });
    return {
        find() { return cursor(docs); },
        async countDocuments() {
            if (countQueue) return countQueue.length ? countQueue.shift() : 0;
            return count === null ? docs.length : count;
        },
        async findOne() { return one === undefined ? (docs[0] ?? null) : one; },
        aggregate() { return cursor(agg); },
    };
}

/** Inject empty mocks for every collection a docket method might touch, then apply overrides. */
export function resetDocketCollections(svc, overrides = {}) {
    svc.isConnected = true;
    const empty = () => mockCollection({ docs: [] });
    svc.bkDocketEntries = overrides.bkDocketEntries || empty();
    svc.bkDocketPatternRules = overrides.bkDocketPatternRules || empty();
    svc.bkDischargeActionRules = overrides.bkDischargeActionRules || empty();
    svc.bkDismissedActionRules = overrides.bkDismissedActionRules || empty();
    svc.bkConvertedActionRules = overrides.bkConvertedActionRules || empty();
    svc.bkDismissedEntries = overrides.bkDismissedEntries || empty();
    svc.bkConvertedEntries = overrides.bkConvertedEntries || empty();
    svc.automationLogs = overrides.automationLogs || empty();
    svc.matters = overrides.matters || mockCollection({ one: null });
    svc.workflows = overrides.workflows || empty();
    svc.outstandingItemTemplates = overrides.outstandingItemTemplates || empty();
    svc.bkCases = overrides.bkCases || empty();
    svc.bkDistricts = overrides.bkDistricts || empty();
}
