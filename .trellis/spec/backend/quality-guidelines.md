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
