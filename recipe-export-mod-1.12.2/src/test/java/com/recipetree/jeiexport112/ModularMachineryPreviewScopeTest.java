package com.recipetree.jeiexport112;

import org.junit.Test;
import java.io.InputStream;
import org.objectweb.asm.ClassReader;
import org.objectweb.asm.tree.AbstractInsnNode;
import org.objectweb.asm.tree.ClassNode;
import org.objectweb.asm.tree.IntInsnNode;
import org.objectweb.asm.tree.MethodInsnNode;
import org.objectweb.asm.tree.MethodNode;
import static org.junit.Assert.assertArrayEquals;
import static org.junit.Assert.assertEquals;
import static org.junit.Assert.assertNotNull;
import static org.junit.Assert.assertTrue;

public class ModularMachineryPreviewScopeTest {
    @Test
    public void clearsOnlyDepthAfterInstallingTheMappedScissor() throws Exception {
        ClassNode type = new ClassNode();
        try (InputStream input = ModularMachineryPreviewScope.class.getResourceAsStream(
                "ModularMachineryPreviewScope.class")) {
            assertNotNull(input);
            new ClassReader(input).accept(type, 0);
        }
        boolean mappedClear = false;
        boolean depthOnly = false;
        for (MethodNode method : type.methods) {
            String previousCall = "";
            for (AbstractInsnNode instruction : method.instructions.toArray()) {
                if (!(instruction instanceof MethodInsnNode)) continue;
                MethodInsnNode call = (MethodInsnNode) instruction;
                if (method.name.equals("alignViewport") && call.name.equals("clearPreviewDepth")) {
                    assertEquals("glScissor", previousCall);
                    mappedClear = true;
                }
                if (method.name.equals("clearPreviewDepth") && call.name.equals("glClear")) {
                    AbstractInsnNode argument = instruction.getPrevious();
                    while (argument.getOpcode() < 0) argument = argument.getPrevious();
                    assertTrue(argument instanceof IntInsnNode);
                    assertEquals(256, ((IntInsnNode) argument).operand); // GL_DEPTH_BUFFER_BIT
                    assertEquals("glClearDepth", previousCall);
                    depthOnly = true;
                }
                previousCall = call.name;
            }
        }
        assertTrue("Must clear the relocated, clipped scene", mappedClear);
        assertTrue("Must preserve the panel color buffer", depthOnly);
    }

    @Test
    public void movesNativeSceneIntoItsRecipeCard() {
        assertArrayEquals(new int[]{808, 588, 400, 360},
                ModularMachineryPreviewScope.mapViewport(8, 948, 400, 360,
                        800, 360, 1F, 1440));
    }

    @Test
    public void scalesPositionAndSizeTogetherWhenZoomedOut() {
        assertArrayEquals(new int[]{804, 924, 200, 180},
                ModularMachineryPreviewScope.mapViewport(8, 948, 400, 360,
                        800, 270, 0.5F, 1440));
    }

    @Test
    public void preservesOffscreenOriginInsteadOfShiftingClippedPreview() {
        assertArrayEquals(new int[]{-84, 556, 800, 720},
                ModularMachineryPreviewScope.mapViewport(8, 948, 400, 360,
                        -100, -100, 2F, 1440));
    }
}
