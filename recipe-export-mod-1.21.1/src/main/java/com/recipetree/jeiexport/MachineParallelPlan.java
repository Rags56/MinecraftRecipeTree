package com.recipetree.jeiexport;

/** Pure machine-throughput calculation shared by the screen and unit tests. */
public record MachineParallelPlan(
        long requestedOutput,
        long outputPerCycle,
        double cycleSeconds,
        double windowSeconds,
        long cyclesRequired,
        long machinesRequired,
        double outputPerMachine) {

    public static MachineParallelPlan calculate(
            long requestedOutput,
            long outputPerCycle,
            double cycleSeconds,
            double windowSeconds) {
        if (requestedOutput <= 0) {
            throw new IllegalArgumentException("Requested output must be positive.");
        }
        if (outputPerCycle <= 0) {
            throw new IllegalArgumentException("Output per cycle must be positive.");
        }
        if (!Double.isFinite(cycleSeconds) || cycleSeconds <= 0) {
            throw new IllegalArgumentException("Cycle time must be a positive finite number.");
        }
        if (!Double.isFinite(windowSeconds) || windowSeconds <= 0) {
            throw new IllegalArgumentException("Time window must be a positive finite number.");
        }

        long cycles = ceilDivide(requestedOutput, outputPerCycle);
        long completedCyclesPerMachine = (long) Math.floor(windowSeconds / cycleSeconds);
        if (completedCyclesPerMachine < 1) {
            throw new IllegalArgumentException("Time window must allow at least one complete cycle.");
        }
        double outputPerMachine = completedCyclesPerMachine * (double) outputPerCycle;
        long machines = Math.max(1, ceilDivide(cycles, completedCyclesPerMachine));
        return new MachineParallelPlan(
                requestedOutput,
                outputPerCycle,
                cycleSeconds,
                windowSeconds,
                cycles,
                machines,
                outputPerMachine);
    }

    private static long ceilDivide(long numerator, long denominator) {
        return 1 + ((numerator - 1) / denominator);
    }
}
