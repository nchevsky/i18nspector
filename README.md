# Overview

`i18nspector` checks [`i18next`](https://www.i18next.com/) translations and application source code for:

- broken references to unknown or missing strings,
- orphaned, unreferenced strings that are safe to remove, and
- strings missing translations in one or more languages.

# Limitations

## Source code

TypeScript and JavaScript with JSX are supported.

## Localization libraries

[`i18next`](https://www.i18next.com/) and [`react-i18next`](https://react.i18next.com/) are supported with the following restrictions:

- No aliased `t()` functions
- No `Trans` components
- No dynamic expressions in key references
- No multiple namespaces
- No key prefixes

```js
import {i18n} from 'i18next';
import {useTranslation} from 'react-i18next';

// i18next configuration
i18n.init();               // ✔️ default namespace
i18n.init({ns: ['foo']});  // ✔️ single custom namespace
i18n.init({
  ns: ['foo', 'bar']       // ❌ multiple namespaces
});

// react-i18next configuration
const {t} = useTranslation();                  // ✔️ plain `t()` function
const {t: aliasedT} = useTranslation();        // ❌ aliased `t()` function
const {t: namespacedT} = useTranslation('ns'); // ❌ namespace-scoped `t()` function
const {t: prefixedT} = useTranslation(
  '', {keyPrefix: 'foo'}                       // ❌ prefix-scoped `t()` function
);

// `t()` function calls
i18n.t('foo');             // ✔️ `i18n` instance `t()` function
t('foo');                  // ✔️ `useTranslation()` hook `t()` function
t('foo', {ns: 'bar'});     // ❌ namespace-scoped call

// key references
t('foo');                  // ✔️ literal key
t(a ? 'foo' : 'bar');      // ✔️ ternary expression with two literal members
t(`foo.${a ? 'b' : 'c'}`); // ✔️ template string with members of supported types
t('foo.' + 'bar');         // ❌ concatenated key
t('ns:foo');               // ❌ namespace-scoped key
t('FOO'.toLowerCase());    // ❌ dynamic expression
```
## Translations

JSON, JSONC, and `.properties` resource files are supported when organized in either of the following ways.

- Files with names ending in IETF language tags, located in a directory with any name:
  ```
  📂 foo
     📄 en.jsonc
     📄 es.properties
     📄 fr.json
     …
  ```
- Files with any name located in directories with names ending in IETF language tags:
  ```
  📂 en
     📄 foo.jsonc
  📂 es
     📄 bar.properties
  📂 fr
     📄 baz.json
  …
  ```

# Usage

```
$ npx i18nspector --resourcePaths=<path>,… [--resourceExtensions=<extension>,…]
                  --sourceCodePaths=<path>,… [--sourceCodeExtensions=<extension>,…]
                  [--reportOrphanedStrings=<no|yes>] [--reportUntranslatedStrings=<no|yes>]
                  [--baseLanguage=<language-tag>] [--verbose=<0|1|2>]

            --resourcePaths: Comma-separated list of paths to recursively scan for translations.
       --resourceExtensions: Comma-separated list of translation file name extensions to process.
                             Defaults to '.json,.jsonc,.properties'.

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
                               inspected file, and referenced string.
```

# Examples

📍 `./examples/translations/en.jsonc`
```jsonc
{
  "bar": "Bar",
  "foo": "Foo",
  /* i18nspector-ignore-begin */
  "ignoredBlockLine1": "ignored",
  "ignoredBlockLine2": "ignored",
  /* i18nspector-ignore-end */
  "ignoredLine": "ignored", // i18nspector-ignore
  "ignoredObject": { // i18nspector-ignore
    "bar": "ignored",
    "foo": {
      "qux": "ignored"
    }
  }
}
```

💡 Strings tagged with `i18nspector-ignore` directives are exempt from reference checking and won't be reported as orphaned when no references to them can be found in source code.

📍 `./examples/translations/ko.properties`
```properties
bar=바
foo=푸
# i18nspector-ignore-begin
ignored-block-line-1=ignored
ignored-block-line-2=ignored
# i18nspector-ignore-end
```

💡 Properties files only support block—not line—ignore directives.

## Untranslated, orphaned, and unknown strings

📍 `./examples/src/bad-strings/index.js`
```js
t('baz');
t('foo');
t('ignored' /* i18nspector-ignore */);
```

💡 String references tagged with `i18nspector-ignore` directives are exempt from reference checking and won't be reported as unknown when not found in resource files.

```
$ npx i18nspector --resourcePaths=./examples/translations \
                  --sourceCodePaths=./examples/src/bad-strings --verbose=2

📂  Searching for base language ('en') in ./examples/translations
        ✔️  Found 'en' base language at ./examples/translations/en.jsonc.

📂  Searching for .json, .jsonc resources in ./examples/translations
        🔍  Parsing resource file ./examples/translations/en.jsonc
                🌐  7 'en' translations
        🔍  Parsing resource file ./examples/translations/ko.json
                🌐  1 'ko' translation

📂  Searching for .js, .jsx, .ts, .tsx source code in ./examples/src/bad-strings
        🔍  Parsing source code file ./examples/src/bad-strings/index.js
                ❌ Reference to unknown string 'baz' at ./examples/src/bad-strings/index.js:1
                🔗 Reference to known string 'foo' at ./examples/src/bad-strings/index.js:2

🌐  Inspected 7 strings, translations in 2 languages, and references in 1 source code file.

Untranslated strings:
        🟡 'ignoredBlockLine1' (ko)
        🟡 'ignoredBlockLine2' (ko)
        🟡 'ignoredLine' (ko)
        🟡 'ignoredObject.bar' (ko)
        🟡 'ignoredObject.foo.qux' (ko)

Orphaned strings:
        🟠 'bar'

Source code problems:
        🔴 Reference to unknown string 'baz' at ./examples/src/bad-strings/index.js:1
```

## Unsupported dynamic expressions

📍 `./examples/src/dynamic-expressions/index.js`
```js
const key = 'foo';

t('foo' + 'bar');
t('ignored'.toUpperCase()); // i18nspector-ignore
t(key);
```

💡 `t()` calls tagged with `i18nspector-ignore` directives are exempt from analysis and won't be reported as unsupported if they contain dynamic expressions.

```
$ npx i18nspector --resourcePaths=./examples/translations \
                  --sourceCodePaths=./examples/src/dynamic-expressions --verbose=1

✔️  Found 'en' base language at ./examples/translations/en.jsonc.

🌐  Found 7 'en' translations in ./examples/translations/en.jsonc.
🌐  Found 1 'ko' translation in ./examples/translations/ko.json.

🌐  Inspected 7 strings, translations in 2 languages, and references in 1 source code file.

Untranslated strings:
        🟡 'ignoredBlockLine1' (ko)
        🟡 'ignoredBlockLine2' (ko)
        🟡 'ignoredLine' (ko)
        🟡 'ignoredObject.bar' (ko)
        🟡 'ignoredObject.foo.qux' (ko)

Orphaned strings:
        ⚠️  String references cannot be analyzed until ⛔-marked source code problems are resolved.

Source code problems:
        ⛔ Non-literal of type `BinaryExpression` at ./examples/src/dynamic-expressions/index.js:3
        ⛔ Non-literal of type `Identifier` at ./examples/src/dynamic-expressions/index.js:4
```
