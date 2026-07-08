type SemVer = {
    major: number;
    minor: number;
    patch: number;
};

const SEMVER_PATTERN = /^v?(\d+)\.(\d+)\.(\d+)$/;

function parseSemVer(version: string | undefined): SemVer | null {
    if (!version) return null;

    const match = version.trim().match(SEMVER_PATTERN);
    if (!match) return null;

    return {
        major: Number(match[1]),
        minor: Number(match[2]),
        patch: Number(match[3]),
    };
}

export function isNewerSemVer(latestVersion: string | undefined, currentVersion: string | undefined) {
    const latest = parseSemVer(latestVersion);
    const current = parseSemVer(currentVersion);

    if (!latest || !current) return false;

    if (latest.major !== current.major) return latest.major > current.major;
    if (latest.minor !== current.minor) return latest.minor > current.minor;
    return latest.patch > current.patch;
}
