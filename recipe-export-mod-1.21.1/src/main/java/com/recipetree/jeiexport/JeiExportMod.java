package com.recipetree.jeiexport;

import com.mojang.logging.LogUtils;
import net.neoforged.fml.common.Mod;
import net.neoforged.api.distmarker.Dist;
import net.neoforged.bus.api.IEventBus;
import net.neoforged.neoforge.common.NeoForge;
import org.slf4j.Logger;

@Mod(value = JeiExportMod.MOD_ID, dist = Dist.CLIENT)
public class JeiExportMod {
    public static final String MOD_ID = "jeiexport";
    public static final Logger LOGGER = LogUtils.getLogger();

    public JeiExportMod(IEventBus modBus, net.neoforged.fml.ModContainer container) {
        NeoForge.EVENT_BUS.register(RecipeTreeClient.class);
        NeoForge.EVENT_BUS.register(RecipeTreeBook.class);
        container.registerConfig(net.neoforged.fml.config.ModConfig.Type.CLIENT, RecipeTreeBook.CONFIG_SPEC);
        modBus.addListener(RecipeTreeClient::registerKeys);
    }
}
