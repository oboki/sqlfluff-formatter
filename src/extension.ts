import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('SQLFluff');

    const disposable = vscode.commands.registerCommand('sqlfluff.format', async () => {
        await formatSqlWithSqlfluff();
    });

    context.subscriptions.push(disposable, outputChannel);
}

export function deactivate() { }

async function formatSqlWithSqlfluff() {
    const editor = vscode.window.activeTextEditor;
    if (!editor) {
        vscode.window.showErrorMessage('No active editor found.');
        return;
    }

    const document = editor.document;
    const config = vscode.workspace.getConfiguration('sqlfluff');
    const sqlfluffPath = config.get<string>('path', '') || 'sqlfluff';
    const additionalArgs = config.get<string[]>('args', []);

    const selection = editor.selection;
    const isSelection = !selection.isEmpty;
    const range = isSelection
        ? new vscode.Range(selection.start, selection.end)
        : new vscode.Range(
            document.lineAt(0).range.start,
            document.lineAt(document.lineCount - 1).range.end
        );

    const textToFormat = document.getText(range);
    const eol = document.eol === vscode.EndOfLine.LF ? '\n' : '\r\n';

    outputChannel.appendLine('-----------------------------');
    outputChannel.appendLine(`Formatting ${isSelection ? 'selection' : 'entire document'}`);
    outputChannel.appendLine(`Document: ${document.uri.fsPath}`);

    let tempFilePath: string | undefined;

    try {
        tempFilePath = createTempFile(textToFormat);
        outputChannel.appendLine(`Temp file: ${tempFilePath}`);

        const configPath = findSqlfluffConfig(document);
        if (configPath) {
            outputChannel.appendLine(`Using config: ${configPath}`);
        } else {
            outputChannel.appendLine('No .sqlfluff config found, using default settings.');
        }

        const finalArgs = ensureDialect(additionalArgs, configPath);
        const formattedText = await runSqlfluff(sqlfluffPath, tempFilePath, configPath, finalArgs);
        const normalizedText = normalizeEol(formattedText, eol);

        await editor.edit((editBuilder) => {
            editBuilder.replace(range, normalizedText);
        });

        outputChannel.appendLine('Formatting completed successfully.');
    } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        vscode.window.showErrorMessage(`SQLFluff formatting failed: ${errorMessage}`);
        outputChannel.appendLine(`Error: ${errorMessage}`);
    } finally {
        if (tempFilePath && fs.existsSync(tempFilePath)) {
            fs.unlinkSync(tempFilePath);
            outputChannel.appendLine(`Temp file deleted: ${tempFilePath}`);
        }
    }
}

function createTempFile(content: string): string {
    const tmpFileName = `sqlfluff_${Date.now()}_${Math.random().toString(36).substring(7)}.sql`;
    const tmpFilePath = path.join(os.tmpdir(), tmpFileName);
    fs.writeFileSync(tmpFilePath, content, { encoding: 'utf-8' });
    return tmpFilePath;
}

async function runSqlfluff(
    sqlfluffPath: string,
    filePath: string,
    configPath: string | null,
    additionalArgs: string[]
): Promise<string> {
    const args: string[] = ['fix', quotePath(filePath), '-f'];

    if (configPath) {
        args.push('--config', quotePath(configPath));
    }

    if (additionalArgs.length > 0) {
        args.push(...additionalArgs);
    }

    const command = `${quotePath(sqlfluffPath)} ${args.join(' ')}`;
    outputChannel.appendLine(`Executing: ${command}`);

    try {
        const { stdout, stderr } = await execAsync(command, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
        });

        outputChannel.appendLine('Exit code: 0');
        if (stderr) outputChannel.appendLine(`STDERR: ${stderr}`);
        if (stdout) outputChannel.appendLine(`STDOUT: ${stdout}`);

        return fs.readFileSync(filePath, { encoding: 'utf-8' });
    } catch (error: any) {
        const exitCode = error.code ?? 'unknown';
        const stderr = error.stderr ?? '';
        const stdout = error.stdout ?? '';

        outputChannel.appendLine(`Exit code: ${exitCode}`)
        if (stderr) outputChannel.appendLine(`STDERR: ${stderr}`);
        if (stdout) outputChannel.appendLine(`STDOUT: ${stdout}`);

        if (exitCode == 1) {
            outputChannel.appendLine('Files were fixed successfully (exit code 1 is normal)');
            return fs.readFileSync(filePath, { encoding: 'utf-8' });
        }

        if (stderr.includes('command not found') || stderr.includes('not recognized') || error.message?.includes('ENOENT')) {
            throw new Error('sqlfluff not found. Please install sqlfluff or set the path in settings.');
        }

        throw new Error(`sqlfluff exited with code ${exitCode}. Check output for details.`);
    }
}

function quotePath(p: string): string {
    if (p.startsWith('"') && p.endsWith('"')) return p;
    if (p.includes(' ') || p.includes('(') || p.includes(')')) return `"${p}"`;
    return p;
}

function normalizeEol(text: string, targetEol: string): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return targetEol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function ensureDialect(args: string[], configPath: string | null): string[] {
    if (configPath) return args;

    const hasDialect = args.some((arg, index) => {
        return arg === '--dialect' || arg === '-d' ||
            (index > 0 && (args[index - 1] === '--dialect' || args[index - 1] === '-d'));
    });

    if (hasDialect) return args;

    outputChannel.appendLine('No SQLFluff dialect specified. Using default: ansi');
    return [...args, '--dialect', 'ansi']
}

function findSqlfluffConfig(document: vscode.TextDocument): string | null {
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (!workspaceFolders) return null;

    const folder = vscode.workspace.getWorkspaceFolder(document.uri) || workspaceFolders[0];
    const projectConfigPath = path.join(folder.uri.fsPath, '.sqlfluff');
    if (fs.existsSync(projectConfigPath)) return projectConfigPath;

    const homeConfigPath = path.join(os.homedir(), '.sqlfluff');
    if (fs.existsSync(homeConfigPath)) return homeConfigPath;

    return null;
}
