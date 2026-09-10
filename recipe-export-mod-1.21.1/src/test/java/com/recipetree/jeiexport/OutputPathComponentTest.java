package com.recipetree.jeiexport;

import net.minecraft.ChatFormatting;
import net.minecraft.network.chat.ClickEvent;
import net.minecraft.network.chat.Component;
import org.junit.jupiter.api.Test;

import java.nio.file.Path;

import static org.junit.jupiter.api.Assertions.assertEquals;
import static org.junit.jupiter.api.Assertions.assertNotNull;
import static org.junit.jupiter.api.Assertions.assertTrue;

final class OutputPathComponentTest {
    @Test
    void outputPathIsAVisibleOpenFileLink() {
        Path output = Path.of("build", "test-export").toAbsolutePath().normalize();
        Component message = ExportJob.outputPathComponent("Export complete -> ", output, ChatFormatting.GREEN);

        assertTrue(message.getString().endsWith(output.toString()));
        Component pathComponent = message.getSiblings().get(0);
        ClickEvent click = pathComponent.getStyle().getClickEvent();
        assertNotNull(click);
        assertEquals(ClickEvent.Action.OPEN_FILE, click.getAction());
        assertEquals(output.toString(), click.getValue());
        assertTrue(pathComponent.getStyle().isUnderlined());
        assertNotNull(pathComponent.getStyle().getHoverEvent());
    }

    @Test
    void elapsedTimeUsesPlainLanguage() {
        assertEquals("9 seconds", ExportJob.friendlyDuration(9_100));
        assertEquals("1 minute 1 second", ExportJob.friendlyDuration(61_000));
        assertEquals("6 minutes 14 seconds", ExportJob.friendlyDuration(373_900));
    }
}
