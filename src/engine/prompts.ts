import { readFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const PROMPTS_DIR = resolve(__dirname, 'prompts');

const cache = new Map<string, string>();

/**
 * Load a prompt .md file from the prompts directory, optionally substituting
 * {{variable}} placeholders with provided values. Results are cached.
 */
export async function loadPrompt(
  name: string,
  vars?: Record<string, string>,
): Promise<string> {
  const filename = name.endsWith('.md') ? name : `${name}.md`;
  const cached = cache.get(filename);
  let content: string;

  if (cached !== undefined) {
    content = cached;
  } else {
    const filePath = resolve(PROMPTS_DIR, filename);
    content = await readFile(filePath, 'utf-8');
    cache.set(filename, content);
  }

  if (vars) {
    for (const [key, value] of Object.entries(vars)) {
      content = content.replaceAll(`{{${key}}}`, value);
    }
  }

  return content;
}
