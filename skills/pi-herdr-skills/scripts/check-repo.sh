#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
installed_root="$HOME/.agents/skills"

# The browser backend is the only selection that changes the managed skill set.
# It comes from the caller, the environment, or the selection setup recorded in
# the generated env file. Nothing is inferred from the OS or from installed state.
browser_selection=""
usage() {
  cat <<'EOF'
Usage: scripts/check-repo.sh [--browser aside|browser-use|none]

Verifies that every managed skill selected for this host matches the repository.

  --browser BACKEND  Browser backend this host selected (default: $ASTACK_BROWSER,
                     else the ASTACK_BROWSER line in $ASTACK_HOME/env.sh, else
                     browser-use). Exactly one browser skill is managed: browser-use
                     verifies that skill and leaves an installed aside-browser alone;
                     aside verifies aside-browser and requires browser-use to be
                     absent; none verifies neither.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      [[ $# -ge 2 ]] || { usage >&2; exit 2; }
      browser_selection=$2
      shift
      ;;
    --browser=*) browser_selection=${1#--browser=} ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

if [[ -z $browser_selection ]]; then
  browser_selection=${ASTACK_BROWSER:-}
fi
if [[ -z $browser_selection ]]; then
  env_file="${ASTACK_HOME:-$HOME/.local/share/astack}/env.sh"
  if [[ -r $env_file ]]; then
    browser_selection=$(sed -n 's/^export ASTACK_BROWSER="\{0,1\}\([^"]*\)"\{0,1\}$/\1/p' "$env_file" | head -n 1)
  fi
fi
browser_selection=${browser_selection:-browser-use}

case "$browser_selection" in
  aside|browser-use|none) ;;
  *) printf 'ERROR: unknown browser selection: %s (expected aside, browser-use or none)\n' "$browser_selection" >&2; exit 2 ;;
esac

browser_skill=""
case "$browser_selection" in
  browser-use) browser_skill=browser-use ;;
  aside) browser_skill=aside-browser ;;
esac

fail() {
  printf 'ERROR: %s\n' "$*" >&2
  exit 1
}

for source_skill in "$repo_root"/skills/*; do
  [[ -d "$source_skill" ]] || continue
  name=$(basename "$source_skill")
  installed_skill="$installed_root/$name"
  if [[ $name == browser-use || $name == aside-browser ]]; then
    if [[ $browser_selection == none ]]; then
      printf 'SKIPPED: %s (--browser none); browser skills not verified\n' "$name"
      continue
    fi
    if [[ $name != "$browser_skill" ]]; then
      if [[ $browser_selection == aside && $name == browser-use ]]; then
        if [[ -e "$installed_skill" || -L "$installed_skill" ]]; then
          fail "browser-use is installed but the selected browser backend is aside; review $installed_skill, back it up, then remove it or rerun setup with --browser browser-use"
        fi
        printf 'NOT SELECTED: browser-use (--browser aside); browser-use absent\n'
      elif [[ $browser_selection == browser-use && $name == aside-browser ]]; then
        if [[ -e "$installed_skill" || -L "$installed_skill" ]]; then
          printf 'NOT SELECTED: aside-browser (--browser browser-use); installed copy left untouched\n'
        else
          printf 'NOT SELECTED: aside-browser (--browser browser-use)\n'
        fi
      fi
      continue
    fi
  fi
  [[ -d "$installed_skill" ]] || fail "missing global skill: $installed_skill"
  diff -qr "$source_skill" "$installed_skill" >/dev/null || fail "global skill differs: $name"
done

printf 'PASS: repository skills match shared global skills (browser: %s)\n' "$browser_selection"
