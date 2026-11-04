#!/usr/bin/env bash
# Astack setup: one rerunnable entry that works before Node exists.
#
#   bash scripts/setup.sh
#   bash scripts/setup.sh --check
#   bash scripts/setup.sh --report-dir /path/to/artifacts
#
# This script installs missing host capabilities into the current user's space,
# prepares each independent package, registers local Pi packages, syncs shared
# skills, and reports every capability as ready/installed/manual/unsupported/failed.
set -euo pipefail

REPO_ROOT=$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)
# RunCommand and other callers may start in a root-only cwd. Establish our own
# user-owned checkout root before invoking npx, find, or relative helpers.
cd "$REPO_ROOT" || { echo "ERROR: cannot cd to checkout root: $REPO_ROOT" >&2; exit 2; }
COMMON="$REPO_ROOT/scripts/lib/setup/common.sh"
STEPS="$REPO_ROOT/scripts/lib/setup/steps.sh"
DESKTOP_STEPS="$REPO_ROOT/scripts/lib/setup/desktop.sh"

MODE=install
ASTACK_DESKTOP=0
NO_DESKTOP_START=0
AGENT_DIR=${PI_CODING_AGENT_DIR:-"$HOME/.pi/agent"}
REPORT_DIR=
SKIP_GROUPS=""
KEEP_PACKAGE_PATHS=0
NO_CONFIG=0
ALLOW_ROOT=0
NODE_MIN=22.19.0
NPM_MIN=10.0.0
PI_MIN=1.4.0
PACKAGE_ORDER="pi-tasks pi-research pi-loop-monitor pi-decisions pi-classifier pi-herdr pi-firstmate pi-image-gen pi-review pi-visuals pi-grill-me"

usage() {
  cat <<'EOF'
Usage: bash scripts/setup.sh [options]

Installs missing runtimes and Astack capabilities for the current user, prepares
each package independently, registers local Pi packages, and syncs shared skills.
It is non-interactive and rerunnable.

  --check                  Detect and report only; no installs or config writes.
  --agent-dir DIR          Pi agent config directory (default: $PI_CODING_AGENT_DIR or ~/.pi/agent).
  --report-dir DIR         Write setup-report.md, setup-report.json and logs there.
  --skip LIST              Skip groups: runtimes,packages,skills,desktop,chrome,browser,herdr,cua,slack.
  --desktop                Opt in to the private Ubuntu/Debian virtual desktop for Cua:
                           Xvfb + full XFCE + session D-Bus + AT-SPI + ffmpeg, started through
                           a systemd user unit. Not installed on the default path.
  --no-desktop-start       Install and enable the desktop unit without starting it now.
  --keep-package-paths     Do not replace same-name local package entries at another path.
  --no-config              Do not write settings.json or mcp.json.
  --allow-root             Permit user-level installs into root's home (root-only hosts).
  --yes                    Accepted no-op for non-interactive callers.
  -h, --help               Show this help.

Environment: ASTACK_HOME (default $HOME/.local/share/astack), PI_CODING_AGENT_DIR.

A root shell must run this as the intended normal user, for example:
  runuser -u USER -- env HOME=/home/USER bash scripts/setup.sh
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --check|--dry-run) MODE=check ;;
    --agent-dir)
      [ $# -ge 2 ] || { echo "ERROR: --agent-dir needs a value" >&2; exit 2; }
      AGENT_DIR=$2; shift ;;
    --report-dir)
      [ $# -ge 2 ] || { echo "ERROR: --report-dir needs a value" >&2; exit 2; }
      REPORT_DIR=$2; shift ;;
    --skip)
      [ $# -ge 2 ] || { echo "ERROR: --skip needs a value" >&2; exit 2; }
      SKIP_GROUPS=$2; shift ;;
    --desktop) ASTACK_DESKTOP=1 ;;
    --no-desktop-start) NO_DESKTOP_START=1 ;;
    --keep-package-paths) KEEP_PACKAGE_PATHS=1 ;;
    --no-config) NO_CONFIG=1 ;;
    --allow-root) ALLOW_ROOT=1 ;;
    --yes|-y) : ;;
    -h|--help) usage; exit 0 ;;
    *) echo "ERROR: unknown option: $1" >&2; usage >&2; exit 2 ;;
  esac
  shift
done

# shellcheck source=lib/setup/common.sh
. "$COMMON"
# shellcheck source=lib/setup/steps.sh
. "$STEPS"
# shellcheck source=lib/setup/desktop.sh
. "$DESKTOP_STEPS"

if [ "$(id -u)" -eq 0 ] && [ "$ALLOW_ROOT" -ne 1 ]; then
  cat >&2 <<'EOF'
ERROR: refusing to install user-level Pi config, skills and packages from a root shell.

Run as the intended normal user, or through RunCommand:
  runuser -u <user> -- env HOME=/home/<user> bash /path/to/astack/scripts/setup.sh

Use --allow-root only on a genuinely root-owned host.
EOF
  exit 2
fi

if [ -z "$AGENT_DIR" ]; then
  echo "ERROR: empty agent directory" >&2
  exit 2
fi

USER_HOME=$(effective_home)
[ -n "$USER_HOME" ] || USER_HOME=$HOME
ASTACK_HOME=${ASTACK_HOME:-"$USER_HOME/.local/share/astack"}
ASTACK_BIN="$ASTACK_HOME/bin"
SETUP_STAMP=$(date -u '+%Y%m%dT%H%M%SZ')
if [ -n "$REPORT_DIR" ]; then
  LOG_DIR=$REPORT_DIR
  mkdir -p "$REPORT_DIR"
elif [ "$MODE" = check ]; then
  LOG_DIR=${TMPDIR:-/tmp}/astack-setup-check-$$
else
  LOG_DIR="$ASTACK_HOME/logs"
fi

if [ "$MODE" = install ]; then
  mkdir -p "$ASTACK_HOME" "$ASTACK_BIN" "$LOG_DIR"
fi
export PATH="$ASTACK_BIN:$USER_HOME/.local/bin:$PATH"

if [ -n "$REPORT_DIR" ]; then
  LOG_FILE="$LOG_DIR/setup.log"
  # Keep a complete transcript in the report directory.
  exec > >(tee -a "$LOG_FILE") 2>&1
fi

detect_os
detect_desktop
detect_vulkan
PKG_LOG_DIR="$LOG_DIR/packages"

printf 'Astack setup\n'
printf '  mode:        %s\n' "$MODE"
printf '  checkout:    %s\n' "$REPO_ROOT"
printf '  OS:          %s %s (%s)\n' "$OS" "$OS_VERSION" "$DISTRO_NAME"
printf '  arch:        %s\n' "$ARCH"
printf '  package mgr: %s\n' "$PKG_MANAGER"
printf '  desktop:     %s\n' "$DESKTOP"
printf '  agent dir:   %s\n' "$AGENT_DIR"
printf '  ASTACK_HOME: %s\n' "$ASTACK_HOME"
[ -n "$REPORT_DIR" ] && printf '  report dir:  %s\n' "$REPORT_DIR"

if [ "$OS" = unsupported ]; then
  record_cap host failed "unsupported OS: $(uname -s); macOS and Linux are supported"
  print_caps
  write_reports
  exit 1
fi

skip_group() {
  case " ${SKIP_GROUPS//,/ } " in
    *" $1 "*) return 0 ;;
    *) return 1 ;;
  esac
}

if skip_group runtimes; then
  record_cap runtimes manual "skipped by --skip runtimes"
else
  ensure_runtimes
fi

if skip_group packages; then
  record_cap packages manual "skipped by --skip packages"
else
  install_packages
  register_packages || true
fi

if skip_group skills; then
  record_cap shared-skills manual "skipped by --skip skills"
else
  install_skills || true
fi

if [ "$ASTACK_DESKTOP" -eq 1 ]; then
  if skip_group desktop; then
    record_cap desktop-runtime manual "skipped by --skip desktop"
  else
    ensure_desktop || true
  fi
else
  desktop_note_not_requested
fi

if skip_group chrome; then
  record_cap chrome manual "skipped by --skip chrome"
else
  ensure_chrome || true
fi

if skip_group browser; then
  record_cap browser-use manual "skipped by --skip browser"
else
  ensure_browser_use || true
fi

if skip_group herdr; then
  record_cap herdr-core manual "skipped by --skip herdr"
  record_cap herdr-app manual "skipped by --skip herdr"
else
  ensure_herdr_core || true
  ensure_herdr_app || true
fi

if skip_group cua; then
  record_cap cua-driver manual "skipped by --skip cua"
  record_cap cua-permissions manual "skipped by --skip cua"
  record_cap cua-mcp manual "skipped by --skip cua"
else
  ensure_cua || true
  register_cua_mcp || true
fi

if skip_group slack; then
  record_cap slack-service manual "skipped by --skip slack"
else
  install_slack_service || true
fi

if [ "$ASTACK_DESKTOP" -eq 1 ] && ! skip_group desktop; then
  desktop_report || true
fi

report_manual_items
write_reports

print_caps
printf '\nEnvironment file: %s\n' "$ASTACK_HOME/env.sh"
if [ -n "$REPORT_DIR" ]; then
  printf 'Reports: %s/setup-report.md, %s/setup-report.json\n' "$REPORT_DIR" "$REPORT_DIR"
fi
printf 'Counts: ready=%s installed=%s manual=%s unsupported=%s failed=%s\n' \
  "$(count_status ready)" "$(count_status installed)" "$(count_status manual)" \
  "$(count_status unsupported)" "$(count_status failed)"

if [ "$(count_status failed)" -gt 0 ]; then
  exit 1
fi
exit 0
