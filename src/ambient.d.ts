declare global {
  declare module 'ast-types' {
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
}
