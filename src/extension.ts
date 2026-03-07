import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';
import { exec, execFile } from 'child_process';
import { promisify } from 'util';

const execAsync = promisify(exec);
const execFileAsync = promisify(execFile);
let outputChannel: vscode.OutputChannel;

type InstallSqlfluffResult = {
    success: boolean;
    message: string;
    env: NodeJS.ProcessEnv;
};

type SqlfluffResolution = {
    executable: string;
    baseArgs: string[];
    env: NodeJS.ProcessEnv;
    mode: 'configured-path' | 'path' | 'python-module';
};

export function activate(context: vscode.ExtensionContext) {
    outputChannel = vscode.window.createOutputChannel('SQLFluff');

    const disposable = vscode.commands.registerCommand('sqlfluff.format', async () => {
        await vscode.window.withProgress(
            {
                location: vscode.ProgressLocation.Notification,
                title: 'Formatting SQL...',
                cancellable: false
            },
            async () => {
                await formatSqlWithSqlfluff();
            }
        );
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
    const configuredPath = (config.get<string>('path', '') || '').trim();
    const additionalArgs = config.get<string[]>('args', []);
    let commandEnv: NodeJS.ProcessEnv = { ...process.env };
    let pythonPath: string | null = null;
    let sqlfluffResolution = await resolveSqlfluffCommand(configuredPath, commandEnv, pythonPath);

    if (!sqlfluffResolution) {
        outputChannel.appendLine(`sqlfluff not found at "${configuredPath || 'PATH'}".`);

        if (configuredPath) {
            vscode.window.showErrorMessage(
                `sqlfluff.path is set but not executable: ${configuredPath}. Please fix the path or clear sqlfluff.path to use PATH lookup.`
            );
            return;
        }

        pythonPath = await findPython();
        if (!pythonPath) {
            vscode.window.showErrorMessage('Neither sqlfluff nor python interpreter could be found.');
            return;
        }

        const consent = await vscode.window.showInformationMessage(
            'sqlfluff command not found. Would you like to install the sqlfluff package to your python interpreter?',
            'Install', 'Cancel'
        );

        if (consent !== 'Install') {
            vscode.window.showWarningMessage('sqlfluff installation was cancelled.');
            return;
        }

        const installResult = await installSqlfluffWithPython(pythonPath, commandEnv);
        commandEnv = installResult.env;

        if (!installResult.success) {
            vscode.window.showErrorMessage(
                installResult.message,
                'Open Output Panel'
            ).then(selection => {
                if (selection === 'Open Output Panel') {
                    outputChannel.show(true);
                }
            });
            return;
        }

        outputChannel.appendLine('sqlfluff installation completed.');
        sqlfluffResolution = await resolveSqlfluffCommand(configuredPath, commandEnv, pythonPath);
        if (!sqlfluffResolution) {
            vscode.window.showErrorMessage(
                'sqlfluff was installed, but executable resolution failed. Set sqlfluff.path explicitly.',
                'Open Output Panel'
            ).then(selection => {
                if (selection === 'Open Output Panel') {
                    outputChannel.show(true);
                }
            });
            return;
        }
    }

    outputChannel.appendLine(`Resolved sqlfluff mode: ${sqlfluffResolution.mode}`);
    if (sqlfluffResolution.mode === 'python-module') {
        outputChannel.appendLine(`Resolved sqlfluff via Python module: ${sqlfluffResolution.executable} -m sqlfluff`);
    } else {
        outputChannel.appendLine(`Resolved sqlfluff executable: ${sqlfluffResolution.executable}`);
    }

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

    const docIndent = getIndentation(document.lineAt(range.start.line).text);
    const selIndent = getIndentation(textToFormat);

    outputChannel.appendLine('-----------------------------');
    outputChannel.appendLine(`Formatting ${isSelection ? 'selection' : 'entire document'}`);
    outputChannel.appendLine(`Document: ${document.uri.fsPath}`);

    let tempFilePath: string | undefined;

    try {
        const textWithoutIndent = removeFirstLineIndent(textToFormat, selIndent);
        tempFilePath = createTempFile(textWithoutIndent);
        outputChannel.appendLine(`Temp file: ${tempFilePath}`);

        const finalArgs = ensureDialect(additionalArgs, tempFilePath);
        const formattedText = await runSqlfluff(sqlfluffResolution, tempFilePath, finalArgs);
        const textWithIndent = applyIndent(formattedText, selIndent, docIndent);
        const normalizedText = normalizeEol(textWithIndent, eol);

        await editor.edit((editBuilder) => {
            editBuilder.replace(range, normalizedText);
        });

        outputChannel.appendLine('Formatting completed.');

        vscode.window.showInformationMessage(
            'SQLFluff formatting completed. To see details, click below.',
            'Open Output Panel'
        ).then(selection => {
            if (selection === 'Open Output Panel') {
                outputChannel.show(true);
            }
        });
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

async function commandExists(cmd: string): Promise<boolean> {
    return commandExistsWithEnv(cmd, process.env);
}

async function commandExistsWithEnv(cmd: string, env: NodeJS.ProcessEnv): Promise<boolean> {
    const checkCmd = process.platform === 'win32'
        ? `where "${cmd}"`
        : `command -v "${cmd}"`;
    try {
        await execAsync(checkCmd, { env });
        return true;
    } catch {
        return false;
    }
}

async function findPython(): Promise<string | null> {
    const workspacePython = findWorkspacePython();
    const candidates = workspacePython ? [workspacePython, 'python3', 'python'] : ['python3', 'python'];
    for (const cmd of candidates) {
        if (isAbsolutePathCommand(cmd)) {
            if (isExecutablePath(cmd)) return cmd;
            continue;
        }

        if (await commandExists(cmd)) return cmd;
    }
    return null;
}

async function installSqlfluffWithPython(
    pythonPath: string,
    baseEnv: NodeJS.ProcessEnv
): Promise<InstallSqlfluffResult> {
    const envWithPythonScripts = await withPythonScriptsInPath(pythonPath, baseEnv);
    outputChannel.appendLine(`Installing sqlfluff using: ${pythonPath} -m pip install sqlfluff`);
    try {
        const { stdout, stderr } = await execFileAsync(pythonPath, ['-m', 'pip', 'install', 'sqlfluff'], {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: envWithPythonScripts,
        });
        outputChannel.appendLine(stdout);
        if (stderr) outputChannel.appendLine(stderr);

        const installed = await commandExistsWithEnv('sqlfluff', envWithPythonScripts);
        if (installed) {
            return {
                success: true,
                message: 'sqlfluff installation completed.',
                env: envWithPythonScripts,
            };
        }

        const moduleInstalled = await hasPythonModule(pythonPath, 'sqlfluff', envWithPythonScripts);
        if (moduleInstalled) {
            outputChannel.appendLine('sqlfluff CLI is not visible in PATH; using python -m sqlfluff fallback.');
            return {
                success: true,
                message: 'sqlfluff installed via Python module fallback.',
                env: envWithPythonScripts,
            };
        }

        return {
            success: false,
            message: 'sqlfluff was installed, but the command is not available in PATH yet. Restart VS Code or set sqlfluff.path explicitly.',
            env: envWithPythonScripts,
        };
    } catch (error: any) {
        const stderr = error?.stderr ? String(error.stderr) : '';
        const stdout = error?.stdout ? String(error.stdout) : '';
        const errorMessage = error?.message ? String(error.message) : String(error);
        const combined = `${errorMessage}\n${stderr}\n${stdout}`;

        outputChannel.appendLine(`sqlfluff installation error: ${errorMessage}`);
        if (stderr) outputChannel.appendLine(`STDERR: ${stderr}`);
        if (stdout) outputChannel.appendLine(`STDOUT: ${stdout}`);

        if (/No module named pip/i.test(combined)) {
            return {
                success: false,
                message: 'Failed to install sqlfluff: pip is missing for this Python interpreter. Try `python3 -m ensurepip --upgrade` or install `python3-pip`, then retry.',
                env: envWithPythonScripts,
            };
        }

        return {
            success: false,
            message: 'Failed to install sqlfluff. Check Python/pip availability and permissions, then retry.',
            env: envWithPythonScripts,
        };
    }
}

async function resolveSqlfluffCommand(
    configuredPath: string,
    env: NodeJS.ProcessEnv,
    pythonPath: string | null
): Promise<SqlfluffResolution | null> {
    if (configuredPath) {
        if (isExecutablePath(configuredPath)) {
            return {
                executable: configuredPath,
                baseArgs: [],
                env,
                mode: 'configured-path',
            };
        }

        return null;
    }

    if (await commandExistsWithEnv('sqlfluff', env)) {
        return {
            executable: 'sqlfluff',
            baseArgs: [],
            env,
            mode: 'path',
        };
    }

    const runtimePython = pythonPath ?? await findPython();
    if (!runtimePython) {
        return null;
    }

    const moduleInstalled = await hasPythonModule(runtimePython, 'sqlfluff', env);
    if (moduleInstalled) {
        return {
            executable: runtimePython,
            baseArgs: ['-m', 'sqlfluff'],
            env,
            mode: 'python-module',
        };
    }

    return null;
}

function createTempFile(content: string): string {
    const tmpFileName = `.sqlfluff_${Date.now()}_${Math.random().toString(36).substring(7)}.sql`;
    let tmpDir: string;
    const workspaceFolders = vscode.workspace.workspaceFolders;
    if (workspaceFolders && workspaceFolders.length > 0) {
        tmpDir = workspaceFolders[0].uri.fsPath;
    } else {
        tmpDir = os.tmpdir();
    }
    const tmpFilePath = path.join(tmpDir, tmpFileName);
    fs.writeFileSync(tmpFilePath, content, { encoding: 'utf-8' });
    return tmpFilePath;
}

async function runSqlfluff(
    resolution: SqlfluffResolution,
    filePath: string,
    additionalArgs: string[]
): Promise<string> {
    const args: string[] = [...resolution.baseArgs, 'fix', filePath, '-f', ...additionalArgs];

    outputChannel.appendLine(`Executing: ${formatCommandForOutput(resolution.executable, args)}`);

    try {
        const { stdout, stderr } = await execFileAsync(resolution.executable, args, {
            encoding: 'utf-8',
            maxBuffer: 10 * 1024 * 1024,
            env: resolution.env,
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
            return fs.readFileSync(filePath, { encoding: 'utf-8' });
        }

        if (
            String(stderr).includes('command not found') ||
            String(stderr).includes('not recognized') ||
            String(error.message || '').includes('ENOENT')
        ) {
            throw new Error('sqlfluff not found. Please install sqlfluff or set the path in settings.');
        }

        throw new Error(`sqlfluff exited with code ${exitCode}. Check output for details.`);
    }
}

function formatCommandForOutput(executable: string, args: string[]): string {
    const escapedArgs = args.map((arg) => {
        if (/\s|["'()]/.test(arg)) {
            return `"${arg.replace(/"/g, '\\"')}"`;
        }
        return arg;
    });
    return [executable, ...escapedArgs].join(' ');
}

function isAbsolutePathCommand(cmd: string): boolean {
    return path.isAbsolute(cmd);
}

function isExecutablePath(targetPath: string): boolean {
    try {
        const stat = fs.statSync(targetPath);
        if (!stat.isFile()) {
            return false;
        }

        if (process.platform === 'win32') {
            return true;
        }

        fs.accessSync(targetPath, fs.constants.X_OK);
        return true;
    } catch {
        return false;
    }
}

function findWorkspacePython(): string | null {
    const workspaceFolder = vscode.workspace.workspaceFolders?.[0]?.uri.fsPath;
    if (!workspaceFolder) {
        return null;
    }

    const candidates = process.platform === 'win32'
        ? [
            path.join(workspaceFolder, '.venv', 'Scripts', 'python.exe'),
            path.join(workspaceFolder, 'venv', 'Scripts', 'python.exe'),
            path.join(workspaceFolder, 'env', 'Scripts', 'python.exe'),
        ]
        : [
            path.join(workspaceFolder, '.venv', 'bin', 'python'),
            path.join(workspaceFolder, 'venv', 'bin', 'python'),
            path.join(workspaceFolder, 'env', 'bin', 'python'),
        ];

    for (const candidate of candidates) {
        if (isExecutablePath(candidate)) {
            outputChannel.appendLine(`Detected workspace virtual environment python: ${candidate}`);
            return candidate;
        }
    }

    return null;
}

async function hasPythonModule(
    pythonPath: string,
    moduleName: string,
    env: NodeJS.ProcessEnv
): Promise<boolean> {
    try {
        await execFileAsync(pythonPath, ['-c', `import ${moduleName}`], {
            encoding: 'utf-8',
            env,
            maxBuffer: 1024 * 1024,
        });
        return true;
    } catch {
        return false;
    }
}

async function withPythonScriptsInPath(
    pythonPath: string,
    baseEnv: NodeJS.ProcessEnv
): Promise<NodeJS.ProcessEnv> {
    const env: NodeJS.ProcessEnv = { ...baseEnv };
    const scriptsPaths = await getPythonScriptsPaths(pythonPath, env);

    if (scriptsPaths.length === 0) {
        return env;
    }

    const currentPath = env.PATH || '';
    const merged = [...scriptsPaths.filter(Boolean), ...currentPath.split(path.delimiter).filter(Boolean)];
    const deduped = Array.from(new Set(merged));
    env.PATH = deduped.join(path.delimiter);
    outputChannel.appendLine(`Patched PATH for sqlfluff execution: ${scriptsPaths.join(', ')}`);
    return env;
}

async function getPythonScriptsPaths(
    pythonPath: string,
    env: NodeJS.ProcessEnv
): Promise<string[]> {
    const script = [
        'import json, os, site, sysconfig',
        'paths = []',
        'scripts = sysconfig.get_path("scripts")',
        'if scripts: paths.append(scripts)',
        'user_base = getattr(site, "USER_BASE", None)',
        'if user_base:',
        '    paths.append(os.path.join(user_base, "Scripts" if os.name == "nt" else "bin"))',
        'print(json.dumps(paths))',
    ].join('\n');

    try {
        const { stdout } = await execFileAsync(pythonPath, ['-c', script], {
            encoding: 'utf-8',
            env,
            maxBuffer: 1024 * 1024,
        });

        const raw = JSON.parse(stdout.trim()) as string[];
        return raw.filter((entry) => typeof entry === 'string' && entry.length > 0 && fs.existsSync(entry));
    } catch (error) {
        outputChannel.appendLine(`Failed to detect python scripts path: ${error}`);
        return [];
    }
}

function normalizeEol(text: string, targetEol: string): string {
    const normalized = text.replace(/\r\n/g, '\n').replace(/\r/g, '\n');
    return targetEol === '\r\n' ? normalized.replace(/\n/g, '\r\n') : normalized;
}

function getIndentation(text: string): string {
    const firstLine = text.split(/\r?\n/)[0];
    const match = firstLine.match(/^(\s*)/);
    return match ? match[1] : '';
}

function removeFirstLineIndent(text: string, indent: string): string {
    if (!indent) return text;
    const lines = text.split(/\r?\n/);
    if (lines[0].startsWith(indent)) {
        lines[0] = lines[0].substring(indent.length);
    }
    return lines.join('\n');
}

function applyIndent(text: string, firstIndent: string, otherIndent: string): string {
    const lines = text.split(/\r?\n/);
    return lines.map((line, i) => {
        if (line.trim().length === 0) return line;
        return (i === 0 ? firstIndent : otherIndent) + line;
    }).join('\n');
}

function ensureDialect(args: string[], tempFilePath: string): string[] {
    const hasDialect = args.some((arg, index) => {
        return arg === '--dialect' || arg === '-d' ||
            (index > 0 && (args[index - 1] === '--dialect' || args[index - 1] === '-d'));
    });

    if (hasDialect) return args;

    // Check if .sqlfluff file exists and has dialect configured
    const hasDialectInConfig = checkSqlfluffConfig(tempFilePath);
    if (hasDialectInConfig) {
        outputChannel.appendLine('No dialect specified in args. Using dialect from .sqlfluff config.');
        return args;
    }

    outputChannel.appendLine('No dialect found in args or .sqlfluff config. Using default: ansi');
    return [...args, '--dialect', 'ansi'];
}

function checkSqlfluffConfig(tempFilePath: string): boolean {
    try {
        const dir = path.dirname(tempFilePath);
        const homeDir = os.homedir();
        
        const locations = [
            path.join(dir, '.sqlfluff'),      // 워크스페이스 폴더
            path.join(homeDir, '.sqlfluff')   // 홈 디렉토리
        ];

        for (const sqlfluffPath of locations) {
            if (fs.existsSync(sqlfluffPath)) {
                const content = fs.readFileSync(sqlfluffPath, 'utf-8');
                if (/^\s*dialect\s*=/m.test(content)) {
                    outputChannel.appendLine(`Found dialect setting in: ${sqlfluffPath}`);
                    return true;
                }
            }
        }
        return false;
    } catch (error) {
        outputChannel.appendLine(`Error checking .sqlfluff config: ${error}`);
        return false;
    }
}
