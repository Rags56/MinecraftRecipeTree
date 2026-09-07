package com.recipetree.jeiexport;

import com.mojang.logging.LogUtils;
import net.minecraftforge.api.distmarker.Dist;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.IExtensionPoint;
import net.minecraftforge.fml.ModLoadingContext;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.loading.FMLEnvironment;
import net.minecraftforge.network.NetworkConstants;
import net.minecraftforge.fml.javafmlmod.FMLJavaModLoadingContext;
import org.slf4j.Logger;

@Mod(JeiExportMod.MOD_ID)
public class JeiExportMod {
    public static final String MOD_ID = "jeiexport";
    public static final Logger LOGGER = LogUtils.getLogger();

    public JeiExportMod() {
        // Client-side only mod: never required on servers, ignore version mismatches.
        ModLoadingContext.get().registerExtensionPoint(IExtensionPoint.DisplayTest.class,
                () -> new IExtensionPoint.DisplayTest(() -> NetworkConstants.IGNORESERVERONLY, (remote, isServer) -> true));

        if (FMLEnvironment.dist == Dist.CLIENT) {
            MinecraftForge.EVENT_BUS.register(ExportEvents.class);
            MinecraftForge.EVENT_BUS.register(RecipeTreeClient.class);
            MinecraftForge.EVENT_BUS.register(RecipeTreeBook.class);
            ModLoadingContext.get().registerConfig(net.minecraftforge.fml.config.ModConfig.Type.CLIENT,
                    RecipeTreeBook.CONFIG_SPEC);
            FMLJavaModLoadingContext.get().getModEventBus().addListener(RecipeTreeClient::registerKeys);
        }
    }
}
