import * as vscode from 'vscode';
import * as path from 'path';
import * as os from 'os';
import { SQLFluffFormatter } from './formatter';

let formatter: SQLFluffFormatter;
let outputChannel: vscode.OutputChannel;

export function activate(context: vscode.ExtensionContext) {
	console.log('SQLFluff Formatter extension is now active');

	// Create output channel for lint results
	outputChannel = vscode.window.createOutputChannel('SQLFluff');

	formatter = new SQLFluffFormatter();

	// Register the format command
	let disposable = vscode.commands.registerCommand('sqlfluff-formatter.formatSQL', async () => {
		const editor = vscode.window.activeTextEditor;
		if (!editor) {
			vscode.window.showErrorMessage('No active editor found');
			return;
		}

		console.log('[Command] Format SQL command triggered');
		console.log('[Command] Selection:', editor.selection);
		console.log('[Command] Selection isEmpty:', editor.selection.isEmpty);
		
		// Show progress indicator
		await vscode.window.withProgress(
			{
				location: vscode.ProgressLocation.Notification,
				title: 'Formatting SQL...',
				cancellable: false,
			},
			async () => {
				try {
					// Clear output and show it
					outputChannel.clear();
					outputChannel.show(true);
					
					outputChannel.appendLine('═'.repeat(60));
					outputChannel.appendLine('🔄 SQLFluff Formatter - Starting');
					outputChannel.appendLine('═'.repeat(60));
					outputChannel.appendLine('');
					
					await formatter.formatDocument(editor, outputChannel);
					vscode.window.showInformationMessage('SQL formatted successfully ✓');
					outputChannel.appendLine('═'.repeat(60));
					outputChannel.appendLine('✅ Formatting completed successfully');
					outputChannel.appendLine('═'.repeat(60));
				} catch (error: any) {
					vscode.window.showErrorMessage(`Format error: ${error.message}`);
					outputChannel.appendLine(`\n❌ Format error: ${error.message}`);
					outputChannel.appendLine('═'.repeat(60));
					console.error('Format error:', error);
				}
			}
		);
	});

	context.subscriptions.push(disposable);
	context.subscriptions.push(outputChannel);

	// Register provider for editor format command
	vscode.languages.registerDocumentFormattingEditProvider('sql', {
		provideDocumentFormattingEdits: async (document: vscode.TextDocument) => {
			console.log('[Extension] provideDocumentFormattingEdits called');
			const editor = vscode.window.activeTextEditor;
			console.log('[Extension] activeTextEditor:', editor?.document.fileName);
			if (editor && editor.document === document) {
				console.log('[Extension] Starting document formatting');
				return await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Window,
						title: 'Formatting SQL...',
					},
					async () => {
						try {
							outputChannel.clear();
							outputChannel.show(true);
							const result = await formatter.formatDocument(editor, outputChannel, true);
							console.log('[Extension] formatDocument completed, edits:', result.length);
							return result;
						} catch (error: any) {
							console.error('[Extension] Format error:', error);
							vscode.window.showErrorMessage(`Format error: ${error.message}`);
							outputChannel.appendLine(`\n❌ Format error: ${error.message}`);
							return [];
						}
					}
				);
			}
			console.log('[Extension] Editor mismatch or no active editor');
			return [];
		}
	});

	// Register range format provider
	vscode.languages.registerDocumentRangeFormattingEditProvider('sql', {
		provideDocumentRangeFormattingEdits: async (document: vscode.TextDocument, range: vscode.Range) => {
			console.log('[Extension] provideDocumentRangeFormattingEdits called');
			const editor = vscode.window.activeTextEditor;
			console.log('[Extension] activeTextEditor:', editor?.document.fileName);
			if (editor && editor.document === document) {
				console.log('[Extension] Starting range formatting:', range);
				return await vscode.window.withProgress(
					{
						location: vscode.ProgressLocation.Window,
						title: 'Formatting SQL...',
					},
					async () => {
						try {
							outputChannel.clear();
							outputChannel.show(true);
							const result = await formatter.formatRange(editor, range, outputChannel, true);
							console.log('[Extension] formatRange completed, edits:', result.length);
							return result;
						} catch (error: any) {
							console.error('[Extension] Format error:', error);
							vscode.window.showErrorMessage(`Format error: ${error.message}`);
							outputChannel.appendLine(`\n❌ Format error: ${error.message}`);
							return [];
						}
					}
				);
			}
			console.log('[Extension] Editor mismatch or no active editor');
			return [];
		}
	});
}

export function deactivate() {
	console.log('SQLFluff Formatter extension is now deactivated');
}
