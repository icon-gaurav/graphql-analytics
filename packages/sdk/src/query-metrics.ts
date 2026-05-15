import type {
  DocumentNode,
  FragmentDefinitionNode,
  OperationDefinitionNode,
  SelectionSetNode,
} from 'graphql';

export interface QueryMetrics {
  queryDepth: number;
  fieldCount: number;
  complexityScore: number;
}

const DEFAULT_QUERY_METRICS: QueryMetrics = {
  queryDepth: 0,
  fieldCount: 0,
  complexityScore: 0,
};

export function collectQueryMetrics(
  document: DocumentNode | null | undefined,
  operationName?: string | null
): QueryMetrics {
  if (!document) {
    return DEFAULT_QUERY_METRICS;
  }

  const operation = pickOperation(document, operationName);
  if (!operation?.selectionSet) {
    return DEFAULT_QUERY_METRICS;
  }

  const fragments = new Map<string, FragmentDefinitionNode>();
  for (const definition of document.definitions) {
    if (definition.kind === 'FragmentDefinition') {
      fragments.set(definition.name.value, definition);
    }
  }

  let fieldCount = 0;
  let queryDepth = 0;
  const visitedFragments = new Set<string>();

  const visitSelectionSet = (selectionSet: SelectionSetNode, depth: number): void => {
    for (const selection of selectionSet.selections) {
      switch (selection.kind) {
        case 'Field': {
          if (!selection.name.value.startsWith('__')) {
            fieldCount += 1;
            queryDepth = Math.max(queryDepth, depth);
          }

          if (selection.selectionSet) {
            visitSelectionSet(selection.selectionSet, depth + 1);
          }
          break;
        }
        case 'InlineFragment': {
          visitSelectionSet(selection.selectionSet, depth);
          break;
        }
        case 'FragmentSpread': {
          const fragmentName = selection.name.value;
          if (visitedFragments.has(fragmentName)) {
            break;
          }
          visitedFragments.add(fragmentName);
          const fragment = fragments.get(fragmentName);
          if (fragment) {
            visitSelectionSet(fragment.selectionSet, depth);
          }
          visitedFragments.delete(fragmentName);
          break;
        }
      }
    }
  };

  visitSelectionSet(operation.selectionSet, 1);

  return {
    queryDepth,
    fieldCount,
    complexityScore: fieldCount + queryDepth * 2,
  };
}

function pickOperation(
  document: DocumentNode,
  operationName?: string | null
): OperationDefinitionNode | undefined {
  const operations = document.definitions.filter(
    (definition): definition is OperationDefinitionNode => definition.kind === 'OperationDefinition'
  );

  if (!operations.length) {
    return undefined;
  }

  if (!operationName) {
    return operations[0];
  }

  return operations.find((operation) => operation.name?.value === operationName) ?? operations[0];
}

