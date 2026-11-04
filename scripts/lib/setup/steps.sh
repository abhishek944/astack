#!/usr/bin/env bash
# Installer phases for scripts/setup.sh. Sourced after common.sh.
# Every phase checks first and only acts when MODE=install.

PKG_LOG_DIR=""
CHROME_BIN=""
CHROME_KIND=""
CUA_BIN=""
UV_VERSION=""

log_cmd() {
  local label=$1 logfile=$2
  shift 2
  mkdir -p "$(dirname "$logfile")"
  printf '\n### %s\n$ %s\n' "$label" "$*" >>"$logfile"
  "$@" >>"$logfile" 2>&1
}

tail_log() {
  local logfile=$1
  printf '  Last lines of %s:\n' "$logfile"
  tail -n 15 "$logfile" 2>/dev/null | sed 's/^/    /'
}

pm_install() {
  [ "$MODE" = install ] || return 1
  [ "$PKG_MANAGER" != none ] || return 1
  [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO_CMD" ] || [ "$PKG_MANAGER" = brew ] || return 1
  local log="$LOG_DIR/system-packages.log"
  mkdir -p "$LOG_DIR"
  printf '\n### package install: %s\n' "$*" >>"$log"
  case "$PKG_MANAGER" in
    brew)
      HOMEBREW_NO_AUTO_UPDATE=1 brew install "$@" >>"$log" 2>&1 || { tail_log "$log"; return 1; }
      ;;
    apt-get)
      $SUDO_CMD apt-get update -qq >>"$log" 2>&1 || true
      $SUDO_CMD env DEBIAN_FRONTEND=noninteractive apt-get install -y "$@" >>"$log" 2>&1 || { tail_log "$log"; return 1; }
      ;;
    dnf|tdnf|yum)
      $SUDO_CMD "$PKG_MANAGER" install -y "$@" >>"$log" 2>&1 || { tail_log "$log"; return 1; }
      ;;
    zypper)
      $SUDO_CMD zypper --non-interactive install "$@" >>"$log" 2>&1 || { tail_log "$log"; return 1; }
      ;;
    pacman)
      $SUDO_CMD pacman -Sy --noconfirm "$@" >>"$log" 2>&1 || { tail_log "$log"; return 1; }
      ;;
    *) return 1 ;;
  esac
}

ensure_base_tools() {
  local missing="" t
  for t in git curl tar; do
    have "$t" || missing="$missing $t"
  done
  if [ -z "$missing" ]; then
    record_cap base-tools ready "git, curl, tar present" \
      "$(tool_version git --version)"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap base-tools manual "missing:$missing" ""
    return 0
  fi
  # shellcheck disable=SC2086
  if pm_install $missing; then
    missing=""
    for t in git curl tar; do have "$t" || missing="$missing $t"; done
    if [ -z "$missing" ]; then
      record_cap base-tools installed "git, curl, tar present" "$(tool_version git --version)"
      return 0
    fi
  fi
  record_cap base-tools failed "could not install:$missing (manager: $PKG_MANAGER)"
  return 1
}

node_version() {
  have node || return 1
  tool_version node -v
}

npm_version() {
  have npm || return 1
  tool_version npm -v
}

node_compatible() {
  local nv
  nv=$(node_version 2>/dev/null || true)
  [ -n "$nv" ] && version_ge "$nv" "$NODE_MIN"
}

install_node_tarball() {
  local version platform archive base url expected actual dest target tmp
  version=$(curl -fsSL https://nodejs.org/dist/index.json \
    | grep -o '"version"[[:space:]]*:[[:space:]]*"v22\.[0-9.]*"' \
    | head -n 1 | grep -Eo 'v22\.[0-9.]+')
  [ -n "$version" ] || { record_cap node failed "could not resolve Node 22 release index"; return 1; }
  platform=linux
  [ "$OS" = macos ] && platform=darwin
  archive="node-${version}-${platform}-${ARCH}.tar.gz"
  base="https://nodejs.org/dist/${version}"
  url="${base}/${archive}"
  mkdir -p "$ASTACK_HOME/runtime" "$LOG_DIR" "$ASTACK_BIN"
  tmp="$ASTACK_HOME/runtime/${archive}.download"
  printf '  downloading %s\n' "$url"
  curl -fSL --retry 2 -o "$tmp" "$url" >>"$LOG_DIR/runtime-install.log" 2>&1 \
    || { tail_log "$LOG_DIR/runtime-install.log"; record_cap node failed "download failed: $url"; return 1; }
  curl -fsSL -o "$tmp.sums" "${base}/SHASUMS256.txt" >>"$LOG_DIR/runtime-install.log" 2>&1 \
    || { tail_log "$LOG_DIR/runtime-install.log"; record_cap node failed "checksum list download failed"; return 1; }
  expected=$(awk -v f="$archive" '$2 == f { print $1; exit }' "$tmp.sums")
  actual=$(sha256_file "$tmp")
  if [ -z "$expected" ] || [ "$expected" != "$actual" ]; then
    rm -f "$tmp" "$tmp.sums"
    record_cap node failed "checksum verification failed for $archive"
    return 1
  fi
  rm -f "$tmp.sums"
  dest="$ASTACK_HOME/runtime/node-${version}-${platform}-${ARCH}"
  if [ ! -x "$dest/bin/node" ]; then
    rm -rf "$dest"
    mkdir -p "$dest"
    tar -xzf "$tmp" -C "$dest" --strip-components=1 >>"$LOG_DIR/runtime-install.log" 2>&1 \
      || { tail_log "$LOG_DIR/runtime-install.log"; record_cap node failed "extract failed"; return 1; }
  fi
  rm -f "$tmp"
  for target in node npm npx corepack; do
    [ -e "$dest/bin/$target" ] && ln -sfn "$dest/bin/$target" "$ASTACK_BIN/$target"
  done
  export PATH="$ASTACK_BIN:$PATH"
  hash -r 2>/dev/null || true
  if node_compatible && have npm && version_ge "$(npm_version)" "$NPM_MIN"; then
    record_cap node installed "user-local Node 22 tarball (checksum verified)" "$(node_version)"
    record_cap npm installed "bundled with user-local Node" "$(npm_version)"
    return 0
  fi
  record_cap node failed "installed tarball did not satisfy Node >=$NODE_MIN"
  return 1
}

ensure_node() {
  if node_compatible && have npm && version_ge "$(npm_version)" "$NPM_MIN"; then
    record_cap node ready "existing runtime reused" "$(node_version)"
    record_cap npm ready "existing runtime reused" "$(npm_version)"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap node manual "Node >=${NODE_MIN} / npm >=${NPM_MIN} not found" "$(node_version 2>/dev/null || true)"
    record_cap npm manual "npm >=${NPM_MIN} required" "$(npm_version 2>/dev/null || true)"
    return 0
  fi
  if [ "$OS" = macos ] && have brew; then
    if HOMEBREW_NO_AUTO_UPDATE=1 brew install node@22 >>"$LOG_DIR/runtime-install.log" 2>&1; then
      local prefix
      prefix=$(brew --prefix node@22 2>/dev/null || true)
      if [ -n "$prefix" ] && [ -x "$prefix/bin/node" ]; then
        mkdir -p "$ASTACK_BIN"
        local b
        for b in node npm npx; do
          [ -e "$prefix/bin/$b" ] && ln -sfn "$prefix/bin/$b" "$ASTACK_BIN/$b"
        done
        export PATH="$ASTACK_BIN:$prefix/bin:$PATH"
        hash -r 2>/dev/null || true
      fi
    else
      tail_log "$LOG_DIR/runtime-install.log"
      printf '  Homebrew node@22 failed; falling back to the official tarball.\n'
    fi
  fi
  if node_compatible && have npm && version_ge "$(npm_version)" "$NPM_MIN"; then
    record_cap node installed "Homebrew node@22 linked into $ASTACK_BIN" "$(node_version)"
    record_cap npm installed "Homebrew npm linked into $ASTACK_BIN" "$(npm_version)"
    return 0
  fi
  install_node_tarball
}

ensure_uv() {
  if have uv; then
    UV_VERSION=$(tool_version uv --version)
    record_cap uv ready "existing uv reused" "$UV_VERSION"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap uv manual "uv not found (needed for browser-use/Python 3.12)" ""
    return 0
  fi
  mkdir -p "$LOG_DIR" "$HOME/.local/bin"
  (
    export UV_NO_MODIFY_PATH=1
    export UV_INSTALL_DIR="$HOME/.local/bin"
    curl -LsSf https://astral.sh/uv/install.sh | sh
  ) >>"$LOG_DIR/runtime-install.log" 2>&1 || {
    tail_log "$LOG_DIR/runtime-install.log"
    record_cap uv failed "official uv installer failed"
    return 1
  }
  export PATH="$HOME/.local/bin:$PATH"
  hash -r 2>/dev/null || true
  if have uv; then
    UV_VERSION=$(tool_version uv --version)
    record_cap uv installed "installed through the official uv script" "$UV_VERSION"
    return 0
  fi
  record_cap uv failed "uv not available after install"
  return 1
}

find_python() {
  local c v best="" bestv=""
  for c in python3 python3.13 python3.12 python3.11; do
    have "$c" || continue
    v=$(tool_version "$c" -V)
    [ -n "$v" ] || continue
    if [ -z "$bestv" ] || version_ge "$v" "$bestv"; then
      best=$c
      bestv=$v
    fi
  done
  if [ -n "$best" ]; then
    printf '%s %s' "$best" "$bestv"
  fi
}

ensure_python() {
  local found c v managed
  found=$(find_python)
  if [ -n "$found" ]; then
    c=${found%% *}
    v=${found##* }
    if version_ge "$v" 3.11.0; then
      record_cap python ready "existing Python reused" "$v"
      return 0
    fi
    # A system Python exists but is older. Never replace the OS interpreter.
    if [ "$MODE" = check ]; then
      if have uv; then
        managed=$(uv python find 3.12 2>/dev/null || true)
        if [ -n "$managed" ] && [ -x "$managed" ]; then
          record_cap python ready "OS Python $v preserved; uv-managed 3.12 available" "$v"
          return 0
        fi
      fi
      record_cap python manual "system Python $v < 3.11; uv-managed 3.12 needed" "$v"
      return 0
    fi
    ensure_uv || true
    if have uv; then
      if uv python install 3.12 >>"$LOG_DIR/runtime-install.log" 2>&1; then
        managed=$(uv python find 3.12 2>/dev/null || true)
        if [ -n "$managed" ] && [ -x "$managed" ]; then
          mkdir -p "$ASTACK_BIN"
          ln -sfn "$managed" "$ASTACK_BIN/python3.12"
          record_cap python ready "OS Python $v preserved; uv-managed 3.12 at $ASTACK_BIN/python3.12" "$v"
          return 0
        fi
      fi
    fi
    record_cap python manual "system Python $v < 3.11; install uv then run: uv python install 3.12" "$v"
    return 0
  fi

  if [ "$MODE" = check ]; then
    record_cap python manual "no Python 3 found" ""
    return 0
  fi
  if pm_install python3; then
    found=$(find_python)
    if [ -n "$found" ]; then
      c=${found%% *}
      v=${found##* }
      if version_ge "$v" 3.11.0; then
        record_cap python installed "installed with $PKG_MANAGER" "$v"
        return 0
      fi
      # The installed OS Python is still too old; use uv-managed 3.12.
      ensure_uv || true
      if have uv && uv python install 3.12 >>"$LOG_DIR/runtime-install.log" 2>&1; then
        managed=$(uv python find 3.12 2>/dev/null || true)
        if [ -n "$managed" ] && [ -x "$managed" ]; then
          mkdir -p "$ASTACK_BIN"
          ln -sfn "$managed" "$ASTACK_BIN/python3.12"
          record_cap python ready "OS Python $v preserved; uv-managed 3.12 at $ASTACK_BIN/python3.12" "$v"
          return 0
        fi
      fi
      record_cap python manual "system Python $v < 3.11; install uv then run: uv python install 3.12" "$v"
      return 0
    fi
  elif [ "$OS" = macos ] && pm_install python@3.12; then
    if [ -x "$(brew --prefix python@3.12 2>/dev/null)/bin/python3.12" ]; then
      mkdir -p "$ASTACK_BIN"
      ln -sfn "$(brew --prefix python@3.12)/bin/python3.12" "$ASTACK_BIN/python3.12"
      record_cap python installed "Homebrew python@3.12 linked into $ASTACK_BIN" "3.12"
      return 0
    fi
  fi
  ensure_uv || true
  if have uv; then
    if uv python install 3.12 >>"$LOG_DIR/runtime-install.log" 2>&1; then
      managed=$(uv python find 3.12 2>/dev/null || true)
      if [ -n "$managed" ] && [ -x "$managed" ]; then
        mkdir -p "$ASTACK_BIN"
        ln -sfn "$managed" "$ASTACK_BIN/python3.12"
        record_cap python installed "uv-managed Python 3.12" "3.12"
        return 0
      fi
    fi
  fi
  record_cap python failed "no Python 3 and no supported install route"
  return 1
}

pi_version_compatible() {
  local pv
  pv=$(tool_version pi --version 2>/dev/null || true)
  [ -n "$pv" ] && version_ge "$pv" "$PI_MIN"
}

select_installed_pi() {
  local candidate=$1 current candidate_real current_real backup
  [ -x "$candidate" ] || return 1
  candidate_real=$(resolve_path "$candidate")
  current=$(command -v pi 2>/dev/null || true)
  if [ -n "$current" ]; then
    current_real=$(resolve_path "$current")
    if [ "$current_real" = "$candidate_real" ]; then
      return 0
    fi
    if pi_version_compatible; then
      # Keep the already-compatible Pi the user selected.
      return 0
    fi
  fi
  mkdir -p "$ASTACK_BIN"
  if [ -L "$ASTACK_BIN/pi" ]; then
    if [ "$(resolve_path "$ASTACK_BIN/pi")" != "$candidate_real" ]; then
      backup="$ASTACK_BIN/pi.backup-$SETUP_STAMP"
      { [ -e "$backup" ] || [ -L "$backup" ]; } && backup="$backup-$$"
      mv "$ASTACK_BIN/pi" "$backup" || return 1
      PI_SELECT_NOTE="prior symlink backed up to $backup; "
    fi
  elif [ -e "$ASTACK_BIN/pi" ]; then
    PI_SELECT_NOTE="refusing to overwrite non-symlink $ASTACK_BIN/pi; "
    return 1
  fi
  if [ ! -L "$ASTACK_BIN/pi" ] && [ ! -e "$ASTACK_BIN/pi" ]; then
    ln -s "$candidate" "$ASTACK_BIN/pi" || return 1
  fi
  export PATH="$ASTACK_BIN:$PATH"
  hash -r 2>/dev/null || true
  current=$(command -v pi 2>/dev/null || true)
  [ -n "$current" ] || return 1
  [ "$(resolve_path "$current")" = "$candidate_real" ]
}

ensure_pi() {
  local pv prefix candidate
  local -a prefix_args=()
  PI_SELECT_NOTE=""
  if have pi; then
    pv=$(tool_version pi --version)
    if [ -n "$pv" ] && version_ge "$pv" "$PI_MIN"; then
      record_cap pi ready "existing Pi reused" "$pv"
      return 0
    fi
  fi
  if [ "$MODE" = check ]; then
    record_cap pi manual "Pi >=${PI_MIN} not found or too old" "$(tool_version pi --version 2>/dev/null || true)"
    return 0
  fi
  if ! have npm; then
    record_cap pi failed "npm unavailable; cannot install Pi"
    return 1
  fi
  prefix=$(npm config get prefix 2>/dev/null || true)
  if [ -z "$prefix" ] || { [ ! -w "$prefix" ] && [ "$IS_ROOT" -ne 1 ]; }; then
    # Distro npm prefixes are usually /usr. Install Pi into the owned Astack
    # prefix instead of elevating or changing the user's npm config.
    prefix="$ASTACK_HOME/npm-global"
    mkdir -p "$prefix"
    prefix_args=(--prefix "$prefix")
  fi
  if npm install -g --ignore-scripts "${prefix_args[@]+"${prefix_args[@]}"}" @earendil-works/pi-coding-agent >>"$LOG_DIR/runtime-install.log" 2>&1; then
    hash -r 2>/dev/null || true
    candidate="$prefix/bin/pi"
    if [ ! -x "$candidate" ]; then
      record_cap pi failed "npm reported success but $candidate is missing"
      return 1
    fi
    if ! pi_version_compatible; then
      if ! select_installed_pi "$candidate"; then
        record_cap pi manual "compatible Pi installed at $candidate but not selected: ${PI_SELECT_NOTE}resolve the entry and rerun" "$(tool_version pi --version 2>/dev/null || true)"
        return 0
      fi
    fi
    hash -r 2>/dev/null || true
    pv=$(tool_version pi --version)
    if [ -n "$pv" ] && version_ge "$pv" "$PI_MIN"; then
      record_cap pi installed "${PI_SELECT_NOTE}installed with npm --ignore-scripts (prefix $prefix)" "$pv"
      return 0
    fi
    record_cap pi failed "installed Pi is not selected or compatible (resolved $(command -v pi 2>/dev/null || printf 'none'), version ${pv:-unknown})"
    return 1
  fi
  tail_log "$LOG_DIR/runtime-install.log"
  record_cap pi failed "Pi install or version verification failed"
  return 1
}

write_env_file() {
  local env_file="$ASTACK_HOME/env.sh" tmp
  if [ "$MODE" = check ]; then
    if [ -f "$env_file" ]; then
      record_cap env-file ready "source $env_file in a new shell" ""
    else
      record_cap env-file manual "setup will write $env_file for future shells" ""
    fi
    return 0
  fi
  mkdir -p "$ASTACK_HOME"
  tmp="$env_file.tmp.$$"
  {
    printf '# Generated by Astack setup. Source this file, or add these paths, in a new shell.\n'
    printf 'export ASTACK_HOME="%s"\n' "$ASTACK_HOME"
    printf 'export PATH="%s:$HOME/.local/bin:$PATH"\n' "$ASTACK_BIN"
  } >"$tmp"
  if [ -f "$env_file" ] && cmp -s "$tmp" "$env_file"; then
    rm -f "$tmp"
  else
    mv "$tmp" "$env_file"
  fi
  record_cap env-file ready "source $env_file in a new shell" ""
}

ensure_runtimes() {
  ensure_base_tools || true
  ensure_node || true
  ensure_uv || true
  ensure_python || true
  ensure_pi || true
  write_env_file
}

package_install_hash() {
  local dir=$1 pkg=$2 lock=$3
  if have sha256sum; then
    { printf '%s\n' "$OS/$ARCH"; cat "$pkg"; [ -f "$lock" ] && cat "$lock"; } | sha256sum | awk '{print $1}'
  else
    { printf '%s\n' "$OS/$ARCH"; cat "$pkg"; [ -f "$lock" ] && cat "$lock"; } | shasum -a 256 | awk '{print $1}'
  fi
}

install_one_package() {
  local dir=$1
  local name=$2
  local pkg="$dir/package.json"
  local lock="$dir/package-lock.json"
  local cap="pkg-$name" stamp expected log has_build has_deps deps_current=0
  [ -f "$pkg" ] || { record_cap "$cap" failed "package.json missing"; return 1; }
  if ! have node; then
    record_cap "$cap" manual "Node is unavailable; cannot inspect/install dependencies" ""
    return 0
  fi
  has_build=$(node -e 'const p=require(process.argv[1]);process.stdout.write(p.scripts&&p.scripts.build?"1":"0")' "$pkg" 2>/dev/null || printf '0')
  has_deps=$(node -e 'const p=require(process.argv[1]);process.stdout.write((p.dependencies&&Object.keys(p.dependencies).length)||(p.devDependencies&&Object.keys(p.devDependencies).length)?"1":"0")' "$pkg" 2>/dev/null || printf '0')
  if [ "$has_deps" = 0 ] && [ "$has_build" = 0 ]; then
    record_cap "$cap" ready "no dependencies or build" ""
    return 0
  fi
  stamp="$dir/node_modules/.astack-setup/stamp"
  expected=$(package_install_hash "$dir" "$pkg" "$lock")
  if [ -d "$dir/node_modules" ] && [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$expected" ]; then
    deps_current=1
  fi
  if [ "$MODE" = check ]; then
    if [ "$deps_current" -eq 0 ]; then
      record_cap "$cap" manual "run setup to install dependencies/build" ""
    elif [ "$has_build" = 1 ] && [ ! -d "$dir/dist" ]; then
      record_cap "$cap" manual "dependencies current but build output is missing; run setup to build" ""
    elif [ "$has_build" = 1 ]; then
      record_cap "$cap" ready "dependencies current; build present (check mode did not build)" ""
    else
      record_cap "$cap" ready "dependencies current (check mode made no changes)" ""
    fi
    return 0
  fi
  log="$PKG_LOG_DIR/$name.log"
  if [ "$deps_current" -eq 0 ] && [ "$has_deps" = 1 ]; then
    mkdir -p "$PKG_LOG_DIR"
    if [ -f "$lock" ]; then
      if ! log_cmd "$name npm ci" "$log" npm --prefix "$dir" ci --ignore-scripts --no-audit --no-fund; then
        tail_log "$log"
        record_cap "$cap" failed "npm ci failed (see $log)"
        return 1
      fi
    else
      if ! log_cmd "$name npm install" "$log" npm --prefix "$dir" install --ignore-scripts --no-package-lock --no-audit --no-fund; then
        tail_log "$log"
        record_cap "$cap" failed "npm install failed (see $log)"
        return 1
      fi
    fi
    mkdir -p "$(dirname "$stamp")"
    printf '%s\n' "$expected" >"$stamp"
  fi
  if [ "$has_build" = 1 ]; then
    mkdir -p "$PKG_LOG_DIR"
    if ! log_cmd "$name build" "$log" npm --prefix "$dir" run --silent build; then
      tail_log "$log"
      record_cap "$cap" failed "build failed (see $log)"
      return 1
    fi
  fi
  if [ "$deps_current" -eq 1 ] && [ "$has_build" = 0 ]; then
    record_cap "$cap" ready "dependencies current" ""
  elif [ "$deps_current" -eq 1 ]; then
    record_cap "$cap" ready "dependencies current; build completed" ""
  else
    record_cap "$cap" installed "dependencies installed; build completed" ""
  fi
  return 0
}

install_packages() {
  local name dir
  for name in $PACKAGE_ORDER; do
    dir="$REPO_ROOT/packages/$name"
    if [ ! -d "$dir" ]; then
      record_cap "pkg-$name" failed "package directory missing"
      continue
    fi
    install_one_package "$dir" "$name" || true
  done
}

register_packages() {
  local result_file="$LOG_DIR/register-result.txt" i ok=0 total=0 list_log="$LOG_DIR/pi-list.txt"
  if [ "$MODE" = check ]; then
    if [ -f "$AGENT_DIR/settings.json" ]; then
      total=0
      for i in $PACKAGE_ORDER; do
        total=$((total + 1))
        grep -Fq "packages/$i" "$AGENT_DIR/settings.json" && ok=$((ok + 1))
      done
      if [ "$ok" -eq "$total" ]; then
        record_cap packages ready "$ok/$total local checkout packages present in $AGENT_DIR/settings.json" ""
      else
        record_cap packages manual "$ok/$total local checkout packages present; run setup to merge without touching unrelated entries" ""
      fi
    else
      record_cap packages manual "no settings.json; run setup to create/merge local package entries" ""
    fi
    return 0
  fi
  if [ "$NO_CONFIG" = 1 ]; then
    record_cap packages manual "config writes disabled; add local package paths to $AGENT_DIR/settings.json" ""
    return 0
  fi
  mkdir -p "$AGENT_DIR" "$LOG_DIR"
  local node_args=(--agent-dir "$AGENT_DIR" --stamp "$SETUP_STAMP" --summary-file "$result_file")
  [ "$KEEP_PACKAGE_PATHS" = 1 ] && node_args+=(--keep-package-paths)
  local args=()
  for i in $PACKAGE_ORDER; do
    [ -d "$REPO_ROOT/packages/$i" ] && args+=("$REPO_ROOT/packages/$i")
  done
  node_args+=("${args[@]+"${args[@]}"}")
  if ! node "$REPO_ROOT/scripts/lib/setup/configure.mjs" packages "${node_args[@]}" >>"$LOG_DIR/configure.log" 2>&1; then
    tail_log "$LOG_DIR/configure.log"
    record_cap packages failed "settings merge failed (see $LOG_DIR/configure.log)"
    return 1
  fi
  if [ -f "$result_file" ] && grep -Eq '^conflicts=[1-9][0-9]*$' "$result_file"; then
    record_cap packages manual "kept conflicting/filtered same-name entries; local duplicates were not added (see $result_file)" ""
    return 0
  fi
  PI_CODING_AGENT_DIR="$AGENT_DIR" pi list --no-approve >"$list_log" 2>&1 || true
  total=${#args[@]}
  for i in "${args[@]}"; do
    if grep -Fq "$i" "$list_log"; then
      ok=$((ok + 1))
    fi
  done
  if [ "$ok" -eq "$total" ] && [ "$total" -gt 0 ]; then
    local detail="registered $ok/$total local packages; agent dir $AGENT_DIR"
    if [ -f "$result_file" ]; then
      detail="$detail; $(grep -E '^(added|replaced|kept|conflicts)=' "$result_file" | tr '\n' ' ')"
    fi
    if [ -f "$result_file" ] && grep -q '^changed=1' "$result_file"; then
      record_cap packages installed "$detail" ""
    else
      record_cap packages ready "$detail" ""
    fi
  elif [ "${#args[@]}" -gt 0 ]; then
    tail_log "$list_log"
    record_cap packages failed "pi list only resolved $ok/$total local packages"
    return 1
  fi
}

install_skills() {
  local installer="$REPO_ROOT/skills/pi-herdr-skills/scripts/install.sh"
  local check="$REPO_ROOT/skills/pi-herdr-skills/scripts/check-repo.sh"
  local dry="$LOG_DIR/skills-dry-run.log" log="$LOG_DIR/skills-install.log"
  local dryout conflicts=0 missing=0 installed=0
  if [ ! -f "$installer" ]; then
    record_cap shared-skills failed "shared installer missing"
    return 1
  fi
  if ! dryout=$(PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$installer" --dry-run --skip-conflicts 2>&1); then
    if [ "$MODE" = check ]; then
      printf '%s\n' "$dryout" | tail -n 15 | sed 's/^/    /'
    else
      mkdir -p "$LOG_DIR"
      printf '%s\n' "$dryout" >"$dry"
      tail_log "$dry"
    fi
    record_cap shared-skills failed "shared-skill dry-run failed"
    return 1
  fi
  conflicts=$(printf '%s\n' "$dryout" | grep -c '^Would skip conflict:' 2>/dev/null || true)
  missing=$(printf '%s\n' "$dryout" | grep -c '^Would install:' 2>/dev/null || true)

  if [ "$MODE" = check ]; then
    if [ "$conflicts" -eq 0 ] && [ "$missing" -eq 0 ]; then
      record_cap shared-skills ready "6 shared skills match the repository" ""
    else
      record_cap shared-skills manual "$conflicts conflict(s) preserved; $missing missing; run setup for additive install" ""
    fi
    return 0
  fi

  mkdir -p "$LOG_DIR"
  printf '%s\n' "$dryout" >"$dry"

  if [ "$conflicts" -gt 0 ] && [ "$missing" -eq 0 ]; then
    record_cap shared-skills manual "$conflicts conflict(s) preserved; remaining shared skills current" ""
    return 0
  fi
  if [ "$missing" -eq 0 ]; then
    if PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$check" >>"$log" 2>&1; then
      record_cap shared-skills ready "6 shared skills already current" ""
    else
      tail_log "$log"
      record_cap shared-skills failed "shared-skill equality check failed"
      return 1
    fi
    return 0
  fi

  if ! PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$installer" --skip-conflicts >"$log" 2>&1; then
    tail_log "$log"
    record_cap shared-skills failed "additive shared-skill installation failed"
    return 1
  fi
  installed=$(grep -c '^Installed:' "$log" 2>/dev/null || true)
  if [ "$conflicts" -gt 0 ]; then
    record_cap shared-skills manual "$conflicts conflict(s) preserved; installed $installed missing; resolve reviewed conflicts manually" ""
    return 0
  fi
  if PI_CODING_AGENT_DIR="$AGENT_DIR" bash "$check" >>"$log" 2>&1; then
    record_cap shared-skills installed "$installed missing shared skill(s) installed; 6 now current" ""
  else
    tail_log "$log"
    record_cap shared-skills failed "installed skills did not match the repository"
    return 1
  fi
}

find_chrome() {
  CHROME_BIN=""
  CHROME_KIND=""
  local candidate
  if [ "$OS" = macos ]; then
    for candidate in \
      "/Applications/Google Chrome.app/Contents/MacOS/Google Chrome" \
      "/Applications/Chromium.app/Contents/MacOS/Chromium"; do
      if [ -x "$candidate" ]; then
        CHROME_BIN=$candidate
        CHROME_KIND="macOS app"
        return 0
      fi
    done
  fi
  for candidate in google-chrome google-chrome-stable chromium chromium-browser; do
    if have "$candidate"; then
      candidate=$(command -v "$candidate")
      if [ -x "$candidate" ]; then
        CHROME_BIN=$candidate
        CHROME_KIND="PATH"
        return 0
      fi
    fi
  done
  if [ -d "$ASTACK_HOME/chrome" ]; then
    candidate=$(find "$ASTACK_HOME/chrome" -type f \( -name chrome -o -name 'Google Chrome for Testing' \) -perm -u+x 2>/dev/null | head -n 1)
    if [ -n "$candidate" ] && [ -x "$candidate" ]; then
      CHROME_BIN=$candidate
      CHROME_KIND="Chrome for Testing"
      return 0
    fi
  fi
  return 1
}

install_chrome_linux_deps() {
  [ "$PKG_MANAGER" = apt-get ] || return 1
  [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO_CMD" ] || return 1
  pm_install libnss3 libatk1.0-0 libatk-bridge2.0-0 libcups2 libdrm2 \
    libxkbcommon0 libxcomposite1 libxdamage1 libxfixes3 libxrandr2 libgbm1 \
    libasound2 libpango-1.0-0 libcairo2 || return 1
}

chrome_probe() {
  local bin=$1 out rc
  out=$("$bin" --version 2>&1)
  rc=$?
  CHROME_PROBE_OUTPUT=$(printf '%s' "$out" | head -n 1 | cut -c1-180)
  CHROME_PROBE_VERSION=$(printf '%s\n' "$out" | first_version)
  return $rc
}

chrome_repair_supported() {
  [ "$OS" = linux ] && [ "$PKG_MANAGER" = apt-get ] && \
    { [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO_CMD" ]; }
}

ensure_unzip_for_chrome() {
  if have unzip; then
    record_cap chrome-prereq ready "unzip present for Chrome extraction" "$(tool_version unzip -v)"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap chrome-prereq manual "unzip missing; Chrome download/extraction needs it" ""
    return 0
  fi
  local supported=0
  [ "$PKG_MANAGER" != none ] || supported=0
  if [ "$PKG_MANAGER" != none ] && { [ "$IS_ROOT" -eq 1 ] || [ -n "$SUDO_CMD" ] || [ "$PKG_MANAGER" = brew ]; }; then
    supported=1
  fi
  if [ "$supported" -eq 1 ] && pm_install unzip; then
    if have unzip; then
      record_cap chrome-prereq installed "unzip installed for Chrome extraction" "$(tool_version unzip -v)"
      return 0
    fi
  fi
  if [ "$supported" -eq 1 ]; then
    record_cap chrome-prereq failed "unzip installation failed (see $LOG_DIR/system-packages.log)" ""
    return 1
  fi
  record_cap chrome-prereq manual "unzip missing; install it with the detected package manager" ""
  return 0
}

ensure_chrome() {
  local chrome_tmp tmp_bin final_parent final backup
  CHROME_PUBLISH_NOTE=""
  if find_chrome; then
    if chrome_probe "$CHROME_BIN"; then
      record_cap chrome ready "$CHROME_KIND" "$CHROME_PROBE_VERSION"
      return 0
    fi
    if [ "$MODE" = check ]; then
      record_cap chrome manual "binary found at $CHROME_BIN but --version failed: $CHROME_PROBE_OUTPUT" ""
      return 0
    fi
    if chrome_repair_supported; then
      if install_chrome_linux_deps; then
        :
      else
        record_cap chrome failed "shared-library installation failed (see $LOG_DIR/system-packages.log)" ""
        return 1
      fi
      if chrome_probe "$CHROME_BIN"; then
        record_cap chrome installed "existing binary repaired with documented shared libraries" "$CHROME_PROBE_VERSION"
        return 0
      fi
      record_cap chrome failed "binary still fails after shared-library install: $CHROME_PROBE_OUTPUT" ""
      return 1
    fi
    record_cap chrome manual "binary found but not runnable: $CHROME_PROBE_OUTPUT; install missing shared libraries with the detected package manager" ""
    return 0
  fi
  if [ "$MODE" = check ]; then
    if [ "$OS" = linux ]; then
      ensure_unzip_for_chrome || true
    fi
    record_cap chrome manual "Chrome/Chromium not found" ""
    return 0
  fi
  mkdir -p "$LOG_DIR"
  if [ "$OS" = macos ]; then
    if have brew && HOMEBREW_NO_AUTO_UPDATE=1 brew install --cask google-chrome >>"$LOG_DIR/chrome-install.log" 2>&1; then
      :
    else
      tail_log "$LOG_DIR/chrome-install.log"
      record_cap chrome manual "install Google Chrome from https://www.google.com/chrome/ (cask needs interactive permission)"
      return 0
    fi
  elif have npx; then
    ensure_unzip_for_chrome || {
      record_cap chrome failed "Chrome prerequisite unzip is unavailable" ""
      return 1
    }
    case "$(cap_status chrome-prereq)" in
      ready|installed) : ;;
      *) record_cap chrome manual "unzip prerequisite missing; install unzip then rerun" ""; return 0 ;;
    esac
    final_parent="$ASTACK_HOME"
    mkdir -p "$final_parent"
    chrome_tmp=$(mktemp -d "$final_parent/chrome-download.XXXXXX") || {
      record_cap chrome failed "cannot create an owned temporary Chrome download directory"
      return 1
    }
    if ! npx --yes @puppeteer/browsers install "chrome@stable" --path "$chrome_tmp" >>"$LOG_DIR/chrome-install.log" 2>&1; then
      tail_log "$LOG_DIR/chrome-install.log"
      rm -rf -- "$chrome_tmp"
      record_cap chrome failed "Chrome for Testing download failed"
      return 1
    fi
    tmp_bin=$(find "$chrome_tmp" -type f \( -name chrome -o -name 'Google Chrome for Testing' \) -perm -u+x 2>/dev/null | head -n 1)
    if [ -z "$tmp_bin" ] || [ ! -x "$tmp_bin" ]; then
      rm -rf -- "$chrome_tmp"
      record_cap chrome failed "Chrome download completed without a runnable binary"
      return 1
    fi
    final="$final_parent/chrome"
    if [ -e "$final" ] || [ -L "$final" ]; then
      backup="$final_parent/chrome.previous.$SETUP_STAMP"
      { [ -e "$backup" ] || [ -L "$backup" ]; } && backup="$backup-$$"
      if ! mv "$final" "$backup"; then
        rm -rf -- "$chrome_tmp"
        record_cap chrome failed "cannot preserve the previous owned Chrome directory at $backup"
        return 1
      fi
      CHROME_PUBLISH_NOTE="previous owned directory preserved at $backup; "
    fi
    if ! mv "$chrome_tmp" "$final"; then
      rm -rf -- "$chrome_tmp"
      record_cap chrome failed "cannot publish the completed Chrome download"
      return 1
    fi
  else
    record_cap chrome manual "install google-chrome or chromium with the detected package manager"
    return 0
  fi
  if ! find_chrome; then
    record_cap chrome failed "Chrome installed but binary not found"
    return 1
  fi
  if [ "$OS" = linux ]; then
    mkdir -p "$HOME/.local/bin"
    if [ ! -e "$HOME/.local/bin/google-chrome" ]; then
      ln -s "$CHROME_BIN" "$HOME/.local/bin/google-chrome"
    fi
  fi
  if chrome_probe "$CHROME_BIN"; then
    record_cap chrome installed "${CHROME_PUBLISH_NOTE}$CHROME_KIND" "$CHROME_PROBE_VERSION"
    return 0
  fi
  if [ "$OS" = linux ] && chrome_repair_supported; then
    if install_chrome_linux_deps && chrome_probe "$CHROME_BIN"; then
      record_cap chrome installed "$CHROME_KIND (shared libraries installed)" "$CHROME_PROBE_VERSION"
      return 0
    fi
    record_cap chrome failed "binary still fails after shared-library install: $CHROME_PROBE_OUTPUT" ""
    return 1
  fi
  record_cap chrome manual "binary present but not runnable: $CHROME_PROBE_OUTPUT; install missing shared libraries with the detected package manager" ""
}

ensure_browser_use() {
  local cli python
  cli=$(command -v browser-use 2>/dev/null || true)
  if [ -n "$cli" ]; then
    python="$(uv tool dir 2>/dev/null)/browser-use/bin/python"
    if [ -x "$python" ] && PYTHONDONTWRITEBYTECODE=1 "$python" -c 'import browser_harness' >/dev/null 2>&1; then
      record_cap browser-use ready "Python CLI + browser-harness verified" "$(tool_version browser-use --version)"
      return 0
    fi
  fi
  if [ "$MODE" = check ]; then
    record_cap browser-use manual "browser-use CLI/browser-harness not verified" ""
    return 0
  fi
  mkdir -p "$LOG_DIR"
  if ! have uv; then
    record_cap browser-use failed "uv unavailable; cannot install browser-use"
    return 1
  fi
  if [ -n "$cli" ]; then
    # Evidenced repair of a broken harness installation, not a routine upgrade.
    if ! uv tool install --python 3.12 --force browser-use >>"$LOG_DIR/browser-use.log" 2>&1; then
      tail_log "$LOG_DIR/browser-use.log"
      record_cap browser-use failed "browser-use repair failed"
      return 1
    fi
  else
    if ! uv tool install --python 3.12 browser-use >>"$LOG_DIR/browser-use.log" 2>&1; then
      tail_log "$LOG_DIR/browser-use.log"
      record_cap browser-use failed "browser-use install failed"
      return 1
    fi
  fi
  export PATH="$HOME/.local/bin:$PATH"
  hash -r 2>/dev/null || true
  cli=$(command -v browser-use 2>/dev/null || true)
  python="$(uv tool dir 2>/dev/null)/browser-use/bin/python"
  if [ -n "$cli" ] && [ -x "$python" ] && PYTHONDONTWRITEBYTECODE=1 "$python" -c 'import browser_harness' >/dev/null 2>&1; then
    record_cap browser-use installed "Python CLI + browser-harness installed" "$(tool_version browser-use --version)"
  else
    record_cap browser-use failed "browser-use installed but harness import failed"
    return 1
  fi
}

install_official_script() {
  local url=$1 log=$2 script
  script=$(mktemp "${TMPDIR:-/tmp}/astack-installer.XXXXXX") || return 1
  if ! curl -fsSL "$url" -o "$script" >>"$log" 2>&1; then
    rm -f "$script"
    return 1
  fi
  if ! bash "$script" >>"$log" 2>&1; then
    rm -f "$script"
    return 1
  fi
  rm -f "$script"
}

ensure_herdr_core() {
  if have hc; then
    record_cap herdr-core ready "headless Core CLI present" "$(tool_version hc --version)"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap herdr-core manual "hc not found" ""
    return 0
  fi
  mkdir -p "$LOG_DIR"
  if install_official_script "https://releases.herdr.dev/core/install.sh" "$LOG_DIR/herdr-core.log"; then
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true
  fi
  if have hc; then
    record_cap herdr-core installed "installed from the official Core script" "$(tool_version hc --version)"
  else
    tail_log "$LOG_DIR/herdr-core.log"
    record_cap herdr-core failed "Core install did not produce hc"
    return 1
  fi
}

ensure_herdr_app() {
  if [ "$DESKTOP" = none ]; then
    if have herdr-app; then
      record_cap herdr-app unsupported "binary present but no desktop session; GUI readiness not claimed" "$(tool_version herdr-app --version)"
    else
      record_cap herdr-app unsupported "no desktop session; Herdr app needs a desktop and Vulkan"
    fi
    record_cap desktop-session unsupported "headless host"
    [ "$OS" = linux ] && record_cap vulkan unsupported "headless host; Vulkan GUI not verified"
    record_cap herdr-gui unsupported "no desktop session; visible app tabs are unavailable"
    return 0
  fi
  if have herdr-app; then
    record_cap herdr-app ready "visible app binary present" "$(tool_version herdr-app --version)"
    record_cap desktop-session ready "$DESKTOP" ""
    if [ "$OS" = linux ] && [ "$VULKAN" = absent ]; then
      record_cap vulkan unsupported "no Vulkan loader/ICD detected"
    elif [ "$OS" = linux ] && [ "$VULKAN" != working ]; then
      record_cap vulkan manual "Vulkan present but not verified ($VULKAN)"
    else
      record_cap vulkan ready "not applicable on macOS; Herdr app uses the native desktop" ""
    fi
    record_cap herdr-gui manual "app binary/desktop present; visible tab and AgentCreate were not exercised by the installer"
    return 0
  fi
  if [ "$MODE" = check ]; then
    record_cap herdr-app manual "herdr-app not found" ""
    return 0
  fi
  mkdir -p "$LOG_DIR"
  if install_official_script "https://releases.herdr.dev/app/install.sh" "$LOG_DIR/herdr-app.log"; then
    export PATH="$HOME/.local/bin:$PATH"
    hash -r 2>/dev/null || true
  fi
  if have herdr-app; then
    record_cap herdr-app installed "installed from the official app script" "$(tool_version herdr-app --version)"
    record_cap desktop-session ready "$DESKTOP" ""
  else
    tail_log "$LOG_DIR/herdr-app.log"
    record_cap herdr-app manual "app install needs a desktop session or package-manager follow-up"
  fi
}

resolve_path() {
  if have realpath; then
    realpath "$1"
  elif have python3; then
    python3 -c 'import os,sys; print(os.path.realpath(sys.argv[1]))' "$1"
  else
    printf '%s' "$1"
  fi
}

find_cua() {
  CUA_BIN=""
  if [ "$OS" = macos ] && [ -x "/Applications/CuaDriver.app/Contents/MacOS/cua-driver" ]; then
    CUA_BIN="/Applications/CuaDriver.app/Contents/MacOS/cua-driver"
    return 0
  fi
  if have cua-driver; then
    CUA_BIN=$(resolve_path "$(command -v cua-driver)")
    return 0
  fi
  return 1
}

ensure_cua() {
  if [ "$DESKTOP" = none ] && ! desktop_stack_present; then
    record_cap cua-driver unsupported "computer use needs a desktop session; none detected"
    record_cap cua-permissions unsupported "no desktop session"
    return 0
  fi
  if ! find_cua; then
    if [ "$MODE" = check ]; then
      record_cap cua-driver manual "cua-driver not found" ""
      record_cap cua-permissions manual "driver not installed" ""
      return 0
    fi
    mkdir -p "$LOG_DIR"
    if install_official_script "https://cua.ai/driver/install.sh" "$LOG_DIR/cua-driver.log"; then
      export PATH="$HOME/.local/bin:$PATH"
      hash -r 2>/dev/null || true
    fi
  fi
  if ! find_cua; then
    tail_log "$LOG_DIR/cua-driver.log"
    record_cap cua-driver manual "Cua Driver install needs interactive follow-up"
    record_cap cua-permissions manual "driver not installed"
    return 0
  fi
  local version
  version=$(tool_version "$CUA_BIN" --version)
  record_cap cua-driver ready "local Driver binary present; separate from Cua Cloud" "$version"
  if [ "$OS" = macos ]; then
    local perms
    perms=$("$CUA_BIN" permissions status --json 2>/dev/null || true)
    if printf '%s' "$perms" | grep -q '"accessibility": true' && \
       printf '%s' "$perms" | grep -q '"screen_recording": true'; then
      record_cap cua-permissions ready "Accessibility and Screen Recording granted to CuaDriver" ""
    else
      record_cap cua-permissions manual "complete CuaDriver onboarding in System Settings > Privacy & Security" ""
    fi
    record_cap cua-gui manual "permission status is read-only; no GUI action was performed by the installer"
  else
    if desktop_stack_present; then
      record_cap cua-permissions manual \
        "start Pi inside the private session (astack-desktop run -- pi) so the driver reaches its display and AT-SPI bus"
      record_cap cua-gui manual \
        "desktop automation readiness is verified by the VM smoke test, not by the installer"
    else
      record_cap cua-permissions manual "desktop session + X11/XWayland + AT-SPI 2; verify grants in the desktop"
      record_cap cua-gui manual "desktop automation readiness is user-verified"
    fi
  fi
}

register_cua_mcp() {
  local result_file="$LOG_DIR/cua-mcp-result.txt"
  if [ "$DESKTOP" = none ] && ! desktop_stack_present; then
    record_cap cua-mcp unsupported "computer use requires a desktop session; not registered on this host"
    return 0
  fi
  if ! find_cua; then
    record_cap cua-mcp manual "Cua Driver binary is not installed"
    return 0
  fi
  if [ "$MODE" = check ]; then
    if [ -f "$AGENT_DIR/mcp.json" ] && grep -q '"cua-driver"[[:space:]]*:' "$AGENT_DIR/mcp.json"; then
      record_cap cua-mcp ready "cua-driver entry present in $AGENT_DIR/mcp.json; not modified" ""
    else
      record_cap cua-mcp manual "run setup to register the local Cua MCP server" ""
    fi
    return 0
  fi
  if [ "$NO_CONFIG" = 1 ]; then
    record_cap cua-mcp manual "config writes disabled; add: pi mcp add cua-driver --exposure codemode -- $CUA_BIN mcp" ""
    return 0
  fi
  mkdir -p "$AGENT_DIR" "$LOG_DIR"
  if ! node "$REPO_ROOT/scripts/lib/setup/configure.mjs" mcp \
      --agent-dir "$AGENT_DIR" --stamp "$SETUP_STAMP" --summary-file "$result_file" \
      --name cua-driver --command "$CUA_BIN" --arg mcp >>"$LOG_DIR/configure.log" 2>&1; then
    tail_log "$LOG_DIR/configure.log"
    record_cap cua-mcp failed "MCP config merge failed"
    return 1
  fi
  if [ -f "$result_file" ] && grep -q '^conflicts=1' "$result_file"; then
    record_cap cua-mcp manual "existing cua-driver MCP entry differs; left unchanged"
  elif [ -f "$result_file" ] && grep -q '^changed=1' "$result_file"; then
    record_cap cua-mcp installed "registered cua-driver via stdio mcp in $AGENT_DIR/mcp.json" ""
  else
    record_cap cua-mcp ready "cua-driver MCP already registered" ""
  fi
}

install_slack_service() {
  local dir="$REPO_ROOT/services/pi-slack"
  local pkg="$dir/package.json"
  local lock="$dir/package-lock.json"
  local cap="slack-service" stamp expected log
  [ -f "$pkg" ] || { record_cap "$cap" failed "Slack service manifest missing"; return 1; }
  stamp="$dir/node_modules/.astack-setup/stamp"
  expected=$(package_install_hash "$dir" "$pkg" "$lock")
  if [ -d "$dir/node_modules" ] && [ -f "$stamp" ] && [ "$(cat "$stamp" 2>/dev/null || true)" = "$expected" ] && [ -f "$dir/dist/service.js" ]; then
    record_cap "$cap" ready "dependencies and build current; service not started" ""
  elif [ "$MODE" = check ]; then
    record_cap "$cap" manual "run setup to build the Slack service" ""
  else
    log="$PKG_LOG_DIR/pi-slack.log"
    mkdir -p "$PKG_LOG_DIR"
    if ! log_cmd "pi-slack npm ci" "$log" npm --prefix "$dir" ci --ignore-scripts --no-audit --no-fund; then
      tail_log "$log"
      record_cap "$cap" failed "npm ci failed (see $log)"
      return 1
    fi
    if ! log_cmd "pi-slack build" "$log" npm --prefix "$dir" run --silent build; then
      tail_log "$log"
      record_cap "$cap" failed "build failed (see $log)"
      return 1
    fi
    mkdir -p "$(dirname "$stamp")"
    printf '%s\n' "$expected" >"$stamp"
    record_cap "$cap" installed "dependencies + build complete; service not started" ""
  fi
  if [ -f "$HOME/.config/pi-slack/slack.env" ] && [ -f "$HOME/.config/pi-slack/config.json" ]; then
    record_cap slack-config manual "private config present; tokens/login and one-listener cutover are user-owned"
  else
    record_cap slack-config manual "create ~/.config/pi-slack/{slack.env,config.json}; see services/pi-slack/README.md"
  fi
  record_cap slack-delegation unsupported "AgentCreate uses process.argv[1]; the gateway entrypoint relaunches dist/service.js, not Pi"
}

report_manual_items() {
  local auth="$AGENT_DIR/auth.json"
  if [ -s "$auth" ]; then
    record_cap model-auth manual "credentials file present; provider/model validity is user-owned (pi then /login)"
  else
    record_cap model-auth manual "run pi and authenticate with /login or provider environment variables"
  fi
  if [ -d "$REPO_ROOT/packages/pi-firstmate" ] && \
     { [ "$(cap_status pkg-pi-firstmate)" = ready ] || [ "$(cap_status pkg-pi-firstmate)" = installed ]; }; then
    record_cap firstmate ready "extension + skill install with the package; delegation still needs a genuine Core parent"
  else
    record_cap firstmate manual "build/register pi-firstmate before relying on the extension"
  fi
  if [ "$DESKTOP" = none ]; then
    record_cap delegation unsupported "AgentCreate needs a live Core parent and visible Herdr app tab; not available on this host"
  elif ! have herdr-app; then
    record_cap delegation manual "install/start the Herdr app, then start Pi inside a live Core terminal"
  else
    record_cap delegation manual "requires starting Pi inside a live Core terminal; installer does not create or attach sessions"
  fi
  record_cap security-sandbox unsupported "no OS sandbox is bundled; security-audit target execution requires one"
  if [ -d "$REPO_ROOT/packages/pi-visuals/skills/archify" ]; then
    case "$(cap_status chrome)" in
      ready|installed) record_cap archify ready "runtime bundled in pi-visuals; Chrome present; no ffmpeg or separate npm install" "" ;;
      *) record_cap archify manual "runtime bundled in pi-visuals; Chrome/Chromium is still needed for the browser gate" "" ;;
    esac
  else
    record_cap archify failed "bundled Archify runtime missing from pi-visuals"
  fi
  record_cap optional-packages manual "pi-web-access and @narumitw/pi-usage are separate global packages; not installed by Astack"
}
