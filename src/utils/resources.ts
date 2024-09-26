import type {Dirent} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';

import {IGNORE_DIRECTIVE, directoryEntries, escapeForRegExp, log, nameMatchesExtensions, pluralize} from './misc.ts';
import {options} from '../index.ts';
import type Resource from '../models/Resource.ts';
import parseJsonc from '../parsers/jsonc.ts';
import parseProperties from '../parsers/properties.ts';

export interface Context {
  filePath: string;
  languageTag: string;
  resources: Map<string, Resource>;
}

export type Parser = (buffer: Buffer, context: Context) => Array<Resource>;

export const FILE_EXTENSIONS = ['.json', '.jsonc', '.properties'] as const;
export const IGNORE_DIRECTIVE_PATTERN = `(?<directive>${IGNORE_DIRECTIVE})(-(?<marker>begin|end))?`;
export const RESOURCE_KEY_REGEXP = /(?<baseKey>.+)_(ordinal_)?(few|interval|many|one|other|plural|two|zero)$/;

export async function findBaseLanguage(directoryPath: string): Promise<
  {directoryEntry: Dirent, regularExpression: RegExp} | undefined
> {
  log(`📂  Searching for base language ('${options.baseLanguageTag}') in ${directoryPath}`, 'debug');

  const directoryEntries = await readdir(directoryPath, {withFileTypes: true});
  const extensionRegExp = options.resourceExtensions.map((extension) => escapeForRegExp(extension)).join('|');

  // attempt a breadth-first search
  for (const directoryEntry of directoryEntries) {
    if ((!directoryEntry.isDirectory() || directoryEntry.name == 'node_modules') && !directoryEntry.isFile()) continue;

    // if the name of this directory or file contains the base language tag
    // - tags in directory names: *<options.baseLanguageTag>.<options.resourceExtensions>
    // - tags in file names:      *<options.baseLanguageTag>
    const match = new RegExp([
      '^(?<name>.*)',
      `\\b${options.baseLanguageTag}\\b`,
      directoryEntry.isFile() ? `.*(${extensionRegExp})` : '',
      '$'
    ].join('')).exec(directoryEntry.name);
    if (match) {
      const path = `${directoryPath}/${directoryEntry.name}`;
      log(`<tab>✔️   Found '${options.baseLanguageTag}' base language at ${path}.`);

      // derive a regular expression that will match other language tags in the same path
      // - tags in directory names: 'en/translations.jsonc'    → '*/translations.<options.resourceExtensions>'
      // - tags in file names:      'translations/foo-en.json' → 'translations/foo-*.<options.resourceExtensions>'
      const regularExpression = new RegExp([
        '^',
        escapeForRegExp(match.groups?.name ?? ''),
        '\\b(?<languageTag>[-0-9A-Za-z]{2,})\\b',
        directoryEntry.isFile() ? `(?:${extensionRegExp})` : '',
        '$'
      ].join(''));

      return {directoryEntry, regularExpression};
    }
  }

  // if nothing was found in this directory, recurse into subdirectories
  for (const directoryEntry of directoryEntries) {
    if (directoryEntry.isDirectory()) {
      const result = await findBaseLanguage(`${directoryPath}/${directoryEntry.name}`);
      if (result) return result;
    }
  }
}

export async function processResourceFiles(
  directoryPath: string,
  context: {baseLanguage: NonNullable<Awaited<ReturnType<typeof findBaseLanguage>>>, resources: Map<string, Resource>},
  recursionContext?: {languageTag?: string}
): Promise<Array<{languageTag: string, filePath: string}>> {
  const files = new Array<Awaited<ReturnType<typeof processResourceFiles>>[0]>();

  async function addAndProcessFile(filePath: string, languageTag: string) {
    files.push({filePath, languageTag});

    const resources = await parseResourceFile({filePath, languageTag, resources: context.resources});
    if (options.verbose == 1) {
      log(`🌐  Found ${resources.length} '${languageTag}' ${
        pluralize(resources.length, 'translation')} in ${filePath}.`);
    }
  }

  async function parseResourceFile(context: Context) {
    let resources: Array<Resource>;

    log(`\t🔍  Parsing resource file ${context.filePath}`, 'debug');

    const buffer = await readFile(context.filePath);
    const {groups} = /(?<extension>\.[^.]+)$/.exec(context.filePath) ?? {};
    switch (groups?.extension as typeof FILE_EXTENSIONS[number]) {
      case '.json':
      case '.jsonc':
        resources = parseJsonc(buffer, context); break;
      case '.properties':
        resources = parseProperties(buffer, context); break;
    }

    log(`\t\t🌐  ${resources.length} '${context.languageTag}' ${pluralize(resources.length, 'translation')}`, 'debug');

    return resources;
  }

  log(`📂  Searching for ${options.resourceExtensions.join(', ')} resources in ${directoryPath}`, 'debug');

  for await (const directoryEntry of await directoryEntries(directoryPath)) {
    const path = `${directoryPath}/${directoryEntry.name}`;

    // if this is a viable directory
    if (directoryEntry.isDirectory() && directoryEntry.name != 'node_modules') {
      let languageTag = recursionContext?.languageTag;
      // if called non-recursively and the base language is a directory
      // (i.e. we're still listing the directory that contains the base language)
      if (context.baseLanguage.directoryEntry.isDirectory() && !recursionContext) {
        const match = context.baseLanguage.regularExpression.exec(directoryEntry.name);
        if (match) { // if this directory's name matches the base language directory's pattern, capture its language tag
          languageTag = match.groups!.languageTag;
        } else { // if it doesn't match, skip it
          log(`➖  Skipped ${path} as it doesn't match pattern ${context.baseLanguage.regularExpression}.`, 'debug');
          continue;
        }
      }
      // descend
      files.push(...await processResourceFiles(path, context, {languageTag}));
    // if this is a viable file
    } else if (directoryEntry.isFile() && nameMatchesExtensions(directoryEntry.name, options.resourceExtensions)) {
      // if the base language is a directory
      if (context.baseLanguage.directoryEntry.isDirectory()) {
        if (recursionContext) { // if called recursively, process the file
          await addAndProcessFile(path, recursionContext.languageTag!);
        } else { // if called non-recursively (i.e. we're still listing the directory that contains the base language)
          log(`➖  Skipped ${path} as it's adjacent to language directories.`, 'debug');
          continue;
        }
      // if the base language is a file
      } else if (context.baseLanguage.directoryEntry.isFile()) {
        const match = context.baseLanguage.regularExpression.exec(directoryEntry.name);
        if (match?.groups?.languageTag) { // if this file's name matches the base language file's pattern, process it
          await addAndProcessFile(path, match.groups.languageTag);
        } else { // if it doesn't match, skip it
          log(`➖  Skipped ${path} as it doesn't match pattern ${context.baseLanguage.regularExpression}.`, 'debug');
          continue;
        }
      }
    }
  }

  return files;
}
