import type {Dirent} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';

import {directoryEntries, escapeForRegExp, log, nameMatchesExtensions, pluralize} from './misc.js';
import {options} from '../index.js';
import Resource from '../models/Resource.js';

interface Context {
  languageTag: string;
  resources: Map<string, Resource>;
}

interface Node { // eslint-disable-line @typescript-eslint/consistent-indexed-object-style
  [key: string]: Value;
}

type Value = Array<Value> | Node | boolean | number | null | string;

async function parseResourceFile(filePath: string, context: Context) {
  const resources = new Array<Resource>();

  function processNode(node: Node, parentKey = '') {
    for (const [nodeKey, nodeValue] of Object.entries(node)) {
      const resourceKey = `${parentKey}${parentKey ? '.' : ''}${nodeKey}`;

      // if the value is an object, descend into it
      if (typeof nodeValue == 'object' && nodeValue !== null && !Array.isArray(nodeValue)) {
        processNode(nodeValue, resourceKey);
      // otherwise, add the value as a translation
      } else {
        const resource = context.resources.get(resourceKey)
          ?? context.resources.set(resourceKey, new Resource(resourceKey)).get(resourceKey)!;
        resource.definitions.set(context.languageTag, filePath);
        resource.translations.set(context.languageTag, nodeValue);
        resources.push(resource);
      }
    }
  }

  log(`\t🔍  Parsing resource file ${filePath}`, 'debug');
  processNode(JSON.parse((await readFile(filePath)).toString()));
  log(`\t\t🌐  ${resources.length} '${context.languageTag}' ${pluralize(resources.length, 'translation')}`, 'debug');

  return resources;
}

export async function findBaseLanguage(directoryPath: string): Promise<
  {directoryEntry: Dirent, regularExpression: RegExp} | undefined
> {
  log(`📂  Searching for base language ('${options.baseLanguageTag}') in ${directoryPath}`, 'debug');

  const directoryEntries = await readdir(directoryPath, {withFileTypes: true});

  // attempt a breadth-first search
  for (const directoryEntry of directoryEntries) {
    if ((!directoryEntry.isDirectory() || directoryEntry.name == 'node_modules') && !directoryEntry.isFile()) continue;

    // if the name of this directory or file contains the base language tag
    const match = new RegExp(`\\b(${options.baseLanguageTag})\\b${directoryEntry.isFile()
      ? `.*(?:${options.resourceExtensions.map((extension) => escapeForRegExp(extension)).join('|')})`
      : ''}$`, 'd').exec(directoryEntry.name);
    if (match?.indices) {
      const path = `${directoryPath}/${directoryEntry.name}`;
      log(`<tab>✔️   Found '${options.baseLanguageTag}' base language at ${path}.`);

      // derive a regular expression that will match other language tags in the same path
      // - tags in directory names: 'en/translations.json'     → '*/translations.json'
      // - tags in file names:      'translations/foo-en.json' → 'translations/foo-*.json'
      const [, [languageTagBeginIndex, languageTagEndIndex]] = match.indices;
      const regularExpression = new RegExp([
        '^',
        escapeForRegExp(directoryEntry.name.substring(0, languageTagBeginIndex)),
        '\\b(?<languageTag>[-0-9A-Za-z]{2,})\\b',
        escapeForRegExp(directoryEntry.name.substring(languageTagEndIndex)),
        '$'
      ].join(''));

      directoryEntry.path = directoryPath; // TODO: Node.js v20 adds its own `path` property
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

  const addAndProcessFile = async (filePath: string, languageTag: string) => {
    files.push({filePath, languageTag});

    const resources = await parseResourceFile(filePath, {languageTag, resources: context.resources});
    if (options.verbose == 1) {
      log(`🌐  Found ${resources.length} '${languageTag}' ${pluralize(resources.length, 'string')} in ${filePath}.`);
    }
  };

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
        if (match) { // if the name of this file matches the base language file's pattern, process it
          await addAndProcessFile(path, match.groups!.languageTag);
        } else { // if it doesn't match, skip it
          log(`➖  Skipped ${path} as it doesn't match pattern ${context.baseLanguage.regularExpression}.`, 'debug');
          continue;
        }
      }
    }
  }

  return files;
}
