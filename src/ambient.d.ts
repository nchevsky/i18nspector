export declare module 'ast-types' { // eslint-disable-line import/prefer-default-export
  namespace namedTypes {
    interface Node {
      end: namedTypes.Position['index'];
      start: namedTypes.Position['index'];
    }

    interface Position {
      index: number;
    }

    interface SourceLocation {
      lines?: import('recast/lib/lines.js').Lines
    }
  }
}
