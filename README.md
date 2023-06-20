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
- No key prefixes or multiple namespaces

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

JSON resource files are supported when organized in either of the following ways.

- Files with names ending in IETF language tags, located in a directory with any name:
  ```
  📂 foo
     📄 en.json
     📄 fr.json
     …
  ```
- Files with any name located in directories with names ending in IETF language tags:
  ```
  📂 en
     📄 foo.json
  📂 fr
     📄 bar.json
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
                             Defaults to '.json'.

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

📍 `./examples/translations/en.json`
```json
{
  "bar": "Bar",
  "foo": "Foo"
}
```

📍 `./examples/translations/ko.json`
```json
{
  "bar": "바"
}
```

## Example # 1: Bad strings

📍 `./examples/src/bad-strings/index.js`
```js
t('foo');
t('unknown');
```

```
$ npx i18nspector --resourcePaths=./examples/translations \
                  --sourceCodePaths=./examples/src/bad-strings

🌐 Inspected 2 strings, translations in 2 languages, and references in 1 source code file.

Untranslated strings:
        🟡 'foo' (ko)

Orphaned strings:
        🟠 'bar'

Source code problems:
        🔴 Reference to unknown string 'unknown' at examples/src/bad-strings/index.js:2
```

## Example # 2: Unsupported dynamic expression

📍 `./examples/src/dynamic-expression/index.js`
```js
const key = 'foo';

t(key);
```

```
$ npx i18nspector --resourcePaths=./examples/translations \
                  --sourceCodePaths=./examples/src/dynamic-expression

🌐 Inspected 2 strings, translations in 2 languages, and references in 1 source code file.

Untranslated strings:
        🟡 'foo' (ko)

Orphaned strings:
        ⚠️ String references cannot be analyzed until ⛔-marked source code problems are resolved.

Source code problems:
        ⛔ Non-literal of type `CallExpression` at examples/src/dynamic-expression/index.js:3
```
