#!/usr/bin/env bash
# Opt-in private virtual desktop for the local Cua Driver.
#
# Sourced by scripts/setup.sh after common.sh and steps.sh. Detection and reporting are
# read-only; installation only happens in MODE=install with the desktop group selected.
# Linux only: this never runs on macOS and never changes the default Linux install path.
#
# The composition itself lives in scripts/desktop/astack-desktop, so the installer only
# checks dependencies, installs them, wires the systemd user unit and reports readiness.

DESKTOP_HELPER="$REPO_ROOT/scripts/desktop/astack-desktop"
DESKTOP_UNIT_NAME=astack-desktop.service
DESKTOP_STATE_DIR=${XDG_STATE_HOME:-$HOME/.local/state}/astack-desktop
DESKTOP_STATUS=""
NO_DESKTOP_START=${NO_DESKTOP_START:-0}

# Package list for Xvfb + full XFCE + session D-Bus + AT-SPI + the driver runtime libraries,
# the owned GTK3 verification window, and ffmpeg for x11grab capture.
desktop_package_list() {
  printf '%s\n' \
    xvfb xauth x11-utils x11-xserver-utils \
    xfce4 xfce4-terminal \
    dbus dbus-x11 at-spi2-core libatk-bridge2.0-0 libatk-adaptor libgail-common \
    python3-gi gir1.2-gtk-3.0 libxi6 \
    ffmpeg
}

desktop_supported() {
  [ "${OS:-}" = linux ] || return 1
  [ "${PKG_MANAGER:-none}" = apt-get ] || return 1
  case "${DISTRO_ID:-}" in
    ubuntu|debian) return 0 ;;
    *) return 1 ;;
  esac
}

desktop_stack_present() {
  [ "${OS:-}" = linux ] || return 1
  have Xvfb && have startxfce4 && have dbus-daemon
}

desktop_pkg_installed() {
  have dpkg-query || return 1
  dpkg-query -W -f='${Status}' "$1" 2>/dev/null | grep -q 'install ok installed'
}

desktop_missing_packages() {
  local pkg missing=""
  for pkg in $(desktop_package_list); do
    desktop_pkg_installed "$pkg" || missing="$missing $pkg"
  done
  printf '%s' "$missing"
}

desktop_binaries() {
  printf '%s\n' Xvfb xauth xdpyinfo startxfce4 dbus-daemon ffmpeg
}

desktop_missing_binaries() {
  local bin missing=""
  for bin in $(desktop_binaries); do
    have "$bin" || missing="$missing $bin"
  done
  printf '%s' "$missing"
}

desktop_helper_call() {
  bash "$DESKTOP_HELPER" "$@"
}

desktop_status_refresh() {
  DESKTOP_STATUS=$(desktop_helper_call status 2>/dev/null || true)
}

desktop_status_value() {
  printf '%s\n' "$DESKTOP_STATUS" | sed -n "s/^$1=//p" | head -n 1
}

desktop_record_unsupported() {
  local reason=$1
  record_cap desktop-packages unsupported "$reason"
  record_cap desktop-runtime unsupported "$reason"
  record_cap desktop-driver unsupported "$reason"
  record_cap desktop-video unsupported "$reason"
  record_cap desktop-unit unsupported "$reason"
}

desktop_note_not_requested() {
  [ "${OS:-}" = linux ] || return 0
  record_cap desktop-runtime manual \
    "not requested; pass --desktop to install and start the private Xvfb/XFCE desktop"
}

desktop_install_packages() {
  local missing
  missing=$(desktop_missing_packages)
  if [ -z "$missing" ]; then
    record_cap desktop-packages ready "Xvfb, XFCE, session D-Bus, AT-SPI, GTK and ffmpeg present" ""
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap desktop-packages manual "missing:$missing" ""
    return 0
  fi
  if [ "$IS_ROOT" -ne 1 ] && [ -z "$SUDO_CMD" ]; then
    record_cap desktop-packages manual \
      "installation needs root; run: sudo apt-get install -y$(printf '%s' "$missing")" ""
    return 0
  fi
  # shellcheck disable=SC2086
  if ! pm_install $missing; then
    record_cap desktop-packages failed "package installation failed (see $LOG_DIR/system-packages.log)" ""
    return 1
  fi
  missing=$(desktop_missing_packages)
  if [ -n "$missing" ]; then
    record_cap desktop-packages failed "still missing after install:$missing" ""
    return 1
  fi
  record_cap desktop-packages installed "installed Xvfb, XFCE, session D-Bus, AT-SPI, GTK and ffmpeg" ""
  return 0
}

desktop_record_runtime() {
  desktop_status_refresh
  local state display wm bus a11y xserver
  state=$(desktop_status_value state)
  display=$(desktop_status_value display)
  wm=$(desktop_status_value wm)
  bus=$(desktop_status_value session_bus)
  a11y=$(desktop_status_value a11y_bus)
  xserver=$(desktop_status_value x_server)
  if [ "$state" = running ]; then
    record_cap desktop-runtime ready \
      "$display on Xvfb; window manager $wm; session D-Bus and AT-SPI reachable" ""
  elif [ "${OS:-}" = linux ] && [ "$xserver" = reachable ]; then
    record_cap desktop-runtime manual \
      "$display reachable but incomplete (wm=$wm bus=$bus a11y=$a11y); see $DESKTOP_STATE_DIR/session.log" ""
  else
    record_cap desktop-runtime manual \
      "not running; start it with: systemctl --user start astack-desktop" ""
  fi
}

desktop_record_video() {
  if ! have ffmpeg; then
    record_cap desktop-video manual "ffmpeg not installed" ""
    return 0
  fi
  if ! ffmpeg -hide_banner -version >/dev/null 2>&1; then
    record_cap desktop-video failed "ffmpeg is installed but not runnable" ""
    return 0
  fi
  if ffmpeg -hide_banner -devices 2>/dev/null | grep -q 'x11grab'; then
    record_cap desktop-video ready "ffmpeg with x11grab; H.264 capture of the main display" \
      "$(ffmpeg -hide_banner -version 2>/dev/null | sed -n '1s/^ffmpeg version \([^ ]*\).*/\1/p')"
  else
    record_cap desktop-video manual "this ffmpeg build has no x11grab input device" ""
  fi
}

desktop_systemctl_user() {
  local runtime
  runtime=${XDG_RUNTIME_DIR:-}
  [ -n "$runtime" ] || runtime=/run/user/$(id -u)
  XDG_RUNTIME_DIR=$runtime \
  DBUS_SESSION_BUS_ADDRESS=unix:path=$runtime/bus \
    systemctl --user "$@"
}

desktop_user_manager_available() {
  have systemctl || return 1
  desktop_systemctl_user show-environment >/dev/null 2>&1
}

desktop_install_unit() {
  local out result
  if [ ! -f "$DESKTOP_HELPER" ]; then
    record_cap desktop-unit failed "desktop helper missing: $DESKTOP_HELPER"
    return 1
  fi
  if [ "$MODE" = check ]; then
    out=$(desktop_helper_call unit status 2>/dev/null || true)
    case "$out" in
      *unit=installed*) record_cap desktop-unit ready "systemd user unit present" "" ;;
      *unit=foreign*) record_cap desktop-unit manual "an unrelated unit file already exists; left unchanged" "" ;;
      *) record_cap desktop-unit manual "unit not installed; setup writes it for this checkout" "" ;;
    esac
    return 0
  fi
  out=$(desktop_helper_call unit install 2>&1)
  result=$?
  printf '%s\n' "$out" | sed 's/^/  /'
  case "$result" in
    0) : ;;
    3) record_cap desktop-unit manual "existing unit was not written by Astack; left unchanged" ""; return 0 ;;
    *) record_cap desktop-unit failed "could not write the systemd user unit"; return 1 ;;
  esac
  if ! desktop_user_manager_available; then
    record_cap desktop-unit manual \
      "unit written but no systemd user manager is running here; start a login session for this user, then: systemctl --user enable --now astack-desktop" ""
    return 0
  fi
  desktop_systemctl_user daemon-reload >/dev/null 2>&1 || true
  if [ "$NO_DESKTOP_START" = 1 ]; then
    desktop_systemctl_user enable "$DESKTOP_UNIT_NAME" >/dev/null 2>&1 || true
    record_cap desktop-unit installed "unit enabled; not started (--no-desktop-start)" ""
    return 0
  fi
  if ! desktop_systemctl_user enable --now "$DESKTOP_UNIT_NAME" >>"$LOG_DIR/desktop-session.log" 2>&1; then
    tail_log "$LOG_DIR/desktop-session.log"
    record_cap desktop-unit failed "systemd could not start astack-desktop (see $LOG_DIR/desktop-session.log)"
    return 1
  fi
  record_cap desktop-unit installed "systemd user unit enabled and started" ""
}

desktop_wait_ready() {
  # No invented readiness age: keep waiting while the unit is still up, and stop as soon as the
  # unit itself reports failure or inactivity. systemd owns the service lifecycle.
  while :; do
    desktop_status_refresh
    if [ "$(desktop_status_value state)" = running ]; then
      return 0
    fi
    if ! desktop_systemctl_user is-active --quiet "$DESKTOP_UNIT_NAME"; then
      return 1
    fi
    sleep 0.5
  done
}

desktop_start() {
  [ "$MODE" = install ] || return 0
  if [ "$NO_DESKTOP_START" = 1 ]; then
    return 0
  fi
  if ! desktop_user_manager_available; then
    record_cap desktop-session-start manual \
      "no systemd user manager; start the session with: $DESKTOP_HELPER session"
    return 0
  fi
  if desktop_wait_ready; then
    return 0
  fi
  tail_log "$DESKTOP_STATE_DIR/session.log"
  record_cap desktop-session-start failed \
    "the desktop unit stopped before the session became ready (display, WM, bus, AT-SPI); see $DESKTOP_STATE_DIR/session.log"
  return 1
}

ensure_desktop() {
  if ! desktop_supported; then
    desktop_record_unsupported \
      "the private desktop is Ubuntu/Debian with apt-get only (detected ${DISTRO_NAME:-unknown}, manager ${PKG_MANAGER:-none})"
    return 0
  fi
  desktop_install_packages || true
  local missing
  missing=$(desktop_missing_binaries)
  if [ -n "$missing" ]; then
    if [ "$MODE" = check ]; then
      # Check mode reports what is absent; it never claims an installation attempt failed.
      if [ "$(cap_status desktop-packages)" != manual ]; then
        record_cap desktop-packages manual "required binaries not present:$missing"
      fi
      return 0
    fi
    record_cap desktop-packages failed "required binaries still missing:$missing"
    return 1
  fi
  desktop_record_video
  if [ "$MODE" = check ]; then
    # Read-only observation; no unit start and no startup wait.
    desktop_install_unit
    return 0
  fi
  desktop_install_unit || true
  desktop_start || true
  return 0
}

desktop_report() {
  if ! desktop_supported; then
    return 0
  fi
  desktop_record_runtime
  desktop_record_video
  if [ -x "$DESKTOP_HELPER" ]; then
    case "$(desktop_helper_call unit status 2>/dev/null || true)" in
      *unit=installed*)
        if [ "$(cap_status desktop-unit)" != ready ] && [ "$(cap_status desktop-unit)" != installed ]; then
          record_cap desktop-unit ready "systemd user unit present" ""
        fi
        ;;
    esac
  fi
  local cua_version
  if find_cua; then
    cua_version=$(tool_version "$CUA_BIN" --version)
    record_cap desktop-driver ready \
      "local Cua Driver binary present; MCP uses this same session environment when Pi is started with 'astack-desktop run -- pi'" \
      "$cua_version"
  else
    record_cap desktop-driver manual "cua-driver not installed; run setup with the cua group" ""
  fi
}
