export const SECURITY_SCORE_WEIGHTS = Object.freeze({
    public: 40,
    external: 20,
    stale: 15,
    other: 15,
    duplicates: 10,
});

const clampScore = (value) => Math.max(0, Math.min(100, Math.round(value)));
const isFolder = (file) => Boolean(file?.mimeType?.includes('folder'));

export function calculateScoreTotals(deductions) {
    const riskScore = clampScore(Object.values(deductions || {}).reduce((total, deduction) => total + (Number(deduction) || 0), 0));
    return { riskScore, securityScore: 100 - riskScore };
}

/**
 * Canonical Dashboard score calculation. Each factor is rounded exactly once,
 * then Security Score and Risk Score are complementary integers.
 */
export function calculateSecurityScore(files, { isStale, countDuplicateGroups } = {}) {
    const list = Array.isArray(files) ? files : [];
    const totalFiles = list.length;
    const denominator = totalFiles || 1;
    const folderIds = new Set(list.filter(isFolder).map(file => file.id));
    const parentIds = new Set();
    list.forEach(file => (file.parents || []).forEach(parentId => parentIds.add(parentId)));

    const publicCount = list.filter(file =>
        file.ownedByMe && !file.trashed && (file.permissions || []).some(permission => permission.type === 'anyone')
    ).length;
    // Dashboard currently exposes this factor but assigns no external-share deduction.
    const externalCount = 0;
    const staleCount = list.filter(file => !file.trashed && Boolean(isStale?.(file))).length;
    const rootLevelCount = list.filter(file =>
        file.parents?.length > 0 && !folderIds.has(file.parents[0]) && file.ownedByMe && !file.trashed && !isFolder(file)
    ).length;
    const emptyCount = list.filter(file => isFolder(file) && !file.trashed && !parentIds.has(file.id)).length;
    const orphanCount = list.filter(file =>
        (!file.parents || !file.parents.length) && !file.trashed && file.ownedByMe && !file.shared && !isFolder(file)
    ).length;
    const trashCount = list.filter(file => file.trashed).length;
    const duplicateGroups = Number(countDuplicateGroups?.(list)) || 0;

    const severity = {
        public: publicCount / denominator,
        external: externalCount / denominator,
        stale: staleCount / denominator,
        other: (trashCount + orphanCount + rootLevelCount + emptyCount) / denominator,
        duplicates: duplicateGroups / denominator,
    };
    const deductions = Object.fromEntries(
        Object.entries(SECURITY_SCORE_WEIGHTS).map(([factor, weight]) => [
            factor,
            Math.round(Math.min(weight * severity[factor], weight)),
        ])
    );
    const { riskScore, securityScore } = calculateScoreTotals(deductions);

    return {
        securityScore,
        riskScore,
        severity,
        deductions,
        counts: { publicCount, externalCount, staleCount, rootLevelCount, emptyCount, orphanCount, trashCount, duplicateGroups },
        issueCount: (publicCount > 0 ? 1 : 0) + (staleCount > 0 ? 1 : 0) + (duplicateGroups > 0 ? 1 : 0),
    };
}

export function classifyRiskScore(riskScore) {
    if (riskScore <= 30) return 'low';
    if (riskScore <= 60) return 'medium';
    return 'high';
}
