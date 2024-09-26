import {visit} from 'jsonc-parser';

import Resource from '../models/Resource.ts';
import {type Context, IGNORE_DIRECTIVE_PATTERN, type Parser, RESOURCE_KEY_REGEXP} from '../utils/resources.ts';

const parse: Parser = (buffer: Buffer, context: Context) => {
  /** Contents of the JSONC file. */
  const content = buffer.toString();
  /** Current object nesting depth. */
  let depth = 0;
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

  visit(content, {
    onComment(offset, length, startLine, startCharacter) {
      if (depth >= ignoreDepth) return; // if we're already within an ignored object, bail

      const match = new RegExp(`[*/]\\s*${IGNORE_DIRECTIVE_PATTERN}(\\*|\\s|$)`)
        .exec(content.substring(offset, offset + length)); // includes delimiters and leading/trailing whitespace
      if (match?.groups?.marker == 'begin') {
        ignoreUntilEndDirective = true;
      } else if (match?.groups?.marker == 'end') {
        ignoreUntilEndDirective = false;
      } else if (match) {
        ignoreLineNumber = startLine;
        // if an object's opening brace was previously found on this line, ignore everything within
        if (startLine == objectStartLineNumber) {
          ignoreDepth = depth;
        // if a resource was previously found on this line, mark it as ignored
        } else {
          const resource = resources[resources.length - 1];
          if (resource?.definitions.get(context.languageTag)?.endsWith(`:${startLine + 1}`)) {
            resource.isIgnored = true;
          }
        }
      }
    },

    onLiteralValue(value, offset, length, startLine, startCharacter, pathSupplier) {
      const path = pathSupplier();

      const lastSegment = path[path.length - 1];
      if (typeof lastSegment == 'string') {
        const match = RESOURCE_KEY_REGEXP.exec(lastSegment);
        if (match?.groups?.baseKey) path.splice(-1, 1, match.groups.baseKey);
      }
      const resourceKey = path.join('.');

      const resource = context.resources.get(resourceKey)
        ?? context.resources.set(resourceKey, new Resource(resourceKey)).get(resourceKey)!;
      resource.definitions.set(context.languageTag, `${context.filePath}:${startLine + 1}`);
      // eslint-disable-next-line logical-assignment-operators
      resource.isIgnored = resource.isIgnored // once `true`, always `true` for all languages and variations
        || depth >= ignoreDepth // within an ignored object
        || startLine == ignoreLineNumber // following an `ignore` line directive
        || ignoreUntilEndDirective; // between `ignore-begin` and `ignore-end` block directives
      resource.translations.set(context.languageTag, `${value}`);
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

  return resources;
};

export default parse;
