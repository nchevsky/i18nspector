import {Properties} from 'properties-file';

import Resource from '../models/Resource.ts';
import {type Context, IGNORE_DIRECTIVE_PATTERN, type Parser, RESOURCE_KEY_REGEXP} from '../utils/resources.ts';

const parse: Parser = (buffer: Buffer, context: Context) => {
  const ignoredLineRanges: Array<[number, number]> = [];
  const properties = new Properties(buffer);
  const resources = new Array<Resource>();

  // @ts-expect-error -- `lines` is protected 🤠
  properties.lines.forEach((line, index) => {
    // if this line isn't among those that have been parsed, assume it's a comment
    if (!Object.entries(properties.keyLineNumbers).some(([key, lines]) => lines.some((line) => line == index + 1))) {
      const match = new RegExp(`^[!#]\\s*${IGNORE_DIRECTIVE_PATTERN}(\\s|$)`).exec(line);
      switch (match?.groups?.marker) {
        case 'begin':
          ignoredLineRanges.push([index + 2, Number.POSITIVE_INFINITY]);
          break;
        case 'end':
          if (ignoredLineRanges[ignoredLineRanges.length - 1]?.[1] == Number.POSITIVE_INFINITY) {
            ignoredLineRanges[ignoredLineRanges.length - 1]![1] = index;
          }
          break;
        default: // not a valid ignore directive
      }
    }
  });

  properties.collection.forEach((value, index, array) => {
    const key = RESOURCE_KEY_REGEXP.exec(value.key)?.groups?.baseKey ?? value.key;
    const resource = context.resources.get(key) ?? context.resources.set(key, new Resource(key)).get(key)!;

    resource.definitions.set(context.languageTag, `${context.filePath}:${value.startingLineNumber}`);
    resource.isIgnored = ignoredLineRanges.some(([beginning, end]) => value.startingLineNumber >= beginning
      && value.startingLineNumber <= end);
    resource.translations.set(context.languageTag, value.value);
    resources.push(resource);
  });

  return resources;
};

export default parse;
