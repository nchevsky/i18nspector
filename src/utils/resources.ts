import type {Dirent} from 'node:fs';
import {readFile, readdir} from 'node:fs/promises';

import {visit} from 'jsonc-parser';

import {IGNORE_DIRECTIVE, directoryEntries, escapeForRegExp, log, nameMatchesExtensions, pluralize} from './misc.js';
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
  log(`\t🔍  Parsing resource file ${filePath}`, 'debug');

  /** Current object nesting depth. */
  let depth = 0;
  /** Raw contents of the resource file. */
  const document = (await readFile(filePath)).toString();
  /** If < ∞, we're inside an object with an `ignore` directive and ignoring everything within. */
  let ignoreDepth = Number.POSITIVE_INFINITY;
  /** If ≠ -1, this line has an `ignore` directive. */
  let ignoreLineNumber = -1;
  /** If `true`, we've encountered an `ignore-begin` directive and are ignoring everything until `ignore-end`. */
  let ignoreUntilEndDirective = false;
  /** If ≠ -1, an object opening brace was encountered on this line. */
  let objectStartLineNumber = -1;
  /** Resources processed so far. */
  const resources = new Array<Resource>();

  visit(document, {
    onComment(offset, length, startLine, startCharacter) {
      if (depth >= ignoreDepth) return; // if we're already within an ignored object, bail

      const match = new RegExp(`[*/]\\s*(?<value>(${IGNORE_DIRECTIVE}-(begin|end))|${IGNORE_DIRECTIVE})(\\*|\\s|$)`)
        .exec(document.substring(offset, offset + length)); // includes delimiters and leading/trailing whitespace
      switch (match?.groups?.value) {
        case IGNORE_DIRECTIVE:
          ignoreLineNumber = startLine;
          // if an object's opening brace was previously found on this line, ignore everything within
          if (startLine == objectStartLineNumber) {
            ignoreDepth = depth;
          // if a resource was previously found on this line, mark it as ignored
          } else {
            const resource = resources[resources.length - 1];
            if (resource.definitions.get(context.languageTag)?.endsWith(`:${startLine + 1}`)) resource.isIgnored = true;
          }
          break;
        case `${IGNORE_DIRECTIVE}-begin`:
          ignoreUntilEndDirective = true;
          break;
        case `${IGNORE_DIRECTIVE}-end`:
          ignoreUntilEndDirective = false;
          break;
      }
    },

    onLiteralValue(value, offset, length, startLine, startCharacter, pathSupplier) {
      const path = pathSupplier();
      const lastSegment = path[path.length - 1];
      if (typeof lastSegment == 'string') {
        const match = lastSegment.match(/(?<baseKey>.+)_(one|other)$/);
        if (match) path.splice(-1, 1, match.groups!.baseKey);
      }

      const resourceKey = path.join('.');

      const resource = context.resources.get(resourceKey)
        ?? context.resources.set(resourceKey, new Resource(resourceKey)).get(resourceKey)!;
      resource.definitions.set(context.languageTag, `${filePath}:${startLine + 1}`);
      resource.isIgnored = resource.isIgnored // once `true`, always `true` for all languages and variations
        || depth >= ignoreDepth // within an ignored object
        || startLine == ignoreLineNumber // following an `ignore` line directive
        || ignoreUntilEndDirective; // between `ignore-begin` and `ignore-end` block directives
      resource.translations.set(context.languageTag, value);
      resources.push(resource);
    },

    onObjectBegin(offset, length, startLine, startCharacter, pathSupplier) {
      depth++;
      objectStartLineNumber = startLine;
      // if there was an `ignore` directive on this line, start ignoring everything within this object
      if (startLine == ignoreLineNumber) ignoreDepth = depth;
    },

    onObjectEnd(offset, length, startLine, startCharacter) {
      depth--;
      // if we were inside an ignored object and have just come out, stop ignoring
      if (depth < ignoreDepth) ignoreDepth = Number.POSITIVE_INFINITY;
    }
  });

  log(`\t\t🌐  ${resources.length} '${context.languageTag}' ${pluralize(resources.length, 'translation')}`, 'debug');

  return resources;
}

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
    if (match?.groups) {
      const path = `${directoryPath}/${directoryEntry.name}`;
      log(`<tab>✔️   Found '${options.baseLanguageTag}' base language at ${path}.`);

      // derive a regular expression that will match other language tags in the same path
      // - tags in directory names: 'en/translations.jsonc'    → '*/translations.<options.resourceExtensions>'
      // - tags in file names:      'translations/foo-en.json' → 'translations/foo-*.<options.resourceExtensions>'
      const regularExpression = new RegExp([
        '^',
        escapeForRegExp(match.groups.name),
        '\\b(?<languageTag>[-0-9A-Za-z]{2,})\\b',
        directoryEntry.isFile() ? `(?:${extensionRegExp})` : '',
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
      log(`🌐  Found ${resources.length} '${languageTag}' ${
        pluralize(resources.length, 'translation')} in ${filePath}.`);
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
