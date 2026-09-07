package com.recipetree.jeiexport;

import org.junit.jupiter.api.Test;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertThrows;

class MachineParallelPlanTest {
    @Test
    void suggestsEnoughParallelMachinesForTheDeadline() {
        MachineParallelPlan plan = MachineParallelPlan.calculate(100, 1, 10, 60);

        assertEquals(100, plan.cyclesRequired());
        assertEquals(17, plan.machinesRequired());
        assertEquals(6, plan.outputPerMachine());
    }

    @Test
    void accountsForBatchOutputs() {
        MachineParallelPlan plan = MachineParallelPlan.calculate(65, 8, 4, 20);

        assertEquals(9, plan.cyclesRequired());
        assertEquals(2, plan.machinesRequired());
        assertEquals(40, plan.outputPerMachine());
    }

    @Test
    void countsOnlyCyclesThatFinishBeforeTheDeadline() {
        MachineParallelPlan plan = MachineParallelPlan.calculate(10, 1, 10, 15);

        assertEquals(10, plan.machinesRequired());
        assertEquals(1, plan.outputPerMachine());
    }

    @Test
    void rejectsInvalidRates() {
        assertThrows(IllegalArgumentException.class,
                () -> MachineParallelPlan.calculate(1, 1, 0, 60));
        assertThrows(IllegalArgumentException.class,
                () -> MachineParallelPlan.calculate(1, 0, 1, 60));
        assertThrows(IllegalArgumentException.class,
                () -> MachineParallelPlan.calculate(1, 1, 10, 9));
    }
}
