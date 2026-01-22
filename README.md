# SQLFluff Formatter

VS Code extension for formatting SQL files using [sqlfluff](https://www.sqlfluff.com/).

## Features

- **Format SQL on Selection**: Select text and format only the selected SQL
- **Format Entire File**: Format the entire SQL file if no selection is made
- **Configurable**: Support for global and local sqlfluff configuration

## Installation

1. Install the extension from VS Code marketplace
2. Ensure you have sqlfluff 1.0.0 or higher installed locally:
   ```bash
   # Install latest sqlfluff
   pip install --upgrade sqlfluff
   
   # Or install specific version
   pip install sqlfluff>=3.0.0
   
   # Verify installation
   sqlfluff --version
   ```
3. Configure Python path in VS Code settings if using custom Python installation
