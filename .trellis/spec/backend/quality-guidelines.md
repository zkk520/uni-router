# Quality Guidelines

> Code quality standards for backend development.

---

## Overview

<!--
Document your project's quality standards here.

Questions to answer:
- What patterns are forbidden?
- What linting rules do you enforce?
- What are your testing requirements?
- What code review standards apply?
-->

(To be filled by the team)

---

## Forbidden Patterns

<!-- Patterns that should never be used and why -->

(To be filled by the team)

---

## Required Patterns

<!-- Patterns that must always be used -->

### Release / Version Contract

Release workflow changes are infrastructure contracts. They must preserve the distinction between the continuously deployed `main` image and manually confirmed release tags.

#### Scope / Trigger

This contract applies whenever `.github/workflows/release.yaml`, `Dockerfile`, frontend version display, or update-check behavior changes.

#### Signatures

- Workflow output: `jobs.version.outputs.version`
- Docker build arg: `VERSION=${{ needs.version.outputs.version }}`
- Backend version endpoint: `GET /api/v1/update/now-version -> string`
- Frontend build env: `NEXT_PUBLIC_APP_VERSION`

#### Contracts

- `main` push builds, pushes, and deploys only `ghcr.io/zkk520/uni-router:latest`.
- `main` image internals may use a predicted SemVer from `jobs.version.outputs.version`, but CI must not create or push a Git tag.
- Only `vX.Y.Z` tag pushes create GitHub Releases and multi-platform zip assets.
- Docker metadata may use `type=ref,event=tag` for tag images, but must not add a raw predicted SemVer tag for `main`.
- The version injected into frontend and backend must come from the resolved SemVer output, not from the branch name.

#### Validation & Error Matrix

| Condition | Required Result |
|---|---|
| `github.ref == refs/heads/main` | push `latest`; no GitHub Release; no zip upload; no automatic tag creation |
| `github.ref == refs/tags/v*` | create GitHub Release; upload `uni-router-<os>-<arch>.zip`; publish tag image |
| no previous `vX.Y.Z` tag | resolve version as `v0.1.0` |
| commits contain `BREAKING CHANGE` or `type!:` | increment major |
| commits contain `feat:` | increment minor |
| other commit types | increment patch |
| frontend/backend version differs | show cache-mismatch warning |
| latest release is not greater than current SemVer | do not show update prompt |
| version is non-SemVer such as `dev` or `main` | do not show update prompt |

#### Good / Base / Bad Cases

- Good: `main` push injects `v0.1.1` into the app, pushes only `latest`, deploys successfully, and does not create `v0.1.1` tag.
- Base: `v0.1.1` tag push creates the official Release and uploads `uni-router-linux-x86_64.zip` style assets.
- Bad: `main` push injects `main` into the app UI or creates a tag automatically after deployment.

#### Tests Required

- Static workflow check:
  ```bash
  rg "VERSION=\\$\\{\\{ github\\.ref_name \\}\\}|Create version tag" .github/workflows/release.yaml
  ```
  This command must return no matches.
- Frontend checks after version-display or update-check changes:
  ```bash
  cd web && pnpm run lint
  cd web && pnpm run build
  ```
- Manual release verification: after pushing `vX.Y.Z`, verify Release assets and `/api/v1/update/now-version` agree with the tag.

#### Wrong vs Correct

Wrong:

```yaml
build-args: |
  VERSION=${{ github.ref_name }}

tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=raw,value=${{ needs.version.outputs.version }},enable=${{ github.ref == 'refs/heads/main' }}
```

Correct:

```yaml
build-args: |
  VERSION=${{ needs.version.outputs.version }}

tags: |
  type=raw,value=latest,enable={{is_default_branch}}
  type=ref,event=tag
```

Wrong:

```typescript
const hasNewVersion = latestVersion !== backendNowVersion;
```

Correct:

```typescript
const hasNewVersion = isNewerSemVer(latestVersion, backendNowVersion);
```

### CI Deployment Must Fail on Pull or Health Failure

Deployment workflows that update Docker Compose services must treat image pull failures as hard failures. Do not continue to `docker compose up -d` after retries are exhausted, because that can leave the old container running while GitHub Actions reports a false success.

Required behavior for SSH deployment scripts:

- Retry `docker compose pull` with bounded backoff for transient registry/proxy errors.
- Exit non-zero if all pull attempts fail.
- Log the pulled image ID before `docker compose up -d`.
- Wait for the target container health check to become `healthy`.
- Compare the running container image ID with the pulled image ID and fail if they differ.

Wrong:

```bash
for i in 1 2 3; do
  docker compose pull && break
done
docker compose up -d
```

Correct:

```bash
pull_success=false
for delay in 10 20 30 60 90; do
  if docker compose pull; then
    pull_success=true
    break
  fi
  sleep "${delay}"
done

if [ "${pull_success}" != "true" ]; then
  exit 1
fi

pulled_image_id=$(docker image inspect ghcr.io/zkk520/uni-router:latest --format '{{.Id}}')
docker compose up -d
running_image_id=$(docker inspect uni-router --format '{{.Image}}')
if [ "${running_image_id}" != "${pulled_image_id}" ]; then
  exit 1
fi
```

---

## Testing Requirements

<!-- What level of testing is expected -->

(To be filled by the team)

---

## Code Review Checklist

<!-- What reviewers should check -->

(To be filled by the team)
