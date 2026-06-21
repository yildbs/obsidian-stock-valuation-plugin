import { copyFile, mkdir, rm } from 'node:fs/promises';
import path from 'node:path';

const pluginId = 'obsidian-stock-valuation-plugin';
const outputDir = path.join('output', pluginId);
const releaseFiles = ['main.js', 'manifest.json', 'styles.css'];

await rm(outputDir, { recursive: true, force: true });
await mkdir(outputDir, { recursive: true });

await Promise.all(
	releaseFiles.map((fileName) =>
		copyFile(fileName, path.join(outputDir, fileName)),
	),
);

console.log(`Copied release files to ${outputDir}`);
