package com.recipetree.jeiexport;

/** Overflow-safe quantity propagation for the in-game recipe tree. */
final class RecipeQuantityMath {
    static final long MAX_REQUESTED_AMOUNT = 999L;

    private RecipeQuantityMath() {
    }

    static long craftsFor(long requestedOutput, long outputPerCraft) {
        long requested = Math.max(1, requestedOutput);
        long yield = Math.max(1, outputPerCraft);
        return 1 + (requested - 1) / yield;
    }

    static long remainingAfterSupply(long requested, long supplied) {
        long demand = Math.max(1, requested);
        long available = Math.max(0, supplied);
        return Math.max(0, demand - Math.min(demand, available));
    }

    static long craftsForRemaining(long remainingDemand, long outputPerCraft) {
        return remainingDemand <= 0 ? 0 : craftsFor(remainingDemand, outputPerCraft);
    }

    static long surplusAfterCrafts(long consumed, long outputPerCraft, long crafts) {
        if (crafts <= 0) return 0;
        return Math.max(0, producedTotal(outputPerCraft, crafts) - Math.max(0, consumed));
    }

    static long adjustRequestedAmount(long currentAmount, double scrollDelta) {
        if (currentAmount < 1 || currentAmount > MAX_REQUESTED_AMOUNT) {
            throw new IllegalArgumentException("Current requested amount is outside the editable range.");
        }
        if (!Double.isFinite(scrollDelta) || scrollDelta == 0) {
            throw new IllegalArgumentException("Scroll delta must be finite and non-zero.");
        }
        if (scrollDelta > 0) {
            return Math.min(MAX_REQUESTED_AMOUNT, currentAmount + 1);
        }
        return Math.max(1, currentAmount - 1);
    }

    static long inputTotal(long inputPerCraft, long crafts) {
        long input = Math.max(1, inputPerCraft);
        long craftCount = Math.max(1, crafts);
        if (input > Long.MAX_VALUE / craftCount) return Long.MAX_VALUE;
        return input * craftCount;
    }

    static long producedTotal(long outputPerCraft, long crafts) {
        long output = Math.max(1, outputPerCraft);
        long craftCount = Math.max(1, crafts);
        if (output > Long.MAX_VALUE / craftCount) return Long.MAX_VALUE;
        return output * craftCount;
    }

    static long safeAdd(long left, long right) {
        if (right > 0 && left > Long.MAX_VALUE - right) return Long.MAX_VALUE;
        return left + right;
    }
}
