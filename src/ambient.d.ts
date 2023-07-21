export declare module 'ast-types' { // eslint-disable-line import/prefer-default-export
  namespace namedTypes {
    interface Node {
      end: namedTypes.Position['index'];
      leadingComments?: Array<import('ast-types/lib/gen/kinds').CommentKind>;
      start: namedTypes.Position['index'];
      trailingComments?: Array<import('ast-types/lib/gen/kinds').CommentKind>;
    }

    interface Position {
      index: number;
    }

    interface SourceLocation {
      lines?: import('recast/lib/lines.js').Lines
    }
  }
}
