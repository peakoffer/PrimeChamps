#!/bin/bash
# Auto-format files after Claude edits them
# This hook runs after Write or Edit tool use

if [[ "$TOOL_NAME" == "write" || "$TOOL_NAME" == "edit" ]]; then
  # Get file extension
  ext="${FILE_PATH##*.}"

  # TypeScript/JavaScript files - run Prettier and ESLint
  if [[ "$ext" == "ts" || "$ext" == "tsx" || "$ext" == "js" || "$ext" == "jsx" ]]; then
    cd "$(dirname "$FILE_PATH")"
    # Find nearest node_modules
    while [[ ! -d "node_modules" && "$PWD" != "/" ]]; do
      cd ..
    done
    if [[ -d "node_modules" ]]; then
      npx prettier --write "$FILE_PATH" 2>/dev/null || true
      npx eslint --fix "$FILE_PATH" 2>/dev/null || true
    fi
  fi

  # Python files - run Black and Ruff
  if [[ "$ext" == "py" ]]; then
    black "$FILE_PATH" 2>/dev/null || true
    ruff check --fix "$FILE_PATH" 2>/dev/null || true
  fi

  # JSON files - run Prettier
  if [[ "$ext" == "json" ]]; then
    cd "$(dirname "$FILE_PATH")"
    while [[ ! -d "node_modules" && "$PWD" != "/" ]]; do
      cd ..
    done
    if [[ -d "node_modules" ]]; then
      npx prettier --write "$FILE_PATH" 2>/dev/null || true
    fi
  fi
fi
