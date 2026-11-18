#!/usr/bin/env bash
set -euo pipefail

repo_root=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
script_dir=$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)
source_root="$repo_root/skills"
agent_dir=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
destination="$HOME/.agents/skills"
mode=install
force=0
dry_run=0
skip_conflicts=0
without=()
browser_selection=""

usage() {
  cat <<'EOF'
Usage: scripts/install.sh [--force|--skip-conflicts] [--without NAME] [--browser BACKEND] [--dry-run] [--uninstall]

Installs skills into ~/.agents/skills. No permission extension is required or installed.

  --dry-run         Show what would change.
  --force           Back up and replace conflicting managed files.
  --skip-conflicts  Leave differing managed skills untouched and install only
                    missing/non-conflicting managed skills.
  --without NAME    NAME is not in this host's selected managed set: never install
                    it, never report it as a conflict, and never remove it. Repeatable.
  --browser BACKEND Managed browser skill selection: browser-use (default), aside, both
                    or none. The default resolves from $ASTACK_BROWSER, then the
                    ASTACK_BROWSER line in $ASTACK_HOME/env.sh, then browser-use.
                    browser-use and aside each select one skill; both selects both
                    skills side by side; the unselected skill is never installed,
                    never reported as a conflict, and never removed.
  --uninstall       Remove matching installed skills. Modified files require
                    --force and are backed up before removal.

Set PI_CODING_AGENT_DIR to use a non-default directory for skill backups.
EOF
}

while [[ $# -gt 0 ]]; do
  case "$1" in
    --force) force=1 ;;
    --skip-conflicts) skip_conflicts=1 ;;
    --dry-run) dry_run=1 ;;
    --without)
      [[ $# -ge 2 && -n $2 && $2 != --* ]] || { echo "--without needs a skill name." >&2; exit 2; }
      without+=("$2")
      shift
      ;;
    --without=*)
      [[ -n ${1#--without=} ]] || { echo "--without needs a skill name." >&2; exit 2; }
      without+=("${1#--without=}")
      ;;
    --browser)
      [[ $# -ge 2 && -n $2 && $2 != --* ]] || { echo "--browser needs a backend." >&2; exit 2; }
      browser_selection=$2
      shift
      ;;
    --browser=*)
      [[ -n ${1#--browser=} ]] || { echo "--browser needs a backend." >&2; exit 2; }
      browser_selection=${1#--browser=}
      ;;
    --uninstall) mode=uninstall ;;
    -h|--help) usage; exit 0 ;;
    *) usage >&2; exit 2 ;;
  esac
  shift
done

if [[ $force -eq 1 && $skip_conflicts -eq 1 ]]; then
  echo "--force and --skip-conflicts are mutually exclusive." >&2
  usage >&2
  exit 2
fi

# Resolve the selection the same way setup and check-repo do: explicit flag,
# then $ASTACK_BROWSER, then the recorded env.sh, then the browser-use default.
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

# The browser pair is one selection, never an accident. The default is
# browser-use on a host with no recorded selection; --browser aside swaps the
# pair, --browser both selects both skills side by side, and --browser none
# selects neither. --without still excludes any named managed skill on top.
case "$browser_selection" in
  browser-use) without+=(aside-browser) ;;
  aside) without+=(browser-use) ;;
  both) : ;;
  none) without+=(browser-use aside-browser) ;;
  *)
    echo "Unknown --browser value: $browser_selection (expected browser-use, aside, both or none)." >&2
    usage >&2
    exit 2
    ;;
esac

[[ -d "$source_root" ]] || { echo "Missing skills directory: $source_root" >&2; exit 1; }
[[ -f "$script_dir/trees-equal.py" ]] || { echo "Missing helper: $script_dir/trees-equal.py" >&2; exit 1; }

# Shared with the Astack setup browser step so "content-identical" is one rule:
# path set, file types, executable bits, regular-file SHA-256 and symlink targets.
trees_equal() {
  python3 "$script_dir/trees-equal.py" "$1" "$2"
}

skill_names=()
while IFS= read -r line; do
  skill_names+=("$line")
done < <(find "$source_root" -mindepth 1 -maxdepth 1 -type d -exec basename {} \; | LC_ALL=C sort)
[[ ${#skill_names[@]} -gt 0 ]] || { echo "No skills found." >&2; exit 1; }

is_without() {
  local name=$1 candidate
  for candidate in ${without[@]+"${without[@]}"}; do
    [[ $candidate == "$name" ]] && return 0
  done
  return 1
}

for candidate in ${without[@]+"${without[@]}"}; do
  found=0
  for name in "${skill_names[@]}"; do
    [[ $name == "$candidate" ]] && found=1 && break
  done
  [[ $found -eq 1 ]] || { echo "--without names an unknown managed skill: $candidate" >&2; exit 2; }
done

conflicts=()
for name in "${skill_names[@]}"; do
  is_without "$name" && continue
  target="$destination/$name"
  [[ -e "$target" || -L "$target" ]] || continue
  if ! trees_equal "$source_root/$name" "$target"; then
    conflicts+=("$name")
  fi
done

if [[ ${#conflicts[@]} -gt 0 && $force -eq 0 && $skip_conflicts -eq 0 ]]; then
  printf 'Refusing to overwrite modified or different managed files:\n' >&2
  printf '  skill: %s\n' "${conflicts[@]}" >&2
  printf 'Review the differences, then rerun with --force to create a backup first,\n' >&2
  printf 'or use --skip-conflicts to install missing/non-conflicting skills only.\n' >&2
  exit 1
fi

is_conflict() {
  local name=$1 conflict
  for conflict in ${conflicts[@]+"${conflicts[@]}"}; do
    [[ $conflict == "$name" ]] && return 0
  done
  return 1
}

backup_root=""
if [[ ${#conflicts[@]} -gt 0 && $force -eq 1 ]]; then
  backup_parent="$agent_dir/skills-backups"
  if [[ $dry_run -eq 1 ]]; then
    backup_root="$backup_parent/pi-herdr-skills-<unique>"
    echo "Would back up conflicts to: $backup_root"
  else
    mkdir -p "$backup_parent"
    backup_root=$(mktemp -d "$backup_parent/pi-herdr-skills-XXXXXXXX")
    if [[ ${#conflicts[@]} -gt 0 ]]; then
      for name in "${conflicts[@]}"; do
        cp -R -p "$destination/$name" "$backup_root/$name"
      done
    fi
    echo "Backed up conflicts to: $backup_root"
  fi
fi

if [[ $mode == uninstall ]]; then
  for name in "${skill_names[@]}"; do
    target="$destination/$name"
    if is_without "$name"; then
      if [[ $dry_run -eq 1 ]]; then
        echo "Would skip not-selected: $name"
      else
        echo "Skipped not-selected: $name"
      fi
      continue
    fi
    [[ -e "$target" || -L "$target" ]] || continue
    if [[ $skip_conflicts -eq 1 ]] && is_conflict "$name"; then
      if [[ $dry_run -eq 1 ]]; then
        echo "Would skip conflict: $name"
      else
        echo "Skipped conflict: $name"
      fi
      continue
    fi
    if [[ $dry_run -eq 1 ]]; then
      echo "Would remove: $target"
    else
      rm -rf -- "$target"
      echo "Removed: $target"
    fi
  done
  if [[ ${#conflicts[@]} -gt 0 && $skip_conflicts -eq 1 ]]; then
    printf 'Preserved %d conflicting managed skill(s).\n' "${#conflicts[@]}"
  fi
  exit 0
fi

if [[ $dry_run -eq 0 ]]; then
  mkdir -p "$destination"
fi
for name in "${skill_names[@]}"; do
  source_skill="$source_root/$name"
  target="$destination/$name"
  if is_without "$name"; then
    if [[ $dry_run -eq 1 ]]; then
      echo "Would skip not-selected: $name"
    else
      echo "Skipped not-selected: $name"
    fi
    continue
  fi
  if [[ $skip_conflicts -eq 1 ]] && is_conflict "$name"; then
    if [[ $dry_run -eq 1 ]]; then
      echo "Would skip conflict: $name"
    else
      echo "Skipped conflict: $name"
    fi
    continue
  fi
  if [[ -d "$target" ]] && trees_equal "$source_skill" "$target"; then
    echo "Already current: $name"
    continue
  fi
  if [[ $dry_run -eq 1 ]]; then
    echo "Would install: $name -> $target"
    continue
  fi
  staging="$destination/.pi-herdr-skills-$name-$$"
  rm -rf -- "$staging"
  cp -R -p "$source_skill" "$staging"
  rm -rf -- "$target"
  mv "$staging" "$target"
  echo "Installed: $name"
done

if [[ ${#conflicts[@]} -gt 0 && $skip_conflicts -eq 1 ]]; then
  if [[ $dry_run -eq 1 ]]; then
    printf 'Would preserve %d conflicting managed skill(s) and install the remaining managed skills.\n' "${#conflicts[@]}"
  else
    printf 'Preserved %d conflicting managed skill(s); installed the remaining managed skills.\n' "${#conflicts[@]}"
  fi
fi
echo "Done. Restart Pi or run /reload in an existing Pi session."
