# SQLFluff Formatter

Format your SQL files in VS Code using [sqlfluff](https://www.sqlfluff.com/).

## Features

- Format selected SQL or the entire file
- Uses your local sqlfluff installation and config
- Works with any dialect supported by sqlfluff

## Getting Started


1. Install this extension from the VS Code Marketplace.
2. Open a SQL file and run the `Format SQL with SQLFluff` command (Shift+Alt+S).
   - If `sqlfluff` is not installed but Python is available, the extension will attempt to install `sqlfluff` automatically.
   - If Python is not available, you will need to install Python and/or `sqlfluff` manually:
     ```bash
     pip install --upgrade sqlfluff
     # or a specific version
     pip install sqlfluff>=3.0.0
     ```

## Configuration

- The extension uses your workspace or user `.sqlfluff` config if present.
- You can set the path to `sqlfluff` and extra arguments in VS Code settings (`sqlfluff.path`, `sqlfluff.args`).

---
For more details, see the [sqlfluff documentation](https://docs.sqlfluff.com/).
