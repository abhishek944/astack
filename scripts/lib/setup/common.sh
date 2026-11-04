#!/usr/bin/env bash
# Shared detection, version, and capability-report helpers for scripts/setup.sh.
# Sourced, not executed. Kept compatible with macOS bash 3.2.

CAP_NAMES=()
CAP_STATUSES=()
CAP_DETAILS=()
CAP_VERSIONS=()

json_escape() {
  printf '%s' "$1" | sed -e 's/\\/\\\\/g' -e 's/"/\\"/g' -e 's/	/ /g' | tr '\n' ' '
}

cap_index() {
  local needle=$1 i=0
  while [ "$i" -lt "${#CAP_NAMES[@]}" ]; do
    if [ "${CAP_NAMES[$i]}" = "$needle" ]; then
      printf '%s' "$i"
      return 0
    fi
    i=$((i + 1))
  done
  return 1
}

record_cap() {
  local name=$1 status=$2 detail=$3 version=${4:-}
  local idx
  if idx=$(cap_index "$name"); then
    CAP_STATUSES[$idx]=$status
    CAP_DETAILS[$idx]=$detail
    CAP_VERSIONS[$idx]=$version
  else
    CAP_NAMES+=("$name")
    CAP_STATUSES+=("$status")
    CAP_DETAILS+=("$detail")
    CAP_VERSIONS+=("$version")
  fi
}

cap_status() {
  local idx
  if idx=$(cap_index "$1"); then
    printf '%s' "${CAP_STATUSES[$idx]}"
  else
    printf 'missing'
  fi
}

print_caps() {
  local i=0 name status detail version
  printf '\n%-24s %-12s %-14s %s\n' 'CAPABILITY' 'STATUS' 'VERSION' 'DETAIL'
  printf '%-24s %-12s %-14s %s\n' '------------------------' '------------' '--------------' '------'
  while [ "$i" -lt "${#CAP_NAMES[@]}" ]; do
    name=${CAP_NAMES[$i]}
    status=${CAP_STATUSES[$i]}
    detail=${CAP_DETAILS[$i]}
    version=${CAP_VERSIONS[$i]:--}
    printf '%-24s %-12s %-14s %s\n' "$name" "$status" "${version:--}" "$detail"
    i=$((i + 1))
  done
}

count_status() {
  local wanted=$1 i=0 n=0
  while [ "$i" -lt "${#CAP_STATUSES[@]}" ]; do
    [ "${CAP_STATUSES[$i]}" = "$wanted" ] && n=$((n + 1))
    i=$((i + 1))
  done
  printf '%s' "$n"
}

write_reports() {
  [ -n "${REPORT_DIR:-}" ] || return 0
  mkdir -p "$REPORT_DIR"
  local md="$REPORT_DIR/setup-report.md"
  local json="$REPORT_DIR/setup-report.json"
  local ts
  ts=$(date -u '+%Y-%m-%dT%H:%M:%SZ')
  {
    printf '# Astack setup report\n\n'
    printf -- '- Generated: %s\n' "$ts"
    printf -- '- OS: %s %s (%s)\n' "${OS:-unknown}" "${OS_VERSION:-}" "${DISTRO_NAME:-}"
    printf -- '- Arch: %s\n' "${ARCH:-unknown}"
    printf -- '- Desktop: %s\n' "${DESKTOP:-none}"
    printf -- '- Checkout: %s\n' "${REPO_ROOT:-}"
    printf -- '- Agent dir: %s\n' "${AGENT_DIR:-}"
    printf -- '- Mode: %s\n' "${MODE:-install}"
    printf -- '- Counts: ready=%s installed=%s manual=%s unsupported=%s failed=%s\n\n' \
      "$(count_status ready)" "$(count_status installed)" "$(count_status manual)" \
      "$(count_status unsupported)" "$(count_status failed)"
    printf '| Capability | Status | Version | Detail |\n'
    printf '|---|---|---|---|\n'
    local i=0
    while [ "$i" -lt "${#CAP_NAMES[@]}" ]; do
      printf '| %s | %s | %s | %s |\n' \
        "${CAP_NAMES[$i]}" "${CAP_STATUSES[$i]}" "${CAP_VERSIONS[$i]:--}" "${CAP_DETAILS[$i]}"
      i=$((i + 1))
    done
  } >"$md"

  {
    printf '{\n'
    printf '  "generatedAt": "%s",\n' "$ts"
    printf '  "mode": "%s",\n' "${MODE:-install}"
    printf '  "os": "%s",\n' "$(json_escape "${OS:-unknown}")"
    printf '  "osVersion": "%s",\n' "$(json_escape "${OS_VERSION:-}")"
    printf '  "distro": "%s",\n' "$(json_escape "${DISTRO_NAME:-}")"
    printf '  "arch": "%s",\n' "$(json_escape "${ARCH:-unknown}")"
    printf '  "desktop": "%s",\n' "$(json_escape "${DESKTOP:-none}")"
    printf '  "checkout": "%s",\n' "$(json_escape "${REPO_ROOT:-}")"
    printf '  "agentDir": "%s",\n' "$(json_escape "${AGENT_DIR:-}")"
    printf '  "capabilities": [\n'
    local i=0
    while [ "$i" -lt "${#CAP_NAMES[@]}" ]; do
      printf '    {"name":"%s","status":"%s","version":"%s","detail":"%s"}' \
        "$(json_escape "${CAP_NAMES[$i]}")" "$(json_escape "${CAP_STATUSES[$i]}")" \
        "$(json_escape "${CAP_VERSIONS[$i]:-}")" "$(json_escape "${CAP_DETAILS[$i]}")"
      if [ "$i" -lt $((${#CAP_NAMES[@]} - 1)) ]; then printf ','; fi
      printf '\n'
      i=$((i + 1))
    done
    printf '  ]\n}\n'
  } >"$json"
}

version_ge() {
  awk -v a="$1" -v b="$2" 'BEGIN {
    na = split(a, x, "."); nb = split(b, y, ".")
    for (i = 1; i <= 3; i++) {
      xi = ((i <= na) ? x[i] : 0) + 0
      yi = ((i <= nb) ? y[i] : 0) + 0
      if (xi > yi) exit 0
      if (xi < yi) exit 1
    }
    exit 0
  }'
}

first_version() {
  grep -Eo '[0-9]+(\.[0-9]+)+' | head -n 1
}

tool_version() {
  "$@" 2>&1 | head -n 6 | first_version
}

have() {
  command -v "$1" >/dev/null 2>&1
}

sha256_file() {
  if have sha256sum; then
    sha256sum "$1" | awk '{print $1}'
  else
    shasum -a 256 "$1" | awk '{print $1}'
  fi
}

detect_os() {
  OS=unknown
  OS_VERSION=
  DISTRO_ID=
  DISTRO_VERSION=
  DISTRO_NAME=
  ARCH_RAW=$(uname -m)
  case "$ARCH_RAW" in
    arm64|aarch64) ARCH=arm64 ;;
    x86_64|amd64) ARCH=x64 ;;
    *) ARCH=$ARCH_RAW ;;
  esac

  case "$(uname -s)" in
    Darwin)
      OS=macos
      OS_VERSION=$(sw_vers -productVersion 2>/dev/null || true)
      DISTRO_ID=macos
      DISTRO_NAME="macOS ${OS_VERSION}"
      ;;
    Linux)
      OS=linux
      if [ -r /etc/os-release ]; then
        DISTRO_ID=$(os_release_value ID)
        DISTRO_VERSION=$(os_release_value VERSION_ID)
        DISTRO_NAME=$(os_release_value PRETTY_NAME)
        [ -n "$DISTRO_NAME" ] || DISTRO_NAME="$DISTRO_ID $DISTRO_VERSION"
      fi
      [ -n "$DISTRO_ID" ] || DISTRO_ID=linux
      [ -n "$DISTRO_NAME" ] || DISTRO_NAME="Linux ${DISTRO_VERSION}"
      ;;
    *)
      OS=unsupported
      DISTRO_NAME=$(uname -s)
      ;;
  esac

  PKG_MANAGER=none
  if [ "$OS" = macos ] && have brew; then
    PKG_MANAGER=brew
  elif have apt-get; then
    PKG_MANAGER=apt-get
  elif have dnf; then
    PKG_MANAGER=dnf
  elif have tdnf; then
    PKG_MANAGER=tdnf
  elif have zypper; then
    PKG_MANAGER=zypper
  elif have yum; then
    PKG_MANAGER=yum
  elif have pacman; then
    PKG_MANAGER=pacman
  fi

  SUDO_CMD=
  IS_ROOT=0
  if [ "$(id -u)" -eq 0 ]; then
    IS_ROOT=1
  elif have sudo && sudo -n true >/dev/null 2>&1; then
    SUDO_CMD="sudo -n"
  fi
}

os_release_value() {
  awk -F= -v key="$1" '$1 == key {
    sub(/^[^=]*=/, ""); gsub(/^"|"$/, ""); print; exit
  }' /etc/os-release 2>/dev/null
}

detect_desktop() {
  DESKTOP=none
  if [ "${OS:-}" = macos ]; then
    if [ "$(launchctl managername 2>/dev/null || true)" = Aqua ]; then
      DESKTOP=macos-aqua
    fi
    return 0
  fi
  if [ "${OS:-}" = linux ]; then
    if [ -n "${XDG_SESSION_TYPE:-}" ] && [ "${XDG_SESSION_TYPE:-}" != tty ]; then
      DESKTOP="linux-${XDG_SESSION_TYPE}"
    elif [ -n "${WAYLAND_DISPLAY:-}" ]; then
      DESKTOP=linux-wayland
    elif [ -n "${DISPLAY:-}" ]; then
      DESKTOP=linux-x11
    fi
  fi
}

detect_vulkan() {
  VULKAN=unknown
  if [ "${OS:-}" = macos ]; then
    VULKAN=not-applicable
    return 0
  fi
  if have vulkaninfo && vulkaninfo --summary >/dev/null 2>&1; then
    VULKAN=working
  elif ls /usr/share/vulkan/icd.d/*.json >/dev/null 2>&1; then
    VULKAN=icd-present-unverified
  elif ldconfig -p 2>/dev/null | grep -q 'libvulkan\.so'; then
    VULKAN=loader-present-unverified
  else
    VULKAN=absent
  fi
}

effective_home() {
  if [ "$(id -u)" -eq 0 ] && [ -n "${SUDO_USER:-}" ] && [ "${SUDO_USER:-}" != root ]; then
    if have getent; then
      getent passwd "$SUDO_USER" | cut -d: -f6
    else
      dscl . -read "/Users/$SUDO_USER" NFSHomeDirectory 2>/dev/null | awk '{print $2}'
    fi
  else
    printf '%s' "${HOME:-}"
  fi
}

