# SQLFluff Formatter

Format your SQL files in VS Code using [sqlfluff](https://www.sqlfluff.com/).

This extension runs `sqlfluff fix` from VS Code and applies the formatted result back to your editor.

## Features

- Format selected SQL or the entire file
- Uses your local sqlfluff installation and config
- Works with any dialect supported by sqlfluff
- Adds `--dialect ansi` automatically only when no dialect is provided in args or `.sqlfluff`

## How It Works

- If you select text, only the selection is formatted.
- If you do not select text, the entire document is formatted.
- Line endings (LF/CRLF) are preserved.
- Temporary files created during formatting are removed automatically.

## Getting Started

1. Install this extension from the VS Code Marketplace.
2. Open a SQL file and run the `Format SQL with SQLFluff` command (Shift+Alt+S).
   - If `sqlfluff.path` is set and not executable, the extension returns an error and does not try auto-install.
   - If `sqlfluff.path` is not set and `sqlfluff` is not found in PATH, the extension can attempt to install `sqlfluff` automatically when Python is available.
   - If Python is not available, install Python and/or `sqlfluff` manually:
     ```bash
     pip install --upgrade sqlfluff
     # or a specific version
     pip install "sqlfluff>=3.0.0"
     ```

## Usage

- Command Palette: `Format SQL with SQLFluff`
- Keyboard shortcut:
  - Windows/Linux: `Shift+Alt+S`
  - macOS: `Shift+Ctrl+S`

If formatting fails, open the `SQLFluff` output channel to see execution logs and error details.

## Configuration

- The extension uses your workspace or user `.sqlfluff` config if present.
- You can set the path to `sqlfluff` and extra arguments in VS Code settings (`sqlfluff.path`, `sqlfluff.args`).
- Auto-install uses `python -m pip install sqlfluff` (without `--user`).

### Example Settings

```json
{
  "sqlfluff.path": "",
  "sqlfluff.args": ["--dialect", "postgres"]
}
```

---
For more details, see the [sqlfluff documentation](https://docs.sqlfluff.com/).
