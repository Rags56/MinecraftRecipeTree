package com.recipetree.jeiexport112;

import net.minecraftforge.client.ClientCommandHandler;
import net.minecraftforge.fml.client.registry.ClientRegistry;
import net.minecraftforge.common.MinecraftForge;
import net.minecraftforge.fml.common.Mod;
import net.minecraftforge.fml.common.event.FMLInitializationEvent;
import net.minecraftforge.fml.common.event.FMLPreInitializationEvent;
import org.apache.logging.log4j.LogManager;
import org.apache.logging.log4j.Logger;

@Mod(
        modid = JeiExportMod.MOD_ID,
        name = "Recipe Tree JEI/HEI Exporter",
        version = JeiExportMod.VERSION,
        clientSideOnly = true,
        acceptableRemoteVersions = "*",
        acceptedMinecraftVersions = "[1.12.2]",
        dependencies = JeiExportMod.JEI_DEPENDENCY
)
public final class JeiExportMod {
    static final String MOD_ID = "jeiexport";
    static final String VERSION = "1.2.0-beta.128";
    static final String JEI_DEPENDENCY = "required-after:jei@[4.12.0.214,5.0.0)";
    static final Logger LOGGER = LogManager.getLogger("jeiexport");
    static final ExportCoordinator COORDINATOR = new ExportCoordinator();
    static RecipeTreeConfiguration CONFIGURATION = RecipeTreeConfiguration.defaults();

    @Mod.EventHandler
    public void preInit(FMLPreInitializationEvent event) {
        CONFIGURATION = RecipeTreeConfiguration.load(event.getSuggestedConfigurationFile());
        LOGGER.info("[jeiexport] Recipe Tree new-world book spawn is {}",
                CONFIGURATION.spawnBookInNewWorlds() ? "enabled" : "disabled");
    }

    @Mod.EventHandler
    public void init(FMLInitializationEvent event) {
        MinecraftForge.EVENT_BUS.register(COORDINATOR);
        MinecraftForge.EVENT_BUS.register(RecipeTreeClient.INSTANCE);
        MinecraftForge.EVENT_BUS.register(RecipeTreeBook.INSTANCE);
        ClientRegistry.registerKeyBinding(RecipeTreeClient.OPEN_RECIPE_TREE);
        ClientCommandHandler.instance.registerCommand(new ExportCommand(COORDINATOR));
        LOGGER.info("[jeiexport] Client JEI/HEI exporter and live Recipe Tree viewer {} " +
                "initialized for Minecraft 1.12.2; request file is jeiexport-request.json", VERSION);
    }
}
