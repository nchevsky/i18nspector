#!/usr/bin/env node

import type Resource from './models/Resource.js';
import {formatCount, log} from './utils/misc.js';
import {findBaseLanguage, processResourceFiles} from './utils/resources.js';
import {processSourceCodeFiles} from './utils/source-code.js';

const options = {
  baseLanguageTag: 'en',
  checkForOrphanedStrings: true,
  checkForUntranslatedStrings: true,
  resourceExtensions: ['.json', '.jsonc'],
  resourcePaths: new Array<string>(),
  sourceCodeExtensions: ['.js', '.jsx', '.ts', '.tsx'],
  sourceCodePaths: new Array<string>(),
  verbose: 0
};

const optionalResourcePaths = new Array<string>();
const resourceFilesByLanguageTag = new Map<string, Array<string>>();
const resources = new Map<string, Resource>();
const sourceCodeProblems: Parameters<typeof processSourceCodeFiles>[1]['problems'] = [];

// process command-line arguments
for (const argument of process.argv.slice(2)) {
  const argumentValue = argument.split('=')[1];
  const argumentValueList = () =>
    argumentValue.split(',').filter((element) => Boolean(element.trim()));

  if (argument.startsWith('--baseLanguage=')) {
    options.baseLanguageTag = argumentValue;
  } else if (argument.startsWith('--checkForOrphanedStrings=')) {
    if (argumentValue.match(/^no$/i)) options.checkForOrphanedStrings = false;
  } else if (argument.startsWith('--checkForUntranslatedStrings=')) {
    if (argumentValue.match(/^no$/i)) options.checkForUntranslatedStrings = false;
  } else if (argument.startsWith('--resourceExtensions=')) {
    const extensions = argumentValueList();
    if (extensions.length) options.resourceExtensions = extensions;
  } else if (argument.startsWith('--resourcePaths=')) {
    for (const path of argumentValueList()) {
      if (path.endsWith('?')) {
        const actualPath = path.slice(0, -1);
        optionalResourcePaths.push(actualPath);
        options.resourcePaths.push(actualPath);
      } else {
        options.resourcePaths.push(path);
      }
    }
  } else if (argument.startsWith('--sourceCodeExtensions=')) {
    const extensions = argumentValueList();
    if (extensions.length) options.sourceCodeExtensions = extensions;
  } else if (argument.startsWith('--sourceCodePaths=')) {
    options.sourceCodePaths = argumentValueList();
  } else if (argument.startsWith('--verbose=')) {
    options.verbose = +argumentValue;
  }
}

// display help if no paths were given
if (!options.resourcePaths.length || !options.sourceCodePaths.length) {
  console.log(`npx i18nspector --resourcePaths=<path>,… [--resourceExtensions=<extension>,…]
                --sourceCodePaths=<path>,… [--sourceCodeExtensions=<extension>,…]
                [--reportOrphanedStrings=<no|yes>] [--reportUntranslatedStrings=<no|yes>]
                [--baseLanguage=<language-tag>] [--verbose=<0|1|2>]

            --resourcePaths: Comma-separated list of paths to recursively scan for translations.
       --resourceExtensions: Comma-separated list of translation file name extensions to process.
                             Defaults to '.json,.jsonc'.

          --sourceCodePaths: Comma-separated list of paths to recursively scan for source code.
     --sourceCodeExtensions: Comma-separated list of source code file name extensions to process.
                             Defaults to '.js,.jsx,.ts,.tsx'.

    --reportOrphanedStrings: Whether to check for strings that aren't referenced by source code.
                             Defaults to 'yes'.
--reportUntranslatedStrings: Whether to check for strings that are missing translations.
                             Defaults to 'yes'.

             --baseLanguage: IETF tag of the language in which strings are initially written.
                             Defaults to 'en'.
                  --verbose: - 0 (default) prints a summary along with any problems found.
                             - 1 prints what level 0 does, plus string counts per translation
                               file and string reference counts per source code file.
                             - 2 prints what level 1 does plus every visited directory,
                               inspected file, and referenced string.`);
  process.exit(1);
}

// process resource files
for (const resourcePath of options.resourcePaths) {
  log('');

  const baseLanguage = await findBaseLanguage(resourcePath);
  if (!baseLanguage) {
    log(`\n🛑  No directory or ${options.resourceExtensions.join(', ')} file named after base language tag `
      + `'${options.baseLanguageTag}' was found in ${options.resourcePaths}.`, 'error');
    process.exit(1);
  }

  log('');
  (await processResourceFiles(baseLanguage.directoryEntry.path, {baseLanguage, resources}))
    .forEach(({languageTag, filePath}) =>
      (resourceFilesByLanguageTag.get(languageTag) ?? resourceFilesByLanguageTag.set(languageTag, []).get(languageTag)!)
        .push(filePath));
}

// process source code files
const sourceCodeFilesWithResourceReferences = new Array<string>();
for (const sourceCodePath of options.sourceCodePaths) {
  log('');

  const result = await processSourceCodeFiles(sourceCodePath, {problems: sourceCodeProblems, resources});
  if (!result.files.length) {
    log(`\n🛑  No ${options.sourceCodeExtensions.join(', ')} source code files with string references were found in ${
      sourceCodePath}.`, 'error');
    process.exit(1);
  }

  sourceCodeFilesWithResourceReferences.push(...result.files);
}
const haveBlockingSourceCodeProblems = sourceCodeProblems.reduce((count, problem) =>
  (count += +problem.precludesStaticAnalysis), 0);

// analyze resources
const isInOptionalResourcePath = (resource: Resource) => optionalResourcePaths
  .some((optionalResourcePath) => resource.definitions.values().next().value.startsWith(optionalResourcePath));
const definedResources = new Array<Resource>();
const orphanedResources = new Array<Resource>();
const untranslatedResources = new Array<{missingLanguageTags: Array<string>, resource: Resource}>();
for (const resource of resources.values()) {
  if (resource.definitions.size) definedResources.push(resource);
  // check for orphaned strings
  if (options.checkForOrphanedStrings && !haveBlockingSourceCodeProblems
    && !resource.isIgnored && !resource.references.length && !isInOptionalResourcePath(resource)) {
    orphanedResources.push(resource);
  }
  // check for untranslated strings
  if (options.checkForUntranslatedStrings) {
    if (resource.translations.size && resource.translations.size < resourceFilesByLanguageTag.size) {
      const missingLanguageTags = new Array<string>();
      for (const languageTag of resourceFilesByLanguageTag.keys()) {
        if (!resource.translations.has(languageTag)) missingLanguageTags.push(languageTag);
      }
      untranslatedResources.push({missingLanguageTags, resource});
    }
  }
}

// print summary
console.log(`\n🌐  Inspected ${formatCount(definedResources.length, 'string')}, `
  + `translations in ${formatCount(resourceFilesByLanguageTag.size, 'language')}, and `
  + `references in ${formatCount(sourceCodeFilesWithResourceReferences.length, 'source code file')}.`);

// print resource problems
if (untranslatedResources.length) {
  log('\nUntranslated strings:', 'error');
  untranslatedResources.forEach(({missingLanguageTags, resource}) =>
    log(`\t🟡 '${resource.key}' (${missingLanguageTags.join(', ')})`, 'error'));
}
if (orphanedResources.length || (options.checkForOrphanedStrings && haveBlockingSourceCodeProblems)) {
  log('\nOrphaned strings:', 'error');
  if (haveBlockingSourceCodeProblems) {
    log('\t⚠️  String references cannot be analyzed until ⛔-marked source code problems are resolved.', 'error');
  } else if (orphanedResources.length) {
    orphanedResources.forEach((resource) => log(`\t🟠 '${resource.key}'`, 'error'));
  }
}

// print source code problems
if (sourceCodeProblems.length) {
  log(`\nSource code problems:\n${sourceCodeProblems.map((problem) =>
    `\t${problem.precludesStaticAnalysis ? '⛔' : '🔴'} ${problem.description}`).join('\n')}`, 'error');
}

// exit with an error code in the presence of orphaned strings or source code problems
if (orphanedResources.length || sourceCodeProblems.length) process.exit(1);

export {options};
