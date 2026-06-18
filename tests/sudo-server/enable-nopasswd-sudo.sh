#!/bin/bash
# Runs from /custom-cont-init.d/ after the linuxserver base has applied
# SUDO_ACCESS (which appends `<user> ALL=(ALL) ALL` to /etc/sudoers) and
# before sshd starts. Appends a NOPASSWD rule as the LAST match for the user
# so `sudo -n` works without a password — sudo evaluates rules last-match-wins.
set -eu

user="${USER_NAME:-testuser}"
sudoers=/etc/sudoers

if [ -f "$sudoers" ]; then
    echo "$user ALL=(ALL) NOPASSWD: ALL" >> "$sudoers"
    echo "[nopasswd-sudo] passwordless sudo enabled for $user"
else
    echo "[nopasswd-sudo] WARNING: $sudoers not found; passwordless sudo not enabled" >&2
fi
