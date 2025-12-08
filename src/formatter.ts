import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import * as fs from 'fs';
import { spawn } from 'child_process';

export class SQLFluffFormatter {
	private pythonPath: string;
	private sqlfluffPath: string;
	private extensionPath: string;

	constructor(extensionPath?: string) {
		this.extensionPath = extensionPath || __dirname;
		this.loadConfig();
	}

	private loadConfig(): void {
		const config = vscode.workspace.getConfiguration('sqlfluff');

		this.pythonPath = config.get('pythonPath') || 'python';
		this.sqlfluffPath = config.get('sqlfluffPath') || 'sqlfluff';
	}

	public async formatDocument(
		editor: vscode.TextEditor,
		outputChannel?: vscode.OutputChannel,
		returnEdits: boolean = false
	): Promise<vscode.TextEdit[]> {
		const document = editor.document;
		const fullRange = new vscode.Range(
			document.positionAt(0),
			document.positionAt(document.getText().length)
		);

		// Debug info
		const selectionInfo = editor.selection.isEmpty 
			? "No selection (full document)" 
			: `Selection: ${editor.selection.start.line}:${editor.selection.start.character} - ${editor.selection.end.line}:${editor.selection.end.character}`;
		
		// If there's a selection, format only the selection
		if (!editor.selection.isEmpty) {
			const selectedText = document.getText(editor.selection);
			if (outputChannel) {
				outputChannel.appendLine(`[formatDocument] ${selectionInfo}`);
				outputChannel.appendLine(`[formatDocument] Selected text (first 100 chars): ${selectedText.substring(0, 100)}`);
				outputChannel.appendLine(`[formatDocument] Total length: ${selectedText.length} characters`);
				outputChannel.appendLine('');
			}
			return this.formatRange(editor, editor.selection, outputChannel, returnEdits);
		}

		// Otherwise format the entire document
		const text = document.getText();
		if (outputChannel) {
			outputChannel.appendLine(`[formatDocument] ${selectionInfo}`);
			outputChannel.appendLine(`[formatDocument] Formatting entire file: ${text.length} characters`);
			outputChannel.appendLine(`[formatDocument] File: ${document.fileName}`);
			outputChannel.appendLine(`[formatDocument] First 100 chars: ${text.substring(0, 100)}`);
			outputChannel.appendLine('');
		}
		const formatted = await this.formatSQL(text, outputChannel);

		if (returnEdits) {
			return [vscode.TextEdit.replace(fullRange, formatted)];
		}

		// Apply edits directly
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, fullRange, formatted);
		await vscode.workspace.applyEdit(edit);

		return [];
	}

	public async formatRange(
		editor: vscode.TextEditor,
		range: vscode.Range,
		outputChannel?: vscode.OutputChannel,
		returnEdits: boolean = false
	): Promise<vscode.TextEdit[]> {
		const document = editor.document;
		const selectedText = document.getText(range);
		
		if (outputChannel) {
			outputChannel.appendLine(`[formatRange] Range: ${range.start.line}:${range.start.character} - ${range.end.line}:${range.end.character}`);
			outputChannel.appendLine(`[formatRange] Selected text length: ${selectedText.length} characters`);
			outputChannel.appendLine(`[formatRange] Text preview (first 100 chars): ${selectedText.substring(0, 100)}`);
			if (selectedText.length > 100) {
				outputChannel.appendLine(`[formatRange] Text preview (last 50 chars): ...${selectedText.substring(selectedText.length - 50)}`);
			}
			outputChannel.appendLine('');
		}
		
		const formatted = await this.formatSQL(selectedText, outputChannel);

		if (returnEdits) {
			return [vscode.TextEdit.replace(range, formatted)];
		}

		// Apply edits directly
		const edit = new vscode.WorkspaceEdit();
		edit.replace(document.uri, range, formatted);
		await vscode.workspace.applyEdit(edit);

		return [];
	}

	private async formatSQL(sql: string, outputChannel?: vscode.OutputChannel): Promise<string> {
		return new Promise((resolve, reject) => {
			try {
				// Preprocess: Convert compact SQL (single/few lines) into multi-line format
				const preprocessed = this.preprocessSQL(sql);
				const hasPreprocessed = preprocessed !== sql;
				
				// Use temporary file approach
				const tmpFile = path.join(os.tmpdir(), `sqlfluff_${Date.now()}.sql`);
				console.log('[SQLFluff] Writing SQL to temp file:', tmpFile);
				console.log('[SQLFluff] Input SQL length:', sql.length, 'bytes');
				if (outputChannel) {
					outputChannel.appendLine(`[formatSQL] Input SQL: ${sql.length} characters`);
					if (hasPreprocessed) {
						outputChannel.appendLine(`[formatSQL] ℹ️  Preprocessed compact SQL into multi-line format`);
						outputChannel.appendLine(`[formatSQL] After preprocessing: ${preprocessed.length} characters`);
					}
					if (preprocessed.length > 0) {
						outputChannel.appendLine(`[formatSQL] Preview: ${preprocessed.substring(0, 80)}`);
					}
					outputChannel.appendLine('');
				}
				fs.writeFileSync(tmpFile, preprocessed, 'utf-8');
				console.log('[SQLFluff] Temp file size:', preprocessed.length, 'bytes');

				this.executeSqlfluffFormat(tmpFile, preprocessed, resolve, reject, outputChannel);
			} catch (error) {
				console.error('[SQLFluff] Error in formatSQL:', error);
				reject(error);
			}
		});
	}

	private preprocessSQL(sql: string): string {
		// Convert compact SQL into multi-line format
		// This helps sqlfluff understand the structure better
		
		// Don't process if already multi-line (has more than 2 lines)
		if (sql.split('\n').length > 2) {
			return sql;
		}

		// Replace keywords with newline + keyword
		let formatted = sql
			// Main SQL keywords with newline before them
			.replace(/\s+(SELECT|FROM|WHERE|GROUP\s+BY|HAVING|ORDER\s+BY|LIMIT|UNION|UNION\s+ALL|EXCEPT|INTERSECT|WITH)\s+/gi, '\n$1 ')
			// JOIN keywords
			.replace(/\s+(INNER\s+JOIN|LEFT\s+JOIN|RIGHT\s+JOIN|FULL\s+JOIN|CROSS\s+JOIN|LEFT\s+OUTER\s+JOIN|RIGHT\s+OUTER\s+JOIN|FULL\s+OUTER\s+JOIN)\s+/gi, '\n$1 ')
			// ON clause
			.replace(/\s+(ON)\s+\(/gi, '\n$1 (')
			// SELECT clause items - add newline before commas in SELECT
			.replace(/,\s+/g, ',\n  ')
			// Clean up multiple spaces
			.replace(/\n\s+\n/g, '\n')
			// Trim each line
			.split('\n')
			.map(line => line.trim())
			.filter(line => line.length > 0)
			.join('\n');

		console.log('[SQLFluff] Preprocessed SQL:', formatted.substring(0, 100));
		return formatted;
	}

	private executeSqlfluffFormat(
		tmpFile: string,
		sql: string,
		resolve: (value: string) => void,
		reject: (error: any) => void,
		outputChannel?: vscode.OutputChannel
	): void {
		try {
			const args = this.buildFixArgs(outputChannel);
			console.log('[SQLFluff] Executing:', this.sqlfluffPath, 'fix', ...args, tmpFile);
			
			// Format the file in-place
			const process = spawn(this.sqlfluffPath, ['fix', ...args, tmpFile], {
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stderr = '';
			let stdout = '';
			let isProcessing = true;

			process.stdout.on('data', (data) => {
				stdout += data.toString();
				console.log('[SQLFluff stdout]:', data.toString());
			});

			process.stderr.on('data', (data) => {
				stderr += data.toString();
				console.log('[SQLFluff stderr]:', data.toString());
			});

			process.on('error', (err) => {
				console.log('[SQLFluff] Process error:', err);
				if (isProcessing) {
					isProcessing = false;
					try { fs.unlinkSync(tmpFile); } catch (e) {}
					this.executePythonModuleFormat(sql, resolve, reject, outputChannel);
				}
			});

			process.on('close', (code) => {
				console.log('[SQLFluff] Process closed with code:', code);
				console.log('[SQLFluff] stderr:', stderr);
				console.log('[SQLFluff] stdout:', stdout);
				if (!isProcessing) return;
				isProcessing = false;

				try {
					// Try to read the formatted file regardless of exit code
					// Exit code 0 = success, code 1 = unfixable violations found (but file may still be partially formatted)
					let formatted = '';
					try {
						formatted = fs.readFileSync(tmpFile, 'utf-8');
					} catch (e) {
						// File read failed
					}

					if (formatted && formatted.trim()) {
						console.log('[SQLFluff] Formatted result size:', formatted.length);
						
						// Show info about exit code
						if (code !== 0) {
							if (outputChannel) {
								outputChannel.appendLine('');
								outputChannel.appendLine('ℹ️  sqlfluff found unfixable violations:');
								outputChannel.appendLine('─'.repeat(60));
								if (stdout.includes('unfixable')) {
									const match = stdout.match(/(\d+)\s+unfixable linting violations found/);
									if (match) {
										outputChannel.appendLine(`Found ${match[1]} unfixable violations.`);
									}
								}
								outputChannel.appendLine(stdout);
								outputChannel.appendLine('─'.repeat(60));
								outputChannel.appendLine('Formatting partially applied. Review unfixable violations manually.');
								outputChannel.appendLine('');
							}
						}
						
						// Show lint results (async, doesn't block formatting)
						if (outputChannel) {
							this.runLint(this.sqlfluffPath, ['lint', ...this.buildLintArgs(outputChannel)], sql, outputChannel);
						}
						
						try { fs.unlinkSync(tmpFile); } catch (e) {}
						resolve(formatted);
					} else {
						// No formatted output - actually failed
						console.log('[SQLFluff] No formatted output, exit code:', code);
						if (outputChannel) {
							outputChannel.appendLine('');
							outputChannel.appendLine('⚠️  sqlfluff returned code ' + code);
							outputChannel.appendLine('─'.repeat(60));
							outputChannel.appendLine('Output from sqlfluff:');
							outputChannel.appendLine(stderr || stdout || '(no output)');
							outputChannel.appendLine('─'.repeat(60));
							outputChannel.appendLine('');
						}
						try { fs.unlinkSync(tmpFile); } catch (e) {}
						this.executePythonModuleFormat(sql, resolve, reject, outputChannel);
					}
				} catch (error) {
					console.error('[SQLFluff] Error in close handler:', error);
					try { fs.unlinkSync(tmpFile); } catch (e) {}
					reject(error);
				}
			});
		} catch (error) {
			console.error('[SQLFluff] Error in executeSqlfluffFormat:', error);
			try { fs.unlinkSync(tmpFile); } catch (e) {}
			this.executePythonModuleFormat(sql, resolve, reject, outputChannel);
		}
	}

	private executePythonModuleFormat(
		sql: string,
		resolve: (value: string) => void,
		reject: (error: any) => void,
		outputChannel?: vscode.OutputChannel
	): void {
		try {
			const tmpFile = path.join(os.tmpdir(), `sqlfluff_${Date.now()}.sql`);
			console.log('[SQLFluff Python] Writing SQL to temp file:', tmpFile);
			fs.writeFileSync(tmpFile, sql, 'utf-8');

			const args = this.buildFixArgs();
			console.log('[SQLFluff Python] Executing:', this.pythonPath, '-m sqlfluff fix', ...args, tmpFile);
			
			// Format the file in-place
			const process = spawn(this.pythonPath, ['-m', 'sqlfluff', 'fix', ...args, tmpFile], {
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let stderr = '';
			let stdout = '';
			let isProcessing = true;

			process.stdout.on('data', (data) => {
				stdout += data.toString();
				console.log('[SQLFluff Python stdout]:', data.toString());
			});

			process.stderr.on('data', (data) => {
				stderr += data.toString();
				console.log('[SQLFluff Python stderr]:', data.toString());
			});

			process.on('error', (error: any) => {
				console.log('[SQLFluff Python] Process error:', error);
				if (isProcessing) {
					isProcessing = false;
					try { fs.unlinkSync(tmpFile); } catch (e) {}
					reject(new Error(`Failed to execute sqlfluff: ${error.message}`));
				}
			});

			process.on('close', (code) => {
				console.log('[SQLFluff Python] Process closed with code:', code);
				if (!isProcessing) return;
				isProcessing = false;

				try {
					if (code === 0) {
						// Read the formatted file
						const formatted = fs.readFileSync(tmpFile, 'utf-8');
						console.log('[SQLFluff Python] Formatted result size:', formatted.length);
						
						// Show lint results (async, doesn't block formatting)
						if (outputChannel) {
							this.runLint(this.pythonPath, ['-m', 'sqlfluff', 'lint', ...this.buildLintArgs()], sql, outputChannel);
						}
						
						try { fs.unlinkSync(tmpFile); } catch (e) {}
						resolve(formatted);
					} else {
						// Even with errors, try to read the formatted file (sqlfluff may have partially fixed it)
						console.log('[SQLFluff Python] Exit code:', code, 'stderr:', stderr);
						try {
							const formatted = fs.readFileSync(tmpFile, 'utf-8');
							if (formatted && formatted.trim()) {
								// File was partially formatted
								console.log('[SQLFluff Python] Partial format succeeded despite exit code:', code);
								if (outputChannel) {
									outputChannel.appendLine('');
									outputChannel.appendLine('⚠️  PARSING ERROR (Partial formatting applied)');
									outputChannel.appendLine('─'.repeat(60));
									outputChannel.appendLine('sqlfluff encountered an error but may have partially formatted your SQL.');
									outputChannel.appendLine('This often happens when:');
									outputChannel.appendLine('  1. The SQL dialect is incorrect');
									outputChannel.appendLine('  2. The SQL contains unsupported syntax');
									outputChannel.appendLine('  3. The SQL has Jinja2 templating that needs configuration');
									outputChannel.appendLine('');
									outputChannel.appendLine('Error details:');
									outputChannel.appendLine(stderr);
									outputChannel.appendLine('─'.repeat(60));
									outputChannel.appendLine('');
									outputChannel.appendLine('💡 Try updating the dialect in ~/.sqlfluff:');
									outputChannel.appendLine('  [core]');
									outputChannel.appendLine('  dialect = hive  # or snowflake, postgresql, etc.');
									outputChannel.appendLine('');
								}
								try { fs.unlinkSync(tmpFile); } catch (e) {}
								resolve(formatted);
								return;
							}
						} catch (e) {}
						
						// No formatted output, reject with detailed error
						try { fs.unlinkSync(tmpFile); } catch (e) {}
						if (outputChannel) {
							outputChannel.appendLine('');
							outputChannel.appendLine('❌ FORMATTING FAILED');
							outputChannel.appendLine('─'.repeat(60));
							outputChannel.appendLine('sqlfluff could not format your SQL:');
							outputChannel.appendLine(stderr);
							outputChannel.appendLine('─'.repeat(60));
							outputChannel.appendLine('');
							outputChannel.appendLine('💡 Try updating the dialect in ~/.sqlfluff:');
							outputChannel.appendLine('  [core]');
							outputChannel.appendLine('  dialect = hive  # or snowflake, postgresql, etc.');
							outputChannel.appendLine('');
						}
						if (stderr) {
							reject(new Error(`sqlfluff error: ${stderr.substring(0, 500)}`));
						} else {
							reject(new Error(`sqlfluff formatting failed with code ${code}`));
						}
					}
				} catch (error) {
					console.error('[SQLFluff Python] Error in close handler:', error);
					try { fs.unlinkSync(tmpFile); } catch (e) {}
					reject(error);
				}
			});
		} catch (error) {
			console.error('[SQLFluff Python] Error in executePythonModuleFormat:', error);
			reject(error);
		}
	}

	private runLint(
		cmd: string,
		args: string[],
		sql: string,
		outputChannel: vscode.OutputChannel
	): void {
		try {
			// Create a temporary file for lint (same as format)
			const tmpFile = path.join(os.tmpdir(), `sqlfluff_lint_${Date.now()}.sql`);
			fs.writeFileSync(tmpFile, sql, 'utf-8');
			
			console.log('[SQLFluff Lint] Executing:', cmd, ...args, tmpFile);
			// args are prepared by buildCliArgs(), just append the file path
			const process = spawn(cmd, [...args, tmpFile], {
				stdio: ['pipe', 'pipe', 'pipe']
			});

			let lintOutput = '';
			let lintError = '';

			process.stdout.on('data', (data) => {
				lintOutput += data.toString();
				console.log('[SQLFluff Lint stdout]:', data.toString());
			});

			process.stderr.on('data', (data) => {
				lintError += data.toString();
				console.log('[SQLFluff Lint stderr]:', data.toString());
			});

			process.on('close', () => {
				console.log('[SQLFluff Lint] Complete');
				try { fs.unlinkSync(tmpFile); } catch (e) {}
				
				if (lintOutput.trim()) {
					outputChannel.appendLine('📋 Lint Results:');
					outputChannel.appendLine('─'.repeat(60));
					outputChannel.appendLine(lintOutput);
					outputChannel.appendLine('─'.repeat(60));
				} else {
					outputChannel.appendLine('✓ No linting issues found!');
				}
				if (lintError.trim()) {
					outputChannel.appendLine('⚠️ Lint errors: ' + lintError);
				}
				outputChannel.appendLine('');
			});

			process.on('error', () => {
				console.error('[SQLFluff Lint] Process error');
				try { fs.unlinkSync(tmpFile); } catch (e) {}
			});
		} catch (error) {
			console.error('[SQLFluff Lint] Error:', error);
			outputChannel.appendLine('❌ Lint error: ' + String(error));
		}
	}

	private buildCliArgs(outputChannel?: vscode.OutputChannel): string[] {
		const args: string[] = [];
		const config = vscode.workspace.getConfiguration('sqlfluff');

		// Add excluded rules
		const excludeRules = config.get('excludeRules') as string[] || [];
		if (excludeRules.length > 0) {
			args.push('--exclude-rules');
			args.push(excludeRules.join(','));
		}

		const configPath = this.resolveConfigPath(outputChannel);
		if (configPath) {
			args.push('--config');
			args.push(configPath);
		}
		args.push('--nocolor');  // Disable colored output

		return args;
	}

	private buildFixArgs(outputChannel?: vscode.OutputChannel): string[] {
		const args = this.buildCliArgs(outputChannel);
		args.push('--force');    // Auto-accept changes without prompting (fix only)
		return args;
	}

	private buildLintArgs(outputChannel?: vscode.OutputChannel): string[] {
		const args = this.buildCliArgs(outputChannel);
		// Lint-specific options (no --force)
		return args;
	}

	private resolveConfigPath(outputChannel?: vscode.OutputChannel): string | null {
		// Priority: workspace .sqlfluff > ~/.sqlfluff > extension default .sqlfluff.default
		let configPath: string | null = null;

		// 1. Check workspace root
		if (vscode.workspace.workspaceFolders && vscode.workspace.workspaceFolders.length > 0) {
			const workspaceConfigPath = path.join(
				vscode.workspace.workspaceFolders[0].uri.fsPath,
				'.sqlfluff'
			);
			if (outputChannel) {
				outputChannel.appendLine(`[DEBUG] workspaceConfigPath: ${workspaceConfigPath}`);
				outputChannel.appendLine(`[DEBUG] exists: ${fs.existsSync(workspaceConfigPath)}`);
			}
			if (fs.existsSync(workspaceConfigPath)) {
				configPath = workspaceConfigPath;
				if (outputChannel) outputChannel.appendLine(`[SQLFluff Config] Using workspace config: ${workspaceConfigPath}`);
				return configPath;
			}
		}

		// 2. Check home directory
		const homeConfigPath = path.join(os.homedir(), '.sqlfluff');
		if (fs.existsSync(homeConfigPath)) {
			configPath = homeConfigPath;
			if (outputChannel) outputChannel.appendLine(`[SQLFluff Config] Using home directory config: ${homeConfigPath}`);
			return configPath;
		}

		// 3. Use extension's default config as fallback
		const extensionDefaultPath = path.join(this.extensionPath, '.sqlfluff.default');
		if (fs.existsSync(extensionDefaultPath)) {
			configPath = extensionDefaultPath;
			if (outputChannel) outputChannel.appendLine(`[SQLFluff Config] Using extension default config: ${extensionDefaultPath}`);
			return configPath;
		}

		if (outputChannel) outputChannel.appendLine(`[SQLFluff Config] No configuration file found, sqlfluff will use its own defaults`);
		return null;
	}
}
