import {readFile} from 'node:fs/promises';

import {builders, type namedTypes as ASTTypes, visit} from 'ast-types';
import type * as ASTKinds from 'ast-types/lib/gen/kinds'; // eslint-disable-line import/no-namespace
import {parse} from 'recast';
import parser from 'recast/parsers/babel-ts.js';

import {directoryEntries, formatCount, log, nameMatchesExtensions, permutate, pluralize} from './misc.js';
import {options} from '../index.js';
import Resource from '../models/Resource.js';

async function parseSourceCodeFile(filePath: string, context: {resources: Map<string, Resource>}) {
  const problems = new Array<{description: string, precludesStaticAnalysis: boolean}>();
  const referencedResources = new Set<Resource>();

  function addProblem(description: string, isFatal: boolean) {
    log(`\t\t❌ ${description}`, 'debug');
    problems.push({description, precludesStaticAnalysis: isFatal});
  }

  function formatLocation(node: ASTTypes.Node) {
    return `${filePath}:${node.loc?.start.line ?? '?'}`;
  }

  function processNode(node: ASTTypes.Node) {
    const nonLiteralExpressions = new Array<ASTTypes.Node>();
    const stringLiterals = new Array<ASTTypes.StringLiteral>();

    switch (node.type) {
      case 'ConditionalExpression': { // (test ? 'consequent' : 'alternate') → ['consequent', 'alternate']
        const conditionalExpression = node as ASTTypes.ConditionalExpression;
        const alternateNodes = processNode(conditionalExpression.alternate);
        const consequentNodes = processNode(conditionalExpression.consequent);

        nonLiteralExpressions.push(...alternateNodes.nonLiteralExpressions, ...consequentNodes.nonLiteralExpressions);
        stringLiterals.push(...alternateNodes.stringLiterals, ...consequentNodes.stringLiterals);
        break;
      }

      case 'StringLiteral': { // 'foo' → ['foo']
        stringLiterals.push(node as ASTTypes.StringLiteral);
        break;
      }

      // `${e1} ql ${e2}` → ['e1v1 ql e2v1', 'e1v1 ql e2v2', 'e1v2 ql e2v1', 'e1v2 ql e2v2']
      //    │        └ (test ? 'e2v1': 'e2v2')
      //    └ (test ? 'e1v1': 'e1v2')
      case 'TemplateLiteral': {
        const templateLiteral = node as ASTTypes.TemplateLiteral;
        // [e1, e2] → [['e1v1', 'e1v2'], ['e2v1', 'e2v2']]
        const expressionsAndLiterals = templateLiteral.expressions.map((expression: ASTTypes.Node) => {
          const results = processNode(expression);
          nonLiteralExpressions.push(...results.nonLiteralExpressions);
          return results.stringLiterals;
        });
        stringLiterals.push(
          // [['e1v1', 'e1v2'], ['e2v1', 'e2v2']]
          //   → [['e1v1', 'e2v1'], ['e1v1', 'e2v2'], ['e1v2', 'e2v1'], ['e1v2', 'e2v2']]
          ...permutate(expressionsAndLiterals)
            // [['e1v1', 'e2v1'], ['e1v1', 'e2v2'], ['e1v2', 'e2v1'], ['e1v2', 'e2v2']]
            //   → ['e1v1 ql e2v1', 'e1v1 ql e2v2', 'e1v2 ql e2v1', 'e1v2 ql e2v2']
            .map((expressionLiteralPermutation /* ['e1v𝑥', 'e2v𝑦'] */) => {
              // ['e1v𝑥', 'e2v𝑦'] + ['ql] → ['e1v𝑥', 'ql', 'e2v𝑦']
              const literals = [...expressionLiteralPermutation, ...templateLiteral.quasis].sort((a, b) =>
                a.loc!.start.index - b.loc!.start.index);
              // ['e1v𝑥', 'ql', 'e2v𝑦'] → 'e1v𝑥 ql e2v𝑦'
              return literals.reduce<ASTTypes.StringLiteral>((stringLiteral, node) => {
                stringLiteral.value += typeof node.value == 'string' ? node.value : node.value.raw;
                return stringLiteral;
              }, builders.stringLiteral.from({
                loc: {end: templateLiteral.loc!.end, start: templateLiteral.loc!.start}, value: ''
              }));
            })
        );
        break;
      }

      default:
        nonLiteralExpressions.push(node);
    }

    return {nonLiteralExpressions, stringLiterals};
  }

  log(`\t🔍  Parsing source code file ${filePath}`, 'debug');

  visit(parse((await readFile(filePath)).toString(), {parser, sourceFileName: filePath}), {
    visitCallExpression(nodePath) {
      const call = nodePath.node;
      const callee = call.callee;

      const isIdentifier = (node: ASTTypes.Node): node is ASTTypes.Identifier => node.type == 'Identifier';
      const isMemberExpression = (node: ASTTypes.Node): node is ASTKinds.MemberExpressionKind =>
        node.type == 'MemberExpression';
      const isObjectExpression = (node: ASTTypes.Node): node is ASTTypes.ObjectExpression =>
        node.type == 'ObjectExpression';
      const isObjectProperty = (node: ASTTypes.Node): node is ASTTypes.ObjectProperty => node.type == 'ObjectProperty';
      const isStringLiteral = (node: ASTTypes.Node): node is ASTTypes.StringLiteral => node.type == 'StringLiteral';

      if ((isIdentifier(callee) && callee.name == 't') // t()
        || (isMemberExpression(callee) && isIdentifier(callee.property) && callee.property.name == 't')) { // foo.t()
        const {nonLiteralExpressions, stringLiterals} = processNode(call.arguments[0]);

        nonLiteralExpressions.forEach((node) =>
          addProblem(`Non-literal of type \`${node.type}\` at ${formatLocation(node)}`, true));

        stringLiterals.forEach((stringLiteral) => {
          const key = stringLiteral.value;
          let resource = context.resources.get(key);

          if (resource) {
            log(`\t\t🔗 Reference to known string '${key}' at ${formatLocation(stringLiteral)}`, 'debug');
          } else {
            addProblem(`Reference to unknown string '${key}' at ${formatLocation(stringLiteral)}`, false);
            resource = new Resource(key);
            context.resources.set(key, resource);
          }

          referencedResources.add(resource);
          resource.references.push(formatLocation(stringLiteral));
        });
      } else if (isIdentifier(callee) && callee.name == 'useTranslation' && call.arguments.length) { // useTranslation()
        const namespaceArgument = call.arguments[0];
        if (!isStringLiteral(namespaceArgument) || namespaceArgument.value) {
          addProblem(`Unsupported namespace at ${formatLocation(namespaceArgument)}`, true);
        }

        const optionsArgument = call.arguments[1];
        if (isObjectExpression(optionsArgument) && optionsArgument.properties.some((property) =>
          isObjectProperty(property) && isIdentifier(property.key) && property.key.name == 'keyPrefix')) {
          addProblem(`Unsupported key prefix at ${formatLocation(namespaceArgument)}`, true);
        }
      }

      this.traverse(nodePath);
    }
  });

  return {problems, referencedResources};
}

export async function processSourceCodeFiles( // eslint-disable-line import/prefer-default-export
  directoryPath: string,
  context: {problems: Awaited<ReturnType<typeof parseSourceCodeFile>>['problems'], resources: Map<string, Resource>}
) {
  const files = new Array<string>();
  const referencedResources = new Set<Resource>();

  function addReferencedResources(resources: typeof referencedResources) {
    resources.forEach((resource) => referencedResources.add(resource));
  }

  log(`📂  Searching for ${options.sourceCodeExtensions.join(', ')} source code in ${directoryPath}`, 'debug');

  for await (const directoryEntry of await directoryEntries(directoryPath)) {
    const path = `${directoryPath}/${directoryEntry.name}`;

    if (directoryEntry.isDirectory() && directoryEntry.name != 'node_modules') {
      const result = await processSourceCodeFiles(path, context);
      files.push(...result.files);
      addReferencedResources(result.referencedResources);
    } else if (directoryEntry.isFile() && nameMatchesExtensions(directoryEntry.name, options.sourceCodeExtensions)) {
      const {problems, referencedResources} = await parseSourceCodeFile(path, {resources: context.resources});

      if (problems.length || referencedResources.size) files.push(path);
      context.problems.push(...problems);
      addReferencedResources(referencedResources);

      if (referencedResources.size && options.verbose == 1) {
        log(`🔗  Found ${pluralize(referencedResources.size, 'reference')} to ${
          formatCount(referencedResources.size, 'string')} in ${path}.`);
      }
    }
  }

  return {files, referencedResources};
}
