# SQLFluff Formatter

VS Code extension for formatting SQL files using [sqlfluff](https://www.sqlfluff.com/).

## Features

- **Format SQL on Selection**: Select text and format only the selected SQL
- **Format Entire File**: Format the entire SQL file if no selection is made
- **Configurable**: Support for global and local sqlfluff configuration
- **Multiple Dialects**: Support for various SQL dialects (ANSI, T-SQL, MySQL, PostgreSQL, Snowflake, BigQuery, etc.)
- **Custom Rules**: Override sqlfluff rules via VS Code settings
- **Rule Exclusion**: Exclude specific rules from formatting

## Installation

1. Install the extension from VS Code marketplace
2. Ensure you have sqlfluff 1.0.0 or higher installed locally:
   ```bash
   # Install latest sqlfluff
   pip install --upgrade sqlfluff
   
   # Or install specific version
   pip install sqlfluff>=1.0.0
   
   # Verify installation
   sqlfluff --version
   ```
3. Configure Python path in VS Code settings if using custom Python installation

## Configuration

### Basic Settings

Add these settings to your VS Code `settings.json`:

```json
{
  "sqlfluff.pythonPath": "python",
  "sqlfluff.sqlfluffPath": "sqlfluff"
}
```

### How the Extension Resolves Execution

The extension tries three execution methods in priority order:

1. **`sqlfluffPath` configured AND exists** → Execute sqlfluff binary directly
   - Most reliable and fastest
   - Requires sqlfluff installed as standalone executable

2. **Falls back if above fails** → Execute `python -m sqlfluff format` via pythonPath
   - Good compatibility with Python virtual environments
   - Uses Python's module system to load sqlfluff
   - Requires `pip install sqlfluff`

3. **Final fallback if both fail** → Use Python API directly
   - `from sqlfluff.core import Linter` method
   - Most reliable option (works as long as Python and sqlfluff are installed)
   - Guarantees formatting will work

**Recommendation**: Set only `pythonPath` to your Python interpreter. The extension will automatically try all three methods and use whatever works on your system.

### Configuration Options

- **pythonPath**: Path to Python interpreter (default: "python")
  - Example: `/usr/bin/python3` or `C:\\Python39\\python.exe`
  - Used as fallback when sqlfluffPath is not available

- **sqlfluffPath**: Path to sqlfluff executable (default: "sqlfluff")
   - Example: `/usr/local/bin/sqlfluff`
   
- **rules**: Override specific sqlfluff rules
  - Example:
    ```json
    {
      "sqlfluff.rules": {
        "L001": { "capitalisation_policy": "upper" },
        "L003": { "indent_size": 2 }
      }
    }
    ```

- **excludeRules**: Rules to exclude from formatting
  - Example: `["L009", "L027"]`

## Usage

### Keyboard Shortcut
- **Alt+Shift+F** (Windows/Linux) or **Option+Shift+F** (macOS): Format SQL

### Command Palette
1. Press `Ctrl+Shift+P` (Windows/Linux) or `Cmd+Shift+P` (macOS)
2. Type "SQLFluff: Format SQL"
3. Press Enter

### Selection-based Formatting
1. Select the SQL code you want to format
2. Use the keyboard shortcut or command

### File-wide Formatting
1. Open a SQL file with no selection
2. Use the keyboard shortcut or command to format the entire file

## Selecting the Right SQL Dialect

SQLFluff supports many SQL dialects. Choose the one that matches your database system:

### Supported Dialects

| Dialect | Best For | Notes |
|---------|----------|-------|
| `ansi` | Standard SQL | Most portable, basic SQL features |
| `postgresql` | PostgreSQL | Full PostgreSQL syntax support |
| `mysql` | MySQL | MySQL-specific features |
| `tsql` | SQL Server | T-SQL specific syntax (DECLARE, etc.) |
| `snowflake` | Snowflake | Snowflake-specific functions and syntax |
| `bigquery` | Google BigQuery | BigQuery standard SQL dialect |
| `oracle` | Oracle Database | Oracle PL/SQL features |
| `hive` | Apache Hive | Hive SQL dialect |
| `sparksql` | Apache Spark | Spark SQL features |
| `duckdb` | DuckDB | DuckDB-specific features |
| `redshift` | Amazon Redshift | Redshift extensions |
| `exasol` | Exasol | Exasol-specific SQL |
| `trino` | Trino | Trino query engine |
| `presto` | Presto | Presto query engine |

### Troubleshooting Parsing Errors

If you see "[1 templating/parsing errors found" messages:

1. **Check your templater setting**: By default, the extension uses Jinja2 templating
   - If your SQL doesn't use templates (dbt, Jinja, etc.), set `templater = raw` in your `.sqlfluff`
   - Example: `templater = raw` in workspace `.sqlfluff` file

2. **Check your dialect**: Ensure the `.sqlfluff` configuration matches your SQL database
   - Example: If using Snowflake syntax like `INSERT OVERWRITE`, set dialect to `snowflake` in ~/.sqlfluff
   - If using `DECLARE` (T-SQL), set dialect to `tsql` in ~/.sqlfluff

3. **Try a different dialect**: Some SQL features are only supported in specific dialects
   - If ANSI dialect fails, try `postgresql` or your actual database system

4. **Update your .sqlfluff file**: Set the correct dialect in your configuration:
   ```ini
   [sqlfluff]
   dialect = snowflake
   templater = raw
   ```

5. **Use proper configuration location**: 
   - Workspace root `.sqlfluff` takes priority over home directory config
   - Home directory `~/.sqlfluff` provides global defaults

## Jinja2 Template Support

The extension can support **Jinja2 templating**, which is useful if you:
- Use **dbt** for data transformations
- Have SQL files with Jinja template variables (e.g., `{{ variable_name }}`)
- Use template inheritance or macros in your SQL

By default, the extension uses **raw templating** (no template processing) for maximum compatibility.

### Enabling Jinja2

To enable Jinja2 templating, add this to your `.sqlfluff` (workspace or home directory):

```ini
[sqlfluff]
templater = jinja

[sqlfluff:templater:jinja]
apply_dbt_macros = False
```

### Using dbt Macros

If you're using dbt and want the formatter to understand dbt-specific syntax:

```ini
[sqlfluff]
templater = jinja

[sqlfluff:templater:jinja]
apply_dbt_macros = True
```

Note: This requires dbt to be installed in your Python environment.

## Configuration Files

### Global Configuration (~/.sqlfluff)

You can customize the formatter globally by creating a `.sqlfluff` file in your home directory. Example:

```ini
[sqlfluff]
dialect = postgresql      # Change to your default SQL dialect
indent_unit = space
indent_size = 2
max_line_length = 88

[sqlfluff:rules]
L001 = { "capitalisation_policy" : "upper" }  # UPPERCASE keywords
L002 = { "capitalisation_policy" : "upper" }  # UPPERCASE functions
L003 = { "indent_size" : 2 }                   # 2-space indentation

# Enable Jinja2 if you use dbt or template engines
# [sqlfluff]
# templater = jinja
```

This global configuration applies to all your SQL projects unless overridden by a workspace-specific `.sqlfluff` file.

### Local Configuration (.sqlfluff in workspace)

Override the global settings for specific projects by creating a `.sqlfluff` in your workspace root:

```ini
[sqlfluff]
dialect = snowflake      # Change dialect for this project
templater = raw          # Or keep jinja if needed
indent_size = 4

[sqlfluff:rules]
L001 = { "capitalisation_policy" : "upper" }
L009 = { "select_clause_trailing_comma" : "forbid" }
```

### VS Code Workspace Settings

Override rules for specific projects in `.vscode/settings.json`:

```json
{
  "sqlfluff.pythonPath": "/usr/bin/python3",
  "sqlfluff.excludeRules": ["L009", "L027"],
  "sqlfluff.rules": {
    "L001": { "capitalisation_policy": "lower" }
  }
}
```

## Configuration Priority

The extension resolves `.sqlfluff` configuration files in this order (highest to lowest priority):

1. **Workspace config** (`.sqlfluff` in workspace root)
   - Project-specific formatting rules
   - Use this to override settings for a specific project

2. **Home directory config** (`~/.sqlfluff`)
   - Your personal formatting preferences
   - Applies to all projects where workspace config doesn't exist

3. **Extension default config** (`.sqlfluff.default` bundled with extension)
   - Built-in fallback configuration
   - Ensures consistent formatting even without any custom config files
   - Uses ANSI SQL and raw templating (no templates) by default for maximum compatibility

4. **sqlfluff internal defaults**
   - Used only if all above configurations are missing

### Quick Setup

**Zero-config option:** Just install the extension!
- The extension's built-in configuration provides sensible defaults for most SQL projects
- No Jinja2 templates by default - safe and compatible with any SQL

**Customize for your environment:** Create `~/.sqlfluff` in your home directory
- Overrides the extension's defaults globally
- Applies to all your SQL projects

**Project-specific rules:** Create `.sqlfluff` in your workspace root
- Overrides both home directory and extension defaults
- Useful for team standards or specific project requirements
- Example: Enable Jinja2 for dbt projects

## Example Workflows

### Setup for PostgreSQL Project

1. Create `.sqlfluff` in your project root:
   ```ini
   [sqlfluff]
   dialect = postgresql
   indent_unit = space
   indent_size = 2
   ```

2. In `.vscode/settings.json`:
   ```json
   {
     "sqlfluff.pythonPath": "/usr/bin/python3",
     "sqlfluff.excludeRules": ["L027"]
   }
   ```

3. Format your SQL with Alt+Shift+F

### Setup for Multiple Dialects

Create separate `.sqlfluff` files in different workspace directories:
- Create `.sqlfluff` in your Snowflake project with `dialect = snowflake`
- Create `.sqlfluff` in your SQL Server project with `dialect = tsql`

Each project's `.sqlfluff` file will be used based on the workspace root.

## Troubleshooting

### "sqlfluff not found" Error

1. Ensure sqlfluff is installed:
   ```bash
   pip install sqlfluff
   ```

2. Set the correct pythonPath or sqlfluffPath in settings:
   - Windows: `C:\\Python39\\python.exe`
   - macOS/Linux: `/usr/bin/python3`

### "Format error: Permission denied"

Make sure you have execute permissions:
```bash
chmod +x /path/to/sqlfluff
```

### Configuration Not Applied

1. Check that `.sqlfluff` exists in workspace root or home directory
2. Verify the configuration file format (INI format, not JSON)
3. Check file permissions to ensure it's readable

## Common Sqlfluff Rules

- **L001**: Inconsistent capitalisation of keywords
- **L002**: Inconsistent capitalisation of function names
- **L003**: Indentation not in multiples of indent_size
- **L004**: Indentation size is not a multiple of indent_unit
- **L005**: Indentation is in tabs rather than spaces
- **L009**: Files must end with a newline
- **L010**: Comments should start with space after hash
- **L011**: Unused alias (select statement)
- **L012**: Aliases in join conditions should be qualified

See [sqlfluff documentation](https://docs.sqlfluff.com/en/stable/reference/rules.html) for complete rule reference.

## Requirements

- VS Code 1.60.0 or higher
- Python 3.7 or higher
- sqlfluff 1.0.0 or higher (for full compatibility with this extension)

## License

MIT

## Contributing

Contributions are welcome! Please feel free to submit pull requests or open issues on the repository.

## Support

For issues, feature requests, or questions:
- Check the [troubleshooting section](#troubleshooting)
- Review [sqlfluff documentation](https://docs.sqlfluff.com/)
- Open an issue on the GitHub repository
