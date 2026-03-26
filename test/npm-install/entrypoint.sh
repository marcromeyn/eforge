#!/bin/bash
# Persist ~/.claude.json inside the ~/.claude/ volume so auth/onboarding
# state survives container recreation. Claude Code stores setup state in
# ~/.claude.json (separate from the ~/.claude/ directory).

VOLUME_COPY=/root/.claude/.claude.json
HOME_FILE=/root/.claude.json

if [ -f "$VOLUME_COPY" ]; then
  # Volume already has the file (from a previous session) - use it
  rm -f "$HOME_FILE"
  ln -s "$VOLUME_COPY" "$HOME_FILE"
elif [ -f "$HOME_FILE" ] && [ ! -L "$HOME_FILE" ]; then
  # First run: move the installer-created file into the volume
  mv "$HOME_FILE" "$VOLUME_COPY"
  ln -s "$VOLUME_COPY" "$HOME_FILE"
fi

exec "$@"
