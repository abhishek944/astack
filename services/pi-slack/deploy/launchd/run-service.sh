#!/bin/sh
# Optional helper for a foreground manual run. The LaunchAgent runs Node directly
# and does not use this file. Set PI_SLACK_ENV_FILE to use a different private
# env file; the default is ~/.config/pi-slack/slack.env.
set -eu

repo_dir=$(CDPATH= cd -- "$(dirname -- "$0")/../.." && pwd)
env_file="${PI_SLACK_ENV_FILE:-${HOME}/.config/pi-slack/slack.env}"
entry="${repo_dir}/dist/service.js"

if [ ! -r "${env_file}" ]; then
	echo "pi-slack: cannot read ${env_file}" >&2
	exit 1
fi
if [ ! -f "${entry}" ]; then
	echo "pi-slack: build first with: npm run build" >&2
	exit 1
fi

exec node --env-file="${env_file}" "${entry}"
