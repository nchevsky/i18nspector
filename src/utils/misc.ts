import type {Dirent} from 'node:fs';
import {readdir} from 'node:fs/promises';

import {options} from '../index.ts';

export const IGNORE_DIRECTIVE = 'i18nspector-ignore';

export async function directoryEntries(directoryPath: string) {
  function filesBeforeDirectories(a: Dirent, b: Dirent) {
    return a.isFile() && b.isDirectory()
      ? -1
      : a.isDirectory() && b.isFile()
        ? 1
        : a.name.localeCompare(b.name);
  }

  return (await readdir(directoryPath, {withFileTypes: true})).sort(filesBeforeDirectories);
}

export function escapeForRegExp(text: string) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function formatCount(count: number, noun: string) {
  return `${count} ${pluralize(count, noun)}`;
}

export function log(message: string, severity: 'debug' | 'error' | 'info' = 'info') {
  if (severity == 'debug' && options.verbose < 2) return;
  if (severity == 'info' && options.verbose < 1) return;

  (severity == 'debug'
    ? console.debug
    : severity == 'error'
      ? console.error
      : console.info)(message.replace('<tab>', options.verbose > 1 ? '\t' : ''));
}

export function nameMatchesExtensions(fileName: string, extensions: Array<string>) {
  return extensions.some((extension) => fileName.endsWith(extension));
}

/**
 * Given an array of entries, generates all possible permutations of each entry's values.
 * 
 * @param entries Two-dimensional array of entries and their possible values, e.g.
 *                ```ts
 *                [['e1v1', 'e1v2'], ['e2v1', 'e2v2']]
 *                ```
 * @returns Two-dimensional array of permutations, e.g.
 *          ```ts
 *          [['e1v1', 'e2v1'], ['e1v1', 'e2v2'], ['e1v2', 'e2v1'], ['e1v2', 'e2v2']]
 *          ```
 */
export function permutate<Element>(entries: Array<Array<Element>>, precursors: typeof entries[0] = []) {
  const permutations: Array<Array<Element>> = [];

  for (const value of entries[precursors.length]!) {
    const permutation = [...precursors, value];
    if (precursors.length == entries.length - 1) {
      permutations.push(permutation);
    } else {
      permutations.push(...permutate(entries, permutation));
    }
  }

  return permutations;
}

export function pluralize(count: number, noun: string) {
  return `${noun}${count == 1 ? '' : 's'}`;
}
