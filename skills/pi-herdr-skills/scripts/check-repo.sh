#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
installed_root="$HOME/.agents/skills"

# The browser backend is the only selection that changes the managed skill set.
# It comes from the caller, the environment, or the selection setup recorded in
# the generated env file. Nothing is inferred from the OS or from installed state.
browser_selection=""
requested_skills=()

usage() {
  cat <<'EOF'
Usage: scripts/check-repo.sh [--browser aside|browser-use|both|none] [--skill NAME]...

Verifies that the managed skills selected for this host match the repository.
Without --skill it checks every managed skill and reports every mismatch before
exiting, including the differing relative paths and reasons. With one or more
--skill options it checks only those named skills; the browser selection and its
safety rules are still enforced. The comparison requires python3. This script
checks installed/global equality only; run npm run check:manifest for the
repository checksums and executable modes.

  --browser BACKEND  Browser backend this host selected (default: $ASTACK_BROWSER,
                     else the ASTACK_BROWSER line in $ASTACK_HOME/env.sh, else
                     browser-use). browser-use verifies that skill and leaves an
                     installed aside-browser alone; aside verifies aside-browser and
                     requires browser-use to be absent; both verifies both skills
                     side by side; none verifies neither.
  --skill NAME       Check only this managed skill. Repeatable. NAME must be a
                     directory under skills/ and must be selected by the browser
                     backend when it is browser-use or aside-browser.

Exit status: 0 verified, 1 mismatch, 2 usage error.
EOF
}

usage_error() {
  printf 'ERROR: %s\n' "$*" >&2
  usage >&2
  exit 2
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --browser)
      [[ $# -ge 2 ]] || usage_error "--browser requires a value"
      browser_selection=$2
      shift
      ;;
    --browser=*) browser_selection=${1#--browser=} ;;
    --skill)
      [[ $# -ge 2 && -n $2 ]] || usage_error "--skill requires a non-empty skill name"
      requested_skills+=("$2")
      shift
      ;;
    --skill=*)
      [[ -n ${1#--skill=} ]] || usage_error "--skill requires a non-empty skill name"
      requested_skills+=("${1#--skill=}")
      ;;
    -h|--help) usage; exit 0 ;;
    *) usage_error "unknown argument: $1" ;;
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
  aside|browser-use|both|none) ;;
  *) printf 'ERROR: unknown browser selection: %s (expected aside, browser-use, both or none)\n' "$browser_selection" >&2; exit 2 ;;
esac

# browser_selected is required present and current; browser_absent must not be
# installed at all. browser-use and both leave the other skill alone.
browser_selected=()
browser_absent=()
case "$browser_selection" in
  browser-use) browser_selected=(browser-use) ;;
  aside) browser_selected=(aside-browser); browser_absent=(browser-use) ;;
  both) browser_selected=(aside-browser browser-use) ;;
esac

in_list() {
  local needle=$1 candidate
  shift
  for candidate in "$@"; do
    [[ $candidate == "$needle" ]] && return 0
  done
  return 1
}

is_browser_selected() {
  in_list "$1" ${browser_selected[@]+"${browser_selected[@]}"}
}

is_browser_absent() {
  in_list "$1" ${browser_absent[@]+"${browser_absent[@]}"}
}

# Build and validate the check scope before touching the installed tree. A named
# browser skill outside the selected backend is a usage conflict, not a silent
# pass: the browser selection still decides which browser skills this host owns.
scope=()
if [[ ${#requested_skills[@]} -gt 0 ]]; then
  for name in ${requested_skills[@]+"${requested_skills[@]}"}; do
    if [[ $name == */* || $name == . || $name == .. ]]; then
      usage_error "invalid managed skill name: $name"
    fi
    if [[ ! -d "$repo_root/skills/$name" ]]; then
      usage_error "unknown managed skill: $name"
    fi
    if in_list "$name" ${scope[@]+"${scope[@]}"}; then
      continue
    fi
    scope+=("$name")
  done
  for name in ${scope[@]+"${scope[@]}"}; do
    if [[ $name == browser-use || $name == aside-browser ]]; then
      if [[ $browser_selection == none ]]; then
        usage_error "--skill $name conflicts with --browser none; browser skills are not selected"
      fi
      if ! is_browser_selected "$name"; then
        usage_error "--skill $name conflicts with --browser $browser_selection; $name is not selected"
      fi
    fi
  done
else
  for source_skill in "$repo_root"/skills/*; do
    [[ -d "$source_skill" ]] || continue
    scope+=("$(basename "$source_skill")")
  done
fi

if ! command -v python3 >/dev/null 2>&1; then
  printf 'ERROR: python3 is required to compare skill trees\n' >&2
  exit 2
fi

tree_helper="$repo_root/scripts/trees-equal.py"
if [[ ! -f $tree_helper ]]; then
  printf 'ERROR: missing helper: %s\n' "$tree_helper" >&2
  exit 2
fi

problems=0
checked=0
problem() {
  problems=$((problems + 1))
  printf 'ERROR: %s\n' "$*" >&2
}

print_tree_line() {
  local line=$1
  case "$line" in
    *": missing from right") line="${line%: missing from right}: missing from installed copy" ;;
    *": only in right") line="${line%: only in right}: only in installed copy" ;;
  esac
  printf '  %s\n' "$line" >&2
}

# The browser selection's absence rule applies to the host even when the scoped
# check does not compare the browser skill contents.
if [[ $browser_selection == aside && ( -e "$installed_root/browser-use" || -L "$installed_root/browser-use" ) ]]; then
  problem "browser-use is installed but the selected browser backend is aside; review $installed_root/browser-use, back it up, then remove it or rerun setup with --browser browser-use or --browser both"
fi

for name in ${scope[@]+"${scope[@]}"}; do
  source_skill="$repo_root/skills/$name"
  installed_skill="$installed_root/$name"
  if [[ $name == browser-use || $name == aside-browser ]]; then
    if [[ $browser_selection == none ]]; then
      printf 'SKIPPED: %s (--browser none); browser skills not verified\n' "$name"
      continue
    fi
    if ! is_browser_selected "$name"; then
      if is_browser_absent "$name"; then
        if [[ -e $installed_skill || -L $installed_skill ]]; then
          printf 'NOT SELECTED: %s (--browser %s); installed (reported above)\n' "$name" "$browser_selection"
        else
          printf 'NOT SELECTED: %s (--browser %s); %s absent\n' "$name" "$browser_selection" "$name"
        fi
      elif [[ -e $installed_skill || -L $installed_skill ]]; then
        printf 'NOT SELECTED: %s (--browser %s); installed copy left untouched\n' "$name" "$browser_selection"
      else
        printf 'NOT SELECTED: %s (--browser %s)\n' "$name" "$browser_selection"
      fi
      continue
    fi
  fi

  checked=$((checked + 1))
  if [[ ! -d $installed_skill ]]; then
    problem "missing global skill: $installed_skill"
    continue
  fi
  tree_output=""
  if ! tree_output=$(python3 "$tree_helper" --report "$source_skill" "$installed_skill" 2>&1); then
    problem "global skill differs: $name"
    if [[ -n $tree_output ]]; then
      while IFS= read -r line; do
        print_tree_line "$line"
      done <<< "$tree_output"
    fi
  fi
done

if [[ $problems -gt 0 ]]; then
  printf 'ERROR: %d problem(s) found (checked %d skill(s); browser: %s)\n' \
    "$problems" "$checked" "$browser_selection" >&2
  exit 1
fi

if [[ ${#requested_skills[@]} -gt 0 ]]; then
  printf 'PASS: named repository skills match shared global skills (browser: %s)\n' "$browser_selection"
else
  printf 'PASS: repository skills match shared global skills (browser: %s)\n' "$browser_selection"
fi
