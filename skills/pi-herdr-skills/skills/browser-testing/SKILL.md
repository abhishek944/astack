---
name: browser-testing
description: "Read before any real-browser work, including browsing, online research, website interaction, screenshots, downloads, UI checks, forms or browser QA. Chooses signed-in versus isolated browser modes, resolves the signed-in context, sets verification discipline, and protects the user's browser. Does not replace the selected browser skill: read aside-browser or browser-use for live operation."
---

# Browser work and testing

Use this skill whenever a task needs a real browser for browsing, online research, website interaction, screenshots, downloads, testing, UI checks, forms or extraction. It is the shared policy for all browser work, not only QA; the host's selected browser skill still owns the live browser and its current CLI or launcher instructions. Follow the selected skill's live documentation for current commands and APIs.

Follow global `implement` for Work/Todo tracking and artifact paths, and keep the surrounding task under `no-unit-tests` and `no-arbitrary-limits`.

## Pick the right browser mode

- Use `aside-browser` for signed-in work: sites the user is already signed in to and their real browser profile. Read its live `aside guide` before driving it.
- Use `browser-use` for isolated testing: service tests, screenshots, forms and extraction on a fresh private profile that must not touch the user's sessions. Read its launcher and rules before driving it.
- Keep the two modes separate. Never copy cookies, storage, profiles or credentials between them, and never attach an isolated tester to a signed-in personal Chrome to reuse a session it does not own.
- If the isolated capability is not installed because the host selected `--browser aside`, say plainly that isolated headless testing is unavailable and that `--browser both` or `--browser browser-use` provides it. Do not silently substitute the signed-in profile, invent an Aside-side equivalent, or claim a dependency that is not installed. Signed-in work with Aside alone is unaffected.
- This shared policy owns the mode choice; the selected browser skill owns live operation.

## Resolve and verify the signed-in context

These rules apply to all signed-in Aside work, including research and site interaction, not only QA.

- Resolve the active profile instead of offering a profile menu. Normal browser work runs on the profile the user is already using, so read that selection from Aside's own state:
  1. `aside account list` marks the active account with `*`; `aside account status --json` reports the same choice as `currentAccountId`, with that account's `profileBindings`.
  2. `aside settings get` reports the saved selector (`accountId`, `defaultProfileSelector`, `defaultProfileId`). A saved `uN:<profile-id>` wins; `null` or `default` means follow the active account, whose first profile by index then ID is the documented default.
  3. `aside host profiles --account uN --json` names that profile on the selected host (`profileId`, `label`, `connected`). Listing is account-scoped, so another account's profiles are not candidates, and a remote-host or plan failure affects only remote enumeration.

  One profile under the active account is determinate: omit `--account` and `--profile`, and Aside resolves that same profile. Do not ask the user to choose from connected profiles, and do not read `connected` as "open" — every listed profile reports it.
- Confirm the profile is the one in use. One `aside repl` call answers this without selecting anything else: `listBrowserTabs()` returns the selected profile's open tabs and flags the user's current tab `active`. Tabs matching what the user is looking at confirm the choice; an empty or unrelated list while the user is visibly browsing means the resolved profile is not the open one.
- Ask only when the active profile is genuinely undetermined. Ask, naming the concrete candidates, when no account is marked active or several signed-in accounts compete, when the active account has several profiles and the task depends on which identity is signed in, when more than one host is registered and the work must run on a specific device, or when the observed tabs contradict the request. Then pass the chosen account, profile or host explicitly: selecting another profile changes which profile Aside drives, so never do it silently. Never run `aside account use` or `aside settings set-default-profile` to make a guess fit.

## Start from the real target

- Begin authentication at the requested service's own page rather than an invented generic auth endpoint. Keep existing authenticated access distinct from a fresh provider login.
- Navigate to the actual route under test and confirm the page that rendered. An HTTP response or a route table alone does not prove the browser reached the intended UI.

## Use documented surfaces and a bounded REPL fallback

- Read `aside guide` and its REPL reference, and use only the APIs they document. Do not assume Playwright event, callback or redirect-observation behavior.
- Keep Aside first. Try `aside exec` for the authorized task with documented `--json`/`--timeout` output and session state. On localhost QA, `aside exec` has been observed ending sessions `errored`/`aborted` and exiting 1 with no answer; `aside session list --json` and `aside session inspect <id>` showed only status, while one documented `aside repl` session using `listBrowserTabs()`, `attachBrowserTab(targetId)` and `snapshot(page, { interactive: true })` completed the same check. Make at most one additional bounded retry only after a concrete state change or documented recovery. If it fails the same way, read `aside guide repl` and use the REPL for the remaining same-target verification. Do not switch to `browser-use` because of an Aside tooling failure; it remains the isolated-testing mode only.
- Keep the fallback in the same owned context. Use the already selected account, profile and host. Attach only the matching existing tab reported by `listBrowserTabs()`; use `openTab(url)` only when no relevant tab exists or the task explicitly asks for a new one. Close only tabs this REPL created and leave every user tab as found. If the target tab or profile is ambiguous, stop and ask with the concrete candidates.
- Reuse one REPL session for the authorized verification. Bindings persist within an `aside repl` session, while a one-shot invocation owns and closes its tabs. Keep related inspect, action and verify calls together, and confirm each action with a fresh `snapshot()` instead of relying on an unobserved callback or redirect. Do not add polling or instrumentation recipes or frameworks.

## Verify what the browser showed

- Confirm the final URL and visible UI for each check. An unseen page or an unobserved intermediate redirect leaves the result unverified; it proves neither success nor failure.
- Keep the action and its verification in the same owned browser session. Confirm each action with a fresh observation of the page instead of relying on an unobserved callback or redirect.
- Report application failures, tooling or test failures, and unverified checks separately. Preserve the original failure and any uncertain operation outcome. Never replay an uncertain submission or force page state to manufacture a pass.

## Respect the user's browser

- Never force a fresh sign-in through sign-out, cookie clearing, or profile changes without explicit authorization. Never move to another account or profile to escape a signed-out page.
- Stop at a real password, MFA, consent, refusal, or ambiguous-account prompt. Leave the user's existing tabs and secrets untouched.
- In a signed-in browser, attach only the matching existing tab reported by the tool. Open a new tab only when no relevant tab exists or the task explicitly asks for one, and close only tabs this task created.
- Do not refresh, close, or take control of another worker's or the user's tab. Do not sign out, clear cookies, switch profiles or hosts, close unrelated tabs, or focus and change the user's personal browser. Coordinate shared tabs and services before any action that changes them.

## Final report

State the browser mode and target, the URL and UI actually observed, and any check that could not be verified with its exact missing dependency. An unverified check is reported as **NOT RUN**, never as a pass.
