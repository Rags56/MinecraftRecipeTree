import {slotSummary} from '../data/slotSummary.ts';
import type {ByproductAllocation, ItemTreeNode} from './model.ts';
import type {DeferredRecipeSourceResolver} from './expansionOwnership.ts';

export interface TreeTotal {
  key: string;
  amount: number | null;
  variants: number;
  tag?: string;
}

export interface TreeTotals {
  inputs: TreeTotal[];
  prerequisites: TreeTotal[];
  byproductCredits: TreeTotal[];
  byproducts: TreeTotal[];
}

export interface NodeByproductCoverage {
  nodeId: string;
  key: string;
  requiredAmount: number;
  creditedAmount: number;
  remainingAmount: number;
  allocations: ByproductAllocation[];
}

export interface TreeCalculation extends TreeTotals {
  requiredByNode: Map<string, number | null>;
  byproductCoverageByNode: Map<string, NodeByproductCoverage>;
}

export interface TreeTotalsOptions {
  resolveDeferredRecipeSource?: DeferredRecipeSourceResolver;
}

const warnedMissingTreeYields = new Set<string>();
const warnedStochasticTreeYields = new Set<string>();
const warnedUnknownByproductBalances = new Set<string>();
const warnedStochasticByproducts = new Set<string>();
const warnedStochasticInputConsumption = new Set<string>();

interface TreeTotalIdentitySource {
  key: string;
  tag?: string;
  variants?: number;
  variantCount?: number;
  alternatives?: string[];
}

function ingredientVariantCount(total: TreeTotalIdentitySource): number {
  return total.variants ?? total.variantCount ?? total.alternatives?.length ?? 1;
}

export function treeTotalIdentity(total: TreeTotalIdentitySource): string {
  const variants = ingredientVariantCount(total);
  return total.tag && variants > 1 ? `#${total.tag}` : total.key;
}

function addTotal(
  target: Map<string, TreeTotal>,
  key: string,
  amount: number | null,
  variants = 1,
  tag?: string,
  aggregate: 'sum' | 'max' = 'sum',
) {
  const logicalKey = treeTotalIdentity({key, tag, variants});
  const current = target.get(logicalKey) ?? {
    key,
    amount: amount == null ? null : 0,
    variants: 1,
    tag,
  };
  if (current.amount != null) {
    current.amount =
      amount == null
        ? null
        : aggregate === 'max'
          ? Math.max(current.amount, amount)
          : current.amount + amount;
  }
  current.variants = Math.max(current.variants, variants);
  target.set(logicalKey, current);
}

interface InputBalance {
  nodeId: string;
  key: string;
  tag?: string;
  alternatives?: string[];
  variants: number;
  requiredAmount: number;
  remainingAmount: number;
}

interface ProducerBalance {
  sourceId: string;
  ingredient: TreeTotalIdentitySource;
  totalIdentity: string;
  remainingAmount: number | null;
}

interface CommittedCredit {
  node: ItemTreeNode;
  requiredAmount: number;
  intendedAmount: number;
  allocations: ByproductAllocation[];
}

function subtractTotal(
  target: Map<string, TreeTotal>,
  logicalKey: string,
  amount: number,
): void {
  const total = target.get(logicalKey);
  if (!total || total.amount == null || total.amount < amount) {
    throw new Error(
      `Material balance for ${logicalKey} cannot subtract ${amount} from ${String(total?.amount)}.`,
    );
  }
  total.amount -= amount;
}

function consumeProducerBalance(
  producers: ProducerBalance[],
  ingredient: TreeTotalIdentitySource,
  requestedAmount: number,
  preferredSourceId?: string,
): {
  consumed: number;
  allocations: ByproductAllocation[];
  consumedByTotal: Map<string, number>;
} {
  let remaining = requestedAmount;
  const allocations: ByproductAllocation[] = [];
  const consumedByTotal = new Map<string, number>();
  const compatible = producers.filter(producer =>
    producerMatchesIngredient(producer.ingredient, ingredient),
  );
  if (compatible.some(producer => producer.remainingAmount == null)) {
    return {consumed: 0, allocations, consumedByTotal};
  }
  const ordered = preferredSourceId
    ? [
        ...compatible.filter(producer => producer.sourceId === preferredSourceId),
        ...compatible.filter(producer => producer.sourceId !== preferredSourceId),
      ]
    : compatible;

  for (const producer of ordered) {
    if (remaining <= 0 || producer.remainingAmount == null || producer.remainingAmount <= 0) {
      continue;
    }
    const consumed = Math.min(remaining, producer.remainingAmount);
    producer.remainingAmount -= consumed;
    remaining -= consumed;
    allocations.push({producerSourceId: producer.sourceId, amount: consumed});
    consumedByTotal.set(
      producer.totalIdentity,
      (consumedByTotal.get(producer.totalIdentity) ?? 0) + consumed,
    );
  }
  return {
    consumed: requestedAmount - remaining,
    allocations,
    consumedByTotal,
  };
}

function producerMatchesIngredient(
  producer: TreeTotalIdentitySource,
  requested: TreeTotalIdentitySource,
): boolean {
  const requestedVariants = ingredientVariantCount(requested);
  if (requested.tag && requestedVariants > 1) {
    return (
      producer.tag === requested.tag ||
      requested.alternatives?.includes(producer.key) === true
    );
  }
  return producer.key === requested.key;
}

function subtractConsumedProducerTotals(
  byproducts: Map<string, TreeTotal>,
  consumedByTotal: Map<string, number>,
): void {
  for (const [logicalKey, amount] of consumedByTotal) {
    subtractTotal(byproducts, logicalKey, amount);
  }
}

function mergeCoverage(
  target: Map<string, NodeByproductCoverage>,
  balance: {
    nodeId: string;
    key: string;
    requiredAmount: number;
    creditedAmount: number;
    allocations: ByproductAllocation[];
  },
): void {
  const current = target.get(balance.nodeId);
  const creditedAmount = (current?.creditedAmount ?? 0) + balance.creditedAmount;
  target.set(balance.nodeId, {
    nodeId: balance.nodeId,
    key: balance.key,
    requiredAmount: current?.requiredAmount ?? balance.requiredAmount,
    creditedAmount,
    remainingAmount: Math.max(
      0,
      (current?.requiredAmount ?? balance.requiredAmount) - creditedAmount,
    ),
    allocations: [...(current?.allocations ?? []), ...balance.allocations],
  });
}

function applyByproductCredits(
  inputs: Map<string, TreeTotal>,
  byproducts: Map<string, TreeTotal>,
  inputBalances: InputBalance[],
  producerBalances: ProducerBalance[],
  committedCredits: CommittedCredit[],
): {
  credits: Map<string, TreeTotal>;
  coverageByNode: Map<string, NodeByproductCoverage>;
} {
  const credits = new Map<string, TreeTotal>();
  const coverageByNode = new Map<string, NodeByproductCoverage>();

  for (const commitment of committedCredits) {
    const logicalKey = treeTotalIdentity(commitment.node);
    let consumed = 0;
    const allocations: ByproductAllocation[] = [];
    for (const intendedAllocation of commitment.allocations) {
      const result = consumeProducerBalance(
        producerBalances,
        commitment.node,
        intendedAllocation.amount,
        intendedAllocation.producerSourceId,
      );
      consumed += result.consumed;
      allocations.push(...result.allocations);
      subtractConsumedProducerTotals(byproducts, result.consumedByTotal);
    }
    const unallocated = commitment.intendedAmount - consumed;
    if (unallocated > 0) {
      const result = consumeProducerBalance(
        producerBalances,
        commitment.node,
        unallocated,
      );
      consumed += result.consumed;
      allocations.push(...result.allocations);
      subtractConsumedProducerTotals(byproducts, result.consumedByTotal);
    }

    if (consumed > 0) {
      addTotal(
        credits,
        commitment.node.key,
        consumed,
        commitment.node.variantCount ?? 1,
        commitment.node.tag,
      );
      mergeCoverage(coverageByNode, {
        nodeId: commitment.node.id,
        key: commitment.node.key,
        requiredAmount: commitment.requiredAmount,
        creditedAmount: consumed,
        allocations,
      });
    }

    const missing = commitment.intendedAmount - consumed;
    if (missing > 0) {
      console.error(
        'A committed byproduct fulfillment lost some of its producing output; the missing amount was restored as an external input.',
        {
          nodeId: commitment.node.id,
          logicalIngredient: logicalKey,
          committedAmount: commitment.intendedAmount,
          availableAmount: consumed,
        },
      );
      addTotal(
        inputs,
        commitment.node.key,
        missing,
        commitment.node.variantCount ?? 1,
        commitment.node.tag,
      );
      inputBalances.push({
        nodeId: commitment.node.id,
        key: commitment.node.key,
        tag: commitment.node.tag,
        alternatives: commitment.node.alternatives,
        variants: commitment.node.variantCount ?? 1,
        requiredAmount: missing,
        remainingAmount: missing,
      });
    }
  }

  for (const inputBalance of inputBalances) {
    const logicalKey = treeTotalIdentity(inputBalance);
    const input = inputs.get(logicalKey);
    const compatibleProducers = producerBalances.filter(producer =>
      producerMatchesIngredient(producer.ingredient, inputBalance),
    );
    if (compatibleProducers.length === 0) continue;
    if (
      input?.amount == null ||
      compatibleProducers.some(producer => producer.remainingAmount == null)
    ) {
      if (!warnedUnknownByproductBalances.has(logicalKey)) {
        warnedUnknownByproductBalances.add(logicalKey);
        console.warn('Byproduct credit was not applied because its material balance is unknown.', {
          logicalIngredient: logicalKey,
          inputAmount: input?.amount,
          byproductAmounts: compatibleProducers.map(producer => producer.remainingAmount),
        });
      }
      continue;
    }
    const availableAmount = compatibleProducers.reduce(
      (sum, producer) => sum + (producer.remainingAmount ?? 0),
      0,
    );
    const creditedAmount = Math.min(inputBalance.remainingAmount, availableAmount);
    if (creditedAmount <= 0) continue;
    const result = consumeProducerBalance(
      producerBalances,
      inputBalance,
      creditedAmount,
    );
    if (result.consumed !== creditedAmount) {
      throw new Error(
        `Byproduct producers for ${logicalKey} exposed ${result.consumed}; expected ${creditedAmount}.`,
      );
    }
    subtractTotal(inputs, logicalKey, creditedAmount);
    subtractConsumedProducerTotals(byproducts, result.consumedByTotal);
    inputBalance.remainingAmount -= creditedAmount;
    addTotal(
      credits,
      inputBalance.key,
      creditedAmount,
      Math.max(
        inputBalance.variants,
        ...compatibleProducers.map(producer =>
          ingredientVariantCount(producer.ingredient),
        ),
      ),
      inputBalance.tag,
    );
    mergeCoverage(coverageByNode, {
      nodeId: inputBalance.nodeId,
      key: inputBalance.key,
      requiredAmount: inputBalance.requiredAmount,
      creditedAmount,
      allocations: result.allocations,
    });
  }
  return {credits, coverageByNode};
}

function effectiveNodeRequirement(
  node: ItemTreeNode,
  required: number | null,
): number | null {
  if (
    !node.nonConsumed ||
    node.retentionMode === 'durability' ||
    !node.key.startsWith('item|')
  ) {
    return required;
  }
  return required === 0 ? 0 : 1;
}

/**
 * Calculate the graph's material balance.
 *
 * Consumed leaf inputs are summed. Retained item prerequisites are normalized
 * to one reusable item per logical ingredient, while other retained resources
 * use their maximum simultaneous requirement. Optional byproduct credits reduce
 * only consumed inputs with the same exact logical ingredient identity.
 */
export function calculateTreeTotals(
  root: ItemTreeNode,
  useByproducts = false,
  options: TreeTotalsOptions = {},
): TreeCalculation {
  const inputs = new Map<string, TreeTotal>();
  const prerequisites = new Map<string, TreeTotal>();
  const byproducts = new Map<string, TreeTotal>();
  const requiredByNode = new Map<string, number | null>();
  const inputBalances: InputBalance[] = [];
  const producerBalances: ProducerBalance[] = [];
  const committedCredits: CommittedCredit[] = [];

  type VisitFrame =
    | {
        phase: 'enter';
        node: ItemTreeNode;
        nodeId: string;
        required: number | null;
        grossRequired: number | null;
        virtual: boolean;
      }
    | {
        phase: 'exit';
        source: NonNullable<ItemTreeNode['source']>;
        sourceId: string;
        outputs: ReturnType<typeof slotSummary>;
        selectedOutput: ReturnType<typeof slotSummary>[number] | undefined;
        selectedRequired: number | null;
        runs: number | null;
      };
  const stack: VisitFrame[] = [
    {
      phase: 'enter',
      node: root,
      nodeId: root.id,
      required: root.productionPlan?.amount ?? (root.amount === undefined ? 1 : root.amount),
      grossRequired:
        root.productionPlan?.amount ?? (root.amount === undefined ? 1 : root.amount),
      virtual: false,
    },
  ];

  while (stack.length > 0) {
    const frame = stack.pop()!;
    if (frame.phase === 'exit') {
      for (const output of frame.outputs) {
        const selectedSurplus = output === frame.selectedOutput;
        const stochastic = output.probability !== undefined;
        if (stochastic && !selectedSurplus) {
          const warningKey =
            `${frame.source.ref?.[0] ?? 'unknown'}:` +
            `${frame.source.ref?.[1] ?? 'unknown'}:${output.key}`;
          if (!warnedStochasticByproducts.has(warningKey)) {
            warnedStochasticByproducts.add(warningKey);
            console.warn(
              'Stochastic byproduct credits are disabled because a guaranteed material balance cannot be derived.',
              {
                recipe: frame.source.ref,
                itemKey: output.key,
                probability: output.probability,
              },
            );
          }
        }
        const selectedConsumption = selectedSurplus ? frame.selectedRequired : 0;
        const amount =
          stochastic ||
          output.amount == null ||
          frame.runs == null ||
          selectedConsumption == null
            ? null
            : Math.max(
                0,
                output.amount * frame.runs - selectedConsumption,
              );
        if (selectedSurplus && (amount == null || amount <= 0)) continue;
        addTotal(
          byproducts,
          output.key,
          amount,
          output.variants,
          output.tag,
        );
        producerBalances.push({
          sourceId: frame.sourceId,
          ingredient: output,
          totalIdentity: treeTotalIdentity(output),
          remainingAmount: amount,
        });
      }
      continue;
    }

    const {node} = frame;
    const required = effectiveNodeRequirement(node, frame.required);
    const grossRequired = effectiveNodeRequirement(node, frame.grossRequired);
    if (!frame.virtual) requiredByNode.set(node.id, required);
    if (
      !frame.virtual &&
      useByproducts &&
      node.byproductFulfillment &&
      grossRequired != null &&
      node.byproductFulfillment.creditedAmount > 0
    ) {
      committedCredits.push({
        node,
        requiredAmount: grossRequired,
        intendedAmount: Math.min(
          grossRequired,
          node.byproductFulfillment.creditedAmount,
        ),
        allocations: node.byproductFulfillment.allocations,
      });
    }
    if (node.nonConsumed) {
      addTotal(
        prerequisites,
        node.key,
        required,
        node.variantCount ?? 1,
        node.tag,
        node.retentionMode === 'durability' ? 'sum' : 'max',
      );
    }

    const deferredSource =
      node.source || !node.deferredRecipeExpansion
        ? undefined
        : options.resolveDeferredRecipeSource?.(node);
    const source = node.source ?? deferredSource;
    if (!source || source.kind !== 'recipe' || !source.recipe || node.cyclic) {
      if (!node.nonConsumed) {
        addTotal(inputs, node.key, required, node.variantCount ?? 1, node.tag);
        if (required != null && required > 0) {
          inputBalances.push({
            nodeId: frame.nodeId,
            key: node.key,
            tag: node.tag,
            alternatives: node.alternatives,
            variants: node.variantCount ?? 1,
            requiredAmount: required,
            remainingAmount: required,
          });
        }
      }
      continue;
    }

    const outputs = slotSummary(source.recipe.out);
    const selectedOutput = outputs.find(
      output => output.key === node.key || output.alternatives.includes(node.key),
    );
    let outputYield: number | null;
    if (!selectedOutput) {
      const warningKey = `${source.ref?.[0] ?? 'unknown'}:${source.ref?.[1] ?? 'unknown'}:${node.key}`;
      if (!warnedMissingTreeYields.has(warningKey)) {
        warnedMissingTreeYields.add(warningKey);
        console.warn('Tree totals could not identify the selected item output; assuming a yield of one.', {
          recipe: source.ref,
          itemKey: node.key,
        });
      }
      outputYield = 1;
    } else if (selectedOutput.probability !== undefined) {
      const warningKey = `${source.ref?.[0] ?? 'unknown'}:${source.ref?.[1] ?? 'unknown'}:${node.key}`;
      if (!warnedStochasticTreeYields.has(warningKey)) {
        warnedStochasticTreeYields.add(warningKey);
        console.warn(
          'Tree totals cannot derive a guaranteed recipe count from a stochastic selected output; quantitative totals are intentionally unknown.',
          {
            recipe: source.ref,
            itemKey: node.key,
            probability: selectedOutput.probability,
          },
        );
      }
      outputYield = null;
    } else {
      outputYield = selectedOutput.amount;
    }

    // Every exported recipe represents a complete machine/crafting cycle.
    // Fluids and custom resources can have continuous quantities, but the
    // recipe that produces them cannot be run fractionally.
    const runs =
      required == null || outputYield == null
        ? null
        : Math.ceil(required / outputYield);

    const virtualChildren = frame.virtual || deferredSource !== undefined;
    stack.push({
      phase: 'exit',
      source,
      sourceId: virtualChildren ? `${frame.nodeId}.s` : source.id,
      outputs,
      selectedOutput,
      selectedRequired: required,
      runs,
    });
    for (let index = source.inputs.length - 1; index >= 0; index -= 1) {
      const child = source.inputs[index];
      const stochasticConsumption =
        !child.nonConsumed && child.consumptionProbability !== undefined;
      if (stochasticConsumption) {
        const warningKey =
          `${source.ref?.[0] ?? 'unknown'}:${source.ref?.[1] ?? 'unknown'}:${child.key}`;
        if (!warnedStochasticInputConsumption.has(warningKey)) {
          warnedStochasticInputConsumption.add(warningKey);
          console.warn(
            'Tree totals cannot derive guaranteed material consumption from a stochastic input; quantitative consumption is intentionally unknown.',
            {
              recipe: source.ref,
              itemKey: child.key,
              probability: child.consumptionProbability,
            },
          );
        }
      }
      const grossChildRequired =
        stochasticConsumption || child.amount == null || runs == null
          ? null
          : child.nonConsumed
            ? child.retentionMode === 'durability'
              ? child.amount *
                Math.ceil(runs / Math.max(1, child.retentionUses ?? 1))
              : child.amount
            : child.amount * runs;
      const committedAmount =
        useByproducts &&
        !virtualChildren &&
        !child.nonConsumed &&
        grossChildRequired != null &&
        child.byproductFulfillment
          ? Math.min(grossChildRequired, child.byproductFulfillment.creditedAmount)
          : 0;
      stack.push({
        phase: 'enter',
        node: child,
        nodeId: virtualChildren ? `${frame.nodeId}.v.${index}` : child.id,
        grossRequired: grossChildRequired,
        required:
          grossChildRequired == null ? null : grossChildRequired - committedAmount,
        virtual: virtualChildren,
      });
    }
  }

  const creditResult = useByproducts
    ? applyByproductCredits(
        inputs,
        byproducts,
        inputBalances,
        producerBalances,
        committedCredits,
      )
    : {
        credits: new Map<string, TreeTotal>(),
        coverageByNode: new Map<string, NodeByproductCoverage>(),
      };
  const nonZero = (total: TreeTotal) => total.amount == null || total.amount > 0;

  return {
    inputs: [...inputs.values()].filter(nonZero),
    prerequisites: [...prerequisites.values()].filter(nonZero),
    byproductCredits: [...creditResult.credits.values()].filter(nonZero),
    byproducts: [...byproducts.values()].filter(nonZero),
    requiredByNode,
    byproductCoverageByNode: creditResult.coverageByNode,
  };
}

export function requiredAmountFor(
  node: ItemTreeNode,
  calculation: TreeCalculation,
): number | null {
  if (calculation.requiredByNode.has(node.id)) {
    return calculation.requiredByNode.get(node.id) ?? null;
  }
  return node.amount === undefined ? 1 : node.amount;
}
